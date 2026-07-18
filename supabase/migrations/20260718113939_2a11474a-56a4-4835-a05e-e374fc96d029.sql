
CREATE TABLE public.tally_bridges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  tally_url TEXT NOT NULL DEFAULT 'http://localhost:9000',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  last_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tally_bridges TO authenticated;
GRANT ALL ON public.tally_bridges TO service_role;
ALTER TABLE public.tally_bridges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bridges" ON public.tally_bridges FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_tally_bridges_user ON public.tally_bridges(user_id);

CREATE TABLE public.tally_push_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bridge_id UUID REFERENCES public.tally_bridges(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  label TEXT,
  payload_xml TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  tally_response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tally_push_jobs TO authenticated;
GRANT ALL ON public.tally_push_jobs TO service_role;
ALTER TABLE public.tally_push_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs" ON public.tally_push_jobs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_tally_jobs_user_status ON public.tally_push_jobs(user_id, status, created_at);
CREATE INDEX idx_tally_jobs_bridge_status ON public.tally_push_jobs(bridge_id, status, created_at);

CREATE TRIGGER trg_tally_bridges_updated
  BEFORE UPDATE ON public.tally_bridges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tally_jobs_updated
  BEFORE UPDATE ON public.tally_push_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
