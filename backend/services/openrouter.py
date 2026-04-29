"""OpenRouter chat completions (Gemini) — ports analyzeRelevance from competitor-discovery.js."""

from __future__ import annotations

import base64
import json
import logging
import random
import re
import threading
import time
from pathlib import Path
from typing import Any, List

import httpx

_MAX_VIDEO_BYTES = 15 * 1024 * 1024
_OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

logger = logging.getLogger(__name__)
_request_lock = threading.Lock()
_last_request_at = 0.0


def _openrouter_request_headers(openrouter_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {openrouter_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://silas-content-system.local",
        "X-Title": "Content Machine",
    }


def _sleep_seconds_for_429(
    response: httpx.Response, attempt_idx: int, max_sleep: float
) -> float:
    """Derive wait time from Retry-After / rate-limit headers, else exponential backoff + jitter."""
    ra = response.headers.get("retry-after")
    if ra:
        try:
            return min(max_sleep, max(0.5, float(ra)))
        except ValueError:
            pass
    reset = response.headers.get("x-ratelimit-reset")
    if reset:
        try:
            ts = float(reset)
            if ts > 1e12:
                ts = ts / 1000.0
            wait = ts - time.time()
            if wait > 0:
                return min(max_sleep, wait + random.uniform(0.1, 0.4))
        except ValueError:
            pass
    return min(
        max_sleep,
        max(0.5, (2**attempt_idx) * 0.75 + random.uniform(0, 0.35)),
    )


def _wait_for_process_slot(min_interval_s: float) -> None:
    """Throttle OpenRouter calls inside this process to avoid self-inflicted bursts."""
    if min_interval_s <= 0:
        return
    global _last_request_at
    with _request_lock:
        now = time.monotonic()
        wait = (_last_request_at + min_interval_s) - now
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


def openrouter_post_chat_completions(
    openrouter_key: str,
    payload: dict[str, Any],
    *,
    timeout: float,
    enable_model_fallback: bool = True,
) -> httpx.Response:
    """POST ``/v1/chat/completions`` with 429 backoff and optional ``OPENROUTER_MODEL_FALLBACK``.

    Use this for any code path that would otherwise call OpenRouter with raw httpx.
    """
    primary = str(payload.get("model") or "")
    return _post_chat_completions_with_optional_fallback(
        openrouter_key,
        payload,
        timeout=timeout,
        primary_model=primary,
        enable_model_fallback=enable_model_fallback,
    )


def _post_chat_completions_with_optional_fallback(
    openrouter_key: str,
    payload: dict[str, Any],
    *,
    timeout: float,
    primary_model: str,
    enable_model_fallback: bool,
) -> httpx.Response:
    """POST chat/completions: retry 429s with backoff, then optional fallback model."""
    from core.config import get_settings

    settings = get_settings()
    max_attempts = max(1, int(settings.openrouter_429_max_attempts))
    max_sleep = float(settings.openrouter_429_max_sleep_s)
    min_interval = float(settings.openrouter_min_interval_s)

    models: list[str] = [primary_model]
    if enable_model_fallback:
        fb = (settings.openrouter_model_fallback or "").strip()
        if fb and fb != primary_model:
            models.append(fb)

    headers = _openrouter_request_headers(openrouter_key)
    last: httpx.Response | None = None
    with httpx.Client(timeout=timeout) as client:
        for model_idx, model in enumerate(models):
            for attempt in range(max_attempts):
                body = {**payload, "model": model}
                _wait_for_process_slot(min_interval)
                r = client.post(_OPENROUTER_CHAT_URL, headers=headers, json=body)
                last = r
                if r.status_code == 429:
                    delay = _sleep_seconds_for_429(r, attempt, max_sleep)
                    logger.warning(
                        "OpenRouter 429 model=%s attempt=%s/%s sleep=%.1fs remaining=%s reset=%s",
                        model,
                        attempt + 1,
                        max_attempts,
                        delay,
                        r.headers.get("x-ratelimit-remaining"),
                        r.headers.get("x-ratelimit-reset"),
                    )
                    if attempt < max_attempts - 1:
                        time.sleep(delay)
                        continue
                    if model_idx < len(models) - 1:
                        time.sleep(min(2.0, max_sleep))
                    break
                r.raise_for_status()
                return r
    assert last is not None
    last.raise_for_status()
    return last


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
    r = _post_chat_completions_with_optional_fallback(
        openrouter_key,
        payload,
        timeout=120.0,
        primary_model=model,
        enable_model_fallback=True,
    )
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
    r = _post_chat_completions_with_optional_fallback(
        openrouter_key,
        payload,
        timeout=180.0,
        primary_model=model,
        enable_model_fallback=True,
    )
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
    r = _post_chat_completions_with_optional_fallback(
        openrouter_key,
        payload,
        timeout=180.0,
        primary_model=model,
        enable_model_fallback=not video_analyzed,
    )
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


def analyze_reel_similarity(
    openrouter_key: str,
    model: str,
    prompt: str,
    *,
    video_path: Path | None = None,
    video_bytes_max: int = _MAX_VIDEO_BYTES,
) -> tuple[dict, bool]:
    """Send video (or caption fallback) to Gemini with a similarity prompt.

    Returns (parsed_json_dict, video_analyzed). Prompt must ask for JSON only.
    """
    video_analyzed = False

    if video_path is not None and video_path.is_file():
        size = video_path.stat().st_size
        if size > 0 and size <= video_bytes_max:
            raw = video_path.read_bytes()
            b64 = base64.b64encode(raw).decode("ascii")
            messages: List[dict[str, Any]] = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:video/mp4;base64,{b64}"}},
                    ],
                }
            ]
            video_analyzed = True
        else:
            messages = [
                {
                    "role": "user",
                    "content": prompt
                    + "\n\nNOTE: No video available — base similarity on the caption and metadata only.",
                }
            ]
    else:
        messages = [
            {
                "role": "user",
                "content": prompt
                + "\n\nNOTE: No video available — base similarity on the caption and metadata only.",
            }
        ]

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": 512,
        "temperature": 0.1,
    }
    r = _post_chat_completions_with_optional_fallback(
        openrouter_key,
        payload,
        timeout=180.0,
        primary_model=model,
        enable_model_fallback=not video_analyzed,
    )
    data = r.json()

    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    choice = (data.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content") or ""
    if isinstance(content, list):
        content = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
        )
    cleaned = re.sub(r"^```json\s*", "", content.strip())
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return json.loads(cleaned), video_analyzed


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
    r = _post_chat_completions_with_optional_fallback(
        openrouter_key,
        payload,
        timeout=timeout_s,
        primary_model=model,
        enable_model_fallback=True,
    )
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


