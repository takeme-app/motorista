-- Valor fixo por tamanho do pacote POR BASE (sobrepõe o global de
-- platform_settings.shipment_package_size_prices_cents). NULL = usa o global.
-- Usado no modelo de pernas: o valor do tamanho é somado ao repasse do motorista.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

ALTER TABLE public.bases
  ADD COLUMN IF NOT EXISTS size_price_pequeno_cents integer,
  ADD COLUMN IF NOT EXISTS size_price_medio_cents integer,
  ADD COLUMN IF NOT EXISTS size_price_grande_cents integer;
