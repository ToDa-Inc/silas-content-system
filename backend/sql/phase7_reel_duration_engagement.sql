-- Video duration in seconds (from Apify videoDuration). Run once after scraped_reels exists.
ALTER TABLE scraped_reels ADD COLUMN IF NOT EXISTS video_duration integer;

COMMENT ON COLUMN scraped_reels.video_duration IS 'Reel length in seconds from Instagram scrape (Apify videoDuration).';
