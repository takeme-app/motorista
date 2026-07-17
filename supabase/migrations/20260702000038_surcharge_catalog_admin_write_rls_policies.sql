-- surcharge_catalog só tinha policies de SELECT (admin read + authenticated read
-- ativos). Sem INSERT/UPDATE/DELETE, o painel admin (anon key + is_admin()) não
-- conseguia criar/editar/remover adicionais — as gravações eram bloqueadas por RLS.
-- Adiciona policies de escrita restritas a admin, no mesmo padrão de bases/notifications.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP POLICY IF EXISTS "Admin can insert surcharge_catalog" ON public.surcharge_catalog;
CREATE POLICY "Admin can insert surcharge_catalog" ON public.surcharge_catalog
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can update surcharge_catalog" ON public.surcharge_catalog;
CREATE POLICY "Admin can update surcharge_catalog" ON public.surcharge_catalog
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete surcharge_catalog" ON public.surcharge_catalog;
CREATE POLICY "Admin can delete surcharge_catalog" ON public.surcharge_catalog
  FOR DELETE TO authenticated
  USING (public.is_admin());
