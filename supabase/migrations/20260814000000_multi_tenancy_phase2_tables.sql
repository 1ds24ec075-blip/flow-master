-- Phase 2 data layer: extend multi-tenancy to the four tables that in-scope
-- pages read alongside the seven already covered by 20260810000000.
--
-- Why these four and not the other ~26 still unscoped:
--   expense_line_items  child of bills. The parent is scoped and the child is
--                       not, so Bills.tsx can render one company's bill header
--                       beside another company's line items. This is the only
--                       table here that is an active leak rather than a
--                       precaution.
--   purchase_orders     read by Dashboard, Quotations, RawMaterialInvoices and
--                       SupplierDashboard; still on "Allow all operations".
--   approvals           read by Approvals, Dashboard, RawMaterialInvoices,
--                       SupplierDashboard and two MCP tools.
--   clients             read by Clients and Quotations.
--
-- With these, five pages become fully company-scoped: Bills, Suppliers,
-- ClientInvoices, RawMaterialInvoices, Quotations. Everything else stays
-- single-tenant and must be marked as such in the UI.
--
-- Idempotent: safe to re-run. Every step is IF NOT EXISTS, a no-op UPDATE, or
-- a DROP-then-CREATE.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DO $rollback$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY[
--       'expense_line_items','purchase_orders','approvals','clients'
--     ] LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_tenant_select', t);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_tenant_insert', t);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_tenant_update', t);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_tenant_delete', t);
--       EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_company_id ON public.%I', t);
--       EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id DROP NOT NULL', t);
--       EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
--                      'Allow all operations on '||t, t);
--     END LOOP;
--   END
--   $rollback$;
--
--   -- Dropping the columns is separate and deliberate — data loss:
--   -- ALTER TABLE public.expense_line_items DROP COLUMN IF EXISTS company_id;  -- etc.
-- ---------------------------------------------------------------------------
--
-- service_role has BYPASSRLS, so every edge function using the service key is
-- unaffected by the policies below. That is what keeps bill-extract,
-- tally-enqueue and the agent pipeline working through this change; it is also
-- why Phase 3's membership check has to exist at all, since RLS will not stop
-- a service-role caller from touching another company's rows.


-- ---------------------------------------------------------------------------
-- 1. Column, backfill, constrain, index, transitional trigger
--
-- The backfill assigns every existing row to the single company, which is only
-- correct while there IS a single company. Rather than assume that silently the
-- way a blanket UPDATE would, the guard below refuses to run otherwise: with
-- two companies present there is no way to infer which one an existing
-- purchase_order belongs to, and guessing would mix two businesses' books.
-- ---------------------------------------------------------------------------

DO $tenant$
DECLARE
  t text;
  guhanesh uuid;
  company_count integer;
BEGIN
  SELECT count(*) INTO company_count FROM public.companies;
  IF company_count <> 1 THEN
    RAISE EXCEPTION
      'This migration backfills every existing row to one company, which is only valid while exactly one exists (found %). Backfill these four tables by hand before running it.',
      company_count;
  END IF;

  SELECT id INTO guhanesh FROM public.companies WHERE name = 'Guhanesh';
  IF guhanesh IS NULL THEN
    RAISE EXCEPTION 'No company named Guhanesh — 20260810000000_multi_tenancy_rls.sql has not been applied';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'expense_line_items',
    'purchase_orders',
    'approvals',
    'clients'
  ] LOOP
    -- 1a. Column.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT',
      t);

    -- 1b. Backfill. Only touches rows that have none, so a re-run is a no-op.
    EXECUTE format(
      'UPDATE public.%I SET company_id = %L WHERE company_id IS NULL',
      t, guhanesh);

    -- 1c. NOT NULL, once nothing is left null.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'company_id'
        AND is_nullable = 'YES'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', t);
    END IF;

    -- 1d. Index. RLS evaluates the membership filter on every single query.
    --     Note: Phase 1 named these idx_<table>_company. This migration uses
    --     idx_<table>_company_id by request; the two conventions now coexist.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)',
      'idx_' || t || '_company_id', t);

    -- 1e. Transitional default. Same fill_company_id() the seven Phase 1 tables
    --     use, and subject to the same cleanup: delete these triggers once
    --     Phase 2/3 set company_id explicitly on every write path, or they will
    --     quietly cover for a function that forgot to scope an insert.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_company_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_fill_company_id BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.fill_company_id()',
      t);
  END LOOP;
END
$tenant$;


-- ---------------------------------------------------------------------------
-- 2. RLS
--
-- Identical shape to 20260810000000 step 7: drop whatever is on the table
-- (these four still carry "Allow all operations on <table>" USING (true)
-- policies, which OR with anything new and would defeat the point), then one
-- policy per verb keyed on membership.
--
-- TO authenticated, not PUBLIC: anon is deliberately left with no policy, so
-- it resolves to zero rows.
-- ---------------------------------------------------------------------------

DO $policies$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense_line_items',
    'purchase_orders',
    'approvals',
    'clients'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (company_id IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_select', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
      'WITH CHECK (company_id IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_insert', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
      'USING (company_id IN (SELECT * FROM public.user_company_ids())) '
      'WITH CHECK (company_id IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_update', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
      'USING (company_id IN (SELECT * FROM public.user_company_ids()))',
      t || '_tenant_delete', t);
  END LOOP;
END
$policies$;


-- ---------------------------------------------------------------------------
-- 3. Grants
--
-- Table privileges, separate from RLS. service_role bypasses the policies but
-- still needs the grant; authenticated needs it to reach the policies at all.
-- ---------------------------------------------------------------------------

DO $grants$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense_line_items',
    'purchase_orders',
    'approvals',
    'clients'
  ] LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END
$grants$;


COMMENT ON COLUMN public.expense_line_items.company_id IS
  'Tenant owner. Must always equal the parent bill''s company_id — see the verification query in 20260814000000.';
