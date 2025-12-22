-- Create table for segregation uploads (sessions)
CREATE TABLE public.segregation_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  upload_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  total_transactions INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for segregated transactions
CREATE TABLE public.segregated_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_id UUID NOT NULL REFERENCES public.segregation_uploads(id) ON DELETE CASCADE,
  transaction_date DATE,
  narration TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('debit', 'credit')),
  suggested_category TEXT NOT NULL DEFAULT 'unknown',
  final_category TEXT,
  confidence_score NUMERIC DEFAULT 0,
  is_reviewed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for learning rules (business-specific patterns)
CREATE TABLE public.segregation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(business_name, pattern)
);

-- Enable RLS
ALTER TABLE public.segregation_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segregated_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segregation_rules ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow all for now since no auth)
CREATE POLICY "Allow all on segregation_uploads" ON public.segregation_uploads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on segregated_transactions" ON public.segregated_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on segregation_rules" ON public.segregation_rules FOR ALL USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_segregated_transactions_upload_id ON public.segregated_transactions(upload_id);
CREATE INDEX idx_segregation_rules_business ON public.segregation_rules(business_name);
CREATE INDEX idx_segregation_rules_pattern ON public.segregation_rules(pattern);