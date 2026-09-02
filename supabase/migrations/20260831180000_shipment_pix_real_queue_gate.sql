-- Pix real em encomendas: não ofertar ao motorista antes do pagamento.
--
-- A encomenda no Pix real nasce ANTES do pagamento (a cobrança precisa se
-- ancorar nela), então o gatilho de fila passaria a ofertá-la de imediato —
-- encomenda não paga entrando na fila do motorista.
--
-- O gatilho JÁ tem exatamente este portão para cartão: não abre fila enquanto
-- stripe_payment_intent_id estiver vazio. Aqui só se acrescenta o equivalente
-- para Pix (cobrança ancorada e ainda não liquidada) e se inclui pix_paid_at
-- entre os campos que reabrem a avaliação no UPDATE — é a liquidação que
-- destrava a fila.
--
-- Pix paliativo não tem pix_charge_id, então segue passando intacto.
CREATE OR REPLACE FUNCTION public.trg_shipment_auto_open_driver_offer_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.client_preferred_driver_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.driver_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.driver_offer_index IS NOT NULL AND NEW.driver_offer_index >= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  IF NEW.package_size = 'grande' AND NEW.admin_approved_at IS NULL THEN RETURN NEW; END IF;

  IF lower(coalesce(NEW.payment_method, '')) IN ('credito', 'debito')
     AND (NEW.stripe_payment_intent_id IS NULL OR btrim(NEW.stripe_payment_intent_id) = '')
  THEN
    RETURN NEW;
  END IF;

  -- Pix REAL ainda não liquidado: a cobrança existe (pix_charge_id) mas o
  -- pagamento não entrou (pix_paid_at nulo). Espelha o portão do cartão.
  IF lower(coalesce(NEW.payment_method, '')) = 'pix'
     AND NEW.pix_charge_id IS NOT NULL
     AND NEW.pix_paid_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND (
          OLD.status IS DISTINCT FROM NEW.status
          OR OLD.stripe_payment_intent_id IS DISTINCT FROM NEW.stripe_payment_intent_id
          OR OLD.pix_paid_at IS DISTINCT FROM NEW.pix_paid_at
          OR OLD.client_preferred_driver_id IS DISTINCT FROM NEW.client_preferred_driver_id
          OR OLD.base_id IS DISTINCT FROM NEW.base_id
          OR OLD.driver_offer_index IS DISTINCT FROM NEW.driver_offer_index
          OR OLD.admin_approved_at IS DISTINCT FROM NEW.admin_approved_at
     ))
  THEN
    BEGIN
      PERFORM public.shipment_open_driver_offer_queue_internal(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[trg_shipment_auto_open_driver_offer_queue] ignorado: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
