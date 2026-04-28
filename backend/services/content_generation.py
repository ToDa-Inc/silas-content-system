"""Outlier-driven content generation: pattern synthesis → angles → hooks/script/caption/stories."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Literal, Optional, Sequence

from core.config import Settings
from services.client_dna_compile import _context_texts_only
from services.format_classifier import canonicalize_stored_format_key
from services.openrouter import chat_json_completion, chat_text_completion
from services.reel_metrics import enrich_engagement_metrics

logger = logging.getLogger(__name__)

GENERATION_PROMPT_VERSION = "silas_gen_v7_2026_04_27"
COVER_PROMPT_VERSION = "silas_covers_v1_2026_04_21"

GermanPolishMode = Literal["none", "full", "script", "caption", "stories"]

_SYSTEM_JSON = (
    "You are Silas — a senior Instagram Reels strategist. "
    "Reply with a single valid JSON object only (no markdown fences, no commentary)."
)


def _talking_head_script_package_bullet(*, german_client: bool) -> str:
    """Silas talking-head script brief. Human-readable spec: docs/TALKING_HEAD_PROMPT.md — keep in sync."""
    de_extra = ""
    if german_client:
        de_extra = (
            "For OUTPUT LANGUAGE German: do not translate word-for-word from any English in the inputs — "
            "ADAPT so it feels originally written in German. Natural spoken German (DE/AT/CH professional); "
            "calm authority; slightly provocative where it fits; no fluff, no AI tone. "
            "Replace cultural references, English-thought phrasing, and anything that sounds translated.\n"
        )
    return (
        "\nTALKING_HEAD_SCRIPT (non-negotiable — Silas talking-head brief; see docs/TALKING_HEAD_PROMPT.md):\n"
        "- This reel is face-to-camera the whole time. The script is what the creator speaks aloud.\n"
        f"{de_extra}"
        "- Base voice, tone, philosophy, and ICP fit on CLIENT_CONTEXT (communication guideline + ICP). "
        "The viewer should feel the client is speaking directly to them.\n"
        "- Preserve what makes the angle perform: hook strength, emotional tension, the reframe (core insight), "
        "rhythm and pacing implied by PATTERNS_JSON / CHOSEN_ANGLE_JSON. When PATTERNS_JSON comes from a single "
        "source reel or pasted script, treat it as a blueprint: keep sequence and payoff; localize examples and language.\n"
        "- Slightly optimize for clarity and impact in the OUTPUT LANGUAGE; sharpen ICP identification; keep "
        "sentences concise and punchy; must sound natural when read aloud.\n"
        "- Duration: follow PATTERNS_JSON.format_insights (and NICHE_BENCHMARKS if present). "
        "Default ~45 seconds spoken only if format_insights is empty.\n"
        "- Markdown structure — use these exact ## headings, prose under each (no sub-headings):\n"
        "  ## Hook\n"
        "  ## Build-up\n"
        "  ## Reframe\n"
        "  ## Clarity\n"
        "  ## CTA\n"
        "  Sequence is Hook → Build-up → Reframe → Clarity → CTA (Build-up through Clarity carry tension → insight → usable clarity).\n"
        "- CTA: match the client's funnel per OFFER_DOCUMENTATION (e.g. clear comment-keyword instruction when a "
        "lead magnet is named); benefit specific to the ICP.\n"
        "- Before returning JSON, verify: (1) Sounds native in the OUTPUT LANGUAGE — not translated or generic. "
        "(2) Matches client voice and ICP from CLIENT_CONTEXT. (3) Would retain attention as well as the blueprint angle.\n"
    )


def _lang_instruction(language: str) -> str:
    low = (language or "").strip().lower()
    if low in ("de", "german", "deutsch"):
        return (
            "OUTPUT LANGUAGE: German (Deutsch). All user-facing copy must be natural, idiomatic German "
            "for the creator's audience (DE/AT/CH professional tone)."
        )
    return "OUTPUT LANGUAGE: English unless the client briefs explicitly require another language."


def _is_german_client(client_row: Dict[str, Any]) -> bool:
    low = str(client_row.get("language") or "").strip().lower()
    return low in ("de", "german", "deutsch")


_GERMANIZER_SCRIPT_SYSTEM = (
    "You are a native German editor for social Reel scripts. Output only the rewritten text — "
    "no preamble, no markdown fences, no explanations."
)

_GERMANIZER_CAPTION_TEXT_SYSTEM = (
    "You are a native German editor for Instagram caption copy. Output only the rewritten caption — "
    "no preamble, no markdown fences, no explanations."
)

_GERMANIZER_JSON_SYSTEM = (
    "You are a native German editor for Instagram captions and short story teaser lines. "
    "Reply with a single valid JSON object only (no markdown fences, no commentary)."
)


def _apply_german_natural_polish(
    settings: Settings,
    client_row: Dict[str, Any],
    package: Dict[str, Any],
    *,
    mode: GermanPolishMode = "full",
) -> Dict[str, Any]:
    """Second pass for DE clients. `mode` limits which fields get an extra LLM pass (saves cost on scoped regen)."""
    if not _is_german_client(client_row) or mode == "none":
        return package
    out = dict(package)

    if mode in ("full", "script"):
        script = str(out.get("script") or "").strip()
        if script:
            try:
                user = (
                    "Rewrite this German text so it sounds completely natural when spoken aloud — "
                    "fluent, human, not translated or AI-like.\n\n"
                    "Rules:\n"
                    "- Keep every ## markdown heading line exactly as-is; only rewrite the body under each section.\n"
                    "- No hyphen crutches or colon suspense openers; avoid stiff list structures.\n"
                    "- Use natural connectors (und, aber, doch, also, eben); keep punchy rhythm where the original had it.\n"
                    "- Preserve meaning, structure, and teaching content.\n\n"
                    "<german_text>\n"
                    + script[:95_000]
                    + "\n</german_text>"
                )
                polished = chat_text_completion(
                    settings.openrouter_api_key,
                    settings.openrouter_model,
                    system=_GERMANIZER_SCRIPT_SYSTEM,
                    user=user,
                    max_tokens=12_288,
                    temperature=0.35,
                )
                if polished.strip():
                    out["script"] = polished.strip()
            except Exception:
                logger.warning("German script polish failed; keeping original", exc_info=True)

    if mode == "caption":
        cap = str(out.get("caption_body") or "").strip()
        if cap:
            try:
                user = (
                    "Rewrite this German Instagram caption so it sounds natural and native — not AI or translated.\n\n"
                    "Rules:\n"
                    "- Preserve line breaks where they help readability.\n"
                    "- No hyphen crutches or colon suspense openers.\n\n"
                    "<caption>\n"
                    + cap[:20_000]
                    + "\n</caption>"
                )
                polished = chat_text_completion(
                    settings.openrouter_api_key,
                    settings.openrouter_model,
                    system=_GERMANIZER_CAPTION_TEXT_SYSTEM,
                    user=user,
                    max_tokens=4096,
                    temperature=0.35,
                )
                if polished.strip():
                    out["caption_body"] = polished.strip()
            except Exception:
                logger.warning("German caption polish failed; keeping original", exc_info=True)
        return out

    if mode == "stories":
        raw_stories = out.get("story_variants")
        stories: List[str] = []
        if isinstance(raw_stories, list):
            stories = [str(s).strip() for s in raw_stories if str(s).strip()][:5]
        if not stories:
            return out
        try:
            user = (
                "Polish these German IG Story teaser lines (short on-screen text).\n"
                'Output JSON only: {"story_variants": [string, ...]}.\n'
                "Keep the same count as input when possible.\n\n"
                "Rules:\n"
                "- Natural spoken German; no textbook tone.\n"
                "- No hyphen crutches or colon suspense openers.\n\n"
                "INPUT_JSON:\n"
                + json.dumps({"story_variants": stories[:3]}, ensure_ascii=False)[:8000]
            )
            data = chat_json_completion(
                settings.openrouter_api_key,
                settings.openrouter_model,
                system=_GERMANIZER_JSON_SYSTEM,
                user=user,
                max_tokens=2048,
                temperature=0.35,
            )
            sv = data.get("story_variants")
            if isinstance(sv, list) and sv:
                norm = _normalize_stories(sv)[:3]
                if norm:
                    out["story_variants"] = norm
        except Exception:
            logger.warning("German story polish failed; keeping original", exc_info=True)
        return out

    if mode == "full":
        cap = str(out.get("caption_body") or "").strip()
        raw_stories = out.get("story_variants")
        stories = []
        if isinstance(raw_stories, list):
            stories = [str(s).strip() for s in raw_stories if str(s).strip()][:5]
        if not cap and not stories:
            return out
        try:
            bundle = {
                "caption_body": cap,
                "story_variants": stories[:3] if stories else [],
            }
            user = (
                "You rewrite AI-generated German for Instagram: caption + short story teaser lines.\n"
                "Output JSON only: {\"caption_body\": string, \"story_variants\": [string, ...]}.\n"
                "Use 0–3 story lines; keep the same count as input when possible.\n\n"
                "Rules:\n"
                "- Natural native German; relatable, smooth; no textbook or translation tone.\n"
                "- No hyphen crutches or colon suspense openers.\n"
                "- Caption: preserve line breaks where they help readability.\n\n"
                "INPUT_JSON:\n"
                + json.dumps(bundle, ensure_ascii=False)[:40_000]
            )
            data = chat_json_completion(
                settings.openrouter_api_key,
                settings.openrouter_model,
                system=_GERMANIZER_JSON_SYSTEM,
                user=user,
                max_tokens=4096,
                temperature=0.35,
            )
            new_cap = str(data.get("caption_body") or "").strip()
            if new_cap:
                out["caption_body"] = new_cap
            sv = data.get("story_variants")
            if isinstance(sv, list) and sv:
                norm = _normalize_stories(sv)[:3]
                if norm:
                    out["story_variants"] = norm
        except Exception:
            logger.warning("German caption/story polish failed; keeping original", exc_info=True)

    return out


_CTA_TYPE_GUIDANCE = {
    "website": (
        "Drives traffic to a webpage (sales page, landing page, blog post). "
        "Caption should make the link feel like the natural next step; reference "
        "the link in the platform-native way (e.g. 'link in bio', 'tap the link below'). "
        "Do not paste raw URLs into the script."
    ),
    "newsletter": (
        "Drives email signups. Caption + on-screen CTA frame the VALUE of subscribing "
        "(what the reader gets) — not just 'subscribe'. Match the destination if it "
        "specifies a comment keyword for the lead magnet."
    ),
    "video": (
        "Sends viewers to another video on the same account. CTA explains why the "
        "next video is the logical continuation of THIS video's payoff."
    ),
    "lead_magnet": (
        "Free resource, usually delivered via comment keyword. On-screen CTA should "
        "show the keyword clearly; caption should tease the resource and tell the user "
        "to comment the keyword."
    ),
    "booking": (
        "Books a call / demo / consultation. Caption should qualify the right viewer "
        "and point them to the booking link in the native way for the platform."
    ),
    "other": (
        "Custom destination — follow the destination + traffic_goal fields literally."
    ),
}


def _format_selected_cta_block(selected_cta: Optional[Dict[str, Any]]) -> str:
    """Render the user-picked CTA as a strict prompt block.

    The block tells the LLM to adapt the caption final CTA, the script ``## CTA``
    section, ``text_blocks`` item 4 (visual reels), and the carousel final slide
    so they all point at the same destination + traffic goal. Returns ``""`` if
    no CTA was picked, so callers can keep the legacy OFFER_DOCUMENTATION path.
    """

    if not isinstance(selected_cta, dict):
        return ""
    label = str(selected_cta.get("label") or "").strip()
    if not label:
        return ""
    cta_type = str(selected_cta.get("type") or "other").strip().lower() or "other"
    destination = str(selected_cta.get("destination") or "").strip()
    traffic_goal = str(selected_cta.get("traffic_goal") or "").strip()
    instructions = str(selected_cta.get("instructions") or "").strip()
    type_guidance = _CTA_TYPE_GUIDANCE.get(cta_type, _CTA_TYPE_GUIDANCE["other"])
    lines = [
        "\n=== SELECTED_CTA (user picked this destination before generating — every CTA in this reel must serve it) ===",
        f"label: {label}",
        f"type: {cta_type}",
        f"destination: {destination or '(not specified)'}",
        f"traffic_goal: {traffic_goal or '(not specified)'}",
        f"type_guidance: {type_guidance}",
    ]
    if instructions:
        lines.append(f"client_instructions: {instructions}")
    lines.append(
        "Use this block instead of OFFER_DOCUMENTATION-driven CTA inference for: "
        "(a) the caption's final CTA, (b) the script ## CTA section, "
        "(c) text_blocks item 4 / final visual CTA, and "
        "(d) any carousel final-slide CTA. Keep wording native to the platform "
        "(no raw URLs in script narration). When destination is a URL, refer to it "
        "as the link in bio / link below / tap the link, not by spelling the URL out."
    )
    return "\n".join(lines)


def _format_carousel_template_block(selected_carousel_template: Optional[Dict[str, Any]]) -> str:
    if not isinstance(selected_carousel_template, dict):
        return ""
    name = str(selected_carousel_template.get("name") or "").strip()
    slides_raw = selected_carousel_template.get("slides")
    if not name or not isinstance(slides_raw, list):
        return ""
    slides: List[Dict[str, Any]] = []
    for raw in slides_raw:
        if isinstance(raw, dict):
            slides.append(raw)
    if not slides:
        return ""
    slides.sort(key=lambda s: int(s.get("idx") or 0))
    lines = [
        "\n=== CAROUSEL_TEMPLATE (visual/story reference, not a fixed slide count) ===",
        f"name: {name}",
    ]
    desc = str(selected_carousel_template.get("description") or "").strip()
    if desc:
        lines.append(f"description: {desc}")
    lines.append(
        "Reference images are visual references only. Generate NEW carousel slides; "
        "do not copy or reuse the original media image as final output. The number "
        "of reference slides does NOT determine the number of output slides."
    )
    for slide in slides[:10]:
        idx = int(slide.get("idx") or 0)
        role = str(slide.get("role") or "body").strip() or "body"
        label = str(slide.get("reference_label") or "").strip()
        instruction = str(slide.get("instruction") or "").strip()
        lines.append(
            f"- slide {idx + 1}: role={role}; reference={label or '(none)'}; "
            f"instruction={instruction or '(use role only)'}"
        )
    return "\n".join(lines)


def _pack_client_row_for_llm(
    client_row: Dict[str, Any],
    selected_cta: Optional[Dict[str, Any]] = None,
) -> str:
    dna = client_row.get("client_dna") if isinstance(client_row.get("client_dna"), dict) else {}
    gen_brief = str(dna.get("generation_brief") or "").strip()
    voice_brief = str(dna.get("voice_brief") or "").strip()
    analysis_brief = str(dna.get("analysis_brief") or "").strip()
    icp = client_row.get("icp") if isinstance(client_row.get("icp"), dict) else {}
    nc = client_row.get("niche_config") or []
    if not isinstance(nc, list):
        nc = []
    products = client_row.get("products")
    cc_texts = _context_texts_only(client_row.get("client_context"))
    offer = cc_texts.get("offer_documentation", "")
    parts = [
        f"CLIENT_NAME: {client_row.get('name', '')}",
        f"INSTAGRAM: @{client_row.get('instagram_handle', '') or ''}",
        f"LANGUAGE_CODE: {client_row.get('language', '')}",
        "\n=== GENERATION_BRIEF (hooks, angles, captions) ===\n" + (gen_brief or "(empty)"),
        "\n=== VOICE_BRIEF (how they speak — scripts must match) ===\n" + (voice_brief or "(empty)"),
        "\n=== ANALYSIS_BRIEF (audience calibration) ===\n" + (analysis_brief or "(empty)"),
        "\n=== ICP (JSON) ===\n" + json.dumps(icp, ensure_ascii=False, default=str)[:12_000],
        "\n=== NICHE_CONFIG (JSON) ===\n" + json.dumps(nc, ensure_ascii=False, default=str)[:12_000],
        "\n=== PRODUCTS (JSON) ===\n" + json.dumps(products, ensure_ascii=False, default=str)[:8000],
        "\n=== OFFER_DOCUMENTATION (from client brain) ===\n" + (offer[:20_000] if offer else "(empty)"),
    ]
    nb = client_row.get("_niche_benchmarks")
    if isinstance(nb, dict) and nb.get("reel_count", 0) > 0:
        parts.append(
            "\n=== NICHE_BENCHMARKS (from tracked competitors) ===\n"
            + json.dumps(nb, ensure_ascii=False, default=str)[:4000]
        )
    cta_block = _format_selected_cta_block(selected_cta)
    if cta_block:
        parts.append(cta_block)
    return "\n".join(parts)


def _caption_text_from_reel_meta(reel_meta: Optional[Dict[str, Any]], *, max_chars: int = 8000) -> str:
    """Scraped Instagram caption from a scraped_reels row (same cap as URL analyze ingest)."""
    if not isinstance(reel_meta, dict):
        return ""
    c = reel_meta.get("caption")
    if isinstance(c, dict):
        s = str(c.get("text") or "").strip()
    else:
        s = str(c or "").strip() if c is not None else ""
    return s[:max_chars] if s else ""


def build_source_reference_for_patterns(packed: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Factual template-reel fields from compact analysis for synthesized_patterns (no inference)."""
    if not isinstance(packed, dict):
        return None
    ref: Dict[str, Any] = {}
    sc = str(packed.get("source_caption") or "").strip()
    if sc:
        ref["source_caption"] = sc[:8000]
    for key in (
        "post_url",
        "why_it_worked",
        "caption_structure",
        "hook_type",
        "emotional_trigger",
        "content_angle",
        "full_text_excerpt",
    ):
        v = packed.get(key)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        ref[key] = v
    repl = packed.get("replicable_elements")
    if isinstance(repl, dict) and repl:
        ref["replicable_elements"] = repl
    sugg = packed.get("suggested_adaptations")
    if isinstance(sugg, list) and sugg:
        ref["suggested_adaptations"] = sugg
    return ref if ref else None


