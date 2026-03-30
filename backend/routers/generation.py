"""Content generation: patterns → angles → hooks / script / caption / stories."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase
from core.deps import require_org_access, resolve_client_id
from core.id_generator import generate_generation_session_id
from models.generation import (
    GenerationChooseAngleBody,
    GenerationFeedbackBody,
    GenerationRegenerateBody,
    GenerationSessionOut,
    GenerationStartBody,
)
from services.content_generation import (
    GENERATION_PROMPT_VERSION,
    compact_analysis_for_prompt,
    angles_from_session_row,
    fetch_reel_analyses_for_generation,
    get_chosen_angle,
    run_angle_generation,
    run_content_package,
    run_pattern_synthesis,
    run_regenerate,
)

router = APIRouter(prefix="/api/v1", tags=["generation"])
logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_out(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize jsonb list fields for response_model."""
    out = dict(row)
    for key in ("source_analysis_ids", "source_reel_ids", "hashtags"):
        v = out.get(key)
        if v is None:
            continue
        if isinstance(v, list):
            out[key] = [str(x) for x in v]
    return out


def _load_session(supabase: Client, client_id: str, session_id: str) -> Dict[str, Any]:
    res = (
        supabase.table("generation_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Generation session not found")
    return dict(res.data[0])


def _load_client_for_generation(supabase: Client, client_id: str) -> Dict[str, Any]:
    res = (
        supabase.table("clients")
        .select(
            "id, name, instagram_handle, language, niche_config, icp, products, client_context, client_dna"
        )
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    return dict(res.data[0])


@router.post("/clients/{slug}/generate/start", response_model=GenerationSessionOut)
def generation_start(
    slug: str,
    body: GenerationStartBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    if body.source_type == "outlier":
        ids = body.source_analysis_ids or []
        if not ids:
            raise HTTPException(
                status_code=400,
                detail="source_analysis_ids required when source_type=outlier",
            )

    rows = fetch_reel_analyses_for_generation(
        supabase,
        client_id=client_id,
        source_type=body.source_type,
        source_analysis_ids=body.source_analysis_ids,
        max_analyses=body.max_analyses,
    )
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No reel analyses found. Run Intelligence → analyze reels first.",
        )

    client_row = _load_client_for_generation(supabase, client_id)
    packed = [compact_analysis_for_prompt(r) for r in rows]
    reel_ids = [str(r["reel_id"]) for r in rows if r.get("reel_id")]
    analysis_ids = [str(r["id"]) for r in rows if r.get("id")]

    try:
        patterns = run_pattern_synthesis(
            settings,
            client_row=client_row,
            packed_analyses=packed,
            extra_instruction=body.extra_instruction,
        )
        if not isinstance(patterns, dict):
            patterns = {}
        angles = run_angle_generation(
            settings,
            client_row=client_row,
            synthesized_patterns=patterns,
            extra_instruction=body.extra_instruction,
        )
    except Exception as e:
        logger.exception("generation start failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    if len(angles) < 3:
        raise HTTPException(
            status_code=502,
            detail="Model returned too few angles; retry or adjust analyses.",
        )

    sid = generate_generation_session_id()
    now = _now_iso()
    insert_row = {
        "id": sid,
        "client_id": client_id,
        "source_type": body.source_type,
        "source_analysis_ids": analysis_ids,
        "source_reel_ids": reel_ids or None,
        "synthesized_patterns": patterns,
        "angles": angles,
        "chosen_angle_index": None,
        "hooks": None,
        "script": None,
        "caption_body": None,
        "hashtags": None,
        "story_variants": None,
        "status": "angles_ready",
        "feedback": None,
        "prompt_version": GENERATION_PROMPT_VERSION,
        "created_at": now,
        "updated_at": now,
    }
    try:
        ins = supabase.table("generation_sessions").insert(insert_row).execute()
    except Exception as e:
        logger.exception("generation_sessions insert failed — run sql/phase6_generation_sessions.sql?")
        raise HTTPException(
            status_code=503,
            detail="Database error (is generation_sessions table created?).",
        ) from e
    if not ins.data:
        raise HTTPException(status_code=500, detail="Insert failed")
    return _row_to_out(ins.data[0])


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/choose-angle",
    response_model=GenerationSessionOut,
)
def generation_choose_angle(
    slug: str,
    session_id: str,
    body: GenerationChooseAngleBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    row = _load_session(supabase, client_id, session_id)
    angles = angles_from_session_row(row)
    if not angles:
        raise HTTPException(status_code=400, detail="Session has no angles")
    if body.angle_index < 0 or body.angle_index >= len(angles):
        raise HTTPException(status_code=400, detail="angle_index out of range")

    client_row = _load_client_for_generation(supabase, client_id)
    patterns = row.get("synthesized_patterns") if isinstance(row.get("synthesized_patterns"), dict) else {}
    chosen = angles[body.angle_index]

    try:
        package = run_content_package(
            settings,
            client_row=client_row,
            synthesized_patterns=patterns,
            chosen_angle=chosen,
        )
    except Exception as e:
        logger.exception("generation choose-angle failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    now = _now_iso()
    patch = {
        "chosen_angle_index": body.angle_index,
        "hooks": package["hooks"],
        "script": package["script"],
        "caption_body": package["caption_body"],
        "hashtags": package["hashtags"],
        "story_variants": package["story_variants"],
        "status": "content_ready",
        "updated_at": now,
    }
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/regenerate",
    response_model=GenerationSessionOut,
)
def generation_regenerate(
    slug: str,
    session_id: str,
    body: GenerationRegenerateBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")

    row = _load_session(supabase, client_id, session_id)
    if row.get("status") == "angles_ready" or not row.get("hooks"):
        raise HTTPException(
            status_code=400,
            detail="Choose an angle first — session has no generated content yet.",
        )

    chosen = get_chosen_angle(row)
    if not chosen:
        raise HTTPException(status_code=400, detail="No chosen angle on session")

    patterns = row.get("synthesized_patterns") if isinstance(row.get("synthesized_patterns"), dict) else {}
    client_row = _load_client_for_generation(supabase, client_id)

    hooks = row.get("hooks") if isinstance(row.get("hooks"), list) else []
    hooks = [h for h in hooks if isinstance(h, dict)]
    script = str(row.get("script") or "")
    cap = str(row.get("caption_body") or "")
    tags = row.get("hashtags") if isinstance(row.get("hashtags"), list) else []
    tags = [str(t) for t in tags]
    stories = row.get("story_variants") if isinstance(row.get("story_variants"), list) else []
    stories = [str(s) for s in stories]

    try:
        package = run_regenerate(
            settings,
            client_row=client_row,
            synthesized_patterns=patterns,
            chosen_angle=chosen,
            scope=body.scope,
            feedback=body.feedback,
            current_hooks=hooks,
            current_script=script,
            current_caption=cap,
            current_hashtags=tags,
            current_stories=stories,
        )
    except Exception as e:
        logger.exception("generation regenerate failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    now = _now_iso()
    patch = {
        "hooks": package["hooks"],
        "script": package["script"],
        "caption_body": package["caption_body"],
        "hashtags": package["hashtags"],
        "story_variants": package["story_variants"],
        "status": "content_ready",
        "updated_at": now,
    }
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/approve",
    response_model=GenerationSessionOut,
)
def generation_approve(
    slug: str,
    session_id: str,
    body: GenerationFeedbackBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    _ = slug
    _ = _load_session(supabase, client_id, session_id)
    now = _now_iso()
    patch: Dict[str, Any] = {"status": "approved", "updated_at": now}
    if body.feedback and body.feedback.strip():
        patch["feedback"] = body.feedback.strip()
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.post(
    "/clients/{slug}/generate/sessions/{session_id}/reject",
    response_model=GenerationSessionOut,
)
def generation_reject(
    slug: str,
    session_id: str,
    body: GenerationFeedbackBody,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    _ = slug
    _ = _load_session(supabase, client_id, session_id)
    now = _now_iso()
    patch: Dict[str, Any] = {"status": "rejected", "updated_at": now}
    if body.feedback and body.feedback.strip():
        patch["feedback"] = body.feedback.strip()
    supabase.table("generation_sessions").update(patch).eq("id", session_id).execute()
    return _row_to_out(_load_session(supabase, client_id, session_id))


@router.get("/clients/{slug}/generate/sessions", response_model=list[GenerationSessionOut])
def generation_list_sessions(
    slug: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    limit: int = Query(30, ge=1, le=100),
) -> list[dict]:
    _ = slug
    try:
        res = (
            supabase.table("generation_sessions")
            .select("*")
            .eq("client_id", client_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        logger.exception("generation_sessions list failed")
        raise HTTPException(
            status_code=503,
            detail="Could not list sessions (is sql/phase6_generation_sessions.sql applied?).",
        ) from e
    return [_row_to_out(r) for r in (res.data or [])]


@router.get(
    "/clients/{slug}/generate/sessions/{session_id}",
    response_model=GenerationSessionOut,
)
def generation_get_session(
    slug: str,
    session_id: str,
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    _ = slug
    return _row_to_out(_load_session(supabase, client_id, session_id))
