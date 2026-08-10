CREATE INDEX IF NOT EXISTS idx_tally_sync_queue_delivered_masters
  ON public.tally_sync_queue (agent_id)
  WHERE status = 'success'
    AND job_type IN ('master_ledger', 'master_stockitem');

COMMENT ON INDEX public.idx_tally_sync_queue_delivered_masters IS
  'Serves the known-masters lookup in tally-enqueue: which ledgers and stock items Tally already holds.';