def merge_source_reference_into_patterns(
    patterns: Dict[str, Any], packed: Dict[str, Any]
) -> Dict[str, Any]:
    """Attach template evidence after LLM pattern synthesis so generation prompts retain captions."""
    out = dict(patterns) if isinstance(patterns, dict) else {}
    factual = build_source_reference_for_patterns(packed)
    if factual:
        out["source_reference"] = factual
    return out


def compact_analysis_for_prompt(
    row: Dict[str, Any],
    reel_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    fa = row.get("full_analysis_json") if isinstance(row.get("full_analysis_json"), dict) else {}
    full_text = str(fa.get("full_text") or "")[:3000]
    wt = fa.get("weighted_total")
    raw_scores = fa.get("raw_scores") if isinstance(fa.get("raw_scores"), dict) else {}
    out: Dict[str, Any] = {
        "analysis_id": str(row.get("id") or ""),
        "post_url": str(row.get("post_url") or ""),
        "owner_username": row.get("owner_username"),
        "total_score_db": row.get("total_score"),
        "replicability_rating": row.get("replicability_rating"),
        "weighted_total": wt,
        "raw_scores": {k: v for k, v in raw_scores.items() if v is not None},
        "hook_type": row.get("hook_type"),
        "emotional_trigger": row.get("emotional_trigger"),
        "content_angle": row.get("content_angle"),
        "caption_structure": row.get("caption_structure"),
        "why_it_worked": row.get("why_it_worked"),
        "replicable_elements": row.get("replicable_elements"),
        "suggested_adaptations": row.get("suggested_adaptations"),
        "full_text_excerpt": full_text,
    }
    cap_src = _caption_text_from_reel_meta(reel_meta)
    if cap_src:
        out["source_caption"] = cap_src
    if reel_meta:
        out["performance"] = {
            "views": reel_meta.get("views"),
            "likes": reel_meta.get("likes"),
            "comments": reel_meta.get("comments"),
            "saves": reel_meta.get("saves"),
            "shares": reel_meta.get("shares"),
            "engagement_rate": reel_meta.get("engagement_rate"),
            "save_rate": reel_meta.get("save_rate"),
            "share_rate": reel_meta.get("share_rate"),
            "video_duration": reel_meta.get("video_duration"),
            "posted_at": reel_meta.get("posted_at"),
        }
    return out


def fetch_reel_analyses_for_generation(
    supabase,
    *,
    client_id: str,
    source_type: str,
    source_analysis_ids: Optional[Sequence[str]],
    max_analyses: int,
) -> List[Dict[str, Any]]:
    sel = (
        "id, reel_id, post_url, owner_username, total_score, replicability_rating, hook_type, "
        "emotional_trigger, content_angle, caption_structure, why_it_worked, "
        "replicable_elements, suggested_adaptations, full_analysis_json"
    )
    q = supabase.table("reel_analyses").select(sel).eq("client_id", client_id)
    if source_type == "outlier":
        ids = [str(x).strip() for x in (source_analysis_ids or []) if str(x).strip()]
        if not ids:
            return []
        take = min(max_analyses, len(ids))
        q = q.in_("id", ids[:take])
        res = q.execute()
    else:
        res = q.order("total_score", desc=True).limit(max_analyses).execute()
    rows = list(res.data or [])
    reel_ids = [str(r.get("reel_id")) for r in rows if r.get("reel_id")]
    by_reel: Dict[str, Dict[str, Any]] = {}
    if reel_ids:
        try:
            rres = supabase.table("scraped_reels").select("*").in_("id", reel_ids).execute()
            for rr in rres.data or []:
                rid = str(rr.get("id") or "")
                if rid:
                    by_reel[rid] = enrich_engagement_metrics(dict(rr))
        except Exception:
            pass
    for r in rows:
        rid = str(r.get("reel_id") or "")
        r["_reel_meta"] = by_reel.get(rid)
    return rows


def run_pattern_synthesis(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    packed_analyses: List[Dict[str, Any]],
    extra_instruction: Optional[str],
) -> Dict[str, Any]:
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    user = (
        f"{lang}\n\n"
        "TASK: Synthesize recurring winning patterns from these competitor / viral reel analyses "
        "(Silas-scored). Output JSON with this exact shape:\n"
        "{\n"
        '  "hook_patterns": [{"name": string, "description": string, "example_from_data": string}],\n'
        '  "tension_mechanisms": [{"name": string, "description": string}],\n'
        '  "value_delivery_formats": [{"name": string, "description": string}],\n'
        '  "patterns_to_avoid": [string],\n'
        '  "format_insights": {"dominant_type": string, "optimal_duration": string, '
        '"engagement_drivers": string},\n'
        '  "performance_summary": string,\n'
        '  "one_paragraph_synthesis": string\n'
        "}\n\n"
        "Use 3–5 items per list where possible. Be concrete; quote mechanisms from the data.\n\n"
        "Each analysis may include `source_caption` (scraped Instagram caption under the post). When present, "
        "treat it as factual creator copy: hooks may live on-video while frameworks, examples, or CTAs may live "
        "primarily in the caption — synthesize patterns across both layers.\n\n"
        "Use the PERFORMANCE block in each analysis to weight your synthesis: patterns from "
        "high-engagement reels (e.g. save_rate above ~0.03 or engagement_rate above ~0.05 when present) "
        "matter more than patterns from low-engagement ones. Note which insights come from reels "
        "posted in roughly the last 30 days (see posted_at) vs older.\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:100_000]}\n\n"
        f"ANALYSES_JSON:\n{json.dumps(packed_analyses, ensure_ascii=False)[:120_000]}\n"
    )
    if extra_instruction and extra_instruction.strip():
        user += f"\n\nEXTRA_FOCUS:\n{extra_instruction.strip()[:2000]}\n"

    return chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=8192,
        temperature=0.25,
    )


