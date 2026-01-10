-- Create table for Excel/OneDrive integrations
CREATE TABLE public.excel_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_address TEXT NOT NULL UNIQUE,
  display_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  sync_status TEXT DEFAULT 'disconnected',
  last_sync_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  selected_file_id TEXT,
  selected_file_name TEXT,
  sync_interval_minutes INTEGER DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.excel_integrations ENABLE ROW LEVEL SECURITY;

-- Create policies (public access for this app since no auth)
CREATE POLICY "Allow all access to excel_integrations" 
ON public.excel_integrations 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_excel_integrations_updated_at
BEFORE UPDATE ON public.excel_integrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();