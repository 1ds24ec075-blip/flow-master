/*
  # Fix Bills Storage Bucket Configuration

  1. Storage
    - Ensure 'bills' bucket exists and is properly configured
    - Set bucket to public for easier access
    - Clean up and recreate all storage policies
    
  2. Security
    - Allow public read access for viewing bills
    - Allow authenticated users to upload, update, and delete bills
*/

-- Ensure the bills bucket exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('bills', 'bills', true, 10485760, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) 
DO UPDATE SET 
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

-- Drop existing policies
DROP POLICY IF EXISTS "Public users can view bills" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view bills" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload bills" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update bills" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete bills" ON storage.objects;

-- Create comprehensive policies

-- Public can view (since bucket is public)
CREATE POLICY "Public can view bills images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'bills');

-- Authenticated users can insert
CREATE POLICY "Authenticated can upload bills"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'bills');

-- Authenticated users can update their uploads
CREATE POLICY "Authenticated can update bills"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'bills')
WITH CHECK (bucket_id = 'bills');

-- Authenticated users can delete
CREATE POLICY "Authenticated can delete bills"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'bills');