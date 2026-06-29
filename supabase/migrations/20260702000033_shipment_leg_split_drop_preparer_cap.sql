-- Encomenda no modelo de PERNAS (Origem→Base + Base→Destino):
-- o cliente (shipmentQuote) passa a calcular o split e grava diretamente
--   preparer_payout_cents = perna Origem→Base
--   worker_earning_cents  = perna Base→Destino + valor do tamanho (motorista)
--   admin_earning_cents   = total − (preparador + motorista)  (taxa da plataforma)
--
-- 1) Remove o trigger que recomputava/sobrescrevia o repasse do preparador
--    (base↔coleta, limitado à taxa) — não vale mais nesse modelo.
-- 2) Remove o teto preparer_payout <= platform_fee (o preparador agora recebe a perna
--    real, que pode exceder a taxa). Mantém apenas preparer_payout_cents >= 0.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

DROP TRIGGER IF EXISTS trg_set_shipment_preparer_payout ON public.shipments;

ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_preparer_payout_cents_range;
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_preparer_payout_cents_range CHECK (preparer_payout_cents >= 0);
