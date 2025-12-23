-- Add vendor_tin column to bills table
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS vendor_tin text;