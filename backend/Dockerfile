# FastAPI API + same image can run worker with overridden CMD.
# Railway: create a **second** service, Root Directory = `backend`, use this Dockerfile.
# Set the same env as local `.env` (SUPABASE_*, CRON_SECRET, APIFY_*, OPENROUTER_*, etc.).
FROM python:3.12-slim-bookworm
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 8787

# Railway sets PORT; local default 8787
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8787}"]
