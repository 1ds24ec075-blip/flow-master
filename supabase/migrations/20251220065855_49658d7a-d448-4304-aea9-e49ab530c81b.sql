-- PO Processor: Create po_orders table for Sales Order processing
CREATE TABLE IF NOT EXISTS public.po_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text,
  vendor_name text,
  vendor_address text,
  customer_name text,
  customer_address text,
  billing_address text,
  shipping_address text,
  payment_terms text,
  order_date date,
  delivery_date date,
  total_amount numeric,
  currency text DEFAULT 'INR',
  status text DEFAULT 'pending', -- pending, processed, converted, duplicate, price_mismatch
  raw_text text,
  original_filename text,
  email_subject text,
  email_from text,
  email_date timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  customer_match_log jsonb,
  price_mismatch_details jsonb,
  customer_master_id uuid,
  source_customer_master_id uuid,
  populated_at timestamptz,
  tally_ledger_name text,
  population_source text,
  gst_number text
);

-- Enable RLS
ALTER TABLE public.po_orders ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for public access
CREATE POLICY "Allow all operations on po_orders" 
ON public.po_orders 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create po_order_items table
CREATE TABLE IF NOT EXISTS public.po_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_order_id uuid NOT NULL REFERENCES public.po_orders(id) ON DELETE CASCADE,
  item_number integer,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  total_price numeric,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.po_order_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Allow all operations on po_order_items" 
ON public.po_order_items 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create customer_master table
CREATE TABLE IF NOT EXISTS public.customer_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  gst_number text,
  billing_address text,
  shipping_address text,
  payment_terms text,
  currency text DEFAULT 'INR',
  tally_ledger_name text,
  email text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customer_master ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Allow all operations on customer_master" 
ON public.customer_master 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create price_list table
CREATE TABLE IF NOT EXISTS public.price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  product_name text,
  unit_price numeric NOT NULL,
  currency text DEFAULT 'INR',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Allow all operations on price_list" 
ON public.price_list 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Add foreign key references to po_orders
ALTER TABLE public.po_orders
ADD CONSTRAINT fk_po_orders_customer_master
FOREIGN KEY (customer_master_id) REFERENCES public.customer_master(id);

ALTER TABLE public.po_orders
ADD CONSTRAINT fk_po_orders_source_customer_master
FOREIGN KEY (source_customer_master_id) REFERENCES public.customer_master(id);

-- Create triggers for updated_at
CREATE TRIGGER update_po_orders_updated_at
BEFORE UPDATE ON public.po_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_master_updated_at
BEFORE UPDATE ON public.customer_master
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_price_list_updated_at
BEFORE UPDATE ON public.price_list
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();