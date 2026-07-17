-- pricing_route_surcharges (vínculo trecho <-> adicional) só tinha policies de
-- SELECT. Sem INSERT/UPDATE/DELETE, o admin não conseguia vincular/desvincular
-- adicionais a trechos (as gravações eram bloqueadas por RLS). Adiciona escrita
-- restrita a admin, no mesmo padrão de surcharge_catalog/bases/notifications.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP POLICY IF EXISTS "Admin can insert pricing_route_surcharges" ON public.pricing_route_surcharges;
CREATE POLICY "Admin can insert pricing_route_surcharges" ON public.pricing_route_surcharges
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can update pricing_route_surcharges" ON public.pricing_route_surcharges;
CREATE POLICY "Admin can update pricing_route_surcharges" ON public.pricing_route_surcharges
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete pricing_route_surcharges" ON public.pricing_route_surcharges;
CREATE POLICY "Admin can delete pricing_route_surcharges" ON public.pricing_route_surcharges
  FOR DELETE TO authenticated
  USING (public.is_admin());
