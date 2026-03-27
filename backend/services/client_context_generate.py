"""LLM: onboarding transcript → five client-brain sections (draft text)."""

from __future__ import annotations

import json
import re
from typing import Any, Dict

import httpx

SECTION_KEYS = (
    "icp",
    "brand_map",
    "story_board",
    "communication_guideline",
    "offer_documentation",
)

GENERATE_SYSTEM = """You are a senior content strategist. From the onboarding call transcript below, write five plain-text documents for reuse in AI content generation. Write in the same language as the transcript when obvious; otherwise use the client's language from context.

Output MUST be a single JSON object with exactly these string keys (no markdown fences):
- icp — Ideal client: who they serve, demographics, psychographics, pains, desires.
- brand_map — Brand identity: positioning, values, personality, differentiators.
- story_board — Stories to reference: origin, signature anecdotes, examples (no invention; only from transcript).
- communication_guideline — How this creator speaks: tone, vocabulary, phrases to use/avoid, style rules.
- offer_documentation — What they sell, pricing if mentioned, promise, objections/handling if mentioned.

Each value is prose (paragraphs). If the transcript does not mention something, write a short honest note like "Not covered in transcript" for that part rather than inventing facts."""


def generate_sections_from_transcript(
    *,
    openrouter_key: str,
    model: str,
    transcript: str,
) -> Dict[str, str]:
    """Returns dict with the five SECTION_KEYS; missing keys become empty strings."""
    t = transcript.strip()
    if len(t) < 40:
        raise ValueError("Transcript is too short to generate meaningful sections.")

    user_msg = f"TRANSCRIPT:\n\n{t[:120_000]}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": GENERATE_SYSTEM},
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
    cleaned = re.sub(r"^```json\s*", "", content.strip())
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    try:
        parsed: Any = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Model returned invalid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("Model returned non-object JSON")
    out: Dict[str, str] = {}
    for key in SECTION_KEYS:
        v = parsed.get(key)
        out[key] = str(v).strip() if v is not None else ""
    return out
