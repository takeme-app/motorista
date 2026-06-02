-- Abate da taxa da plataforma em corridas com cartão/Pix quando o Connect está ativo (doc §3.4/§3.5).
--
-- 1) RPC transacional consume_platform_fee_owed: lê o saldo devido com FOR UPDATE
--    (serializa cobranças concorrentes do mesmo motorista — doc §3.6), insere um
--    débito 'connect_charge_abate' no ledger e devolve o valor abatido + o id da linha
--    para a edge charge-booking somar ao application_fee_amount do Stripe.
-- 2) Reversão idempotente: quando um booking entra em estado terminal sem cobrança
--    efetiva (cancelado / estornado), devolve ao motorista o que havia sido abatido.

-- ── Índice único parcial: cada booking só pode ter uma reversão ──
CREATE UNIQUE INDEX IF NOT EXISTS driver_platform_fee_ledger_refund_revert_uidx
  ON public.driver_platform_fee_ledger (booking_id)
  WHERE note = 'refund_revert';

-- ── 1) Consumo transacional do saldo devido ──
CREATE OR REPLACE FUNCTION public.consume_platform_fee_owed(
  p_worker_id uuid,
  p_max_cents integer,
  p_booking_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owed integer;
  extra integer;
  lid uuid;
BEGIN
  IF p_worker_id IS NULL OR p_max_cents IS NULL OR p_max_cents <= 0 THEN
    RETURN jsonb_build_object('extra_cents', 0, 'ledger_id', NULL);
  END IF;

  SELECT w.platform_fee_owed_cents
  INTO owed
  FROM public.worker_profiles w
  WHERE w.id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('extra_cents', 0, 'ledger_id', NULL);
  END IF;

  extra := least(coalesce(owed, 0), p_max_cents);
  IF extra <= 0 THEN
    RETURN jsonb_build_object('extra_cents', 0, 'ledger_id', NULL);
  END IF;

  INSERT INTO public.driver_platform_fee_ledger (worker_id, booking_id, kind, amount_cents, note)
  VALUES (p_worker_id, p_booking_id, 'debit', extra, 'connect_charge_abate')
  RETURNING id INTO lid;

  RETURN jsonb_build_object('extra_cents', extra, 'ledger_id', lid);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_platform_fee_owed(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_platform_fee_owed(uuid, integer, uuid) TO service_role;

COMMENT ON FUNCTION public.consume_platform_fee_owed(uuid, integer, uuid) IS
  'Consome (com FOR UPDATE) até p_max_cents do saldo devido do motorista, registra debit connect_charge_abate no ledger e devolve {extra_cents, ledger_id} para a edge somar ao application_fee do Stripe.';

-- ── 2) Reversão do abate quando o booking não gera cobrança efetiva ──
CREATE OR REPLACE FUNCTION public.trg_bookings_revert_platform_fee_abate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rev_worker uuid;
  rev_total integer;
BEGIN
  IF tg_op <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('cancelled', 'refunded', 'partially_refunded') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Já revertido antes? (idempotência reforçada além do índice único)
  IF EXISTS (
    SELECT 1 FROM public.driver_platform_fee_ledger l
    WHERE l.booking_id = NEW.id AND l.note = 'refund_revert'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT l.worker_id, sum(l.amount_cents)
  INTO rev_worker, rev_total
  FROM public.driver_platform_fee_ledger l
  WHERE l.booking_id = NEW.id AND l.note = 'connect_charge_abate'
  GROUP BY l.worker_id
  LIMIT 1;

  IF rev_worker IS NULL OR coalesce(rev_total, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.driver_platform_fee_ledger (worker_id, booking_id, kind, amount_cents, note)
  VALUES (rev_worker, NEW.id, 'credit', rev_total, 'refund_revert')
  ON CONFLICT (booking_id) WHERE note = 'refund_revert' DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_revert_platform_fee_abate ON public.bookings;
CREATE TRIGGER trg_bookings_revert_platform_fee_abate
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_bookings_revert_platform_fee_abate();

COMMENT ON FUNCTION public.trg_bookings_revert_platform_fee_abate() IS
  'Quando um booking entra em estado terminal sem cobrança efetiva (cancelled/refunded/partially_refunded), devolve ao motorista o que foi abatido (credit refund_revert), idempotente via UNIQUE parcial em booking_id WHERE note=refund_revert.';
