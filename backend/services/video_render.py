"""Remotion CLI render + upload to Supabase Storage (Phase 4)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from services.format_classifier import canonicalize_stored_format_key

RENDERS_BUCKET = "renders"
# Carousels are NOT rendered as MP4 — they are delivered as N PNG slides via the
# /carousel-slides/zip endpoint (see routers/creation.py). Only formats that have
# a matching Remotion composition belong here.
_COMPOSITION_MAP = {
    "text_overlay": "static-slide",
    "b_roll_reel": "captioned-broll",
}


def _repo_remotion_dir(settings: Settings) -> Path:
    # backend/services/video_render.py → parents[2] = repo root if services is under backend
    here = Path(__file__).resolve()
    backend = here.parent.parent
    root = backend.parent
    return root / "video-production" / "broll-caption-editor"


def _public_object_url(supabase_url: str, bucket: str, path: str) -> str:
    base = supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def build_remotion_props(session: Dict[str, Any]) -> Dict[str, Any]:
    angles = session.get("angles") or []
    idx_raw = session.get("chosen_angle_index")
    try:
        idx = int(idx_raw) if idx_raw is not None else 0
    except (TypeError, ValueError):
        idx = 0
    chosen: Dict[str, Any] = angles[idx] if isinstance(angles, list) and 0 <= idx < len(angles) else {}

    hooks = session.get("hooks") or []
    hook_text = ""
    if isinstance(hooks, list) and hooks:
        h0 = hooks[0]
        if isinstance(h0, dict):
            hook_text = str(h0.get("text") or "").strip()
    if not hook_text:
        hook_text = str(chosen.get("draft_hook") or "").strip()

    text_blocks = session.get("text_blocks") or []
    tb_out: List[Dict[str, Any]] = []
    if isinstance(text_blocks, list):
        for b in text_blocks:
            if not isinstance(b, dict):
                continue
            t = str(b.get("text") or "").strip()
            if not t:
                continue
            tb_out.append({"text": t, "isCTA": bool(b.get("isCTA"))})

    bg = str(session.get("background_url") or "").strip()
    if not bg:
        raise ValueError("session missing background_url")

    bg_type = str(session.get("background_type") or "").strip().lower()
    has_broll_id = bool(str(session.get("broll_clip_id") or "").strip())
    # static-slide uses image vs video layer; captioned-broll ignores this prop
    background_kind = (
        "video" if bg_type == "broll" or (not bg_type and has_broll_id) else "image"
    )

    return {
        "hook": hook_text,
        "textBlocks": tb_out,
        "backgroundUrl": bg,
        "backgroundKind": background_kind,
        "hookDurationSeconds": 3,
        "secondsPerBlock": 2.5,
    }


def composition_id_for_session(session: Dict[str, Any]) -> str:
    raw = str(session.get("source_format_key") or "").strip()
    fk = canonicalize_stored_format_key(raw) or raw
    if not fk and str(session.get("source_type") or "").strip() == "url_adapt":
        fk = "text_overlay"
    cid = _COMPOSITION_MAP.get(fk)
    if not cid:
        raise ValueError(f"unsupported source_format_key for render: {fk!r}")
    return cid


def run_video_render_job(settings: Settings, job_id: str) -> None:
    """BackgroundTasks entry: load job, render MP4, upload, update session + job row."""
    supabase = get_supabase_for_settings(settings)
    res = supabase.table("background_jobs").select("*").eq("id", job_id).limit(1).execute()
    if not res.data:
        return
    job = dict(res.data[0])
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    session_id = str(payload.get("session_id") or "").strip()
    client_id = str(job.get("client_id") or "").strip()
    if not session_id or not client_id:
        fail_video_render_job(supabase, job_id, session_id, "video_render job missing session_id or client_id")
        return

    sres = (
        supabase.table("generation_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("client_id", client_id)
        .limit(1)
        .execute()
    )
    if not sres.data:
        fail_video_render_job(supabase, job_id, session_id, "session not found")
        return
    session = dict(sres.data[0])

    remotion_dir = _repo_remotion_dir(settings)
    entry = remotion_dir / "src" / "Root.jsx"
    if not entry.is_file():
        fail_video_render_job(supabase, job_id, session_id, f"Remotion entry missing: {entry}")
        return

    try:
        comp_id = composition_id_for_session(session)
        props = build_remotion_props(session)
    except ValueError as e:
        fail_video_render_job(supabase, job_id, session_id, str(e))
        return

    cli_js = remotion_dir / "node_modules" / "@remotion" / "cli" / "remotion-cli.js"
    if not cli_js.is_file():
        fail_video_render_job(
            supabase,
            job_id,
            session_id,
            f"Remotion CLI missing at {cli_js} — run npm install in video-production/broll-caption-editor",
        )
        return

    tmpdir = tempfile.mkdtemp(prefix="remotion_")
    props_path = os.path.join(tmpdir, "props.json")
    out_mp4 = os.path.abspath(os.path.join(tmpdir, f"{session_id}.mp4"))
    try:
        with open(props_path, "w", encoding="utf-8") as f:
            json.dump(props, f, ensure_ascii=False)

        # Remotion resolves --props with path.resolve(cwd, value); file:// URLs are not supported.
        props_arg = os.path.abspath(props_path)

        # Use node + remotion-cli.js (not npx .bin/remotion): some installs copy the CLI into
        # node_modules/.bin with require('./dist/index'), which resolves against .bin/ and fails.
        # Remotion 4 expects output as the third positional arg after composition id, not --output-path.
        cmd = [
            "node",
            str(cli_js),
            "render",
            str(entry),
            comp_id,
            out_mp4,
            f"--props={props_arg}",
            "--overwrite",
        ]
        env = {**os.environ, "NODE_ENV": "production"}
        proc = subprocess.run(
            cmd,
            cwd=str(remotion_dir),
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "")[:8000]
            fail_video_render_job(supabase, job_id, session_id, f"remotion failed ({proc.returncode}): {err}")
            return
        if not os.path.isfile(out_mp4):
            hint = ((proc.stderr or "") + (proc.stdout or ""))[:2000]
            fail_video_render_job(
                supabase,
                job_id,
                session_id,
                f"remotion produced no output file at {out_mp4}. CLI output: {hint or '(empty)'}",
            )
            return

        storage_path = f"{client_id}/{session_id}.mp4"
        with open(out_mp4, "rb") as vid:
            data = vid.read()
        supabase.storage.from_(RENDERS_BUCKET).upload(
            storage_path,
            data,
            {"content-type": "video/mp4", "upsert": "true"},
        )
    except subprocess.TimeoutExpired:
        fail_video_render_job(supabase, job_id, session_id, "remotion render timed out (10 min)")
        return
    except Exception as e:
        fail_video_render_job(supabase, job_id, session_id, str(e))
        return
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    now = datetime.now(timezone.utc).isoformat()
    public_url = _public_object_url(settings.supabase_url, RENDERS_BUCKET, storage_path)
    supabase.table("generation_sessions").update(
        {
            "rendered_video_url": public_url,
            "render_status": "done",
            "render_error": None,
            "updated_at": now,
        }
    ).eq("id", session_id).execute()

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": now,
            "result": {"rendered_video_url": public_url, "session_id": session_id},
        }
    ).eq("id", job_id).execute()


def fail_video_render_job(supabase, job_id: str, session_id: str, message: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    msg = message[:8000]
    supabase.table("background_jobs").update(
        {
            "status": "failed",
            "completed_at": now,
            "error_message": msg,
        }
    ).eq("id", job_id).execute()
    if session_id:
        supabase.table("generation_sessions").update(
            {
                "render_status": "failed",
                "render_error": msg,
                "updated_at": now,
            }
        ).eq("id", session_id).execute()
