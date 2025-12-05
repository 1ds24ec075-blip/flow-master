-- Create bank_statements table
CREATE TABLE public.bank_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  parsed_data JSONB,
  error_message TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create bank_transactions table
CREATE TABLE public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  transaction_date DATE,
  description TEXT,
  amount DECIMAL(15, 2),
  transaction_type TEXT CHECK (transaction_type IN ('credit', 'debit')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create expense_matches table
CREATE TABLE public.expense_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  expense_name TEXT NOT NULL,
  matched_amount DECIMAL(15, 2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_matches ENABLE ROW LEVEL SECURITY;

-- Allow public access for now (since no auth is implemented)
CREATE POLICY "Allow all access to bank_statements" ON public.bank_statements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to bank_transactions" ON public.bank_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expense_matches" ON public.expense_matches FOR ALL USING (true) WITH CHECK (true);

-- Add updated_at trigger
CREATE TRIGGER update_bank_statements_updated_at
  BEFORE UPDATE ON public.bank_statements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();