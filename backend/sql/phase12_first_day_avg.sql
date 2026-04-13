-- Milestone-based performance tracking: views/comments at 24h, 48h, 72h after posting.

-- Per-reel milestones on scraped_reels
ALTER TABLE scraped_reels
  ADD COLUMN IF NOT EXISTS views_at_24h       integer,
  ADD COLUMN IF NOT EXISTS comments_at_24h    integer,
  ADD COLUMN IF NOT EXISTS milestone_24h_at   timestamptz,
  ADD COLUMN IF NOT EXISTS views_at_48h       integer,
  ADD COLUMN IF NOT EXISTS comments_at_48h    integer,
  ADD COLUMN IF NOT EXISTS milestone_48h_at   timestamptz,
  ADD COLUMN IF NOT EXISTS views_at_72h       integer,
  ADD COLUMN IF NOT EXISTS comments_at_72h    integer,
  ADD COLUMN IF NOT EXISTS milestone_72h_at   timestamptz;

-- Per-competitor milestone averages (replace old single-avg columns)
ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS avg_first_day_views    double precision,
  ADD COLUMN IF NOT EXISTS avg_first_day_comments double precision,
  ADD COLUMN IF NOT EXISTS first_day_reels_sampled integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_views_at_24h       double precision,
  ADD COLUMN IF NOT EXISTS avg_comments_at_24h    double precision,
  ADD COLUMN IF NOT EXISTS sampled_at_24h         integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_views_at_48h       double precision,
  ADD COLUMN IF NOT EXISTS avg_comments_at_48h    double precision,
  ADD COLUMN IF NOT EXISTS sampled_at_48h         integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_views_at_72h       double precision,
  ADD COLUMN IF NOT EXISTS avg_comments_at_72h    double precision,
  ADD COLUMN IF NOT EXISTS sampled_at_72h         integer DEFAULT 0;