def _strip_json_response_fences(text: str) -> str:
    cleaned = re.sub(r"^```json\s*", "", text)
    cleaned = re.sub(r"^```\s*", "", cleaned).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    return cleaned


def _extract_first_json_object(s: str) -> str | None:
    """Return the first top-level `{ ... }` substring, or None (string-aware, handles nested objects)."""
    start = s.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(s)):
        c = s[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start : i + 1]
    return None


def _parse_json_object_from_model_text(cleaned: str) -> dict:
    """Parse a single JSON object; try full text then first balanced `{...}` slice."""
    cleaned = cleaned.strip()
    candidates: list[str] = [cleaned]
    extracted = _extract_first_json_object(cleaned)
    if extracted and extracted != cleaned:
        candidates.append(extracted)
    last_err: json.JSONDecodeError | None = None
    for cand in candidates:
        try:
            parsed = json.loads(cand)
        except json.JSONDecodeError as e:
            last_err = e
            continue
        if not isinstance(parsed, dict):
            raise RuntimeError("Model JSON must be an object at the top level")
        return parsed
    assert last_err is not None
    raise last_err


def chat_json_completion(
    openrouter_key: str,
    model: str,
    *,
    system: str,
    user: str,
    max_tokens: int = 12_288,
    temperature: float = 0.35,
) -> dict:
    """Chat completion; response must be a single JSON object (markdown fences stripped).

    On invalid JSON: retries up to 3 completions, and parses a brace-balanced `{...}` slice
    when the model adds preamble/trailing text outside the object.
    """
    last_exc: BaseException | None = None
    last_text = ""
    for attempt in range(3):
        t = temperature if attempt == 0 else min(temperature, 0.2)
        last_text = _chat_completion_raw_text(
            openrouter_key,
            model,
            system=system,
            user=user,
            max_tokens=max_tokens,
            temperature=t,
        )
        cleaned = _strip_json_response_fences(last_text)
        try:
            return _parse_json_object_from_model_text(cleaned)
        except (json.JSONDecodeError, RuntimeError) as e:
            last_exc = e
            if attempt < 2:
                time.sleep(0.35 + 0.25 * attempt)
                continue
            break
    tail = _strip_json_response_fences(last_text)
    tail = tail[:500] + ("…" if len(tail) > 500 else "")
    msg = str(last_exc) if last_exc else "unknown parse error"
    raise RuntimeError(f"Model returned invalid JSON after retries: {msg}. Start of response: {tail!r}") from last_exc


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
