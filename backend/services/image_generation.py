"""OpenAI Images API — portrait backgrounds for Phase 4 (gpt-image-1.5)."""

from __future__ import annotations

import base64
from typing import Any, Dict

import httpx


def build_background_image_prompt(chosen_angle: Dict[str, Any]) -> str:
    situation = str(chosen_angle.get("situation") or "").strip()
    emotional_trigger = str(chosen_angle.get("emotional_trigger") or "").strip()
    return (
        f"iPhone photo of a professional workplace scene. {situation}. "
        f"Atmospheric, cinematic quality, natural office lighting. "
        f"Slightly moody, {emotional_trigger} tone. "
        f"Shot from eye level or slightly above. Blurred background depth. "
        f"No people visible or only silhouettes. No text, no logos, no watermarks. "
        f"Portrait orientation 1024x1536. Phone camera feel, not stock photo."
    )


def generate_portrait_image_png(
    api_key: str,
    prompt: str,
    *,
    model: str = "gpt-image-1.5",
    timeout_s: float = 180.0,
) -> bytes:
    """Returns raw PNG bytes. Raises on HTTP/API errors."""
    payload: Dict[str, Any] = {
        "model": model,
        "prompt": prompt[:4000],
        "n": 1,
        "size": "1024x1536",
        "response_format": "b64_json",
    }
    with httpx.Client(timeout=timeout_s) as client:
        r = client.post(
            "https://api.openai.com/v1/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    arr = data.get("data")
    if not isinstance(arr, list) or not arr:
        raise RuntimeError("OpenAI images: empty data")
    first = arr[0]
    b64 = first.get("b64_json") if isinstance(first, dict) else None
    if b64:
        return base64.standard_b64decode(b64)
    url = first.get("url") if isinstance(first, dict) else None
    if isinstance(url, str) and url.startswith("http"):
        with httpx.Client(timeout=timeout_s) as dl:
            r = dl.get(url)
            r.raise_for_status()
            return r.content
    raise RuntimeError("OpenAI images: missing b64_json and url")
