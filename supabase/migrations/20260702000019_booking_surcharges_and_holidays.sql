-- Viagem (booking): preço do cliente passa a refletir TODOS os adicionais editáveis
-- pelo admin (vinculados ao trecho + automáticos do catálogo 'viagem') e o ajuste de
-- FERIADO (além de fim de semana/noturno já existentes), com paridade preview <-> cobrança.

-- 1) Calendário de feriados (editável pelo admin).
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS holidays_admin_all ON public.holidays;
CREATE POLICY holidays_admin_all ON public.holidays
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.holidays IS
  'Datas de feriado para aplicar worker_routes.holiday_surcharge_pct no cálculo de preço da viagem. Gerenciado pelo admin.';

-- 2) Adicionais da viagem = vinculados ao trecho (override) + automáticos do catálogo 'viagem'.
--    Fonte única usada por preview (cliente) e cobrança (charge-booking) para garantir paridade.
CREATE OR REPLACE FUNCTION public.resolve_booking_surcharges_cents(p_pricing_route_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- (a) adicionais vinculados ao trecho (override de value_cents quando houver)
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(prs.value_cents, sc.default_value_cents)))
      FROM public.pricing_route_surcharges prs
      JOIN public.surcharge_catalog sc ON sc.id = prs.surcharge_id
      WHERE prs.pricing_route_id = p_pricing_route_id
        AND sc.is_active = true
    ), 0)
    +
    -- (b) adicionais automáticos do catálogo 'viagem' (não duplica os já vinculados ao trecho)
    COALESCE((
      SELECT SUM(GREATEST(0, sc.default_value_cents))
      FROM public.surcharge_catalog sc
      WHERE sc.surcharge_type = 'viagem'
        AND sc.surcharge_mode = 'automatic'
        AND sc.is_active = true
        AND (
          p_pricing_route_id IS NULL
          OR sc.id NOT IN (
            SELECT prs.surcharge_id
            FROM public.pricing_route_surcharges prs
            WHERE prs.pricing_route_id = p_pricing_route_id
          )
        )
    ), 0)
  )::int;
$$;

COMMENT ON FUNCTION public.resolve_booking_surcharges_cents(uuid) IS
  'Soma (em centavos) dos adicionais da viagem: vinculados ao trecho + automáticos do catálogo (surcharge_type=viagem, mode=automatic). Aceita pricing_route_id NULL (só automáticos).';

REVOKE ALL ON FUNCTION public.resolve_booking_surcharges_cents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_booking_surcharges_cents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_booking_surcharges_cents(uuid) TO service_role;

-- 3) resolve_trip_time_surcharge_pct: passa a considerar FERIADO (holiday_surcharge_pct + tabela holidays),
--    mantendo a regra "maior % entre as regras aplicáveis (não acumula)".
CREATE OR REPLACE FUNCTION public.resolve_trip_time_surcharge_pct(p_scheduled_trip_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_departure  timestamptz;
  v_route      uuid;
  v_weekend    numeric := 0;
  v_night      numeric := 0;
  v_holiday    numeric := 0;
  v_local      timestamp;
  v_dow        int;
  v_hour       int;
  v_is_weekend boolean;
  v_is_night   boolean;
  v_is_holiday boolean;
BEGIN
  IF p_scheduled_trip_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT st.departure_at, st.route_id
    INTO v_departure, v_route
  FROM public.scheduled_trips st
  WHERE st.id = p_scheduled_trip_id;

  IF v_departure IS NULL OR v_route IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(weekend_surcharge_pct, 0),
         COALESCE(nocturnal_surcharge_pct, 0),
         COALESCE(holiday_surcharge_pct, 0)
    INTO v_weekend, v_night, v_holiday
  FROM public.worker_routes
  WHERE id = v_route;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Relógio local de Brasília antes de extrair dia/hora/data.
  v_local := v_departure AT TIME ZONE 'America/Sao_Paulo';
  v_dow   := EXTRACT(dow  FROM v_local)::int;  -- 0=domingo .. 6=sábado
  v_hour  := EXTRACT(hour FROM v_local)::int;

  v_is_weekend := (v_dow = 0 OR v_dow = 6);
  v_is_night   := (v_hour >= 18 OR v_hour < 5);
  v_is_holiday := EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.is_active = true
      AND h.holiday_date = v_local::date
  );

  RETURN GREATEST(
    CASE WHEN v_is_weekend THEN GREATEST(0, v_weekend) ELSE 0 END,
    CASE WHEN v_is_night   THEN GREATEST(0, v_night)   ELSE 0 END,
    CASE WHEN v_is_holiday THEN GREATEST(0, v_holiday) ELSE 0 END
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) IS
  'Percentual de adicional noturno/fim de semana/feriado aplicável à viagem (maior % entre as regras), a partir de worker_routes + tabela holidays e do departure_at. Aumenta a base (ganho do motorista).';

REVOKE ALL ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) TO service_role;
