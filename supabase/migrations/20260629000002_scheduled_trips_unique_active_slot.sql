-- Impede que um motorista crie múltiplas trips ativas idênticas no mesmo slot
-- (rota + dia da semana + horário de partida). Trips canceladas/completed ficam
-- de fora do índice — assim a próxima ocorrência semanal pode ser criada
-- normalmente depois de uma viagem concluir.
--
-- Bug A do report do usuário (2026-05-28): o front mostrava "Quarta-feira, 4
-- viagens" com 3 cards idênticos 17:00→20:00 porque o INSERT em
-- RouteScheduleScreen.handleAddTrip não validava duplicação. O front já recebeu
-- proteção (checa existência antes do INSERT) e dedup visual, mas a regra
-- precisa também viver no banco como invariante.

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_trips_unique_active_slot
  ON public.scheduled_trips (driver_id, route_id, day_of_week, departure_time)
  WHERE status IN ('active', 'scheduled');
