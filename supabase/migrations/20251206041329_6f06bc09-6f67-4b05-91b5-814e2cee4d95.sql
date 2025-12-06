-- Create expense_categories table
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create bills table
CREATE TABLE IF NOT EXISTS public.bills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_number TEXT,
  vendor_name TEXT NOT NULL,
  vendor_gst TEXT,
  bill_date DATE,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  extraction_confidence NUMERIC DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  category_id UUID REFERENCES public.expense_categories(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

-- Create policies for expense_categories (public read, authenticated write)
CREATE POLICY "Anyone can view expense categories"
ON public.expense_categories FOR SELECT
TO public
USING (true);

CREATE POLICY "Authenticated users can manage expense categories"
ON public.expense_categories FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Create policies for bills (public access for now since no auth)
CREATE POLICY "Anyone can view bills"
ON public.bills FOR SELECT
TO public
USING (true);

CREATE POLICY "Anyone can insert bills"
ON public.bills FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Anyone can update bills"
ON public.bills FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

CREATE POLICY "Anyone can delete bills"
ON public.bills FOR DELETE
TO public
USING (true);

-- Create updated_at trigger for both tables
CREATE TRIGGER update_expense_categories_updated_at
BEFORE UPDATE ON public.expense_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bills_updated_at
BEFORE UPDATE ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default expense categories
INSERT INTO public.expense_categories (name, color, description) VALUES
('Office Supplies', '#3b82f6', 'Stationery, equipment, and office materials'),
('Travel', '#10b981', 'Transportation and travel expenses'),
('Utilities', '#f59e0b', 'Electricity, water, internet bills'),
('Raw Materials', '#8b5cf6', 'Manufacturing raw materials'),
('Marketing', '#ec4899', 'Advertising and marketing expenses'),
('Maintenance', '#6366f1', 'Repairs and maintenance'),
('Miscellaneous', '#6b7280', 'Other uncategorized expenses')
ON CONFLICT DO NOTHING;

-- Create bills storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('bills', 'bills', true, 10485760, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) 
DO UPDATE SET 
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

-- Storage policies for bills bucket
CREATE POLICY "Public can view bills images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'bills');

CREATE POLICY "Public can upload bills"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'bills');

CREATE POLICY "Public can update bills"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'bills')
WITH CHECK (bucket_id = 'bills');

CREATE POLICY "Public can delete bills"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'bills');