-- Encomenda Pix REAL paga e depois cancelada: enfileira devolução manual.
--
-- No cartão o app chama refund-shipment-no-driver quando a fila não acha
-- motorista. No Pix real o fluxo é todo servidor — o cliente paga, o webhook
-- marca pix_paid_at, o gatilho abre a fila e, se não houver motorista na rota,
-- shipment_open_driver_offer_queue_internal cancela a encomenda ali mesmo.
-- Nesse caminho ninguém registrava nada: o dinheiro ficava com a Take Me sem
-- pendência nenhuma no painel.
--
-- Em vez de remendar cada função de cancelamento (cancel-shipment,
-- driver-cancel-pickup, cancelamento em cascata de viagem agendada, a própria
-- abertura de fila), um único gatilho cobre TODOS os caminhos: qualquer
-- transição para 'cancelled' de encomenda com Pix liquidado vira pendência.
--
-- Não move dinheiro — a devolução continua manual no painel do Asaas, como o
-- resto da fila. Idempotente: não duplica pendência aberta da mesma cobrança.

CREATE OR REPLACE FUNCTION public.trg_shipment_pix_paid_cancel_refund_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
  v_amount int;
BEGIN
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.status = 'cancelled' THEN RETURN NEW; END IF;

  -- Só Pix REAL liquidado. Paliativo não tem pix_charge_id e não movimentou
  -- dinheiro rastreável; cartão tem o caminho de estorno automático do Stripe.
  IF NEW.pix_charge_id IS NULL OR NEW.pix_paid_at IS NULL THEN RETURN NEW; END IF;

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

  -- Idempotência: uma pendência aberta por cobrança já basta (o gatilho pode
  -- rodar de novo em recancelamentos/reprocessos).
  IF EXISTS (
    SELECT 1 FROM public.pix_refunds_pending r
     WHERE r.pix_charge_id = NEW.pix_charge_id AND r.status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pix_refunds_pending
    (pix_charge_id, entity_type, entity_id, user_id, amount_cents, reason, notes)
  VALUES
    (NEW.pix_charge_id, 'shipment', NEW.id, NEW.user_id, v_amount, v_reason,
     format('encomenda cancelada após pagamento Pix (motivo: %s)',
            coalesce(NEW.cancellation_reason, 'não informado')));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca derrubar o cancelamento por causa da fila de devolução.
  RAISE WARNING '[trg_shipment_pix_paid_cancel_refund_queue] ignorado: %', SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_shipment_pix_paid_cancel_refund_queue ON public.shipments;

CREATE TRIGGER on_shipment_pix_paid_cancel_refund_queue
AFTER UPDATE OF status ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.trg_shipment_pix_paid_cancel_refund_queue();
