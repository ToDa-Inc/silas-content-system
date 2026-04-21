"""Outlier-driven content generation: pattern synthesis → angles → hooks/script/caption/stories."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Literal, Optional, Sequence

from core.config import Settings
from services.client_dna_compile import _context_texts_only
from services.format_classifier import canonicalize_stored_format_key
from services.openrouter import chat_json_completion, chat_text_completion
from services.reel_metrics import enrich_engagement_metrics

logger = logging.getLogger(__name__)

GENERATION_PROMPT_VERSION = "silas_gen_v4_2026_04_11"

GermanPolishMode = Literal["none", "full", "script", "caption", "stories"]

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
    adapt_single_reference_reel: bool = False,
    target_format_key: Optional[str] = None,
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
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        out.append({"text": text, "isCTA": bool(item.get("isCTA"))})
    return out if out else None


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
        json_shape += ',\n  "text_blocks": [{"text": string, "isCTA": boolean}]'
    json_shape += "\n}\n"
    tb_rules = ""
    if _wants_text_blocks(source_format_key):
        tb_rules = (
            "\ntext_blocks (on-screen overlays, not the talking-head script):\n"
            "- Exactly 4 items: 3 content + 1 CTA (last isCTA=true).\n"
            "- Max 7 words per line; emojis (❌ ✅ 🔥 👇) where fitting.\n"
            "- CTA: \"👇 Schreib 'KEYWORD' für …\" matching the offer.\n"
            "- Derive from CHOSEN_ANGLE_JSON — not a script summary.\n"
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
    blueprint_note = ""
    if adapt_single_reference_reel and str(chosen_angle.get("angle_role") or "").strip().lower() == "blueprint":
        blueprint_note = (
            "\nBLUEPRINT_ANGLE: CHOSEN_ANGLE_JSON is the faithful-remake slot. Maximize fidelity to the source "
            "reel's structure, hook type, narrative arc, tension → payoff, and CTA mechanism in PATTERNS_JSON. "
            "Do not drift to a different topic or format; only localize and ICP-fit the same blueprint.\n"
        )
    user = (
        f"{lang}\n\n"
        "TASK: Write a full Instagram Reels copy package for ONE chosen angle.\n\n"
        f"{adapt_block}{blueprint_note}"
        "Output JSON with this exact shape:\n"
        f"{json_shape}\n"
        "Rules:\n"
        f"{tb_rules}"
        "- hooks: exactly 5 alternative hooks for the same video. Mix styles freely "
        "(direct question, insight/tension, concrete say-out-loud line). Each hook is the FIRST line "
        "spoken/shown in the reel and must work on its own. No tiers, no labels.\n"
        "- script: Use the optimal format and duration implied by PATTERNS_JSON.format_insights "
        "(and NICHE_BENCHMARKS if present). If format_insights suggests talking-head ~30s, write ~30s; "
        "if text-overlay, write overlay copy. Default to ~45 second talking head only if format_insights is empty. "
        "Use markdown with headings: "
        "## Hook, ## Situation, ## Insight 1, ## Insight 2, ## Insight 3, ## Conclusion, ## CTA.\n"
        "- caption_body: High-converting IG caption in the output language. Do NOT repeat or summarize "
        "the Reel script — deepen the message with new psychological insight and perspective. "
        "Write for one specific reader (ICP): every sentence should feel personally relevant; "
        "avoid generic coaching filler. Structure (use line breaks between beats): "
        "(1) Hook — pattern-interrupt, relatable situation; "
        "(2) Escalation — tension, reader feels seen; "
        "(3) Reframe / insight — the aha; "
        "(4) Consequence — why it matters if ignored; "
        "(5) Authority transition — solution direction without over-explaining; "
        "(6) CTA — clear action (e.g. comment keyword for webinar/training) aligned with OFFER_DOCUMENTATION. "
        "Tone: direct, emotionally precise, psychologically sharp; slight provocation where it fits; "
        "1–3 emojis max if natural. Final check: would this stop a scroll and make the ICP feel understood?\n"
        "- hashtags: at most 5 entries, niche-relevant; align with NICHE_BENCHMARKS and PATTERNS_JSON when available.\n\n"
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
    out: Dict[str, Any] = {
        "hooks": _normalize_hooks(data.get("hooks")),
        "script": script,
        "caption_body": cap,
        "hashtags": _normalize_hashtags(data.get("hashtags")),
        "story_variants": [],
    }
    if _wants_text_blocks(source_format_key):
        out["text_blocks"] = _normalize_text_blocks(data.get("text_blocks"))
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
    )
    if scope == "all":
        return full
    # Keys from the new model output to apply for each scope (rest stay from previous).
    scope_keys: Dict[str, tuple[str, ...]] = {
        "hooks": ("hooks",),
        "script": ("script",),
        "caption": ("caption_body", "hashtags"),
        "text_blocks": ("text_blocks",),
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
    user = (
        f"{lang}\n\n"
        f"{target_block}"
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
) -> List[str]:
    """LLM: ``count`` slide lines for a carousel post (slide 1 = hook, last = CTA).

    Each entry is plain text (no markdown). Slides are intentionally tight (1-2 lines, ~80 chars)
    so they read as a poster, not a paragraph.
    """
    n = max(3, min(10, int(count or 6)))
    lang = _lang_instruction(str(client_row.get("language") or "de"))
    fb = f"\n\nFEEDBACK_FROM_HUMAN:\n{feedback.strip()[:2000]}\n" if feedback and feedback.strip() else ""
    user = (
        f"{lang}\n\n"
        f"TASK: Write a single Instagram carousel ({n} slides). Each slide is a STANDALONE poster "
        "panel — short, visual, scroll-rewarding.\n\n"
        "Output JSON only:\n"
        '{"slides": [string, string, ...]}\n\n'
        "Rules:\n"
        f"- Exactly {n} slides, in order.\n"
        "- Slide 1 is the COVER / hook — must work as a thumbnail without context. "
        "Use the provided HOOK_TEXT as the slide-1 base; rewrite only if it does not fit a poster.\n"
        f"- Slides 2..{n - 1} deliver the value: one idea per slide, no walls of text. "
        "Mix formats: question, contrast, list item, mini-script, mini-framework.\n"
        f"- Slide {n} is the CTA: explicit next action (comment keyword, save, follow) aligned with the offer.\n"
        "- Each slide: max ~16 words, max ~2 short lines. No hashtags. No emojis on slide 1; "
        "max 1 emoji on other slides if it adds meaning.\n"
        "- Plain text only (no markdown).\n\n"
        f"HOOK_TEXT (slide 1 seed): {hook_text[:200]!r}\n\n"
        f"CHOSEN_ANGLE_JSON:\n{json.dumps(chosen_angle, ensure_ascii=False)[:8000]}\n\n"
        f"CLIENT_CONTEXT:\n{_pack_client_row_for_llm(client_row)[:80_000]}"
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
