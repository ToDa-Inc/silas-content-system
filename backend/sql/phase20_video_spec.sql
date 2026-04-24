-- Phase 20: VideoSpec JSON on generation_sessions + render job progress.
-- Run in Supabase SQL Editor after prior migrations.
-- After applying, run once from repo:  cd backend && python scripts/backfill_video_spec.py

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS video_spec jsonb;

COMMENT ON COLUMN generation_sessions.video_spec IS
  'Canonical Remotion VideoSpec (v1): template, theme, timing, blocks, background.';

CREATE INDEX IF NOT EXISTS idx_generation_sessions_client_video_spec
  ON generation_sessions (client_id)
  WHERE video_spec IS NOT NULL;

ALTER TABLE background_jobs
  ADD COLUMN IF NOT EXISTS progress_pct integer;

COMMENT ON COLUMN background_jobs.progress_pct IS
  '0-100 for long-running jobs (e.g. Remotion frame progress). NULL when not applicable.';

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS render_progress_pct integer;

COMMENT ON COLUMN generation_sessions.render_progress_pct IS
  'Mirrors latest Remotion render progress 0-100 for dashboard polling; cleared when render completes.';
