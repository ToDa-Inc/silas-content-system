"""Remotion CLI render + upload to Supabase Storage (Phase 4)."""

from __future__ import annotations

import json
import os
import re
import time
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.config import Settings
from core.database import get_supabase_for_settings
from services.video_spec_defaults import finalize_spec_for_render

RENDERS_BUCKET = "renders"

_FRAME_PROGRESS = re.compile(
    r"(?:Rendered|Encoded)\s+(\d+)\s*/\s*(\d+)",
    re.IGNORECASE,
)


def _repo_remotion_dir(settings: Settings) -> Path:
    here = Path(__file__).resolve()
    backend = here.parent.parent
    root = backend.parent
    return root / "video-production" / "broll-caption-editor"


def _public_object_url(supabase_url: str, bucket: str, path: str) -> str:
    base = supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def _parse_frame_progress(line: str) -> Optional[Tuple[int, int]]:
    m = _FRAME_PROGRESS.search(line)
    if not m:
        return None
    try:
        return int(m.group(1)), int(m.group(2))
    except (ValueError, IndexError):
        return None


def build_remotion_props(
    session: Dict[str, Any],
    *,
    client_row: Optional[Dict[str, Any]] = None,
    supabase: Optional[Any] = None,
) -> Dict[str, Any]:
    """Flattened props for Remotion composition `video-spec` (VideoSpec v1 JSON)."""
    spec = finalize_spec_for_render(session, client_row=client_row, supabase=supabase)
    return spec.model_dump(mode="json")


def composition_id_for_session(_session: Dict[str, Any]) -> str:
    return "video-spec"


def run_video_render_job(settings: Settings, job_id: str) -> None:
    """Worker / BackgroundTasks entry: load job, render MP4, upload, update session + job row."""
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

    try:
        cres = supabase.table("clients").select("brand_theme").eq("id", client_id).limit(1).execute()
        client_row = dict(cres.data[0]) if cres.data else None
    except Exception as e:
        msg = str(e)
        arg0 = e.args[0] if getattr(e, "args", None) else None
        if isinstance(arg0, dict):
            msg = f"{msg} {arg0.get('message', '')} {arg0.get('code', '')}"
        if "brand_theme" in msg and ("42703" in msg or "does not exist" in msg):
            client_row = None
        else:
            raise

    remotion_dir = _repo_remotion_dir(settings)
    entry = remotion_dir / "src" / "Root.tsx"
    if not entry.is_file():
        fail_video_render_job(supabase, job_id, session_id, f"Remotion entry missing: {entry}")
        return

    try:
        comp_id = composition_id_for_session(session)
        props = build_remotion_props(session, client_row=client_row, supabase=supabase)
    except ValueError as e:
        fail_video_render_job(supabase, job_id, session_id, str(e))
        return

    supabase.table("generation_sessions").update(
        {"video_spec": props, "render_progress_pct": 0, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()

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
    last_pct = -1
    try:
        with open(props_path, "w", encoding="utf-8") as f:
            json.dump(props, f, ensure_ascii=False)

        props_arg = os.path.abspath(props_path)

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
        proc = subprocess.Popen(
            cmd,
            cwd=str(remotion_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        deadline = time.monotonic() + 600.0
        for line in proc.stdout:
            if time.monotonic() > deadline:
                proc.kill()
                fail_video_render_job(supabase, job_id, session_id, "remotion render timed out (10 min)")
                return
            prog = _parse_frame_progress(line)
            if prog:
                cur, tot = prog
                if tot > 0:
                    pct = min(99, int(100 * cur / tot))
                    if pct != last_pct and pct >= last_pct:
                        last_pct = pct
                        now_iso = datetime.now(timezone.utc).isoformat()
                        supabase.table("background_jobs").update({"progress_pct": pct}).eq("id", job_id).execute()
                        supabase.table("generation_sessions").update(
                            {"render_progress_pct": pct, "updated_at": now_iso}
                        ).eq("id", session_id).execute()
        proc.wait()
        if proc.returncode != 0:
            err_tail = f"exit {proc.returncode}"
            fail_video_render_job(supabase, job_id, session_id, f"remotion failed: {err_tail}")
            return
        if not os.path.isfile(out_mp4):
            fail_video_render_job(
                supabase,
                job_id,
                session_id,
                f"remotion produced no output file at {out_mp4}",
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
            "render_progress_pct": None,
            "updated_at": now,
        }
    ).eq("id", session_id).execute()

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": now,
            "progress_pct": 100,
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
            "progress_pct": None,
        }
    ).eq("id", job_id).execute()
    if session_id:
        supabase.table("generation_sessions").update(
            {
                "render_status": "failed",
                "render_error": msg,
                "render_progress_pct": None,
                "updated_at": now,
            }
        ).eq("id", session_id).execute()
