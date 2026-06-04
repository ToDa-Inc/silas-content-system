-- Exact frame count for B-roll masters (30fps CFR). Run after phase31_broll_render_master.sql.

ALTER TABLE broll_clips
  ADD COLUMN IF NOT EXISTS duration_frames integer;

COMMENT ON COLUMN broll_clips.duration_frames IS
  'Video frame count of master_url at 30fps; timeline/composition length derives from this.';
