-- Average views ÷ comments per mature format digest (e.g. 20 = 20 views per comment).
ALTER TABLE format_digests
  ADD COLUMN IF NOT EXISTS avg_comment_view_ratio double precision;

COMMENT ON COLUMN format_digests.avg_comment_view_ratio IS
  'Mean of views ÷ comments over mature reels in this format (comments > 0).';
