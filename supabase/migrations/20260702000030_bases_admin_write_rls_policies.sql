-- bases tinha RLS ativo só com SELECT → admin (anon key + is_admin()) não conseguia gravar.
-- Isso bloqueava silenciosamente createBase/updateBase e a nova tarifa por base do preparador.
-- Adiciona policies de escrita restritas a admin.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP POLICY IF EXISTS "Admin can insert bases" ON public.bases;
CREATE POLICY "Admin can insert bases" ON public.bases
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can update bases" ON public.bases;
CREATE POLICY "Admin can update bases" ON public.bases
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete bases" ON public.bases;
CREATE POLICY "Admin can delete bases" ON public.bases
  FOR DELETE TO authenticated
  USING (public.is_admin());
