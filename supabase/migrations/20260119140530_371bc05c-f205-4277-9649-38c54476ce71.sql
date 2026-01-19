-- Add column to track manually added vouchers
ALTER TABLE public.tally_vouchers 
ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT false;