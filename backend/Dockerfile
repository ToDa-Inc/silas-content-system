# API + worker image with Remotion bundled.
#
# Build from **monorepo root** (parent of `backend/` and `video-production/`):
#   docker build -f backend/Dockerfile .
#
# If your platform only allows `backend/` as build context, either:
#   - switch the service root to the monorepo and use this file, or
#   - copy `video-production/broll-caption-editor` into `backend/vendor/` before build and
#     set REMOTION_EDITOR_DIR=/app/vendor/broll-caption-editor (see auto-discovery in video_render.py).
#
# Railway: Root Directory = repo root, Dockerfile path = `backend/Dockerfile`.

FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && apt-get install -y --no-install-recommends nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/

COPY video-production/broll-caption-editor /opt/broll-caption-editor
WORKDIR /opt/broll-caption-editor
RUN npm ci
WORKDIR /app

ENV REMOTION_EDITOR_DIR=/opt/broll-caption-editor
ENV PYTHONUNBUFFERED=1
EXPOSE 8787

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8787}"]
