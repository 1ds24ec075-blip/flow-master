
-- Create inventory_items table
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  current_quantity INTEGER NOT NULL DEFAULT 0,
  minimum_threshold INTEGER NOT NULL DEFAULT 10,
  default_reorder_quantity INTEGER NOT NULL DEFAULT 50,
  unit TEXT NOT NULL DEFAULT 'units',
  estimated_lead_time_days INTEGER DEFAULT 7,
  preferred_supplier_id UUID REFERENCES public.suppliers(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create reorder_requests table
CREATE TABLE public.reorder_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  supplier_id UUID REFERENCES public.suppliers(id),
  quantity_requested INTEGER NOT NULL,
  quantity_at_trigger INTEGER,
  minimum_threshold_at_trigger INTEGER,
  status TEXT NOT NULL DEFAULT 'sent',
  internal_note TEXT,
  requested_delivery_date DATE,
  triggered_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create supplier_communications table
CREATE TABLE public.supplier_communications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reorder_request_id UUID REFERENCES public.reorder_requests(id),
  supplier_id UUID REFERENCES public.suppliers(id),
  communication_type TEXT NOT NULL DEFAULT 'email',
  subject TEXT,
  body TEXT,
  recipient_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reorder_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on inventory_items" ON public.inventory_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on reorder_requests" ON public.reorder_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on supplier_communications" ON public.supplier_communications FOR ALL USING (true) WITH CHECK (true);
