-- Pix paliativo editável pelo admin: guarda a copia-e-cola e o QR (URL ou data URI base64)
-- em platform_settings. O app cliente lê isto na tela de Pix (com fallback no config do app).
-- ⚠️ Preencher com a copia-e-cola COMPLETA e o QR oficial (a doc traz o código mascarado com ***).
INSERT INTO public.platform_settings (key, value)
VALUES (
  'pix_palliative',
  jsonb_build_object(
    'copia_e_cola', '00020126460014BR.GOV.BCB.PIX0124financeiro@takeme.com.br5204000053039865802BR5901N6001C62070503***63040B2F',
    'qr_image_url', ''
  )
)
ON CONFLICT (key) DO NOTHING;
