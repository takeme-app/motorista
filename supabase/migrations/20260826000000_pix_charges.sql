-- Pix real (gestor de provedores) — Fase 0/A: âncora da cobrança Pix.
-- pix_charges registra cada cobrança criada num provedor real (Asaas hoje;
-- Bradesco futuro). A linha é gravada ANTES da chamada à API do provedor
-- (provider_charge_id fica NULL enquanto o create está em voo) e o id interno
-- vai como externalReference — reconciliação nunca depende só do provedor.
-- Aditiva: nada lê esta tabela até o admin trocar o modo em pix_provider.

CREATE TABLE IF NOT EXISTS public.pix_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('asaas', 'bradesco')),
  provider_env text NOT NULL CHECK (provider_env IN ('sandbox', 'production')),
  -- id da cobrança no provedor (ex.: pay_xxx no Asaas). NULL enquanto o create
  -- está em voo; preenchido logo após a resposta da API.
  provider_charge_id text NULL,
  -- Polimórfico como payouts (booking na fase 1; demais nas fases seguintes).
  entity_type text NOT NULL CHECK (
    entity_type IN ('booking', 'shipment', 'dependent_shipment', 'excursion')
  ),
  entity_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  expected_amount_cents integer NOT NULL CHECK (expected_amount_cents >= 1),
  paid_amount_cents integer NULL CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'paid', 'expired', 'cancelled', 'amount_mismatch', 'paid_orphan', 'create_failed')
  ),
  qr_payload text NULL,
  qr_image_base64 text NULL,
  expires_at timestamptz NULL,
  paid_at timestamptz NULL,
  failure_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pix_charges IS
  'Cobranças Pix em provedores reais (Asaas/Bradesco). Linha criada antes da API; externalReference = id.';
COMMENT ON COLUMN public.pix_charges.provider_charge_id IS
  'Id da cobrança no provedor. NULL enquanto o create está em voo.';
COMMENT ON COLUMN public.pix_charges.status IS
  'pending|paid|expired|cancelled|amount_mismatch|paid_orphan|create_failed. Expiração é NOSSA (cron expire-pix-charges).';

-- Dedup por provedor (parcial: create em voo tem provider_charge_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS pix_charges_provider_charge_uidx
  ON public.pix_charges (provider, provider_charge_id)
  WHERE provider_charge_id IS NOT NULL;

-- Cron de expiração varre só as pendentes vencidas.
CREATE INDEX IF NOT EXISTS pix_charges_pending_expires_idx
  ON public.pix_charges (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS pix_charges_user_id_idx ON public.pix_charges (user_id);
CREATE INDEX IF NOT EXISTS pix_charges_entity_idx ON public.pix_charges (entity_type, entity_id);

-- RLS: dono e admin leem; escrita SÓ via service_role (edge functions).
ALTER TABLE public.pix_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pix_charges_select_own ON public.pix_charges;
CREATE POLICY pix_charges_select_own
  ON public.pix_charges
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS pix_charges_select_admin ON public.pix_charges;
CREATE POLICY pix_charges_select_admin
  ON public.pix_charges
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Realtime: o app assina a própria cobrança (pix-charge-{id}) para saber do paid.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pix_charges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pix_charges;
  END IF;
END $migration$;

-- Cache de customer por provedor (Asaas exige customer para criar payment).
-- Escrita/leitura só via service_role; nenhuma policy de SELECT (RLS fecha tudo).
CREATE TABLE IF NOT EXISTS public.pix_provider_customers (
  provider text NOT NULL CHECK (provider IN ('asaas', 'bradesco')),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, user_id)
);

COMMENT ON TABLE public.pix_provider_customers IS
  'Cache do customer id no provedor Pix (ex.: cus_xxx do Asaas) por usuário. Service role only.';

ALTER TABLE public.pix_provider_customers ENABLE ROW LEVEL SECURITY;
