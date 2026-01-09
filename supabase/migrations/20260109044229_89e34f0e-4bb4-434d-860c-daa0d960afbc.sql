-- Add Quantity Multiple Rule fields to product_master
ALTER TABLE public.product_master
ADD COLUMN IF NOT EXISTS sell_in_multiples boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS multiple_quantity integer DEFAULT NULL;

-- Add check constraint to ensure multiple_quantity > 0 when provided
ALTER TABLE public.product_master
ADD CONSTRAINT check_multiple_quantity_positive 
CHECK (multiple_quantity IS NULL OR multiple_quantity > 0);