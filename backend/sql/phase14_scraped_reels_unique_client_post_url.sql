-- Enables PostgREST upsert(..., on_conflict="client_id,post_url") for scraped_reels.
-- Run backend/sql/dedupe_scraped_reels_post_url.sql first if duplicates exist.

CREATE UNIQUE INDEX IF NOT EXISTS uq_scraped_reels_client_id_post_url
  ON scraped_reels (client_id, post_url);
