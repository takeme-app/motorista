-- O gatilho de abertura da fila de motoristas para encomendas escutava só
-- (status, stripe_payment_intent_id, client_preferred_driver_id, base_id,
--  driver_offer_index, admin_approved_at).
--
-- O corpo da função já reavalia em OLD.pix_paid_at IS DISTINCT FROM NEW.pix_paid_at
-- (migration 20260831180000), mas o UPDATE que liquida o Pix toca APENAS pix_paid_at
-- e, sem a coluna na lista do CREATE TRIGGER, o gatilho nem chegava a rodar:
-- a encomenda ficava paga e nunca era ofertada a nenhum motorista.
--
-- Só a definição do gatilho muda; a função fica como está.
DROP TRIGGER IF EXISTS on_shipment_auto_open_driver_offer_queue ON public.shipments;

CREATE TRIGGER on_shipment_auto_open_driver_offer_queue
AFTER INSERT OR UPDATE OF
  status,
  stripe_payment_intent_id,
  client_preferred_driver_id,
  base_id,
  driver_offer_index,
  admin_approved_at,
  pix_paid_at
ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.trg_shipment_auto_open_driver_offer_queue();
