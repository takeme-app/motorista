-- Gate do lado do CLIENTE para cancelamentos técnicos de Pix real.
--
-- A migration 20260826000005 gateou as notificações do MOTORISTA, mas o
-- cabeçalho dela afirmava (errado) que nada precisava ser gateado do lado do
-- cliente. A versão vigente de notify_client_booking_phase_change
-- (20260702000006) tem um branch genérico de cancelamento (motivo != driver_%
-- e != passenger_cancellation) que notificaria o cliente com "Sua viagem foi
-- cancelada ... o estorno é automático no cartão" toda vez que uma cobrança
-- Pix expirasse ('pix_expired', cron expire-pix-charges) ou falhasse na
-- criação ('pix_create_failed') — por um pagamento que nunca aconteceu.
--
-- Reescrita COMPLETA da versão vigente (20260702000006), única mudança: o
-- early-return para cancelamentos técnicos de Pix logo no início. A expiração
-- de cobrança Pix não notifica NINGUÉM — nem motorista (20260826000005) nem
-- cliente (aqui): do ponto de vista do usuário, ele só não pagou um QR.

CREATE OR REPLACE FUNCTION public.notify_client_booking_phase_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_key text;
  v_data jsonb;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cancelamento técnico de Pix real (QR expirou sem pagamento / provedor
  -- indisponível na criação): silêncio total — não houve pagamento, não há
  -- estorno, e o texto genérico abaixo fala em "estorno automático no cartão".
  IF NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') IN ('pix_expired', 'pix_create_failed') THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object('route', 'TripDetail', 'params', jsonb_build_object('bookingId', NEW.id));

  -- Aceite
  IF OLD.status IN ('pending', 'paid') AND NEW.status = 'confirmed' THEN
    v_key := 'client:accepted';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Motorista aceitou sua viagem!',
          'O motorista confirmou a viagem. Acompanhe os detalhes pelo app.',
          'travel_updates', 'cliente', v_data);
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Concluída
  IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
    v_key := 'client:completed';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Você chegou ao destino.',
          'Viagem concluída. Toque para avaliar sua corrida.',
          'travel_updates', 'cliente',
          jsonb_build_object('route', 'RateTrip', 'params', jsonb_build_object('bookingId', NEW.id)));
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada pelo motorista
  IF OLD.status IN ('pending', 'paid', 'confirmed')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
    v_key := 'client:cancelled_by_driver';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Motorista cancelou sua viagem',
          'O motorista cancelou esta viagem. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'travel_updates', 'cliente', v_data);
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada por admin/sistema/expiração (não motorista, não auto-cancel do passageiro)
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') NOT LIKE 'driver\_%' ESCAPE '\'
     AND COALESCE(NEW.cancellation_reason, '') <> 'passenger_cancellation' THEN
    v_key := 'client:cancelled';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Sua viagem foi cancelada',
          'Sua viagem foi cancelada. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'travel_updates', 'cliente', v_data);
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.notify_client_booking_phase_change() IS
  'Notificações do cliente por transição de status do booking (idempotente via status_change_notified). Cancelamentos técnicos de Pix real (pix_expired/pix_create_failed) não notificam.';
