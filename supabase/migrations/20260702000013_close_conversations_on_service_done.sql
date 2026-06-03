-- Fecha automaticamente a conversa (status -> 'closed') quando o serviço termina,
-- movendo-a de "Recentes" para "Finalizadas" nos apps. Confiável (SECURITY DEFINER,
-- à prova de RLS) e cobre os fluxos onde o app não fechava: excursão e corrida;
-- reforça o de encomenda.

-- 1) ENCOMENDA: encomenda entregue/cancelada -> fecha a conversa (shipment_id).
CREATE OR REPLACE FUNCTION public.close_conversation_on_shipment_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('delivered', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.conversations
       SET status = 'closed', updated_at = now()
     WHERE shipment_id = NEW.id
       AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_conversation_on_shipment_done ON public.shipments;
CREATE TRIGGER trg_close_conversation_on_shipment_done
  AFTER UPDATE OF status ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.close_conversation_on_shipment_done();

-- 2) EXCURSÃO: excursão concluída/cancelada -> fecha a conversa preparador<->cliente.
-- A conversa de excursão não tem vínculo de entidade (booking_id/shipment_id nulos),
-- então casamos por preparador (driver_id) + cliente (client_id).
CREATE OR REPLACE FUNCTION public.close_conversation_on_excursion_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.preparer_id IS NOT NULL THEN
    UPDATE public.conversations
       SET status = 'closed', updated_at = now()
     WHERE driver_id = NEW.preparer_id
       AND client_id = NEW.user_id
       AND booking_id IS NULL
       AND shipment_id IS NULL
       AND COALESCE(conversation_kind, 'driver_client') <> 'support_backoffice'
       AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_conversation_on_excursion_done ON public.excursion_requests;
CREATE TRIGGER trg_close_conversation_on_excursion_done
  AFTER UPDATE OF status ON public.excursion_requests
  FOR EACH ROW EXECUTE FUNCTION public.close_conversation_on_excursion_done();

-- 3) CORRIDA: viagem agendada concluída/cancelada -> fecha as conversas das reservas.
CREATE OR REPLACE FUNCTION public.close_conversations_on_trip_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.conversations c
       SET status = 'closed', updated_at = now()
      FROM public.bookings b
     WHERE b.scheduled_trip_id = NEW.id
       AND c.booking_id = b.id
       AND c.status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_conversations_on_trip_done ON public.scheduled_trips;
CREATE TRIGGER trg_close_conversations_on_trip_done
  AFTER UPDATE OF status ON public.scheduled_trips
  FOR EACH ROW EXECUTE FUNCTION public.close_conversations_on_trip_done();

-- Backfill: fecha conversas cujo serviço já está terminal (chats presos em "Recentes").
UPDATE public.conversations c SET status = 'closed', updated_at = now()
  FROM public.shipments s
 WHERE c.shipment_id = s.id
   AND s.status IN ('delivered', 'cancelled')
   AND c.status = 'active';

UPDATE public.conversations c SET status = 'closed', updated_at = now()
  FROM public.scheduled_trips t
  JOIN public.bookings b ON b.scheduled_trip_id = t.id
 WHERE c.booking_id = b.id
   AND t.status IN ('completed', 'cancelled')
   AND c.status = 'active';

UPDATE public.conversations c SET status = 'closed', updated_at = now()
  FROM public.excursion_requests e
 WHERE c.driver_id = e.preparer_id
   AND c.client_id = e.user_id
   AND c.booking_id IS NULL
   AND c.shipment_id IS NULL
   AND COALESCE(c.conversation_kind, 'driver_client') <> 'support_backoffice'
   AND e.status IN ('completed', 'cancelled')
   AND c.status = 'active';
