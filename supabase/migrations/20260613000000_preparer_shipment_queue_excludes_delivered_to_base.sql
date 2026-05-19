-- Esconde da fila do preparador envios já entregues na base.
--
-- Antes: depois que o preparador rodava `complete_shipment_preparer_to_base`
-- (PIN B), o envio continuava aparecendo no `HomeEncomendasScreen` porque
-- `status` permanece 'confirmed' (a RPC só seta `delivered_to_base_at`).
--
-- `delivered_to_base_at` é o marcador único de "preparador terminou sua parte"
-- (motorista ainda precisa retirar na base, mas isso já é trabalho dele).
-- Adicionamos `delivered_to_base_at IS NULL` no WHERE para que o card suma
-- assim que o preparador finaliza, sem mexer no `status` (outros consumidores
-- dependem dele) nem no comportamento atual da RPC de finalização.

CREATE OR REPLACE FUNCTION public.preparer_shipment_queue()
RETURNS SETOF public.shipments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND (s.preparer_id IS NULL OR s.preparer_id = auth.uid())
  ORDER BY s.driver_accepted_at DESC NULLS LAST, s.created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.preparer_shipment_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preparer_shipment_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.preparer_shipment_queue() TO service_role;

COMMENT ON FUNCTION public.preparer_shipment_queue() IS
  'Fila do preparador: mesma base, motorista já aceitou, handoff não expirou, ainda não entregue na base.';
