# API + worker. Remotion sources are vendored at `backend/broll-caption-editor/`
# (kept in sync with `video-production/broll-caption-editor` — see scripts/sync-broll-vendor.sh).
#
# Build (Railway "Root directory" = `backend` — this is the default for many services):
#   docker build -f Dockerfile .
#   (run from the `backend/` directory)
#
# Build from monorepo root (alternative):
#   docker build -f api.Dockerfile .
#
# Do NOT set Docker build context to `backend` if this file still used COPY ../video-production
# (old layout). The vendor copy fixes that.

FROM python:3.12-slim-bookworm

WORKDIR /app

# Node + shared libs for Remotion’s Chrome Headless Shell (slim images omit these → libnspr4.so etc.)
# https://www.remotion.dev/docs/miscellaneous/linux-dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    nodejs npm \
    ffmpeg \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libglib2.0-0 libexpat1 libfontconfig1 \
    libx11-6 libxcb1 libxext6 libxss1 libxtst6 \
    libcairo2 libpango-1.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY broll-caption-editor/ /opt/broll-caption-editor/
WORKDIR /opt/broll-caption-editor
RUN npm ci
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app/

ENV REMOTION_EDITOR_DIR=/opt/broll-caption-editor
ENV PYTHONUNBUFFERED=1
EXPOSE 8787

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8787}"]
