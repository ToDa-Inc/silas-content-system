-- Niche keyword discovery: similarity_score on scraped_reels (keyword_similarity source).

ALTER TABLE scraped_reels
  ADD COLUMN IF NOT EXISTS similarity_score integer;

COMMENT ON COLUMN scraped_reels.similarity_score IS
  'Niche alignment 0–100 from keyword_reel_similarity job; NULL for other sources.';
