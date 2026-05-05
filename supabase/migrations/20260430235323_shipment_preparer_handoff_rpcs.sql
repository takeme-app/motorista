CREATE OR REPLACE FUNCTION public.complete_shipment_passenger_to_preparer (
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
  v_expected text;
  v_already timestamptz;
  v_digits_in text;
  v_exp_digits text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_shipment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  SELECT s.user_id, s.passenger_to_preparer_code, s.picked_up_by_preparer_at
    INTO v_user_id, v_expected, v_already
  FROM public.shipments s
  WHERE s.id = p_shipment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  IF v_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_already IS NOT NULL THEN
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
    picked_up_by_preparer_at = now(),
    updated_at = now()
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_shipment_passenger_to_preparer (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_shipment_passenger_to_preparer (uuid, text) TO authenticated;

COMMENT ON FUNCTION public.complete_shipment_passenger_to_preparer (uuid, text) IS
  'PIN A do PDF cenário 3: passageiro digita o código informado pelo preparador na coleta. Atualiza picked_up_by_preparer_at.';

CREATE OR REPLACE FUNCTION public.complete_shipment_preparer_to_base (
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
  v_preparer_id uuid;
  v_base_id uuid;
  v_picked_up_preparer timestamptz;
  v_expected text;
  v_already timestamptz;
  v_digits_in text;
  v_exp_digits text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_shipment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  SELECT s.preparer_id, s.base_id, s.picked_up_by_preparer_at,
         s.preparer_to_base_code, s.delivered_to_base_at
    INTO v_preparer_id, v_base_id, v_picked_up_preparer, v_expected, v_already
  FROM public.shipments s
  WHERE s.id = p_shipment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  IF v_preparer_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_base');
  END IF;

  IF v_picked_up_preparer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pickup_not_completed');
  END IF;

  IF v_already IS NOT NULL THEN
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
    delivered_to_base_at = now(),
    updated_at = now()
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_shipment_preparer_to_base (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_shipment_preparer_to_base (uuid, text) TO authenticated;

COMMENT ON FUNCTION public.complete_shipment_preparer_to_base (uuid, text) IS
  'PIN B do PDF cenário 3: preparador digita o código informado pela base na entrega. Atualiza delivered_to_base_at.';
