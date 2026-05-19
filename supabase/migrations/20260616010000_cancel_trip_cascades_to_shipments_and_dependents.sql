-- Ao cancelar uma scheduled_trip, hoje só bookings são propagadas
-- (via sync_bookings_when_scheduled_trip_cancelled). Shipments e
-- dependent_shipments ficavam "presos" com status confirmed/in_progress.
-- Este trigger fecha o gap, espelhando o mesmo padrão de auditoria
-- (cancelled_at, cancellation_reason).
CREATE OR REPLACE FUNCTION public.sync_shipments_and_dependents_when_trip_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Encomendas (shipments): só os que estão vinculados a esta viagem e ainda
  -- não foram entregues/cancelados.
  UPDATE public.shipments
  SET
    status = 'cancelled',
    cancellation_reason = COALESCE(cancellation_reason, 'driver_cancelled_scheduled_trip'),
    updated_at = now()
  WHERE scheduled_trip_id = NEW.id
    AND status = ANY (ARRAY['pending_review'::text, 'confirmed'::text, 'in_progress'::text]);

  -- Envios de dependente.
  UPDATE public.dependent_shipments
  SET
    status = 'cancelled',
    cancellation_reason = COALESCE(cancellation_reason, 'driver_cancelled_scheduled_trip'),
    updated_at = now()
  WHERE scheduled_trip_id = NEW.id
    AND status = ANY (ARRAY['pending_review'::text, 'confirmed'::text, 'in_progress'::text]);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_shipments_and_dependents_when_trip_cancelled() IS
  'Ao cancelar scheduled_trips, cancela em cascata shipments e dependent_shipments vinculados que ainda estavam ativos.';

DROP TRIGGER IF EXISTS trg_sync_shipments_deps_when_trip_cancelled ON public.scheduled_trips;
CREATE TRIGGER trg_sync_shipments_deps_when_trip_cancelled
  AFTER UPDATE OF status ON public.scheduled_trips
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_shipments_and_dependents_when_trip_cancelled();
