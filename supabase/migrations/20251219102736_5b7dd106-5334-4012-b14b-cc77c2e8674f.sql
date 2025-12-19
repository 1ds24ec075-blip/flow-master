CREATE TABLE expense_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID REFERENCES bills(id) ON DELETE CASCADE,
  item_description TEXT,
  quantity NUMERIC DEFAULT 1,
  unit_price NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE expense_line_items ENABLE ROW LEVEL SECURITY;

-- Public access policy
CREATE POLICY "Allow all access to expense_line_items" ON expense_line_items
  FOR ALL USING (true) WITH CHECK (true);