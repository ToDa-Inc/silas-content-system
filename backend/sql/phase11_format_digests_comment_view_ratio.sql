-- Average comments/views (0–1) per mature format digest — UI primary “engagement” signal.
ALTER TABLE format_digests
  ADD COLUMN IF NOT EXISTS avg_comment_view_ratio double precision;

COMMENT ON COLUMN format_digests.avg_comment_view_ratio IS
  'Mean of comments/views over mature reels in this format (views > 0).';
