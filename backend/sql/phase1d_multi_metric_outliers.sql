-- Multi-metric breakout detection: avg_comments on competitors, per-metric ratios on scraped_reels.
-- Run in Supabase SQL editor or via migrate pipeline.
-- Safe to re-run (IF NOT EXISTS on every column).

ALTER TABLE competitors ADD COLUMN IF NOT EXISTS avg_comments integer;

ALTER TABLE scraped_reels
  ADD COLUMN IF NOT EXISTS outlier_views_ratio numeric(8,2),
  ADD COLUMN IF NOT EXISTS outlier_likes_ratio numeric(8,2),
  ADD COLUMN IF NOT EXISTS outlier_comments_ratio numeric(8,2),
  ADD COLUMN IF NOT EXISTS is_outlier_views boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_outlier_likes boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_outlier_comments boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_avg_likes integer,
  ADD COLUMN IF NOT EXISTS account_avg_comments integer;

COMMENT ON COLUMN scraped_reels.outlier_views_ratio IS 'views / competitor.avg_views at scrape time';
COMMENT ON COLUMN scraped_reels.outlier_likes_ratio IS 'likes / competitor.avg_likes at scrape time';
COMMENT ON COLUMN scraped_reels.outlier_comments_ratio IS 'comments / competitor.avg_comments at scrape time';
COMMENT ON COLUMN scraped_reels.account_avg_likes IS 'competitor avg_likes snapshot at scrape time';
COMMENT ON COLUMN scraped_reels.account_avg_comments IS 'competitor avg_comments snapshot at scrape time';
