-- Ledger da taxa da plataforma em viagens a dinheiro + abate Connect (admin §5, doc plataforma-fee-saldo-motorista).
-- Idempotente com IF NOT EXISTS / CREATE OR REPLACE onde aplicável.

-- 1) is_admin() — alinhado ao PRD (JWT app_metadata.role = admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- 2) Colunas em bookings (§1 doc — podem já existir noutra migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE public.bookings
      ADD COLUMN payment_method text NOT NULL DEFAULT 'card'
      CONSTRAINT bookings_payment_method_check CHECK (payment_method IN ('card', 'pix', 'cash'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'platform_fee_extra_debit_cents'
  ) THEN
    ALTER TABLE public.bookings
      ADD COLUMN platform_fee_extra_debit_cents integer NOT NULL DEFAULT 0
      CONSTRAINT bookings_platform_fee_extra_debit_nonneg CHECK (platform_fee_extra_debit_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'admin_earning_cents'
  ) THEN
    ALTER TABLE public.bookings
      ADD COLUMN admin_earning_cents integer NOT NULL DEFAULT 0
      CONSTRAINT bookings_admin_earning_nonneg CHECK (admin_earning_cents >= 0);
  END IF;
END $$;

-- 3) Saldo agregado no perfil do worker
ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS platform_fee_owed_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.worker_profiles
  DROP CONSTRAINT IF EXISTS worker_profiles_platform_fee_owed_nonneg;
ALTER TABLE public.worker_profiles
  ADD CONSTRAINT worker_profiles_platform_fee_owed_nonneg CHECK (platform_fee_owed_cents >= 0);

-- 4) Tabela ledger
CREATE TABLE IF NOT EXISTS public.driver_platform_fee_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.worker_profiles (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('credit', 'debit')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_platform_fee_ledger_worker_created_idx
  ON public.driver_platform_fee_ledger (worker_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS driver_platform_fee_ledger_cash_completed_uidx
  ON public.driver_platform_fee_ledger (booking_id)
  WHERE note = 'cash_trip_completed';

COMMENT ON TABLE public.driver_platform_fee_ledger IS
  'credit = motorista deve taxa à plataforma; debit = abate (Connect ou quitação manual).';

-- 5) Recalcular platform_fee_owed_cents a partir do ledger
CREATE OR REPLACE FUNCTION public.refresh_driver_platform_fee_owed_from_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wid uuid;
  bal integer;
BEGIN
  wid := coalesce(NEW.worker_id, OLD.worker_id);
  IF wid IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  SELECT coalesce(
    sum(
      CASE kind
        WHEN 'credit' THEN amount_cents
        WHEN 'debit' THEN -amount_cents
        ELSE 0
      END
    ),
    0
  )
  INTO bal
  FROM public.driver_platform_fee_ledger
  WHERE worker_id = wid;

  IF bal < 0 THEN
    bal := 0;
  END IF;

  UPDATE public.worker_profiles
  SET platform_fee_owed_cents = bal
  WHERE id = wid;

  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_platform_fee_ledger_refresh_owed ON public.driver_platform_fee_ledger;
CREATE TRIGGER trg_driver_platform_fee_ledger_refresh_owed
  AFTER INSERT OR UPDATE OR DELETE ON public.driver_platform_fee_ledger
  FOR EACH ROW
  EXECUTE PROCEDURE public.refresh_driver_platform_fee_owed_from_ledger();

-- 6) Crédito ao completar viagem em dinheiro (§3.3)
CREATE OR REPLACE FUNCTION public.trg_bookings_platform_fee_credit_on_cash_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  drv uuid;
  fee integer;
BEGIN
  IF tg_op <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF old.status IS NOT DISTINCT FROM new.status OR new.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF new.payment_method IS DISTINCT FROM 'cash' THEN
    RETURN NEW;
  END IF;

  SELECT st.driver_id INTO drv
  FROM public.scheduled_trips st
  WHERE st.id = new.scheduled_trip_id
  LIMIT 1;

  IF drv IS NULL THEN
    RETURN NEW;
  END IF;

  fee := coalesce(new.admin_earning_cents, 0);
  IF fee <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.driver_platform_fee_ledger l
    WHERE l.booking_id = new.id AND l.note = 'cash_trip_completed'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.driver_platform_fee_ledger (worker_id, booking_id, kind, amount_cents, note)
  VALUES (drv, new.id, 'credit', fee, 'cash_trip_completed');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_platform_fee_credit_cash ON public.bookings;
CREATE TRIGGER trg_bookings_platform_fee_credit_cash
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_bookings_platform_fee_credit_on_cash_completed();

-- 7) RLS ledger — só admin lê; escrita só via triggers / SECURITY DEFINER RPC
ALTER TABLE public.driver_platform_fee_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_platform_fee_ledger_admin_select ON public.driver_platform_fee_ledger;
CREATE POLICY driver_platform_fee_ledger_admin_select
  ON public.driver_platform_fee_ledger
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 8) RPC quitação manual (§5 doc)
CREATE OR REPLACE FUNCTION public.admin_manual_platform_fee_settle(p_worker_id uuid, p_amount_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owed integer;
  apply_amt integer;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT w.platform_fee_owed_cents
  INTO owed
  FROM public.worker_profiles w
  WHERE w.id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_not_found');
  END IF;

  apply_amt := least(coalesce(owed, 0), p_amount_cents);
  IF apply_amt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_settle');
  END IF;

  INSERT INTO public.driver_platform_fee_ledger (worker_id, booking_id, kind, amount_cents, note)
  VALUES (p_worker_id, NULL, 'debit', apply_amt, 'manual_adjustment');

  RETURN jsonb_build_object(
    'ok', true,
    'settled_cents', apply_amt,
    'owed_after', (SELECT platform_fee_owed_cents FROM public.worker_profiles WHERE id = p_worker_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manual_platform_fee_settle(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manual_platform_fee_settle(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_platform_fee_settle(uuid, integer) TO service_role;

-- Re-sincronizar saldos se já existirem linhas no ledger (ex.: deploy incremental)
UPDATE public.worker_profiles wp
SET platform_fee_owed_cents = greatest(0, coalesce((
  SELECT sum(
    CASE l.kind
      WHEN 'credit' THEN l.amount_cents
      WHEN 'debit' THEN -l.amount_cents
      ELSE 0
    END
  )
  FROM public.driver_platform_fee_ledger l
  WHERE l.worker_id = wp.id
), 0));
