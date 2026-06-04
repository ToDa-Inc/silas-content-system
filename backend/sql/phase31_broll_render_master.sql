-- B-roll render masters: exact duration + normalized H.264 URL for Remotion.
-- Run once in Supabase SQL editor after phase9_video_creation.sql.

ALTER TABLE broll_clips
  ADD COLUMN IF NOT EXISTS master_url       text,
  ADD COLUMN IF NOT EXISTS duration_sec     double precision,
  ADD COLUMN IF NOT EXISTS normalize_status text;

COMMENT ON COLUMN broll_clips.master_url IS
  'H.264 CFR 30fps render master; Remotion reads this instead of raw upload when set.';
COMMENT ON COLUMN broll_clips.duration_sec IS
  'Exact clip duration in seconds (ffprobe); preferred over integer duration_s.';
COMMENT ON COLUMN broll_clips.normalize_status IS
  'pending | processing | ready | failed';
