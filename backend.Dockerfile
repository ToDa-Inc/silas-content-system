# FastAPI API + worker image. Docker build context MUST be the monorepo root:
#   docker build -f backend.Dockerfile .
#
# Remotion project: video-production/broll-caption-editor (baked to /opt/broll-caption-editor).
# System Chromium avoids missing .so on slim images and skips Remotion’s headless-shell download.
#
# Railway (API service): Root Directory = empty (repo root), Dockerfile path = backend.Dockerfile
# See backend/RAILWAY.md.

FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    nodejs npm \
    ffmpeg \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* \
  && test -x /usr/bin/chromium

COPY video-production/broll-caption-editor/ /opt/broll-caption-editor/
WORKDIR /opt/broll-caption-editor
RUN npm ci
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ /app/

ENV REMOTION_EDITOR_DIR=/opt/broll-caption-editor
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
ENV PYTHONUNBUFFERED=1
EXPOSE 8787

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8787}"]
