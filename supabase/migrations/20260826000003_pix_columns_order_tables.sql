-- Pix real — Fase 0/D: colunas de vínculo com pix_charges nas 4 tabelas de pedido.
-- Fase 1 usa só bookings; nas demais as colunas ficam dormentes até as fases
-- seguintes. pix_paid_at é o gate BARATO para triggers e branches (sem JOIN em
-- pix_charges): preenchido na promoção pending→paid pelo settlePixCharge.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pix_charge_id uuid NULL REFERENCES public.pix_charges (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pix_paid_at timestamptz NULL;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS pix_charge_id uuid NULL REFERENCES public.pix_charges (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pix_paid_at timestamptz NULL;

ALTER TABLE public.dependent_shipments
  ADD COLUMN IF NOT EXISTS pix_charge_id uuid NULL REFERENCES public.pix_charges (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pix_paid_at timestamptz NULL;

ALTER TABLE public.excursion_requests
  ADD COLUMN IF NOT EXISTS pix_charge_id uuid NULL REFERENCES public.pix_charges (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pix_paid_at timestamptz NULL;

COMMENT ON COLUMN public.bookings.pix_charge_id IS
  'Cobrança Pix real (pix_charges) que originou/pagou o pedido. NULL para cartão, dinheiro e Pix paliativo.';
COMMENT ON COLUMN public.bookings.pix_paid_at IS
  'Confirmação de pagamento Pix real (settlePixCharge). Gate barato para triggers/branches sem JOIN.';

-- Índices de FK (padrão perf_fk_indexes) — parciais: a maioria das linhas fica NULL.
CREATE INDEX IF NOT EXISTS idx_bookings_pix_charge_id
  ON public.bookings (pix_charge_id) WHERE pix_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_pix_charge_id
  ON public.shipments (pix_charge_id) WHERE pix_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dependent_shipments_pix_charge_id
  ON public.dependent_shipments (pix_charge_id) WHERE pix_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_excursion_requests_pix_charge_id
  ON public.excursion_requests (pix_charge_id) WHERE pix_charge_id IS NOT NULL;
