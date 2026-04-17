"""Image generation services.

- Reel thumbnails: Freepik flux-2-turbo (background) + Pillow (text overlay)
- Session backgrounds: OpenRouter openai/gpt-5-image (used by creation router)
"""

from __future__ import annotations

import base64
import io
import textwrap
import time
from pathlib import Path
from typing import Any, Dict

import httpx

# ── Pillow import (lazy-safe) ─────────────────────────────────────────────────
try:
    from PIL import Image, ImageDraw, ImageFont  # type: ignore[import]
    _PILLOW_AVAILABLE = True
except ImportError:
    _PILLOW_AVAILABLE = False

# ── Freepik constants ─────────────────────────────────────────────────────────
_FREEPIK_BASE = "https://api.freepik.com"
_FLUX_TURBO_PATH = "/v1/ai/text-to-image/flux-2-turbo"
_POLL_INTERVAL_S = 3.0
_POLL_MAX_WAIT_S = 120.0

# Playfair Display Bold — Google Fonts CDN, ~75 KB, cached on first use
_FONT_URL = (
    "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/"
    "PlayfairDisplay%5Bwght%5D.ttf"
)
_FONT_CACHE = Path("/tmp/_playfair_display.ttf")


def _load_font(size: int) -> "ImageFont.FreeTypeFont":
    if not _FONT_CACHE.exists():
        with httpx.Client(timeout=30) as client:
            r = client.get(_FONT_URL, follow_redirects=True)
            r.raise_for_status()
            _FONT_CACHE.write_bytes(r.content)
    return ImageFont.truetype(str(_FONT_CACHE), size)


def _wash_image(img: "Image.Image", w: int = 1080, h: int = 1920) -> "Image.Image":
    """Resize/center-crop to target, desaturate, apply white wash — Conny style."""
    img = img.convert("RGB")
    src_r = img.width / img.height
    tgt_r = w / h
    if src_r > tgt_r:
        new_h, new_w = h, int(h * src_r)
    else:
        new_w, new_h = w, int(w / src_r)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - w) // 2
    top = (new_h - h) // 2
    img = img.crop((left, top, left + w, top + h))

    # 70% desaturation: blend toward grayscale
    gray = img.convert("L").convert("RGB")
    img = Image.blend(img, gray, alpha=0.7)

    # 62% white wash: pull toward near-white
    white = Image.new("RGB", img.size, (255, 255, 255))
    img = Image.blend(img, white, alpha=0.62)

    return img


def _overlay_text(img: "Image.Image", text: str) -> "Image.Image":
    """Draw centered dark serif headline over the image."""
    W, H = img.size
    font_size = max(64, int(W * 0.082))  # ~88px at 1080px wide

    try:
        font = _load_font(font_size)
    except Exception:
        font = ImageFont.load_default()

    # Wrap to ~12 chars per line (≈2–3 short German words)
    wrapped_lines = textwrap.wrap(text, width=12) or [text]

    draw = ImageDraw.Draw(img)
    line_spacing = int(font_size * 1.28)
    total_h = line_spacing * len(wrapped_lines)

    # Center vertically (slightly above true center for visual balance)
    y = (H - total_h) // 2 - int(H * 0.03)
    color = (20, 20, 20)

    for line in wrapped_lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (W - text_w) // 2
        draw.text((x, y), line, font=font, fill=color)
        y += line_spacing

    return img


def _build_freepik_bg_prompt(text: str, angle_context: str = "") -> str:
    ctx = f" Mood: {angle_context.strip()}." if angle_context.strip() else ""
    return (
        f"Soft minimal interior lifestyle photograph. Bright, airy home office or "
        f"living room with diffused natural light.{ctx} "
        f"No people visible. No text. No words anywhere. No logos. No signs. "
        f"Muted warm cream tones, high-key, slightly overexposed, very calm. "
        f"Editorial photography style, subtle depth of field, clean background. "
        f"Instagram-worthy aesthetic, not stock photo."
    )


