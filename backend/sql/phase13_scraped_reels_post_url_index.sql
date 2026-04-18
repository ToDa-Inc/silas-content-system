-- Speeds cross-client lookups by post_url (niche discovery enrichment cache pattern).
-- Safe to run multiple times.

CREATE INDEX IF NOT EXISTS idx_scraped_reels_post_url
  ON scraped_reels (post_url)
  WHERE post_url IS NOT NULL;
