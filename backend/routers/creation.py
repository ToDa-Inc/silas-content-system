"""Phase 4: visual-format sessions (content ready or approved) → background + Remotion render."""

from __future__ import annotations

import asyncio
import io
import logging
import math
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
from core.database import get_supabase
from core.deps import require_org_access, resolve_client_id
from core.id_generator import generate_job_id
from models.generation import (
    CarouselSlide,
    GenerateCarouselSlidesBody,
    GenerationSessionOut,
    PatchCarouselSlidesBody,
    PatchVideoSpecBody,
    PromptVideoSpecBody,
    RegenerateCarouselSlideBody,
)
from routers.generation import _load_session, _now_iso, _row_to_out
from services.content_generation import get_chosen_angle, run_carousel_slide_texts
from services.format_classifier import canonicalize_stored_format_key
from services.image_generation import (
    CAROUSEL_SLIDE_H,
    CAROUSEL_SLIDE_W,
    build_background_image_prompt,
    compose_carousel_final_png,
    generate_freepik_washed_background_png,
    generate_image_via_openrouter,
    generate_slide_image,
    prepare_carousel_base_png_bytes,
)
from services.job_queue import has_active_job
from services.video_render import RENDERS_BUCKET, recover_stale_video_render_jobs, run_video_render_job
from services.video_spec_defaults import (
    finalize_spec_for_render,
    fit_spec_blocks_to_broll,
    hydrate_video_spec_broll_duration_if_needed,
    merge_primary_hook_into_hooks_array,
    persist_finalize_spec,
    video_spec_to_text_blocks,
)
from services.video_spec_edit import propose_spec_patch_with_retry
from services.video_spec_patch import apply_ops_to_spec
from services.broll_normalize import NORMALIZE_STATUS_PENDING, broll_playback_url
from services.video_probe import ffprobe_duration_seconds

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["creation"])


def _enqueue_broll_normalize_job(
    supabase: Client,
    *,
    client_id: str,
    clip_id: str,
    org_id: Optional[str] = None,
) -> None:
    row: Dict[str, Any] = {
        "id": generate_job_id(),
        "client_id": client_id,
        "job_type": "broll_normalize",
        "payload": {"clip_id": clip_id},
        "status": "queued",
        "priority": 18,
    }
    if org_id:
        row["org_id"] = org_id
    supabase.table("background_jobs").insert(row).execute()


def _dispatch_video_render_job(job_id: str) -> None:
    """Post-response hook: run Remotion in-process if the worker has not claimed the row yet."""
    try:
        run_video_render_job(get_settings(), job_id, from_worker=False)
    except Exception:
        logger.exception("Inline video_render task crashed for job %s", job_id)

VISUAL_FORMATS = frozenset({"text_overlay", "b_roll_reel", "carousel"})
CREATE_ELIGIBLE_STATUSES = frozenset({"content_ready", "approved"})
BROLL_BUCKET = "broll"


