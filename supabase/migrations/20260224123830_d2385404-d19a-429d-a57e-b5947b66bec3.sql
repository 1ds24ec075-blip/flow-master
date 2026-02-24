
-- Add due_date column to raw_material_invoices
ALTER TABLE public.raw_material_invoices ADD COLUMN due_date date NULL;
