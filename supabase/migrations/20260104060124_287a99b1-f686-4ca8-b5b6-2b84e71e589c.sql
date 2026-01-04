-- =============================================
-- MULTI-PARTY PRODUCT CODE RESOLUTION SYSTEM
-- =============================================

-- 1. CANONICAL PRODUCT MASTER
-- This represents the single source of truth for all products
CREATE TABLE IF NOT EXISTS public.product_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  default_unit text DEFAULT 'PCS',
  default_unit_price numeric,
  hsn_code text,
  gst_rate numeric DEFAULT 18,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on product_master" 
ON public.product_master FOR ALL 
USING (true) WITH CHECK (true);

-- 2. CUSTOMER PRODUCT MAPPING
-- Maps customer-specific product codes to internal products
CREATE TABLE IF NOT EXISTS public.customer_product_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customer_master(id) ON DELETE CASCADE,
  customer_product_code text NOT NULL,
  internal_product_id uuid NOT NULL REFERENCES public.product_master(id) ON DELETE CASCADE,
  customer_product_name text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(customer_id, customer_product_code)
);

ALTER TABLE public.customer_product_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on customer_product_mapping" 
ON public.customer_product_mapping FOR ALL 
USING (true) WITH CHECK (true);

-- 3. VENDOR PRODUCT MAPPING
-- Maps vendor/supplier-specific product codes to internal products
CREATE TABLE IF NOT EXISTS public.vendor_product_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  vendor_product_code text NOT NULL,
  internal_product_id uuid NOT NULL REFERENCES public.product_master(id) ON DELETE CASCADE,
  vendor_product_name text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vendor_id, vendor_product_code)
);

ALTER TABLE public.vendor_product_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on vendor_product_mapping" 
ON public.vendor_product_mapping FOR ALL 
USING (true) WITH CHECK (true);

-- 4. UNMAPPED PRODUCT CODES - Queue for user approval
CREATE TABLE IF NOT EXISTS public.unmapped_product_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('PO', 'SO', 'INVOICE')),
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'vendor', 'unknown')),
  sender_id uuid,
  original_product_code text NOT NULL,
  original_description text,
  original_unit_price numeric,
  original_quantity numeric,
  suggested_product_id uuid REFERENCES public.product_master(id),
  suggestion_confidence numeric DEFAULT 0,
  suggestion_reason text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'new_product')),
  resolved_product_id uuid REFERENCES public.product_master(id),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.unmapped_product_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on unmapped_product_codes" 
ON public.unmapped_product_codes FOR ALL 
USING (true) WITH CHECK (true);

-- 5. PRODUCT RESOLUTION AUDIT LOG
-- Tracks all resolution decisions for auditability
CREATE TABLE IF NOT EXISTS public.product_resolution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  document_type text NOT NULL,
  line_item_id uuid,
  original_product_code text NOT NULL,
  resolved_internal_product_id uuid REFERENCES public.product_master(id),
  resolution_method text NOT NULL CHECK (resolution_method IN (
    'customer_mapping', 
    'vendor_mapping', 
    'internal_code_match', 
    'cross_party_mapping',
    'ai_suggestion_approved',
    'manual_mapping',
    'unresolved'
  )),
  confidence_score numeric NOT NULL DEFAULT 0,
  sender_type text,
  sender_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.product_resolution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on product_resolution_log" 
ON public.product_resolution_log FOR ALL 
USING (true) WITH CHECK (true);

-- 6. UPDATE PO_ORDER_ITEMS to store resolution metadata
ALTER TABLE public.po_order_items 
ADD COLUMN IF NOT EXISTS original_product_code text,
ADD COLUMN IF NOT EXISTS resolved_internal_product_id uuid REFERENCES public.product_master(id),
ADD COLUMN IF NOT EXISTS resolution_method text,
ADD COLUMN IF NOT EXISTS resolution_confidence numeric,
ADD COLUMN IF NOT EXISTS resolution_status text DEFAULT 'pending' CHECK (resolution_status IN ('resolved', 'pending', 'unmapped', 'blocked'));

-- 7. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_product_mapping_customer ON public.customer_product_mapping(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_product_mapping_code ON public.customer_product_mapping(customer_product_code);
CREATE INDEX IF NOT EXISTS idx_customer_product_mapping_product ON public.customer_product_mapping(internal_product_id);

CREATE INDEX IF NOT EXISTS idx_vendor_product_mapping_vendor ON public.vendor_product_mapping(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_product_mapping_code ON public.vendor_product_mapping(vendor_product_code);
CREATE INDEX IF NOT EXISTS idx_vendor_product_mapping_product ON public.vendor_product_mapping(internal_product_id);

CREATE INDEX IF NOT EXISTS idx_product_master_code ON public.product_master(internal_code);
CREATE INDEX IF NOT EXISTS idx_unmapped_status ON public.unmapped_product_codes(status);

-- 8. Add triggers for updated_at
CREATE TRIGGER update_product_master_updated_at
BEFORE UPDATE ON public.product_master
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_product_mapping_updated_at
BEFORE UPDATE ON public.customer_product_mapping
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vendor_product_mapping_updated_at
BEFORE UPDATE ON public.vendor_product_mapping
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();