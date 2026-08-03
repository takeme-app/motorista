-- Bug crítico (calendário de viagens do motorista): as viagens recorrentes só
-- ficavam disponíveis ~1 semana à frente e slots podiam "morrer" de vez.
--
-- Causa raiz:
--   1) O calendário é materializado como UMA linha por slot em scheduled_trips, e o
--      índice único (driver_id, route_id, day_of_week, departure_time) WHERE status
--      IN ('active','scheduled') permitia SÓ 1 ocorrência ativa por slot — impossível
--      mostrar várias semanas.
--   2) A regeneração (roll_forward_weekly_scheduled_trips) era BASEADA EM OCORRÊNCIA:
--      só rolava slots cuja última ocorrência estava 'active' e não iniciada. Slots que
--      terminavam 'completed'/'cancelled', ou 'iniciada' e nunca concluída, ficavam sem
--      sucessor (quando os caminhos de criar-a-próxima ao concluir/cancelar falhavam) e
--      a função nunca os recuperava.
--
-- Correção (decisão do produto):
--   A) Mostrar VÁRIAS semanas à frente (padrão 4) — troca o índice único de "1 ativa por
--      slot" para "1 ativa por ocorrência (data/hora)", permitindo várias semanas ativas.
--   B) Gerador AUTO-CURÁVEL (slot-based): para cada slot LIGADO (última ocorrência
--      is_active=true) com ROTA ativa (worker_routes.is_active=true), garante ocorrências
--      ativas cobrindo as próximas N semanas — independente do status da última ocorrência.
--      Respeita cancelamentos: não recria uma data que já tem linha (cancelada/concluída).
--
-- O app do cliente NÃO precisa mudar: ele já lista todas as scheduled_trips ativas futuras
-- (status='active', is_active, driver_journey_started_at IS NULL, departure_at>now,
-- seats_available>0), sem teto de data — as novas semanas aparecem automaticamente.

-- ── 1) Índice único: de "1 ativa por slot" para "1 ativa por ocorrência" ────────────
-- (Confirmado sem duplicatas de (driver_id, route_id, departure_at) com status='active'.)
DROP INDEX IF EXISTS public.scheduled_trips_unique_active_slot;
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_trips_unique_active_occurrence
  ON public.scheduled_trips (driver_id, route_id, departure_at)
  WHERE status = 'active';

-- ── 2) Gerador slot-based, multi-semana, auto-curável ──────────────────────────────
-- Remove a versão antiga sem argumento (evita overload duplicado ao adicionar o param).
DROP FUNCTION IF EXISTS public.roll_forward_weekly_scheduled_trips();

CREATE OR REPLACE FUNCTION public.roll_forward_weekly_scheduled_trips(p_weeks_ahead int DEFAULT 4)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  slot RECORD;
  tmpl public.scheduled_trips%ROWTYPE;
  v_weeks_ahead int := GREATEST(1, COALESCE(p_weeks_ahead, 4));
  v_horizon timestamptz := now() + (v_weeks_ahead * INTERVAL '7 days');
  v_base_weeks int;
  v_base_dep timestamptz;
  v_base_arr timestamptz;
  v_target_dep timestamptz;
  v_target_arr timestamptz;
  v_seats smallint;
  v_created int := 0;
  k int;
