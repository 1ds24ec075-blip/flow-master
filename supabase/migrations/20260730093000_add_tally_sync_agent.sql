-- Reconza <-> Tally auto-sync: per-installation agents and the job queue they drain.
--
-- The queue stores structured business data (payload_json), never rendered XML.
-- XML is produced by the shared serializer at the moment a job is transmitted,
-- so a serializer fix applies to jobs already sitting in this table.

-- ---------------------------------------------------------------------------
-- Agents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tally_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- sha256 hex of the per-installation token. The plaintext token is shown
  -- once at onboarding and never stored.
  token_hash text NOT NULL UNIQUE,
  company_name text NOT NULL,
  tally_url text NOT NULL DEFAULT 'http://localhost:9000',
  agent_version text,
  last_seen_at timestamptz,
  last_error text,
  tally_running boolean NOT NULL DEFAULT false,
  company_loaded boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tally_agents_token_hash ON public.tally_agents(token_hash);

-- ---------------------------------------------------------------------------
-- Sync queue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tally_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.tally_agents(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('master_ledger', 'master_stockitem', 'voucher')),
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'success', 'failed')),
  -- Idempotency key. Generated once when the job is created and carried through
  -- to the rendered XML's GUID, so a double-fired trigger cannot double-book.
  tally_guid text NOT NULL,
  -- Master GUIDs that must reach 'success' before this job may be pushed.
  depends_on_guids text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  -- False for logical errors (unbalanced voucher, unknown ledger) that a retry
  -- can never fix. The processor leaves these alone until a human intervenes.
  retryable boolean NOT NULL DEFAULT true,
  schema_version integer NOT NULL DEFAULT 1,
  source_table text,
  source_id uuid,
  priority integer NOT NULL DEFAULT 100,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

-- One row per GUID per agent: re-enqueuing the same bill updates rather than
-- duplicating, which is what makes the deterministic GUIDs actually protective.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tally_sync_queue_guid_agent
  ON public.tally_sync_queue(tally_guid, agent_id);

CREATE INDEX IF NOT EXISTS idx_tally_sync_queue_status ON public.tally_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_tally_sync_queue_agent_status ON public.tally_sync_queue(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tally_sync_queue_source ON public.tally_sync_queue(source_table, source_id);

-- ---------------------------------------------------------------------------
-- Claiming
--
-- Masters before vouchers, and never a voucher whose masters haven't landed.
-- SKIP LOCKED keeps two overlapping triggers (interval + "Tally just opened")
-- from claiming the same row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_tally_jobs(p_agent_id uuid, p_limit integer DEFAULT 25)
RETURNS SETOF public.tally_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT q.id
    FROM public.tally_sync_queue q
    WHERE q.agent_id = p_agent_id
      AND q.status = 'pending'
      AND q.attempts < q.max_attempts
      AND NOT EXISTS (
        SELECT 1
        FROM public.tally_sync_queue dep
        WHERE dep.agent_id = q.agent_id
          AND dep.tally_guid = ANY (q.depends_on_guids)
          AND dep.status <> 'success'
      )
    ORDER BY
      -- masters first, then vouchers
      CASE WHEN q.job_type = 'voucher' THEN 1 ELSE 0 END,
      q.priority,
      q.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.tally_sync_queue t
  SET status = 'in_progress',
      claimed_at = now(),
      attempts = t.attempts + 1
  FROM claimable c
  WHERE t.id = c.id
  RETURNING t.*;
END;
$$;

-- Releases jobs an agent claimed but never reported on (crash, power loss).
CREATE OR REPLACE FUNCTION public.reap_stale_tally_jobs(p_older_than interval DEFAULT '10 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reaped integer;
BEGIN
  UPDATE public.tally_sync_queue
  SET status = 'pending', claimed_at = NULL
  WHERE status = 'in_progress'
    AND claimed_at < now() - p_older_than;
  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.tally_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_sync_queue ENABLE ROW LEVEL SECURITY;

-- tally_agents holds token hashes: deliberately no policy, so only the service
-- role (edge functions) can touch it. Anything else gets zero rows.

-- The dashboard needs to show sync status, so the queue is readable by signed-in
-- users. Writes go through the edge functions on the service role.
DROP POLICY IF EXISTS "Authenticated users can read the tally sync queue" ON public.tally_sync_queue;
CREATE POLICY "Authenticated users can read the tally sync queue"
  ON public.tally_sync_queue FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- Bill linkage
-- ---------------------------------------------------------------------------

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS tally_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS tally_xml text;

COMMENT ON COLUMN public.bills.tally_xml IS
  'Last rendered XML, kept for download/debugging only. The queue is the source of truth and stores JSON.';
