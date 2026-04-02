-- Ensures engagement counters exist (older DBs / partial migrations).
ALTER TABLE scraped_reels ADD COLUMN IF NOT EXISTS saves integer;
ALTER TABLE scraped_reels ADD COLUMN IF NOT EXISTS shares integer;

COMMENT ON COLUMN scraped_reels.saves IS 'From Instagram scrape (Apify saveCount).';
COMMENT ON COLUMN scraped_reels.shares IS 'From Instagram scrape (Apify shareCount).';
