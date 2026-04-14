"""LLM: natural-language instruction → surgical edits to client_dna.analysis_brief only."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple

import httpx

ANALYSIS_BRIEF_KEY = "analysis_brief"
MAX_ANALYSIS_BRIEF_CHARS = 120_000

DNA_PROFILE_CHAT_SYSTEM = """You edit ONE artifact: the "analysis brief" stored as client_dna.analysis_brief.
This is dense prose (often with • section labels) that tells an AI how to score competitor reels for THIS creator:
identity, niche boundaries, audience, pains/desires, what content resonates, what fails, voice.

The user described a change (pivot, tone shift, new angle). Update the brief to reflect it.

═══════════════════════
STRICT RULES
═══════════════════════
1. Return the COMPLETE revised analysis_brief as one string (not a diff, not a fragment).
2. Surgical edits: keep paragraphs, bullets, and facts that the instruction does NOT require changing.
   Do NOT wipe or rewrite unrelated sections. Prefer small insertions and targeted rewrites.
3. Never invent facts. If the instruction implies something vague, integrate cautiously without new concrete claims.
4. If the instruction is a question, off-topic, or nothing should change, return the current brief UNCHANGED
   and explain in summary.
5. Match the language of the existing brief when it has substantial text; otherwise match client_content_language.

═══════════════════════
OUTPUT FORMAT
═══════════════════════
A single JSON object. No markdown fences. No text outside the JSON.

{
  "analysis_brief": "<full updated brief text>",
  "summary": "<1-2 sentences: what you changed, or why nothing changed>"
}
"""


def coerce_analysis_brief_patch(changed_sections: Any) -> Optional[str]:
    """Extract validated analysis_brief text from apply body (only this key is allowed)."""
    if not isinstance(changed_sections, dict):
        return None
    raw = changed_sections.get(ANALYSIS_BRIEF_KEY)
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    if len(text) > MAX_ANALYSIS_BRIEF_CHARS:
        text = text[:MAX_ANALYSIS_BRIEF_CHARS]
    return text


def merge_analysis_brief_into_client_dna(
    existing_dna: Any,
    new_brief: str,
    *,
    now_iso: str,
) -> Dict[str, Any]:
    """Patch client_dna JSON; does not touch client_context or trigger recompile."""
    d: Dict[str, Any] = dict(existing_dna) if isinstance(existing_dna, dict) else {}
    d[ANALYSIS_BRIEF_KEY] = new_brief
    d["analysis_brief_edit_source"] = "chat"
    d["analysis_brief_edited_at"] = now_iso
    d["compiled_at"] = now_iso
    return d


def _parse_json_response(content: str) -> Dict[str, Any]:
    cleaned = re.sub(r"^```json\s*", "", (content or "").strip())
    cleaned = re.sub(r"^```\s*", "", cleaned).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    parsed: Any = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Model returned non-object JSON")
    return parsed


def run_dna_profile_chat_update(
    *,
    openrouter_key: str,
    model: str,
    current_brief: str,
    instruction: str,
    client_language: str,
) -> Tuple[Dict[str, str], str]:
    """Return ({analysis_brief: new_text}, summary) or ({}, summary) if nothing to apply."""
    if not openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    user_msg = json.dumps(
        {
            "client_content_language": (client_language or "de").strip() or "de",
            "current_analysis_brief": current_brief or "",
            "instruction": instruction.strip(),
        },
        ensure_ascii=False,
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": DNA_PROFILE_CHAT_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 12_288,
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

    brief_raw = parsed.get(ANALYSIS_BRIEF_KEY)
    brief_str = str(brief_raw).strip() if brief_raw is not None else ""
    summary = parsed.get("summary")
    summary_str = str(summary).strip() if summary is not None else ""

    if not brief_str:
        if not summary_str:
            summary_str = "No updated brief returned."
        return {}, summary_str

    if len(brief_str) > MAX_ANALYSIS_BRIEF_CHARS:
        brief_str = brief_str[:MAX_ANALYSIS_BRIEF_CHARS]

    cur = (current_brief or "").strip()
    if brief_str == cur:
        if not summary_str:
            summary_str = "No changes — brief already matches your instruction."
        return {}, summary_str

    if not summary_str:
        summary_str = "Analysis brief updated."

    return {ANALYSIS_BRIEF_KEY: brief_str}, summary_str
