"""Generate client_dna.similarity_keywords.auto — short caption-style search phrases (one LLM call)."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from services.openrouter import openrouter_post_chat_completions

logger = logging.getLogger(__name__)

_SYSTEM = """You output ONLY valid JSON (no markdown). Generate short Instagram reel search phrases.
Rules:
- 2–6 words each, lowercase, no hashtags, no questions, no first-person sentences.
- Phrases someone would type to find reels in this niche (not bio keywords).
- 6–12 phrases. Match the client's primary language when obvious from context.
- JSON shape: {"phrases": ["phrase one", "phrase two", ...]}"""


def generate_similarity_keywords_auto(
    *,
    openrouter_key: str,
    model: str,
    client_row: Dict[str, Any],
    analysis_brief: str,
) -> List[Dict[str, str]]:
    """Return [{"text": str, "lang": str}, ...] for client_dna.similarity_keywords.auto."""
    if not openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    lang = (client_row.get("language") or "en").strip().lower()[:8]
    nc = client_row.get("niche_config") or []
    icp = client_row.get("icp") if isinstance(client_row.get("icp"), dict) else {}
    user = (
        f"language_hint: {lang}\n\n"
        f"niche_config (json):\n{json.dumps(nc, ensure_ascii=False)[:12000]}\n\n"
        f"icp (json):\n{json.dumps(icp, ensure_ascii=False)[:8000]}\n\n"
        f"analysis_brief:\n{(analysis_brief or '')[:8000]}"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
    }
    r = openrouter_post_chat_completions(
        openrouter_key,
        payload,
        timeout=120.0,
        enable_model_fallback=True,
    )
    data = r.json()
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    if isinstance(content, list):
        content = "".join(
            x.get("text", "") if isinstance(x, dict) else str(x) for x in content
        )
    cleaned = re.sub(r"^```json\s*", "", str(content).strip())
    cleaned = re.sub(r"^```\s*", "", cleaned).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise RuntimeError("similarity keyword compile returned non-object JSON")
    phrases = parsed.get("phrases")
    if not isinstance(phrases, list):
        phrases = []
    out: List[Dict[str, str]] = []
    seen: set[str] = set()
    for p in phrases:
        s = " ".join(str(p).strip().split())
        if len(s) < 3 or len(s) > 120:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append({"text": s, "lang": lang})
        if len(out) >= 12:
            break
    if len(out) < 3:
        logger.warning("similarity keyword compile returned only %s phrases", len(out))
    return out


def merge_similarity_keywords_into_dna(
    existing_dna: Dict[str, Any],
    *,
    auto_phrases: List[Dict[str, str]],
) -> Dict[str, Any]:
    """Merge auto phrases into client_dna; preserves manual buckets under similarity_keywords if any."""
    dna = dict(existing_dna) if isinstance(existing_dna, dict) else {}
    old_sk = dna.get("similarity_keywords")
    sk: Dict[str, Any] = dict(old_sk) if isinstance(old_sk, dict) else {}
    sk["auto"] = auto_phrases
    sk["compiled_at"] = datetime.now(timezone.utc).isoformat()
    dna["similarity_keywords"] = sk
    return dna
