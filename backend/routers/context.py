"""Client brain: upload PDF/DOCX → extracted text; transcript → AI draft sections."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase
from core.deps import require_org_access, resolve_client_id
from services.client_context_generate import generate_sections_from_transcript
from services.context_extract import extract_text_from_upload

router = APIRouter(prefix="/api/v1", tags=["context"])

STORAGE_BUCKET = "client-context"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

ALLOWED_SECTIONS = frozenset(
    {
        "icp",
        "brand_map",
        "story_board",
        "communication_guideline",
        "offer_documentation",
        "onboarding_transcript",
    }
)


def _safe_ext(filename: str) -> str:
    lower = (filename or "").lower()
    if lower.endswith(".pdf"):
        return ".pdf"
    if lower.endswith(".docx"):
        return ".docx"
    return ""


def _display_name(filename: str) -> str:
    base = (filename or "upload").split("/")[-1].strip() or "upload"
    return base[:200]


class ContextGenerateBody(BaseModel):
    transcript: str = Field(..., min_length=40, max_length=200_000)


@router.post("/clients/{slug}/context/upload")
async def upload_context_file(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    section: Annotated[str, Form()],
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Store file in Supabase Storage and return extracted plain text (caller saves via PUT client)."""
    _ = org_id
    sec = (section or "").strip()
    if sec not in ALLOWED_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid section. Allowed: {', '.join(sorted(ALLOWED_SECTIONS))}",
        )
    raw_name = file.filename or "upload"
    ext = _safe_ext(raw_name)
    if not ext:
        raise HTTPException(status_code=415, detail="Only .pdf and .docx files are supported.")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")

    try:
        mime, text = extract_text_from_upload(raw_name, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    if len(text) > 200_000:
        text = text[:200_000]

    storage_path = f"{client_id}/{sec}/{uuid.uuid4().hex}{ext}"
    uploaded_at = datetime.now(timezone.utc).isoformat()

    try:
        # storage3 forwards `upsert` to the `x-upsert` header — must be str, not bool (httpx).
        supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            data,
            {"content-type": mime, "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Storage upload failed (create bucket '{STORAGE_BUCKET}' and run phase4 SQL): {e}",
        ) from e

    return {
        "section": sec,
        "text": text,
        "file": {
            "name": _display_name(raw_name),
            "storage_path": storage_path,
            "uploaded_at": uploaded_at,
        },
    }


@router.post("/clients/{slug}/context/generate")
def generate_client_context_drafts(
    slug: str,
    body: ContextGenerateBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Draft the five strategy sections from a transcript; does not persist."""
    _ = org_id
    _ = client_id
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY not configured",
        )
    try:
        sections = generate_sections_from_transcript(
            openrouter_key=settings.openrouter_api_key,
            model=settings.openrouter_model,
            transcript=body.transcript,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {"sections": sections}
