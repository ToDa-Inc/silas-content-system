-- Daily intelligence cron scheduler.
--
-- One row per (client_id, cron_name). The worker's schedule_loop calls
-- claim_due_schedule() once a minute; the RPC atomically advances
-- next_run_at and returns the row so exactly one worker enqueues the tick.
--
-- Design notes:
--  * `cadence_hours = 24` is the common case; kept as int so operators can
--    stagger clients (e.g. 24 + random(0..60 min) at onboarding) without
--    code changes.
--  * `enabled = false` pauses a client's cron without deleting history.
--  * `last_result jsonb` mirrors background_jobs.result shape for UI reuse.
--  * Unique index on (client_id, cron_name) — one schedule per cron per client.
--  * `next_run_at` indexed for the RPC's `<= now()` scan.

CREATE TABLE IF NOT EXISTS public.cron_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       text NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  org_id          text,  -- denormalized for fast job enqueue, no FK (clients owns it)
  cron_name       text NOT NULL,
  cadence_hours   int  NOT NULL DEFAULT 24 CHECK (cadence_hours BETWEEN 1 AND 720),
  next_run_at     timestamptz NOT NULL,
  last_run_at     timestamptz,
  last_job_id     text,
  last_result     jsonb,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cron_schedules_client_cron_unique UNIQUE (client_id, cron_name)
);

CREATE INDEX IF NOT EXISTS cron_schedules_due_idx
  ON public.cron_schedules (next_run_at)
  WHERE enabled;

CREATE INDEX IF NOT EXISTS cron_schedules_client_idx
  ON public.cron_schedules (client_id);


-- Atomically claim one due schedule.
--
-- Returns zero or one row. The row's next_run_at is bumped by cadence_hours
-- BEFORE returning, so a concurrent caller sees the updated row and gets
-- nothing. This is the SKIP LOCKED pattern adapted for time-driven work.
--
-- last_run_at is set here (not when the tick finishes) so "is this schedule
-- healthy?" can be inferred from (now() - last_run_at) even if the tick itself
-- fails. If you want strict "only update last_run_at on tick success", move
-- that write into the daily_intelligence_tick completion path and drop it here.

CREATE OR REPLACE FUNCTION public.claim_due_schedule()
RETURNS SETOF public.cron_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.cron_schedules
    WHERE enabled = true
      AND next_run_at <= now()
    ORDER BY next_run_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.cron_schedules AS s
  SET
    next_run_at = now() + make_interval(hours => s.cadence_hours),
    last_run_at = now(),
    updated_at  = now()
  FROM due
  WHERE s.id = due.id
  RETURNING s.*;
END;
$$;

COMMENT ON FUNCTION public.claim_due_schedule() IS
  'Claims one due cron_schedules row and advances next_run_at by cadence_hours. Used by worker.schedule_loop.';

GRANT EXECUTE ON FUNCTION public.claim_due_schedule() TO service_role;
