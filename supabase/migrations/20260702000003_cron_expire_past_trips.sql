-- Roda de hora em hora (minuto :13) a expiração de pedidos cujo dia passou sem
-- serem realizados (shipments, dependent_shipments, bookings). A lógica de
-- "depois do dia" (fuso America/Sao_Paulo) e o estorno ficam na edge function
-- expire-past-trips.
SELECT cron.schedule(
  'expire-past-trips',
  '13 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xdxzxyzdgwpucwuaxvik.supabase.co/functions/v1/expire-past-trips',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
