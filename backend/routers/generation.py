"""Content generation: patterns → angles → hooks / script / caption / stories."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase
from core.deps import require_org_access, resolve_client_id
from core.id_generator import generate_generation_session_id, generate_job_id
from jobs.reel_analyze_url import (
    ReelAnalyzeTerminalError,
    _execute_reel_analyze_url_core,
    _niche_context_for_reel_analysis,
    instagram_reel_url_is_valid,
)
from models.generation import (
    AutoVideoIdeaOut,
    GenerateVariantsBody,
    GenerateVariantsResponse,
    GenerationChooseAngleBody,
    GenerationRecommendFormatBody,
    GenerationRegenerateBody,
    GenerationSessionOut,
    GenerationStartBody,
    GenerateThumbnailBody,
    ComposeThumbnailBody,
    PatchGenerationSessionBody,
    PatchCoverSpecBody,
    VariantOption,
)
from services.content_generation import (
    GENERATION_PROMPT_VERSION,
    ALLOWED_AUTO_IDEA_FORMATS,
    _is_blueprint_angle,
    compact_analysis_for_prompt,
    angles_from_session_row,
    fetch_reel_analyses_for_generation,
    get_chosen_angle,
    merge_source_reference_into_patterns,
    run_adaptation_synthesis,
    run_auto_video_idea,
    run_angle_generation,
    run_carousel_copy_package,
    run_content_package,
    run_cover_text_options,
    run_format_recommendation,
    run_pattern_synthesis,
    run_regenerate,
    run_script_adaptation_synthesis,
)
from services.format_classifier import canonicalize_stored_format_key
from services.image_generation import (
    compose_thumbnail_from_image,
    generate_thumbnail_freepik_pillow,
)
from services.video_render import RENDERS_BUCKET, recover_stale_video_render_jobs
from services.video_spec_defaults import persist_finalize_spec, persist_healed_session_video_spec_row
from services.job_queue import has_active_job
from services.format_digest import (
    compute_format_digests,
    ensure_format_digests_fresh,
    get_digest_for_format,
    list_format_digest_summaries,
)
from services.instagram_post_url import canonical_instagram_post_url
from services.learning_context import build_learning_context, has_learning
from services.reel_metrics import compute_niche_benchmarks, enrich_engagement_metrics
from services.url_adapt_format_recommendation import recommend_url_adapt_format

router = APIRouter(prefix="/api/v1", tags=["generation"])
logger = logging.getLogger(__name__)


def _session_adapts_single_reference_reel(row: Dict[str, Any]) -> bool:
    """True when patterns come from one explicit source (URL, pasted script, or one picked analysis)."""
    st = str(row.get("source_type") or "").strip()
    if st in ("url_adapt", "script_adapt"):
        return True
    if st == "outlier":
        ids = row.get("source_analysis_ids")
        if isinstance(ids, list):
            return len([x for x in ids if str(x).strip()]) == 1
    return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_out(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize jsonb list fields for response_model."""
    out = dict(row)
    for key in ("source_analysis_ids", "source_reel_ids", "hashtags"):
        v = out.get(key)
        if v is None:
            continue
        if isinstance(v, list):
            out[key] = [str(x) for x in v]
    fk = out.get("source_format_key")
    if fk is not None and str(fk).strip():
        ck = canonicalize_stored_format_key(str(fk))
        if ck:
            out["source_format_key"] = ck
    return out


