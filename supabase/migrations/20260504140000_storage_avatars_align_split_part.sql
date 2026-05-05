-- Bucket avatars: alinhar com driver-documents / trip-expenses.
-- `split_part(name, '/', 1)` é mais previsível que `storage.foldername` em alguns
-- casos; UPDATE com WITH CHECK explícito cobre `upsert: true` (INSERT+UPDATE) sem
-- ambiguidade de RLS.
--
-- Referência: 20250325130000_storage_driver_documents_authenticated_policies.sql
--            20260522190000_trip_expenses_storage_split_part.sql

DROP POLICY IF EXISTS "Profile avatars upload" ON storage.objects;
CREATE POLICY "Profile avatars upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    lower(bucket_id::text) = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Profile avatars update" ON storage.objects;
CREATE POLICY "Profile avatars update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    lower(bucket_id::text) = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    lower(bucket_id::text) = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Profile avatars delete" ON storage.objects;
CREATE POLICY "Profile avatars delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    lower(bucket_id::text) = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );
