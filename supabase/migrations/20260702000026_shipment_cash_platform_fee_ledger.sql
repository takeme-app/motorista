-- Taxa de ENTREGA DE ENCOMENDA em dinheiro: registrar no ledger de taxa devida à plataforma.
-- Espelha o fluxo de corridas em dinheiro (note='cash_trip_completed'), mas para shipments,
-- com note='cash_shipment_completed'. SEM backfill (decisão do produto: vale só daqui pra frente).
-- O saldo (worker_profiles.platform_fee_owed_cents) é recalculado por
-- refresh_driver_platform_fee_owed_from_ledger(), que soma TODAS as linhas do worker.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

ALTER TABLE public.driver_platform_fee_ledger
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL;

-- Idempotência: no máximo 1 crédito de taxa por encomenda.
CREATE UNIQUE INDEX IF NOT EXISTS driver_platform_fee_ledger_cash_shipment_uidx
  ON public.driver_platform_fee_ledger (shipment_id)
  WHERE note = 'cash_shipment_completed';

CREATE OR REPLACE FUNCTION public.trg_shipments_credit_cash_on_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF tg_op <> 'UPDATE' THEN RETURN NEW; END IF;
  -- só ao virar 'delivered'
  IF NEW.status IS DISTINCT FROM 'delivered' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  -- só pagamento em dinheiro com taxa de plataforma > 0
  IF lower(coalesce(NEW.payment_method, '')) <> 'dinheiro' THEN RETURN NEW; END IF;
  IF coalesce(NEW.admin_earning_cents, 0) <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.driver_platform_fee_ledger
    (worker_id, shipment_id, kind, amount_cents, note)
  VALUES
    (NEW.driver_id, NEW.id, 'credit', NEW.admin_earning_cents, 'cash_shipment_completed')
  ON CONFLICT (shipment_id) WHERE note = 'cash_shipment_completed' DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_cash_credit ON public.shipments;
CREATE TRIGGER trg_shipments_cash_credit
  AFTER UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_shipments_credit_cash_on_delivered();

COMMENT ON FUNCTION public.trg_shipments_credit_cash_on_delivered() IS
  'Ao concluir (status=delivered) uma encomenda em dinheiro com admin_earning_cents>0, credita a taxa devida no driver_platform_fee_ledger (note=cash_shipment_completed; idempotente por shipment_id). Sem backfill.';
