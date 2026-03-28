-- Multi-metric breakout detection: avg_comments on competitors, per-metric ratios on scraped_reels.
-- Run in Supabase SQL editor or via migrate pipeline.

ALTER TABLE competitors ADD COLUMN IF NOT EXISTS avg_comments integer;

ALTER TABLE scraped_reels
  ADD COLUMN IF NOT EXISTS outlier_views_ratio numeric(8,2),
  ADD COLUMN IF NOT EXISTS outlier_likes_ratio numeric(8,2),
  ADD COLUMN IF NOT EXISTS outlier_comments_ratio numeric(8,2),
  ADD COLUMN IF NOT EXISTS is_outlier_views boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_outlier_likes boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_outlier_comments boolean DEFAULT false;

COMMENT ON COLUMN scraped_reels.outlier_views_ratio IS 'views / competitor.avg_views at scrape time';
COMMENT ON COLUMN scraped_reels.outlier_likes_ratio IS 'likes / competitor.avg_likes at scrape time';
COMMENT ON COLUMN scraped_reels.outlier_comments_ratio IS 'comments / competitor.avg_comments at scrape time';

-- profile_scrape now uses PostgREST upsert on scraped_reels (not upsert_scraped_reels_batch) so new columns
-- are written without changing the RPC. If you still call the RPC elsewhere, extend that function to map
-- the same JSON keys into these columns.
