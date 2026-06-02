-- A função `notify_client_shipment_phase_change` disparava push múltiplas vezes
-- ("Encomenda chegou ao destino!" aparecia 2-3x). A migration anterior
-- (20260629000000) adicionou `shipments.status_change_notified` JSONB e protegeu
-- a função do motorista, mas esqueceu de proteger essa do cliente.
--
-- Reescreve a função usando o mesmo padrão: chave "client:<status>" no JSONB
-- garante que cada transição é notificada apenas uma vez.

CREATE OR REPLACE FUNCTION public.notify_client_shipment_phase_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_key text;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
    v_key := 'client:in_progress';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (
          v_user,
          'Encomenda em andamento ao destino!',
          'Sua encomenda foi coletada e está a caminho. Acompanhe no app.',
          'shipments_deliveries',
          'cliente',
          jsonb_build_object(
            'route', 'ShipmentDetail',
            'params', jsonb_build_object('shipmentId', NEW.id)
          )
        );
      END IF;
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
    v_key := 'client:delivered';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (
          v_user,
          'Encomenda chegou ao destino!',
          'Sua encomenda foi entregue. Toque para ver os detalhes.',
          'shipments_deliveries',
          'cliente',
          jsonb_build_object(
            'route', 'ShipmentDetail',
            'params', jsonb_build_object('shipmentId', NEW.id)
          )
        );
      END IF;
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('pending_review', 'confirmed', 'in_progress')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
    v_key := 'client:cancelled_by_driver';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (
          v_user,
          'Motorista cancelou sua encomenda',
          'O motorista cancelou este envio. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'shipments_deliveries',
          'cliente',
          jsonb_build_object(
            'route', 'ShipmentDetail',
            'params', jsonb_build_object('shipmentId', NEW.id)
          )
        );
      END IF;
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND NEW.cancellation_reason = 'passenger_cancellation' THEN
    v_key := 'client:cancelled_by_passenger';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (
          v_user,
          'Envio cancelado',
          'Sua encomenda foi cancelada com sucesso.',
          'shipments_deliveries',
          'cliente',
          jsonb_build_object(
            'route', 'ShipmentDetail',
            'params', jsonb_build_object('shipmentId', NEW.id)
          )
        );
      END IF;
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
