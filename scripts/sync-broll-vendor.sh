#!/usr/bin/env sh
# 1) Copy shared Remotion composition from the dashboard into the CLI project (so Docker
#    backend-only builds do not need ../content-machine).
# 2) Vendor video-production/broll-caption-editor → backend/broll-caption-editor for Railway.
# Run from repo root after changing content-machine/src/remotion-spec or broll-caption-editor.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rsync -a --delete \
  "$ROOT/content-machine/src/remotion-spec/" \
  "$ROOT/video-production/broll-caption-editor/src/remotion-spec/"
rsync -a --delete \
  --exclude=node_modules --exclude=.remotion --exclude=out --exclude=dist --exclude='.DS_Store' \
  "$ROOT/video-production/broll-caption-editor/" \
  "$ROOT/backend/broll-caption-editor/"
echo "Synced remotion-spec + broll-caption-editor → backend ($(find "$ROOT/backend/broll-caption-editor" -type f | wc -l | tr -d ' ') files)"
