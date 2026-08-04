-- Bug crítico (report 2026-07-24): as viagens semanais do motorista somem depois
-- de uma semana. O calendário do motorista é materializado como UMA linha concreta
-- em scheduled_trips por slot; a próxima ocorrência só era criada quando a viagem
-- era CONCLUÍDA (insertPlannedRouteSlotAfterComplete, chamada no ActiveTripScreen).
-- Logo, slots sem reserva/não concluídos nunca avançavam de semana: quando o
-- departure_at passava, o cliente (departure_at > now) não achava mais nada.
--
-- Correção: um job periódico (pg_cron) que "rola" cada slot de rota ativo para a
-- próxima semana assim que sua ocorrência passa, independente de conclusão. Mantém
-- o modelo de UMA ocorrência ativa por slot: aposenta a vencida (status 'expired')
-- e cria a próxima. Idempotente e seguro em relação aos triggers existentes
-- (o de passageiros retorna cedo com driver_journey_started_at NULL; o de ciclo de
-- vida do motorista só dispara em 'completed'/lotação).

-- 1) Novo status 'expired' (ocorrência vencida sem realização). Sai do índice
--    único de slot ativo e da listagem do cliente (que exige status='active').
ALTER TABLE public.scheduled_trips DROP CONSTRAINT IF EXISTS scheduled_trips_status_check;
ALTER TABLE public.scheduled_trips
  ADD CONSTRAINT scheduled_trips_status_check
  CHECK (status IN ('active', 'cancelled', 'completed', 'expired'));

-- 2) Função de regeneração semanal.
CREATE OR REPLACE FUNCTION public.roll_forward_weekly_scheduled_trips()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r public.scheduled_trips%ROWTYPE;
  v_weeks int;
  v_next_dep timestamptz;
  v_next_arr timestamptz;
  v_seats smallint;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT *
    FROM public.scheduled_trips
    WHERE route_id IS NOT NULL           -- só slots recorrentes de rota
      AND is_active = true               -- respeita o switch do motorista
      AND status = 'active'
      AND driver_journey_started_at IS NULL  -- viagens iniciadas ficam com a conclusão
      AND departure_at <= now()          -- ocorrência já passou
  LOOP
    -- Semanas inteiras a somar para cair estritamente no futuro (Brasil sem DST,
    -- então +7 dias preserva o horário local e o dia da semana).
    v_weeks := floor(EXTRACT(EPOCH FROM (now() - r.departure_at)) / 604800)::int + 1;
    v_next_dep := r.departure_at + (v_weeks * INTERVAL '7 days');
    v_next_arr := r.arrival_at   + (v_weeks * INTERVAL '7 days');
    v_seats := GREATEST(1, COALESCE(NULLIF(r.capacity, 0), r.seats_available, 1))::smallint;

    -- Aposenta a ocorrência vencida ANTES de inserir (libera o índice único de slot).
    UPDATE public.scheduled_trips
    SET status = 'expired', updated_at = now()
    WHERE id = r.id;

    -- Cria a próxima ocorrência só se ainda não existir uma ativa para o slot
    -- (evita duplicar quando a conclusão já gerou a próxima).
    IF NOT EXISTS (
      SELECT 1 FROM public.scheduled_trips s
      WHERE s.driver_id = r.driver_id
        AND s.route_id = r.route_id
        AND s.day_of_week IS NOT DISTINCT FROM r.day_of_week
        AND s.departure_time IS NOT DISTINCT FROM r.departure_time
        AND s.status IN ('active', 'scheduled')
    ) THEN
      INSERT INTO public.scheduled_trips (
        driver_id, route_id, day_of_week, departure_time, arrival_time,
        departure_at, arrival_at, title, badge,
        origin_address, origin_lat, origin_lng,
        destination_address, destination_lat, destination_lng,
        capacity, seats_available, bags_available, confirmed_count,
        price_per_person_cents, amount_cents, is_active, status
      ) VALUES (
        r.driver_id, r.route_id, r.day_of_week, r.departure_time, r.arrival_time,
        v_next_dep, v_next_arr, r.title, COALESCE(r.badge, 'Take Me'),
        r.origin_address, r.origin_lat, r.origin_lng,
        r.destination_address, r.destination_lat, r.destination_lng,
        r.capacity, v_seats, r.bags_available, 0,
        r.price_per_person_cents, r.amount_cents, true, 'active'
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.roll_forward_weekly_scheduled_trips() IS
  'Rola slots semanais de rota (scheduled_trips com route_id) para a próxima semana quando a ocorrência passa, independente de conclusão. Aposenta a vencida (status=expired) e cria a próxima. Idempotente. Agendar via pg_cron.';
