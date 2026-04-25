# Same image as `backend/Dockerfile`, for builds where the Docker **context** is the monorepo root
# (e.g. `docker build -f api.Dockerfile .` from the repository root).
# Railway: set "Root directory" to empty (repo root) and Dockerfile path to `api.Dockerfile`
# if you do not use `backend` as the root.

FROM python:3.12-slim-bookworm

WORKDIR /app

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

COPY backend/broll-caption-editor/ /opt/broll-caption-editor/
WORKDIR /opt/broll-caption-editor
RUN npm ci
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ /app/

ENV REMOTION_EDITOR_DIR=/opt/broll-caption-editor
ENV PYTHONUNBUFFERED=1
EXPOSE 8787

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8787}"]