def _client_brand_row(supabase: Client, client_id: str) -> Optional[Dict[str, Any]]:
    """Slice for video_spec; `{}` when `brand_theme` column missing (run `phase21_client_brand.sql`)."""
    try:
        c = (
            supabase.table("clients")
            .select("brand_theme")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        msg = str(e)
        arg0 = e.args[0] if getattr(e, "args", None) else None
        if isinstance(arg0, dict):
            msg = f"{msg} {arg0.get('message', '')} {arg0.get('code', '')}"
        if "brand_theme" in msg and ("42703" in msg or "does not exist" in msg):
            return {}
        raise
    if c.data:
        return dict(c.data[0])
    return None


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
    out = _load_session(supabase, client_id, session_id)
    if patch.get("text_blocks") is not None and not _is_carousel_session(out):
        if _effective_create_format_key(out) in ("text_overlay", "b_roll_reel"):
            persist_finalize_spec(
                supabase,
                session_id=session_id,
                client_id=client_id,
                session_row=dict(out),
                client_row=_client_brand_row(supabase, client_id),
                updated_at_iso=_now_iso(),
            )
            out = _load_session(supabase, client_id, session_id)
    return _row_to_out(out)


@router.patch("/clients/{slug}/create/sessions/{session_id}/spec", response_model=GenerationSessionOut)
def patch_session_video_spec(
    slug: str,
    session_id: str,
    body: PatchVideoSpecBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Apply JSON Patch to ``video_spec``; mirrors overlay lines into ``text_blocks``."""
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row) or _is_carousel_session(row):
        raise HTTPException(status_code=400, detail="Video spec only applies to text_overlay / b_roll_reel sessions")
    if _effective_create_format_key(row) not in ("text_overlay", "b_roll_reel"):
        raise HTTPException(status_code=400, detail="Video spec only applies to MP4 visual formats")
    raw = row.get("video_spec")
    base: Dict[str, Any] = dict(raw) if isinstance(raw, dict) else {}
    if not base:
        try:
            spec0 = finalize_spec_for_render(
                dict(row),
                client_row=_client_brand_row(supabase, client_id),
                supabase=supabase,
            )
            base = spec0.model_dump(mode="json")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        new_spec = apply_ops_to_spec(base, body.ops)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    new_spec = hydrate_video_spec_broll_duration_if_needed(new_spec, dict(row), supabase)
    tb = video_spec_to_text_blocks(new_spec)
    now = _now_iso()
    hook_sync = merge_primary_hook_into_hooks_array(row.get("hooks"), str(new_spec.hook.text or ""))
    update_payload: Dict[str, Any] = {
        "video_spec": new_spec.model_dump(mode="json"),
        "text_blocks": tb,
        "updated_at": now,
    }
    if hook_sync is not None:
        update_payload["hooks"] = hook_sync
    supabase.table("generation_sessions").update(update_payload).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post("/clients/{slug}/create/sessions/{session_id}/spec/fit-to-broll", response_model=GenerationSessionOut)
def post_fit_session_spec_to_broll(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    """Shrink block durations so the timeline fits ``background.durationSec`` (hook + gaps unchanged)."""
    _ = slug
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row) or _is_carousel_session(row):
        raise HTTPException(status_code=400, detail="Video spec only applies to text_overlay / b_roll_reel sessions")
    if _effective_create_format_key(row) not in ("text_overlay", "b_roll_reel"):
        raise HTTPException(status_code=400, detail="Video spec only applies to MP4 visual formats")
    try:
        spec0 = finalize_spec_for_render(
            dict(row),
            client_row=_client_brand_row(supabase, client_id),
            supabase=supabase,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        new_spec = fit_spec_blocks_to_broll(spec0)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    tb = video_spec_to_text_blocks(new_spec)
    now = _now_iso()
    hook_sync = merge_primary_hook_into_hooks_array(row.get("hooks"), str(new_spec.hook.text or ""))
    update_payload: Dict[str, Any] = {
        "video_spec": new_spec.model_dump(mode="json"),
        "text_blocks": tb,
        "updated_at": now,
    }
    if hook_sync is not None:
        update_payload["hooks"] = hook_sync
    supabase.table("generation_sessions").update(update_payload).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post("/clients/{slug}/create/sessions/{session_id}/spec/prompt-edit")
def prompt_edit_session_video_spec(
    slug: str,
    session_id: str,
    body: PromptVideoSpecBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """LLM proposes JSON Patch ops + validated preview spec (not persisted until PATCH /spec)."""
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    row = _load_session(supabase, client_id, session_id)
    if not _session_eligible_for_create(row) or _is_carousel_session(row):
        raise HTTPException(status_code=400, detail="Video spec only applies to text_overlay / b_roll_reel sessions")
    if _effective_create_format_key(row) not in ("text_overlay", "b_roll_reel"):
        raise HTTPException(status_code=400, detail="Video spec only applies to MP4 visual formats")
    raw = row.get("video_spec")
    base: Dict[str, Any] = dict(raw) if isinstance(raw, dict) else {}
    if not base:
        try:
            spec0 = finalize_spec_for_render(
                dict(row),
                client_row=_client_brand_row(supabase, client_id),
                supabase=supabase,
            )
            base = spec0.model_dump(mode="json")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    lang = "de"
    try:
        cr = (
            supabase.table("clients")
            .select("language")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        if cr.data and isinstance(cr.data[0], dict):
            lang = str(cr.data[0].get("language") or "de").strip() or "de"
    except Exception:
        pass
    ops, summary = propose_spec_patch_with_retry(
        openrouter_key=settings.openrouter_api_key,
        model=settings.openrouter_model,
        current_spec=base,
        instruction=body.instruction,
        language=lang,
    )
    try:
        preview = apply_ops_to_spec(base, ops)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Model patch invalid: {e}") from e
    return {
        "ops": ops,
        "summary": summary,
        "preview_spec": preview.model_dump(mode="json"),
    }


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
    out = _load_session(supabase, client_id, session_id)
    persist_finalize_spec(
        supabase,
        session_id=session_id,
        client_id=client_id,
        session_row=dict(out),
        client_row=_client_brand_row(supabase, client_id),
        updated_at_iso=_now_iso(),
    )
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
        .select("id, file_url, master_url")
        .eq("id", cid)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not cres.data:
        raise HTTPException(status_code=404, detail="B-roll clip not found")
    clip = dict(cres.data[0])
    playback_url = broll_playback_url(clip)
    if not playback_url:
        raise HTTPException(status_code=400, detail="Clip has no file_url")

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {
            "background_type": "broll",
            "background_url": playback_url,
            "broll_clip_id": cid,
            "client_image_id": None,
            "updated_at": now,
        }
    ).eq("id", session_id).execute()
    out = _load_session(supabase, client_id, session_id)
    persist_finalize_spec(
        supabase,
        session_id=session_id,
        client_id=client_id,
        session_row=dict(out),
        client_row=_client_brand_row(supabase, client_id),
        updated_at_iso=_now_iso(),
    )
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
    out = _load_session(supabase, client_id, session_id)
    persist_finalize_spec(
        supabase,
        session_id=session_id,
        client_id=client_id,
        session_row=dict(out),
        client_row=_client_brand_row(supabase, client_id),
        updated_at_iso=_now_iso(),
    )
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post("/clients/{slug}/create/sessions/{session_id}/render")
def queue_session_render(
    slug: str,
    session_id: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    _ = slug
    recover_stale_video_render_jobs(get_settings())
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
        if has_active_job(
            supabase,
            client_id=client_id,
            job_type="video_render",
            payload_match={"session_id": session_id},
        ):
            raise HTTPException(status_code=409, detail="A render is already in progress for this session")
        now_clear = _now_iso()
        supabase.table("generation_sessions").update(
            {
                "render_status": "failed",
                "render_error": (
                    "Previous render had no active worker job (API reload, worker stopped, or DB drift). "
                    "Try render again."
                ),
                "render_progress_pct": None,
                "updated_at": now_clear,
            }
        ).eq("id", session_id).execute()
        row = _load_session(supabase, client_id, session_id)
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
    try:
        fin = finalize_spec_for_render(
            dict(row),
            client_row=_client_brand_row(supabase, client_id),
            supabase=supabase,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not fin.blocks:
        raise HTTPException(status_code=400, detail="Session needs non-empty overlay blocks (text_blocks)")

    job_id = generate_job_id()
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("background_jobs").insert(
        {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "video_render",
            "payload": {"session_id": session_id},
            "status": "queued",
            "priority": 25,
        }
    ).execute()

    supabase.table("generation_sessions").update(
        {"render_status": "rendering", "render_error": None, "updated_at": now}
    ).eq("id", session_id).execute()

    background_tasks.add_task(_dispatch_video_render_job, job_id)
    return {"job_id": job_id, "status": "queued"}


# ── Carousel slides ───────────────────────────────────────────────────────────

_MAX_REFERENCE_IMAGE_BYTES = 15 * 1024 * 1024


def _slides_array_from_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = row.get("carousel_slides")
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for s in raw:
        if isinstance(s, dict):
            out.append(s)
    out.sort(key=lambda x: _slide_idx(x, default=0))
    return out


def _slide_idx(slide: Dict[str, Any], *, default: int = -1) -> int:
    raw = slide.get("idx")
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


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
            data = r.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch client image: {e}") from e
    if len(data) > _MAX_REFERENCE_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Reference image is too large (max 15 MB).")
    return data


def _fetch_url_image_bytes(url: str) -> bytes:
    u = (url or "").strip()
    if not u.lower().startswith("https://"):
        raise HTTPException(
            status_code=400,
            detail="Template reference_image_url must be an https URL.",
        )
    try:
        with httpx.Client(timeout=30) as client:
            r = client.get(u, follow_redirects=True)
            r.raise_for_status()
            data = r.content
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502, detail=f"Failed to download template reference image: {e}"
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"Failed to download template reference image: {e}"
        ) from e
    if len(data) > _MAX_REFERENCE_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Reference image is too large (max 15 MB).")
    ct = (r.headers.get("content-type") or "").lower()
    if "image" not in ct and not u.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(
            status_code=400,
            detail="Template reference_image_url did not return an image (check content-type or URL).",
        )
    return data


def _resolve_template_slide_image_bytes(
    supabase: Client, client_id: str, slide: Dict[str, Any], *, slide_idx: int
) -> bytes:
    ref_id = slide.get("reference_image_id")
    if isinstance(ref_id, str) and ref_id.strip():
        return _fetch_client_image_bytes(supabase, client_id=client_id, image_id=ref_id.strip())
    ref_url = slide.get("reference_image_url")
    if isinstance(ref_url, str) and ref_url.strip():
        return _fetch_url_image_bytes(ref_url.strip())
    raise HTTPException(
        status_code=400,
        detail=f"Carousel template slide {slide_idx + 1} is missing reference_image_id and reference_image_url.",
    )


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


def _upload_slide_base_png(
    supabase: Client, settings: Settings, *, client_id: str, session_id: str, idx: int, png: bytes
) -> str:
    path = f"{client_id}/carousel_base_{session_id}_{idx:02d}.png"
    try:
        supabase.storage.from_(RENDERS_BUCKET).upload(
            path,
            png,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage upload failed: {e}") from e
    return _public_object_url(settings.supabase_url, RENDERS_BUCKET, path)


def _default_carousel_text_box_dict(role: str) -> Dict[str, Any]:
    r = (role or "body").strip().lower()
    if r == "cover":
        return {"x": 0.5, "y": 0.42, "width": 0.88, "align": "center", "scale": 1.05, "card": False}
    if r == "cta":
        return {"x": 0.5, "y": 0.85, "width": 0.8, "align": "center", "scale": 1.0, "card": True}
    return {"x": 0.5, "y": 0.82, "width": 0.84, "align": "center", "scale": 1.0, "card": False}


def _merge_carousel_text_box_dict(
    role: str,
    body_tb: Any,
    prev: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    merged = _default_carousel_text_box_dict(role)
    if body_tb is not None:
        patch = (
            body_tb.model_dump(mode="json")
            if hasattr(body_tb, "model_dump")
            else (body_tb if isinstance(body_tb, dict) else {})
        )
        merged.update({k: v for k, v in patch.items() if v is not None})
        return merged
    prev_tb = (prev or {}).get("text_box")
    if isinstance(prev_tb, dict) and prev_tb:
        merged.update({k: v for k, v in prev_tb.items() if v is not None})
    return merged


def _default_carousel_background_style_dict() -> Dict[str, Any]:
    return {"overlay_color": "#ffffff", "overlay_opacity": 0.0}


def _merge_carousel_background_style_dict(
    body_bg: Any,
    prev: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    merged = _default_carousel_background_style_dict()
    if body_bg is not None:
        patch = (
            body_bg.model_dump(mode="json")
            if hasattr(body_bg, "model_dump")
            else (body_bg if isinstance(body_bg, dict) else {})
        )
        merged.update({k: v for k, v in patch.items() if v is not None})
        return merged
    prev_bg = (prev or {}).get("background_style")
    if isinstance(prev_bg, dict) and prev_bg:
        merged.update({k: v for k, v in prev_bg.items() if v is not None})
    return merged


def _use_legacy_carousel_render(prev: Dict[str, Any], body_tb: Any) -> bool:
    """Decide whether to fall back to the legacy layout-only Pillow path.

    Canonical (post UX overhaul): the frontend ALWAYS sends a ``text_box``
    (defaults applied via ``mergeCarouselTextBox`` in the workspace), and the
    backend composes via ``compose_carousel_final_png``. This is the single
    source of truth used by Fabric live preview, ZIP export, and regenerate.

    Legacy: pre-``text_box`` slides only have a ``layout`` dict. Those rows are
    rendered with the layout-only Pillow overlay so re-opening an old session
    doesn't repaint with default text_box geometry. New slides never enter this
    branch.

    TODO(carousel-render): once a backfill migration writes default ``text_box``
    onto all legacy rows, drop this helper and the layout-only branches in
    :func:`carousel_slide_regenerate`.
    """
    if body_tb is not None:
        return False
    prev_tb = prev.get("text_box")
    if isinstance(prev_tb, dict) and prev_tb:
        return False
    lay = prev.get("layout")
    return isinstance(lay, dict) and bool(lay)


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


def _template_slides_from_row(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    template = row.get("selected_carousel_template")
    if not isinstance(template, dict):
        return []
    raw = template.get("slides")
    if not isinstance(raw, list):
        return []
    slides = [s for s in raw if isinstance(s, dict)]
    slides.sort(key=lambda s: _slide_idx(s, default=0))
    return slides[:10]


def _resolve_template_slide_for_idx(
    idx: int, total: int, template_slides: List[Dict[str, Any]]
) -> Dict[str, Any]:
    if not template_slides:
        return {}

    # 1. First slide (Cover)
    if idx == 0:
        for s in template_slides:
            if str(s.get("role") or "").strip().lower() == "cover":
                return s
        return template_slides[0]

    # 2. Last slide (CTA)
    if total > 1 and idx == total - 1:
        for s in reversed(template_slides):
            if str(s.get("role") or "").strip().lower() == "cta":
                return s
        return template_slides[-1]

    # 3. Intermediate slides (0 < idx < total - 1)
    # Find cover and cta to exclude
    cover_to_exclude = None
    for s in template_slides:
        if str(s.get("role") or "").strip().lower() == "cover":
            cover_to_exclude = s
            break
    if cover_to_exclude is None:
        cover_to_exclude = template_slides[0]

    cta_to_exclude = None
    if len(template_slides) > 1:
        for s in reversed(template_slides):
            if str(s.get("role") or "").strip().lower() == "cta":
                cta_to_exclude = s
                break
        if cta_to_exclude is None:
            cta_to_exclude = template_slides[-1]

    # Candidates are slides that are not cover or cta
    candidates = []
    for s in template_slides:
        if s is not cover_to_exclude and s is not cta_to_exclude:
            candidates.append(s)

    # If candidates is empty (e.g. template of size 2 where one is cover and one is cta),
    # then fallback to excluding only cover
    if not candidates:
        for s in template_slides:
            if s is not cover_to_exclude:
                candidates.append(s)

    # If still empty (e.g. template of size 1), fallback to all slides
    if not candidates:
        candidates = template_slides

    # Cycle through body candidates
    body_idx = (idx - 1) % len(candidates)
    return candidates[body_idx]


def carousel_slide_count_effective(row: Dict[str, Any], requested_count: int) -> int:
    """Prefer ``generation_sessions.carousel_slide_count``; else clamp ``requested_count`` to 3–10."""
    raw = row.get("carousel_slide_count")
    if raw is not None:
        try:
            return max(3, min(10, int(raw)))
        except (TypeError, ValueError):
            pass
    return max(3, min(10, int(requested_count or 6)))


def _visual_prompt_for_template_slide(slide: Dict[str, Any]) -> str:
    role = str(slide.get("role") or "body").strip()
    label = str(slide.get("reference_label") or "").strip()
    instruction = str(slide.get("instruction") or "").strip()
    parts = []
    if role:
        parts.append(f"role: {role}")
    if label:
        parts.append(f"reference visual: {label}")
    if instruction:
        parts.append(instruction)
    return "; ".join(parts)


def _carousel_slide_role_for_idx(
    idx: int, total: int, template_slide: Dict[str, Any]
) -> str:
    r = str(template_slide.get("role") or "").strip().lower()
    if r in ("cover", "cta", "body"):
        return r
    if idx == 0:
        return "cover"
    if total > 0 and idx == total - 1:
        return "cta"
    return "body"


def build_carousel_slides_payload(
    supabase: Client,
    settings: Settings,
    *,
    client_id: str,
    session_id: str,
    row: Dict[str, Any],
    body: GenerateCarouselSlidesBody,
) -> List[Dict[str, Any]]:
    """Build ``carousel_slides`` rows (text + composed PNGs). Caller persists to DB."""
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    client_row = _client_row_for_session(supabase, client_id)
    chosen = _chosen_angle(row)
    hook_text = _carousel_hook_text(row)
    selected_cta = row.get("selected_cta") if isinstance(row.get("selected_cta"), dict) else None
    selected_template = (
        row.get("selected_carousel_template")
        if isinstance(row.get("selected_carousel_template"), dict)
        else None
    )
    template_slides = _template_slides_from_row(row)
    uses_template_images = bool(template_slides)
    slide_count = carousel_slide_count_effective(row, body.count)
    if not uses_template_images and not settings.freepik_api_key:
        raise HTTPException(status_code=503, detail="FREEPIK_API_KEY not configured")
    try:
        texts = run_carousel_slide_texts(
            settings,
            client_row=client_row,
            chosen_angle=chosen,
            hook_text=hook_text,
            count=slide_count,
            selected_cta=selected_cta,
            selected_carousel_template=selected_template,
        )
    except Exception as e:
        logger.exception("run_carousel_slide_texts failed")
        raise HTTPException(status_code=502, detail=f"Slide texts generation failed: {e}") from e

    if len(texts) != slide_count:
        raise HTTPException(
            status_code=502,
            detail=f"Slide text generator returned {len(texts)} slides; expected {slide_count}.",
        )

    style = (body.style or "").strip()
    template_id = (
        str(selected_template.get("id") or "").strip()
        if isinstance(selected_template, dict)
        else ""
    )
    slides: List[Dict[str, Any]] = []
    for i, text in enumerate(texts):
        if uses_template_images:
            template_slide = _resolve_template_slide_for_idx(i, len(texts), template_slides)
        else:
            template_slide = {}
        slide_role = _carousel_slide_role_for_idx(i, len(texts), template_slide)
        text_box_dict = _merge_carousel_text_box_dict(slide_role, None, None)
        background_style_dict = _merge_carousel_background_style_dict(None, None)
        visual_prompt = _visual_prompt_for_template_slide(template_slide)
        try:
            if uses_template_images:
                img_bytes = _resolve_template_slide_image_bytes(
                    supabase, client_id, template_slide, slide_idx=i
                )
                base_png = prepare_carousel_base_png_bytes(
                    img_bytes, wash=False, target_w=CAROUSEL_SLIDE_W, target_h=CAROUSEL_SLIDE_H
                )
                base_url = _upload_slide_base_png(
                    supabase, settings, client_id=client_id, session_id=session_id, idx=i, png=base_png
                )
                png = compose_carousel_final_png(
                    base_png, text, text_box_dict, carousel_slide_role=slide_role
                )
                prompt_meta = (
                    f"template:{template_id or 'unknown'}:slide:{i}"
                    if template_id
                    else f"template_slide:{i}"
                )
            else:
                if not settings.freepik_api_key:
                    raise HTTPException(status_code=503, detail="FREEPIK_API_KEY not configured")
                ctx_parts = [
                    p
                    for p in (
                        style,
                        visual_prompt,
                        f"slide {i + 1}/{len(texts)} ({slide_role})",
                    )
                    if p
                ]
                base_png = generate_freepik_washed_background_png(
                    settings.freepik_api_key,
                    ", ".join(ctx_parts),
                    target_w=CAROUSEL_SLIDE_W,
                    target_h=CAROUSEL_SLIDE_H,
                )
                base_url = _upload_slide_base_png(
                    supabase, settings, client_id=client_id, session_id=session_id, idx=i, png=base_png
                )
                png = compose_carousel_final_png(
                    base_png, text, text_box_dict, carousel_slide_role=slide_role
                )
                prompt_meta = style or visual_prompt or None
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("generate_slide_image failed for idx=%d", i)
            raise HTTPException(status_code=502, detail=f"Slide image #{i + 1} failed: {e}") from e
        url = _upload_slide_png(
            supabase, settings, client_id=client_id, session_id=session_id, idx=i, png=png
        )
        slides.append({
            "idx": i,
            "text": text,
            "base_image_url": base_url,
            "text_box": text_box_dict,
            "background_style": background_style_dict,
            "image_url": url,
            "prompt": prompt_meta,
        })
    return slides


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
    row = _load_session(supabase, client_id, session_id)
    _ensure_carousel_session(row)

    slides = build_carousel_slides_payload(
        supabase,
        settings,
        client_id=client_id,
        session_id=session_id,
        row=row,
        body=body,
    )

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
    if not any(_slide_idx(s) == target_idx for s in slides):
        raise HTTPException(status_code=404, detail=f"Slide idx={target_idx} not found")

    new_text = (body.text or "").strip()
    if not new_text:
        for s in slides:
            if _slide_idx(s) == target_idx:
                new_text = str(s.get("text") or "").strip()
                break
    if not new_text:
        raise HTTPException(status_code=400, detail="Slide has no text to render")

    style = (body.prompt or "").strip()
    template_slides = _template_slides_from_row(row)
    if template_slides:
        template_slide = _resolve_template_slide_for_idx(target_idx, len(slides), template_slides)
    else:
        template_slide = {}
    slide_role = _carousel_slide_role_for_idx(target_idx, len(slides), template_slide)
    visual_prompt = _visual_prompt_for_template_slide(template_slide)
    sel_tpl = row.get("selected_carousel_template")
    template_id_str = (
        str(sel_tpl.get("id") or "").strip() if isinstance(sel_tpl, dict) else ""
    )
    uses_saved_template_slide = bool(template_slides)

    prev_target = next(s for s in slides if _slide_idx(s) == target_idx)
    layout_for_render: Any = None
    if body.layout is not None:
        layout_for_render = body.layout.model_dump(mode="json")
    elif isinstance(prev_target.get("layout"), dict):
        layout_for_render = prev_target["layout"]
    layout_to_store = layout_for_render

    use_legacy = _use_legacy_carousel_render(prev_target, body.text_box)

    try:
        if use_legacy:
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
                    wash_template_base=True,
                    carousel_slide_role=slide_role,
                    layout=layout_for_render,
                )
                prompt_val = style or visual_prompt or None
            elif body.image_source == "ai" and uses_saved_template_slide:
                img_bytes = _resolve_template_slide_image_bytes(
                    supabase, client_id, template_slide, slide_idx=target_idx
                )
                png = generate_slide_image(
                    text=new_text,
                    idx=target_idx,
                    total=len(slides),
                    freepik_key=settings.freepik_api_key or "",
                    style=style,
                    visual_prompt=visual_prompt,
                    client_image_bytes=img_bytes,
                    wash_template_base=False,
                    carousel_slide_role=slide_role,
                    layout=layout_for_render,
                )
                prompt_val = (
                    f"template:{template_id_str or 'unknown'}:slide:{target_idx}"
                    if template_id_str
                    else f"template_slide:{target_idx}"
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
                    visual_prompt=visual_prompt,
                    layout=layout_for_render,
                )
                prompt_val = style or visual_prompt or None

            url = _upload_slide_png(
                supabase, settings, client_id=client_id, session_id=session_id, idx=target_idx, png=png
            )

            updated: List[Dict[str, Any]] = []
            for s in slides:
                if _slide_idx(s) == target_idx:
                    row_out: Dict[str, Any] = {
                        "idx": target_idx,
                        "text": new_text,
                        "image_url": url,
                        "prompt": prompt_val,
                    }
                    if layout_to_store is not None:
                        row_out["layout"] = layout_to_store
                    updated.append(row_out)
                else:
                    updated.append(s)

            now = _now_iso()
            supabase.table("generation_sessions").update(
                {"carousel_slides": updated, "updated_at": now}
            ).eq("id", session_id).execute()
            return _row_to_out(_load_session(supabase, client_id, session_id))

        tb_dict = _merge_carousel_text_box_dict(slide_role, body.text_box, prev_target)
        bg_style_dict = _merge_carousel_background_style_dict(None, prev_target)

        if body.image_source == "client_image":
            if not body.client_image_id:
                raise HTTPException(
                    status_code=400, detail="client_image_id required when image_source=client_image"
                )
            img_bytes = _fetch_client_image_bytes(
                supabase, client_id=client_id, image_id=body.client_image_id.strip()
            )
            base_png = prepare_carousel_base_png_bytes(
                img_bytes, wash=False, target_w=CAROUSEL_SLIDE_W, target_h=CAROUSEL_SLIDE_H
            )
            base_url = _upload_slide_base_png(
                supabase,
                settings,
                client_id=client_id,
                session_id=session_id,
                idx=target_idx,
                png=base_png,
            )
            png = compose_carousel_final_png(
                base_png, new_text, tb_dict, carousel_slide_role=slide_role
            )
            prompt_val = style or visual_prompt or None
        elif body.image_source == "ai" and uses_saved_template_slide:
            img_bytes = _resolve_template_slide_image_bytes(
                supabase, client_id, template_slide, slide_idx=target_idx
            )
            base_png = prepare_carousel_base_png_bytes(
                img_bytes, wash=False, target_w=CAROUSEL_SLIDE_W, target_h=CAROUSEL_SLIDE_H
            )
            base_url = _upload_slide_base_png(
                supabase,
                settings,
                client_id=client_id,
                session_id=session_id,
                idx=target_idx,
                png=base_png,
            )
            png = compose_carousel_final_png(
                base_png, new_text, tb_dict, carousel_slide_role=slide_role
            )
            prompt_val = (
                f"template:{template_id_str or 'unknown'}:slide:{target_idx}"
                if template_id_str
                else f"template_slide:{target_idx}"
            )
        else:
            if not settings.freepik_api_key:
                raise HTTPException(status_code=503, detail="FREEPIK_API_KEY not configured")
            ctx_parts = [
                p
                for p in (
                    style,
                    visual_prompt,
                    f"slide {target_idx + 1}/{len(slides)} ({slide_role})",
                )
                if p
            ]
            base_png = generate_freepik_washed_background_png(
                settings.freepik_api_key,
                ", ".join(ctx_parts),
                target_w=CAROUSEL_SLIDE_W,
                target_h=CAROUSEL_SLIDE_H,
            )
            base_url = _upload_slide_base_png(
                supabase,
                settings,
                client_id=client_id,
                session_id=session_id,
                idx=target_idx,
                png=base_png,
            )
            png = compose_carousel_final_png(
                base_png, new_text, tb_dict, carousel_slide_role=slide_role
            )
            prompt_val = style or visual_prompt or None

        url = _upload_slide_png(
            supabase, settings, client_id=client_id, session_id=session_id, idx=target_idx, png=png
        )

        updated2: List[Dict[str, Any]] = []
        for s in slides:
            if _slide_idx(s) == target_idx:
                row_comp: Dict[str, Any] = {
                    "idx": target_idx,
                    "text": new_text,
                    "base_image_url": base_url,
                    "image_url": url,
                    "prompt": prompt_val,
                    "text_box": tb_dict,
                    "background_style": bg_style_dict,
                }
                updated2.append(row_comp)
            else:
                updated2.append(s)

        now2 = _now_iso()
        supabase.table("generation_sessions").update(
            {"carousel_slides": updated2, "updated_at": now2}
        ).eq("id", session_id).execute()
        return _row_to_out(_load_session(supabase, client_id, session_id))

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("regenerate slide failed")
        raise HTTPException(status_code=502, detail=str(e)) from e


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
    existing = {_slide_idx(s): s for s in _slides_array_from_row(row)}

    merged: List[Dict[str, Any]] = []
    for s in body.slides:
        prev = existing.get(s.idx, {})
        layout_dict: Optional[Dict[str, Any]] = None
        if s.layout is not None:
            layout_dict = s.layout.model_dump(mode="json")
        elif isinstance(prev.get("layout"), dict):
            layout_dict = prev["layout"]
        row_m: Dict[str, Any] = {
            "idx": s.idx,
            "text": (s.text or "").strip(),
            "image_url": s.image_url if s.image_url is not None else prev.get("image_url"),
            "base_image_url": s.base_image_url
            if s.base_image_url is not None
            else prev.get("base_image_url"),
            "prompt": s.prompt if s.prompt is not None else prev.get("prompt"),
        }
        if s.text_box is not None:
            row_m["text_box"] = s.text_box.model_dump(mode="json")
        elif isinstance(prev.get("text_box"), dict):
            row_m["text_box"] = prev["text_box"]
        if s.background_style is not None:
            row_m["background_style"] = s.background_style.model_dump(mode="json")
        elif isinstance(prev.get("background_style"), dict):
            row_m["background_style"] = prev["background_style"]
        if layout_dict is not None:
            row_m["layout"] = layout_dict
        merged.append(row_m)
    merged.sort(key=lambda x: _slide_idx(x, default=0))

    now = _now_iso()
    supabase.table("generation_sessions").update(
        {"carousel_slides": merged, "updated_at": now}
    ).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


def _carousel_zip_slide_role(idx: int, total: int) -> str:
    if idx == 0:
        return "cover"
    if total > 1 and idx == total - 1:
        return "cta"
    return "body"


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

    total_n = len(slides)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        with httpx.Client(timeout=60) as client:
            for s in slides:
                idx = _slide_idx(s, default=0)
                base_u = str(s.get("base_image_url") or "").strip()
                tb_raw = s.get("text_box")
                text = str(s.get("text") or "")
                png_out: bytes
                if base_u and isinstance(tb_raw, dict) and tb_raw:
                    try:
                        rb = client.get(base_u)
                        rb.raise_for_status()
                        role = _carousel_zip_slide_role(idx, total_n)
                        png_out = compose_carousel_final_png(
                            rb.content, text, tb_raw, carousel_slide_role=role
                        )
                    except Exception as e:
                        raise HTTPException(
                            status_code=502,
                            detail=f"Failed to compose slide {idx} from base + text_box: {e}",
                        ) from e
                else:
                    url = str(s.get("image_url") or "").strip()
                    if not url:
                        continue
                    try:
                        r = client.get(url)
                        r.raise_for_status()
                        png_out = r.content
                    except Exception as e:
                        raise HTTPException(
                            status_code=502, detail=f"Failed to fetch slide {s.get('idx')}: {e}"
                        ) from e
                zf.writestr(f"slide_{idx + 1:02d}.png", png_out)

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

    dur_raw = ffprobe_duration_seconds(data)
    duration_sec = round(float(dur_raw), 3) if dur_raw is not None and dur_raw > 0 else None
    duration_s = int(round(dur_raw)) if dur_raw is not None and dur_raw > 0 else None

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
    clip_row: Dict[str, Any] = {
        "id": clip_id,
        "client_id": client_id,
        "file_url": url,
        "thumbnail_url": thumb_url,
        "label": (label or "").strip()[:200] or None,
        "duration_s": duration_s,
        "created_at": now,
        "normalize_status": NORMALIZE_STATUS_PENDING,
    }
    if duration_sec is not None:
        clip_row["duration_sec"] = duration_sec
    ins = supabase.table("broll_clips").insert(clip_row).execute()
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to create broll_clips row")
    try:
        _enqueue_broll_normalize_job(supabase, client_id=client_id, clip_id=clip_id)
    except Exception:
        logger.exception("Failed to enqueue broll_normalize for clip %s", clip_id)
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
