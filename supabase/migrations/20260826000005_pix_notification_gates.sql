-- Pix real — Fase 0/F: gates de notificação para o fluxo Pix real.
--
--   1) notify_driver_new_booking_request: early-return quando o booking entra
--      'pending' aguardando pagamento Pix real (payment_method='pix' AND
--      pix_charge_id IS NOT NULL). Cartão insere 'paid', dinheiro e Pix
--      paliativo inserem 'pending' SEM pix_charge_id — seguem IDÊNTICOS.
--   2) Novo trigger: notifica o motorista NA CONFIRMAÇÃO do Pix real
--      (pending→paid com pix_charge_id) — mesmo texto literal da solicitação.
--   3) notify_driver_activity_status_changed: early-return para cancelamentos
--      técnicos do fluxo Pix ('pix_expired', 'pix_create_failed') — expiração
--      de cobrança não notifica NINGUÉM. Os triggers genéricos do CLIENTE já
--      foram removidos (migration 20260702000010) e o específico
--      notify_client_booking_phase_change só notifica cancelamento com reason
--      'driver_%' — nada a gatear do lado do cliente.
--
-- Reescreve as funções POR COMPLETO a partir das versões vigentes
-- (notify_driver_new_booking_request: 20260527100000;
--  notify_driver_activity_status_changed: 20260702000014), preservando o
-- comportamento atual para cartão/dinheiro/paliativo. Enquanto nenhuma linha
-- tem pix_charge_id (fase 0), o comportamento é byte a byte o mesmo.

-- =====================================================================
-- 1) Motorista — "nova solicitação de viagem" (gate do Pix real no INSERT)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_driver_new_booking_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  drv uuid;
BEGIN
  IF NEW.status IS NULL OR NEW.status NOT IN ('pending', 'paid') THEN
    RETURN NEW;
  END IF;

  -- Pix real: booking entra 'pending' só segurando a vaga enquanto o cliente
  -- paga o QR. Não notificar na criação — a notificação sai na confirmação
  -- (trigger trg_notify_driver_pix_booking_paid abaixo).
  IF NEW.payment_method = 'pix' AND NEW.status = 'pending' AND NEW.pix_charge_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT st.driver_id
  INTO drv
  FROM public.scheduled_trips st
  WHERE st.id = NEW.scheduled_trip_id;

  IF drv IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.should_notify_user(drv, 'travel_updates') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    drv,
    'Você recebeu uma nova Solicitação de Viagem!',
    'Clique para visualizar a solicitação.',
    'travel_updates',
    'motorista',
    jsonb_build_object('route', 'PendingRequests')
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_driver_new_booking_request() IS
  'Após INSERT em bookings (pending/paid), notifica o motorista — exceto Pix real pendente (notifica na confirmação).';

-- =====================================================================
-- 2) Motorista — Pix real confirmado (pending→paid com pix_charge_id)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_driver_pix_booking_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  drv uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;
  END IF;

  IF NEW.pix_charge_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT st.driver_id
  INTO drv
  FROM public.scheduled_trips st
  WHERE st.id = NEW.scheduled_trip_id;

  IF drv IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.should_notify_user(drv, 'travel_updates') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    drv,
    'Você recebeu uma nova Solicitação de Viagem!',
    'Clique para visualizar a solicitação.',
    'travel_updates',
    'motorista',
    jsonb_build_object('route', 'PendingRequests')
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_driver_pix_booking_paid() IS
  'Pix real: notifica o motorista quando o booking é promovido pending→paid pela confirmação do pagamento.';

DROP TRIGGER IF EXISTS trg_notify_driver_pix_booking_paid ON public.bookings;
CREATE TRIGGER trg_notify_driver_pix_booking_paid
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (NEW.pix_charge_id IS NOT NULL)
  EXECUTE FUNCTION public.notify_driver_pix_booking_paid();

-- =====================================================================
-- 3) Motorista — genérico "atividade mudou de status" (gate pix_expired /
--    pix_create_failed). Corpo idêntico à versão 20260702000014, com o gate
--    logo após resolver v_driver.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_driver_activity_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver uuid;
  v_trip_id uuid;
  v_entity_label text;
  v_title text;
  v_message text;
  v_category text;
  v_data jsonb;
  v_key text;
