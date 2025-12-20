-- Add bank verification columns to bills table
ALTER TABLE public.bills 
ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bank_transaction_id uuid,
ADD COLUMN IF NOT EXISTS verified_date timestamp with time zone;