-- O bucket privado `dependent-documents` só tinha leitura do dono
-- ((storage.foldername(name))[1] = auth.uid()::text), então o admin não conseguia
-- gerar signed URL dos documentos de menores de outros usuários (createSignedUrl falhava por RLS).
-- Espelha a policy de admin já existente para driver-documents/vehicles (20260409140000).
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP POLICY IF EXISTS "Admin can read all dependent documents storage" ON storage.objects;
CREATE POLICY "Admin can read all dependent documents storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    lower(bucket_id::text) = 'dependent-documents'
    AND public.is_admin()
  );
