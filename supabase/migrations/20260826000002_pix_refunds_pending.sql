-- Pix real — Fase 0/C: fila de devolução MANUAL.
-- Estorno automático está fora do escopo: qualquer dinheiro recebido que não
-- vira pedido válido (pago após expirar, valor divergente, pagamento órfão,
-- cancelamento dentro da janela, etc.) entra aqui e o admin devolve por fora
-- (tela em /pagamentos/pix). A tela só controla o trabalho — não move dinheiro.

CREATE TABLE IF NOT EXISTS public.pix_refunds_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pix_charge_id uuid NULL REFERENCES public.pix_charges (id) ON DELETE SET NULL,
  -- NULLable: pagamento órfão do provedor pode não ter entidade nem usuário conhecidos.
  entity_type text NULL CHECK (
    entity_type IS NULL OR entity_type IN ('booking', 'shipment', 'dependent_shipment', 'excursion')
  ),
  entity_id uuid NULL,
  user_id uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  reason text NOT NULL CHECK (
    reason IN (
      'paid_after_expiry',
      'amount_mismatch',
      'expired_not_realized',
      'user_cancelled_in_window',
      'admin_cancelled',
      'orphan_payment'
    )
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'dismissed')),
  notes text NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pix_refunds_pending IS
  'Fila de devolução manual de Pix. INSERT via service_role (edge functions); admin marca done/dismissed.';
COMMENT ON COLUMN public.pix_refunds_pending.reason IS
  'paid_after_expiry|amount_mismatch|expired_not_realized|user_cancelled_in_window|admin_cancelled|orphan_payment.';

CREATE INDEX IF NOT EXISTS pix_refunds_pending_status_idx
  ON public.pix_refunds_pending (status, created_at DESC);

CREATE INDEX IF NOT EXISTS pix_refunds_pending_charge_idx
  ON public.pix_refunds_pending (pix_charge_id);

-- RLS: admin lê e resolve (UPDATE); INSERT só via service_role.
ALTER TABLE public.pix_refunds_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pix_refunds_pending_select_admin ON public.pix_refunds_pending;
CREATE POLICY pix_refunds_pending_select_admin
  ON public.pix_refunds_pending
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS pix_refunds_pending_update_admin ON public.pix_refunds_pending;
CREATE POLICY pix_refunds_pending_update_admin
  ON public.pix_refunds_pending
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Realtime: o admin assina a fila (badge de pendências em /pagamentos).
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pix_refunds_pending'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pix_refunds_pending;
  END IF;
END $migration$;
