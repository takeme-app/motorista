-- Idempotência do genérico do motorista para bookings e dependent_shipments
-- (shipments já tinha). Evita renotificar o mesmo (motorista,status) num UPDATE
-- repetido. Reusa a coluna jsonb status_change_notified (presente nas 3 tabelas).
-- O UPDATE de status_change_notified NÃO re-dispara o trigger (AFTER UPDATE OF status).
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
