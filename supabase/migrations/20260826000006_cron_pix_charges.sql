-- Pix real — Fase 0/G: crons das cobranças Pix (deploy por último — rodam em
-- vazio até existirem cobranças reais).
--
-- expire-pix-charges (a cada 2 min): expira cobranças pendentes vencidas —
-- re-consulta o provedor primeiro (pago no último segundo → liquida), senão
-- marca expired + cancela o pedido (vaga volta pelo trigger de capacidade) +
-- cancela a cobrança no provedor (best-effort). Zero notificações (gates da
-- migration 20260826000005).
SELECT cron.schedule(
  'expire-pix-charges',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xdxzxyzdgwpucwuaxvik.supabase.co/functions/v1/expire-pix-charges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- reconcile-pix (diário, 04:07 UTC): rede de segurança nas duas direções —
-- banco→provedor (cobranças não-terminais re-consultadas) e provedor→banco
-- (pagamentos RECEIVED sem par no banco viram fila orphan_payment). Divergência
-- > 0 notifica os admins.
SELECT cron.schedule(
  'reconcile-pix',
  '7 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xdxzxyzdgwpucwuaxvik.supabase.co/functions/v1/reconcile-pix',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
