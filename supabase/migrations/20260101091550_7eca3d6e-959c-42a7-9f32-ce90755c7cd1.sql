-- Add column to store duplicate match details for transparency
ALTER TABLE public.po_orders 
ADD COLUMN IF NOT EXISTS duplicate_match_details jsonb DEFAULT NULL;