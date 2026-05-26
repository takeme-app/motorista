-- Bug: ledger de taxa em corridas em dinheiro nunca é populado.
--
-- O trigger original (20260430140000_driver_platform_fee_ledger.sql) exigia
-- bookings.status = 'completed', mas a CHECK constraint de bookings só aceita
-- ('pending','confirmed','paid','cancelled') e nenhuma RPC promove o booking
-- para 'completed'. A conclusão real fica em scheduled_trips.status='completed'
-- (RPC public.motorista_complete_scheduled_trip).
--
-- Esta migration:
--   1) Remove o trigger antigo em bookings (função permanece como histórico).
--   2) Cria novo trigger em scheduled_trips: ao virar 'completed', insere
--      crédito no ledger para cada booking 'cash' associado com taxa > 0.
--   3) Faz backfill idempotente das viagens cash já concluídas que ficaram
--      sem o lançamento.
--
-- A idempotência aproveita o UNIQUE parcial existente em
-- driver_platform_fee_ledger (booking_id) WHERE note = 'cash_trip_completed'.

-- 1) Remover trigger antigo (função preservada para histórico/debug)
DROP TRIGGER IF EXISTS trg_bookings_platform_fee_credit_cash ON public.bookings;

-- 2) Trigger em scheduled_trips: ao concluir, credita ledger para cada
--    booking cash da viagem.
CREATE OR REPLACE FUNCTION public.trg_scheduled_trips_credit_cash_on_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF tg_op <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.driver_platform_fee_ledger
    (worker_id, booking_id, kind, amount_cents, note)
  SELECT
    NEW.driver_id,
    b.id,
    'credit',
    b.admin_earning_cents,
    'cash_trip_completed'
  FROM public.bookings b
  WHERE b.scheduled_trip_id = NEW.id
    AND b.payment_method = 'cash'
    AND b.status <> 'cancelled'
    AND coalesce(b.admin_earning_cents, 0) > 0
  ON CONFLICT (booking_id) WHERE note = 'cash_trip_completed' DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_trips_cash_credit ON public.scheduled_trips;
CREATE TRIGGER trg_scheduled_trips_cash_credit
  AFTER UPDATE ON public.scheduled_trips
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_scheduled_trips_credit_cash_on_completed();

-- 3) Backfill: lançar crédito para corridas cash já concluídas que ficaram
--    sem entrada no ledger. O trigger
--    trg_driver_platform_fee_ledger_refresh_owed recalcula
--    worker_profiles.platform_fee_owed_cents linha a linha.
INSERT INTO public.driver_platform_fee_ledger
  (worker_id, booking_id, kind, amount_cents, note)
SELECT
  st.driver_id,
  b.id,
  'credit',
  b.admin_earning_cents,
  'cash_trip_completed'
FROM public.bookings b
JOIN public.scheduled_trips st ON st.id = b.scheduled_trip_id
WHERE st.status = 'completed'
  AND st.driver_id IS NOT NULL
  AND b.payment_method = 'cash'
  AND b.status <> 'cancelled'
  AND coalesce(b.admin_earning_cents, 0) > 0
ON CONFLICT (booking_id) WHERE note = 'cash_trip_completed' DO NOTHING;

COMMENT ON FUNCTION public.trg_scheduled_trips_credit_cash_on_completed() IS
  'Quando scheduled_trips.status passa para completed, gera credit no driver_platform_fee_ledger para cada booking cash da viagem (idempotente via UNIQUE parcial em booking_id WHERE note=cash_trip_completed).';
