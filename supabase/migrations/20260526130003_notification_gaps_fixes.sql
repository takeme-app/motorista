-- =====================================================================
-- Cobre gaps de notificação identificados em auditoria 2026-05-26:
--   3.1) Payout failed                → notifica motorista
--   3.2) Shipment offer expired       → melhora deeplink/data da notif existente
--   3.3) Booking cancel by admin      → mensagem específica (em vez de genérico)
--   3.4) Excursão quoted/approved/scheduled → notifica cliente
-- =====================================================================


-- ---------------------------------------------------------------------
-- 3.1) Payout failed → motorista
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_payment_failed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount_brl text;
  v_reason text;
BEGIN
  IF NEW.worker_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Considera "falhou" quando:
  --   - status muda para 'failed' / 'cancelled'
  --   - OU stripe_transfer_error é preenchido (passa de NULL para NOT NULL)
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.stripe_transfer_error IS NOT DISTINCT FROM NEW.stripe_transfer_error THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('failed', 'cancelled')
     AND (
       OLD.stripe_transfer_error IS NOT NULL
       OR NEW.stripe_transfer_error IS NULL
     )
  THEN
    RETURN NEW;
  END IF;

  v_amount_brl := 'R$ ' || to_char((COALESCE(NEW.worker_amount_cents, 0)::numeric / 100.0), 'FM999G999G990D00');
  v_reason := COALESCE(
    NULLIF(BTRIM(NEW.stripe_transfer_error), ''),
    NULLIF(BTRIM(NEW.cancelled_reason), ''),
    'tentativa não concluída'
  );

  -- `payment_failed` não está mapeado em should_notify_user → cai no
  -- branch ELSE NULL e a função retorna TRUE (a menos que disable_all).
  -- Mantemos a chamada para respeitar disable_all.
  IF NOT public.should_notify_user(NEW.worker_id, 'payment_failed') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    NEW.worker_id,
    'Falha ao receber pagamento',
    format('O repasse de %s não foi concluído: %s. Verifique seus dados bancários ou entre em contato com o suporte.', v_amount_brl, v_reason),
    'payment_failed',
    'motorista',
    jsonb_build_object('route', 'PaymentHistory')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_driver_payment_failed ON public.payouts;
CREATE TRIGGER trg_notify_driver_payment_failed
  AFTER UPDATE ON public.payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_driver_payment_failed();

COMMENT ON FUNCTION public.notify_driver_payment_failed() IS
  'Notifica motorista quando payout falha (status failed/cancelled ou stripe_transfer_error setado).';


-- ---------------------------------------------------------------------
-- 3.2) Shipment offer expired sem motorista → melhora a notificação
--      existente em shipment_process_expired_driver_offers para incluir
--      target_app_slug explícito, data deeplink e respeitar preferências.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shipment_process_expired_driver_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec record;
  q uuid[];
  idx int;
  n int;
  processed int := 0;
  uid uuid;
BEGIN
  FOR rec IN
    SELECT id, user_id, driver_offer_queue, driver_offer_index, current_offer_expires_at
    FROM public.shipments
    WHERE driver_id IS NULL
      AND status IN ('pending_review', 'confirmed')
      AND driver_offer_index >= 0
      AND current_offer_expires_at IS NOT NULL
      AND current_offer_expires_at <= now()
    LIMIT 30
    FOR UPDATE SKIP LOCKED
  LOOP
    q := coalesce(rec.driver_offer_queue, '{}');
    idx := rec.driver_offer_index;
    n := coalesce(array_length(q, 1), 0);
    uid := rec.user_id;
    processed := processed + 1;

    IF idx + 1 < n THEN
      UPDATE public.shipments
      SET
        driver_offer_index = idx + 1,
        current_offer_driver_id = q[idx + 2],
        current_offer_expires_at = now() + interval '30 minutes'
      WHERE id = rec.id;
    ELSE
      UPDATE public.shipments
      SET
        status = 'cancelled',
        cancellation_reason = 'no_driver_accepted',
        current_offer_driver_id = NULL,
        current_offer_expires_at = NULL,
        driver_offer_index = -1
      WHERE id = rec.id;

      IF uid IS NOT NULL AND public.should_notify_user(uid, 'shipments_deliveries') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (
          uid,
          'Envio cancelado',
          'Nenhum motorista aceitou o envio a tempo. O pedido foi cancelado. Se houve cobrança no cartão, abra o app para solicitar estorno ou contacte o suporte.',
          'shipments_deliveries',
          'cliente',
          jsonb_build_object(
            'route', 'ShipmentDetail',
            'params', jsonb_build_object('shipmentId', rec.id)
          )
        );
      END IF;
    END IF;
  END LOOP;

  RETURN processed;
END;
$function$;


