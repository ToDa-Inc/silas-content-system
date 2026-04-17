"""Client image library — reusable photos for cover and video background composition.

Mirrors the B-roll upload pattern (`creation.py:upload_broll_clip`) but for static images.
Used as the non-AI alternative in:
  - reel cover composition (`/generate/sessions/{id}/compose-thumbnail`)
  - video background (`/create/sessions/{id}/set-background-image`)
"""

from __future__ import annotations

import io
import logging
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase
from core.deps import resolve_client_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["client_images"])

CLIENT_IMAGES_BUCKET = "client_images"
ACCEPTED_MIME = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
MAX_BYTES = 12 * 1024 * 1024  # 12 MB


def _public_url(supabase_url: str, path: str) -> str:
    return f"{supabase_url.rstrip('/')}/storage/v1/object/public/{CLIENT_IMAGES_BUCKET}/{path}"


def _ext_for(content_type: str, filename: str) -> str:
    ct = (content_type or "").lower()
    if ct in ("image/jpeg", "image/jpg"):
        return "jpg"
    if ct == "image/webp":
        return "webp"
    if ct == "image/png":
        return "png"
    fn = (filename or "").lower()
    if fn.endswith((".jpg", ".jpeg")):
        return "jpg"
    if fn.endswith(".webp"):
        return "webp"
    return "png"


def _image_dims(data: bytes) -> tuple[Optional[int], Optional[int]]:
    """Best-effort width/height detection — never raises."""
    try:
        from PIL import Image  # type: ignore[import]

        with Image.open(io.BytesIO(data)) as im:
            return int(im.width), int(im.height)
    except Exception:
        return None, None


@router.get("/clients/{slug}/images")
def list_client_images(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> list[dict]:
    _ = slug
    res = (
        supabase.table("client_images")
        .select("*")
        .eq("client_id", client_id)
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    return list(res.data or [])


@router.post("/clients/{slug}/images")
async def upload_client_image(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
    label: Annotated[Optional[str], Form()] = None,
) -> dict:
    _ = slug
    ct = (file.content_type or "").lower()
    if ct and ct not in ACCEPTED_MIME:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type {ct}. Use PNG, JPG or WEBP.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 12 MB)")

    image_id = str(uuid.uuid4())
    ext = _ext_for(ct, file.filename or "")
    path = f"{client_id}/{image_id}.{ext}"
    content_type = (
        "image/jpeg" if ext == "jpg"
        else "image/webp" if ext == "webp"
        else "image/png"
    )
    try:
        supabase.storage.from_(CLIENT_IMAGES_BUCKET).upload(
            path,
            data,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e

    width, height = _image_dims(data)
    url = _public_url(settings.supabase_url, path)

    ins = (
        supabase.table("client_images")
        .insert(
            {
                "id": image_id,
                "client_id": client_id,
                "file_url": url,
                "label": (label or "").strip()[:200] or None,
                "width": width,
                "height": height,
            }
        )
        .execute()
    )
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to create client_images row")
    return dict(ins.data[0])


@router.delete("/clients/{slug}/images/{image_id}", status_code=204)
def delete_client_image(
    slug: str,
    image_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> None:
    _ = slug
    res = (
        supabase.table("client_images")
        .select("id, file_url")
        .eq("id", image_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Image not found")
    file_url = str(res.data[0].get("file_url") or "")
    # Try every common extension — cheap and safe.
    for ext in ("png", "jpg", "jpeg", "webp"):
        path = f"{client_id}/{image_id}.{ext}"
        if path in file_url:
            try:
                supabase.storage.from_(CLIENT_IMAGES_BUCKET).remove([path])
            except Exception:
                logger.debug("client_image storage delete best-effort failed for %s", path)
            break
    supabase.table("client_images").delete().eq("id", image_id).eq("client_id", client_id).execute()