BEGIN
  IF TG_TABLE_NAME = 'shipments' THEN
    v_entity_label := 'encomenda';
    v_trip_id := NEW.scheduled_trip_id;
    IF NEW.driver_id IS NOT NULL THEN
      v_driver := NEW.driver_id;
    ELSIF v_trip_id IS NOT NULL THEN
      SELECT st.driver_id INTO v_driver FROM public.scheduled_trips st WHERE st.id = v_trip_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'bookings' THEN
    v_entity_label := 'reserva';
    v_trip_id := NEW.scheduled_trip_id;
    IF v_trip_id IS NOT NULL THEN
      SELECT st.driver_id INTO v_driver FROM public.scheduled_trips st WHERE st.id = v_trip_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'dependent_shipments' THEN
    v_entity_label := 'dependente';
    v_trip_id := NEW.scheduled_trip_id;
    IF v_trip_id IS NOT NULL THEN
      SELECT st.driver_id INTO v_driver FROM public.scheduled_trips st WHERE st.id = v_trip_id;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_driver IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pix real: cancelamento técnico (cobrança expirou sem pagamento ou o create
  -- no provedor falhou). O pedido nunca foi "de verdade" para o motorista —
  -- zero notificação (para o cliente também não há trigger que dispare aqui).
  IF NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') IN ('pix_expired', 'pix_create_failed') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'bookings'
     AND OLD.status IN ('paid', 'confirmed')
     AND NEW.status = 'cancelled'
     AND (
       NEW.cancellation_reason IS NULL
       OR NEW.cancellation_reason NOT LIKE 'driver\_%' ESCAPE '\'
       AND NEW.cancellation_reason NOT LIKE 'system\_%' ESCAPE '\'
       AND NEW.cancellation_reason NOT LIKE 'admin\_%' ESCAPE '\'
     ) THEN
    v_title := 'Um passageiro cancelou a viagem';
    v_message := 'Uma reserva confirmada da sua viagem foi cancelada pelo passageiro. Os próximos passos (estorno/reenvio) seguem automáticos.';
    v_category := 'booking_cancelled_by_passenger';
    v_data := jsonb_build_object(
      'route', 'TripDetail',
      'params', jsonb_build_object('tripId', v_trip_id)
    );
    IF public.should_notify_user(v_driver, v_category) THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_driver, v_title, v_message, v_category, 'motorista', v_data);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'shipments'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND NEW.cancellation_reason = 'passenger_cancellation' THEN
    v_key := v_driver::text || ':cancelled_by_passenger';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      v_title := 'Passageiro cancelou a encomenda';
      v_message := 'Uma encomenda da sua viagem foi cancelada pelo passageiro. Os próximos passos seguem automáticos.';
      v_category := 'shipment_cancelled_by_passenger';
      v_data := jsonb_build_object(
        'route', 'ActiveTrip',
        'params', CASE
          WHEN v_trip_id IS NOT NULL THEN jsonb_build_object('tripId', v_trip_id)
          ELSE '{}'::jsonb
        END,
        'shipment_id', NEW.id
      );
      IF public.should_notify_user(v_driver, v_category) THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_driver, v_title, v_message, v_category, 'motorista', v_data);
      END IF;
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF TG_TABLE_NAME = 'bookings' THEN
      IF OLD.status = 'pending' AND NEW.status IN ('paid', 'confirmed') THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'paid' AND NEW.status = 'confirmed' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
        RETURN NEW;
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'shipments' THEN
      IF OLD.status = 'pending_review' AND NEW.status = 'confirmed' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
        RETURN NEW;
      END IF;
    END IF;

    IF TG_TABLE_NAME = 'dependent_shipments' THEN
      IF OLD.status = 'pending_review' AND NEW.status = 'confirmed' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Idempotência por (motorista, status) para TODAS as tabelas (antes só shipments).
    v_key := v_driver::text || ':' || COALESCE(NEW.status, 'unknown');
    IF COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key THEN
      RETURN NEW;
    END IF;

    v_title := format('Sua atividade (%s) mudou de status', v_entity_label);
    v_message := format('Novo status: %s. Toque para ver detalhes.', coalesce(NEW.status, 'desconhecido'));
    v_category := 'activity_status_changed';
    v_data := CASE
      WHEN v_trip_id IS NOT NULL THEN jsonb_build_object('route', 'TripDetail', 'params', jsonb_build_object('tripId', v_trip_id))
      ELSE NULL
    END;
    IF public.should_notify_user(v_driver, v_category) THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_driver, v_title, v_message, v_category, 'motorista', v_data);
    END IF;

    -- Marca a chave na tabela correspondente (não re-dispara: AFTER UPDATE OF status).
    IF TG_TABLE_NAME = 'shipments' THEN
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    ELSIF TG_TABLE_NAME = 'bookings' THEN
      UPDATE public.bookings
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    ELSIF TG_TABLE_NAME = 'dependent_shipments' THEN
      UPDATE public.dependent_shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.notify_driver_activity_status_changed() IS
  'Genérico do motorista (idempotente por status_change_notified). Cancelamentos técnicos do Pix real (pix_expired/pix_create_failed) não notificam.';
