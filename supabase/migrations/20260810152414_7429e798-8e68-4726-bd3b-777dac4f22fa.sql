SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
$$;

COMMENT ON FUNCTION public.user_company_ids() IS
  'Companies the calling user belongs to. SECURITY DEFINER so RLS policies on company_members do not recurse through themselves.';

CREATE OR REPLACE FUNCTION public.is_company_admin(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = _company_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
$$;

COMMENT ON FUNCTION public.is_company_admin(uuid) IS
  'True when the calling user is an admin of the given company. SECURITY DEFINER for the same anti-recursion reason as user_company_ids().';

REVOKE EXECUTE ON FUNCTION public.user_company_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_company_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_company_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_admin(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'finance', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_members_one_per_user UNIQUE (company_id, user_id)
);

COMMENT ON TABLE public.company_members IS
  'Which users may see which company''s data. Every RLS policy in this schema resolves through this table.';

CREATE INDEX IF NOT EXISTS idx_company_members_user ON public.company_members (user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members (company_id);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their own membership" ON public.company_members;
CREATE POLICY "Members read their own membership"
  ON public.company_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_company_admin(company_id));

DROP POLICY IF EXISTS "Admins add company members" ON public.company_members;
CREATE POLICY "Admins add company members"
  ON public.company_members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin(company_id));

DROP POLICY IF EXISTS "Admins update company members" ON public.company_members;
CREATE POLICY "Admins update company members"
  ON public.company_members FOR UPDATE
  TO authenticated
  USING (public.is_company_admin(company_id))
  WITH CHECK (public.is_company_admin(company_id));

DROP POLICY IF EXISTS "Admins remove company members" ON public.company_members;
CREATE POLICY "Admins remove company members"
  ON public.company_members FOR DELETE
  TO authenticated
  USING (public.is_company_admin(company_id));

INSERT INTO public.company_members (company_id, user_id, role)
SELECT c.id, u.id, 'admin'
FROM auth.users u
CROSS JOIN public.companies c
WHERE c.name = 'Guhanesh'
ON CONFLICT (company_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fill_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fill$
DECLARE
  resolved uuid;
  company_count integer;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT cm.company_id INTO resolved
  FROM public.company_members cm
  WHERE cm.user_id = auth.uid()
  ORDER BY cm.created_at
  LIMIT 1;

  IF resolved IS NULL THEN
    SELECT count(*) INTO company_count FROM public.companies;
    IF company_count = 1 THEN
      SELECT id INTO resolved FROM public.companies;
    END IF;
  END IF;

  IF resolved IS NULL THEN
    RAISE EXCEPTION
      'company_id is required on %.% and could not be inferred — the caller belongs to no company and there is more than one to choose from',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  NEW.company_id := resolved;
  RETURN NEW;
END;
$fill$;

COMMENT ON FUNCTION public.fill_company_id() IS
  'Transitional: fills company_id on INSERT so pre-Phase-2/3 code keeps working under the NOT NULL constraint. Remove once callers set it explicitly.';

GRANT EXECUTE ON FUNCTION public.fill_company_id() TO authenticated, service_role;

DO $tenant$
DECLARE
  t text;
  guhanesh uuid;
BEGIN
  SELECT id INTO guhanesh FROM public.companies WHERE name = 'Guhanesh';
  IF guhanesh IS NULL THEN
    RAISE EXCEPTION 'No company named Guhanesh — run 20260804140000_add_companies_and_igst.sql first';
  END IF;

  -- Historic rows hold GST numbers that fail the current format trigger, and a
  -- pure company_id stamp must not be blocked by unrelated legacy data. Paused
  -- for the backfill only, then restored below.
  ALTER TABLE public.bills DISABLE TRIGGER trg_validate_gst_bills;
  ALTER TABLE public.client_invoices DISABLE TRIGGER trg_check_amount_mismatch_client_invoices;
  ALTER TABLE public.raw_material_invoices DISABLE TRIGGER trg_check_amount_mismatch_raw_material_invoices;
  ALTER TABLE public.raw_material_invoices DISABLE TRIGGER trg_auto_add_supplier_invoice_to_liquidity;

  FOREACH t IN ARRAY ARRAY[
    'bills',
    'suppliers',
    'tally_sync_queue',
    'client_invoices',
    'raw_material_invoices',
    'quotations',
    'bill_audit_events'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT',
      t);

    EXECUTE format(
      'UPDATE public.%I SET company_id = %L WHERE company_id IS NULL',
      t, guhanesh);

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'company_id'
        AND is_nullable = 'YES'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', t);
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)',
      'idx_' || t || '_company', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_company_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_fill_company_id BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.fill_company_id()',
      t);
  END LOOP;

  ALTER TABLE public.bills ENABLE TRIGGER trg_validate_gst_bills;
  ALTER TABLE public.client_invoices ENABLE TRIGGER trg_check_amount_mismatch_client_invoices;
  ALTER TABLE public.raw_material_invoices ENABLE TRIGGER trg_check_amount_mismatch_raw_material_invoices;
  ALTER TABLE public.raw_material_invoices ENABLE TRIGGER trg_auto_add_supplier_invoice_to_liquidity;
END
$tenant$;

DO $policies$
DECLARE
  t text;
  col text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bills',
    'suppliers',
    'tally_sync_queue',
    'client_invoices',
    'raw_material_invoices',
    'quotations',
    'bill_audit_events',
    'item_match_resolutions'
  ] LOOP
    col := CASE WHEN t = 'item_match_resolutions' THEN 'business_id' ELSE 'company_id' END;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (%I IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_select', t, col);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
      'WITH CHECK (%I IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_insert', t, col);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
      'USING (%I IN (SELECT * FROM public.user_company_ids())) '
      'WITH CHECK (%I IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_update', t, col, col);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
      'USING (%I IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_delete', t, col);
  END LOOP;
END
$policies$;

DO $grants$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bills',
    'suppliers',
    'tally_sync_queue',
    'client_invoices',
    'raw_material_invoices',
    'quotations',
    'bill_audit_events',
    'item_match_resolutions',
    'company_members'
  ] LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END
$grants$;

GRANT ALL ON public.tally_agents TO service_role;