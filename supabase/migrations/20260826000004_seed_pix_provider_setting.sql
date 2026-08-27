-- Pix real — Fase 0/E: seed do gestor de provedores Pix.
-- Shape FLAT (precedente: pix_palliative é flat; o backend lê value->>'mode').
-- ⚠️ NUNCA escrever esta chave via usePlatformSettings.updateSetting do admin
-- (embrulha em {value} e quebraria o contrato flat) — escrita só por função
-- dedicada (pixQueries.updatePixProviderSetting).
--
-- Regra do provedor efetivo (mesma no app e no servidor):
--   allowlist_user_ids.includes(userId) && test_provider ? test_provider : mode
-- Chave ausente ou parse com erro ⇒ 'palliative' (fail-safe).
-- charge_ttl_minutes: validade da cobrança Pix real (expiração é nossa, via cron).
INSERT INTO public.platform_settings (key, value)
VALUES (
  'pix_provider',
  jsonb_build_object(
    'mode', 'palliative',
    'test_provider', NULL,
    'allowlist_user_ids', jsonb_build_array(),
    'charge_ttl_minutes', 15
  )
)
ON CONFLICT (key) DO NOTHING;
