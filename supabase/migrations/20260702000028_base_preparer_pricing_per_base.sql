-- Pagamento do preparador de encomendas passa a ser configurável POR BASE.
-- bases ganha taxa por km e/ou valor fixo; a trigger usa a config da base
-- (fallback: taxa global platform_settings.km_price_cents, como antes).
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

ALTER TABLE public.bases
  ADD COLUMN IF NOT EXISTS preparer_pricing_mode text,
  ADD COLUMN IF NOT EXISTS preparer_km_price_cents integer,
  ADD COLUMN IF NOT EXISTS preparer_fixed_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bases_preparer_pricing_mode_check'
  ) THEN
    ALTER TABLE public.bases
      ADD CONSTRAINT bases_preparer_pricing_mode_check
      CHECK (preparer_pricing_mode IS NULL OR preparer_pricing_mode IN ('per_km', 'fixed'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_shipment_preparer_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base_lat double precision;
  v_base_lng double precision;
  v_mode text;
  v_base_km_cents integer;
  v_base_fixed_cents integer;
  v_global_cents integer;
  v_rate_cents integer;
  v_km double precision;
  v_k integer;
  R constant double precision := 6371.0;
  d_lat double precision;
  d_lng double precision;
  a double precision;
BEGIN
  v_k := 0;

  IF NEW.base_id IS NOT NULL
     AND NEW.origin_lat IS NOT NULL
     AND NEW.origin_lng IS NOT NULL THEN
    SELECT b.lat, b.lng, b.preparer_pricing_mode, b.preparer_km_price_cents, b.preparer_fixed_cents
      INTO v_base_lat, v_base_lng, v_mode, v_base_km_cents, v_base_fixed_cents
      FROM public.bases b
     WHERE b.id = NEW.base_id;

    IF v_mode = 'fixed' AND v_base_fixed_cents IS NOT NULL THEN
      -- Valor fixo por entrega configurado na base.
      v_k := GREATEST(0, v_base_fixed_cents);
    ELSIF v_base_lat IS NOT NULL AND v_base_lng IS NOT NULL THEN
      -- Por km: taxa da base, com fallback para a taxa global.
      SELECT COALESCE(
               NULLIF(value->>'value', '')::integer,
               NULLIF(value->>'cents', '')::integer,
               100
             )
        INTO v_global_cents
        FROM public.platform_settings
       WHERE key = 'km_price_cents';
      v_rate_cents := COALESCE(v_base_km_cents, v_global_cents, 100);

      d_lat := radians(v_base_lat - NEW.origin_lat);
      d_lng := radians(v_base_lng - NEW.origin_lng);
      a := sin(d_lat / 2) ^ 2
           + cos(radians(NEW.origin_lat)) * cos(radians(v_base_lat))
             * sin(d_lng / 2) ^ 2;
      v_km := R * 2 * asin(least(1, sqrt(a)));

      v_k := GREATEST(0, ROUND(2 * v_km * v_rate_cents))::integer;
    END IF;
  END IF;

  NEW.preparer_payout_cents := LEAST(v_k, GREATEST(0, COALESCE(NEW.platform_fee_cents, 0)));

  NEW.admin_earning_cents := GREATEST(
    0,
    COALESCE(NEW.amount_cents, 0)
      - COALESCE(NEW.worker_earning_cents, 0)
      - NEW.preparer_payout_cents
  );

  RETURN NEW;
END;
$function$;
