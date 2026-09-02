-- Estende a fila de devolução do Pix real à excursão.
--
-- As três tabelas não têm as mesmas colunas: excursion_requests não tem
-- cancellation_reason nem amount_cents (o valor mora em total_amount_cents).
-- Referenciar coluna inexistente em plpgsql estoura em tempo de execução — e o
-- EXCEPTION do gatilho engoliria o erro, deixando o dinheiro sem pendência em
-- silêncio, que é exatamente o que este gatilho existe para evitar.
--
-- Por isso a leitura passa a ser por to_jsonb(NEW): campo ausente vira NULL em
-- vez de erro. O valor vem da própria cobrança (fonte da verdade do que entrou).

CREATE OR REPLACE FUNCTION public.trg_shipment_pix_paid_cancel_refund_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new jsonb;
  v_cancel_reason text;
  v_reason text;
  v_amount int;
  v_entity_type text;
  v_label text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.status = 'cancelled' THEN RETURN NEW; END IF;

  -- Só Pix REAL liquidado. Paliativo não tem pix_charge_id e não movimentou
  -- dinheiro rastreável; cartão tem o caminho de estorno automático do Stripe.
  IF NEW.pix_charge_id IS NULL OR NEW.pix_paid_at IS NULL THEN RETURN NEW; END IF;

  SELECT t.entity_type, t.label INTO v_entity_type, v_label
  FROM (VALUES
    ('shipments', 'shipment', 'encomenda'),
    ('dependent_shipments', 'dependent_shipment', 'envio de dependente'),
    ('excursion_requests', 'excursion', 'excursão')
  ) AS t(tbl, entity_type, label)
  WHERE t.tbl = TG_TABLE_NAME;
  IF v_entity_type IS NULL THEN RETURN NEW; END IF;

  v_new := to_jsonb(NEW);
  v_cancel_reason := v_new->>'cancellation_reason';

  v_reason := CASE
    WHEN coalesce(v_cancel_reason, '') = 'no_driver_accepted' THEN 'expired_not_realized'
    WHEN v_cancel_reason ILIKE 'driver%' THEN 'driver_cancelled'
    WHEN v_cancel_reason ILIKE 'admin%' THEN 'admin_cancelled'
    WHEN v_cancel_reason ILIKE 'user%'
      OR v_cancel_reason ILIKE 'client%' THEN 'user_cancelled_in_window'
    ELSE 'expired_not_realized'
  END;

  -- Valor de verdade é o que entrou na cobrança, não o total do pedido (que
  -- pode trazer desconto promocional não cobrado).
  SELECT coalesce(pc.paid_amount_cents, pc.expected_amount_cents)
    INTO v_amount
    FROM public.pix_charges pc
   WHERE pc.id = NEW.pix_charge_id;
  v_amount := greatest(coalesce(v_amount, 0), 0);

  -- Idempotência: uma pendência aberta por cobrança já basta.
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
     format('%s cancelada(o) após pagamento Pix (motivo: %s)',
            v_label, coalesce(v_cancel_reason, 'não informado')));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca derrubar o cancelamento por causa da fila de devolução.
  RAISE WARNING '[trg_shipment_pix_paid_cancel_refund_queue] ignorado: %', SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_excursion_pix_paid_cancel_refund_queue ON public.excursion_requests;

CREATE TRIGGER on_excursion_pix_paid_cancel_refund_queue
AFTER UPDATE OF status ON public.excursion_requests
FOR EACH ROW
EXECUTE FUNCTION public.trg_shipment_pix_paid_cancel_refund_queue();
