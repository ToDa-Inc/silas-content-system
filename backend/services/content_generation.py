"""Outlier-driven content generation: pattern synthesis → angles → hooks/script/caption/stories."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

from core.config import Settings
from services.client_dna_compile import _context_texts_only
from services.openrouter import chat_json_completion
from services.reel_metrics import enrich_engagement_metrics

GENERATION_PROMPT_VERSION = "silas_gen_v3_2026_04_02"

_SYSTEM_JSON = (
    "You are Silas — a senior Instagram Reels strategist. "
    "Reply with a single valid JSON object only (no markdown fences, no commentary)."
)


def _lang_instruction(language: str) -> str:
    low = (language or "").strip().lower()
    if low in ("de", "german", "deutsch"):
        return (
            "OUTPUT LANGUAGE: German (Deutsch). All user-facing copy must be natural, idiomatic German "
            "for the creator's audience (DE/AT/CH professional tone)."
        )
    return "OUTPUT LANGUAGE: English unless the client briefs explicitly require another language."


def _pack_client_row_for_llm(client_row: Dict[str, Any]) -> str:
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
    return "\n".join(parts)


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
) -> List[Dict[str, Any]]:
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    user = (
        f"{lang}\n\n"
        "TASK: Propose exactly 5 content ANGLES for this client — not generic topics. "
        "Each angle must name a concrete, recognizable situation for the ICP described in the briefs "
        "(e.g. workplace, client calls, leadership — whatever matches GENERATION_BRIEF and ICP).\n\n"
        "Output JSON: {\"angles\": [ {...}, ... ]} with exactly 5 objects. Each object:\n"
        "{\n"
        '  "title": string (short label),\n'
        '  "situation": string (specific scenario),\n'
        '  "emotional_trigger": string,\n'
        '  "mechanism_note": string (why it could perform — tie to patterns),\n'
        '  "draft_hook": string (one opening line in the output language)\n'
        "}\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:100_000]}\n\n"
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
    for a in angles[:5]:
        if isinstance(a, dict):
            out.append(a)
    return out


def _normalize_hooks(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for h in raw:
        if not isinstance(h, dict):
            continue
        tier = h.get("tier")
        text = str(h.get("text") or "").strip()
        if not text:
            continue
        try:
            t_int = int(tier)
        except (TypeError, ValueError):
            t_int = 2
        t_int = max(1, min(3, t_int))
        out.append({"tier": t_int, "text": text})
    return out[:24]


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


def run_content_package(
    settings: Settings,
    *,
    client_row: Dict[str, Any],
    synthesized_patterns: Dict[str, Any],
    chosen_angle: Dict[str, Any],
    feedback: Optional[str] = None,
    previous: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    prev_note = ""
    if previous:
        prev_note = (
            "\n\nPREVIOUS_VERSION (revise if feedback says so; otherwise improve coherence):\n"
            + json.dumps(previous, ensure_ascii=False)[:40_000]
        )
    fb = f"\n\nFEEDBACK_FROM_HUMAN:\n{feedback.strip()[:4000]}\n" if feedback and feedback.strip() else ""
    user = (
        f"{lang}\n\n"
        "TASK: Write a full Instagram Reels copy package for ONE chosen angle.\n\n"
        "Output JSON with this exact shape:\n"
        "{\n"
        '  "hooks": [{"tier": 1|2|3, "text": string}],\n'
        '  "script": string,\n'
        '  "caption_body": string,\n'
        '  "hashtags": [string],\n'
        '  "story_variants": [string, string, string]\n'
        "}\n\n"
        "Rules:\n"
        "- hooks: 10–18 items. Tier 1 = direct relatable question; 2 = insight/tension; 3 = concrete script/list hook.\n"
        "- script: Use the optimal format and duration implied by PATTERNS_JSON.format_insights "
        "(and NICHE_BENCHMARKS if present). If format_insights suggests talking-head ~30s, write ~30s; "
        "if text-overlay, write overlay copy. Default to ~45 second talking head only if format_insights is empty. "
        "Use markdown with headings: "
        "## Hook, ## Situation, ## Insight 1, ## Insight 2, ## Insight 3, ## Conclusion, ## CTA.\n"
        "- caption_body: mini-story + value; match client's caption style from generation_brief.\n"
        "- hashtags: at most 5 entries, niche-relevant; align with NICHE_BENCHMARKS and PATTERNS_JSON when available.\n"
        "- story_variants: 3 short on-screen text lines for IG Story teasers.\n\n"
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
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:100_000]}\n\n"
        f"PATTERNS_JSON:\n{json.dumps(synthesized_patterns, ensure_ascii=False)[:40_000]}\n\n"
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
    return {
        "hooks": _normalize_hooks(data.get("hooks")),
        "script": script,
        "caption_body": cap,
        "hashtags": _normalize_hashtags(data.get("hashtags")),
        "story_variants": _normalize_stories(data.get("story_variants"))[:3],
    }


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
) -> Dict[str, Any]:
    """Regenerate all or one facet; one LLM call, then merge by scope."""
    previous = {
        "hooks": current_hooks,
        "script": current_script,
        "caption_body": current_caption,
        "hashtags": current_hashtags,
        "story_variants": current_stories,
    }
    full = run_content_package(
        settings,
        client_row=client_row,
        synthesized_patterns=synthesized_patterns,
        chosen_angle=chosen_angle,
        feedback=feedback,
        previous=previous,
    )
    if scope == "all":
        return full
    # Keys from the new model output to apply for each scope (rest stay from previous).
    scope_keys: Dict[str, tuple[str, ...]] = {
        "hooks": ("hooks",),
        "script": ("script",),
        "caption": ("caption_body", "hashtags"),
        "story": ("story_variants",),
    }
    keys = scope_keys.get(scope)
    if not keys:
        return full
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
) -> Dict[str, Any]:
    """Build synthesized_patterns from a single source reel (url_adapt mode)."""
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    user = (
        f"{lang}\n\n"
        "TASK: This reel is the TEMPLATE to adapt for the client below. Extract "
        "repeatable structure, hooks, tension, and value delivery — then output JSON "
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
        "Use the PERFORMANCE block when present to note what worked in context.\n\n"
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
