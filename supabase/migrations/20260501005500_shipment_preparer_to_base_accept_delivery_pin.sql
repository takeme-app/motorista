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
  v_preparer_to_base_code text;
  v_base_to_driver_code text;
  v_delivery_code text;
  v_already timestamptz;
  v_digits_in text;
  v_pin_b_digits text;
  v_pin_c_digits text;
  v_delivery_digits text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_shipment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_entity');
  END IF;

  SELECT s.preparer_id, s.base_id, s.picked_up_by_preparer_at,
         s.preparer_to_base_code, s.base_to_driver_code, s.delivery_code, s.delivered_to_base_at
    INTO v_preparer_id, v_base_id, v_picked_up_preparer,
         v_preparer_to_base_code, v_base_to_driver_code, v_delivery_code, v_already
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

  v_pin_b_digits := regexp_replace(coalesce(v_preparer_to_base_code, ''), '\D', '', 'g');
  v_pin_c_digits := regexp_replace(coalesce(v_base_to_driver_code, ''), '\D', '', 'g');
  v_delivery_digits := regexp_replace(coalesce(v_delivery_code, ''), '\D', '', 'g');

  IF length(v_pin_b_digits) <> 4
     AND length(v_pin_c_digits) <> 4
     AND length(v_delivery_digits) <> 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_code');
  END IF;

  IF v_digits_in IS DISTINCT FROM v_pin_b_digits
     AND v_digits_in IS DISTINCT FROM v_pin_c_digits
     AND v_digits_in IS DISTINCT FROM v_delivery_digits THEN
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
  'Confirma depósito na base: aceita PIN B, PIN C ou delivery_code quando a base/suporte fornecer esse código ao preparador atribuído.';
