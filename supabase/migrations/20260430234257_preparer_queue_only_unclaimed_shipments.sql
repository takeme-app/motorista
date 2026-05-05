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
    AND s.preparer_id IS NULL
  ORDER BY s.driver_accepted_at DESC NULLS LAST, s.created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.preparer_shipment_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preparer_shipment_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.preparer_shipment_queue() TO service_role;

COMMENT ON FUNCTION public.preparer_shipment_queue() IS
  'Fila do preparador: mostra apenas encomendas da mesma base ainda sem preparador assumido.';
