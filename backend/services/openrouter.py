"""OpenRouter chat completions (Gemini) — ports analyzeRelevance from competitor-discovery.js."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any, List

import httpx

_MAX_VIDEO_BYTES = 15 * 1024 * 1024


def analyze_relevance(
    openrouter_key: str,
    prompt: str,
    model: str,
) -> dict:
    """Returns parsed JSON object from model response."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 512,
        "temperature": 0.1,
    }
    with httpx.Client(timeout=120.0) as client:
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
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    content = data["choices"][0]["message"]["content"]
    cleaned = re.sub(r"^```json\s*", "", content.strip())
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return json.loads(cleaned)


def analyze_creator_profile(openrouter_key: str, prompt: str, model: str) -> dict:
    """Structured niche profile JSON for auto-profiling (larger completion budget)."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8192,
        "temperature": 0.2,
    }
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
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    content = data["choices"][0]["message"]["content"]
    cleaned = re.sub(r"^```json\s*", "", content.strip())
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return json.loads(cleaned)


def analyze_reel_silas(
    openrouter_key: str,
    model: str,
    prompt: str,
    *,
    video_path: Path | None = None,
    video_bytes_max: int = _MAX_VIDEO_BYTES,
    text_reanalyze: bool = False,
) -> tuple[str, bool]:
    """Multimodal Gemini via OpenRouter (base64 video) or caption-only fallback when file missing or too large.

    Returns (assistant_text, video_analyzed).
    """
    video_analyzed = False
    messages: List[dict[str, Any]]

    if video_path is not None and video_path.is_file():
        size = video_path.stat().st_size
        if size <= video_bytes_max and size > 0:
            raw = video_path.read_bytes()
            b64 = base64.b64encode(raw).decode("ascii")
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:video/mp4;base64,{b64}"},
                        },
                    ],
                }
            ]
            video_analyzed = True
        else:
            if text_reanalyze:
                note = "\n\nNOTE: Text re-analysis — no video. Follow the prompt (prior Silas output is included)."
            else:
                note = (
                    "\n\nNOTE: Video file too large to upload. Analyze based on caption and metadata only. "
                    "Note this limitation in your response."
                )
            messages = [{"role": "user", "content": prompt + note}]
    else:
        if text_reanalyze:
            tail = "\n\nNOTE: Text re-analysis — no video re-download. Follow the prompt."
        else:
            tail = (
                "\n\nNOTE: No video bytes available. Analyze based on caption and metadata only."
            )
        messages = [{"role": "user", "content": prompt + tail}]

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": 2000,
        "temperature": 0.2,
    }
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
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    choice = data.get("choices") or []
    if not choice:
        raise RuntimeError("OpenRouter returned no choices")
    message = (choice[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts: list[str] = []
        for p in content:
            if isinstance(p, dict) and p.get("type") == "text":
                parts.append(str(p.get("text") or ""))
            elif isinstance(p, dict) and "text" in p:
                parts.append(str(p.get("text") or ""))
            elif isinstance(p, str):
                parts.append(p)
        text = "".join(parts)
    else:
        text = ""
    return text, video_analyzed


def _chat_completion_raw_text(
    openrouter_key: str,
    model: str,
    *,
    system: str,
    user: str,
    max_tokens: int,
    temperature: float,
    timeout_s: float = 300.0,
) -> str:
    """POST chat/completions; return assistant message text (trimmed, before fence stripping)."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    with httpx.Client(timeout=timeout_s) as client:
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
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    choice = data.get("choices") or []
    if not choice:
        raise RuntimeError("OpenRouter returned no choices")
    message = (choice[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts: list[str] = []
        for p in content:
            if isinstance(p, dict) and p.get("type") == "text":
                parts.append(str(p.get("text") or ""))
            elif isinstance(p, dict) and "text" in p:
                parts.append(str(p.get("text") or ""))
            elif isinstance(p, str):
                parts.append(p)
        text = "".join(parts)
    else:
        text = ""
    return text.strip()


def chat_json_completion(
    openrouter_key: str,
    model: str,
    *,
    system: str,
    user: str,
    max_tokens: int = 12_288,
    temperature: float = 0.35,
) -> dict:
    """Chat completion; response must be a single JSON object (markdown fences stripped)."""
    text = _chat_completion_raw_text(
        openrouter_key,
        model,
        system=system,
        user=user,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    cleaned = re.sub(r"^```json\s*", "", text)
    cleaned = re.sub(r"^```\s*", "", cleaned).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        tail = cleaned[:500] + ("…" if len(cleaned) > 500 else "")
        raise RuntimeError(f"Model returned invalid JSON: {e}. Start of response: {tail!r}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("Model JSON must be an object at the top level")
    return parsed


def chat_text_completion(
    openrouter_key: str,
    model: str,
    *,
    system: str,
    user: str,
    max_tokens: int = 8192,
    temperature: float = 0.35,
) -> str:
    """Chat completion; return assistant plain text (markdown fences stripped)."""
    text = _chat_completion_raw_text(
        openrouter_key,
        model,
        system=system,
        user=user,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", text)
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return cleaned
