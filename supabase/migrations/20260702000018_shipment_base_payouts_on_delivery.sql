-- Liquidacao do fluxo base de encomendas: ao ENTREGAR (status='delivered'), cria payouts
-- para o motorista (worker_earning_cents) e o preparador (preparer_payout_cents).
--
-- Por que na entrega (e nao no pagamento, como excursoes): no fluxo base o preparer_id/driver_id
-- so sao conhecidos depois (handoff). No pagamento eles sao NULL. A cobranca da encomenda base
-- vai inteira para a plataforma (charge-shipments nao usa transfer_data quando ha base_id);
-- a distribuicao motorista+preparador acontece aqui, via tabela `payouts` (admin retem o resto).
--
-- Encomendas SEM base nao entram aqui: continuam liquidando via transfer Connect unico ao motorista.

CREATE OR REPLACE FUNCTION public.create_shipment_base_payouts_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gross integer;
  v_worker integer;
  v_preparer integer;
BEGIN
  IF NEW.status = 'delivered'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.base_id IS NOT NULL THEN

    v_gross := GREATEST(0, COALESCE(NEW.amount_cents, 0));
    v_worker := GREATEST(0, COALESCE(NEW.worker_earning_cents, 0));
    v_preparer := GREATEST(0, COALESCE(NEW.preparer_payout_cents, 0));

    -- Motorista: worker_earning_cents (inalterado em relacao ao modelo atual).
    IF NEW.driver_id IS NOT NULL AND v_worker > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payouts p
          WHERE p.entity_type = 'shipment' AND p.entity_id = NEW.id
            AND p.worker_id = NEW.driver_id
       ) THEN
      INSERT INTO public.payouts
        (worker_id, entity_type, entity_id, gross_amount_cents, worker_amount_cents, admin_amount_cents, payout_method, status)
      VALUES
        (NEW.driver_id, 'shipment', NEW.id, v_gross, v_worker, 0, 'pix', 'pending');
    END IF;

    -- Preparador: preparer_payout_cents (km base<->origem, retirado da taxa da plataforma).
    IF NEW.preparer_id IS NOT NULL AND v_preparer > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payouts p
          WHERE p.entity_type = 'shipment' AND p.entity_id = NEW.id
            AND p.worker_id = NEW.preparer_id
       ) THEN
      INSERT INTO public.payouts
        (worker_id, entity_type, entity_id, gross_amount_cents, worker_amount_cents, admin_amount_cents, payout_method, status)
      VALUES
        (NEW.preparer_id, 'shipment', NEW.id, v_gross, v_preparer, 0, 'pix', 'pending');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_shipment_base_payouts_on_delivery ON public.shipments;
CREATE TRIGGER trg_create_shipment_base_payouts_on_delivery
  AFTER UPDATE OF status ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.create_shipment_base_payouts_on_delivery();
