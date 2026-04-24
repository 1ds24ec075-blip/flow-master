
CREATE TABLE public.agent_activity_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  action text NOT NULL,
  summary text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  entity_type text,
  entity_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_activity_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on agent_activity_feed" ON public.agent_activity_feed FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_activity_feed;
ALTER TABLE public.agent_activity_feed REPLICA IDENTITY FULL;

CREATE TABLE public.morning_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_date date NOT NULL DEFAULT CURRENT_DATE,
  headline text NOT NULL,
  summary text NOT NULL,
  highlights jsonb DEFAULT '[]'::jsonb,
  alerts jsonb DEFAULT '[]'::jsonb,
  recommendations jsonb DEFAULT '[]'::jsonb,
  metrics jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.morning_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on morning_briefs" ON public.morning_briefs FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_morning_briefs_date ON public.morning_briefs(brief_date DESC);

CREATE TABLE public.cash_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_date date NOT NULL DEFAULT CURRENT_DATE,
  opening_balance numeric NOT NULL DEFAULT 0,
  total_inflows numeric NOT NULL DEFAULT 0,
  total_outflows numeric NOT NULL DEFAULT 0,
  projected_min_balance numeric NOT NULL DEFAULT 0,
  crisis_day date,
  crisis_severity text NOT NULL DEFAULT 'none',
  daily_breakdown jsonb DEFAULT '[]'::jsonb,
  ai_recommendation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on cash_forecasts" ON public.cash_forecasts FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_cash_forecasts_date ON public.cash_forecasts(forecast_date DESC);
