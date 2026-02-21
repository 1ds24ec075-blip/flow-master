
-- Weekly liquidity tracking table
CREATE TABLE public.weekly_liquidity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start_date DATE NOT NULL,
  opening_balance NUMERIC DEFAULT 0,
  alert_threshold NUMERIC DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Line items for manual entries and tracking
CREATE TABLE public.liquidity_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  liquidity_week_id UUID NOT NULL REFERENCES public.weekly_liquidity(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('collection', 'payment')),
  description TEXT NOT NULL,
  expected_amount NUMERIC NOT NULL DEFAULT 0,
  actual_amount NUMERIC DEFAULT 0,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'completed', 'overdue')),
  payment_date DATE,
  linked_invoice_id UUID,
  linked_invoice_type TEXT CHECK (linked_invoice_type IN ('supplier', 'customer', 'manual')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.weekly_liquidity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidity_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on weekly_liquidity" ON public.weekly_liquidity FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on liquidity_line_items" ON public.liquidity_line_items FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.liquidity_line_items;
