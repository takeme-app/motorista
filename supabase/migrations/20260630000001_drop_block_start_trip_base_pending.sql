-- Regra de produto mudou (2026-05-28): o motorista pode iniciar a viagem
-- mesmo quando há encomendas com base ainda não entregues. O motorista é
-- informado por item no modal de coleta na base e decide se ainda passa
-- pela base ou segue direto pelo handoff expirado.
--
-- Remove o trigger e a função que impediam o UPDATE de
-- `scheduled_trips.driver_journey_started_at` quando havia encomenda com
-- base pendente. O front também foi limpo dos checks equivalentes.

DROP TRIGGER IF EXISTS trg_block_start_trip_when_shipment_with_base_pending
  ON public.scheduled_trips;

DROP FUNCTION IF EXISTS public.block_start_trip_when_shipment_with_base_pending();
