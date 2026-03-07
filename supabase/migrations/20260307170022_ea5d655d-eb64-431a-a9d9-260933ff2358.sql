ALTER TABLE public.inventory_items
ADD COLUMN sales_target_quantity integer DEFAULT NULL,
ADD COLUMN sales_target_period text DEFAULT NULL;