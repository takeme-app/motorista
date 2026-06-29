ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS status_change_notified jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Idempotência por chave de transição (espelha shipments) + aviso de cancelamento
-- por admin/sistema/expiração (motivo != driver_ e != auto-cancel do passageiro),
-- que antes só era coberto pela camada genérica.
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
