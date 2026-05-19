-- Encomendas não consomem assento.
-- Antes desta migration, `shipment_begin_driver_offering` e
-- `shipment_open_driver_offer_queue_internal` montavam a fila com
-- `AND st.seats_available > 0`. Resultado: uma viagem com todas as vagas de
-- passageiros já reservadas (ex.: capacidade 1, com 1 reserva) sumia da fila,
-- mesmo com espaço de carga. O envio caía em `status = 'cancelled'` e
-- `cancellation_reason = 'no_driver_accepted'`, com estorno automático.
--
-- A regra correta: encomenda só precisa que a viagem esteja `active`, com
-- partida futura e na mesma rota. Capacidade de bagagem fica a critério do
-- motorista no momento do aceite. Espelha o filtro removido do frontend em
-- `loadClientScheduledTrips` (`skipCapacityFilter`) para encomendas.

CREATE OR REPLACE FUNCTION public.shipment_begin_driver_offering(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.shipments%ROWTYPE;
  q uuid[] := '{}';
  q_ordered uuid[] := '{}';
  d uuid;
  pref uuid;
  r record;
  n int;
BEGIN
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  END IF;
  IF s.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF s.driver_id IS NOT NULL OR s.driver_offer_index >= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;
  IF s.client_preferred_driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_preferred_driver');
  END IF;

  IF lower(coalesce(s.payment_method, '')) IN ('credito', 'debito', 'pix')
     AND (s.stripe_payment_intent_id IS NULL OR btrim(s.stripe_payment_intent_id) = '')
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_required');
  END IF;

  pref := s.client_preferred_driver_id;

  FOR r IN
    SELECT st.driver_id, st.departure_at, coalesce(st.badge, '') AS badge
    FROM public.scheduled_trips st
    WHERE st.status = 'active'
      AND st.is_active IS TRUE
      AND st.driver_journey_started_at IS NULL
      AND st.departure_at > now()
      AND public.shipment_same_route_as_trip(
        s.origin_lat, s.origin_lng, s.destination_lat, s.destination_lng,
        st.origin_lat, st.origin_lng, st.destination_lat, st.destination_lng
      )
    ORDER BY st.departure_at ASC,
      CASE WHEN coalesce(st.badge, '') = 'Take Me' THEN 0 ELSE 1 END ASC
  LOOP
    IF NOT (r.driver_id = ANY (q)) THEN
      q := array_append(q, r.driver_id);
    END IF;
  END LOOP;

  n := coalesce(array_length(q, 1), 0);
  IF n = 0 THEN
    UPDATE public.shipments
    SET
      status = 'cancelled',
      cancellation_reason = 'no_driver_accepted',
      current_offer_driver_id = NULL,
      current_offer_expires_at = NULL,
      driver_offer_queue = '{}',
      driver_offer_index = -1
    WHERE id = p_shipment_id;
    RETURN jsonb_build_object('ok', true, 'cancelled', true, 'reason', 'no_matching_route');
  END IF;

  q_ordered := array_append(q_ordered, pref);
  FOREACH d IN ARRAY q LOOP
    IF d IS DISTINCT FROM pref THEN
      q_ordered := array_append(q_ordered, d);
    END IF;
  END LOOP;
  q := q_ordered;

  UPDATE public.shipments
  SET
    driver_offer_queue = q,
    driver_offer_index = 0,
    current_offer_driver_id = q[1],
    current_offer_expires_at = now() + interval '30 minutes'
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object('ok', true, 'queue_length', coalesce(array_length(q, 1), 0));
END;
$$;

COMMENT ON FUNCTION public.shipment_begin_driver_offering(uuid) IS
  'Abre a fila sequencial de motoristas para envio. Não filtra por assentos: encomenda não consome vaga de passageiro; capacidade de bagagem fica a critério do motorista no aceite.';

CREATE OR REPLACE FUNCTION public.shipment_open_driver_offer_queue_internal(
  p_shipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.shipments%ROWTYPE;
  q uuid[] := '{}';
  q_ordered uuid[] := '{}';
  d uuid;
  pref uuid;
  r record;
BEGIN
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF s.driver_id IS NOT NULL THEN RETURN; END IF;
  IF s.driver_offer_index IS NOT NULL AND s.driver_offer_index >= 0 THEN RETURN; END IF;
  IF s.client_preferred_driver_id IS NULL THEN RETURN; END IF;
  IF s.status IS NULL OR s.status NOT IN ('pending_review', 'confirmed') THEN RETURN; END IF;

  IF lower(coalesce(s.payment_method, '')) IN ('credito', 'debito', 'pix')
     AND (s.stripe_payment_intent_id IS NULL OR btrim(s.stripe_payment_intent_id) = '')
  THEN
    RETURN;
  END IF;

  pref := s.client_preferred_driver_id;

  FOR r IN
    SELECT st.driver_id, st.departure_at, coalesce(st.badge, '') AS badge
    FROM public.scheduled_trips st
    WHERE st.status = 'active'
      AND st.is_active IS TRUE
      AND st.driver_journey_started_at IS NULL
      AND st.departure_at > now()
      AND public.shipment_same_route_as_trip(
        s.origin_lat, s.origin_lng, s.destination_lat, s.destination_lng,
        st.origin_lat, st.origin_lng, st.destination_lat, st.destination_lng
      )
    ORDER BY st.departure_at ASC,
      CASE WHEN coalesce(st.badge, '') = 'Take Me' THEN 0 ELSE 1 END ASC
  LOOP
    IF NOT (r.driver_id = ANY (q)) THEN
      q := array_append(q, r.driver_id);
    END IF;
  END LOOP;

  IF coalesce(array_length(q, 1), 0) = 0 THEN
    UPDATE public.shipments
    SET
      status = 'cancelled',
      cancellation_reason = 'no_driver_accepted',
      current_offer_driver_id = NULL,
      current_offer_expires_at = NULL,
      driver_offer_queue = '{}',
      driver_offer_index = -1
    WHERE id = p_shipment_id;
    RETURN;
  END IF;

  q_ordered := array_append(q_ordered, pref);
  FOREACH d IN ARRAY q LOOP
    IF d IS DISTINCT FROM pref THEN
      q_ordered := array_append(q_ordered, d);
    END IF;
  END LOOP;
  q := q_ordered;

  UPDATE public.shipments
  SET
    driver_offer_queue = q,
    driver_offer_index = 0,
    current_offer_driver_id = q[1],
    current_offer_expires_at = now() + interval '30 minutes'
  WHERE id = p_shipment_id;
END;
$$;
