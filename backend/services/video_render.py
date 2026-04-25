"""Remotion CLI render + upload to Supabase Storage (Phase 4)."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

from core.config import Settings
from core.database import get_supabase_for_settings
from services.video_spec_defaults import finalize_spec_for_render

RENDERS_BUCKET = "renders"

_FRAME_PROGRESS = re.compile(
    r"(?:Rendered|Encoded)\s+(\d+)\s*/\s*(\d+)",
    re.IGNORECASE,
)


def _resolve_remotion_project_dir(settings: Settings) -> Path:
    """Locate ``broll-caption-editor`` (Remotion root with ``src/Root.tsx``).

    Local monorepo: ``backend/../video-production/broll-caption-editor``.

    Backend-only Docker image (``WORKDIR /app`` = backend): ``backend.parent`` is ``/`` — wrong.
    Set ``REMOTION_EDITOR_DIR`` or bake the project under ``/opt/broll-caption-editor`` (see ``backend/Dockerfile``).
    """
    raw = (settings.remotion_editor_dir or "").strip()
    if raw:
        p = Path(raw).expanduser().resolve()
        if (p / "src" / "Root.tsx").is_file():
            return p
        raise ValueError(
            f"REMOTION_EDITOR_DIR={p} does not contain src/Root.tsx. "
            "Point it at the broll-caption-editor folder (see video-production/broll-caption-editor)."
        )

    here = Path(__file__).resolve()
    backend_root = here.parent.parent
    candidates = [
        backend_root.parent / "video-production" / "broll-caption-editor",
        backend_root / "broll-caption-editor",
        backend_root / "vendor" / "broll-caption-editor",
    ]
    for c in candidates:
        if (c / "src" / "Root.tsx").is_file():
            return c.resolve()
    tried = "; ".join(str(c) for c in candidates)
    raise ValueError(
        "Remotion project not found. Set REMOTION_EDITOR_DIR to the absolute path of "
        "video-production/broll-caption-editor (folder with src/Root.tsx). "
        f"Tried: {tried}"
    )


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


def _parse_iso_ts(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    try:
        s = str(raw).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def recover_stale_video_render_jobs(settings: Settings, *, max_age_minutes: int = 15) -> int:
    """Fail ``video_render`` rows stuck in ``running`` (crashed worker, API reload, hung Remotion).

    ``claim_next_job`` only dequeues ``queued`` jobs, so without this sweep a zombie
    ``running`` row leaves ``generation_sessions.render_status='rendering'`` forever.
    """
    supabase = get_supabase_for_settings(settings)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
    res = (
        supabase.table("background_jobs")
        .select("id, payload, started_at, created_at")
        .eq("job_type", "video_render")
        .eq("status", "running")
        .execute()
    )
    cleared = 0
    for row in res.data or []:
        jid = str(row.get("id") or "").strip()
        if not jid:
            continue
        p = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        sid = str(p.get("session_id") or "").strip()
        ts = _parse_iso_ts(row.get("started_at")) or _parse_iso_ts(row.get("created_at"))
        if ts is None or ts > cutoff:
            continue
        fail_video_render_job(
            supabase,
            jid,
            sid,
            "Render timed out or the worker/API restarted while this job was running. Start render again.",
        )
        cleared += 1
    return cleared


def run_video_render_job(settings: Settings, job_id: str, *, from_worker: bool = False) -> None:
    """Worker (``from_worker=True``) or FastAPI BackgroundTasks: render MP4, upload, update rows."""
    supabase = get_supabase_for_settings(settings)
    res = supabase.table("background_jobs").select("*").eq("id", job_id).limit(1).execute()
    if not res.data:
        return
    job = dict(res.data[0])
    st = str(job.get("status") or "").strip()

    if st in ("completed", "failed"):
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    if from_worker:
        if st == "running":
            pass
        elif st == "queued":
            claimed = (
                supabase.table("background_jobs")
                .update({"status": "running", "started_at": now_iso})
                .eq("id", job_id)
                .eq("status", "queued")
                .execute()
            )
            if not claimed.data:
                return
            job = dict(claimed.data[0])
        else:
            return
    else:
        if st == "running":
            return
        if st == "queued":
            claimed = (
                supabase.table("background_jobs")
                .update({"status": "running", "started_at": now_iso})
                .eq("id", job_id)
                .eq("status", "queued")
                .execute()
            )
            if not claimed.data:
                return
            job = dict(claimed.data[0])
        else:
            return

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

    try:
        remotion_dir = _resolve_remotion_project_dir(settings)
    except ValueError as e:
        fail_video_render_job(supabase, job_id, session_id, str(e))
        return
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
        line_q: Queue[Optional[str]] = Queue()

        def _pump_stdout() -> None:
            try:
                for line in proc.stdout:
                    line_q.put(line)
            except Exception:
                logger.debug("video_render stdout pump ended", exc_info=True)
            finally:
                line_q.put(None)

        pump_t = threading.Thread(target=_pump_stdout, daemon=True)
        pump_t.start()
        deadline = time.monotonic() + 600.0
        while True:
            if time.monotonic() > deadline:
                proc.kill()
                try:
                    proc.wait(timeout=20)
                except Exception:
                    pass
                pump_t.join(timeout=5)
                fail_video_render_job(supabase, job_id, session_id, "remotion render timed out (10 min)")
                return
            try:
                line = line_q.get(timeout=1.5)
            except Empty:
                if proc.poll() is not None:
                    break
                continue
            if line is None:
                break
            prog = _parse_frame_progress(line)
            if prog:
                cur, tot = prog
                if tot > 0:
                    pct = min(99, int(100 * cur / tot))
                    if pct != last_pct and pct >= last_pct:
                        last_pct = pct
                        prog_iso = datetime.now(timezone.utc).isoformat()
                        supabase.table("background_jobs").update({"progress_pct": pct}).eq("id", job_id).execute()
                        supabase.table("generation_sessions").update(
                            {"render_progress_pct": pct, "updated_at": prog_iso}
                        ).eq("id", session_id).execute()
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            fail_video_render_job(supabase, job_id, session_id, "remotion process did not exit after stdout closed")
            return
        pump_t.join(timeout=2)
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
