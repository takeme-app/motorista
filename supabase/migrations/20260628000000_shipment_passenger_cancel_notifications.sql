-- =====================================================================
-- Cancelar encomenda pelo cliente (cancellation_reason = 'passenger_cancellation')
-- precisa notificar ambos os lados, espelhando o que `cancel-booking` faz
-- para viagens (bookings):
--
--   - Motorista: "Passageiro cancelou a encomenda" (push categoria
--     shipment_cancelled_by_passenger).
--   - Cliente:   "Envio cancelado" (push categoria shipments_deliveries).
--
-- Hoje (antes desta migration), o app cliente faz UPDATE direto
-- `status='cancelled'` sem setar cancellation_reason, então:
--   - `notify_driver_activity_status_changed` cai no Caso 2 ("Sua atividade
--     mudou de status") → mensagem genérica.
--   - `notify_client_shipment_phase_change` ignora cancelamento; cai em
--     `notify_client_activity_status_changed` → mensagem genérica.
--
-- A edge function `cancel-shipment` (criada junto com esta migration) passa
-- a setar cancellation_reason='passenger_cancellation', e estes triggers
-- traduzem isso em mensagens claras para cada destinatário.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) notify_driver_activity_status_changed — estende o "Caso 1" (hoje
--    exclusivo de bookings) para também cobrir shipments cancelados pelo
--    passageiro. Mantém o restante da função intacto.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_activity_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Caso 1a: passageiro cancelou a viagem (bookings).
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

  -- Caso 1b: passageiro cancelou a encomenda (shipments). Espelha 1a.
  -- Dispara em qualquer status pré-cancelamento (pending_review, confirmed,
  -- in_progress), desde que cancellation_reason='passenger_cancellation'.
  IF TG_TABLE_NAME = 'shipments'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND NEW.cancellation_reason = 'passenger_cancellation' THEN
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

    RETURN NEW;
  END IF;

  -- Caso 2: Qualquer outra mudança de status vira "atividade mudou de status"
  -- (exceto pending -> paid/confirmed de bookings, coberto por outro trigger).
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF TG_TABLE_NAME = 'bookings'
       AND OLD.status = 'pending'
       AND NEW.status IN ('paid', 'confirmed') THEN
      RETURN NEW;
    END IF;

    v_title := format('Sua atividade (%s) mudou de status', v_entity_label);
    v_message := format(
      'Novo status: %s. Toque para ver detalhes.',
      coalesce(NEW.status, 'desconhecido')
    );
    v_category := 'activity_status_changed';
    v_data := CASE
      WHEN v_trip_id IS NOT NULL THEN jsonb_build_object(
        'route', 'TripDetail',
        'params', jsonb_build_object('tripId', v_trip_id)
      )
      ELSE NULL
    END;

    IF public.should_notify_user(v_driver, v_category) THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_driver, v_title, v_message, v_category, 'motorista', v_data);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 2) notify_client_shipment_phase_change — adiciona branch
--    passenger_cancellation (cliente confirma que o cancelamento foi
--    registrado). O cancelamento pelo motorista (driver_%) continua
--    coberto pelo branch existente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_client_shipment_phase_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
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
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
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
    RETURN NEW;
  END IF;

  -- Cancelamento pelo motorista (cascata do cancel-scheduled-trip ou direto).
  IF OLD.status IN ('pending_review', 'confirmed', 'in_progress')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
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
    RETURN NEW;
  END IF;

  -- Cancelamento pelo próprio passageiro (via app/edge function cancel-shipment).
  -- Confirma a ação na inbox do cliente; o estorno é orquestrado por outro fluxo.
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND NEW.cancellation_reason = 'passenger_cancellation' THEN
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
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 3) notify_client_activity_status_changed — suprime o ramo genérico de
--    shipments quando o cancelamento for por passenger_cancellation
--    (evita duplicar com o branch específico acima).
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

    IF OLD.status IN ('pending', 'paid') AND NEW.status = 'confirmed' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'pending' AND NEW.status = 'paid' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'cancelled' AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
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
    IF NEW.status = 'cancelled' AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
      RETURN NEW;
    END IF;
    -- Suprime ramo genérico em cancelamento por passageiro
    -- (notify_client_shipment_phase_change cobre).
    IF NEW.status = 'cancelled' AND NEW.cancellation_reason = 'passenger_cancellation' THEN
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
    IF NEW.status = 'cancelled' AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'excursion_requests' THEN
    v_user := NEW.user_id;
    v_entity_label := 'excursão';
    v_category := 'excursions';
    v_route := 'ExcursionDetail';
    v_params := jsonb_build_object('excursionRequestId', NEW.id);

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


COMMENT ON FUNCTION public.notify_driver_activity_status_changed() IS
  'Motorista: notifica passageiro-cancelou em bookings (Caso 1a) e shipments (Caso 1b, cancellation_reason=passenger_cancellation); fallback genérico nos demais updates.';
COMMENT ON FUNCTION public.notify_client_shipment_phase_change() IS
  'Cliente: pickup (confirmed→in_progress), entrega (in_progress→delivered), cancelamento pelo motorista (driver_%) e confirmação do próprio cancelamento (passenger_cancellation).';
