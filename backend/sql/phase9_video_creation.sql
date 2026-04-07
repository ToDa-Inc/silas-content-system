-- Phase 9: Video creation (Phase 4) — generation_sessions extensions + broll library.
-- Run once in Supabase SQL editor after prior migrations.
-- Create Storage buckets `renders` and `broll` in Dashboard (public read optional for renders if using public URLs).

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS text_blocks         jsonb,
  ADD COLUMN IF NOT EXISTS background_type     text
    CHECK (background_type IS NULL OR background_type IN ('broll', 'generated_image')),
  ADD COLUMN IF NOT EXISTS broll_clip_id       uuid,
  ADD COLUMN IF NOT EXISTS background_url      text,
  ADD COLUMN IF NOT EXISTS rendered_video_url  text,
  ADD COLUMN IF NOT EXISTS render_status       text DEFAULT NULL
    CHECK (render_status IS NULL OR render_status IN ('rendering', 'done', 'failed', 'cleaned')),
  ADD COLUMN IF NOT EXISTS render_error        text;

CREATE TABLE IF NOT EXISTS broll_clips (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_url       text NOT NULL,
  thumbnail_url  text,
  duration_s     integer,
  tags           text[],
  label          text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broll_clips_client
  ON broll_clips (client_id, created_at DESC);

COMMENT ON TABLE broll_clips IS
  'Reusable B-roll video clips per client for Phase 4 video creation.';

COMMENT ON COLUMN generation_sessions.text_blocks IS
  'Short punchy overlay lines for visual formats (text_overlay, b_roll_reel, carousel).';

COMMENT ON COLUMN generation_sessions.render_status IS
  'Phase 4 render lifecycle: null → rendering → done/failed → cleaned.';
