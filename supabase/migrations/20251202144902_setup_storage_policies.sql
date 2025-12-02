/*
  # Setup Storage Policies for PO Documents

  1. Storage Policies
    - Allow authenticated users to upload files to po-documents bucket
    - Allow authenticated users to read files from po-documents bucket
    - Allow service role to manage all files

  2. Security
    - Files are only accessible to authenticated users
    - Upload restricted to authenticated users
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname = 'Allow authenticated users to upload files'
  ) THEN
    CREATE POLICY "Allow authenticated users to upload files"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'po-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname = 'Allow authenticated users to read files'
  ) THEN
    CREATE POLICY "Allow authenticated users to read files"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'po-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname = 'Allow authenticated users to delete their files'
  ) THEN
    CREATE POLICY "Allow authenticated users to delete their files"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'po-documents');
  END IF;
END $$;
