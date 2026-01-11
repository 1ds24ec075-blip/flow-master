-- Create tally_vouchers table for storing voucher data
CREATE TABLE public.tally_vouchers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_id UUID REFERENCES public.segregation_uploads(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.segregated_transactions(id) ON DELETE CASCADE,
  voucher_type TEXT NOT NULL CHECK (voucher_type IN ('Payment', 'Receipt', 'Contra', 'Journal')),
  voucher_date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  bank_ledger TEXT NOT NULL DEFAULT 'Bank Account',
  party_ledger TEXT,
  reference_number TEXT,
  narration TEXT,
  payment_mode TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'flagged', 'approved', 'created')),
  flag_reason TEXT,
  is_duplicate BOOLEAN DEFAULT FALSE,
  duplicate_reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tally_vouchers ENABLE ROW LEVEL SECURITY;

-- Create permissive policy
CREATE POLICY "Allow all on tally_vouchers" ON public.tally_vouchers
  FOR ALL USING (true) WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_tally_vouchers_upload_id ON public.tally_vouchers(upload_id);
CREATE INDEX idx_tally_vouchers_transaction_id ON public.tally_vouchers(transaction_id);
CREATE INDEX idx_tally_vouchers_reference ON public.tally_vouchers(reference_number);

-- Create ledger_master table for managing available ledgers
CREATE TABLE public.ledger_master (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ledger_name TEXT NOT NULL UNIQUE,
  ledger_group TEXT NOT NULL,
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('Bank', 'Cash', 'Party', 'Expense', 'Income', 'Suspense', 'Asset', 'Liability')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ledger_master ENABLE ROW LEVEL SECURITY;

-- Create permissive policy
CREATE POLICY "Allow all on ledger_master" ON public.ledger_master
  FOR ALL USING (true) WITH CHECK (true);

-- Insert default ledgers
INSERT INTO public.ledger_master (ledger_name, ledger_group, ledger_type) VALUES
  ('Bank Account', 'Bank Accounts', 'Bank'),
  ('Cash', 'Cash-in-Hand', 'Cash'),
  ('Suspense A/c', 'Suspense Account', 'Suspense'),
  ('Sales Account', 'Sales Accounts', 'Income'),
  ('Purchase Account', 'Purchase Accounts', 'Expense'),
  ('Office Expenses', 'Indirect Expenses', 'Expense'),
  ('Travelling Expenses', 'Indirect Expenses', 'Expense'),
  ('Telephone Expenses', 'Indirect Expenses', 'Expense'),
  ('Professional Fees', 'Indirect Expenses', 'Expense'),
  ('Rent Paid', 'Indirect Expenses', 'Expense'),
  ('Electricity Charges', 'Indirect Expenses', 'Expense'),
  ('Bank Charges', 'Indirect Expenses', 'Expense'),
  ('Interest Received', 'Indirect Income', 'Income'),
  ('Interest Paid', 'Indirect Expenses', 'Expense'),
  ('Salary & Wages', 'Indirect Expenses', 'Expense'),
  ('Petty Cash', 'Cash-in-Hand', 'Cash');

-- Add trigger for updated_at
CREATE TRIGGER update_tally_vouchers_updated_at
  BEFORE UPDATE ON public.tally_vouchers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();