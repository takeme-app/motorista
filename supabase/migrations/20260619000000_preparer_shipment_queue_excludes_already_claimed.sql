-- Bug: `preparer_shipment_queue()` incluía encomendas já claimed pelo próprio
-- preparador, com a condição `(preparer_id IS NULL OR preparer_id = auth.uid())`.
-- Resultado: o preparador aceitava uma encomenda, ela sumia na hora, mas voltava
-- a aparecer na fila de "Solicitações" no próximo refresh — fazendo parecer que
-- a encomenda foi reaberta. As coletas já aceitas ficam em outra tela
-- (ColetasEncomendasScreen) que filtra `preparer_id = user.id`.
--
-- Fix: a fila de "Solicitações" só mostra coletas ainda não aceitas
-- (`preparer_id IS NULL`). Encomendas já claimed pelo preparador aparecem
-- exclusivamente na aba de Coletas.
CREATE OR REPLACE FUNCTION public.preparer_shipment_queue()
 RETURNS SETOF shipments
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.*
  FROM public.shipments s
  INNER JOIN public.worker_profiles wp
    ON wp.id = auth.uid()
   AND wp.subtype = 'shipments'
   AND wp.base_id IS NOT NULL
   AND wp.base_id = s.base_id
  WHERE s.driver_id IS NOT NULL
    AND s.status IN ('pending_review', 'confirmed')
    AND s.base_id IS NOT NULL
    AND s.preparer_handoff_expired_at IS NULL
    AND s.delivered_to_base_at IS NULL
    AND s.preparer_id IS NULL
  ORDER BY s.driver_accepted_at DESC NULLS LAST, s.created_at DESC
  LIMIT 50;
$function$;

COMMENT ON FUNCTION public.preparer_shipment_queue() IS
  'Fila de Solicitações: encomendas com base ainda não aceitas por nenhum preparador (preparer_id IS NULL). Encomendas já aceitas pelo preparador atual aparecem na aba Coletas (filtro preparer_id = auth.uid()).';
