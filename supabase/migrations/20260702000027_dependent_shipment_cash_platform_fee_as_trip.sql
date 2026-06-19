-- Envio de DEPENDENTE em dinheiro conta como CORRIDA para a taxa devida à plataforma.
-- Credita o ledger com note='cash_trip_completed' (mesmo rótulo "Taxa de corrida em dinheiro").
-- O motorista vem de scheduled_trips.driver_id (dependent_shipments não tem driver_id direto).
-- SEM backfill (mesma decisão das encomendas: vale só daqui pra frente).
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

ALTER TABLE public.driver_platform_fee_ledger
  ADD COLUMN IF NOT EXISTS dependent_shipment_id uuid REFERENCES public.dependent_shipments(id) ON DELETE SET NULL;

-- Idempotência: no máximo 1 crédito por envio de dependente.
CREATE UNIQUE INDEX IF NOT EXISTS driver_platform_fee_ledger_cash_dep_shipment_uidx
  ON public.driver_platform_fee_ledger (dependent_shipment_id)
  WHERE note = 'cash_trip_completed';

CREATE OR REPLACE FUNCTION public.trg_dependent_shipments_credit_cash_on_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver uuid;
BEGIN
  IF tg_op <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'delivered' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF lower(coalesce(NEW.payment_method, '')) <> 'dinheiro' THEN RETURN NEW; END IF;
  IF coalesce(NEW.admin_earning_cents, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT st.driver_id INTO v_driver
  FROM public.scheduled_trips st
  WHERE st.id = NEW.scheduled_trip_id;

  IF v_driver IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.driver_platform_fee_ledger
    (worker_id, dependent_shipment_id, kind, amount_cents, note)
  VALUES
    (v_driver, NEW.id, 'credit', NEW.admin_earning_cents, 'cash_trip_completed')
  ON CONFLICT (dependent_shipment_id) WHERE note = 'cash_trip_completed' DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dependent_shipments_cash_credit ON public.dependent_shipments;
CREATE TRIGGER trg_dependent_shipments_cash_credit
  AFTER UPDATE ON public.dependent_shipments
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_dependent_shipments_credit_cash_on_delivered();

COMMENT ON FUNCTION public.trg_dependent_shipments_credit_cash_on_delivered() IS
  'Ao concluir (status=delivered) um envio de dependente em dinheiro com admin_earning_cents>0, credita a taxa no driver_platform_fee_ledger como CORRIDA (note=cash_trip_completed; motorista via scheduled_trips.driver_id; idempotente por dependent_shipment_id). Sem backfill.';
