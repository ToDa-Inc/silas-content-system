"""LLM: natural-language instruction → surgical updates to client_context strategy sections."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Tuple

import httpx

from services.client_context_generate import SECTION_KEYS

DNA_CHAT_SYSTEM = """You are maintaining the strategic profile of a creator for an AI content system.
The profile has five source sections. Each section is prose text used as context
for AI reel analysis and content generation. Based on the user's instruction, you
must apply surgical updates to the affected section(s) only.

═══════════════════════
SECTION DEFINITIONS
═══════════════════════
- icp: Ideal client profile — demographics, psychographics, pain points, desires.
- brand_map: Brand identity — positioning, values, personality, differentiators.
- story_board: Stories, origin, signature anecdotes (only confirmed facts, no invention).
- communication_guideline: Tone, vocabulary, phrases to use/avoid, style rules.
- offer_documentation: What they sell, pricing if known, promise, objections.

═══════════════════════
STRICT RULES
═══════════════════════
1. Only include sections that the instruction actually changes. If the instruction
   only affects icp, return icp only in changed_sections. Do not return unchanged sections.
2. Within a section you do update: preserve all content the instruction does NOT
   contradict. Add, modify, or remove only what the instruction explicitly requires.
3. Never invent facts. If the user says "she launched a group program," add that.
   Do not add pricing, modules, or details that were not stated.
4. When the instruction contradicts existing content, the instruction wins.
5. If a section currently says "Not covered" or is empty and the instruction adds relevant
   information, replace it with the new content.
6. If nothing in the profile needs updating (e.g. the instruction is a question,
   is out of scope, or is already fully reflected), return "changed_sections": {}.
7. Write in the same language as the existing section you are updating when that section
   has substantial text. If the section is in German, write the updated text in German.
   If the section is empty or only a placeholder, match the client's content language from the payload.

═══════════════════════
OUTPUT FORMAT
═══════════════════════
Respond with a single JSON object. No markdown fences. No text outside the JSON.

{
  "changed_sections": {
    "<section_key>": "<full updated text for this section>"
  },
  "summary": "<1-2 sentence summary of what was updated, or why nothing changed>"
}

The keys in changed_sections must be exactly from: icp, brand_map, story_board, communication_guideline, offer_documentation.
"""


def _extract_section_text(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, dict) and "text" in raw:
        return str(raw.get("text") or "").strip()
    if isinstance(raw, str):
        return raw.strip()
    return ""


def sections_text_from_context(client_context: Any) -> Dict[str, str]:
    ctx = client_context if isinstance(client_context, dict) else {}
    return {k: _extract_section_text(ctx.get(k)) for k in SECTION_KEYS}


def _parse_json_response(content: str) -> Dict[str, Any]:
    cleaned = re.sub(r"^```json\s*", "", (content or "").strip())
    cleaned = re.sub(r"^```\s*", "", cleaned).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    parsed: Any = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Model returned non-object JSON")
    return parsed


def run_dna_chat_update(
    *,
    openrouter_key: str,
    model: str,
    sections: Dict[str, str],
    instruction: str,
    client_language: str,
) -> Tuple[Dict[str, str], str]:
    """Call OpenRouter; return (changed_sections filtered to valid keys, summary)."""
    if not openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    user_msg = json.dumps(
        {
            "client_content_language": (client_language or "de").strip() or "de",
            "current_sections": {k: sections.get(k, "") for k in SECTION_KEYS},
            "instruction": instruction.strip(),
        },
        ensure_ascii=False,
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": DNA_CHAT_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 8192,
        "temperature": 0.2,
    }
    try:
        with httpx.Client(timeout=180.0) as client:
            r = client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openrouter_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://silas-content-system.local",
                    "X-Title": "Content Machine",
                },
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        tail = (e.response.text or "")[:400]
        raise RuntimeError(f"OpenRouter HTTP {e.response.status_code}: {tail}") from e
    except httpx.RequestError as e:
        raise RuntimeError(f"OpenRouter request failed: {e}") from e

    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    content = data["choices"][0]["message"]["content"]
    try:
        parsed = _parse_json_response(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Model returned invalid JSON: {e}") from e

    raw_changed = parsed.get("changed_sections")
    if not isinstance(raw_changed, dict):
        raw_changed = {}

    allowed = set(SECTION_KEYS)
    changed: Dict[str, str] = {}
    for k, v in raw_changed.items():
        sk = str(k).strip()
        if sk not in allowed:
            continue
        if not isinstance(v, str):
            continue
        text = v.strip()
        if not text:
            continue
        if len(text) > 120_000:
            text = text[:120_000]
        changed[sk] = text

    summary = parsed.get("summary")
    summary_str = str(summary).strip() if summary is not None else ""
    if not summary_str:
        summary_str = "No summary from model." if changed else "No sections were updated."

    return changed, summary_str
