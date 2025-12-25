-- Create gmail_integrations table for storing OAuth tokens and settings
CREATE TABLE public.gmail_integrations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    email_address TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    sync_status TEXT DEFAULT 'pending',
    error_message TEXT,
    subject_filters TEXT[] DEFAULT ARRAY['invoice', 'bill', 'receipt', 'payment'],
    history_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create processed_emails table for tracking processed emails
CREATE TABLE public.processed_emails (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    integration_id UUID NOT NULL REFERENCES public.gmail_integrations(id) ON DELETE CASCADE,
    email_id TEXT NOT NULL,
    thread_id TEXT,
    subject TEXT,
    sender TEXT,
    received_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    attachments_count INTEGER DEFAULT 0,
    bills_created INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint on email_id per integration
CREATE UNIQUE INDEX idx_processed_emails_email_id ON public.processed_emails(integration_id, email_id);

-- Enable Row Level Security
ALTER TABLE public.gmail_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_emails ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for gmail_integrations (public access for now - no auth)
CREATE POLICY "Allow all operations on gmail_integrations" 
ON public.gmail_integrations 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create RLS policies for processed_emails
CREATE POLICY "Allow all operations on processed_emails" 
ON public.processed_emails 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create trigger for updating updated_at on gmail_integrations
CREATE TRIGGER update_gmail_integrations_updated_at
BEFORE UPDATE ON public.gmail_integrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();