def run_angle_generation(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    synthesized_patterns: Dict[str, Any],
    extra_instruction: Optional[str],
    adapt_single_reference_reel: bool = False,
    target_format_key: Optional[str] = None,
    selected_cta: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    target_block = _target_format_block(target_format_key) if adapt_single_reference_reel else ""
    if adapt_single_reference_reel:
        task = (
            "TASK: PATTERNS_JSON was built from ONE source reel (competitor URL or pasted script) we are adapting. "
            "Return exactly 5 angles in ORDER — order is mandatory:\n\n"
            "ANGLE 1 (array index 0) — FAITHFUL BLUEPRINT / direct adaptation:\n"
            "- This is the \"recreate this reel\" option: keep the same format class, hook mechanism, beat structure, "
            "pacing, topic arc, and payoff as the source implied by hook_patterns, tension_mechanisms, "
            "value_delivery_formats, and format_insights. Do not invent a different video concept.\n"
            "- Only swap what must change for the client: language, names, setting, and concrete examples so they "
            "fit GENERATION_BRIEF, VOICE_BRIEF, and ICP. The viewer should recognize it as the same recipe as the "
            "source.\n"
            "- Title should read like a direct adaptation (e.g. start with \"Blueprint:\" or \"Direct adaptation —\").\n\n"
            "ANGLES 2–5 (indices 1–4) — VARIANTS / same recipe, different execution:\n"
            "- Stay in the same format family and same \"job\" for the viewer as the source reel, but you MAY change "
            "the concrete situation, add a twist, or emphasize a different beat from PATTERNS_JSON while still "
            "clearly belonging to the same blueprint family.\n"
            "- Pull alternative situations from ICP / GENERATION_BRIEF where helpful; do not jump to unrelated topics "
            "or a different video format.\n\n"
        )
    else:
        task = (
            "TASK: Propose exactly 5 content ANGLES for this client — not generic topics. "
            "Each angle must name a concrete, recognizable situation for the ICP described in the briefs "
            "(e.g. workplace, client calls, leadership — whatever matches GENERATION_BRIEF and ICP).\n\n"
        )
    user = (
        f"{lang}\n\n"
        f"{target_block}"
        f"{task}"
        "Output JSON: {\"angles\": [ {...}, ... ]} with exactly 5 objects in the order above. Each object:\n"
        "{\n"
        '  "title": string (short label),\n'
        '  "situation": string (specific scenario),\n'
        '  "emotional_trigger": string,\n'
        '  "mechanism_note": string (why it could perform — tie to patterns; for angle 1 cite what you preserve from the source),\n'
        '  "draft_hook": string (one opening line in the output language),\n'
        '  "angle_role": string (optional; use "blueprint" for angle 1 only, "variant" for angles 2–5 when adapting one source reel)\n'
        "}\n\n"
        "If a SELECTED_CTA is present in CLIENT_CONTEXT, every angle should leave a clean lane "
        "for that destination + traffic_goal — pick situations where pointing at this CTA at the "
        "end will feel native, not bolted on.\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row, selected_cta)[:100_000]}\n\n"
        f"PATTERNS_JSON:\n{json.dumps(synthesized_patterns, ensure_ascii=False)[:60_000]}\n"
    )
    if extra_instruction and extra_instruction.strip():
        user += f"\n\nEXTRA_FOCUS:\n{extra_instruction.strip()[:2000]}\n"

    data = chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=8192,
        temperature=0.4,
    )
    angles = data.get("angles")
    if not isinstance(angles, list):
        return []
    out: List[Dict[str, Any]] = []
    for i, a in enumerate(angles[:5]):
        if not isinstance(a, dict):
            continue
        row = dict(a)
        if adapt_single_reference_reel:
            row["angle_role"] = "blueprint" if i == 0 else "variant"
        out.append(row)
    return out


