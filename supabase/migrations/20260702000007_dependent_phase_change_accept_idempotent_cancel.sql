ALTER TABLE public.dependent_shipments
  ADD COLUMN IF NOT EXISTS status_change_notified jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Cobre o ACEITE do dependente (antes só via genérico), torna idempotente e
-- adiciona aviso de cancelamento por admin/sistema/expiração.
CREATE OR REPLACE FUNCTION public.notify_client_dependent_shipment_phase_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_data jsonb;
  v_key text;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object('route', 'DependentShipmentDetail', 'params', jsonb_build_object('dependentShipmentId', NEW.id));

  -- Confirmado / aceito
  IF OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed' THEN
    v_key := 'client:confirmed';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'dependents') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Envio do seu dependente confirmado!',
          'O envio do seu dependente foi confirmado. Acompanhe pelo app.',
          'dependents', 'cliente', v_data);
      END IF;
      UPDATE public.dependent_shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
    v_key := 'client:in_progress';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'dependents') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Seu dependente está chegando ao destino', 'Acompanhe o trajeto do seu dependente em tempo real pelo app.', 'dependents', 'cliente', v_data);
      END IF;
      UPDATE public.dependent_shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
    v_key := 'client:delivered';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'dependents') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Dependente Chegou ao Destino!', 'Aee Parabéns! Seu dependente chegou ao destino com sucesso.', 'dependents', 'cliente', v_data);
      END IF;
      UPDATE public.dependent_shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada pelo motorista
  IF OLD.status IN ('pending_review', 'confirmed', 'in_progress')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
    v_key := 'client:cancelled_by_driver';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'dependents') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Motorista cancelou o envio do seu dependente',
          'O motorista cancelou este envio. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'dependents', 'cliente', v_data);
      END IF;
      UPDATE public.dependent_shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada por admin/sistema/expiração
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') NOT LIKE 'driver\_%' ESCAPE '\'
     AND COALESCE(NEW.cancellation_reason, '') <> 'passenger_cancellation' THEN
    v_key := 'client:cancelled';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'dependents') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Envio do seu dependente cancelado',
          'Este envio foi cancelado. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'dependents', 'cliente', v_data);
      END IF;
      UPDATE public.dependent_shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;
