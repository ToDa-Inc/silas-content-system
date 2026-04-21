"""Phase 4: visual-format sessions (content ready or approved) → background + Remotion render."""

from __future__ import annotations

import asyncio
import io
import logging
import os
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase, get_supabase_for_settings
from core.deps import require_org_access, resolve_client_id
from core.id_generator import generate_job_id
from models.generation import (
    CarouselSlide,
    GenerateCarouselSlidesBody,
    GenerationSessionOut,
    PatchCarouselSlidesBody,
    RegenerateCarouselSlideBody,
)
from routers.generation import _load_session, _now_iso, _row_to_out
from services.content_generation import get_chosen_angle, run_carousel_slide_texts
from services.format_classifier import canonicalize_stored_format_key
from services.image_generation import (
    build_background_image_prompt,
    generate_image_via_openrouter,
    generate_slide_image,
)
from services.job_queue import has_active_job
from services.video_render import RENDERS_BUCKET, fail_video_render_job, run_video_render_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["creation"])

VISUAL_FORMATS = frozenset({"text_overlay", "b_roll_reel", "carousel"})
CREATE_ELIGIBLE_STATUSES = frozenset({"content_ready", "approved"})
BROLL_BUCKET = "broll"


def _public_object_url(supabase_url: str, bucket: str, path: str) -> str:
    return f"{supabase_url.rstrip('/')}/storage/v1/object/public/{bucket}/{path}"


def _session_canonical_format_key(row: Dict[str, Any]) -> str:
    raw = str(row.get("source_format_key") or "").strip()
    return canonicalize_stored_format_key(raw) or raw


def _effective_create_format_key(row: Dict[str, Any]) -> str:
    """Format used for Create / Remotion. URL-adapt sessions often omitted source_format_key historically."""
    fk = _session_canonical_format_key(row)
    if fk in VISUAL_FORMATS:
        return fk
    if str(row.get("source_type") or "").strip() == "url_adapt":
        return "text_overlay"
    return fk


def _session_eligible_for_create(row: Dict[str, Any]) -> bool:
    if str(row.get("status") or "") not in CREATE_ELIGIBLE_STATUSES:
        return False
    fk = _session_canonical_format_key(row)
    if fk in VISUAL_FORMATS:
        return True
    # Legacy / current: url_adapt rows may have NULL source_format_key but still suit text-overlay pipeline
    if str(row.get("source_type") or "").strip() == "url_adapt" and not fk:
        return True
    return False


def _is_carousel_session(row: Dict[str, Any]) -> bool:
    return _effective_create_format_key(row) == "carousel"


def _normalize_patch_text_blocks(raw: Any) -> Optional[List[Dict[str, Any]]]:
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="text_blocks must be a JSON array")
    out: List[Dict[str, Any]] = []
    for item in raw[:12]:
        if not isinstance(item, dict):
            continue
        t = str(item.get("text") or "").strip()
        if not t:
            continue
        out.append({"text": t, "isCTA": bool(item.get("isCTA"))})
    return out if out else None


class SetBrollBody(BaseModel):
    broll_clip_id: str = Field(..., min_length=1, max_length=64)


class SetBackgroundImageBody(BaseModel):
    """Pick a static client image as background. Same effect as `generate-background`
    (sets a still 9:16 image) but uses an existing photo from the client library."""

    client_image_id: str = Field(..., min_length=1, max_length=64)


class PatchCreateSessionBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text_blocks: Optional[List[Dict[str, Any]]] = None
    # talking_head sessions edit script / caption from the unified create screen.
    script: Optional[str] = Field(default=None, max_length=20_000)
    caption_body: Optional[str] = Field(default=None, max_length=20_000)
    hashtags: Optional[List[str]] = None