-- ---------------------------------------------------------------------
-- 3.3) Booking cancel by admin → mensagem específica.
--      Estende notify_driver_activity_status_changed para diferenciar
--      cancelamentos por admin (cancellation_reason LIKE 'admin\_%').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_activity_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_driver uuid;
  v_trip_id uuid;
  v_entity_label text;
  v_title text;
  v_message text;
  v_category text;
  v_data jsonb;
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

  -- Cancelamento por admin → mensagem específica.
  IF TG_TABLE_NAME = 'bookings'
     AND OLD.status IN ('paid', 'confirmed')
     AND NEW.status = 'cancelled'
     AND NEW.cancellation_reason LIKE 'admin\_%' ESCAPE '\' THEN
    v_title := 'Reserva cancelada pelo suporte';
    v_message := 'Uma reserva da sua viagem foi cancelada pela equipe Take Me. Toque para ver detalhes.';
    v_category := 'booking_cancelled_by_admin';
    v_data := jsonb_build_object('route', 'TripDetail', 'params', jsonb_build_object('tripId', v_trip_id));
    IF public.should_notify_user(v_driver, v_category) THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_driver, v_title, v_message, v_category, 'motorista', v_data);
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelamento pelo passageiro (exclui driver/system/admin).
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
    v_data := jsonb_build_object('route', 'TripDetail', 'params', jsonb_build_object('tripId', v_trip_id));
    IF public.should_notify_user(v_driver, v_category) THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_driver, v_title, v_message, v_category, 'motorista', v_data);
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF TG_TABLE_NAME = 'bookings' AND OLD.status = 'pending' AND NEW.status IN ('paid', 'confirmed') THEN
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
  END IF;

  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------
-- 3.4) Excursão quoted/approved/scheduled → cliente.
--      Estende notify_client_excursion_phase_change (criado em
--      20260526130000) para cobrir as transições intermediárias.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_client_excursion_phase_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_data jsonb;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object(
    'route', 'ExcursionDetail',
    'params', jsonb_build_object('excursionRequestId', NEW.id)
  );

  -- Check-in de ida.
  IF NEW.check_in_ida_started_at IS NOT NULL
     AND OLD.check_in_ida_started_at IS DISTINCT FROM NEW.check_in_ida_started_at
     AND OLD.check_in_ida_started_at IS NULL THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_user, 'Sua Excursão está em fase de check in de ida.', 'Abra o app para conferir o embarque da sua excursão.', 'excursions', 'cliente', v_data);
    END IF;
  END IF;

  -- Check-in de volta.
  IF NEW.check_in_volta_started_at IS NOT NULL
     AND OLD.check_in_volta_started_at IS DISTINCT FROM NEW.check_in_volta_started_at
     AND OLD.check_in_volta_started_at IS NULL THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_user, 'Sua Excursão está em fase de check in de volta.', 'Abra o app para conferir o embarque de volta da sua excursão.', 'excursions', 'cliente', v_data);
    END IF;
  END IF;

  -- Novas transições de status (3.4).
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'quoted' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Orçamento da sua excursão pronto', 'Recebemos o orçamento da sua excursão. Toque para revisar e aprovar.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'approved' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Excursão aprovada', 'Sua excursão foi aprovada e está aguardando confirmação operacional.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'scheduled' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Excursão agendada', 'Sua excursão foi agendada pela operação Take Me. Estamos prontos para o embarque!', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'in_progress' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Sua excursão está em andamento', 'Acompanhe sua excursão em tempo real pelo app.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'completed' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Sua excursão finalizou.', 'Esperamos que você tenha aproveitado! Toque para ver os detalhes.', 'excursions', 'cliente', v_data);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 3.4-bis) Atualiza notify_client_activity_status_changed para suprimir
--          também os novos status cobertos acima.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_client_activity_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_entity_label text;
  v_category text;
  v_route text;
  v_params jsonb;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'bookings' THEN
    v_user := NEW.user_id;
    v_entity_label := 'viagem';
    v_category := 'travel_updates';
    v_route := 'TripDetail';
    v_params := jsonb_build_object('bookingId', NEW.id);

    IF OLD.status = 'pending' AND NEW.status IN ('paid', 'confirmed') THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'paid' AND NEW.status = 'confirmed' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'shipments' THEN
    v_user := NEW.user_id;
    v_entity_label := 'encomenda';
    v_category := 'shipments_deliveries';
    v_route := 'ShipmentDetail';
    v_params := jsonb_build_object('shipmentId', NEW.id);

    IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'dependent_shipments' THEN
    v_user := NEW.user_id;
    v_entity_label := 'dependente';
    v_category := 'dependents';
    v_route := 'DependentShipmentDetail';
    v_params := jsonb_build_object('dependentShipmentId', NEW.id);

    IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'excursion_requests' THEN
    v_user := NEW.user_id;
    v_entity_label := 'excursão';
    v_category := 'excursions';
    v_route := 'ExcursionDetail';
    v_params := jsonb_build_object('excursionRequestId', NEW.id);

    -- Todas as transições "interessantes" são cobertas por notify_client_excursion_phase_change.
    IF NEW.status IN ('quoted', 'approved', 'scheduled', 'in_progress', 'completed') THEN
      RETURN NEW;
    END IF;

  ELSE
    RETURN NEW;
  END IF;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.should_notify_user(v_user, v_category) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    v_user,
    format('Sua atividade de %s mudou de status', v_entity_label),
    format('Sua %s tem uma nova atualização, clique e verifique.', v_entity_label),
    v_category,
    'cliente',
    jsonb_build_object('route', v_route, 'params', v_params)
  );

  RETURN NEW;
END;
$$;
