-- PIN C (cenário 3): a base confirma o código que o motorista mostra.
-- `complete_trip_stop` deixa de validar PIN na retirada com base; exige
-- `base_to_driver_confirmed_at`. `complete_shipment_base_to_driver_by_admin`
-- delega para a mesma lógica (só confirmação; o motorista conclui a parada).

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS base_to_driver_confirmed_at timestamptz NULL;

COMMENT ON COLUMN public.shipments.base_to_driver_confirmed_at IS
  'Timestamp em que a base validou o PIN C (base_to_driver_code) que o motorista mostrou, liberando a retirada da encomenda.';

-- Envios já retirados pelo motorista antes desta migration: evita bloquear `complete_trip_stop`.
UPDATE public.shipments s
SET base_to_driver_confirmed_at = s.picked_up_by_driver_from_base_at
WHERE s.base_to_driver_confirmed_at IS NULL
  AND s.picked_up_by_driver_from_base_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.base_confirm_driver_pickup (
  p_shipment_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_expected text;
  v_base_id uuid;
  v_confirmed_at timestamptz;
  v_delivered_base timestamptz;
  v_picked_driver timestamptz;
  v_digits_in text;
  v_exp_digits text;
  v_can boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_shipment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  END IF;

  SELECT
    s.base_to_driver_code,
    s.base_id,
    s.base_to_driver_confirmed_at,
    s.delivered_to_base_at,
    s.picked_up_by_driver_from_base_at
  INTO
    v_expected,
    v_base_id,
    v_confirmed_at,
    v_delivered_base,
    v_picked_driver
  FROM public.shipments s
  WHERE s.id = p_shipment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'shipment_not_found');
  END IF;

  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_base_handoff');
  END IF;

  v_can := public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.worker_profiles wp
      WHERE wp.id = v_uid
        AND wp.base_id IS NOT NULL
        AND wp.base_id = v_base_id
        AND wp.subtype = 'shipments'
        AND wp.status IN ('approved', 'pending')
    );

  IF NOT v_can THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_delivered_base IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_at_base');
  END IF;

  IF v_picked_driver IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true);
  END IF;

  IF v_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true);
  END IF;

  v_digits_in := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  IF length(v_digits_in) <> 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_length');
  END IF;

  v_exp_digits := regexp_replace(coalesce(v_expected, ''), '\D', '', 'g');
  IF length(v_exp_digits) <> 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_code');
  END IF;

  IF v_digits_in IS DISTINCT FROM v_exp_digits THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  UPDATE public.shipments
  SET
    base_to_driver_confirmed_at = now(),
    updated_at = now()
  WHERE id = p_shipment_id
    AND base_to_driver_confirmed_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.base_confirm_driver_pickup (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.base_confirm_driver_pickup (uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.base_confirm_driver_pickup (uuid, text) TO service_role;

COMMENT ON FUNCTION public.base_confirm_driver_pickup (uuid, text) IS
  'PIN C: atendente da base (ou admin) valida o código mostrado pelo motorista; preenche base_to_driver_confirmed_at.';

CREATE OR REPLACE FUNCTION public.complete_shipment_base_to_driver_by_admin (
  p_shipment_id uuid,
  p_confirmation_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  RETURN public.base_confirm_driver_pickup(p_shipment_id, p_confirmation_code);
END;
$$;

COMMENT ON FUNCTION public.complete_shipment_base_to_driver_by_admin (uuid, text) IS
  'PIN C (admin): delega para base_confirm_driver_pickup. O motorista conclui a parada com complete_trip_stop.';

CREATE OR REPLACE FUNCTION public.complete_trip_stop (
  p_trip_stop_id uuid,
  p_confirmation_code text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid ();
  v_stop public.trip_stops%ROWTYPE;
  v_trip_id uuid;
  tnorm text;
  digits_in text;
  exp_digits text;
  sh_pick text;
  sh_del text;
  sh_base_to_driver text;
  sh_base_id uuid;
  sh_picked_up_at timestamptz;
  sh_base_confirmed_at timestamptz;
  b_pick text;
  dep_pick text;
  dep_del text;
  dep_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_stop FROM public.trip_stops WHERE id = p_trip_stop_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stop_not_found');
  END IF;

  v_trip_id := v_stop.scheduled_trip_id;

  IF NOT public.auth_is_driver_of_scheduled_trip (v_trip_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF lower(trim(v_stop.status)) = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true);
  END IF;

  tnorm := lower(trim(v_stop.stop_type));

  IF tnorm IN (
    'package_pickup',
    'shipment_pickup',
    'package_dropoff',
    'shipment_dropoff'
  ) THEN
    IF v_stop.entity_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    SELECT
      s.pickup_code,
      s.delivery_code,
      s.base_to_driver_code,
      s.base_id,
      s.picked_up_at,
      s.base_to_driver_confirmed_at
    INTO
      sh_pick,
      sh_del,
      sh_base_to_driver,
      sh_base_id,
      sh_picked_up_at,
      sh_base_confirmed_at
    FROM public.shipments s
    WHERE s.id = v_stop.entity_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    IF tnorm IN ('package_pickup', 'shipment_pickup') AND sh_base_id IS NULL THEN
      IF sh_picked_up_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'pickup_not_confirmed');
      END IF;
    ELSIF tnorm IN ('package_pickup', 'shipment_pickup') AND sh_base_id IS NOT NULL THEN
      IF sh_base_confirmed_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'pickup_not_confirmed');
      END IF;
    ELSE
      digits_in := regexp_replace(coalesce(p_confirmation_code, ''), '\D', '', 'g');

      IF length(digits_in) <> 4 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'code_length');
      END IF;

      IF tnorm IN ('package_pickup', 'shipment_pickup') THEN
        exp_digits := regexp_replace(
          coalesce(
            nullif(trim(v_stop.code), ''),
            coalesce(sh_base_to_driver, sh_pick, '')
          ),
          '\D', '', 'g'
        );
      ELSE
        exp_digits := regexp_replace(
          coalesce(nullif(trim(v_stop.code), ''), coalesce(sh_del, '')),
          '\D', '', 'g'
        );
      END IF;

      IF length(exp_digits) <> 4 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'missing_code');
      END IF;

      IF digits_in IS DISTINCT FROM exp_digits THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
      END IF;
    END IF;

    IF tnorm IN ('package_pickup', 'shipment_pickup') THEN
      UPDATE public.shipments
      SET
        picked_up_at = coalesce(picked_up_at, now()),
        picked_up_by_driver_from_base_at = CASE
          WHEN base_id IS NOT NULL
            THEN coalesce(picked_up_by_driver_from_base_at, now())
          ELSE picked_up_by_driver_from_base_at
        END,
        status = CASE
          WHEN status = 'confirmed' THEN 'in_progress'::text
          ELSE status
        END
      WHERE id = v_stop.entity_id
        AND EXISTS (
          SELECT 1 FROM public.scheduled_trips st
          WHERE st.id = v_trip_id AND st.driver_id = v_uid
        );
    ELSE
      UPDATE public.shipments
      SET
        delivered_at = coalesce(delivered_at, now()),
        status = 'delivered'
      WHERE id = v_stop.entity_id
        AND EXISTS (
          SELECT 1 FROM public.scheduled_trips st
          WHERE st.id = v_trip_id AND st.driver_id = v_uid
        );
    END IF;

  ELSIF tnorm = 'passenger_pickup' THEN
    IF v_stop.entity_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    digits_in := regexp_replace(coalesce(p_confirmation_code, ''), '\D', '', 'g');

    IF length(digits_in) <> 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'code_length');
    END IF;

    SELECT b.pickup_code
      INTO b_pick
    FROM public.bookings b
    WHERE b.id = v_stop.entity_id
      AND b.scheduled_trip_id = v_trip_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    exp_digits := regexp_replace(
      coalesce(nullif(trim(v_stop.code), ''), coalesce(b_pick, '')),
      '\D', '', 'g'
    );

    IF length(exp_digits) <> 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_code');
    END IF;

    IF digits_in IS DISTINCT FROM exp_digits THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
    END IF;

  ELSIF tnorm IN ('dependent_pickup', 'dependent_dropoff') THEN
    IF v_stop.entity_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    digits_in := regexp_replace(coalesce(p_confirmation_code, ''), '\D', '', 'g');

    IF length(digits_in) <> 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'code_length');
    END IF;

    SELECT d.id, d.pickup_code, d.delivery_code
      INTO dep_id, dep_pick, dep_del
    FROM public.dependent_shipments d
    WHERE d.scheduled_trip_id = v_trip_id
      AND (
        d.id = v_stop.entity_id
        OR (d.dependent_id IS NOT NULL AND d.dependent_id = v_stop.entity_id)
      )
    ORDER BY CASE WHEN d.id = v_stop.entity_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    IF tnorm = 'dependent_pickup' THEN
      exp_digits := regexp_replace(
        coalesce(nullif(trim(v_stop.code), ''), coalesce(dep_pick, '')),
        '\D', '', 'g'
      );
    ELSE
      exp_digits := regexp_replace(
        coalesce(nullif(trim(v_stop.code), ''), coalesce(dep_del, '')),
        '\D', '', 'g'
      );
    END IF;

    IF length(exp_digits) <> 4 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_code');
    END IF;

    IF digits_in IS DISTINCT FROM exp_digits THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
    END IF;

    IF tnorm = 'dependent_pickup' THEN
      UPDATE public.dependent_shipments
      SET
        picked_up_at = coalesce(picked_up_at, now()),
        status = CASE
          WHEN status = 'confirmed' THEN 'in_progress'::text
          ELSE status
        END
      WHERE id = dep_id
        AND EXISTS (
          SELECT 1 FROM public.scheduled_trips st
          WHERE st.id = v_trip_id AND st.driver_id = v_uid
        );
    ELSE
      UPDATE public.dependent_shipments
      SET
        delivered_at = coalesce(delivered_at, now()),
        status = 'delivered'
      WHERE id = dep_id
        AND EXISTS (
          SELECT 1 FROM public.scheduled_trips st
          WHERE st.id = v_trip_id AND st.driver_id = v_uid
        );
    END IF;
  END IF;

  UPDATE public.trip_stops
  SET
    status = 'completed',
    updated_at = now()
  WHERE id = p_trip_stop_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

COMMENT ON FUNCTION public.complete_trip_stop (uuid, text) IS
  'Conclui parada validando PIN conforme o tipo. Encomenda sem base: coleta precisa picked_up_at (cliente). Com base: retirada na base exige base_to_driver_confirmed_at; entrega continua com PIN do motorista.';
