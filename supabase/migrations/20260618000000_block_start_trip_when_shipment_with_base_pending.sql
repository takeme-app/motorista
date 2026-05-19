-- Regra de negócio: o motorista não pode iniciar uma viagem enquanto houver
-- encomenda com base que ainda não foi entregue à base E o handoff do
-- preparador não expirou (faltam >1h para a partida — base ainda pode receber).
-- Após 1h sem entrega à base, o cron marca preparer_handoff_expired_at
-- e a rota é redirecionada para a casa do cliente — aí o motorista pode iniciar.
--
-- Trigger BEFORE UPDATE para defesa em profundidade (o front já valida em
-- TripDetailScreen, mas qualquer caller direto via UPDATE / RPC também é
-- bloqueado aqui).
CREATE OR REPLACE FUNCTION public.block_start_trip_when_shipment_with_base_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_count integer;
BEGIN
  -- Só valida na transição de "não iniciada" -> "iniciada".
  IF NEW.driver_journey_started_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.driver_journey_started_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.shipments s
  WHERE s.scheduled_trip_id = NEW.id
    AND s.base_id IS NOT NULL
    AND s.preparer_handoff_expired_at IS NULL
    AND s.delivered_to_base_at IS NULL
    AND s.status IN ('confirmed', 'in_progress');

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'shipment_with_base_not_delivered_yet'
      USING ERRCODE = 'P0001',
            HINT = 'Aguarde o preparador entregar na base ou a janela de 1h expirar antes de iniciar a viagem.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.block_start_trip_when_shipment_with_base_pending() IS
  'Impede iniciar viagem (driver_journey_started_at NULL -> NOT NULL) quando há encomenda com base ainda não entregue à base e dentro da janela de 1h do handoff do preparador.';

DROP TRIGGER IF EXISTS trg_block_start_trip_when_shipment_with_base_pending ON public.scheduled_trips;
CREATE TRIGGER trg_block_start_trip_when_shipment_with_base_pending
  BEFORE UPDATE OF driver_journey_started_at ON public.scheduled_trips
  FOR EACH ROW
  EXECUTE FUNCTION public.block_start_trip_when_shipment_with_base_pending();
