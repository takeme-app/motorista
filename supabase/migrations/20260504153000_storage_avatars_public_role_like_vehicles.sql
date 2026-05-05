-- Avatar uploads ainda falhavam com RLS mesmo após split_part: o bucket `vehicles`
-- usa políticas TO **public** + `auth.role() = 'authenticated'` (vehicles_auth_write).
-- Alinhar avatars ao mesmo modelo + comparar pasta em **lower()** (JWT/path podem
-- divergir em maiúsculas/minúsculas na string UUID).

DROP POLICY IF EXISTS "Profile avatars upload" ON storage.objects;
DROP POLICY IF EXISTS "Profile avatars update" ON storage.objects;
DROP POLICY IF EXISTS "Profile avatars delete" ON storage.objects;

CREATE POLICY "Profile avatars upload"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (
    lower(bucket_id::text) = 'avatars'
    AND auth.role() = 'authenticated'::text
    AND lower(split_part(name, '/', 1)) = lower(auth.uid()::text)
  );

CREATE POLICY "Profile avatars update"
  ON storage.objects FOR UPDATE TO public
  USING (
    lower(bucket_id::text) = 'avatars'
    AND auth.role() = 'authenticated'::text
    AND lower(split_part(name, '/', 1)) = lower(auth.uid()::text)
  )
  WITH CHECK (
    lower(bucket_id::text) = 'avatars'
    AND auth.role() = 'authenticated'::text
    AND lower(split_part(name, '/', 1)) = lower(auth.uid()::text)
  );

CREATE POLICY "Profile avatars delete"
  ON storage.objects FOR DELETE TO public
  USING (
    lower(bucket_id::text) = 'avatars'
    AND auth.role() = 'authenticated'::text
    AND lower(split_part(name, '/', 1)) = lower(auth.uid()::text)
  );
