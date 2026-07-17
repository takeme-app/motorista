-- A tela de moderação de avaliações (/avaliacoes) permite remover avaliações,
-- mas booking_ratings/shipment_ratings/trip_ratings só tinham policies de
-- SELECT/INSERT/UPDATE — nenhuma de DELETE. O botão "excluir" do admin falhava
-- silenciosamente (removia da UI, mas a linha permanecia no banco).
-- Adiciona DELETE restrito a admin nas três tabelas de avaliação.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP POLICY IF EXISTS "Admin can delete booking_ratings" ON public.booking_ratings;
CREATE POLICY "Admin can delete booking_ratings" ON public.booking_ratings
  FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete shipment_ratings" ON public.shipment_ratings;
CREATE POLICY "Admin can delete shipment_ratings" ON public.shipment_ratings
  FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can delete trip_ratings" ON public.trip_ratings;
CREATE POLICY "Admin can delete trip_ratings" ON public.trip_ratings
  FOR DELETE TO authenticated
  USING (public.is_admin());
