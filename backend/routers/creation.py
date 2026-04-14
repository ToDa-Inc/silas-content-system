"""Phase 4: visual-format sessions (content ready or approved) → background + Remotion render."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase, get_supabase_for_settings
from core.deps import require_org_access, resolve_client_id
from core.id_generator import generate_job_id
from models.generation import GenerationSessionOut
from routers.generation import _load_session, _now_iso, _row_to_out
from services.format_classifier import canonicalize_stored_format_key
from services.image_generation import build_background_image_prompt, generate_image_via_openrouter
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


class PatchCreateSessionBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text_blocks: Optional[List[Dict[str, Any]]] = None


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
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row):
        raise HTTPException(
            status_code=400,
            detail="Session must be content_ready or approved with a visual format (text_overlay, b_roll_reel, carousel)",
        )
    if body.text_blocks is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    tb = _normalize_patch_text_blocks(body.text_blocks)
    now = _now_iso()
    supabase.table("generation_sessions").update({"text_blocks": tb, "updated_at": now}).eq(
        "id", session_id
    ).execute()
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
    if fk not in ("text_overlay", "carousel"):
        raise HTTPException(
            status_code=400,
            detail="generate-background applies to text_overlay/carousel only; use set-broll for b_roll_reel",
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
    if fk_eff not in ("text_overlay", "carousel", "b_roll_reel"):
        raise HTTPException(
            status_code=400,
            detail="set-broll applies only to text_overlay, carousel, or b_roll_reel sessions",
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
    if not _session_eligible_for_create(row):
        raise HTTPException(
            status_code=400,
            detail="Session must be content_ready or approved with a visual format (text_overlay, b_roll_reel, carousel)",
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
