-- Historical metrics per reel (append-only). Run once after scraped_reels exists.
-- Enables growth: "gained X views since yesterday" and week-over-week stats.

CREATE TABLE IF NOT EXISTS reel_snapshots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id    text NOT NULL REFERENCES scraped_reels (id) ON DELETE CASCADE,
  views      bigint,
  likes      bigint,
  comments   bigint,
  scraped_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reel_snapshots_reel_date
  ON reel_snapshots (reel_id, scraped_at DESC);

COMMENT ON TABLE reel_snapshots IS 'Append-only view/like/comment snapshots per sync. One row per reel per sync.';