def _normalize_hooks(raw: Any) -> List[Dict[str, Any]]:
    """5 flat alternative hooks. `tier` field is no longer required (kept optional for
    backwards-compat with old sessions still in DB), but new sessions return a flat list."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for h in raw:
        if not isinstance(h, dict):
            continue
        text = str(h.get("text") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append({"text": text})
        if len(out) >= 5:
            break
    return out


def _normalize_hashtags(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    tags: List[str] = []
    for x in raw[:8]:
        s = str(x).strip()
        if s and s not in tags:
            tags.append(s if s.startswith("#") else f"#{s.lstrip('#')}")
    return tags[:5]


def _normalize_stories(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    return [str(s).strip() for s in raw if str(s).strip()][:5]


_VISUAL_FORMAT_KEYS = frozenset({"text_overlay", "b_roll_reel", "carousel"})
# text_blocks are on-screen overlay copy for the MP4 render pipeline. Carousels
# render as N PNG slides instead, so they do NOT request text_blocks here.
_TEXT_BLOCK_FORMAT_KEYS = frozenset({"text_overlay", "b_roll_reel"})


def _wants_text_blocks(source_format_key: Optional[str]) -> bool:
    raw = (source_format_key or "").strip()
    key = canonicalize_stored_format_key(raw) or raw
    return key in _TEXT_BLOCK_FORMAT_KEYS


# Human-readable descriptions of each target format used to steer the LLM when
# the user wants to RECREATE a source reel in a DIFFERENT production format than
# the original. These are intentionally concrete (camera/edit + on-screen text
# behaviour) so the model rebuilds the FORMAT RECIPE rather than just relabeling.
_TARGET_FORMAT_DESCRIPTIONS: Dict[str, str] = {
    "text_overlay": (
        "Text-overlay reel: short B-roll or static visuals with bold on-screen text "
        "blocks that carry the message. No talking head. Pace driven by 3–4 punchy "
        "text beats + a CTA. The viewer reads + watches; the script is mostly the "
        "voice-over / silent narrative, while the text_blocks are the spine."
    ),
        "talking_head": (
            "Talking-head reel: a single person speaking directly to camera the whole time. "
            "No on-screen text blocks, no B-roll cutaways. Structure the script in clear "
            "spoken sections (## Hook / ## Insight / ## CTA) the creator will read aloud."
        ),
    "carousel": (
        "Instagram carousel (NOT a video): 3–10 swipeable PNG slides. Slide 1 is the "
        "cover/hook, last slide is the CTA. Each slide carries one short idea. The "
        "'script' here is really the slide-by-slide outline; visual rhythm is swipe-paced, "
        "not video-paced."
    ),
    "b_roll_reel": (
        "B-roll reel: a single looping stock/B-roll clip behind on-screen text blocks. "
        "No talking head, no scene changes. Tight 3–4 text beats + CTA, paced to the loop."
    ),
}


def _target_format_block(target_format_key: Optional[str]) -> str:
    """Render an instruction block telling the LLM the user wants to RE-FORMAT the
    source reel into a different production format. Empty string when no override."""
    raw = (target_format_key or "").strip()
    key = canonicalize_stored_format_key(raw) or raw
    desc = _TARGET_FORMAT_DESCRIPTIONS.get(key)
    if not desc:
        return ""
    return (
        "TARGET_FORMAT_OVERRIDE (non-negotiable):\n"
        f"The user wants to recreate the source reel as a `{key}`, even if the "
        "source uses a different production format. Preserve the CORE IDEA / viewer "
        "payoff from the source, but REBUILD the FORMAT RECIPE for this target:\n"
        f"  {desc}\n"
        "All format-specific fields (format_insights.dominant_type, hook_patterns, "
        "value_delivery_formats, beat structure) must describe the TARGET format, "
        "not the source's original format.\n\n"
    )


def _normalize_text_blocks(raw: Any) -> Optional[List[Dict[str, Any]]]:
    if not isinstance(raw, list):
        return None
    out: List[Dict[str, Any]] = []
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:60]
        if not text:
            continue
        out.append({"text": text, "isCTA": bool(item.get("isCTA"))})
    return out if out else None


_VALID_VIDEO_TEMPLATES = frozenset(
    {"bottom-card", "centered-pop", "top-banner", "capcut-highlight", "stacked-cards"}
)
_VALID_VIDEO_THEMES = frozenset({"bold-modern", "editorial", "casual-hand", "clean-minimal"})
_VALID_BLOCK_ANIMS = frozenset({"pop", "fade", "slide-up", "none"})


def _normalize_visual_style(
    raw: Any,
    *,
    source_format_key: Optional[str],
    client_row: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """LLM-suggested template/theme/per-block animation; timing still comes from video_spec_timing."""
    from services.video_spec_timing import template_id_for_format_key

    data = raw if isinstance(raw, dict) else {}
    fk = canonicalize_stored_format_key(source_format_key or "") or (source_format_key or "").strip()
    default_tpl = template_id_for_format_key(fk, source_type="")

    tid = str(data.get("templateId") or "").strip()
    if tid not in _VALID_VIDEO_TEMPLATES:
        tid = default_tpl

    thid = str(data.get("themeId") or "").strip()
    if thid not in _VALID_VIDEO_THEMES:
        bt = client_row.get("brand_theme") if isinstance(client_row.get("brand_theme"), dict) else {}
        cand = str(bt.get("defaultThemeId") or "").strip()
        thid = cand if cand in _VALID_VIDEO_THEMES else "bold-modern"

    block_anims: Optional[List[str]] = None
    raw_anims = data.get("blockAnimations")
    if isinstance(raw_anims, list) and raw_anims:
        block_anims = []
        for x in raw_anims[:12]:
            a = str(x or "").strip()
            block_anims.append(a if a in _VALID_BLOCK_ANIMS else "fade")

    # Optional: LLM may suggest a starting layout. Bounds mirror VideoSpecLayout
    # — silently snap out-of-range values so a hallucinated number can't break the spec.
    layout: Optional[Dict[str, Any]] = None
    raw_layout = data.get("layout")
    if isinstance(raw_layout, dict):
        def _bounded(key: str, default: float, lo: float, hi: float) -> float:
            try:
                v = float(raw_layout.get(key, default))
            except (TypeError, ValueError):
                return default
            return max(lo, min(hi, v))

        ta = str(raw_layout.get("textAlign") or "center").strip().lower()
        if ta not in ("left", "center", "right"):
            ta = "center"
        sg = str(raw_layout.get("stackGrowth") or "up").strip().lower()
        if sg not in ("up", "down"):
            sg = "up"

        layout = {
            "verticalOffset": _bounded("verticalOffset", 0.0, -0.2, 0.2),
            "scale": _bounded("scale", 1.0, 0.7, 1.3),
            "sidePadding": _bounded("sidePadding", 0.05, 0.02, 0.12),
            "textAlign": ta,
            "stackGap": _bounded("stackGap", 0.008, 0.0, 0.06),
            "stackGrowth": sg,
        }

    return {"templateId": tid, "themeId": thid, "blockAnimations": block_anims, "layout": layout}


# ── Cover text generator ────────────────────────────────────────────────────────
# Produces 5–8 short, scroll-stopping cover headlines for the 9:16 reel cover PNG.
# Independent from `run_content_package`: own LLM call, own temperature, own retry.
# Persisted on the session as `cover_text_options` (see migration phase19).

_SYSTEM_COVER_JSON = (
    "You are an elite-level direct-response copywriter for Instagram reel covers "
    "(thumbnail/title text). Reply with a single valid JSON object only "
    "(no markdown fences, no commentary)."
)

# Broad emoji range — strict enough to reject decoration on covers.
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"   # symbols & pictographs, supplemental, etc.
    "\U00002600-\U000027BF"   # misc symbols + dingbats
    "\U0001F000-\U0001F02F"   # mahjong/dominoes
    "\U0001F0A0-\U0001F0FF"   # playing cards
    "\u2190-\u21FF"           # arrows (↓ ← → etc. — banned on covers, allowed on tb CTAs)
    "]"
)


def _extract_script_summary(script: str, max_chars: int = 600) -> str:
    """Pick the strongest beats from the script for cover-prompt context.

    Covers ride on the reel's promise + payoff, not the line-by-line teaching. So we
    prefer ``## Hook`` and ``## Conclusion`` if present (the script structure that
    `run_content_package` instructs the model to use). Falls back to the first
    ~max_chars of the script body.
    """
    s = (script or "").strip()
    if not s:
        return ""
    parts: List[str] = []
    for heading in ("## Hook", "## Conclusion"):
        idx = s.find(heading)
        if idx == -1:
            continue
        body = s[idx + len(heading):]
        nxt = body.find("\n## ")
        body = body[:nxt] if nxt != -1 else body
        body = body.strip()
        if body:
            parts.append(f"{heading}\n{body}")
    joined = "\n\n".join(parts) if parts else s
    return joined[:max_chars].strip()


def _extract_text_block_seeds(
    text_blocks: Optional[Sequence[Dict[str, Any]]],
    *,
    max_items: int = 3,
    max_words: int = 12,
) -> List[str]:
    """Pull non-CTA on-screen overlays as extra cover-prompt context.

    The first overlay in a `text_overlay`/`b_roll_reel` package is usually a punchy,
    cover-quality line (e.g. "Kompetent, aber im Meeting unsichtbar?"). Feeding it
    to the cover model as inspiration — separately from the spoken hooks — lifts
    the floor of generated covers without coupling the two systems.

    - Drops CTA blocks (those are caption-push / comment-keyword lines, not covers).
    - Strips emojis (covers ban them; we don't want the model copying decoration).
    - Drops anything longer than ``max_words`` words (overlays can be long beats).
    - Returns up to ``max_items`` distinct seeds, preserving order.
    """
    if not text_blocks:
        return []
    seen: set[str] = set()
    out: List[str] = []
    for tb in text_blocks:
        if not isinstance(tb, dict) or tb.get("isCTA"):
            continue
        text = str(tb.get("text") or "").strip()
        if not text:
            continue
        cleaned = _EMOJI_RE.sub("", text).strip()
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        if not cleaned or len(re.findall(r"\w+", cleaned)) > max_words:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= max_items:
            break
    return out


def _normalize_cover_options(raw: Any, *, hooks: List[Dict[str, Any]]) -> List[str]:
    """Enforce the cover prompt's hard rules deterministically.

    Drops anything that violates: ≤10 words, ≤2 lines, no emojis, not a substring
    of any hook (catches the "shortened hook" failure mode), distinct openers
    (≤3 leading words shared with another kept option).
    """
    if not isinstance(raw, list):
        return []

    hook_texts_lc = [
        str(h.get("text") or "").strip().lower()
        for h in hooks
        if isinstance(h, dict) and str(h.get("text") or "").strip()
    ]

    def _word_key(s: str, n: int) -> str:
        return " ".join(re.findall(r"\w+", s.lower())[:n])

    seen_norm: set[str] = set()
    seen_openers: set[str] = set()
    out: List[str] = []
    for item in raw:
        text = str(item or "").strip()
        if not text:
            continue
        if _EMOJI_RE.search(text):
            continue
        if text.count("\n") > 1:
            continue
        if len(re.findall(r"\w+", text)) > 10:
            continue
        norm = re.sub(r"[\s\W]+", " ", text.lower()).strip()
        if not norm or norm in seen_norm:
            continue
        if any(norm and norm in h for h in hook_texts_lc):
            continue
        opener = _word_key(text, 4)
        if opener and opener in seen_openers:
            continue
        seen_norm.add(norm)
        if opener:
            seen_openers.add(opener)
        out.append(text)
        if len(out) >= 8:
            break
    return out


def _build_cover_user_prompt(
    *,
    client_row: Dict[str, Any],
    chosen_angle: Dict[str, Any],
    hooks: List[Dict[str, Any]],
    script: Optional[str],
    feedback: Optional[str],
    previous: Optional[List[str]],
    text_blocks: Optional[Sequence[Dict[str, Any]]] = None,
) -> str:
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    dna = client_row.get("client_dna") if isinstance(client_row.get("client_dna"), dict) else {}
    gen_brief = str(dna.get("generation_brief") or "").strip()
    voice_brief = str(dna.get("voice_brief") or "").strip()
    if not gen_brief:
        icp = client_row.get("icp") if isinstance(client_row.get("icp"), dict) else {}
        gen_brief = json.dumps(icp, ensure_ascii=False, default=str)[:4000] if icp else "(no ICP brief on file)"

    hooks_block = "\n".join(
        f"- {str(h.get('text') or '').strip()}"
        for h in hooks[:5]
        if isinstance(h, dict) and str(h.get("text") or "").strip()
    ) or "- (no hooks yet — derive purely from the chosen angle)"

    tb_seeds = _extract_text_block_seeds(text_blocks)
    tb_block = (
        "\n".join(f"- {seed}" for seed in tb_seeds)
        if tb_seeds
        else "- (none for this format)"
    )

    script_summary = _extract_script_summary(str(script or ""))
    if not script_summary:
        script_summary = str(chosen_angle.get("mechanism_note") or "").strip() or "(no script yet)"

    user = (
        f"{lang}\n\n"
        "You are an elite-level direct response copywriter specialized in high-converting\n"
        "Instagram cover headlines (thumbnail/title texts) for Reels.\n\n"
        f"Your task is to create short, scroll-stopping cover texts in the voice of "
        f"{client_row.get('name', 'the creator')}.\n\n"
        "OBJECTIVE — the cover text must:\n"
        "- stop the scroll instantly\n"
        "- be understood in under 1 second\n"
        "- create curiosity or emotional tension\n"
        "- feel highly relevant to one specific person\n"
        "- make people want to click the Reel\n\n"
        "CONTEXT INPUT:\n"
        "Hooks of the Reel (the same reel has these alternative opening lines — the cover\n"
        "must work for ANY of them and may NOT paraphrase, prefix, or shorten any of them):\n"
        f"{hooks_block}\n\n"
        "IN-VIDEO OVERLAY SEEDS (short on-screen text the editor already approved for this\n"
        "reel — useful as tone/length reference; do NOT copy them verbatim and do NOT paste\n"
        "their emojis. Treat them as inspiration for cover-style brevity and tension):\n"
        f"{tb_block}\n\n"
        "Topic (chosen angle):\n"
        f"- Title: {str(chosen_angle.get('title') or '').strip()}\n"
        f"- Situation: {str(chosen_angle.get('situation') or '').strip()}\n"
        f"- Emotional trigger: {str(chosen_angle.get('emotional_trigger') or '').strip()}\n\n"
        "What the reel actually delivers (payoff for the viewer, not a beat-by-beat summary):\n"
        f"{script_summary}\n\n"
        "Target Audience (ICP):\n"
        f"{gen_brief[:6000]}\n\n"
        f"CLIENT_VOICE_BRIEF (match this voice):\n{voice_brief[:4000] or '(none on file)'}\n\n"
        "CORE PRINCIPLE:\n"
        "The cover text is NOT the hook. It is a distilled, punchy, emotionally loaded\n"
        "headline — simpler, faster, more direct than the hook; built for scanning.\n\n"
        "STYLE & TONE:\n"
        "- Clear, direct, grounded.\n"
        "- Slightly provocative, but real.\n"
        "- No fluff, no buzzwords. Sounds like truth, not marketing.\n"
        "- Emotionally precise.\n\n"
        "FORMAT RULES (HARD):\n"
        "- Max 3–8 words per line, max 2 lines, ≤10 words total per option.\n"
        "- No full sentences required. No emojis. Minimal punctuation.\n\n"
        "PATTERNS TO USE (not exhaustive):\n"
        "- \"If you …\", \"Why you …\", \"The moment you …\",\n"
        "- \"The problem isn't …\", \"You think … but …\", \"This is where you lose …\".\n\n"
        "PSYCHOLOGICAL TRIGGERS: feeling overlooked, not being taken seriously, inner\n"
        "conflict, unfair dynamics, self-doubt, hidden truth.\n\n"
        "AVOID: generic phrases, empty motivation, long explanations, complicated wording.\n\n"
        "VARIATION (HARD):\n"
        "- Generate exactly 8 options.\n"
        "- Each takes a different angle and triggers a different emotional response.\n"
        "- No two options may share more than 3 leading words.\n"
        "- No option may be a paraphrase, prefix, or shortened form of any hook above.\n\n"
        "FINAL CHECK (apply to every option before returning):\n"
        "\"Would I instantly understand this — and feel personally called out?\" If not, rewrite.\n\n"
        'OUTPUT (HARD): Return exactly this JSON shape, nothing else:\n'
        '{"covers": [string, string, string, string, string, string, string, string]}\n'
    )
    if previous:
        user += (
            "\nPREVIOUS_OPTIONS (do not repeat these verbatim — produce fresh ones):\n"
            + json.dumps(previous, ensure_ascii=False)[:3000]
            + "\n"
        )
    if feedback and feedback.strip():
        user += f"\nFEEDBACK_FROM_HUMAN:\n{feedback.strip()[:2000]}\n"
    return user


def run_cover_text_options(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    chosen_angle: Dict[str, Any],
    hooks: List[Dict[str, Any]],
    script: Optional[str] = None,
    feedback: Optional[str] = None,
    previous: Optional[List[str]] = None,
    text_blocks: Optional[Sequence[Dict[str, Any]]] = None,
) -> List[str]:
    """Generate 5–8 normalized cover headlines for the chosen angle.

    Single LLM call at temperature 0.7. If fewer than 5 options survive the
    normalizer, retries once at 0.85 with explicit feedback. Returns whatever
    survives (may be < 8); never raises on model output — only raises on
    transport / config errors from `chat_json_completion`.
    """
    user = _build_cover_user_prompt(
        client_row=client_row,
        chosen_angle=chosen_angle,
        hooks=hooks,
        script=script,
        feedback=feedback,
        previous=previous,
        text_blocks=text_blocks,
    )
    data = chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_COVER_JSON,
        user=user,
        max_tokens=1024,
        temperature=0.7,
    )
    options = _normalize_cover_options(data.get("covers"), hooks=hooks)
    if len(options) >= 5:
        return options

    retry_user = user + (
        "\n\nPREVIOUS_ATTEMPT_FAILED: too many options were duplicates, hook-paraphrases, "
        "or violated the format rules. Generate 8 fresh, more varied options that pass "
        "every HARD rule above.\n"
    )
    try:
        retry_data = chat_json_completion(
            settings.openrouter_api_key,
            settings.openrouter_model,
            system=_SYSTEM_COVER_JSON,
            user=retry_user,
            max_tokens=1024,
            temperature=0.85,
        )
        retry_options = _normalize_cover_options(retry_data.get("covers"), hooks=hooks)
        if len(retry_options) > len(options):
            return retry_options
    except Exception:
        logger.warning("cover options retry failed; returning best-effort first attempt", exc_info=True)
    return options


def run_content_package(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    synthesized_patterns: Dict[str, Any],
    chosen_angle: Dict[str, Any],
    feedback: Optional[str] = None,
    previous: Optional[Dict[str, Any]] = None,
    source_format_key: Optional[str] = None,
    german_polish: GermanPolishMode = "full",
    adapt_single_reference_reel: bool = False,
    selected_cta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    prev_note = ""
    if previous:
        prev_note = (
            "\n\nPREVIOUS_VERSION (revise if feedback says so; otherwise improve coherence):\n"
            + json.dumps(previous, ensure_ascii=False)[:40_000]
        )
    fb = f"\n\nFEEDBACK_FROM_HUMAN:\n{feedback.strip()[:4000]}\n" if feedback and feedback.strip() else ""
    json_shape = (
        "{\n"
        '  "hooks": [{"text": string}],\n'
        '  "script": string,\n'
        '  "caption_body": string,\n'
        '  "hashtags": [string]'
    )
    if _wants_text_blocks(source_format_key):
        json_shape += (
            ',\n  "text_blocks": [{"text": string, "isCTA": boolean}],\n'
            '  "visual_style": {\n'
            '    "templateId": "bottom-card" | "centered-pop" | "top-banner" | "capcut-highlight" | "stacked-cards",\n'
            '    "themeId": "bold-modern" | "editorial" | "casual-hand" | "clean-minimal",\n'
            '    "blockAnimations": ["pop"|"fade"|"slide-up"|"none", ...],\n'
            '    "layout": { "verticalOffset": number, "scale": number, "sidePadding": number, '
            '"stackGrowth": "up" | "down" (stacked-cards only, optional) }\n'
            "  }"
        )
    json_shape += "\n}\n"
    tb_rules = ""
    if _wants_text_blocks(source_format_key):
        tb_rules = (
            "\ntext_blocks (on-screen overlays inside the reel — NOT the talking-head script):\n"
            "These are the only words the viewer sees on screen. The renderer plays them in\n"
            "order, ~2.5s each, on top of the visual. Treat them as a tight 4-beat overlay\n"
            "for the SAME reel — one cohesive scroll-stopper, not 4 alternative posts.\n"
            "\n"
            "STRUCTURE (HARD):\n"
            "- Exactly 4 items.\n"
            "- Item 1 = HOOK beat: the pattern interrupt / curiosity-opener. 1 line.\n"
            "- Items 2–3 = SUBLINE beats: deepen the tension or name the hidden truth.\n"
            "  Do NOT explain or resolve — keep the loop open.\n"
            "- Item 4 = CTA: isCTA=true. Pushes the viewer to the next surface.\n"
            "- Max 7 words per item. No full sentences required.\n"
            "- Emojis only where they carry meaning (❌ ✅ 🔥 👇 ↓). No decoration.\n"
            "\n"
            "VOICE & TRIGGERS (CHOSEN_ANGLE_JSON.emotional_trigger anchors this):\n"
            "- ICP-internal-thought voice. The viewer must think \"that is exactly me\".\n"
            "- Pattern-interrupt openers: \"The reason you …\", \"You think it's X — but it's Y\",\n"
            "  \"No one tells you this, but …\", \"This is where you lose …\", \"The moment you …\".\n"
            "- Psychological triggers to draw from: self-doubt, feeling overlooked, hidden\n"
            "  power dynamics, identity conflict (competent but silent), unfair dynamics.\n"
            "- Slightly provocative, never manipulative. Truth > comfort. No buzzwords.\n"
            "- Derive content from CHOSEN_ANGLE_JSON.situation + emotional_trigger; do NOT\n"
            "  summarize the script line by line.\n"
            "\n"
            "CTA (item 4) — anchor the visual CTA to the chosen destination:\n"
            "- If a SELECTED_CTA block is present in CLIENT_CONTEXT, use it as the source\n"
            "  of truth. Adapt phrasing to the type:\n"
            "    • website → caption / link push, e.g. \"Der Plan ist verlinkt ↓\",\n"
            "      \"Link in der Bio ↓\". Never paste raw URLs.\n"
            "    • newsletter → frame the value of subscribing in 1 line, e.g.\n"
            "      \"Hol dir den Brief ↓\". If destination is a comment keyword, use it.\n"
            "    • lead_magnet → comment-keyword CTA in the output language, e.g.\n"
            "      \"👇 Schreib 'KEYWORD' für …\".\n"
            "    • video → tease the next video as the natural next step, e.g.\n"
            "      \"Teil 2 wartet auf dich ↓\".\n"
            "    • booking → push toward the booking link, e.g.\n"
            "      \"Termin im Link ↓\".\n"
            "    • other → follow destination + traffic_goal literally.\n"
            "- If no SELECTED_CTA is present, fall back to OFFER_DOCUMENTATION:\n"
            "  named lead-magnet keyword → comment-keyword CTA; otherwise caption-push CTA\n"
            "  e.g. \"Mehr dazu in der Caption ↓\".\n"
            "- Never generic \"read more\" / \"swipe up\" / marketing-speak.\n"
            "\n"
            "FINAL CHECK before returning text_blocks:\n"
            "\"Would this stop the scroll for ONE specific person in the ICP?\" If not, rewrite.\n"
            "\n"
            "visual_style (layout + motion for the on-screen reel preview):\n"
            "- templateId: pick the layout that fits PATTERNS_JSON.format_insights / the angle. "
            "b_roll_reel → usually bottom-card; dense text-overlay / punchy beats → centered-pop or capcut-highlight; "
            "multi-line stacked captions (IG story style) → stacked-cards; "
            "face-cam + lower-third feel → top-banner.\n"
            "- themeId: match emotional tone to CHOSEN_ANGLE_JSON (bold-modern = high-contrast; editorial = refined; "
            "casual-hand = handwritten vibe; clean-minimal = glassy/modern).\n"
            "- blockAnimations: exactly one entry per text_blocks item (same order). "
            "Use pop for the strongest beat or CTA; fade/slide-up for supports; none only if the beat is ultra soft.\n"
            "- layout: leave as defaults (verticalOffset 0, scale 1, sidePadding 0.05, textAlign center, stackGap 0.008, stackGrowth up) "
            "UNLESS the chosen template needs it. "
            "Only nudge verticalOffset (-0.2..0.2 = up..down as fraction of canvas) if face-cam framing or product reveal "
            "should reserve the opposite side; only bump scale (0.7..1.3) for ultra-short hooks (<3 words → 1.15) or long "
            "subline beats (>5 words → 0.85); sidePadding (0.02..0.12) is for visual breathing room only. "
            "textAlign left|center|right applies to every template. stackGap 0..0.06 (fraction of canvas height) only affects stacked-cards spacing between cards. "
            "stackGrowth stacked-cards only: \"down\" = prefer first line fixed while beats add (use with Pin Top); \"up\" = hug bottom safe area (earlier lines shift up as beats add). Pin always chooses top/middle/bottom placement.\n"
        )
    adapt_block = ""
    if adapt_single_reference_reel:
        adapt_block = (
            "\nREFERENCE_REEL_ADAPTATION (non-negotiable):\n"
            "PATTERNS_JSON comes from a single source reel or pasted script. Treat it as a blueprint of THAT video, not a "
            "generic style guide.\n"
            "- Keep the same format class and beat structure implied by format_insights and hook_patterns "
            "(e.g. text-on-B-roll cadence vs talking-head sections). Do not switch to a different production "
            "format unless the patterns clearly describe that format.\n"
            "- Preserve the core idea or payoff the viewer gets from the source reel; replace settings, "
            "examples, names, and language so everything fits this client's ICP and CLIENT_CONTEXT.\n"
            "- Hooks, script, caption, and text_blocks must all feel like the same adapted reel, not a new "
            "unrelated concept.\n\n"
        )
    ref_note = ""
    if adapt_single_reference_reel and isinstance(synthesized_patterns, dict):
        sr0 = synthesized_patterns.get("source_reference")
        if isinstance(sr0, dict) and str(sr0.get("source_caption") or "").strip():
            ref_note = (
                "\nSOURCE_REFERENCE: PATTERNS_JSON includes `source_reference` with the scraped template caption "
                "and stored analysis excerpts. The blueprint is the combined on-reel content plus caption — preserve "
                "the same viewer payoff and information depth when adapting.\n"
            )
    caption_src_tail = ""
    if isinstance(synthesized_patterns, dict):
        sr1 = synthesized_patterns.get("source_reference")
        if isinstance(sr1, dict) and str(sr1.get("source_caption") or "").strip():
            caption_src_tail = (
                " When PATTERNS_JSON.source_reference.source_caption is present, ground caption_body in that text "
                "and in source_reference fields (why_it_worked, caption_structure, replicable_elements, "
                "suggested_adaptations): preserve the strategic role the original caption played (e.g. expanded "
                "teaching, examples, framework, CTA style) while rewriting fully for this client's ICP, language, "
                "voice, and OFFER_DOCUMENTATION. Do not copy phrasing. Do not add facts, numbers, promises, or "
                "specifics unless they appear in source_reference, CLIENT_CONTEXT, CHOSEN_ANGLE_JSON, or the script "
                "you generate for this package."
            )
    blueprint_note = ""
    if adapt_single_reference_reel and str(chosen_angle.get("angle_role") or "").strip().lower() == "blueprint":
        blueprint_note = (
            "\nBLUEPRINT_ANGLE: CHOSEN_ANGLE_JSON is the faithful-remake slot. Maximize fidelity to the source "
            "reel's structure, hook type, narrative arc, tension → payoff, and CTA mechanism in PATTERNS_JSON. "
            "Do not drift to a different topic or format; only localize and ICP-fit the same blueprint.\n"
        )
    fk = canonicalize_stored_format_key(source_format_key or "") or (source_format_key or "").strip()
    is_talking_head = fk == "talking_head"
    if is_talking_head:
        script_bullet = _talking_head_script_package_bullet(german_client=_is_german_client(client_row))
    else:
        script_bullet = (
            "- script: Use the optimal format and duration implied by PATTERNS_JSON.format_insights "
            "(and NICHE_BENCHMARKS if present). If format_insights suggests talking-head ~30s, write ~30s; "
            "if text-overlay, write overlay copy. Default to ~45 second talking head only if format_insights is empty. "
            "Use markdown with headings: "
            "## Hook, ## Situation, ## Insight 1, ## Insight 2, ## Insight 3, ## Conclusion, ## CTA.\n"
        )
    if is_talking_head:
        hard_script_rules = (
            "HARD RULES FOR THE SPOKEN SCRIPT (non-negotiable):\n"
            "1. ## Reframe and ## Clarity together MUST include at least one sentence the viewer can say out loud "
            "in a real situation tomorrow. Not an explanation of a technique — the actual words. "
            "If those sections only explain a concept without giving a usable sentence, it fails.\n"
            "2. Whenever a method or framework is named (e.g. WWW Method, 3-step feedback, any "
            "named tool), you MUST show it being used in one concrete example sentence. "
            "\"I noticed X, it affects me by Y, I want Z\" — that level of specificity. "
            "Naming the method without demonstrating it in a real sentence is not allowed.\n"
            "3. ## Build-up through ## Clarity MUST contain at least one of these three tension patterns:\n"
            "   a) WRONG-TO-RIGHT: Show the common wrong reaction first, then the better one.\n"
            "   b) HIDDEN COST: Name what staying in the current pattern actually costs the viewer "
            "(\"you lose the project lead, not just the moment\").\n"
            "   c) COUNTERINTUITIVE REFRAME: Challenge what the viewer currently believes "
            "(\"The problem isn't that you can't speak up — it's that you think you need confidence first\").\n"
            "   Pick whichever fits the angle best. At least one must appear.\n"
            "4. ## Clarity must reference the specific scenario from THIS script. "
            "Generic motivational lines that could end any video are not acceptable.\n\n"
        )
    else:
        hard_script_rules = (
            "HARD RULES FOR SCRIPT INSIGHTS (non-negotiable):\n"
            "1. Every insight MUST include at least one sentence the viewer can say out loud "
            "in a real situation tomorrow. Not an explanation of a technique — the actual words. "
            "If an insight only explains a concept without giving a usable sentence, it fails.\n"
            "2. Whenever a method or framework is named (e.g. WWW Method, 3-step feedback, any "
            "named tool), you MUST show it being used in one concrete example sentence. "
            "\"I noticed X, it affects me by Y, I want Z\" — that level of specificity. "
            "Naming the method without demonstrating it in a real sentence is not allowed.\n"
            "3. The script body MUST contain at least one of these three tension patterns:\n"
            "   a) WRONG-TO-RIGHT: Show the common wrong reaction first, then the better one.\n"
            "   b) HIDDEN COST: Name what staying in the current pattern actually costs the viewer "
            "(\"you lose the project lead, not just the moment\").\n"
            "   c) COUNTERINTUITIVE REFRAME: Challenge what the viewer currently believes "
            "(\"The problem isn't that you can't speak up — it's that you think you need confidence first\").\n"
            "   Pick whichever fits the angle best. At least one must appear.\n"
            "4. The conclusion must reference the specific scenario from THIS script. "
            "Generic motivational lines that could end any video are not acceptable.\n\n"
        )
    user = (
        f"{lang}\n\n"
        "TASK: Write a full Instagram Reels copy package for ONE chosen angle.\n\n"
        f"{adapt_block}{ref_note}{blueprint_note}"
        "Output JSON with this exact shape:\n"
        f"{json_shape}\n"
        "Rules:\n"
        f"{tb_rules}"
        "- hooks: exactly 5 alternative hooks for the same video. Mix styles freely "
        "(direct question, insight/tension, concrete say-out-loud line). Each hook is the FIRST line "
        "spoken/shown in the reel and must work on its own. No tiers, no labels.\n"
        f"{script_bullet}"
        "- caption_body: High-converting IG caption in the output language. Do NOT repeat or summarize "
        "the Reel script — deepen the message with new psychological insight and perspective. "
        "Write for one specific reader (ICP): every sentence should feel personally relevant; "
        "avoid generic coaching filler. Structure (use line breaks between beats): "
        "(1) Hook — pattern-interrupt, relatable situation; "
        "(2) Escalation — tension, reader feels seen; "
        "(3) Reframe / insight — the aha; "
        "(4) Consequence — why it matters if ignored; "
        "(5) Authority transition — solution direction without over-explaining; "
        "(6) CTA — clear action aligned with SELECTED_CTA (use its destination + traffic_goal; "
        "match type guidance — e.g. native link push for website, value-of-subscribing line for newsletter, "
        "comment keyword for lead_magnet). Fall back to OFFER_DOCUMENTATION-driven wording only when "
        "no SELECTED_CTA block is present. "
        "Tone: direct, emotionally precise, psychologically sharp; slight provocation where it fits; "
        f"1–3 emojis max if natural. Final check: would this stop a scroll and make the ICP feel understood?{caption_src_tail}\n"
        "- hashtags: at most 5 entries, niche-relevant; align with NICHE_BENCHMARKS and PATTERNS_JSON when available.\n\n"
        f"{hard_script_rules}"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row, selected_cta)[:100_000]}\n\n"
        f"PATTERNS_JSON:\n{json.dumps(synthesized_patterns, ensure_ascii=False)[:52_000]}\n\n"
        f"CHOSEN_ANGLE_JSON:\n{json.dumps(chosen_angle, ensure_ascii=False)[:8000]}\n"
        f"{prev_note}{fb}"
    )

    data = chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=12_288,
        temperature=0.45,
    )
    script = str(data.get("script") or "").strip()
    cap = str(data.get("caption_body") or "").strip()
    out: Dict[str, Any] = {
        "hooks": _normalize_hooks(data.get("hooks")),
        "script": script,
        "caption_body": cap,
        "hashtags": _normalize_hashtags(data.get("hashtags")),
        "story_variants": [],
    }
    if _wants_text_blocks(source_format_key):
        out["text_blocks"] = _normalize_text_blocks(data.get("text_blocks"))
        if out["text_blocks"]:
            out["visual_style"] = _normalize_visual_style(
                data.get("visual_style"),
                source_format_key=source_format_key,
                client_row=client_row,
            )
        else:
            out["visual_style"] = None
    else:
        out["text_blocks"] = None
    return _apply_german_natural_polish(settings, client_row, out, mode=german_polish)


def run_regenerate(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    synthesized_patterns: Dict[str, Any],
    chosen_angle: Dict[str, Any],
    scope: str,
    feedback: Optional[str],
    current_hooks: List[Dict[str, Any]],
    current_script: str,
    current_caption: str,
    current_hashtags: List[str],
    current_stories: List[str],
    source_format_key: Optional[str] = None,
    current_text_blocks: Optional[List[Dict[str, Any]]] = None,
    adapt_single_reference_reel: bool = False,
    selected_cta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Regenerate all or one facet; one LLM call, then merge by scope."""
    polish_for_scope: Dict[str, GermanPolishMode] = {
        "all": "full",
        "hooks": "none",
        "script": "script",
        "caption": "caption",
        # legacy "story" scope kept for backwards-compat with old API callers; no-op now.
        "story": "none",
        "text_blocks": "none",
    }
    german_polish = polish_for_scope.get(scope, "full")
    previous = {
        "hooks": current_hooks,
        "script": current_script,
        "caption_body": current_caption,
        "hashtags": current_hashtags,
        "story_variants": current_stories,
        "text_blocks": current_text_blocks,
    }
    full = run_content_package(
        settings,
        client_row=client_row,
        synthesized_patterns=synthesized_patterns,
        chosen_angle=chosen_angle,
        feedback=feedback,
        previous=previous,
        source_format_key=source_format_key,
        german_polish=german_polish,
        adapt_single_reference_reel=adapt_single_reference_reel,
        selected_cta=selected_cta,
    )
    if scope == "all":
        return full
    # Keys from the new model output to apply for each scope (rest stay from previous).
    scope_keys: Dict[str, tuple[str, ...]] = {
        "hooks": ("hooks",),
        "script": ("script",),
        "caption": ("caption_body", "hashtags"),
        "text_blocks": ("text_blocks", "visual_style"),
        # legacy "story" scope kept for backwards-compat; touches nothing in new sessions.
        "story": (),
    }
    keys = scope_keys.get(scope)
    if keys is None:
        return full
    if not keys:
        # explicit no-op (e.g. legacy "story" scope on a session that no longer has stories)
        return previous
    out = dict(previous)
    for k in keys:
        out[k] = full[k]
    return out


def angles_from_session_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    a = row.get("angles")
    if not isinstance(a, list):
        return []
    return [x for x in a if isinstance(x, dict)]


def run_adaptation_synthesis(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    packed_analysis: Dict[str, Any],
    target_format_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Build synthesized_patterns from a single source reel (url_adapt mode).

    When ``target_format_key`` is provided the user explicitly wants to recreate the
    reel in a DIFFERENT production format than the source. The CORE IDEA / payoff
    is preserved but the FORMAT RECIPE in the synthesized patterns is rebuilt for
    the requested target (talking_head / text_overlay / carousel / b_roll_reel).
    """
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    target_block = _target_format_block(target_format_key)
    # When the user explicitly overrides the target format we drop the
    # "same format" instruction so the LLM rebuilds the FORMAT RECIPE for the new
    # target instead of mirroring the source's production format.
    same_format_note = "" if target_block else "same format and "
    source_grounding = (
        "SOURCE_POST_GROUNDING:\n"
        "SOURCE_REEL_ANALYSIS_JSON may include `source_caption` (scraped Instagram caption text). When present, "
        "it is factual surface copy from the creator — often lists, frameworks, examples, or CTAs that are not "
        "fully spoken in the video. Treat on-reel content and caption together as the full template when inferring "
        "CORE IDEA and value delivery. Do not invent facts, numbers, case studies, or claims beyond what appears "
        "in SOURCE_REEL_ANALYSIS_JSON or CLIENT_CONTEXT.\n\n"
    )
    user = (
        f"{lang}\n\n"
        f"{target_block}"
        f"{source_grounding}"
        f"TASK: This reel is the sole TEMPLATE to adapt for the client below — {same_format_note}same creative idea, "
        "rewritten for the client's world (language, ICP, offer). Separate three layers in your reasoning "
        "(reflect this in the JSON fields):\n"
        "(1) FORMAT RECIPE: production type (e.g. talking head, B-roll + on-screen text, carousel-style beats), "
        "pacing, visual rhythm, and segment order — what must stay the same in a faithful adaptation.\n"
        "(2) CORE IDEA: the one-line promise or transformation the viewer gets; the mechanism that made the reel "
        "work — keep this intent while swapping surface details.\n"
        "(3) SURFACE TO LOCALIZE: examples, setting, jargon, competitor-specific context to replace using "
        "CLIENT_CONTEXT.\n"
        "Extract repeatable structure, hooks, tension, and value delivery — then output JSON "
        "with the same shape as pattern synthesis:\n"
        "{\n"
        '  "hook_patterns": [{"name": string, "description": string, "example_from_data": string}],\n'
        '  "tension_mechanisms": [{"name": string, "description": string}],\n'
        '  "value_delivery_formats": [{"name": string, "description": string}],\n'
        '  "patterns_to_avoid": [string],\n'
        '  "format_insights": {"dominant_type": string, "optimal_duration": string, '
        '"engagement_drivers": string},\n'
        '  "performance_summary": string,\n'
        '  "one_paragraph_synthesis": string\n'
        "}\n\n"
        "Use the PERFORMANCE block when present to note what worked in context.\n"
        "In one_paragraph_synthesis, explicitly name: (a) format recipe to preserve, (b) core idea / viewer "
        "payoff to preserve, (c) what must be localized for the client.\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:100_000]}\n\n"
        f"SOURCE_REEL_ANALYSIS_JSON:\n{json.dumps(packed_analysis, ensure_ascii=False)[:120_000]}\n"
    )
    return chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=8192,
        temperature=0.25,
    )


def run_script_adaptation_synthesis(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    english_script: str,
) -> Dict[str, Any]:
    """Build synthesized_patterns from a pasted English talking-head script (script_adapt)."""
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    user = (
        f"{lang}\n\n"
        "TASK: The English text in <english_script> is a talking-head Reel script. "
        "Your job is NOT to translate it yet — extract repeatable structure, hook strength, tension, "
        "reframe, and value delivery so we can generate NEW angles for the client in the OUTPUT LANGUAGE.\n\n"
        "Adapt mentally to the client's voice and ICP (from CLIENT_CONTEXT): preserve Hook → Build → "
        "Reframe → Clarity → CTA rhythm; note cultural swaps if the script assumes English-only context.\n\n"
        "Output JSON with the same shape as pattern synthesis:\n"
        "{\n"
        '  "hook_patterns": [{"name": string, "description": string, "example_from_data": string}],\n'
        '  "tension_mechanisms": [{"name": string, "description": string}],\n'
        '  "value_delivery_formats": [{"name": string, "description": string}],\n'
        '  "patterns_to_avoid": [string],\n'
        '  "format_insights": {"dominant_type": string, "optimal_duration": string, '
        '"engagement_drivers": string},\n'
        '  "performance_summary": string,\n'
        '  "one_paragraph_synthesis": string\n'
        "}\n\n"
        "example_from_data should quote or paraphrase short lines from the script where useful.\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:100_000]}\n\n"
        f"<english_script>\n{english_script[:120_000]}\n</english_script>\n"
    )
    return chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=8192,
        temperature=0.25,
    )


def run_format_recommendation(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    idea: str,
    format_summaries: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Return top format recommendations for a free-text idea (JSON array)."""
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    user = (
        f"{lang}\n\n"
        "TASK: Given the user's video idea and the available FORMAT options with metrics, "
        "pick the 1–3 formats most likely to perform well for this idea. "
        "Output JSON: {\"recommendations\": [ {\"format_key\": string, "
        "\"score\": number 0-100, \"reasoning\": string, \"suggested_angle_hint\": string } ]}\n\n"
        f"USER_IDEA:\n{idea.strip()[:4000]}\n\n"
        f"FORMAT_OPTIONS_JSON:\n{json.dumps(format_summaries, ensure_ascii=False)[:80_000]}\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:80_000]}\n"
    )
    data = chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=4096,
        temperature=0.35,
    )
    rec = data.get("recommendations")
    if not isinstance(rec, list):
        return []
    out: List[Dict[str, Any]] = []
    for x in rec[:5]:
        if isinstance(x, dict):
            out.append(x)
    return out


ALLOWED_AUTO_IDEA_FORMATS = frozenset({"text_overlay", "talking_head", "carousel"})


def run_auto_video_idea(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    format_summaries: List[Dict[str, Any]],
    competitor_hints: str,
) -> Dict[str, str]:
    """LLM: one concrete video idea + suggested format (text_overlay | talking_head | carousel)."""
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    allowed = [s for s in format_summaries if isinstance(s, dict)]
    user = (
        f"{lang}\n\n"
        "TASK: Propose exactly ONE concrete Instagram Reels (or short-form) video idea for this client.\n"
        "- Ground it in CLIENT_CONTEXT and COMPETITOR_SNIPPETS (themes, hooks, what resonates).\n"
        "- The idea must be specific: topic, angle, and why it fits the ICP — not generic advice.\n"
        "- Pick exactly one OUTPUT_FORMAT from: text_overlay, talking_head, carousel.\n"
        "  • text_overlay: punchy on-screen text over footage or stills\n"
        "  • talking_head: face-to-camera delivery (script-led)\n"
        "  • carousel: multi-beat / swipe storytelling (still produce a reel-style script plan)\n\n"
        "Output JSON only:\n"
        '{"idea": string (2–6 sentences), "suggested_format_key": string, "reasoning": string}\n\n'
        f"FORMAT_DIGEST_SUMMARIES_JSON (metrics by style — use only as weak prior):\n"
        f"{json.dumps(allowed, ensure_ascii=False)[:60_000]}\n\n"
        f"COMPETITOR_SNIPPETS:\n{competitor_hints[:24_000]}\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:80_000]}\n"
    )
    data = chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=4096,
        temperature=0.45,
    )
    idea = str(data.get("idea") or "").strip()
    raw_key = str(data.get("suggested_format_key") or "").strip()
    reasoning = str(data.get("reasoning") or "").strip()
    ck = canonicalize_stored_format_key(raw_key) or raw_key
    if ck not in ALLOWED_AUTO_IDEA_FORMATS:
        ck = "text_overlay"
    if len(idea) < 20:
        raise ValueError("Model returned an empty or too-short idea; retry.")
    return {"idea": idea, "suggested_format_key": ck, "reasoning": reasoning}


