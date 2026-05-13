-- Ajusta `ensure_shipment_trip_stops` para considerar `preparer_handoff_expired_at`:
-- quando o preparador da base perdeu a janela, o motorista coleta direto na casa
-- do cliente (mesmo que `base_id` esteja setado). Igual fluxo de envios sem base.
--
-- Também regrava trip_stops já materializados para o tipo "base" quando o handoff
-- expira (sincroniza com o cron `shipment_process_expired_preparer_handoffs`).

CREATE OR REPLACE FUNCTION public.ensure_shipment_trip_stops (p_trip_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.shipments%ROWTYPE;
  v_pickup_address text;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_label text;
  v_pickup_code_for_driver text;
  v_uses_base boolean;
  v_seq integer;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.auth_is_driver_of_scheduled_trip (p_trip_id) THEN
    RETURN;
  END IF;

  FOR s IN
    SELECT *
    FROM public.shipments sh
    WHERE sh.scheduled_trip_id = p_trip_id
      AND sh.status NOT IN ('cancelled', 'delivered', 'disputed', 'refunded')
  LOOP
    -- "Usa base" só se base_id existe E o handoff do preparador NÃO expirou.
    -- Após expirar, motorista assume a coleta direta (igual a um envio sem base).
    v_uses_base := s.base_id IS NOT NULL AND s.preparer_handoff_expired_at IS NULL;

    IF v_uses_base THEN
      SELECT
        coalesce(nullif(trim(array_to_string(array_remove(ARRAY[bs.name, bs.address, bs.city], NULL), ' — ')), ''), bs.address, ''),
        bs.lat,
        bs.lng
      INTO v_pickup_address, v_pickup_lat, v_pickup_lng
      FROM public.bases bs
      WHERE bs.id = s.base_id
        AND bs.is_active = true;

      v_pickup_label := 'Retirada na base';
      v_pickup_code_for_driver := nullif(trim(s.base_to_driver_code), '');
    ELSE
      v_pickup_address := coalesce(nullif(trim(s.origin_address), ''), '');
      v_pickup_lat := s.origin_lat;
      v_pickup_lng := s.origin_lng;
      v_pickup_label := 'Encomenda: ' || coalesce(nullif(trim(s.recipient_name), ''), 'Pacote');
      v_pickup_code_for_driver := nullif(trim(s.pickup_code), '');
    END IF;

    -- shipment_pickup
    IF NOT EXISTS (
      SELECT 1
      FROM public.trip_stops ts
      WHERE ts.scheduled_trip_id = p_trip_id
        AND ts.entity_id = s.id
        AND lower(trim(ts.stop_type)) IN ('shipment_pickup', 'package_pickup')
    ) THEN
      v_seq := public.trip_stops_next_sequence (p_trip_id);
      INSERT INTO public.trip_stops (
        scheduled_trip_id, stop_type, entity_id, label, address,
        lat, lng, sequence_order, status, notes, code
      ) VALUES (
        p_trip_id, 'shipment_pickup', s.id,
        v_pickup_label,
        coalesce(v_pickup_address, ''),
        v_pickup_lat, v_pickup_lng,
        v_seq, 'pending',
        nullif(trim(s.instructions), ''), v_pickup_code_for_driver
      );
    ELSE
      -- Backfill: atualiza coords/label/code para refletir o estado atual.
      -- Importante para o caso "handoff expirou enquanto motorista já tinha
      -- visto a parada na base" — regrava para casa do cliente.
      UPDATE public.trip_stops ts
      SET
        label = v_pickup_label,
        address = coalesce(v_pickup_address, ''),
        lat = v_pickup_lat,
        lng = v_pickup_lng,
        code = COALESCE(v_pickup_code_for_driver, ts.code),
        updated_at = now()
      WHERE ts.scheduled_trip_id = p_trip_id
        AND ts.entity_id = s.id
        AND lower(trim(ts.stop_type)) IN ('shipment_pickup', 'package_pickup')
        AND lower(trim(ts.status)) = 'pending';
    END IF;

    -- shipment_dropoff (PIN D = delivery_code, sem mudança)
    IF NOT EXISTS (
      SELECT 1
      FROM public.trip_stops ts
      WHERE ts.scheduled_trip_id = p_trip_id
        AND ts.entity_id = s.id
        AND lower(trim(ts.stop_type)) IN ('shipment_dropoff', 'package_dropoff')
    ) THEN
      v_seq := public.trip_stops_next_sequence (p_trip_id);
      INSERT INTO public.trip_stops (
        scheduled_trip_id, stop_type, entity_id, label, address,
        lat, lng, sequence_order, status, notes, code
      ) VALUES (
        p_trip_id, 'shipment_dropoff', s.id,
        coalesce(nullif(trim(s.recipient_name), ''), 'Destinatário'),
        coalesce(nullif(trim(s.destination_address), ''), ''),
        s.destination_lat, s.destination_lng,
        v_seq, 'pending',
        NULL, nullif(trim(s.delivery_code), '')
      );
    ELSE
      UPDATE public.trip_stops ts
      SET code = nullif(trim(s.delivery_code), ''), updated_at = now()
      WHERE ts.scheduled_trip_id = p_trip_id
        AND ts.entity_id = s.id
        AND lower(trim(ts.stop_type)) IN ('shipment_dropoff', 'package_dropoff')
        AND (ts.code IS NULL OR trim(ts.code) = '')
        AND nullif(trim(s.delivery_code), '') IS NOT NULL;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ensure_shipment_trip_stops (uuid) IS
  'Materializa shipment_pickup/dropoff em trip_stops. Usa base apenas se preparer_handoff_expired_at IS NULL; após expiração o motorista coleta direto na casa do cliente.';

-- Estende o cron para também regravar trip_stops existentes apontando à base
-- quando o handoff expira — assim o motorista que já tinha aberto a viagem
-- vê a parada migrar para a casa do cliente automaticamente.
CREATE OR REPLACE FUNCTION public.shipment_process_expired_preparer_handoffs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.shipments
    SET preparer_handoff_expired_at = now()
    WHERE base_id IS NOT NULL
      AND preparer_id IS NULL
      AND preparer_handoff_expires_at IS NOT NULL
      AND preparer_handoff_expires_at <= now()
      AND preparer_handoff_expired_at IS NULL
      AND status IN ('confirmed', 'in_progress')
    RETURNING id, scheduled_trip_id, origin_address, origin_lat, origin_lng, recipient_name, pickup_code
  )
  UPDATE public.trip_stops ts
  SET
    label = 'Encomenda: ' || coalesce(nullif(trim(e.recipient_name), ''), 'Pacote'),
    address = coalesce(nullif(trim(e.origin_address), ''), ts.address),
    lat = e.origin_lat,
    lng = e.origin_lng,
    code = COALESCE(nullif(trim(e.pickup_code), ''), ts.code),
    updated_at = now()
  FROM expired e
  WHERE ts.scheduled_trip_id = e.scheduled_trip_id
    AND ts.entity_id = e.id
    AND lower(trim(ts.stop_type)) IN ('shipment_pickup', 'package_pickup')
    AND lower(trim(ts.status)) = 'pending';

  -- Contagem para retorno: shipments que tiveram preparer_handoff_expired_at
  -- setado nos últimos 2 minutos (proxy da última batch processada).
  SELECT count(*) INTO expired_count
  FROM public.shipments
  WHERE preparer_handoff_expired_at IS NOT NULL
    AND preparer_handoff_expires_at IS NOT NULL
    AND preparer_handoff_expires_at <= now()
    AND preparer_handoff_expired_at >= now() - INTERVAL '2 minutes';

  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.shipment_process_expired_preparer_handoffs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shipment_process_expired_preparer_handoffs() TO service_role;
