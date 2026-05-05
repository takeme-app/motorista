-- Encomenda sem base dentro da viagem ativa:
-- a coleta é validada pelo cliente em `complete_shipment_client_pickup`.
-- O motorista informa o PIN ao cliente e só conclui a parada depois que
-- `shipments.picked_up_at` já foi preenchido.

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

  -- ============================================================
  -- ENCOMENDA:
  --   * coleta sem base: cliente já deve ter validado o PIN.
  --   * coleta na base: motorista digita base_to_driver_code.
  --   * entrega: motorista digita delivery_code.
  -- ============================================================
  IF tnorm IN (
    'package_pickup',
    'shipment_pickup',
    'package_dropoff',
    'shipment_dropoff'
  ) THEN
    IF v_stop.entity_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    SELECT s.pickup_code, s.delivery_code, s.base_to_driver_code, s.base_id, s.picked_up_at
      INTO sh_pick, sh_del, sh_base_to_driver, sh_base_id, sh_picked_up_at
    FROM public.shipments s
    WHERE s.id = v_stop.entity_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
    END IF;

    IF tnorm IN ('package_pickup', 'shipment_pickup') AND sh_base_id IS NULL THEN
      IF sh_picked_up_at IS NULL THEN
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

  -- ============================================================
  -- PASSAGEIRO: PIN apenas no embarque. Desembarque sem PIN.
  -- ============================================================
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

  -- ============================================================
  -- DEPENDENTE: PIN obrigatório em embarque E desembarque.
  -- ============================================================
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
  'Conclui parada validando PIN conforme o tipo. Encomenda sem base: coleta precisa ter sido validada pelo cliente; entrega continua validada pelo motorista.';
