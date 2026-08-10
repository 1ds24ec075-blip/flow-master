CREATE TABLE IF NOT EXISTS public.bill_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bill_audit_events TO authenticated;
GRANT ALL ON public.bill_audit_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_bill_audit_events_bill ON public.bill_audit_events (bill_id, created_at);

COMMENT ON TABLE public.bill_audit_events IS
  'Append-only record of deliberate user overrides (e.g. sending a low-confidence bill). Inserted by the browser before the overridden action runs.';

ALTER TABLE public.bill_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can record their own audit events" ON public.bill_audit_events;
CREATE POLICY "Users can record their own audit events"
  ON public.bill_audit_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can read audit events" ON public.bill_audit_events;
CREATE POLICY "Authenticated users can read audit events"
  ON public.bill_audit_events FOR SELECT
  TO authenticated
  USING (true);