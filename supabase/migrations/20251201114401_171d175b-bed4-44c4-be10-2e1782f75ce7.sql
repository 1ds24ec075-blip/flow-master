-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for user roles
CREATE TYPE user_role AS ENUM ('quotation_officer', 'invoice_officer', 'approval_manager', 'admin', 'client_portal');

-- Create enum for quotation status
CREATE TYPE quotation_status AS ENUM ('draft', 'sent', 'approved', 'rejected');

-- Create enum for PO status
CREATE TYPE po_status AS ENUM ('draft', 'sent', 'processing', 'materials_received', 'completed');

-- Create enum for invoice status
CREATE TYPE invoice_status AS ENUM ('pending', 'awaiting_approval', 'approved', 'rejected');

-- Create enum for approval status
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');

-- Create Clients table
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  email TEXT,
  gst_number TEXT,
  contact_person TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create Suppliers table
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT,
  gst_number TEXT,
  material_type TEXT,
  payment_terms TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create Quotations table
CREATE TABLE public.quotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_number TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by TEXT,
  informal_text_quotation TEXT,
  amount DECIMAL(15, 2),
  status quotation_status DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create PurchaseOrders table
CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number TEXT NOT NULL UNIQUE,
  quotation_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  po_details TEXT,
  material_items JSONB,
  amount DECIMAL(15, 2),
  created_by TEXT,
  status po_status DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create RawMaterialInvoices table
CREATE TABLE public.raw_material_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  invoice_file TEXT,
  extracted_data JSONB,
  amount DECIMAL(15, 2),
  status invoice_status DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create ClientInvoices table
CREATE TABLE public.client_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_file TEXT,
  amount DECIMAL(15, 2),
  status invoice_status DEFAULT 'awaiting_approval',
  created_by TEXT,
  tally_uploaded BOOLEAN DEFAULT false,
  tally_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create Approvals table
CREATE TABLE public.approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  linked_invoice_type TEXT NOT NULL CHECK (linked_invoice_type IN ('client', 'raw_materials')),
  linked_invoice_id UUID NOT NULL,
  status approval_status DEFAULT 'pending',
  approved_by TEXT,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create UserRoles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_material_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (Allow all operations for now since no auth is required)
CREATE POLICY "Allow all operations on clients" ON public.clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on suppliers" ON public.suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on quotations" ON public.quotations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on purchase_orders" ON public.purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on raw_material_invoices" ON public.raw_material_invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on client_invoices" ON public.client_invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on approvals" ON public.approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_roles" ON public.user_roles FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX idx_quotations_client ON public.quotations(client_id);
CREATE INDEX idx_quotations_status ON public.quotations(status);
CREATE INDEX idx_purchase_orders_client ON public.purchase_orders(client_id);
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX idx_raw_material_invoices_po ON public.raw_material_invoices(po_id);
CREATE INDEX idx_raw_material_invoices_status ON public.raw_material_invoices(status);
CREATE INDEX idx_client_invoices_client ON public.client_invoices(client_id);
CREATE INDEX idx_client_invoices_status ON public.client_invoices(status);
CREATE INDEX idx_approvals_status ON public.approvals(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quotations_updated_at BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_raw_material_invoices_updated_at BEFORE UPDATE ON public.raw_material_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_client_invoices_updated_at BEFORE UPDATE ON public.client_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_approvals_updated_at BEFORE UPDATE ON public.approvals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();