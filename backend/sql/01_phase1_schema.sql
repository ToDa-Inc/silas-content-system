-- Phase 1 schema for Silas Content System (run in Supabase SQL editor)
-- Source: docs/BACKEND-ARCHITECTURE.md
-- For a single paste (schema + RLS): use phase1_all_in_one.sql instead.

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Identity & Access
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  plan        text DEFAULT 'free',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text DEFAULT 'member',
  token       text UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Client Management
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name              text NOT NULL,
  instagram_handle  text,
  language          text DEFAULT 'de',
  niche_config      jsonb NOT NULL DEFAULT '[]',
  icp               jsonb NOT NULL DEFAULT '{}',
  products          jsonb NOT NULL DEFAULT '{}',
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS client_baselines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  avg_views       integer,
  median_views    integer,
  max_views       integer,
  p90_views       integer,
  p10_views       integer,
  avg_likes       integer,
  reels_analyzed  integer,
  scraped_at      timestamptz DEFAULT now(),
  expires_at      timestamptz
);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Background Jobs
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS background_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES clients(id),
  job_type      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'queued',
  result        jsonb,
  error_message text,
  priority      integer DEFAULT 0,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_background_jobs_org ON background_jobs(org_id, job_type);

-- ═══════════════════════════════════════════════════════
-- PHASE 1: Competitors
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competitors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  username          text NOT NULL,
  profile_url       text,
  followers         integer,
  avg_views         integer,
  avg_likes         integer,
  language          text,
  content_style     text,
  topics            text[],
  reasoning         text,
  relevance_score   integer,
  performance_score integer,
  language_bonus    integer DEFAULT 0,
  composite_score   integer,
  tier              integer,
  tier_label        text,
  discovery_job_id  uuid REFERENCES background_jobs(id),
  last_evaluated_at timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  UNIQUE (client_id, username)
);

CREATE INDEX IF NOT EXISTS idx_competitors_client ON competitors(client_id, tier, composite_score DESC);

-- ═══════════════════════════════════════════════════════
-- Worker: claim next queued job (SKIP LOCKED)
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION claim_next_job()
RETURNS SETOF background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_row background_jobs;
BEGIN
  SELECT * INTO job_row
  FROM background_jobs
  WHERE status = 'queued'
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE background_jobs
  SET status = 'running', started_at = now()
  WHERE id = job_row.id;

  RETURN QUERY SELECT * FROM background_jobs WHERE id = job_row.id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_next_job() TO service_role;
GRANT EXECUTE ON FUNCTION claim_next_job() TO postgres;
