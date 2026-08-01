-- Drop any pre-existing policies on storage.objects for these buckets
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "Authenticated users can read app files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('bills', 'po-documents'));

CREATE POLICY "Authenticated users can upload app files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('bills', 'po-documents'));

CREATE POLICY "Authenticated users can update app files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('bills', 'po-documents'))
  WITH CHECK (bucket_id IN ('bills', 'po-documents'));

CREATE POLICY "Authenticated users can delete app files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('bills', 'po-documents'));