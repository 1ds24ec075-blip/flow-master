-- Add columns to bills table for duplicate detection
ALTER TABLE public.bills 
ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS duplicate_bill_id uuid DEFAULT NULL,
ADD COLUMN IF NOT EXISTS duplicate_match_details jsonb DEFAULT NULL;