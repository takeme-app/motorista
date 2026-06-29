-- Dedupe da notificação de "Envio cancelado": quando cancellation_reason = 'no_driver_accepted',
-- o cron `shipment_process_expired_driver_offers` já envia a mensagem específica ("nenhum/os
-- motoristas..."). O ramo genérico do phase-change também disparava ("Este envio foi cancelado..."),
-- gerando DUAS notificações para o cliente. Aqui o ramo genérico passa a ignorar 'no_driver_accepted'.
-- Idêntico à versão vigente; só adiciona a exclusão no último ramo.
CREATE OR REPLACE FUNCTION public.notify_client_shipment_phase_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        VALUES (v_user, 'Encomenda em andamento ao destino!', 'Sua encomenda foi coletada e está a caminho. Acompanhe no app.', 'shipments_deliveries', 'cliente',
          jsonb_build_object('route', 'ShipmentDetail', 'params', jsonb_build_object('shipmentId', NEW.id)));
      END IF;
      UPDATE public.shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
    v_key := 'client:delivered';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Encomenda chegou ao destino!', 'Sua encomenda foi entregue. Toque para ver os detalhes.', 'shipments_deliveries', 'cliente',
          jsonb_build_object('route', 'ShipmentDetail', 'params', jsonb_build_object('shipmentId', NEW.id)));
      END IF;
      UPDATE public.shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
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
        VALUES (v_user, 'Motorista cancelou sua encomenda',
          'O motorista cancelou este envio. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'shipments_deliveries', 'cliente',
          jsonb_build_object('route', 'ShipmentDetail', 'params', jsonb_build_object('shipmentId', NEW.id)));
      END IF;
      UPDATE public.shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
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
        VALUES (v_user, 'Envio cancelado', 'Sua encomenda foi cancelada com sucesso.', 'shipments_deliveries', 'cliente',
          jsonb_build_object('route', 'ShipmentDetail', 'params', jsonb_build_object('shipmentId', NEW.id)));
      END IF;
      UPDATE public.shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada por admin/sistema/expiração (não motorista, não auto-cancel do passageiro,
  -- e NÃO 'no_driver_accepted' — esse já tem notificação própria no cron, evitando duplicar).
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') NOT LIKE 'driver\_%' ESCAPE '\'
     AND COALESCE(NEW.cancellation_reason, '') <> 'passenger_cancellation'
     AND COALESCE(NEW.cancellation_reason, '') <> 'no_driver_accepted' THEN
    v_key := 'client:cancelled';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Envio cancelado',
          'Este envio foi cancelado. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
          'shipments_deliveries', 'cliente',
          jsonb_build_object('route', 'ShipmentDetail', 'params', jsonb_build_object('shipmentId', NEW.id)));
      END IF;
      UPDATE public.shipments SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;