def _load_session(supabase: Client, client_id: str, session_id: str) -> Dict[str, Any]:
    res = (
        supabase.table("generation_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Generation session not found")
    return dict(res.data[0])


def _row_has_regenerated_content(row: Dict[str, Any]) -> bool:
    """True if the session already has a content package (not only angles)."""
    hooks = row.get("hooks")
    if isinstance(hooks, list):
        for h in hooks:
            if isinstance(h, dict) and str(h.get("text") or "").strip():
                return True
    if str(row.get("script") or "").strip():
        return True
    if str(row.get("caption_body") or "").strip():
        return True
    tags = row.get("hashtags")
    if isinstance(tags, list) and any(str(t).strip() for t in tags):
        return True
    stories = row.get("story_variants")
    if isinstance(stories, list) and any(str(s).strip() for s in stories):
        return True
    return False


_ANALYSIS_SEL = (
    "id, reel_id, post_url, owner_username, total_score, replicability_rating, hook_type, "
    "emotional_trigger, content_angle, caption_structure, why_it_worked, replicable_elements, "
    "suggested_adaptations, full_analysis_json, normalized_format"
)


def _load_analysis_with_meta(
    supabase: Client, client_id: str, post_url_key: str
) -> Optional[Dict[str, Any]]:
    res = (
        supabase.table("reel_analyses")
        .select(_ANALYSIS_SEL)
        .eq("client_id", client_id)
        .eq("post_url", post_url_key)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    r = dict(res.data[0])
    rid = r.get("reel_id")
    if rid:
        try:
            rres = (
                supabase.table("scraped_reels")
                .select("*")
                .eq("id", str(rid))
                .limit(1)
                .execute()
            )
            if rres.data:
                r["_reel_meta"] = enrich_engagement_metrics(dict(rres.data[0]))
        except Exception:
            r["_reel_meta"] = None
    else:
        r["_reel_meta"] = None
    return r


def _patterns_have_verbatim(patterns: Dict[str, Any]) -> bool:
    if not isinstance(patterns, dict):
        return False
    sr = patterns.get("source_reference")
    if not isinstance(sr, dict):
        return False
    vc = sr.get("verbatim_capture")
    return isinstance(vc, dict) and bool(
        vc.get("on_screen_text") or vc.get("spoken_transcript")
    )


def _analysis_video_analyzed(fa: Dict[str, Any]) -> bool:
    """True when analysis was produced from actual video frames, not caption-only."""
    prov = fa.get("media_provenance")
    if isinstance(prov, dict) and prov.get("video_analyzed") is not None:
        return bool(prov.get("video_analyzed"))
    return bool(fa.get("video_analyzed"))


def _verbatim_from_analysis_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(row, dict):
        return None
    fa = row.get("full_analysis_json")
    if not isinstance(fa, dict):
        return None
    if not _analysis_video_analyzed(fa):
        return None
    vc = fa.get("verbatim_capture")
    if isinstance(vc, dict) and (vc.get("on_screen_text") or vc.get("spoken_transcript")):
        return vc
    return None


def _ensure_verbatim_in_patterns(
    supabase: Client,
    settings: Settings,
    *,
    client_id: str,
    session_row: Dict[str, Any],
    patterns: Dict[str, Any],
) -> Dict[str, Any]:
    """Re-hydrate verbatim_capture into a session's stored patterns for 1:1 blueprint.

    Sessions created before verbatim capture existed (or before the source reel was
    re-analyzed) have no `source_reference.verbatim_capture`. Choose-angle / regenerate
    read the stored patterns, so without this the 1:1 path falls back to invented beats.
    This pulls verbatim from reel_analyses (and triggers a one-time video re-analysis when
    the stored analysis predates capture and Apify is available).
    """
    if not isinstance(patterns, dict):
        return patterns
    if str(session_row.get("source_type") or "").strip() != "url_adapt":
        return patterns
    if _patterns_have_verbatim(patterns):
        return patterns

    analysis_row: Optional[Dict[str, Any]] = None
    ids = session_row.get("source_analysis_ids")
    first_id = None
    if isinstance(ids, list):
        first_id = next((str(x).strip() for x in ids if str(x).strip()), None)
    if first_id:
        try:
            res = (
                supabase.table("reel_analyses")
                .select(_ANALYSIS_SEL)
                .eq("client_id", client_id)
                .eq("id", first_id)
                .limit(1)
                .execute()
            )
            if res.data:
                analysis_row = dict(res.data[0])
        except Exception:
            analysis_row = None

    src_url = str(session_row.get("source_url") or "").strip()
    url_key = canonical_instagram_post_url(src_url) if src_url else ""
    if analysis_row is None and url_key:
        analysis_row = _load_analysis_with_meta(supabase, client_id, url_key)

    vc = _verbatim_from_analysis_row(analysis_row)

    # Stored analysis predates verbatim capture — re-watch the video once if we can.
    if vc is None and url_key and settings.apify_api_token:
        try:
            _execute_reel_analyze_url_core(
                settings,
                supabase,
                client_id=client_id,
                analysis_job_id=generate_job_id(),
                reel_url=url_key,
                analysis_source="generate_choose_verbatim_backfill",
                niche_context=_niche_context_for_reel_analysis(supabase, client_id),
                skip_apify=False,
            )
            analysis_row = _load_analysis_with_meta(supabase, client_id, url_key)
            vc = _verbatim_from_analysis_row(analysis_row)
        except ReelAnalyzeTerminalError as e:
            logger.warning("verbatim re-hydrate skipped for %s: %s", url_key, e.code)
        except Exception:
            logger.exception("verbatim re-hydrate failed for %s", url_key)

    if vc is None:
        return patterns

    out = dict(patterns)
    sr = out.get("source_reference")
    sr = dict(sr) if isinstance(sr, dict) else {}
    sr["verbatim_capture"] = vc
    out["source_reference"] = sr

    # Persist back so future regenerations on this session stay 1:1.
    try:
        supabase.table("generation_sessions").update(
            {"synthesized_patterns": out, "updated_at": _now_iso()}
        ).eq("id", str(session_row.get("id"))).execute()
    except Exception:
        logger.exception("failed to persist re-hydrated verbatim patterns")

    return out


def _fetch_competitor_hints(supabase: Client, client_id: str, limit: int = 22) -> str:
    try:
        res = (
            supabase.table("scraped_reels")
            .select("hook_text, caption, account_username, format")
            .eq("client_id", client_id)
            .not_.is_("competitor_id", "null")
            .order("posted_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception:
        logger.warning("competitor hints fetch failed", exc_info=True)
        return ""
    lines: List[str] = []
    for r in res.data or []:
        if not isinstance(r, dict):
            continue
        hook = str(r.get("hook_text") or "").strip()
        cap = str(r.get("caption") or "").strip()[:500]
        user = str(r.get("account_username") or "").strip()
        fmt = str(r.get("format") or "").strip()
        bit = hook or cap[:200]
        if not bit:
            continue
        lines.append(f"@{user} [{fmt}] {bit}")
    return "\n".join(lines) if lines else ""


def _digest_summaries_for_auto_idea(summaries: List[dict]) -> List[dict]:
    out: List[dict] = []
    for s in summaries:
        if not isinstance(s, dict):
            continue
        raw = str(s.get("format_key") or "").strip()
        fk = canonicalize_stored_format_key(raw) or raw
        if fk in ALLOWED_AUTO_IDEA_FORMATS:
            out.append(s)
    return out


def _load_client_for_generation(
    supabase: Client, client_id: str, *, with_learning: bool = True
) -> Dict[str, Any]:
    res = (
        supabase.table("clients")
        .select(
            "id, name, instagram_handle, language, niche_config, icp, products, client_context, client_dna"
        )
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    row = dict(res.data[0])
    try:
        row["_niche_benchmarks"] = compute_niche_benchmarks(supabase, client_id)
    except Exception:
        row["_niche_benchmarks"] = {}
    if not with_learning:
        row["_learning"] = None
        return row
    try:
        row["_learning"] = build_learning_context(supabase, client_id)
    except Exception:
        logger.warning("build_learning_context failed for %s", client_id, exc_info=True)
        row["_learning"] = None
    return row


def _learning_trace(client_row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ctx = client_row.get("_learning")
    return ctx.get("trace") if has_learning(ctx) else None


@router.get("/clients/{slug}/generate/format-digests")
def list_format_digests(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
    refresh: bool = Query(False, description="If true, recompute digests when stale."),
) -> list[dict]:
    _ = slug
    if refresh and settings.openrouter_api_key:
        client_row = _load_client_for_generation(supabase, client_id, with_learning=False)
        ensure_format_digests_fresh(settings, supabase, client_id, client_row=client_row)
    return list_format_digest_summaries(supabase, client_id)


@router.post("/clients/{slug}/generate/recommend-format")
def recommend_format(
    slug: str,
    body: GenerationRecommendFormatBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    client_row = _load_client_for_generation(supabase, client_id)
    ensure_format_digests_fresh(settings, supabase, client_id, client_row=client_row)
    summaries = list_format_digest_summaries(supabase, client_id)
    if not summaries:
        raise HTTPException(
            status_code=400,
            detail="No format digests yet. Run competitor scrapes and wait for analyses, or refresh digests.",
        )
    try:
        recs = run_format_recommendation(
            settings,
            client_row=client_row,
            idea=body.idea,
            format_summaries=summaries,
        )
    except Exception as e:
        logger.exception("recommend_format failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"recommendations": recs}


@router.post("/clients/{slug}/generate/auto-video-idea", response_model=AutoVideoIdeaOut)
def auto_video_idea(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AutoVideoIdeaOut:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    client_row = _load_client_for_generation(supabase, client_id)
    ensure_format_digests_fresh(settings, supabase, client_id, client_row=client_row)
    summaries = list_format_digest_summaries(supabase, client_id)
    filtered = _digest_summaries_for_auto_idea(summaries)
    hints = _fetch_competitor_hints(supabase, client_id)
    try:
        out = run_auto_video_idea(
            settings,
            client_row=client_row,
            format_summaries=filtered,
            competitor_hints=hints or "(no competitor snippets yet — rely on client context)",
        )
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.exception("auto_video_idea failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    return AutoVideoIdeaOut(**out)


@router.post("/clients/{slug}/generate/start", response_model=GenerationSessionOut)
def generation_start(
    slug: str,
    body: GenerationStartBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    st = body.source_type
    client_row = _load_client_for_generation(supabase, client_id)

    source_format_key: Optional[str] = None
    source_url: Optional[str] = None
    source_idea: Optional[str] = None
    patterns: Dict[str, Any] = {}
    angles: List[Dict[str, Any]] = []
    analysis_ids: List[str] = []
    reel_ids: List[str] = []
    cta_payload: Optional[Dict[str, Any]] = (
        body.selected_cta.model_dump() if body.selected_cta is not None else None
    )
    carousel_template_payload: Optional[Dict[str, Any]] = (
        body.selected_carousel_template.model_dump()
        if body.selected_carousel_template is not None
        else None
    )
    cover_template_payload: Optional[Dict[str, Any]] = (
        body.selected_cover_template.model_dump()
        if body.selected_cover_template is not None
        else None
    )

    try:
        if st in ("format_pick", "idea_match"):
            fk = (body.format_key or "").strip()
            if not fk:
                raise HTTPException(status_code=400, detail="format_key required")
            if st == "idea_match" and not (body.idea_text and body.idea_text.strip()):
                raise HTTPException(status_code=400, detail="idea_text required for idea_match")
            source_format_key = fk
            if st == "idea_match":
                source_idea = (body.idea_text or "").strip()
            ensure_format_digests_fresh(settings, supabase, client_id, client_row=client_row)
            drow = get_digest_for_format(supabase, client_id, fk)
            if not drow or not isinstance(drow.get("digest_json"), dict):
                compute_format_digests(settings, supabase, client_id, client_row=client_row)
                drow = get_digest_for_format(supabase, client_id, fk)
            if not drow or not isinstance(drow.get("digest_json"), dict):
                raise HTTPException(
                    status_code=400,
                    detail="No digest for this format yet. Scrape reels, ensure analyses exist, then retry.",
                )
            patterns = dict(drow.get("digest_json") or {})
            extra_focus: Optional[str] = None
            if st == "idea_match" and source_idea:
                extra_focus = source_idea
            elif body.extra_instruction and body.extra_instruction.strip():
                extra_focus = body.extra_instruction.strip()
            angles = run_angle_generation(
                settings,
                client_row=client_row,
                synthesized_patterns=patterns,
                extra_instruction=extra_focus,
                selected_cta=cta_payload,
            )
            tr = drow.get("top_reel_ids")
            if isinstance(tr, list):
                for x in tr:
                    if not isinstance(x, dict):
                        continue
                    aid = x.get("analysis_id")
                    rid = x.get("reel_id")
                    if aid:
                        analysis_ids.append(str(aid))
                    if rid:
                        reel_ids.append(str(rid))

        elif st == "url_adapt":
            raw_u = (body.url or "").strip()
            if not raw_u or not instagram_reel_url_is_valid(raw_u):
                raise HTTPException(status_code=400, detail="Valid Instagram reel URL required")
            url_key = canonical_instagram_post_url(raw_u)
            source_url = url_key
            # Optional user override: which production format the user wants to recreate
            # the reel as. When set, the synthesis + angles are steered toward that target
            # format instead of mirroring the source reel's original format.
            user_target_fk_raw = (body.format_key or "").strip()
            user_target_fk: Optional[str] = None
            if user_target_fk_raw:
                ck_user = canonicalize_stored_format_key(user_target_fk_raw) or user_target_fk_raw
                if ck_user not in ("text_overlay", "talking_head", "carousel", "b_roll_reel"):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "format_key must be one of: text_overlay, talking_head, carousel, b_roll_reel"
                        ),
                    )
                user_target_fk = ck_user
            one = _load_analysis_with_meta(supabase, client_id, url_key)
            if not one:
                sr = (
                    supabase.table("scraped_reels")
                    .select("id")
                    .eq("client_id", client_id)
                    .eq("post_url", url_key)
                    .limit(1)
                    .execute()
                )
                skip_apify = bool(sr and sr.data)
                if not skip_apify and not settings.apify_api_token:
                    raise HTTPException(
                        status_code=400,
                        detail="Reel not in your database yet. Analyze it in Intelligence first, or configure APIFY.",
                    )
                niche_ctx = _niche_context_for_reel_analysis(supabase, client_id)
                try:
                    _execute_reel_analyze_url_core(
                        settings,
                        supabase,
                        client_id=client_id,
                        analysis_job_id=generate_job_id(),
                        reel_url=raw_u,
                        analysis_source="generate_url_adapt",
                        niche_context=niche_ctx,
                        skip_apify=skip_apify,
                    )
                except ReelAnalyzeTerminalError as e:
                    raise HTTPException(status_code=400, detail=str(e.code)) from e
                one = _load_analysis_with_meta(supabase, client_id, url_key)
            if not one:
                raise HTTPException(status_code=400, detail="Could not load analysis for this URL")
            fa0 = one.get("full_analysis_json")
            vc0 = fa0.get("verbatim_capture") if isinstance(fa0, dict) else None
            va0 = _analysis_video_analyzed(fa0) if isinstance(fa0, dict) else False
            needs_verbatim = not (
                va0
                and isinstance(vc0, dict)
                and vc0.get("on_screen_text")
            )
            if needs_verbatim and settings.apify_api_token:
                try:
                    _execute_reel_analyze_url_core(
                        settings,
                        supabase,
                        client_id=client_id,
                        analysis_job_id=generate_job_id(),
                        reel_url=raw_u,
                        analysis_source="generate_url_adapt_verbatim_backfill",
                        niche_context=_niche_context_for_reel_analysis(supabase, client_id),
                        skip_apify=False,
                    )
                    one = _load_analysis_with_meta(supabase, client_id, url_key)
                except ReelAnalyzeTerminalError as e:
                    logger.warning(
                        "verbatim backfill skipped for %s: %s", url_key, e.code
                    )
            if not one:
                raise HTTPException(status_code=400, detail="Could not load analysis for this URL")
            packed = compact_analysis_for_prompt(one, reel_meta=one.get("_reel_meta"))
            patterns = run_adaptation_synthesis(
                settings,
                client_row=client_row,
                packed_analysis=packed,
                target_format_key=user_target_fk,
            )
            if not isinstance(patterns, dict):
                patterns = {}
            patterns = merge_source_reference_into_patterns(patterns, packed)
            if body.recreate_mode == "one_to_one":
                # Strict 1:1 recreation: skip angle generation/selection entirely. We
                # package the blueprint directly after insert (see one_to_one branch below),
                # so a single synthetic blueprint angle is enough to drive the verbatim copy.
                angles = [_synthetic_blueprint_angle()]
            else:
                extra_adapt = (
                    body.extra_instruction.strip()
                    if body.extra_instruction and body.extra_instruction.strip()
                    else None
                )
                angles = run_angle_generation(
                    settings,
                    client_row=client_row,
                    synthesized_patterns=patterns,
                    extra_instruction=extra_adapt,
                    adapt_single_reference_reel=True,
                    target_format_key=user_target_fk,
                    selected_cta=cta_payload,
                )
            if one.get("id"):
                analysis_ids.append(str(one["id"]))
            if one.get("reel_id"):
                reel_ids.append(str(one["reel_id"]))
            # When the user explicitly picked a target format, honour it; otherwise route
            # Auto from source media type + duration: carousels stay carousels, short
            # videos become text overlays, longer videos become talking-head scripts.
            if user_target_fk:
                source_format_key = user_target_fk
            else:
                source_format_key = recommend_url_adapt_format(
                    one,
                    reel_meta=one.get("_reel_meta"),
                )

        elif st == "script_adapt":
            raw_script = (body.source_script or "").strip()
            if len(raw_script) < 40:
                raise HTTPException(
                    status_code=400,
                    detail="source_script required for script_adapt (at least a few sentences).",
                )
            patterns = run_script_adaptation_synthesis(
                settings, client_row=client_row, english_script=raw_script
            )
            if not isinstance(patterns, dict):
                patterns = {}
            extra_script = (
                body.extra_instruction.strip()
                if body.extra_instruction and body.extra_instruction.strip()
                else None
            )
            angles = run_angle_generation(
                settings,
                client_row=client_row,
                synthesized_patterns=patterns,
                extra_instruction=extra_script,
                adapt_single_reference_reel=True,
                selected_cta=cta_payload,
            )

        else:
            if st == "outlier":
                ids = body.source_analysis_ids or []
                if not ids:
                    raise HTTPException(
                        status_code=400,
                        detail="source_analysis_ids required when source_type=outlier",
                    )

            rows = fetch_reel_analyses_for_generation(
                supabase,
                client_id=client_id,
                source_type=st,
                source_analysis_ids=body.source_analysis_ids,
                max_analyses=body.max_analyses,
            )
            if not rows:
                raise HTTPException(
                    status_code=400,
                    detail="No reel analyses found. Run Intelligence → analyze reels first.",
                )

            packed = [compact_analysis_for_prompt(r, reel_meta=r.get("_reel_meta")) for r in rows]
            reel_ids = [str(r["reel_id"]) for r in rows if r.get("reel_id")]
            analysis_ids = [str(r["id"]) for r in rows if r.get("id")]

            patterns = run_pattern_synthesis(
                settings,
                client_row=client_row,
                packed_analyses=packed,
                extra_instruction=body.extra_instruction,
            )
            if not isinstance(patterns, dict):
                patterns = {}
            single_reference_outlier = st == "outlier" and len(rows) == 1
            if single_reference_outlier and len(packed) == 1:
                patterns = merge_source_reference_into_patterns(patterns, packed[0])
            angles = run_angle_generation(
                settings,
                client_row=client_row,
                synthesized_patterns=patterns,
                extra_instruction=body.extra_instruction,
                adapt_single_reference_reel=single_reference_outlier,
                selected_cta=cta_payload,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generation start failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    one_to_one_recreate = st == "url_adapt" and body.recreate_mode == "one_to_one"
    if not one_to_one_recreate and len(angles) < 3:
        raise HTTPException(
            status_code=502,
            detail="Model returned too few angles; retry or adjust inputs.",
        )

    # Carousel vs video template snapshots are mutually exclusive (avoid wrong-format sessions).
    if source_format_key:
        ck_ins = canonicalize_stored_format_key(source_format_key) or source_format_key.strip()
        if ck_ins == "carousel":
            cover_template_payload = None
        else:
            carousel_template_payload = None

    sid = generate_generation_session_id()
    now = _now_iso()
    insert_row: Dict[str, Any] = {
        "id": sid,
        "client_id": client_id,
        "source_type": st,
        "source_analysis_ids": analysis_ids or None,
        "source_reel_ids": reel_ids or None,
        "synthesized_patterns": patterns,
        "angles": angles,
        "chosen_angle_index": None,
        "hooks": None,
        "script": None,
        "caption_body": None,
        "hashtags": None,
        "story_variants": None,
        "status": "angles_ready",
        "learning_trace": _learning_trace(client_row),
        "feedback": None,
        "prompt_version": GENERATION_PROMPT_VERSION,
        "created_at": now,
        "updated_at": now,
    }
    if source_format_key:
        ck = canonicalize_stored_format_key(source_format_key)
        final_fk = ck or source_format_key.strip()
        insert_row["source_format_key"] = final_fk
        if final_fk == "carousel":
            csc = body.carousel_slide_count
            insert_row["carousel_slide_count"] = (
                max(3, min(10, int(csc))) if csc is not None else 6
            )
    if source_url:
        insert_row["source_url"] = source_url
    if source_idea:
        insert_row["source_idea"] = source_idea
    if st == "script_adapt" and body.source_script and str(body.source_script).strip():
        insert_row["source_script"] = str(body.source_script).strip()[:16_000]
    if cta_payload is not None:
        insert_row["selected_cta"] = cta_payload
    if carousel_template_payload is not None:
        insert_row["selected_carousel_template"] = carousel_template_payload
    if cover_template_payload is not None:
        insert_row["selected_cover_template"] = cover_template_payload
    try:
        ins = supabase.table("generation_sessions").insert(insert_row).execute()
    except Exception as e:
        logger.exception("generation_sessions insert failed — run sql migrations?")
        hint = str(e).strip() or e.__class__.__name__
        raise HTTPException(
            status_code=503,
            detail=(
                "Database error (generation_sessions). "
                "If you recently pulled code, run pending SQL migrations (e.g. phase26_carousel_slide_count.sql). "
                f"Underlying: {hint[:500]}"
            ),
        ) from e
    if not ins.data:
        raise HTTPException(status_code=500, detail="Insert failed")

    if one_to_one_recreate:
        # Skip the angle-selection step: package the strict 1:1 blueprint right away so the
        # session lands on content_ready and the UI opens directly in the studio.
        inserted = dict(ins.data[0])
        try:
            return _finalize_session_package(
                supabase,
                settings,
                client_id=client_id,
                session_id=sid,
                row=inserted,
                client_row=client_row,
                angle_index=0,
                chosen_angle=angles[0],
                patterns=patterns,
                feedback=None,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("one_to_one recreate packaging failed")
            raise HTTPException(status_code=502, detail=str(e)) from e

    return _row_to_out(ins.data[0])


def _synthetic_blueprint_angle() -> Dict[str, Any]:
    """Minimal blueprint angle for the one_to_one recreate path (no angle generation).

    `run_content_package` only reads optional angle fields (title/situation/...); the strict
    1:1 output is driven by `verbatim_capture`, so an empty-ish blueprint angle is sufficient.
    `angle_role == "blueprint"` is what triggers strict_blueprint downstream.
    """
    return {
        "title": "1:1 recreation",
        "angle_role": "blueprint",
        "situation": "",
        "emotional_trigger": "",
        "draft_hook": "",
        "mechanism_note": "",
    }


def _finalize_session_package(
    supabase: Client,
    settings: Settings,
    *,
    client_id: str,
    session_id: str,
    row: Dict[str, Any],
    client_row: Dict[str, Any],
    angle_index: int,
    chosen_angle: Dict[str, Any],
    patterns: Dict[str, Any],
    feedback: Optional[str],
) -> dict:
    """Package the chosen angle into final content and persist it (status content_ready).

    Shared by choose-angle (angle picked in UI) and the one_to_one recreate path on /start
    (synthetic blueprint angle, no angle selection). Handles carousel vs video formats,
    cover options, the finalize/video spec, and returns the serialized session row.
    """
    raw_fk = str(row.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw_fk) or raw_fk or None
    selected_cta = row.get("selected_cta") if isinstance(row.get("selected_cta"), dict) else None

    if fk == "carousel":
        # Carousel: hooks + caption only, then build slide PNGs immediately (no Reel script / cover headlines).
        try:
            copy_pkg = run_carousel_copy_package(
                settings,
                client_row=client_row,
                synthesized_patterns=patterns,
                chosen_angle=chosen_angle,
                feedback=feedback,
                adapt_single_reference_reel=_session_adapts_single_reference_reel(row),
                selected_cta=selected_cta,
            )
        except Exception as e:
            logger.exception("session package failed (carousel copy)")
            raise HTTPException(status_code=502, detail=str(e)) from e

        from models.generation import GenerateCarouselSlidesBody
        from routers.creation import build_carousel_slides_payload, carousel_slide_count_effective

        temp_row = dict(row)
        temp_row["chosen_angle_index"] = angle_index
        temp_row["hooks"] = copy_pkg["hooks"]
        cc = carousel_slide_count_effective(temp_row, 6)
        try:
            slides = build_carousel_slides_payload(
                supabase,
                settings,
                client_id=client_id,
                session_id=session_id,
                row=temp_row,
                body=GenerateCarouselSlidesBody(count=cc, style=None),
            )
        except Exception as e:
            logger.exception("session package failed (carousel slides)")
            raise HTTPException(status_code=502, detail=str(e)) from e

        script_outline = "\n\n".join(
            f"## Slide {int(s.get('idx', i)) + 1}\n{str(s.get('text') or '').strip()}"
            for i, s in enumerate(slides)
            if isinstance(s, dict)
        )

        now = _now_iso()
        patch = {
            "chosen_angle_index": angle_index,
            "hooks": copy_pkg["hooks"],
            "script": script_outline or None,
            "caption_body": copy_pkg["caption_body"],
            "hashtags": copy_pkg["hashtags"],
            "story_variants": copy_pkg.get("story_variants") or [],
            "text_blocks": None,
            "carousel_slides": slides,
            "cover_text_options": None,
            "status": "content_ready",
            "learning_trace": _learning_trace(client_row),
            "updated_at": now,
        }
        supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
        out = _load_session(supabase, client_id, session_id)
        merged = dict(out)
        clin = {"brand_theme": client_row.get("brand_theme"), "language": client_row.get("language")}
        persist_finalize_spec(
            supabase,
            session_id=session_id,
            client_id=client_id,
            session_row=merged,
            client_row=clin,
            updated_at_iso=_now_iso(),
        )
        return _row_to_out(_load_session(supabase, client_id, session_id))

    try:
        package = run_content_package(
            settings,
            client_row=client_row,
            synthesized_patterns=patterns,
            chosen_angle=chosen_angle,
            feedback=feedback,
            source_format_key=fk,
            adapt_single_reference_reel=_session_adapts_single_reference_reel(row),
            selected_cta=selected_cta,
        )
    except Exception as e:
        logger.exception("session package failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    cover_options: List[str] = []
    try:
        cover_options = run_cover_text_options(
            settings,
            client_row=client_row,
            chosen_angle=chosen_angle,
            hooks=package["hooks"],
            script=package["script"],
            text_blocks=package.get("text_blocks"),
        )
    except Exception:
        # Cover generation must never block content_ready — fall back to hooks in the UI.
        logger.warning("cover_text_options generation failed; leaving null", exc_info=True)

    now = _now_iso()
    patch = {
        "chosen_angle_index": angle_index,
        "hooks": package["hooks"],
        "script": package["script"],
        "caption_body": package["caption_body"],
        "hashtags": package["hashtags"],
        "story_variants": package["story_variants"],
        "text_blocks": package.get("text_blocks"),
        "cover_text_options": cover_options or None,
        "status": "content_ready",
        "learning_trace": _learning_trace(client_row),
        "updated_at": now,
    }
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    out = _load_session(supabase, client_id, session_id)
    merged = dict(out)
    vs_pkg = package.get("visual_style")
    if vs_pkg is not None:
        merged["visual_style"] = vs_pkg
    clin = {"brand_theme": client_row.get("brand_theme"), "language": client_row.get("language")}
    persist_finalize_spec(
        supabase,
        session_id=session_id,
        client_id=client_id,
        session_row=merged,
        client_row=clin,
        updated_at_iso=_now_iso(),
    )
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/choose-angle",
    response_model=GenerationSessionOut,
)
def generation_choose_angle(
    slug: str,
    session_id: str,
    body: GenerationChooseAngleBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    row = _load_session(supabase, client_id, session_id)
    angles = angles_from_session_row(row)
    if not angles:
        raise HTTPException(status_code=400, detail="Session has no angles")
    if body.angle_index < 0 or body.angle_index >= len(angles):
        raise HTTPException(status_code=400, detail="angle_index out of range")

    client_row = _load_client_for_generation(supabase, client_id)
    patterns = row.get("synthesized_patterns") if isinstance(row.get("synthesized_patterns"), dict) else {}
    chosen = angles[body.angle_index]
    choose_feedback = (
        body.extra_instruction.strip()
        if body.extra_instruction and body.extra_instruction.strip()
        else None
    )
    if not choose_feedback and _is_blueprint_angle(chosen):
        patterns = _ensure_verbatim_in_patterns(
            supabase, settings, client_id=client_id, session_row=row, patterns=patterns
        )

    return _finalize_session_package(
        supabase,
        settings,
        client_id=client_id,
        session_id=session_id,
        row=row,
        client_row=client_row,
        angle_index=body.angle_index,
        chosen_angle=chosen,
        patterns=patterns,
        feedback=choose_feedback,
    )


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/regenerate-covers",
    response_model=GenerationSessionOut,
)
def generation_regenerate_covers(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """Re-roll the AI cover headlines for a session without touching hooks/script/caption.

    Cheap, dedicated endpoint so the cover prompt can iterate independently of the
    heavy `run_content_package` call. Passes the previous options as anti-repeat context.
    """
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    row = _load_session(supabase, client_id, session_id)
    chosen = get_chosen_angle(row)
    if not chosen:
        raise HTTPException(status_code=400, detail="Choose an angle first.")

    client_row = _load_client_for_generation(supabase, client_id)
    hooks = [h for h in (row.get("hooks") or []) if isinstance(h, dict)]
    script = str(row.get("script") or "")
    previous = row.get("cover_text_options") if isinstance(row.get("cover_text_options"), list) else None
    text_blocks = row.get("text_blocks") if isinstance(row.get("text_blocks"), list) else None

    try:
        covers = run_cover_text_options(
            settings,
            client_row=client_row,
            chosen_angle=chosen,
            hooks=hooks,
            script=script,
            previous=previous,
            text_blocks=text_blocks,
        )
    except Exception as e:
        logger.exception("regenerate-covers failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    if not covers:
        raise HTTPException(status_code=502, detail="Model returned no usable cover options; retry.")

    supabase.table("generation_sessions").update({
        "cover_text_options": covers,
        "updated_at": _now_iso(),
    }).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/regenerate",
    response_model=GenerationSessionOut,
)
def generation_regenerate(
    slug: str,
    session_id: str,
    body: GenerationRegenerateBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    row = _load_session(supabase, client_id, session_id)
    if row.get("status") == "angles_ready" or not _row_has_regenerated_content(row):
        raise HTTPException(
            status_code=400,
            detail="Choose an angle first — session has no generated content yet.",
        )

    chosen = get_chosen_angle(row)
    if not chosen:
        raise HTTPException(status_code=400, detail="No chosen angle on session")

    patterns = row.get("synthesized_patterns") if isinstance(row.get("synthesized_patterns"), dict) else {}
    client_row = _load_client_for_generation(supabase, client_id)
    if not (body.feedback and body.feedback.strip()) and _is_blueprint_angle(chosen):
        patterns = _ensure_verbatim_in_patterns(
            supabase, settings, client_id=client_id, session_row=row, patterns=patterns
        )

    hooks = row.get("hooks") if isinstance(row.get("hooks"), list) else []
    hooks = [h for h in hooks if isinstance(h, dict)]
    script = str(row.get("script") or "")
    cap = str(row.get("caption_body") or "")
    tags = row.get("hashtags") if isinstance(row.get("hashtags"), list) else []
    tags = [str(t) for t in tags]
    stories = row.get("story_variants") if isinstance(row.get("story_variants"), list) else []
    stories = [str(s) for s in stories]
    raw_tb = row.get("text_blocks")
    cur_tb: Optional[List[Dict[str, Any]]] = None
    if isinstance(raw_tb, list):
        cur_tb = [x for x in raw_tb if isinstance(x, dict)]

    raw_vs = row.get("visual_style")
    cur_vs: Optional[Dict[str, Any]] = None
    if isinstance(raw_vs, dict):
        cur_vs = raw_vs

    raw_fk = str(row.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw_fk) or raw_fk or None
    selected_cta = row.get("selected_cta") if isinstance(row.get("selected_cta"), dict) else None
    try:
        package = run_regenerate(
            settings,
            client_row=client_row,
            synthesized_patterns=patterns,
            chosen_angle=chosen,
            scope=body.scope,
            feedback=body.feedback,
            current_hooks=hooks,
            current_script=script,
            current_caption=cap,
            current_hashtags=tags,
            current_stories=stories,
            source_format_key=fk,
            current_text_blocks=cur_tb,
            current_visual_style=cur_vs,
            adapt_single_reference_reel=_session_adapts_single_reference_reel(row),
            selected_cta=selected_cta,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("generation regenerate failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    now = _now_iso()
    patch = {
        "hooks": package["hooks"],
        "script": package["script"],
        "caption_body": package["caption_body"],
        "hashtags": package["hashtags"],
        "story_variants": package["story_variants"],
        "text_blocks": package.get("text_blocks"),
        "status": "content_ready",
        "learning_trace": _learning_trace(client_row),
        "updated_at": now,
    }
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    out = _load_session(supabase, client_id, session_id)
    merged = dict(out)
    vs_pkg = package.get("visual_style")
    if vs_pkg is not None:
        merged["visual_style"] = vs_pkg
    clin = {"brand_theme": client_row.get("brand_theme"), "language": client_row.get("language")}
    persist_finalize_spec(
        supabase,
        session_id=session_id,
        client_id=client_id,
        session_row=merged,
        client_row=clin,
        updated_at_iso=_now_iso(),
    )
    return _row_to_out(_load_session(supabase, client_id, session_id))


## /approve and /reject endpoints were removed in the editor UX overhaul.
##
## They mirrored an old draft-vs-published workflow that the unified Create
## screen no longer uses — render = ship; delete-session replaces reject.
## The frontend had no callers; the endpoints were already documented as
## DEPRECATED and only existed as a no-op surface for legacy API consumers.
##
## Sessions in the wild may still carry status="approved"/"rejected" from
## before; the listing endpoint accepts any string so reads keep working.
## No backfill is required.


@router.get("/clients/{slug}/generate/sessions", response_model=list[GenerationSessionOut])
def generation_list_sessions(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(30, ge=1, le=100),
) -> list[dict]:
    _ = slug
    try:
        res = (
            supabase.table("generation_sessions")
            .select("*")
            .eq("client_id", client_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        logger.exception("generation_sessions list failed")
        raise HTTPException(
            status_code=503,
            detail="Could not list sessions (is sql/phase6_generation_sessions.sql applied?).",
        ) from e
    return [_row_to_out(r) for r in (res.data or [])]


@router.patch(
    "/clients/{slug}/generate/sessions/{session_id}",
    response_model=GenerationSessionOut,
)
def patch_generation_session(
    slug: str,
    session_id: str,
    body: PatchGenerationSessionBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Update session artifacts that must remain editable before heavy assets exist.

    Replace ``selected_carousel_template`` for carousel sessions. When ``carousel_slides``
    is already populated, the client must pass ``clear_carousel_slides=true`` so the
    server can drop existing PNG rows before applying the new reference snapshot.
    """
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    raw_fk = str(row.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw_fk) or raw_fk

    if body.selected_carousel_template is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    if fk != "carousel":
        raise HTTPException(
            status_code=400,
            detail="selected_carousel_template only applies when source_format_key is carousel.",
        )

    cs_raw = row.get("carousel_slides")
    has_slides = isinstance(cs_raw, list) and len(cs_raw) > 0
    clear_requested = bool(body.clear_carousel_slides)

    if has_slides and not clear_requested:
        raise HTTPException(
            status_code=400,
            detail=(
                "Carousel slides already exist. Pass clear_carousel_slides=true with the new "
                "template to switch style (current slides are removed; use Generate slides next)."
            ),
        )

    payload = body.selected_carousel_template.model_dump(mode="json")
    now = _now_iso()
    patch: Dict[str, Any] = {"selected_carousel_template": payload, "updated_at": now}
    if has_slides and clear_requested:
        patch["carousel_slides"] = None
        patch["script"] = None

    supabase.table("generation_sessions").update(patch).eq("id", session_id).eq("client_id", client_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.patch(
    "/clients/{slug}/generate/sessions/{session_id}/cover-spec",
    response_model=GenerationSessionOut,
)
def patch_cover_spec(
    slug: str,
    session_id: str,
    body: PatchCoverSpecBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Autosave the cover editor state.

    Full-replace of ``cover_spec`` (JSONB). Cheap because the payload is small.
    Editor calls this on slider release / chip click; render endpoints fall
    back to this column when their body omits styling overrides.
    """
    _ = slug
    _ = _load_session(supabase, client_id, session_id)
    payload = body.cover_spec.model_dump(mode="json", exclude_none=False)
    supabase.table("generation_sessions").update(
        {"cover_spec": payload, "updated_at": _now_iso()}
    ).eq("id", session_id).eq("client_id", client_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


# ─────────────────────────────────────────────────────────────────────────────
# Phase F — variants endpoint
#
# Generates N AI alternates for an element (hook / block / cover / caption)
# and persists them on `generation_sessions.alternates` (JSONB column added
# by phase29_alternates.sql).
#
# Implementation note: this is the minimum viable backend for the Studio
# inspector's `VariantsRail`. It calls the existing `run_regenerate`
# pipeline up to `n` times and appends each distinct result to the alternates
# pool. A future optimization can teach `services/content_generation.py` to
# return N variants in one LLM call; this endpoint contract does not need to
# change when that happens.
#
# The pool is capped at 12 entries per kind (FIFO eviction) so memory stays
# bounded for long-lived sessions.
# ─────────────────────────────────────────────────────────────────────────────


_ALTERNATES_KIND_CAP = 12


def _read_alternates(row: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    raw = row.get("alternates")
    if not isinstance(raw, dict):
        return {"hook": [], "block": [], "cover": [], "caption": []}
    out: Dict[str, List[Dict[str, Any]]] = {}
    for k in ("hook", "block", "cover", "caption"):
        bucket = raw.get(k)
        out[k] = [x for x in bucket if isinstance(x, dict)] if isinstance(bucket, list) else []
    return out


def _append_alternate(
    pool: Dict[str, List[Dict[str, Any]]],
    kind: str,
    text: str,
) -> Optional[Dict[str, Any]]:
    text = (text or "").strip()
    if not text:
        return None
    bucket = pool.setdefault(kind, [])
    # De-dupe by text — re-generating an option that already exists shouldn't bloat the pool.
    if any(str(x.get("text", "")).strip() == text for x in bucket):
        return None
    entry = {
        "id": generate_generation_session_id(),
        "text": text,
        "source": "variants",
        "created_at": _now_iso(),
    }
    bucket.append(entry)
    # FIFO cap.
    if len(bucket) > _ALTERNATES_KIND_CAP:
        del bucket[: len(bucket) - _ALTERNATES_KIND_CAP]
    return entry


def _pick_text_for_kind(package: Dict[str, Any], kind: str) -> Optional[str]:
    """Extract the appropriate text from a ``run_regenerate`` result."""
    if kind == "hook":
        hooks = package.get("hooks")
        if isinstance(hooks, list) and hooks:
            first = hooks[0]
            if isinstance(first, dict):
                t = first.get("text")
                if isinstance(t, str) and t.strip():
                    return t
    elif kind == "caption":
        cap = package.get("caption_body")
        if isinstance(cap, str) and cap.strip():
            return cap
    elif kind == "block":
        # Text blocks come back as a list; we keep just the first body block
        # so a single variant entry corresponds to a single LLM call.
        blocks = package.get("text_blocks")
        if isinstance(blocks, list):
            for b in blocks:
                if isinstance(b, dict):
                    t = b.get("text")
                    if isinstance(t, str) and t.strip():
                        return t
    elif kind == "cover":
        # Cover headlines live on a separate field (cover_text_options); we
        # also reuse the first hook as a fallback because the same regen
        # produces both.
        cto = package.get("cover_text_options")
        if isinstance(cto, list) and cto:
            t = cto[0]
            if isinstance(t, str) and t.strip():
                return t
        hooks = package.get("hooks")
        if isinstance(hooks, list) and hooks:
            first = hooks[0]
            if isinstance(first, dict):
                t = first.get("text")
                if isinstance(t, str) and t.strip():
                    return t
    return None


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/variants",
    response_model=GenerateVariantsResponse,
)
def generation_variants(
    slug: str,
    session_id: str,
    body: GenerateVariantsBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Generate AI variants and append them to the session's alternates pool.

    Returns the full pool for that kind so the inspector can refresh the rail
    in a single round-trip.
    """
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    if body.n < 1:
        raise HTTPException(status_code=400, detail="n must be >= 1")

    row = _load_session(supabase, client_id, session_id)
    if not _row_has_regenerated_content(row):
        raise HTTPException(
            status_code=400,
            detail="Choose an angle first — session has no generated content yet.",
        )
    chosen = get_chosen_angle(row)
    if not chosen:
        raise HTTPException(status_code=400, detail="No chosen angle on session")

    patterns = row.get("synthesized_patterns") if isinstance(row.get("synthesized_patterns"), dict) else {}
    client_row = _load_client_for_generation(supabase, client_id)

    hooks = [h for h in (row.get("hooks") or []) if isinstance(h, dict)]
    script = str(row.get("script") or "")
    cap = str(row.get("caption_body") or "")
    tags = [str(t) for t in (row.get("hashtags") or []) if isinstance(t, (str, int, float))]
    stories = [str(s) for s in (row.get("story_variants") or [])]
    raw_tb = row.get("text_blocks")
    cur_tb = [x for x in raw_tb if isinstance(x, dict)] if isinstance(raw_tb, list) else None
    raw_vs = row.get("visual_style")
    cur_vs = raw_vs if isinstance(raw_vs, dict) else None

    # Map our variant `kind` onto the existing regenerate `scope` vocabulary.
    # `cover` reuses `hooks` because the hook+cover share a generator today.
    scope_for_kind = {
        "hook": "hooks",
        "block": "text_blocks",
        "cover": "hooks",
        "caption": "caption",
    }[body.kind]

    raw_fk = str(row.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw_fk) or raw_fk or None
    selected_cta = row.get("selected_cta") if isinstance(row.get("selected_cta"), dict) else None

    pool = _read_alternates(row)
    requested_n = max(1, min(8, int(body.n)))

    if body.kind == "cover":
        try:
            options = run_cover_text_options(
                settings,
                client_row=client_row,
                chosen_angle=chosen,
                hooks=hooks,
                script=script,
                feedback=body.feedback,
                previous=[
                    str(x)
                    for x in (row.get("cover_text_options") or [])
                    if isinstance(x, (str, int, float))
                ],
                text_blocks=cur_tb,
            )
        except Exception as e:
            logger.exception("generation cover variants failed")
            raise HTTPException(status_code=502, detail=str(e)) from e

        for text in options[:requested_n]:
            _append_alternate(pool, body.kind, text)
        supabase.table("generation_sessions").update(
            {"alternates": pool, "updated_at": _now_iso()}
        ).eq("id", session_id).eq("client_id", client_id).execute()
        variants = [
            VariantOption.model_validate(x)
            for x in pool.get(body.kind, [])
            if isinstance(x, dict)
        ]
        return {
            "kind": body.kind,
            "element_id": body.element_id,
            "variants": variants,
        }

    for i in range(requested_n):
        feedback = (body.feedback or "").strip()
        # Slightly vary the instruction per call so the existing single-option
        # regenerate prompt is less likely to return the same text repeatedly.
        variant_feedback = (
            f"{feedback}; give me option {i + 1} of {requested_n}, materially different from the others"
            if feedback
            else f"give me option {i + 1} of {requested_n}, a materially different angle"
        )
        try:
            package = run_regenerate(
                settings,
                client_row=client_row,
                synthesized_patterns=patterns,
                chosen_angle=chosen,
                scope=scope_for_kind,
                feedback=variant_feedback,
                current_hooks=hooks,
                current_script=script,
                current_caption=cap,
                current_hashtags=tags,
                current_stories=stories,
                source_format_key=fk,
                current_text_blocks=cur_tb,
                current_visual_style=cur_vs,
                adapt_single_reference_reel=_session_adapts_single_reference_reel(row),
                selected_cta=selected_cta,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.exception("generation variants failed")
            raise HTTPException(status_code=502, detail=str(e)) from e

        text = _pick_text_for_kind(package, body.kind)
        if text:
            _append_alternate(pool, body.kind, text)

    supabase.table("generation_sessions").update(
        {"alternates": pool, "updated_at": _now_iso()}
    ).eq("id", session_id).eq("client_id", client_id).execute()

    variants = [
        VariantOption.model_validate(x) for x in pool.get(body.kind, []) if isinstance(x, dict)
    ]
    return {
        "kind": body.kind,
        "element_id": body.element_id,
        "variants": variants,
    }


@router.get(
    "/clients/{slug}/generate/sessions/{session_id}",
    response_model=GenerationSessionOut,
)
def generation_get_session(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if str(row.get("render_status") or "") == "rendering":
        try:
            recover_stale_video_render_jobs(get_settings())
            row = _load_session(supabase, client_id, session_id)
        except Exception:
            logger.debug("stale video_render sweep on session GET failed", exc_info=True)
        if str(row.get("render_status") or "") == "rendering" and not has_active_job(
            supabase,
            client_id=client_id,
            job_type="video_render",
            payload_match={"session_id": session_id},
        ):
            supabase.table("generation_sessions").update(
                {
                    "render_status": "failed",
                    "render_error": (
                        "Render state had no active background job (worker not running or job lost). "
                        "Start the worker and click Render again."
                    ),
                    "render_progress_pct": None,
                    "updated_at": _now_iso(),
                }
            ).eq("id", session_id).eq("client_id", client_id).execute()
            row = _load_session(supabase, client_id, session_id)
    row = persist_healed_session_video_spec_row(
        supabase, client_id=client_id, session_id=session_id, row=row
    )
    return _row_to_out(row)


@router.delete("/clients/{slug}/generate/sessions/{session_id}", status_code=204)
def generation_delete_session(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> None:
    _ = slug
    _ = _load_session(supabase, client_id, session_id)
    supabase.table("generation_sessions").delete().eq("id", session_id).eq(
        "client_id", client_id
    ).execute()


def _public_render_url(supabase_url: str, bucket: str, path: str) -> str:
    return f"{supabase_url.rstrip('/')}/storage/v1/object/public/{bucket}/{path}"


@router.post("/clients/{slug}/generate/sessions/{session_id}/generate-thumbnail")
def generation_generate_thumbnail(
    slug: str,
    session_id: str,
    body: GenerateThumbnailBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Generate a 9:16 reel cover thumbnail.

    Uses Freepik flux-2-turbo for the background + Pillow for text overlay.
    Backgrounds preserve their colour unless the request explicitly enables wash.

    Pass ``hook_text`` in the body to control which text appears on the cover.
    Falls back to the session's first hook, then chosen angle title.
    Returns ``{"thumbnail_url": "<public url>"}``.
    """
    _ = slug
    if not settings.freepik_api_key:
        raise HTTPException(status_code=503, detail="FREEPIK_API_KEY not configured")

    row = _load_session(supabase, client_id, session_id)

    # Resolve cover text: explicit override > first hook > angle title
    text = (body.hook_text or "").strip()
    angle_context = ""
    if not text:
        hooks: List[Any] = row.get("hooks") or []
        if hooks and isinstance(hooks[0], dict):
            text = str(hooks[0].get("text") or "").strip()

        angles: List[Any] = row.get("angles") or []
        idx = row.get("chosen_angle_index")
        try:
            chosen = angles[int(idx)] if idx is not None and 0 <= int(idx) < len(angles) else (angles[0] if angles else {})
            if isinstance(chosen, dict):
                angle_context = str(chosen.get("title") or "").strip()
                if not text:
                    text = angle_context
        except (TypeError, ValueError, IndexError):
            pass

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Session has no hooks or angles — pass hook_text in the request body.",
        )

    try:
        png = generate_thumbnail_freepik_pillow(
            settings.freepik_api_key,
            text,
            angle_context=angle_context,
            template_id=body.template_id,
            theme_id=body.theme_id,
            text_treatment=body.text_treatment,
            layout=body.layout,
            appearance=body.appearance,
            wash=body.wash,
        )
    except Exception as e:
        logger.exception("Thumbnail generation failed")
        raise HTTPException(status_code=502, detail=f"Thumbnail generation failed: {e}") from e

    path = f"{client_id}/thumb_{session_id}.png"
    try:
        supabase.storage.from_(RENDERS_BUCKET).upload(
            path,
            png,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e

    url = _public_render_url(settings.supabase_url, RENDERS_BUCKET, path)

    # Persist so the Media page can list covers without extra endpoints
    try:
        supabase.table("generation_sessions").update({"thumbnail_url": url}).eq("id", session_id).execute()
    except Exception:
        logger.warning("Could not persist thumbnail_url to generation_sessions — column may not exist yet")

    return {"thumbnail_url": url}


@router.post("/clients/{slug}/generate/sessions/{session_id}/compose-thumbnail")
def generation_compose_thumbnail(
    slug: str,
    session_id: str,
    body: ComposeThumbnailBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Compose a 9:16 reel cover from an existing client image + hook text.

    Alternative to ``/generate-thumbnail`` (which uses Freepik for the background).
    Reuses the same Pillow text overlay so visually it stays on-brand. The image
    is fetched from Supabase Storage via its public URL.
    """
    _ = slug
    row = _load_session(supabase, client_id, session_id)

    img_res = (
        supabase.table("client_images")
        .select("id, file_url")
        .eq("id", body.client_image_id.strip())
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not img_res.data:
        raise HTTPException(status_code=404, detail="Client image not found")
    file_url = str(img_res.data[0].get("file_url") or "").strip()
    if not file_url:
        raise HTTPException(status_code=400, detail="Image has no file_url")

    text = (body.hook_text or "").strip()
    if not text:
        hooks: List[Any] = row.get("hooks") or []
        if hooks and isinstance(hooks[0], dict):
            text = str(hooks[0].get("text") or "").strip()
    if not text:
        angles: List[Any] = row.get("angles") or []
        idx = row.get("chosen_angle_index")
        try:
            chosen = angles[int(idx)] if idx is not None and 0 <= int(idx) < len(angles) else (angles[0] if angles else {})
            if isinstance(chosen, dict):
                text = str(chosen.get("title") or "").strip()
        except (TypeError, ValueError, IndexError):
            pass
    if not text:
        raise HTTPException(
            status_code=400,
            detail="Session has no hooks or angles — pass hook_text in the request body.",
        )

    try:
        with httpx.Client(timeout=30) as client:
            r = client.get(file_url)
            r.raise_for_status()
            src_bytes = r.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch client image: {e}") from e

    try:
        png = compose_thumbnail_from_image(
            src_bytes,
            text,
            wash=body.wash,
            crop_y=body.crop_y,
            zoom=body.zoom,
            template_id=body.template_id,
            theme_id=body.theme_id,
            text_treatment=body.text_treatment,
            layout=body.layout,
            appearance=body.appearance,
        )
    except Exception as e:
        logger.exception("Thumbnail composition failed")
        raise HTTPException(status_code=502, detail=f"Thumbnail composition failed: {e}") from e

    path = f"{client_id}/thumb_{session_id}.png"
    try:
        supabase.storage.from_(RENDERS_BUCKET).upload(
            path,
            png,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e

    url = _public_render_url(settings.supabase_url, RENDERS_BUCKET, path)
    try:
        supabase.table("generation_sessions").update({"thumbnail_url": url}).eq("id", session_id).execute()
    except Exception:
        logger.warning("Could not persist thumbnail_url to generation_sessions")

    return {"thumbnail_url": url}
