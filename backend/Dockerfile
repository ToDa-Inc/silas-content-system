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

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && apt-get install -y --no-install-recommends nodejs npm \
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
