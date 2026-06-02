-- O cliente seleciona explicitamente uma `scheduled_trip` ao pedir o envio
-- (SelectShipmentDriverScreen → ConfirmShipmentScreen → INSERT em shipments
-- com `scheduled_trip_id` setado). Mas `shipment_driver_accept_offer`
-- ignorava esse campo e reescrevia com a próxima trip do motorista
-- (`ORDER BY departure_at ASC LIMIT 1`), atribuindo a encomenda à trip mais
-- próxima cronologicamente em vez da que o cliente escolheu.
--
-- Agora: se o shipment já tem `scheduled_trip_id` e essa trip é elegível
-- (mesmo motorista, status ativo, ainda não iniciada, partida futura), usa
-- ela. Senão, cai no fallback original (próxima trip da mesma rota).

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
  v_window_minutes integer := public.get_preparer_handoff_window_minutes();
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

  -- Caminho preferido: respeitar a trip que o cliente já escolheu.
  IF s.scheduled_trip_id IS NOT NULL THEN
    SELECT st.id, st.departure_at INTO trip_id, trip_departure
    FROM public.scheduled_trips st
    WHERE st.id = s.scheduled_trip_id
      AND st.driver_id = auth.uid()
      AND st.status = 'active'
      AND st.is_active IS TRUE
      AND st.driver_journey_started_at IS NULL
      AND st.departure_at > now();
  END IF;

  -- Fallback: nenhuma trip pré-escolhida (ou trip não elegível) → procura
  -- a próxima trip do motorista na mesma rota.
  IF trip_id IS NULL THEN
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
  END IF;

  IF trip_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_matching_trip');
  END IF;

  v_handoff_deadline := CASE
    WHEN s.base_id IS NOT NULL THEN trip_departure - make_interval(mins => v_window_minutes)
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
    preparer_handoff_expired_at = CASE
      WHEN s.base_id IS NOT NULL
        AND v_handoff_deadline IS NOT NULL
        AND v_handoff_deadline <= now()
      THEN now()
      ELSE preparer_handoff_expired_at
    END
  WHERE id = p_shipment_id;

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
