"""Replay scraped_reels + reel_analyses from a failed job's result.recovery_snapshot.

Usage (from backend/):
  PYTHONPATH=. python3 repair_keyword_reel_snapshot.py job_ppmWxLdppDY

Only works if the job failed *after* scoring and wrote recovery_snapshot (current code).
Older failed jobs have no snapshot — you must re-run keyword_reel_similarity.
"""

from __future__ import annotations

import argparse
import json
import sys

from core.config import get_settings
from jobs.keyword_reel_similarity import apply_keyword_similarity_recovery_snapshot


def main() -> None:
    p = argparse.ArgumentParser(description="Replay DB writes from recovery_snapshot")
    p.add_argument("job_id", help="background_jobs.id")
    args = p.parse_args()
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        print("ERROR: Supabase env missing", file=sys.stderr)
        sys.exit(1)
    try:
        out = apply_keyword_similarity_recovery_snapshot(settings, args.job_id)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
