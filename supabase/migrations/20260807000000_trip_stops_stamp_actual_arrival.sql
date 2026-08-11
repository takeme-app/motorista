-- Horários REAIS da viagem (report: painel admin mostra só o planejado).
--
-- `trip_stops.actual_arrival_at` existe desde a criação da tabela, mas NUNCA foi
-- gravado: `complete_trip_stop` só faz `SET status='completed', updated_at=now()`.
-- Resultado: 112 paradas concluídas e ZERO com horário real — o painel não tinha
-- de onde tirar a chegada real e caía no horário planejado.
--
-- Correção por TRIGGER (em vez de reescrever a função de ~250 linhas, que tem toda
-- a validação de PIN): carimba na transição para 'completed', independente do
-- caminho que concluiu a parada (RPC, admin, correção manual).
--
-- Início real da viagem já existe em `scheduled_trips.driver_journey_started_at`.
-- Distância real continua NÃO disponível: `scheduled_trip_live_locations` guarda
-- apenas a última posição (1 linha por viagem), sem histórico de trajeto.

CREATE OR REPLACE FUNCTION public.trip_stops_stamp_actual_arrival()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(trim(NEW.status)) = 'completed'
     AND lower(trim(coalesce(OLD.status, ''))) IS DISTINCT FROM 'completed'
     AND NEW.actual_arrival_at IS NULL
  THEN
    NEW.actual_arrival_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trip_stops_stamp_actual_arrival() IS
  'Carimba trip_stops.actual_arrival_at quando a parada passa a completed (horário real de chegada).';

DROP TRIGGER IF EXISTS trg_trip_stops_stamp_actual_arrival ON public.trip_stops;
CREATE TRIGGER trg_trip_stops_stamp_actual_arrival
  BEFORE UPDATE OF status ON public.trip_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.trip_stops_stamp_actual_arrival();

-- Backfill conservador: paradas já concluídas usam `updated_at` como melhor
-- aproximação disponível do horário real (era quando o status virou 'completed').
UPDATE public.trip_stops
SET actual_arrival_at = updated_at
WHERE lower(trim(status)) = 'completed'
  AND actual_arrival_at IS NULL
  AND updated_at IS NOT NULL;
