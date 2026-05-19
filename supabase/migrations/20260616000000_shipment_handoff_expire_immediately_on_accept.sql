-- Quando o motorista aceita uma viagem cuja partida já passou de 1h (encomenda
-- criada/aceita com pouco tempo até a viagem), o deadline do preparador
-- (departure - 1h) cai no passado. Antes esperávamos o cron expirar isso até
-- 1 min depois — o cliente via "entregar na base" nesse intervalo.
-- Agora marcamos `preparer_handoff_expired_at` no mesmo UPDATE quando o
-- deadline já está no passado, eliminando essa janela.
CREATE OR REPLACE FUNCTION public.shipment_driver_accept_offer(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.shipments%ROWTYPE;
  trip_id uuid;
  trip_departure timestamptz;
  v_handoff_deadline timestamptz;
BEGIN
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF s.current_offer_driver_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_offer');
  END IF;
  IF s.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_assigned');
  END IF;
  IF s.current_offer_expires_at IS NOT NULL AND s.current_offer_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_expired');
  END IF;

  SELECT st.id, st.departure_at INTO trip_id, trip_departure
  FROM public.scheduled_trips st
  WHERE st.driver_id = auth.uid()
    AND st.status = 'active'
    AND st.is_active IS TRUE
    AND st.driver_journey_started_at IS NULL
    AND st.departure_at > now()
    AND public.shipment_same_route_as_trip(
      s.origin_lat, s.origin_lng, s.destination_lat, s.destination_lng,
      st.origin_lat, st.origin_lng, st.destination_lat, st.destination_lng
    )
  ORDER BY st.departure_at ASC
  LIMIT 1;

  IF trip_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_matching_trip');
  END IF;

  -- Deadline do preparador = partida - 1h. Só faz sentido para shipments com base.
  v_handoff_deadline := CASE
    WHEN s.base_id IS NOT NULL THEN trip_departure - INTERVAL '1 hour'
    ELSE NULL
  END;

  UPDATE public.shipments
  SET
    driver_id = auth.uid(),
    driver_accepted_at = now(),
    scheduled_trip_id = trip_id,
    current_offer_driver_id = NULL,
    current_offer_expires_at = NULL,
    driver_offer_index = -1,
    driver_offer_queue = NULL,
    preparer_handoff_expires_at = v_handoff_deadline,
    -- Se o deadline já passou no momento do aceite, marca como expirado
    -- imediatamente (não esperamos o cron). Isso garante que cliente,
    -- motorista e ensure_shipment_trip_stops vejam o fluxo cliente↔motorista
    -- direto, sem a base.
    preparer_handoff_expired_at = CASE
      WHEN s.base_id IS NOT NULL
        AND v_handoff_deadline IS NOT NULL
        AND v_handoff_deadline <= now()
      THEN now()
      ELSE preparer_handoff_expired_at
    END
  WHERE id = p_shipment_id;

  -- Mesma sincronização que o cron faria: reaponta os trip_stops do shipment
  -- para a casa do cliente quando o handoff expira no aceite.
  IF s.base_id IS NOT NULL
    AND v_handoff_deadline IS NOT NULL
    AND v_handoff_deadline <= now()
  THEN
    UPDATE public.trip_stops ts
    SET
      label = 'Encomenda: ' || coalesce(nullif(trim(s.recipient_name), ''), 'Pacote'),
      address = coalesce(nullif(trim(s.origin_address), ''), ts.address),
      lat = s.origin_lat,
      lng = s.origin_lng,
      code = COALESCE(nullif(trim(s.pickup_code), ''), ts.code),
      updated_at = now()
    WHERE ts.scheduled_trip_id = trip_id
      AND ts.entity_id = p_shipment_id
      AND lower(trim(ts.stop_type)) IN ('shipment_pickup', 'package_pickup')
      AND lower(trim(ts.status)) = 'pending';
  END IF;

  RETURN jsonb_build_object('ok', true, 'scheduled_trip_id', trip_id);
END;
$$;

REVOKE ALL ON FUNCTION public.shipment_driver_accept_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shipment_driver_accept_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_driver_accept_offer(uuid) TO service_role;
