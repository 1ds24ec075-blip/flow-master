DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- Trigger functions should not be directly callable by app users either.
REVOKE ALL ON FUNCTION public.claim_tally_jobs(uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.reap_stale_tally_jobs(interval) FROM authenticated;