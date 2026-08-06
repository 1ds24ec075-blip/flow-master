CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gstin text NOT NULL,
  state_code text GENERATED ALWAYS AS (substring(gstin from 1 for 2)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_gstin_format CHECK (
    gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'
  )
);

INSERT INTO public.companies (name, gstin)
SELECT 'Guhanesh', '29TESTC0000P1Z5'
WHERE NOT EXISTS (SELECT 1 FROM public.companies WHERE name = 'Guhanesh');

COMMENT ON COLUMN public.companies.gstin IS
  'The company''s own GSTIN. Its first two characters become state_code, which decides CGST/SGST versus IGST on every purchase — so a wrong value here mis-files tax silently. Guhanesh is an Educational Mode test company with no real GSTIN; 29TESTC0000P1Z5 is a deliberately synthetic placeholder, not a real registration.';

ALTER TABLE public.tally_agents
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_tally_agents_company ON public.tally_agents(company_id);

UPDATE public.tally_agents a
SET company_id = c.id
FROM public.companies c
WHERE c.name = 'Guhanesh'
  AND a.company_id IS NULL;

GRANT SELECT ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read companies" ON public.companies;
CREATE POLICY "Authenticated users can read companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (true);