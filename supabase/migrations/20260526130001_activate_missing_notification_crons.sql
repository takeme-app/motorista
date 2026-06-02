-- =====================================================================
-- Ativa crons faltantes de edge functions de notificação.
--
-- CONTEXTO: 3 edge functions de notificação estão deployed mas SEM cron
-- agendado, então nunca disparam:
--
--   - notify-passenger-driver-proximity (deveria rodar a cada 2 min)
--   - notify-preparer-handoff-expired   (deveria rodar a cada 1 min)
--
-- A única ativa via cron é notify-driver-upcoming-trips (jobid=6, a cada
-- 10 min). Auditoria em 2026-05-26.
--
-- Esta migration agenda as duas faltantes via pg_cron + pg_net seguindo
-- o padrão das demais (cf. expire-assignments / notify-driver-upcoming-trips).
--
-- Idempotência: cron.unschedule(jobname) antes de schedule garante que
-- re-runs da migration não criem duplicatas.
-- =====================================================================

-- Helper: silenciosamente desagenda se já existir.
DO $$
BEGIN
  PERFORM cron.unschedule('notify-passenger-driver-proximity');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('notify-preparer-handoff-expired');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;


-- ---------------------------------------------------------------------
-- notify-passenger-driver-proximity — a cada 2 minutos.
-- Cliente recebe notificações de proximidade (~5min) e chegada (~120m).
-- ---------------------------------------------------------------------
SELECT cron.schedule(
  'notify-passenger-driver-proximity',
  '*/2 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://xdxzxyzdgwpucwuaxvik.supabase.co/functions/v1/notify-passenger-driver-proximity',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);


-- ---------------------------------------------------------------------
-- notify-preparer-handoff-expired — a cada 1 minuto.
-- Notifica motorista quando preparer_handoff_expired_at é setado pelo
-- cron SQL (shipment_process_expired_preparer_handoffs); idempotente
-- via preparer_handoff_notified_at.
-- ---------------------------------------------------------------------
SELECT cron.schedule(
  'notify-preparer-handoff-expired',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://xdxzxyzdgwpucwuaxvik.supabase.co/functions/v1/notify-preparer-handoff-expired',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);