@router.get("/clients/{slug}/create/sessions", response_model=list[GenerationSessionOut])
def list_create_sessions(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = 50,
) -> list[dict]:
    _ = slug
    res = (
        supabase.table("generation_sessions")
        .select("*")
        .eq("client_id", client_id)
        .in_("status", list(CREATE_ELIGIBLE_STATUSES))
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = [dict(r) for r in (res.data or []) if _session_eligible_for_create(dict(r))]
    return [_row_to_out(r) for r in rows]


@router.patch("/clients/{slug}/create/sessions/{session_id}", response_model=GenerationSessionOut)
def patch_create_session(
    slug: str,
    session_id: str,
    body: PatchCreateSessionBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Edit fields the user can tweak from the unified create screen.

    - `text_blocks`: only allowed for visual formats (text_overlay, b_roll_reel, carousel).
    - `script` / `caption_body` / `hashtags`: allowed for any content_ready/approved session
      (talking_head edits its script here; visual formats can also tweak caption).
    """
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    status = str(row.get("status") or "")
    if status not in CREATE_ELIGIBLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Session must be content_ready or approved",
        )

    patch: Dict[str, Any] = {}
    if body.text_blocks is not None:
        if not _session_eligible_for_create(row) or _is_carousel_session(row):
            raise HTTPException(
                status_code=400,
                detail=(
                    "text_blocks only apply to text_overlay / b_roll_reel sessions; "
                    "carousel sessions use carousel_slides instead"
                ),
            )
        patch["text_blocks"] = _normalize_patch_text_blocks(body.text_blocks)
    if body.script is not None:
        patch["script"] = body.script.strip()
    if body.caption_body is not None:
        patch["caption_body"] = body.caption_body.strip()
    if body.hashtags is not None:
        cleaned: List[str] = []
        for tag in body.hashtags[:10]:
            t = str(tag).strip()
            if not t:
                continue
            cleaned.append(t if t.startswith("#") else f"#{t.lstrip('#')}")
        patch["hashtags"] = cleaned

    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    patch["updated_at"] = _now_iso()
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post("/clients/{slug}/create/sessions/{session_id}/generate-background", response_model=GenerationSessionOut)
def generate_session_background(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row):
        raise HTTPException(
            status_code=400,
            detail="Session must be content_ready or approved with a visual format (text_overlay, b_roll_reel, carousel)",
        )
    fk = _effective_create_format_key(row)
    if fk != "text_overlay":
        raise HTTPException(
            status_code=400,
            detail=(
                "generate-background applies to text_overlay only; "
                "carousel sessions use carousel-slides/generate, b_roll_reel uses set-broll"
            ),
        )
    chosen = _chosen_angle(row)
    prompt = build_background_image_prompt(chosen)
    try:
        png = generate_image_via_openrouter(settings.openrouter_api_key, prompt, aspect_ratio="2:3")
    except Exception as e:
        logger.exception("OpenRouter image generation failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    path = f"{client_id}/bg_{session_id}.png"
    try:
        supabase.storage.from_(RENDERS_BUCKET).upload(
            path,
            png,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e

    url = _public_object_url(settings.supabase_url, RENDERS_BUCKET, path)
    now = _now_iso()
    supabase.table("generation_sessions").update(
        {
            "background_type": "generated_image",
            "background_url": url,
            "broll_clip_id": None,
            "client_image_id": None,
            "updated_at": now,
        }
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


def _chosen_angle(row: Dict[str, Any]) -> Dict[str, Any]:
    angles = row.get("angles") if isinstance(row.get("angles"), list) else []
    idx_raw = row.get("chosen_angle_index")
    try:
        idx = int(idx_raw) if idx_raw is not None else 0
    except (TypeError, ValueError):
        idx = 0
    if 0 <= idx < len(angles) and isinstance(angles[idx], dict):
        return dict(angles[idx])
    return {}


@router.post("/clients/{slug}/create/sessions/{session_id}/set-broll", response_model=GenerationSessionOut)
def set_session_broll(
    slug: str,
    session_id: str,
    body: SetBrollBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row):
        raise HTTPException(
            status_code=400,
            detail="Session must be content_ready or approved with a visual format (text_overlay, b_roll_reel, carousel)",
        )
    fk_eff = _effective_create_format_key(row)
    if fk_eff not in ("text_overlay", "b_roll_reel"):
        raise HTTPException(
            status_code=400,
            detail="set-broll applies only to text_overlay or b_roll_reel sessions",
        )

    cid = body.broll_clip_id.strip()
    cres = (
        supabase.table("broll_clips")
        .select("id, file_url")
        .eq("id", cid)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="B-roll clip not found")
    clip = dict(cres.data[0])
    file_url = str(clip.get("file_url") or "").strip()
    if not file_url:
        raise HTTPException(status_code=400, detail="Clip has no file_url")

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {
            "background_type": "broll",
            "background_url": file_url,
            "broll_clip_id": cid,
            "client_image_id": None,
            "updated_at": now,
        }
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/create/sessions/{session_id}/set-background-image",
    response_model=GenerationSessionOut,
)
def set_session_background_image(
    slug: str,
    session_id: str,
    body: SetBackgroundImageBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Set the video background to a still image from the client library.

    For text_overlay / carousel sessions: the chosen image becomes the static
    background and the render pipeline overlays text on it (same as a generated
    image, only the source differs).
    """
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row):
        raise HTTPException(
            status_code=400,
            detail="Session must be content_ready or approved with a visual format (text_overlay, b_roll_reel, carousel)",
        )
    fk_eff = _effective_create_format_key(row)
    if fk_eff != "text_overlay":
        raise HTTPException(
            status_code=400,
            detail="set-background-image applies to text_overlay only",
        )

    image_id = body.client_image_id.strip()
    cres = (
        supabase.table("client_images")
        .select("id, file_url")
        .eq("id", image_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="Client image not found")
    file_url = str(cres.data[0].get("file_url") or "").strip()
    if not file_url:
        raise HTTPException(status_code=400, detail="Image has no file_url")

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {
            "background_type": "client_image",
            "background_url": file_url,
            "broll_clip_id": None,
            "client_image_id": image_id,
            "updated_at": now,
        }
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post("/clients/{slug}/create/sessions/{session_id}/render")
def queue_session_render(
    slug: str,
    session_id: str,
    background_tasks: BackgroundTasks,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row) or _is_carousel_session(row):
        raise HTTPException(
            status_code=400,
            detail=(
                "Session must be content_ready/approved with an MP4 format "
                "(text_overlay or b_roll_reel). Carousels are delivered as a PNG ZIP, not rendered."
            ),
        )
    if str(row.get("render_status") or "") == "rendering":
        raise HTTPException(status_code=409, detail="A render is already in progress for this session")
    if has_active_job(
        supabase,
        client_id=client_id,
        job_type="video_render",
        payload_match={"session_id": session_id},
    ):
        raise HTTPException(status_code=409, detail="A render job is already queued for this session")

    bg = str(row.get("background_url") or "").strip()
    if not bg:
        raise HTTPException(status_code=400, detail="Set a background (generate image or pick B-roll) first")
    tb = row.get("text_blocks")
    if not isinstance(tb, list) or not any(
        isinstance(x, dict) and str(x.get("text") or "").strip() for x in tb
    ):
        raise HTTPException(status_code=400, detail="Session needs non-empty text_blocks")

    job_id = generate_job_id()
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").insert(
        {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "video_render",
            "payload": {"session_id": session_id},
            "status": "running",
            "started_at": now,
        }
    ).execute()

    supabase.table("generation_sessions").update(
        {"render_status": "rendering", "render_error": None, "updated_at": now}
    ).eq("id", session_id).execute()

    background_tasks.add_task(_background_video_render, job_id)
    return {"job_id": job_id, "status": "queued"}


def _background_video_render(job_id: str) -> None:
    settings = get_settings()
    try:
        run_video_render_job(settings, job_id)
    except Exception as e:
        logger.exception("video_render background task crashed")
        supabase = get_supabase_for_settings(settings)
        res = supabase.table("background_jobs").select("payload").eq("id", job_id).limit(1).execute()
        sid = ""
        if res.data and isinstance(res.data[0].get("payload"), dict):
            sid = str(res.data[0]["payload"].get("session_id") or "")
        fail_video_render_job(supabase, job_id, sid, str(e))


# ── Carousel slides ───────────────────────────────────────────────────────────


def _slides_array_from_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = row.get("carousel_slides")
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for s in raw:
        if isinstance(s, dict):
            out.append(s)
    out.sort(key=lambda x: int(x.get("idx") or 0))
    return out


def _ensure_carousel_session(row: Dict[str, Any]) -> None:
    if not _session_eligible_for_create(row):
        raise HTTPException(
            status_code=400, detail="Session must be content_ready or approved"
        )
    if not _is_carousel_session(row):
        raise HTTPException(
            status_code=400, detail="This endpoint is only for carousel sessions"
        )


def _fetch_client_image_bytes(supabase: Client, *, client_id: str, image_id: str) -> bytes:
    cres = (
        supabase.table("client_images")
        .select("id, file_url")
        .eq("id", image_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="Client image not found")
    file_url = str(cres.data[0].get("file_url") or "").strip()
    if not file_url:
        raise HTTPException(status_code=400, detail="Image has no file_url")
    try:
        with httpx.Client(timeout=30) as client:
            r = client.get(file_url)
            r.raise_for_status()
            return r.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch client image: {e}") from e


def _upload_slide_png(
    supabase: Client, settings: Settings, *, client_id: str, session_id: str, idx: int, png: bytes
) -> str:
    path = f"{client_id}/carousel_{session_id}_{idx:02d}.png"
    try:
        supabase.storage.from_(RENDERS_BUCKET).upload(
            path,
            png,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e
    return _public_object_url(settings.supabase_url, RENDERS_BUCKET, path)


def _carousel_hook_text(row: Dict[str, Any]) -> str:
    hooks = row.get("hooks") if isinstance(row.get("hooks"), list) else []
    for h in hooks:
        if isinstance(h, dict):
            t = str(h.get("text") or "").strip()
            if t:
                return t
    chosen = _chosen_angle(row)
    # Mirror video_render.build_remotion_props: angles store the opening line as draft_hook.
    for key in ("draft_hook", "hook", "title", "name"):
        raw = str(chosen.get(key) or "").strip()
        if raw:
            return raw
    return ""


def _client_row_for_session(supabase: Client, client_id: str) -> Dict[str, Any]:
    cres = (
        supabase.table("clients")
        .select(
            "id, name, instagram_handle, language, niche_config, icp, products, "
            "client_context, client_dna"
        )
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    return dict(cres.data[0]) if cres.data else {}


@router.post(
    "/clients/{slug}/create/sessions/{session_id}/carousel-slides/generate",
    response_model=GenerationSessionOut,
)
def generate_carousel_slides(
    slug: str,
    session_id: str,
    body: GenerateCarouselSlidesBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """Generate ``count`` carousel slides (text + image). Replaces any existing slides."""
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    if not settings.freepik_api_key:
        raise HTTPException(status_code=503, detail="FREEPIK_API_KEY not configured")
    row = _load_session(supabase, client_id, session_id)
    _ensure_carousel_session(row)

    client_row = _client_row_for_session(supabase, client_id)
    chosen = _chosen_angle(row)
    hook_text = _carousel_hook_text(row)
    try:
        texts = run_carousel_slide_texts(
            settings,
            client_row=client_row,
            chosen_angle=chosen,
            hook_text=hook_text,
            count=body.count,
        )
    except Exception as e:
        logger.exception("run_carousel_slide_texts failed")
        raise HTTPException(status_code=502, detail=f"Slide texts generation failed: {e}") from e

    style = (body.style or "").strip()
    slides: List[Dict[str, Any]] = []
    for i, text in enumerate(texts):
        try:
            png = generate_slide_image(
                text=text,
                idx=i,
                total=len(texts),
                freepik_key=settings.freepik_api_key,
                style=style,
            )
        except Exception as e:
            logger.exception("generate_slide_image failed for idx=%d", i)
            raise HTTPException(status_code=502, detail=f"Slide image #{i + 1} failed: {e}") from e
        url = _upload_slide_png(
            supabase, settings, client_id=client_id, session_id=session_id, idx=i, png=png
        )
        slides.append({"idx": i, "text": text, "image_url": url, "prompt": style or None})

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {"carousel_slides": slides, "updated_at": now}
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/create/sessions/{session_id}/carousel-slides/regenerate",
    response_model=GenerationSessionOut,
)
def regenerate_carousel_slide(
    slug: str,
    session_id: str,
    body: RegenerateCarouselSlideBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """Regenerate (or replace the source image of) a single slide."""
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    _ensure_carousel_session(row)
    slides = _slides_array_from_row(row)
    if not slides:
        raise HTTPException(status_code=400, detail="No carousel_slides yet — call generate first")

    target_idx = body.idx
    if not any(int(s.get("idx") or -1) == target_idx for s in slides):
        raise HTTPException(status_code=404, detail=f"Slide idx={target_idx} not found")

    new_text = (body.text or "").strip()
    if not new_text:
        for s in slides:
            if int(s.get("idx") or -1) == target_idx:
                new_text = str(s.get("text") or "").strip()
                break
    if not new_text:
        raise HTTPException(status_code=400, detail="Slide has no text to render")

    style = (body.prompt or "").strip()
    try:
        if body.image_source == "client_image":
            if not body.client_image_id:
                raise HTTPException(
                    status_code=400, detail="client_image_id required when image_source=client_image"
                )
            img_bytes = _fetch_client_image_bytes(
                supabase, client_id=client_id, image_id=body.client_image_id.strip()
            )
            png = generate_slide_image(
                text=new_text,
                idx=target_idx,
                total=len(slides),
                client_image_bytes=img_bytes,
            )
        else:
            if not settings.freepik_api_key:
                raise HTTPException(status_code=503, detail="FREEPIK_API_KEY not configured")
            png = generate_slide_image(
                text=new_text,
                idx=target_idx,
                total=len(slides),
                freepik_key=settings.freepik_api_key,
                style=style,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("regenerate slide failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    url = _upload_slide_png(
        supabase, settings, client_id=client_id, session_id=session_id, idx=target_idx, png=png
    )

    updated: List[Dict[str, Any]] = []
    for s in slides:
        if int(s.get("idx") or -1) == target_idx:
            updated.append(
                {
                    "idx": target_idx,
                    "text": new_text,
                    "image_url": url,
                    "prompt": style or s.get("prompt"),
                }
            )
        else:
            updated.append(s)

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {"carousel_slides": updated, "updated_at": now}
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.patch(
    "/clients/{slug}/create/sessions/{session_id}/carousel-slides",
    response_model=GenerationSessionOut,
)
def patch_carousel_slides(
    slug: str,
    session_id: str,
    body: PatchCarouselSlidesBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Manual edit: replace text (and optionally prompt) without re-rendering images."""
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    _ensure_carousel_session(row)
    existing = {int(s.get("idx") or -1): s for s in _slides_array_from_row(row)}

    merged: List[Dict[str, Any]] = []
    for s in body.slides:
        prev = existing.get(s.idx, {})
        merged.append(
            {
                "idx": s.idx,
                "text": (s.text or "").strip(),
                # Image stays; manual text edits don't re-render. Caller must hit
                # /carousel-slides/regenerate to re-render with the new text.
                "image_url": s.image_url or prev.get("image_url"),
                "prompt": s.prompt if s.prompt is not None else prev.get("prompt"),
            }
        )
    merged.sort(key=lambda x: int(x.get("idx") or 0))

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {"carousel_slides": merged, "updated_at": now}
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.get("/clients/{slug}/create/sessions/{session_id}/carousel-slides/zip")
def download_carousel_slides_zip(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> Response:
    """Download all rendered slides as a ZIP of PNGs in slide order. Slide 1 is the cover."""
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    _ensure_carousel_session(row)
    slides = _slides_array_from_row(row)
    if not slides:
        raise HTTPException(status_code=404, detail="No slides to download")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        with httpx.Client(timeout=30) as client:
            for s in slides:
                url = str(s.get("image_url") or "").strip()
                if not url:
                    continue
                try:
                    r = client.get(url)
                    r.raise_for_status()
                except Exception as e:
                    raise HTTPException(
                        status_code=502, detail=f"Failed to fetch slide {s.get('idx')}: {e}"
                    ) from e
                idx = int(s.get("idx") or 0)
                zf.writestr(f"slide_{idx + 1:02d}.png", r.content)

    fname = f"carousel_{session_id}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/clients/{slug}/broll")
def list_broll_clips(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> list[dict]:
    _ = slug
    res = (
        supabase.table("broll_clips")
        .select("*")
        .eq("client_id", client_id)
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    return list(res.data or [])


async def _extract_broll_thumbnail(video_bytes: bytes) -> bytes | None:
    """Extract a JPEG frame at ~1 s from video bytes using ffmpeg.

    Best-effort — returns None if ffmpeg is unavailable or extraction fails.
    """
    vpath = ""
    tpath = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as vf:
            vf.write(video_bytes)
            vpath = vf.name
        tpath = vpath.replace(".mp4", "_thumb.jpg")
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-ss", "1", "-i", vpath,
            "-vframes", "1", "-q:v", "3", tpath,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=30)
        if proc.returncode == 0 and os.path.isfile(tpath):
            with open(tpath, "rb") as f:
                return f.read()
    except Exception:
        pass
    finally:
        for p in (vpath, tpath):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass
    return None


@router.post("/clients/{slug}/broll")
async def upload_broll_clip(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
    label: Annotated[Optional[str], Form()] = None,
) -> dict:
    _ = slug
    raw = file.filename or "clip.mp4"
    if not raw.lower().endswith(".mp4"):
        raise HTTPException(status_code=415, detail="Only .mp4 files are supported")
    data = await file.read()
    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 80 MB)")

    clip_id = str(uuid.uuid4())
    path = f"{client_id}/{clip_id}.mp4"
    try:
        supabase.storage.from_(BROLL_BUCKET).upload(
            path,
            data,
            {"content-type": "video/mp4", "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e

    url = _public_object_url(settings.supabase_url, BROLL_BUCKET, path)

    # Extract thumbnail — best-effort, never fails the upload
    thumb_url: Optional[str] = None
    thumb_bytes = await _extract_broll_thumbnail(data)
    if thumb_bytes:
        thumb_path = f"{client_id}/{clip_id}_thumb.jpg"
        try:
            supabase.storage.from_(BROLL_BUCKET).upload(
                thumb_path,
                thumb_bytes,
                {"content-type": "image/jpeg", "upsert": "true"},
            )
            thumb_url = _public_object_url(settings.supabase_url, BROLL_BUCKET, thumb_path)
        except Exception:
            pass  # thumbnail is non-critical

    now = _now_iso()
    ins = (
        supabase.table("broll_clips")
        .insert(
            {
                "id": clip_id,
                "client_id": client_id,
                "file_url": url,
                "thumbnail_url": thumb_url,
                "label": (label or "").strip()[:200] or None,
                "created_at": now,
            }
        )
        .execute()
    )
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to create broll_clips row")
    return dict(ins.data[0])


@router.delete("/clients/{slug}/broll/{clip_id}", status_code=204)
def delete_broll_clip(
    slug: str,
    clip_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> None:
    _ = slug
    res = (
        supabase.table("broll_clips")
        .select("id, file_url")
        .eq("id", clip_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    row = dict(res.data[0])
    path = f"{client_id}/{clip_id}.mp4"
    try:
        supabase.storage.from_(BROLL_BUCKET).remove([path])
    except Exception:
        pass
    supabase.table("broll_clips").delete().eq("id", clip_id).eq("client_id", client_id).execute()
