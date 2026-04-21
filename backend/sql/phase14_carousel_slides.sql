-- Phase 14: Carousel support — generation_sessions.carousel_slides JSONB array
-- + format_digests columns for carousel ranking (likes-vs-account-avg, no views).
--
-- Run once in Supabase SQL Editor. Idempotent.

-- ── 1. carousel_slides on generation_sessions ──────────────────────────────
ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS carousel_slides jsonb;

COMMENT ON COLUMN generation_sessions.carousel_slides IS
  'Ordered array of carousel slides for format=carousel sessions. Each entry: '
  '{"idx": int, "text": string, "image_url": string|null, "prompt": string|null}. '
  'Max ~10 entries (Instagram carousel cap).';

-- ── 2. format_digests carousel ranking metrics ─────────────────────────────
-- Carousels have no view counter, so engagement_rate / comment_view_ratio are NULL.
-- Rank instead by how much the post over- or under-performs the account's typical likes.
ALTER TABLE format_digests
  ADD COLUMN IF NOT EXISTS avg_outlier_likes_ratio double precision;

ALTER TABLE format_digests
  ADD COLUMN IF NOT EXISTS avg_outlier_comments_ratio double precision;

COMMENT ON COLUMN format_digests.avg_outlier_likes_ratio IS
  'Mean of scraped_reels.outlier_likes_ratio over mature reels in this format. '
  'Primary ranking signal for format_key=carousel (no views available).';

COMMENT ON COLUMN format_digests.avg_outlier_comments_ratio IS
  'Mean of scraped_reels.outlier_comments_ratio over mature reels in this format. '
  'Carousel ranking fallback when outlier_likes_ratio is null.';
