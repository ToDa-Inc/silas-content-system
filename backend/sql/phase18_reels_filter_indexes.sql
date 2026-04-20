-- ============================================================
-- Phase 18 — Reels listing filter & sort indexes
-- Supports the expanded GET /clients/{slug}/reels endpoint
-- (range filters on views/likes/comments, creator filter, sort by
--  views/likes/comments/saves/shares with NULLS LAST, posted_at window).
--
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- All indexes reversible: DROP INDEX <name>;
-- ============================================================

-- 1. Sort & range on views (descending, NULLS LAST is the API default).
--    Backs: ORDER BY views DESC NULLS LAST and WHERE views >= X / <= Y.
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_views_desc
  ON scraped_reels (client_id, views DESC NULLS LAST);

-- 2. Sort & range on comments. Sparse column so DESC NULLS LAST
--    keeps empty rows out of the head of the result set.
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_comments_desc
  ON scraped_reels (client_id, comments DESC NULLS LAST);

-- 3. Sort & range on likes.
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_likes_desc
  ON scraped_reels (client_id, likes DESC NULLS LAST);

-- 4. Generic posted_at descending — used both as the default sort and as
--    the column for posted_after / posted_before range filters. Existing
--    phase4 index is partial (own-only); this one covers the full set.
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_posted_desc
  ON scraped_reels (client_id, posted_at DESC NULLS LAST);

-- 5. Creator filter — case-insensitive equality via ILIKE on
--    account_username with no wildcards. lower() expression index keeps
--    EXPLAIN happy without forcing column type changes.
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_creator_lower
  ON scraped_reels (client_id, lower(account_username));

-- ============================================================
-- Reverting:
--   DROP INDEX IF EXISTS idx_scraped_reels_client_views_desc;
--   DROP INDEX IF EXISTS idx_scraped_reels_client_comments_desc;
--   DROP INDEX IF EXISTS idx_scraped_reels_client_likes_desc;
--   DROP INDEX IF EXISTS idx_scraped_reels_client_posted_desc;
--   DROP INDEX IF EXISTS idx_scraped_reels_client_creator_lower;
-- ============================================================
