-- Pix paliativo (sem Stripe): encomenda paga com Pix NUNCA terá stripe_payment_intent_id.
-- Antes, a fila de motoristas só abria para 'credito'/'debito'/'pix' quando havia PaymentIntent
-- (confirmação do webhook). Como o Pix agora é paliativo, removemos 'pix' desse gate — passa a
-- abrir como dinheiro (na efetivação/insert). Mantém o guard de encomenda grande (admin_approved_at).
-- Recria helper, trigger e RPC pública mantendo o resto idêntico à migration 20260702000021.

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

  IF s.package_size = 'grande' AND s.admin_approved_at IS NULL THEN RETURN; END IF;

  IF lower(coalesce(s.payment_method, '')) IN ('credito', 'debito')
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

  IF NEW.package_size = 'grande' AND NEW.admin_approved_at IS NULL THEN RETURN NEW; END IF;

  IF lower(coalesce(NEW.payment_method, '')) IN ('credito', 'debito')
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

  IF lower(coalesce(s.payment_method, '')) IN ('credito', 'debito')
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
