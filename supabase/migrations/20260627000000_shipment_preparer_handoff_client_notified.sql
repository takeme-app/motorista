-- =====================================================================
-- Quando o cron declara expirado o handoff de 1h do preparador
-- (preparer_handoff_expired_at NOT NULL), a edge function
-- `notify-preparer-handoff-expired` precisa notificar dois destinatários:
--   - Motorista: "Coleta agora é com você" (já existe, controlada pela
--     flag preparer_handoff_notified_at).
--   - Cliente:  "O código de coleta agora é do motorista" (novo).
--
-- Para que falha em um lado não bloqueie o outro no próximo tick do cron,
-- cada destinatário tem sua própria flag de idempotência. Adicionamos a
-- coluna do cliente sem renomear a antiga (preparer_handoff_notified_at
-- segue valendo para o motorista — manter compatibilidade com migrations
-- e código que já a referenciam).
-- =====================================================================

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS preparer_handoff_client_notified_at timestamptz;

COMMENT ON COLUMN public.shipments.preparer_handoff_client_notified_at IS
  'Idempotência: edge function notify-preparer-handoff-expired marca aqui após inserir a notification para o cliente (avisando que o código de coleta agora é do motorista).';

COMMENT ON COLUMN public.shipments.preparer_handoff_notified_at IS
  'Idempotência: edge function notify-preparer-handoff-expired marca aqui após inserir a notification para o motorista.';
