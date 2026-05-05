-- Encomenda sem base: motorista informa o PIN de coleta, cliente valida no app.
-- A validação marca a encomenda como em andamento; o motorista apenas confere
-- que a confirmação já ocorreu antes de seguir para a entrega.

CREATE OR REPLACE FUNCTION public.complete_shipment_client_pickup (
  p_shipment_id uuid,
  p_confirmation_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_id uuid;
  v_base_id uuid;
  v_driver_id uuid;
  v_status text;
  v_expected text;
  v_picked_up_at timestamptz;
  v_digits_in text;
  v_exp_digits text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_shipment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  SELECT s.user_id, s.base_id, s.driver_id, s.status, s.pickup_code, s.picked_up_at
    INTO v_user_id, v_base_id, v_driver_id, v_status, v_expected, v_picked_up_at
  FROM public.shipments s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  IF v_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_base_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'has_base');
  END IF;

  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_assigned');
  END IF;

  IF v_status IN ('cancelled', 'delivered') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF v_picked_up_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true);
  END IF;

  v_digits_in := regexp_replace(coalesce(p_confirmation_code, ''), '\D', '', 'g');
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
    status = 'in_progress',
    picked_up_at = now(),
    updated_at = now()
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_shipment_client_pickup (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_shipment_client_pickup (uuid, text) TO authenticated;

COMMENT ON FUNCTION public.complete_shipment_client_pickup (uuid, text) IS
  'Encomenda sem base: cliente valida o PIN de coleta informado pelo motorista e marca picked_up_at/status in_progress.';