def run_carousel_slide_texts(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    chosen_angle: Dict[str, Any],
    hook_text: str,
    count: int = 6,
    feedback: Optional[str] = None,
    selected_cta: Optional[Dict[str, Any]] = None,
    selected_carousel_template: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """LLM: ``count`` slide lines for a carousel post (slide 1 = hook, last = CTA).

    Each entry is plain text (no markdown). Slides are intentionally tight (1-2 lines, ~80 chars)
    so they read as a poster, not a paragraph.
    """
    n = max(3, min(10, int(count or 6)))
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    dna = client_row.get("client_dna") if isinstance(client_row.get("client_dna"), dict) else {}
    gen_brief = str(dna.get("generation_brief") or "").strip()
    voice_brief = str(dna.get("voice_brief") or "").strip()
    if not gen_brief:
        icp = client_row.get("icp") if isinstance(client_row.get("icp"), dict) else {}
        gen_brief = json.dumps(icp, ensure_ascii=False, default=str)[:4000] if icp else "(no ICP brief on file)"

    angle_topic = (
        f"- Title: {str(chosen_angle.get('title') or '').strip()}\n"
        f"- Situation: {str(chosen_angle.get('situation') or '').strip()}\n"
        f"- Emotional trigger: {str(chosen_angle.get('emotional_trigger') or '').strip()}\n"
        f"- Mechanism (why it works — context only, never write this on a slide): "
        f"{str(chosen_angle.get('mechanism_note') or '').strip()}"
    )

    fb = f"\n\nFEEDBACK_FROM_HUMAN:\n{feedback.strip()[:2000]}\n" if feedback and feedback.strip() else ""
    cta_block = _format_selected_cta_block(selected_cta)
    cta_block_for_user = (
        f"\n{cta_block}\n\nThe final slide MUST point at this destination + traffic_goal in a "
        "platform-native way (link in bio, comment keyword, etc.); never paste raw URLs.\n"
        if cta_block
        else ""
    )
    template_block = _format_carousel_template_block(selected_carousel_template)
    template_rules = (
        f"{template_block}\n\n"
        "TEMPLATE GUIDANCE: Use the CAROUSEL_TEMPLATE as a base style and story pattern. "
        "If the requested output has more slides than the template, extend the pattern "
        "naturally. If it has fewer slides, condense it. Always obey the requested output "
        "slide count below.\n\n"
        if template_block
        else ""
    )
    user = (
        f"{lang}\n\n"
        "You are an elite-level direct-response copywriter specialized in high-converting\n"
        "Instagram carousels in the coaching, leadership, and psychology space.\n\n"
        f"Your task is to write the on-slide text for ONE Instagram carousel ({n} slides) in the "
        f"voice of {client_row.get('name', 'the creator')}.\n\n"
        "OBJECTIVE — the carousel must:\n"
        "- stop the scroll on slide 1\n"
        "- reward every swipe with a new, complete thought\n"
        "- feel highly relevant to one specific person\n"
        "- end with a clear next action\n\n"
        "CONTEXT INPUT:\n"
        f"Hook of the reel (slide-1 seed — you may rewrite it to fit a poster, but keep the same idea):\n- {hook_text.strip()[:300] or '(none — derive purely from the topic below)'}\n\n"
        "Topic (chosen angle — INTERNAL CONTEXT ONLY, not slide copy):\n"
        f"{angle_topic}\n\n"
        f"{template_rules}"
        "Target Audience (ICP):\n"
        f"{gen_brief[:6000]}\n\n"
        f"CLIENT_VOICE_BRIEF (match this voice):\n{voice_brief[:4000] or '(none on file)'}\n\n"
        "CORE PRINCIPLE:\n"
        "Each slide is its own cover. Treat it like a Conny-style cover headline:\n"
        "distilled, punchy, emotionally loaded — built for scanning, not reading.\n"
        "The slides together tell ONE story (setup → tension → payoff → CTA).\n\n"
        "STYLE & TONE:\n"
        "- Natural spoken language. Direct, honest, slightly confronting.\n"
        "- No fluff, no buzzwords, no corporate language. Sounds like truth, not marketing.\n"
        "- Empathetic but clear; provocative but never manipulative.\n\n"
        "STRUCTURE (HARD):\n"
        f"- Exactly {n} slides, in order.\n"
        "- Slide 1 (COVER): scroll-stopper. Pattern interrupt or open loop. Works without context.\n"
        f"- Slides 2..{n - 1} (BODY): one idea per slide. Mix patterns — question, contrast, list "
        "item, mini-framework, hidden truth. Each slide rewards the swipe.\n"
        f"- Slide {n} (CTA): one explicit next action (comment a keyword, save, follow, click link). "
        "No generic \"read more\". Curiosity / tension / relevance only.\n\n"
        "FORMAT RULES (HARD, per slide):\n"
        "- Max 2 short lines. Max ~12 words. No full paragraphs.\n"
        "- No hashtags. No markdown. Minimal punctuation.\n"
        "- No emojis on slide 1. At most 1 emoji on any other slide, only if it adds meaning.\n"
        "- Plain audience-facing copy ONLY. Never write meta words from our pipeline such as "
        "\"blueprint\", \"direct adaptation\", \"variant\", \"angle\", \"hook\", \"CTA\", \"slide 1\", "
        "or any JSON field name. The viewer must never see internal labels.\n\n"
        "PATTERNS TO USE (not exhaustive):\n"
        "- \"If you …\", \"Why you …\", \"The moment you …\",\n"
        "- \"The problem isn't …\", \"You think … but …\", \"This is where you lose …\",\n"
        "- \"No one tells you this, but …\", \"The reason you …\".\n\n"
        "PSYCHOLOGICAL TRIGGERS: feeling overlooked, not being taken seriously, inner conflict,\n"
        "unfair dynamics, self-doubt, hidden truth, identity conflict (competent but silent).\n\n"
        "AVOID: generic phrases, empty motivation, long explanations, complicated wording,\n"
        "repeating the same opener twice, paraphrasing the slide-1 hook on a later slide.\n\n"
        "FINAL CHECK (apply to every slide before returning):\n"
        "\"Would I instantly understand this — and feel personally called out enough to swipe?\" "
        "If not, rewrite.\n\n"
        'OUTPUT (HARD): Return exactly this JSON shape, nothing else:\n'
        '{"slides": [string, string, ...]}  // length must equal ' + str(n) + "\n"
        f"{cta_block_for_user}"
        f"{fb}"
    )
    data = chat_json_completion(
        settings.openrouter_api_key,
        settings.openrouter_model,
        system=_SYSTEM_JSON,
        user=user,
        max_tokens=2048,
        temperature=0.5,
    )
    raw = data.get("slides")
    if not isinstance(raw, list):
        raise ValueError("LLM returned no 'slides' array.")
    out: List[str] = []
    for s in raw:
        if isinstance(s, str):
            t = s.strip()
        elif isinstance(s, dict):
            t = str(s.get("text") or "").strip()
        else:
            continue
        if t:
            out.append(t[:600])
    if len(out) < 3:
        raise ValueError(f"LLM returned only {len(out)} slides (need ≥3).")
    return out[:n]


def get_chosen_angle(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    angles = angles_from_session_row(row)
    if not angles:
        return None
    idx = row.get("chosen_angle_index")
    if idx is None:
        # Rare: index missing in DB but only one angle exists (still regeneratable).
        return angles[0] if len(angles) == 1 else None
    try:
        i = int(idx)
    except (TypeError, ValueError):
        return None
    if 0 <= i < len(angles):
        return angles[i]
    return None