def generate_thumbnail_freepik_pillow(
    freepik_key: str,
    text: str,
    *,
    angle_context: str = "",
    target_w: int = 1080,
    target_h: int = 1920,
) -> bytes:
    """Generate a reel thumbnail using Freepik + Pillow.

    Step 1: Freepik flux-2-turbo → soft 9:16 lifestyle background (no AI text)
    Step 2: Pillow → desaturate + white wash + centered serif headline
    Returns PNG bytes ready for upload.
    """
    if not _PILLOW_AVAILABLE:
        raise RuntimeError("Pillow is not installed. Run: pip install Pillow")

    prompt = _build_freepik_bg_prompt(text, angle_context)
    headers = {
        "x-freepik-api-key": freepik_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # 1. Submit generation task (portrait 9:16, max side ≤ 2048)
    with httpx.Client(timeout=60) as client:
        r = client.post(
            f"{_FREEPIK_BASE}{_FLUX_TURBO_PATH}",
            headers=headers,
            json={
                "prompt": prompt,
                "image_size": {"width": 864, "height": 1536},
                "output_format": "jpeg",
                "enable_safety_checker": True,
            },
        )
        r.raise_for_status()
        task_id: str = r.json()["data"]["task_id"]

    # 2. Poll until COMPLETED or FAILED
    deadline = time.monotonic() + _POLL_MAX_WAIT_S
    image_url = ""
    with httpx.Client(timeout=30) as client:
        while time.monotonic() < deadline:
            time.sleep(_POLL_INTERVAL_S)
            poll = client.get(
                f"{_FREEPIK_BASE}{_FLUX_TURBO_PATH}/{task_id}",
                headers=headers,
            )
            poll.raise_for_status()
            result = poll.json().get("data", {})
            status = result.get("status", "")
            if status == "COMPLETED":
                generated = result.get("generated") or []
                if not generated:
                    raise RuntimeError("Freepik task completed but returned no image URLs")
                image_url = str(generated[0])
                break
            if status == "FAILED":
                raise RuntimeError(f"Freepik generation task failed: {result}")
    if not image_url:
        raise RuntimeError("Freepik generation timed out after 120 s")

    # 3. Download background
    with httpx.Client(timeout=60) as client:
        dl = client.get(image_url)
        dl.raise_for_status()
        bg_bytes = dl.content

    # 4. Wash + overlay text with Pillow
    bg = Image.open(io.BytesIO(bg_bytes))
    bg = _wash_image(bg, target_w, target_h)
    bg = _overlay_text(bg, text)

    out = io.BytesIO()
    bg.save(out, format="PNG", optimize=True)
    return out.getvalue()

def compose_thumbnail_from_image(
    image_bytes: bytes,
    text: str,
    *,
    target_w: int = 1080,
    target_h: int = 1920,
    wash: bool = True,
) -> bytes:
    """Compose a 9:16 reel cover from a user-supplied image + text overlay.

    Same editorial style as `generate_thumbnail_freepik_pillow` but skips the
    Freepik step: the caller already provides the background bytes (e.g. a
    photo of the creator from the client image library).

    Pass ``wash=False`` to keep original colours (skip desaturate + white wash);
    in that case the image is only resized/cropped to the target ratio before
    the headline is rendered on top.
    """
    if not _PILLOW_AVAILABLE:
        raise RuntimeError("Pillow is not installed. Run: pip install Pillow")

    bg = Image.open(io.BytesIO(image_bytes))
    if wash:
        bg = _wash_image(bg, target_w, target_h)
    else:
        bg = _resize_cover(bg, target_w, target_h)
    bg = _overlay_text(bg, text)

    out = io.BytesIO()
    bg.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _resize_cover(img: "Image.Image", w: int, h: int) -> "Image.Image":
    """Resize + center-crop to (w, h) keeping original colours."""
    img = img.convert("RGB")
    src_r = img.width / img.height
    tgt_r = w / h
    if src_r > tgt_r:
        new_h, new_w = h, int(h * src_r)
    else:
        new_w, new_h = w, int(w / src_r)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - w) // 2
    top = (new_h - h) // 2
    return img.crop((left, top, left + w, top + h))


OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/chat/completions"
IMAGE_MODEL = "openai/gpt-5-image"


def build_reel_thumbnail_prompt(hook_text: str, angle_title: str = "") -> str:
    """Build a prompt for a minimal, editorial reel cover image.

    The image will have the hook text rendered as the dominant typographic
    element over a soft, washed-out lifestyle/workplace background —
    the same clean aesthetic seen in high-performing German content.
    """
    title_part = angle_title.strip()
    text_to_render = hook_text.strip() or title_part or "Content"

    context_hint = ""
    if title_part and title_part.lower() != text_to_render.lower():
        context_hint = f" The visual mood relates to: {title_part}."

    return (
        f"A premium editorial reel cover image in portrait (9:16) format. "
        f"Background: a very soft, pale, slightly washed-out interior scene — "
        f"a minimalist home office or bright living room with diffused natural light. "
        f"No people visible. The background is heavily desaturated and faded to near-white, "
        f"like a high-key lifestyle photo with reduced contrast — almost cream-toned."
        f"{context_hint} "
        f"Centered on the image, render the following text EXACTLY and ONLY as a large, bold, dark serif "
        f"headline (similar to a premium magazine or editorial typeface): "
        f'"{text_to_render}". '
        f"The text must be perfectly legible, correctly spelled, centered horizontally and vertically, "
        f"dark near-black color on the light background. "
        f"No decorative borders, no UI elements, no additional text, no watermarks, no logos. "
        f"Photography-quality realism, not illustrated or cartoonish."
    )


def build_background_image_prompt(chosen_angle: Dict[str, Any]) -> str:
    situation = str(chosen_angle.get("situation") or "").strip()
    emotional_trigger = str(chosen_angle.get("emotional_trigger") or "").strip()
    return (
        f"iPhone photo of a professional workplace scene. {situation}. "
        f"Atmospheric, cinematic quality, natural office lighting. "
        f"Slightly moody, {emotional_trigger} tone. "
        f"Shot from eye level or slightly above. Blurred background depth. "
        f"No people visible or only silhouettes. No text, no logos, no watermarks. "
        f"Portrait orientation. Phone camera feel, not stock photo."
    )


def generate_image_via_openrouter(
    openrouter_key: str,
    prompt: str,
    *,
    model: str = IMAGE_MODEL,
    aspect_ratio: str = "9:16",
    timeout_s: float = 180.0,
) -> bytes:
    """Generate an image via OpenRouter using openai/gpt-5-image.

    Returns raw PNG bytes. Raises on HTTP/API errors.

    aspect_ratio options: "9:16" (768×1344 portrait), "2:3" (832×1248),
    "3:4" (864×1184), "1:1" (1024×1024).
    """
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": aspect_ratio},
    }
    with httpx.Client(timeout=timeout_s) as client:
        r = client.post(
            OPENROUTER_IMAGE_URL,
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

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError(f"OpenRouter image gen: no choices in response. Body: {data}")

    message = choices[0].get("message", {})
    images = message.get("images")
    if not isinstance(images, list) or not images:
        raise RuntimeError(
            f"OpenRouter image gen: no images in message. Keys: {list(message.keys())}"
        )

    image_obj = images[0]
    if isinstance(image_obj, dict):
        data_url: str = (
            image_obj.get("url")
            or (image_obj.get("image_url") or {}).get("url")
            or ""
        )
    else:
        data_url = str(image_obj)

    if not data_url:
        raise RuntimeError("OpenRouter image gen: could not extract image data URL")

    if data_url.startswith("data:"):
        _, b64 = data_url.split(",", 1)
        return base64.standard_b64decode(b64)

    # Fallback: treat as a remote URL and download
    with httpx.Client(timeout=timeout_s) as dl:
        resp = dl.get(data_url)
        resp.raise_for_status()
        return resp.content


# Convenience alias used by generation router
generate_thumbnail_via_openrouter = generate_image_via_openrouter
