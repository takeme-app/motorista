-- Encomenda GRANDE precisa de aprovação do admin antes de ser oferecida ao motorista.
-- Modelo: coluna shipments.admin_approved_at (NULL = aguardando aprovação). Só package_size='grande'.

-- 1) Coluna de aprovação.
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz;

COMMENT ON COLUMN public.shipments.admin_approved_at IS
  'Quando o admin aprovou a encomenda grande (libera oferta ao motorista). NULL = aguardando aprovação. Só relevante p/ package_size=grande.';

-- Backfill: grandes já em andamento não devem regredir (não há confirmed_at na tabela).
UPDATE public.shipments
   SET admin_approved_at = created_at
 WHERE package_size = 'grande'
   AND admin_approved_at IS NULL
   AND status IN ('confirmed', 'in_progress', 'delivered');

-- 2) Helper interno da fila: não abre para grande sem aprovação.
CREATE OR REPLACE FUNCTION public.shipment_open_driver_offer_queue_internal(p_shipment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Encomenda grande: só oferece ao motorista após aprovação do admin.
  IF s.package_size = 'grande' AND s.admin_approved_at IS NULL THEN RETURN; END IF;

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
$function$;

-- 3) Trigger: guard + reage também a admin_approved_at.
CREATE OR REPLACE FUNCTION public.trg_shipment_auto_open_driver_offer_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.client_preferred_driver_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.driver_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.driver_offer_index IS NOT NULL AND NEW.driver_offer_index >= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Encomenda grande não aprovada: não abre fila.
  IF NEW.package_size = 'grande' AND NEW.admin_approved_at IS NULL THEN RETURN NEW; END IF;

  IF lower(coalesce(NEW.payment_method, '')) IN ('credito', 'debito', 'pix')
     AND (NEW.stripe_payment_intent_id IS NULL OR btrim(NEW.stripe_payment_intent_id) = '')
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND (
          OLD.status IS DISTINCT FROM NEW.status
          OR OLD.stripe_payment_intent_id IS DISTINCT FROM NEW.stripe_payment_intent_id
          OR OLD.client_preferred_driver_id IS DISTINCT FROM NEW.client_preferred_driver_id
          OR OLD.base_id IS DISTINCT FROM NEW.base_id
          OR OLD.driver_offer_index IS DISTINCT FROM NEW.driver_offer_index
          OR OLD.admin_approved_at IS DISTINCT FROM NEW.admin_approved_at
     ))
  THEN
    BEGIN
      PERFORM public.shipment_open_driver_offer_queue_internal(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[trg_shipment_auto_open_driver_offer_queue] ignorado: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_shipment_auto_open_driver_offer_queue ON public.shipments;
CREATE TRIGGER on_shipment_auto_open_driver_offer_queue
  AFTER INSERT OR UPDATE OF
    status,
    stripe_payment_intent_id,
    client_preferred_driver_id,
    base_id,
    driver_offer_index,
    admin_approved_at
  ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_shipment_auto_open_driver_offer_queue();

-- 4) RPC pública de abertura de fila (chamada pelo motorista): mesmo guard.
CREATE OR REPLACE FUNCTION public.shipment_begin_driver_offering(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF s.package_size = 'grande' AND s.admin_approved_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_admin_approval');
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
$function$;

-- 5) Aceite do motorista: defesa — recusa enquanto grande não aprovada.
CREATE OR REPLACE FUNCTION public.shipment_driver_accept_offer(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF s.package_size = 'grande' AND s.admin_approved_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_admin_approval');
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
$function$;
