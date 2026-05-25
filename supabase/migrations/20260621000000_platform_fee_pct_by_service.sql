-- Taxas da plataforma por tipo de servico.
-- Mantem default_admin_pct como fallback e nao altera snapshots existentes.

WITH default_pct AS (
  SELECT COALESCE(
    NULLIF(value->>'percentage', '')::numeric,
    NULLIF(value->>'value', '')::numeric,
    15::numeric
  ) AS pct
  FROM public.platform_settings
  WHERE key = 'default_admin_pct'
  UNION ALL
  SELECT 15::numeric
  WHERE NOT EXISTS (
    SELECT 1 FROM public.platform_settings WHERE key = 'default_admin_pct'
  )
)
INSERT INTO public.platform_settings (key, value)
SELECT
  'platform_fee_pct_by_service',
  jsonb_build_object(
    'value',
    jsonb_build_object(
      'booking', pct,
      'dependent_shipment', pct,
      'shipment_driver', pct,
      'shipment_preparer', pct,
      'excursion', pct
    )
  )
FROM default_pct
LIMIT 1
ON CONFLICT (key) DO NOTHING;
