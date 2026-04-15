-- ============================================================
-- Phase 4 — Performance indexes
-- Run once in Supabase SQL editor (safe to re-run — all use IF NOT EXISTS)
-- All indexes are reversible: DROP INDEX <index_name>;
-- ============================================================

-- 1. Competitor reels by client: speeds up _proven_performer_reels() and _trending_now_reels()
--    Queries: .eq("client_id").not_.is_("competitor_id","null").order("views", desc=True).limit(200)
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_competitor_views
  ON scraped_reels (client_id, views DESC)
  WHERE competitor_id IS NOT NULL;

-- 2. Reels by client + source: speeds up compute_niche_benchmarks()
--    Queries: .eq("client_id").or_("competitor_id.not.is.null,source.eq.niche_search")
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_source
  ON scraped_reels (client_id, source);

-- 3. Analyses by client + post_url: speeds up _attach_reel_analyses() second pass
--    Queries: .eq("client_id").in_("post_url", chunk)
CREATE INDEX IF NOT EXISTS idx_reel_analyses_client_post_url
  ON reel_analyses (client_id, post_url)
  WHERE post_url IS NOT NULL;

-- 4. Own reels (no competitor) ordered by posted_at: speeds up get_intelligence_activity() own-reel fetch
--    Queries: .eq("client_id").is_("competitor_id","null").order("posted_at", desc=True)
CREATE INDEX IF NOT EXISTS idx_scraped_reels_client_own_posted
  ON scraped_reels (client_id, posted_at DESC)
  WHERE competitor_id IS NULL;

-- ============================================================
-- Niche benchmarks SQL function (replaces Python-side AVG loop)
-- Called by compute_niche_benchmarks() via supabase.rpc("get_niche_benchmarks", ...)
-- ============================================================
CREATE OR REPLACE FUNCTION get_niche_benchmarks(p_client_id text)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'reel_count',
      COUNT(*),
    'niche_avg_views',
      ROUND(AVG(views::numeric)),
    'niche_avg_likes',
      ROUND(AVG(likes::numeric)),
    'niche_avg_engagement_rate',
      ROUND(AVG(
        CASE WHEN COALESCE(views, 0) > 0
          THEN (COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(saves,0) + COALESCE(shares,0))::float
               / views::float
        END
      )::numeric, 4),
    'niche_avg_comment_view_ratio',
      ROUND(AVG(
        CASE WHEN COALESCE(comments, 0) > 0
          THEN views::float / comments::float
        END
      )::numeric, 4),
    'niche_avg_duration_seconds',
      ROUND(AVG(
        CASE WHEN video_duration IS NOT NULL AND video_duration::int > 0
          THEN video_duration::int
        END
      )::numeric)
  )
  FROM scraped_reels
  WHERE client_id = p_client_id
    AND (competitor_id IS NOT NULL OR source = 'niche_search')
$$;

-- ============================================================
-- To revert all changes (safe — no data loss):
--   DROP INDEX IF EXISTS idx_scraped_reels_client_competitor_views;
--   DROP INDEX IF EXISTS idx_scraped_reels_client_source;
--   DROP INDEX IF EXISTS idx_reel_analyses_client_post_url;
--   DROP INDEX IF EXISTS idx_scraped_reels_client_own_posted;
--   DROP FUNCTION IF EXISTS get_niche_benchmarks(text);
-- ============================================================
