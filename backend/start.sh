#!/usr/bin/env bash
# One Railway (or any single container): API + background worker together.
# Set Railway Start Command to: bash start.sh
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
python worker.py &
exec python -m uvicorn main:app --host 0.0.0.0 --port "$PORT"
