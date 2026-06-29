-- ============================================================================
-- Função: resolve_trip_time_surcharge_pct
-- ============================================================================
-- Resolve o percentual de adicional por horário/dia aplicável a uma viagem
-- (scheduled_trip), a partir dos percentuais cadastrados na rota do motorista
-- (worker_routes.{nocturnal,weekend}_surcharge_pct) e do departure_at da viagem.
--
-- Regras (decisões de produto):
--   - Janela noturna: 18h00–04h59 (horário de Brasília / America/Sao_Paulo).
--   - Fim de semana: sábado ou domingo (horário de Brasília).
--   - Quando mais de uma regra se aplica (ex.: sábado à noite), usa-se APENAS o
--     MAIOR percentual (não acumula).
--   - Feriado: fora de escopo nesta etapa (não há calendário de feriados).
--
-- O percentual é aplicado sobre a BASE da viagem (aumenta o ganho do motorista),
-- portanto o consumidor faz: base_ajustada = round(base * (1 + pct/100)).
--
-- security definer: o app do cliente precisa ler worker_routes/scheduled_trips
-- sem expor as tabelas diretamente. Usada por cliente (preview) e edge
-- (charge-booking, cobrança autoritativa) para garantir paridade.
-- ============================================================================

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
  v_local      timestamp;
  v_dow        int;
  v_hour       int;
  v_is_weekend boolean;
  v_is_night   boolean;
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

  SELECT COALESCE(weekend_surcharge_pct, 0), COALESCE(nocturnal_surcharge_pct, 0)
    INTO v_weekend, v_night
  FROM public.worker_routes
  WHERE id = v_route;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Converte para o relógio local de Brasília antes de extrair dia/hora.
  v_local := v_departure AT TIME ZONE 'America/Sao_Paulo';
  v_dow   := EXTRACT(dow  FROM v_local)::int;  -- 0=domingo .. 6=sábado
  v_hour  := EXTRACT(hour FROM v_local)::int;

  v_is_weekend := (v_dow = 0 OR v_dow = 6);
  v_is_night   := (v_hour >= 18 OR v_hour < 5);

  RETURN GREATEST(
    CASE WHEN v_is_weekend THEN GREATEST(0, v_weekend) ELSE 0 END,
    CASE WHEN v_is_night   THEN GREATEST(0, v_night)   ELSE 0 END
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) IS
  'Percentual de adicional noturno/fim de semana aplicável à viagem (maior % entre as regras), a partir de worker_routes e do departure_at. Aumenta a base (ganho do motorista).';

REVOKE ALL ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_trip_time_surcharge_pct(uuid) TO service_role;
