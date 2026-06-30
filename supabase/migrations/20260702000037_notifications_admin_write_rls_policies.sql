-- notifications tinha INSERT só para papéis de sistema (postgres/service_role/supabase_admin)
-- e nenhuma policy de DELETE. O painel admin (anon key + is_admin()) recebia 403 ao
-- "Enviar notificação" (broadcast/individual) e ao remover notificações.
-- Adiciona policies de escrita restritas a admin, alinhadas ao "Admin can read all
-- notifications" (SELECT) e ao padrão de bases.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP POLICY IF EXISTS "Admin can insert notifications" ON public.notifications;
CREATE POLICY "Admin can insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete notifications" ON public.notifications;
CREATE POLICY "Admin can delete notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (public.is_admin());