BEGIN
  -- (a) Aposenta ocorrências vencidas ainda ativas e não iniciadas (libera índice/listagem).
  UPDATE public.scheduled_trips
  SET status = 'expired', updated_at = now()
  WHERE route_id IS NOT NULL
    AND is_active = true
    AND status = 'active'
    AND driver_journey_started_at IS NULL
    AND departure_at <= now();

  -- (b) Para cada SLOT recorrente, garante ocorrências ativas nas próximas N semanas.
  FOR slot IN
    SELECT DISTINCT driver_id, route_id, day_of_week, departure_time
    FROM public.scheduled_trips
    WHERE route_id IS NOT NULL
      AND day_of_week IS NOT NULL
      AND departure_time IS NOT NULL
  LOOP
    -- Template = ocorrência mais recente do slot (fonte de endereços/preço/horário e do
    -- sinal de ligado/desligado do motorista via is_active da última linha).
    SELECT * INTO tmpl
    FROM public.scheduled_trips st
    WHERE st.driver_id = slot.driver_id
      AND st.route_id = slot.route_id
      AND st.day_of_week IS NOT DISTINCT FROM slot.day_of_week
      AND st.departure_time IS NOT DISTINCT FROM slot.departure_time
    ORDER BY st.departure_at DESC
    LIMIT 1;

    CONTINUE WHEN tmpl.id IS NULL;
    -- Slot desligado pelo motorista (switch): não gerar.
    CONTINUE WHEN tmpl.is_active IS DISTINCT FROM true;
    -- Rota desativada: não gerar.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.worker_routes wr WHERE wr.id = slot.route_id AND wr.is_active = true
    );
    -- Sem janela de horário definida: não dá para projetar.
    CONTINUE WHEN tmpl.departure_at IS NULL OR tmpl.arrival_at IS NULL;

    -- Base = 1ª ocorrência estritamente futura, preservando horário local
    -- (Brasil sem horário de verão: +7 dias mantém dia da semana e hora).
    v_base_weeks := CASE
      WHEN tmpl.departure_at > now() THEN 0
      ELSE floor(EXTRACT(EPOCH FROM (now() - tmpl.departure_at)) / 604800)::int + 1
    END;
    v_base_dep := tmpl.departure_at + (v_base_weeks * INTERVAL '7 days');
    v_base_arr := tmpl.arrival_at   + (v_base_weeks * INTERVAL '7 days');
    v_seats := GREATEST(1, COALESCE(NULLIF(tmpl.capacity, 0), tmpl.seats_available, 1))::smallint;

    FOR k IN 0 .. (v_weeks_ahead - 1) LOOP
      v_target_dep := v_base_dep + (k * INTERVAL '7 days');
      v_target_arr := v_base_arr + (k * INTERVAL '7 days');
      EXIT WHEN v_target_dep > v_horizon;      -- não passa do horizonte
      CONTINUE WHEN v_target_dep <= now();     -- só futuro

      -- Idempotente e respeita cancelamentos: só cria se AQUELE dia do slot ainda não
      -- tem NENHUMA linha (ativa, cancelada, concluída ou expirada). Assim não duplica
      -- e não recria uma ocorrência que o motorista cancelou.
      IF NOT EXISTS (
        SELECT 1 FROM public.scheduled_trips s
        WHERE s.driver_id = tmpl.driver_id
          AND s.route_id = tmpl.route_id
          AND s.day_of_week IS NOT DISTINCT FROM tmpl.day_of_week
          AND s.departure_time IS NOT DISTINCT FROM tmpl.departure_time
          AND (s.departure_at AT TIME ZONE 'America/Sao_Paulo')::date
              = (v_target_dep AT TIME ZONE 'America/Sao_Paulo')::date
      ) THEN
        INSERT INTO public.scheduled_trips (
          driver_id, route_id, day_of_week, departure_time, arrival_time,
          departure_at, arrival_at, title, badge,
          origin_address, origin_lat, origin_lng,
          destination_address, destination_lat, destination_lng,
          capacity, seats_available, bags_available, confirmed_count,
          price_per_person_cents, amount_cents, is_active, status
        ) VALUES (
          tmpl.driver_id, tmpl.route_id, tmpl.day_of_week, tmpl.departure_time, tmpl.arrival_time,
          v_target_dep, v_target_arr, tmpl.title, COALESCE(tmpl.badge, 'Take Me'),
          tmpl.origin_address, tmpl.origin_lat, tmpl.origin_lng,
          tmpl.destination_address, tmpl.destination_lat, tmpl.destination_lng,
          tmpl.capacity, v_seats, tmpl.bags_available, 0,
          tmpl.price_per_person_cents, tmpl.amount_cents, true, 'active'
        )
        ON CONFLICT (driver_id, route_id, departure_at) WHERE status = 'active' DO NOTHING;

        IF FOUND THEN
          v_created := v_created + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_created;
END;
$$;

COMMENT ON FUNCTION public.roll_forward_weekly_scheduled_trips(int) IS
  'Regeneração semanal AUTO-CURÁVEL (slot-based) de scheduled_trips recorrentes. Aposenta ocorrências vencidas (status=expired) e garante ocorrências ativas nas próximas p_weeks_ahead semanas (padrão 4) para cada slot ligado (última ocorrência is_active=true) com rota ativa — independente do status da última ocorrência. Idempotente (não duplica dia do slot) e respeita cancelamentos (não recria data já com linha). Agendar via pg_cron.';

-- ── 3) (Re)agenda o pg_cron a cada 15 min (limita o vão após a data passar). ────────
DO $cron$
DECLARE jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'roll-forward-weekly-scheduled-trips'
    LOOP PERFORM cron.unschedule(jid); END LOOP;
    PERFORM cron.schedule(
      'roll-forward-weekly-scheduled-trips',
      '*/15 * * * *',
      $$SELECT public.roll_forward_weekly_scheduled_trips();$$
    );
  END IF;
END;
$cron$;

-- ── 4) Backfill imediato (materializa 4 semanas para todos os slots ligados). ───────
SELECT public.roll_forward_weekly_scheduled_trips(4);
