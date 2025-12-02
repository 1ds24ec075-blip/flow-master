-- Create storage bucket for PO documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('po-documents', 'po-documents', false);

-- RLS policies for PO documents bucket
CREATE POLICY "Allow authenticated users to upload PO documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'po-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read PO documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'po-documents' AND auth.role() = 'authenticated');

-- Create PO intake documents table
CREATE TABLE public.po_intake_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_by TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  extracted_data JSONB,
  confidence_scores JSONB,
  reviewed_data JSONB,
  tally_json JSONB,
  tally_xml TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.po_intake_documents ENABLE ROW LEVEL SECURITY;

-- RLS policies for PO intake documents
CREATE POLICY "Allow all operations on po_intake_documents"
ON public.po_intake_documents
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_po_intake_documents_updated_at
BEFORE UPDATE ON public.po_intake_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();