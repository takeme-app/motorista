-- Valor fixo por tamanho do pacote POR ROTA (pricing_routes role driver), sobrepõe o global.
-- Resolvido na cotação via shipments.scheduled_trip_id → scheduled_trips.route_id →
-- worker_routes.pricing_route_id → pricing_routes.size_price_*. NULL = usa o global.
-- Reverte a abordagem por base (colunas em bases removidas).
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

ALTER TABLE public.pricing_routes
  ADD COLUMN IF NOT EXISTS size_price_pequeno_cents integer,
  ADD COLUMN IF NOT EXISTS size_price_medio_cents integer,
  ADD COLUMN IF NOT EXISTS size_price_grande_cents integer;

ALTER TABLE public.bases
  DROP COLUMN IF EXISTS size_price_pequeno_cents,
  DROP COLUMN IF EXISTS size_price_medio_cents,
  DROP COLUMN IF EXISTS size_price_grande_cents;
