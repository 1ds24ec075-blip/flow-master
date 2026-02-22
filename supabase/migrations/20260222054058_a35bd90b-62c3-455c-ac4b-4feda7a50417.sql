ALTER TABLE public.suppliers 
  ADD COLUMN IF NOT EXISTS credit_limit numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_days integer DEFAULT 30;