-- Estende a fila de devolução do Pix real ao envio de dependente.
--
-- Mesmo buraco que a encomenda tinha (20260902123000): pago via Pix e depois
-- cancelado, o dinheiro ficava com a Take Me sem nenhuma pendência no painel.
--
-- Em vez de um segundo gatilho quase igual, a função passa a derivar o
-- entity_type de TG_TABLE_NAME e é ligada às duas tabelas. As colunas que ela
-- usa (pix_charge_id, pix_paid_at, cancellation_reason, amount_cents, user_id)
-- existem nas duas com o mesmo significado.

CREATE OR REPLACE FUNCTION public.trg_shipment_pix_paid_cancel_refund_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
  v_amount int;
  v_entity_type text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.status = 'cancelled' THEN RETURN NEW; END IF;

  -- Só Pix REAL liquidado. Paliativo não tem pix_charge_id e não movimentou
  -- dinheiro rastreável; cartão tem o caminho de estorno automático do Stripe.
  IF NEW.pix_charge_id IS NULL OR NEW.pix_paid_at IS NULL THEN RETURN NEW; END IF;

  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'shipments' THEN 'shipment'
    WHEN 'dependent_shipments' THEN 'dependent_shipment'
    ELSE NULL
  END;
  IF v_entity_type IS NULL THEN RETURN NEW; END IF;

  v_reason := CASE
    WHEN coalesce(NEW.cancellation_reason, '') = 'no_driver_accepted' THEN 'expired_not_realized'
    WHEN NEW.cancellation_reason ILIKE 'driver%' THEN 'driver_cancelled'
    WHEN NEW.cancellation_reason ILIKE 'admin%' THEN 'admin_cancelled'
    WHEN NEW.cancellation_reason ILIKE 'user%'
      OR NEW.cancellation_reason ILIKE 'client%' THEN 'user_cancelled_in_window'
    ELSE 'expired_not_realized'
  END;

  -- Valor de verdade é o que entrou na cobrança, não o amount_cents da linha.
  SELECT coalesce(pc.paid_amount_cents, pc.expected_amount_cents)
    INTO v_amount
    FROM public.pix_charges pc
   WHERE pc.id = NEW.pix_charge_id;
  v_amount := greatest(coalesce(v_amount, NEW.amount_cents, 0), 0);

  IF EXISTS (
    SELECT 1 FROM public.pix_refunds_pending r
     WHERE r.pix_charge_id = NEW.pix_charge_id AND r.status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pix_refunds_pending
    (pix_charge_id, entity_type, entity_id, user_id, amount_cents, reason, notes)
  VALUES
    (NEW.pix_charge_id, v_entity_type, NEW.id, NEW.user_id, v_amount, v_reason,
     format('%s cancelado após pagamento Pix (motivo: %s)',
            CASE v_entity_type WHEN 'shipment' THEN 'encomenda'
                               ELSE 'envio de dependente' END,
            coalesce(NEW.cancellation_reason, 'não informado')));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca derrubar o cancelamento por causa da fila de devolução.
  RAISE WARNING '[trg_shipment_pix_paid_cancel_refund_queue] ignorado: %', SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_dependent_shipment_pix_paid_cancel_refund_queue ON public.dependent_shipments;

CREATE TRIGGER on_dependent_shipment_pix_paid_cancel_refund_queue
AFTER UPDATE OF status ON public.dependent_shipments
FOR EACH ROW
EXECUTE FUNCTION public.trg_shipment_pix_paid_cancel_refund_queue();
