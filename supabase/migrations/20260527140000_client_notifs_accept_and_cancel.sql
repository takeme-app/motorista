-- =====================================================================
-- Cobre gaps de notificação para o cliente:
--
--   1) Motorista aceita BOOKING (transição pending|paid → confirmed):
--      antes a mensagem era "Sua viagem está em andamento" (confuso —
--      o motorista ainda não iniciou). Substitui por "Motorista aceitou
--      sua viagem!" e adiciona também o branch pending→confirmed
--      (caso de booking não-pago que motorista aceita).
--
--   2) Motorista aceita SHIPMENT (driver_id NULL → NOT NULL via
--      `shipment_driver_accept_offer`): hoje só seta a coluna driver_id
--      sem mudar status, então nenhum trigger de fase dispara. Cria
--      `notify_client_shipment_driver_accepted` para notificar o cliente.
--
--   3) Motorista cancela BOOKING (status → cancelled, cancellation_reason
--      LIKE 'driver_%'): hoje cai no genérico "atividade mudou de status".
--      Passa a emitir "Motorista cancelou sua viagem".
--
--   4) Motorista cancela SHIPMENT (status → cancelled, cancellation_reason
--      LIKE 'driver_%'): idem — "Motorista cancelou sua encomenda".
--
--   5) Atualiza `notify_client_activity_status_changed` para suprimir as
--      transições agora cobertas pelos triggers específicos acima.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) notify_client_booking_phase_change
--    - pending|paid → confirmed → "Motorista aceitou sua viagem"
--    - confirmed → paid → "Você chegou ao destino" (mantém)
--    - confirmed|paid → cancelled (by driver) → "Motorista cancelou sua viagem"
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_client_booking_phase_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_trip uuid;
  v_reason text;
BEGIN
  v_user := NEW.user_id;
  v_trip := NEW.scheduled_trip_id;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- Motorista aceitou a viagem (pending|paid → confirmed).
  IF OLD.status IN ('pending', 'paid') AND NEW.status = 'confirmed' THEN
    IF public.should_notify_user(v_user, 'travel_updates') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Motorista aceitou sua viagem!',
        'O motorista confirmou a viagem. Acompanhe os detalhes pelo app.',
        'travel_updates',
        'cliente',
        jsonb_build_object(
          'route', 'TripDetail',
          'params', jsonb_build_object('bookingId', NEW.id)
        )
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Desembarque (confirmed → paid) — passageiro chegou ao destino.
  IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
    IF public.should_notify_user(v_user, 'travel_updates') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Você chegou ao destino.',
        'Viagem concluída. Toque para avaliar sua corrida.',
        'travel_updates',
        'cliente',
        jsonb_build_object(
          'route', 'RateTrip',
          'params', jsonb_build_object('bookingId', NEW.id)
        )
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelamento pelo motorista (incluindo cascata do cancel-scheduled-trip).
  IF OLD.status IN ('pending', 'paid', 'confirmed')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
    v_reason := NULLIF(BTRIM(COALESCE(NEW.cancellation_reason, '')), '');
    IF public.should_notify_user(v_user, 'travel_updates') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Motorista cancelou sua viagem',
        'O motorista cancelou esta viagem. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
        'travel_updates',
        'cliente',
        jsonb_build_object(
          'route', 'TripDetail',
          'params', jsonb_build_object('bookingId', NEW.id)
        )
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 2) notify_client_shipment_driver_accepted — motorista aceitou shipment
--    Dispara quando driver_id passa de NULL para NOT NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_client_shipment_driver_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.driver_id IS NOT DISTINCT FROM NEW.driver_id THEN
    RETURN NEW;
  END IF;
  IF NEW.driver_id IS NULL OR OLD.driver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.should_notify_user(NEW.user_id, 'shipments_deliveries') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    NEW.user_id,
    'Motorista aceitou sua encomenda!',
    'O motorista confirmou o envio. Acompanhe os detalhes pelo app.',
    'shipments_deliveries',
    'cliente',
    jsonb_build_object(
      'route', 'ShipmentDetail',
      'params', jsonb_build_object('shipmentId', NEW.id)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_shipment_driver_accepted ON public.shipments;
CREATE TRIGGER trg_notify_client_shipment_driver_accepted
  AFTER UPDATE OF driver_id ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_shipment_driver_accepted();


-- ---------------------------------------------------------------------
-- 3) notify_client_shipment_phase_change — adiciona branch cancel by driver
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

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 4) notify_client_dependent_shipment_phase_change — idem (cancel by driver)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_client_dependent_shipment_phase_change()
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
    'route', 'DependentShipmentDetail',
    'params', jsonb_build_object('dependentShipmentId', NEW.id)
  );

  IF OLD.status = 'confirmed' AND NEW.status = 'in_progress' THEN
    IF public.should_notify_user(v_user, 'dependents') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Seu dependente está chegando ao destino',
        'Acompanhe o trajeto do seu dependente em tempo real pelo app.',
        'dependents',
        'cliente',
        v_data
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status = 'delivered' THEN
    IF public.should_notify_user(v_user, 'dependents') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Dependente Chegou ao Destino!',
        'Aee Parabéns! Seu dependente chegou ao destino com sucesso.',
        'dependents',
        'cliente',
        v_data
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelamento pelo motorista.
  IF OLD.status IN ('pending_review', 'confirmed', 'in_progress')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
    IF public.should_notify_user(v_user, 'dependents') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Motorista cancelou o envio do seu dependente',
        'O motorista cancelou este envio. Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.',
        'dependents',
        'cliente',
        v_data
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 5) notify_client_activity_status_changed — suprime as transições cobertas
--    pelos triggers específicos acima (evita notif duplicada do tipo
--    "atividade mudou de status").
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

    -- Aceite pelo motorista (pending|paid → confirmed): coberto por notify_client_booking_phase_change.
    IF OLD.status IN ('pending', 'paid') AND NEW.status = 'confirmed' THEN
      RETURN NEW;
    END IF;
    -- Desembarque (confirmed → paid): coberto.
    IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
      RETURN NEW;
    END IF;
    -- pending → paid: checkout do cliente, notif redundante.
    IF OLD.status = 'pending' AND NEW.status = 'paid' THEN
      RETURN NEW;
    END IF;
    -- Cancelamento pelo motorista: coberto.
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
    -- Cancelamento pelo motorista: coberto pelo phase_change.
    IF NEW.status = 'cancelled' AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
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
    -- Cancelamento pelo motorista: coberto.
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


COMMENT ON FUNCTION public.notify_client_booking_phase_change() IS
  'Cliente: aceite (pending|paid→confirmed), desembarque (confirmed→paid) e cancelamento pelo motorista.';
COMMENT ON FUNCTION public.notify_client_shipment_driver_accepted() IS
  'Cliente: notifica "Motorista aceitou sua encomenda" quando shipment.driver_id passa de NULL para NOT NULL.';
COMMENT ON FUNCTION public.notify_client_shipment_phase_change() IS
  'Cliente: pickup (confirmed→in_progress), entrega (in_progress→delivered) e cancelamento pelo motorista.';
COMMENT ON FUNCTION public.notify_client_dependent_shipment_phase_change() IS
  'Cliente: pickup (confirmed→in_progress), entrega (in_progress→delivered) e cancelamento pelo motorista do envio do dependente.';
