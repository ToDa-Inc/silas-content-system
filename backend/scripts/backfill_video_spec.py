#!/usr/bin/env python3
"""One-shot backfill: generation_sessions.video_spec from hooks + text_blocks + background.

Run from repo root after applying backend/sql/phase20_video_spec.sql:
  cd backend && pip install -r requirements.txt && python scripts/backfill_video_spec.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

load_dotenv(REPO / ".env")
load_dotenv(BACKEND / ".env", override=True)

from supabase import create_client  # noqa: E402

from services.video_spec_defaults import build_default_video_spec  # noqa: E402


def main() -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    supabase = create_client(url, key)
    res = (
        supabase.table("generation_sessions")
        .select(
            "id, client_id, hooks, angles, chosen_angle_index, text_blocks, background_url, "
            "background_type, broll_clip_id, source_format_key, source_type, video_spec"
        )
        .is_("video_spec", "null")
        .execute()
    )
    rows = res.data or []
    updated = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        tb = row.get("text_blocks")
        if not isinstance(tb, list) or not any(
            isinstance(x, dict) and str(x.get("text") or "").strip() for x in tb
        ):
            continue
        if not str(row.get("background_url") or "").strip():
            continue
        try:
            spec = build_default_video_spec(row, client_row=None)
        except ValueError:
            continue
        supabase.table("generation_sessions").update(
            {"video_spec": spec.model_dump(mode="json")}
        ).eq("id", row["id"]).execute()
        updated += 1
    print(f"Backfilled video_spec for {updated} session(s).")


if __name__ == "__main__":
    main()
