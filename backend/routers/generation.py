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
    GenerationChooseAngleBody,
    GenerationFeedbackBody,
    GenerationRecommendFormatBody,
    GenerationRegenerateBody,
    GenerationSessionOut,
    GenerationStartBody,
    GenerateThumbnailBody,
    ComposeThumbnailBody,
)
from services.content_generation import (
    GENERATION_PROMPT_VERSION,
    ALLOWED_AUTO_IDEA_FORMATS,
    compact_analysis_for_prompt,
    angles_from_session_row,
    fetch_reel_analyses_for_generation,
    get_chosen_angle,
    merge_source_reference_into_patterns,
    run_adaptation_synthesis,
    run_auto_video_idea,
    run_angle_generation,
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
from services.reel_metrics import compute_niche_benchmarks, enrich_engagement_metrics

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


def _load_client_for_generation(supabase: Client, client_id: str) -> Dict[str, Any]:
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
    return row


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
        client_row = _load_client_for_generation(supabase, client_id)
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
            )
            if one.get("id"):
                analysis_ids.append(str(one["id"]))
            if one.get("reel_id"):
                reel_ids.append(str(one["reel_id"]))
            # Create / Remotion need a visual format key; url_adapt historically left this NULL.
            # When the user explicitly picked a target format, honour it; otherwise fall
            # back to the source reel's normalized format (legacy auto-detection).
            if user_target_fk:
                source_format_key = user_target_fk
            else:
                nf = str(one.get("normalized_format") or "").strip()
                ck = canonicalize_stored_format_key(nf) or nf
                if ck in ("text_overlay", "b_roll_reel", "carousel"):
                    source_format_key = ck
                elif ck == "talking_head":
                    source_format_key = "text_overlay"
                else:
                    source_format_key = "text_overlay"

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
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generation start failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    if len(angles) < 3:
        raise HTTPException(
            status_code=502,
            detail="Model returned too few angles; retry or adjust inputs.",
        )

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
        "feedback": None,
        "prompt_version": GENERATION_PROMPT_VERSION,
        "created_at": now,
        "updated_at": now,
    }
    if source_format_key:
        ck = canonicalize_stored_format_key(source_format_key)
        insert_row["source_format_key"] = ck or source_format_key.strip()
    if source_url:
        insert_row["source_url"] = source_url
    if source_idea:
        insert_row["source_idea"] = source_idea
    if st == "script_adapt" and body.source_script and str(body.source_script).strip():
        insert_row["source_script"] = str(body.source_script).strip()[:16_000]
    try:
        ins = supabase.table("generation_sessions").insert(insert_row).execute()
    except Exception as e:
        logger.exception("generation_sessions insert failed — run sql migrations?")
        raise HTTPException(
            status_code=503,
            detail="Database error (generation_sessions / phase8 columns?).",
        ) from e
    if not ins.data:
        raise HTTPException(status_code=500, detail="Insert failed")
    return _row_to_out(ins.data[0])


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

    raw_fk = str(row.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw_fk) or raw_fk or None
    try:
        package = run_content_package(
            settings,
            client_row=client_row,
            synthesized_patterns=patterns,
            chosen_angle=chosen,
            source_format_key=fk,
            adapt_single_reference_reel=_session_adapts_single_reference_reel(row),
        )
    except Exception as e:
        logger.exception("generation choose-angle failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    cover_options: List[str] = []
    try:
        cover_options = run_cover_text_options(
            settings,
            client_row=client_row,
            chosen_angle=chosen,
            hooks=package["hooks"],
            script=package["script"],
            text_blocks=package.get("text_blocks"),
        )
    except Exception:
        # Cover generation must never block content_ready — fall back to hooks in the UI.
        logger.warning("cover_text_options generation failed; leaving null", exc_info=True)

    now = _now_iso()
    patch = {
        "chosen_angle_index": body.angle_index,
        "hooks": package["hooks"],
        "script": package["script"],
        "caption_body": package["caption_body"],
        "hashtags": package["hashtags"],
        "story_variants": package["story_variants"],
        "text_blocks": package.get("text_blocks"),
        "cover_text_options": cover_options or None,
        "status": "content_ready",
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

    raw_fk = str(row.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw_fk) or raw_fk or None
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
            adapt_single_reference_reel=_session_adapts_single_reference_reel(row),
        )
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
    "/clients/{slug}/generate/sessions/{session_id}/approve",
    response_model=GenerationSessionOut,
)
def generation_approve(
    slug: str,
    session_id: str,
    body: GenerationFeedbackBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """DEPRECATED: the unified create screen no longer needs an explicit approve gate
    (rendering a video implicitly approves it). Endpoint kept for backwards-compat with
    legacy sessions / API consumers."""
    _ = slug
    _ = _load_session(supabase, client_id, session_id)
    now = _now_iso()
    patch: Dict[str, Any] = {"status": "approved", "updated_at": now}
    if body.feedback and body.feedback.strip():
        patch["feedback"] = body.feedback.strip()
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/reject",
    response_model=GenerationSessionOut,
)
def generation_reject(
    slug: str,
    session_id: str,
    body: GenerationFeedbackBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """DEPRECATED: the unified create screen replaces "reject" with "delete session".
    Endpoint kept for backwards-compat with legacy sessions / API consumers."""
    _ = slug
    _ = _load_session(supabase, client_id, session_id)
    now = _now_iso()
    patch: Dict[str, Any] = {"status": "rejected", "updated_at": now}
    if body.feedback and body.feedback.strip():
        patch["feedback"] = body.feedback.strip()
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


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

    Uses Freepik flux-2-turbo for the background + Pillow for text overlay,
    matching Conny's editorial style (soft washed-out photo + serif headline).

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
        png = compose_thumbnail_from_image(src_bytes, text, wash=body.wash)
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
