-- 1. LEDGER ENTRIES TABLE (central financial ledger)
CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  entity_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'supplier', 'bank')),
  ledger_type text NOT NULL CHECK (ledger_type IN ('receivable', 'payable', 'payment')),
  amount numeric NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('invoice', 'bank_transaction', 'manual')),
  source_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconciled', 'void')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on ledger_entries" ON public.ledger_entries FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_ledger_entries_entity ON public.ledger_entries (entity_id, entity_type);
CREATE INDEX idx_ledger_entries_source ON public.ledger_entries (source_id, source_type);

-- 2. EXTEND BANK_TRANSACTIONS with reconciliation fields
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS matched_status text NOT NULL DEFAULT 'unmatched'
    CHECK (matched_status IN ('unmatched', 'suggested', 'matched', 'confirmed'));

-- 3. PAYMENT ALLOCATIONS TABLE
CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  invoice_type text NOT NULL CHECK (invoice_type IN ('client', 'supplier')),
  allocated_amount numeric NOT NULL,
  match_score numeric,
  match_method text DEFAULT 'manual',
  confirmed_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on payment_allocations" ON public.payment_allocations FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_payment_alloc_txn ON public.payment_allocations (bank_transaction_id);
CREATE INDEX idx_payment_alloc_inv ON public.payment_allocations (invoice_id, invoice_type);

-- 4. CUSTOMER ALIASES TABLE
CREATE TABLE public.customer_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_name text NOT NULL,
  customer_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'supplier')),
  confidence_score numeric DEFAULT 1.0,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(alias_name, entity_type)
);

ALTER TABLE public.customer_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on customer_aliases" ON public.customer_aliases FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_customer_aliases_name ON public.customer_aliases (alias_name);

-- 5. TRIGGER: Auto-create ledger entry when client invoice is created
CREATE OR REPLACE FUNCTION public.create_ledger_entry_for_client_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_entries (entry_date, entity_id, entity_type, ledger_type, amount, source_type, source_id, description)
  VALUES (
    COALESCE(NEW.created_at::date, CURRENT_DATE),
    NEW.client_id,
    'customer',
    'receivable',
    COALESCE(NEW.amount, 0),
    'invoice',
    NEW.id,
    'Client Invoice #' || NEW.invoice_number
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_invoice_ledger
AFTER INSERT ON public.client_invoices
FOR EACH ROW EXECUTE FUNCTION public.create_ledger_entry_for_client_invoice();

-- 6. TRIGGER: Auto-create ledger entry when supplier invoice is created
CREATE OR REPLACE FUNCTION public.create_ledger_entry_for_supplier_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_entries (entry_date, entity_id, entity_type, ledger_type, amount, source_type, source_id, description)
  VALUES (
    COALESCE(NEW.created_at::date, CURRENT_DATE),
    NEW.supplier_id,
    'supplier',
    'payable',
    COALESCE(NEW.amount, 0),
    'invoice',
    NEW.id,
    'Supplier Invoice #' || NEW.invoice_number
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_invoice_ledger
AFTER INSERT ON public.raw_material_invoices
FOR EACH ROW EXECUTE FUNCTION public.create_ledger_entry_for_supplier_invoice();

-- 7. TRIGGER: Auto-create ledger entry when bank transaction is imported
CREATE OR REPLACE FUNCTION public.create_ledger_entry_for_bank_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_entries (entry_date, entity_id, entity_type, ledger_type, amount, source_type, source_id, description)
  VALUES (
    COALESCE(NEW.transaction_date, CURRENT_DATE),
    NULL,
    'bank',
    'payment',
    COALESCE(NEW.amount, 0),
    'bank_transaction',
    NEW.id,
    COALESCE(NEW.description, 'Bank transaction')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_transaction_ledger
AFTER INSERT ON public.bank_transactions
FOR EACH ROW EXECUTE FUNCTION public.create_ledger_entry_for_bank_transaction();

-- 8. BACKFILL: Create ledger entries for existing client invoices
INSERT INTO public.ledger_entries (entry_date, entity_id, entity_type, ledger_type, amount, source_type, source_id, description)
SELECT
  COALESCE(ci.created_at::date, CURRENT_DATE),
  ci.client_id,
  'customer',
  'receivable',
  COALESCE(ci.amount, 0),
  'invoice',
  ci.id,
  'Client Invoice #' || ci.invoice_number
FROM public.client_invoices ci
WHERE NOT EXISTS (
  SELECT 1 FROM public.ledger_entries le WHERE le.source_id = ci.id AND le.source_type = 'invoice' AND le.ledger_type = 'receivable'
);

-- 9. BACKFILL: Create ledger entries for existing supplier invoices
INSERT INTO public.ledger_entries (entry_date, entity_id, entity_type, ledger_type, amount, source_type, source_id, description)
SELECT
  COALESCE(rmi.created_at::date, CURRENT_DATE),
  rmi.supplier_id,
  'supplier',
  'payable',
  COALESCE(rmi.amount, 0),
  'invoice',
  rmi.id,
  'Supplier Invoice #' || rmi.invoice_number
FROM public.raw_material_invoices rmi
WHERE NOT EXISTS (
  SELECT 1 FROM public.ledger_entries le WHERE le.source_id = rmi.id AND le.source_type = 'invoice' AND le.ledger_type = 'payable'
);

-- 10. BACKFILL: Create ledger entries for existing bank transactions
INSERT INTO public.ledger_entries (entry_date, entity_id, entity_type, ledger_type, amount, source_type, source_id, description)
SELECT
  COALESCE(bt.transaction_date, CURRENT_DATE),
  NULL,
  'bank',
  'payment',
  COALESCE(bt.amount, 0),
  'bank_transaction',
  bt.id,
  COALESCE(bt.description, 'Bank transaction')
FROM public.bank_transactions bt
WHERE NOT EXISTS (
  SELECT 1 FROM public.ledger_entries le WHERE le.source_id = bt.id AND le.source_type = 'bank_transaction'
);

-- 11. Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.ledger_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_allocations;