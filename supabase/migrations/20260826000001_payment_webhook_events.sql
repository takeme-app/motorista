-- Pix real — Fase 0/B: dedup de eventos de webhook de provedores de pagamento.
-- Obrigatória para o Asaas: o webhook usa token estático e payload NÃO assinado
-- (diferente do Stripe, que tem HMAC + guardas condicionais). O asaas-webhook
-- insere aqui com ignoreDuplicates em (provider, event_id) — 0 linhas inseridas
-- significa evento repetido (fila do Asaas reenvia) e a função responde 200 sem
-- reprocessar.

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('asaas', 'bradesco')),
  event_id text NOT NULL,
  event_type text NULL,
  provider_charge_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'settled' | 'duplicate' | 'orphan' | 'ignored' | 'mismatch' | 'error:…'
  processing_result text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_webhook_events IS
  'Dedup + auditoria de webhooks de provedores Pix. UNIQUE (provider, event_id) é a chave de idempotência.';
COMMENT ON COLUMN public.payment_webhook_events.processing_result IS
  'settled|duplicate|orphan|ignored|mismatch|error:… — preenchido após processar; error nunca vira 5xx (reconcile é a rede).';

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_uidx
  ON public.payment_webhook_events (provider, event_id);

CREATE INDEX IF NOT EXISTS payment_webhook_events_charge_idx
  ON public.payment_webhook_events (provider, provider_charge_id);

-- RLS: só admin lê (auditoria); escrita só service_role (webhook).
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_webhook_events_select_admin ON public.payment_webhook_events;
CREATE POLICY payment_webhook_events_select_admin
  ON public.payment_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());
