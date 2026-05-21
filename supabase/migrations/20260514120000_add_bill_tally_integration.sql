-- Store generated Tally payloads and send status for extracted bills.
ALTER TABLE public.bills
ADD COLUMN IF NOT EXISTS tally_json jsonb,
ADD COLUMN IF NOT EXISTS tally_xml text,
ADD COLUMN IF NOT EXISTS tally_status text DEFAULT 'not_generated',
ADD COLUMN IF NOT EXISTS tally_uploaded_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS tally_error text;

CREATE INDEX IF NOT EXISTS idx_bills_tally_status ON public.bills(tally_status);
