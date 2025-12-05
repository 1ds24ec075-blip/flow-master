/*
  # Setup Bills Storage Bucket

  1. Storage
    - Create 'bills' bucket for storing bill/receipt images
    - Enable public access for authenticated users
    
  2. Security
    - Allow authenticated users to upload bills
    - Allow authenticated users to view all bills
    - Allow authenticated users to delete bills
*/

-- Create the bills bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('bills', 'bills', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated users to upload bills
CREATE POLICY "Authenticated users can upload bills"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'bills');

-- Policy: Allow authenticated users to view bills
CREATE POLICY "Authenticated users can view bills"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bills');

-- Policy: Allow authenticated users to update bills
CREATE POLICY "Authenticated users can update bills"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'bills')
WITH CHECK (bucket_id = 'bills');

-- Policy: Allow authenticated users to delete bills
CREATE POLICY "Authenticated users can delete bills"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'bills');