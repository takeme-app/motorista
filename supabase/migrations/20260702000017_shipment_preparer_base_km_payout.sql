-- Payout do preparador de encomendas pelo deslocamento base<->origem (ida e volta).
--
-- Modelo (fluxo "com base"): o total do cliente NAO muda. A parcela do preparador (K)
-- e RETIRADA da taxa da plataforma (admin). Motorista (worker_earning_cents) inalterado.
--   K  = round( 2 * haversine_km(origem, base) * km_price_cents )
--   preparer_payout_cents = min(K, platform_fee_cents)   -- clamp p/ admin nunca negativo
--   admin_earning_cents   = amount_cents - worker_earning_cents - preparer_payout_cents
-- Invariante: worker + preparer + admin = amount.
-- Encomendas sem base_id: preparer_payout_cents = 0 (split inalterado).

-- 1) Coluna da fatia do preparador (espelha excursion_requests.preparer_payout_cents,
--    mas limitada a taxa da plataforma, pois sai dela).
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS preparer_payout_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_preparer_payout_cents_range;
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_preparer_payout_cents_range
  CHECK (
    preparer_payout_cents >= 0
    AND preparer_payout_cents <= platform_fee_cents
  );

COMMENT ON COLUMN public.shipments.preparer_payout_cents IS
  'Fatia destinada ao preparador (preparer_id) pelo deslocamento base<->origem (ida e volta). Retirada de platform_fee_cents; admin recebe o restante. 0 quando nao ha base_id.';

-- 2) Recalculo do split (BEFORE INSERT/UPDATE). SECURITY DEFINER para ler bases/platform_settings.
CREATE OR REPLACE FUNCTION public.set_shipment_preparer_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_lat double precision;
  v_base_lng double precision;
  v_rate_cents integer;
  v_km double precision;
  v_k integer;
  R constant double precision := 6371.0; -- raio da Terra em km
  d_lat double precision;
  d_lng double precision;
  a double precision;
BEGIN
  v_k := 0;

  IF NEW.base_id IS NOT NULL
     AND NEW.origin_lat IS NOT NULL
     AND NEW.origin_lng IS NOT NULL THEN
    SELECT b.lat, b.lng INTO v_base_lat, v_base_lng
      FROM public.bases b
     WHERE b.id = NEW.base_id;

    IF v_base_lat IS NOT NULL AND v_base_lng IS NOT NULL THEN
      -- tarifa por km: reusa platform_settings.km_price_cents (fallback 100 = R$1,00/km)
      SELECT COALESCE(
               NULLIF(value->>'value', '')::integer,
               NULLIF(value->>'cents', '')::integer,
               100
             )
        INTO v_rate_cents
        FROM public.platform_settings
       WHERE key = 'km_price_cents';
      v_rate_cents := COALESCE(v_rate_cents, 100);

      -- haversine (km)
      d_lat := radians(v_base_lat - NEW.origin_lat);
      d_lng := radians(v_base_lng - NEW.origin_lng);
      a := sin(d_lat / 2) ^ 2
           + cos(radians(NEW.origin_lat)) * cos(radians(v_base_lat))
             * sin(d_lng / 2) ^ 2;
      v_km := R * 2 * asin(least(1, sqrt(a)));

      -- ida e volta
      v_k := GREATEST(0, ROUND(2 * v_km * v_rate_cents))::integer;
    END IF;
  END IF;

  -- clamp na taxa da plataforma (admin nunca negativo)
  NEW.preparer_payout_cents := LEAST(v_k, GREATEST(0, COALESCE(NEW.platform_fee_cents, 0)));

  -- admin recebe o restante; invariante worker + preparer + admin = amount
  NEW.admin_earning_cents := GREATEST(
    0,
    COALESCE(NEW.amount_cents, 0)
      - COALESCE(NEW.worker_earning_cents, 0)
      - NEW.preparer_payout_cents
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_shipment_preparer_payout ON public.shipments;
CREATE TRIGGER trg_set_shipment_preparer_payout
  BEFORE INSERT OR UPDATE OF base_id, origin_lat, origin_lng, platform_fee_cents, amount_cents, worker_earning_cents
  ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_shipment_preparer_payout();

-- 3) Backfill: recalcula split das encomendas base existentes (dispara o trigger).
UPDATE public.shipments SET base_id = base_id WHERE base_id IS NOT NULL;
