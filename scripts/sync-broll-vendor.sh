#!/usr/bin/env sh
# Keep backend/broll-caption-editor in sync with video-production/broll-caption-editor
# (vendor copy for Docker when build context = backend). Run from repo root after Remotion changes.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rsync -a --delete \
  --exclude=node_modules --exclude=.remotion --exclude=out --exclude=dist --exclude='.DS_Store' \
  "$ROOT/video-production/broll-caption-editor/" \
  "$ROOT/backend/broll-caption-editor/"
echo "Synced to backend/broll-caption-editor ($(find "$ROOT/backend/broll-caption-editor" -type f | wc -l | tr -d ' ') files)"
