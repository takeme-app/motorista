-- Motorista consulta apenas o próprio saldo de taxa da plataforma e últimas movimentações.
-- Mantém o ledger sem SELECT direto para não expor linhas de outros motoristas.

CREATE OR REPLACE FUNCTION public.driver_platform_fee_summary (
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 5), 0), 20);
  v_owed_cents integer := 0;
  v_entries jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT coalesce(wp.platform_fee_owed_cents, 0)
    INTO v_owed_cents
  FROM public.worker_profiles wp
  WHERE wp.id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_worker_profile');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'booking_id', l.booking_id,
        'kind', l.kind,
        'amount_cents', l.amount_cents,
        'note', l.note,
        'created_at', l.created_at
      )
      ORDER BY l.created_at DESC, l.id DESC
    ),
    '[]'::jsonb
  )
    INTO v_entries
  FROM (
    SELECT id, booking_id, kind, amount_cents, note, created_at
    FROM public.driver_platform_fee_ledger
    WHERE worker_id = v_uid
    ORDER BY created_at DESC, id DESC
    LIMIT v_limit
  ) l;

  RETURN jsonb_build_object(
    'ok', true,
    'platform_fee_owed_cents', greatest(v_owed_cents, 0),
    'entries', v_entries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_platform_fee_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_platform_fee_summary(integer) TO authenticated;
