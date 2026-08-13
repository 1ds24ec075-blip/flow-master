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
      CASE WHEN q.job_type = 'voucher' THEN 1 ELSE 0 END,
      q.priority,
      q.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.tally_sync_queue t
  SET status = 'in_progress',
      claimed_at = now()
  FROM claimable c
  WHERE t.id = c.id
  RETURNING t.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_tally_job_result(
  p_id uuid,
  p_agent_id uuid,
  p_success boolean,
  p_error text,
  p_retryable boolean
)
RETURNS SETOF public.tally_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.tally_sync_queue q
  SET
    attempts = CASE WHEN p_success THEN q.attempts ELSE q.attempts + 1 END,
    status = CASE
      WHEN p_success THEN 'success'
      WHEN p_retryable AND q.attempts + 1 < q.max_attempts THEN 'pending'
      ELSE 'failed'
    END,
    last_error = CASE WHEN p_success THEN NULL ELSE COALESCE(p_error, 'Unknown Tally error') END,
    retryable = CASE
      WHEN p_success THEN true
      ELSE p_retryable AND q.attempts + 1 < q.max_attempts
    END,
    synced_at = CASE WHEN p_success THEN now() ELSE NULL END,
    claimed_at = NULL
  WHERE q.id = p_id
    AND q.agent_id = p_agent_id
  RETURNING q.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_tally_job_result(uuid, uuid, boolean, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tally_job_result(uuid, uuid, boolean, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reap_stale_tally_jobs(p_older_than interval DEFAULT '10 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reaped integer;
  lost integer;
BEGIN
  UPDATE public.tally_sync_queue q
  SET status = 'pending', claimed_at = NULL
  FROM public.tally_agents a
  WHERE q.agent_id = a.id
    AND q.status = 'in_progress'
    AND q.claimed_at < now() - p_older_than
    AND a.last_seen_at IS NOT NULL
    AND a.last_seen_at >= now() - p_older_than;
  GET DIAGNOSTICS reaped = ROW_COUNT;

  UPDATE public.tally_sync_queue q
  SET attempts = q.attempts + 1,
      status = CASE WHEN q.attempts + 1 >= q.max_attempts THEN 'failed' ELSE 'pending' END,
      retryable = q.attempts + 1 < q.max_attempts,
      last_error = COALESCE(
        q.last_error,
        'The agent stopped responding while this job was in flight'
      ),
      claimed_at = NULL
  FROM public.tally_agents a
  WHERE q.agent_id = a.id
    AND q.status = 'in_progress'
    AND q.claimed_at < now() - p_older_than
    AND (a.last_seen_at IS NULL OR a.last_seen_at < now() - p_older_than);
  GET DIAGNOSTICS lost = ROW_COUNT;

  RETURN reaped + lost;
END;
$$;

UPDATE public.tally_sync_queue
SET attempts = 0
WHERE status IN ('pending', 'in_progress')
  AND last_error IS NULL
  AND attempts > 0;

UPDATE public.tally_sync_queue
SET status = 'failed',
    retryable = false
WHERE status = 'pending'
  AND last_error IS NOT NULL
  AND attempts >= max_attempts;

UPDATE public.bills b
SET tally_status = 'failed',
    tally_error = q.last_error
FROM public.tally_sync_queue q
WHERE q.source_table = 'bills'
  AND q.source_id = b.id
  AND q.job_type = 'voucher'
  AND q.status = 'failed'
  AND b.tally_status = 'queued';