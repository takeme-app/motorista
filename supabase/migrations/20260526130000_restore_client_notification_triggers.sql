-- =====================================================================
-- Restaura triggers de notificação do cliente.
--
-- CONTEXTO: as migrations 20260523140000, 20260524120000, 20260524140000
-- foram commitadas no repo com timestamps futuros (mai/2026) mas, quando
-- timestamps maiores como 20260525180606 e 20260526122123 foram aplicados
-- no remoto, essas três ficaram "órfãs" — `supabase db push` só aplica
-- migrations com versão > última aplicada, portanto pulou as anteriores.
--
-- Auditoria em 2026-05-26: cliente recebeu apenas 3 notificações nos
-- últimos 7 dias (vs 40 para motorista). Triggers `notify_client_*`
-- ausentes do banco. Esta migration consolida o conteúdo das três
-- migrations órfãs com timestamp posterior à última aplicada.
--
-- Eventos cobertos para o cliente (target_app_slug='cliente'):
--   - Booking: paid -> confirmed       ("Sua viagem está em andamento.")
--   - Booking: confirmed -> paid       ("Você chegou ao destino.")
--   - Shipment: confirmed -> in_progress  ("Encomenda em andamento ao destino!")
--   - Shipment: in_progress -> delivered  ("Encomenda chegou ao destino!")
--   - Dependent shipment: confirmed -> in_progress ("Seu dependente está chegando ao destino")
--   - Dependent shipment: in_progress -> delivered ("Dependente Chegou ao Destino!")
--   - Excursão: check_in_ida_started_at NULL -> NOT NULL
--   - Excursão: check_in_volta_started_at NULL -> NOT NULL
--   - Excursão: status -> in_progress
--   - Excursão: status -> completed
--   - Dependente: status -> validated  ("Dependente Cadastrado com Sucesso!")
--   - Dependente: status -> rejected   ("Dependente não aprovado!")
--   - Genérico (fallback): "Sua atividade de XXX mudou de status"
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) should_notify_user — reconhece categorias `dependents` e `excursions`
--    no grupo `excursions_dependents`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.should_notify_user(
  p_user_id uuid,
  p_category text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pref_key text;
  disabled_all boolean;
  pref_enabled boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_category IN ('account_approved', 'account_rejected', 'account') THEN
    RETURN true;
  END IF;

  pref_key := CASE
    WHEN p_category IN (
      'travel_updates', 'trip_started', 'trip_completed', 'trip_closed',
      'trip_upcoming_1h', 'activity_status_changed', 'booking_cancelled_by_passenger',
      'booking'
    ) THEN 'travel_updates'
    WHEN p_category IN ('shipments_deliveries', 'shipment', 'dependent_shipment') THEN 'shipments_deliveries'
    WHEN p_category IN (
      'excursions_dependents', 'excursion', 'excursions',
      'dependent', 'dependents'
    ) THEN 'excursions_dependents'
    WHEN p_category IN ('payment_received') THEN 'payments_received'
    WHEN p_category IN ('payments_pending', 'payment') THEN 'payments_pending'
    WHEN p_category = 'payment_receipts' THEN 'payment_receipts'
    WHEN p_category = 'offers_promotions' THEN 'offers_promotions'
    WHEN p_category = 'app_updates' THEN 'app_updates'
    WHEN p_category = 'first_steps_hints' THEN 'first_steps_hints'
    ELSE NULL
  END;

  SELECT enabled INTO disabled_all
  FROM public.notification_preferences
  WHERE user_id = p_user_id AND key = 'disable_all';

  IF COALESCE(disabled_all, false) THEN
    RETURN false;
  END IF;

  IF pref_key IS NULL THEN
    RETURN true;
  END IF;

  SELECT enabled INTO pref_enabled
  FROM public.notification_preferences
  WHERE user_id = p_user_id AND key = pref_key;

  RETURN COALESCE(pref_enabled, true);
END;
$$;


-- ---------------------------------------------------------------------
-- 1) "Motorista a caminho" (ajuste: target_app_slug='cliente' + data deeplink).
--    Sem alterar a semântica: dispara em scheduled_trips.driver_journey_started_at
--    quando passa de NULL -> NOT NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_passengers_driver_journey_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dest_preview text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.driver_journey_started_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.driver_journey_started_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  dest_preview := left(coalesce(NEW.destination_address, 'destino'), 100);

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  SELECT
    b.user_id,
    'Motorista a caminho',
    format('O motorista iniciou a viagem rumo a %s. Acompanhe no app.', dest_preview),
    'travel_updates',
    'cliente',
    jsonb_build_object(
      'route', 'DriverOnTheWay',
      'params', jsonb_build_object('tripId', NEW.id, 'bookingId', b.id)
    )
  FROM public.bookings b
  WHERE b.scheduled_trip_id = NEW.id
    AND b.status IN ('paid', 'confirmed');

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  SELECT
    ds.user_id,
    'Motorista a caminho',
    format('O motorista iniciou a viagem rumo a %s. Acompanhe no app.', dest_preview),
    'travel_updates',
    'cliente',
    jsonb_build_object(
      'route', 'DependentShipmentDetail',
      'params', jsonb_build_object('dependentShipmentId', ds.id)
    )
  FROM public.dependent_shipments ds
  WHERE ds.scheduled_trip_id = NEW.id
    AND ds.status IN ('confirmed', 'in_progress');

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  SELECT
    s.user_id,
    'Motorista a caminho',
    format('O motorista iniciou a viagem rumo a %s. Acompanhe no app.', dest_preview),
    'shipments_deliveries',
    'cliente',
    jsonb_build_object(
      'route', 'ShipmentDetail',
      'params', jsonb_build_object('shipmentId', s.id)
    )
  FROM public.shipments s
  WHERE s.scheduled_trip_id = NEW.id
    AND s.status IN ('confirmed', 'in_progress');

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 2) Fases do booking: pickup (paid -> confirmed) e delivery (confirmed -> paid)
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
BEGIN
  v_user := NEW.user_id;
  v_trip := NEW.scheduled_trip_id;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid' AND NEW.status = 'confirmed' THEN
    IF public.should_notify_user(v_user, 'travel_updates') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Sua viagem está em andamento.',
        'Boa viagem! Acompanhe o trajeto em tempo real pelo app.',
        'travel_updates',
        'cliente',
        jsonb_build_object(
          'route', 'TripInProgress',
          'params', jsonb_build_object('tripId', v_trip, 'bookingId', NEW.id)
        )
      );
    END IF;
    RETURN NEW;
  END IF;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_booking_phase_change ON public.bookings;
CREATE TRIGGER trg_notify_client_booking_phase_change
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_booking_phase_change();


-- ---------------------------------------------------------------------
-- 3) Fases do shipment: confirmed -> in_progress e in_progress -> delivered
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_shipment_phase_change ON public.shipments;
CREATE TRIGGER trg_notify_client_shipment_phase_change
  AFTER UPDATE OF status ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_shipment_phase_change();


-- ---------------------------------------------------------------------
-- 4) Fases da excursão para o cliente (check-in + status)
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

  IF NEW.check_in_ida_started_at IS NOT NULL
     AND OLD.check_in_ida_started_at IS DISTINCT FROM NEW.check_in_ida_started_at
     AND OLD.check_in_ida_started_at IS NULL THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Sua Excursão está em fase de check in de ida.',
        'Abra o app para conferir o embarque da sua excursão.',
        'excursions',
        'cliente',
        v_data
      );
    END IF;
  END IF;

  IF NEW.check_in_volta_started_at IS NOT NULL
     AND OLD.check_in_volta_started_at IS DISTINCT FROM NEW.check_in_volta_started_at
     AND OLD.check_in_volta_started_at IS NULL THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Sua Excursão está em fase de check in de volta.',
        'Abra o app para conferir o embarque de volta da sua excursão.',
        'excursions',
        'cliente',
        v_data
      );
    END IF;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'in_progress' THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Sua excursão está em andamento',
        'Acompanhe sua excursão em tempo real pelo app.',
        'excursions',
        'cliente',
        v_data
      );
    END IF;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_user,
        'Sua excursão finalizou.',
        'Esperamos que você tenha aproveitado! Toque para ver os detalhes.',
        'excursions',
        'cliente',
        v_data
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_excursion_phase_change ON public.excursion_requests;
CREATE TRIGGER trg_notify_client_excursion_phase_change
  AFTER UPDATE ON public.excursion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_excursion_phase_change();


-- ---------------------------------------------------------------------
-- 5) Dependente — aprovação/reprovação (substitui insert de "Cadastro enviado")
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_dependent_inserted_notify ON public.dependents;

CREATE OR REPLACE FUNCTION public.notify_dependent_validated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb;
  v_reason text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object(
    'route', 'DependentDetail',
    'params', jsonb_build_object('dependentId', NEW.id)
  );

  IF NEW.status = 'validated' THEN
    IF public.should_notify_user(NEW.user_id, 'dependents') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        NEW.user_id,
        'Dependente Cadastrado com Sucesso!',
        'Clique pra ver o cadastro do seu dependente.',
        'dependents',
        'cliente',
        v_data
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' THEN
    IF public.should_notify_user(NEW.user_id, 'dependents') THEN
      v_reason := NULLIF(BTRIM(COALESCE(NEW.rejection_reason, '')), '');
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        NEW.user_id,
        'Dependente não aprovado!',
        CASE
          WHEN v_reason IS NULL THEN
            'Infelizmente seu dependente, não atende aos critérios da takeme. Caso haja que houve um erro, por favor entre em contato com o suporte Takeme.'
          ELSE
            'Infelizmente seu dependente, não atende aos critérios da takeme. Motivo: '
              || v_reason
              || ' Caso haja que houve um erro, por favor entre em contato com o suporte Takeme.'
        END,
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
-- 6) Dependent shipment: fases pickup/delivery
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_dependent_shipment_phase_change ON public.dependent_shipments;
CREATE TRIGGER trg_notify_client_dependent_shipment_phase_change
  AFTER UPDATE OF status ON public.dependent_shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_dependent_shipment_phase_change();


-- ---------------------------------------------------------------------
-- 7) Trigger genérico (fallback) — "Sua atividade de XXX mudou de status"
--    Suprime transições já cobertas por triggers específicos acima.
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

    IF NEW.status = 'in_progress' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'completed' THEN
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
    format(
      'Sua %s tem uma nova atualização, clique e verifique.',
      v_entity_label
    ),
    v_category,
    'cliente',
    jsonb_build_object('route', v_route, 'params', v_params)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_activity_bookings ON public.bookings;
CREATE TRIGGER trg_notify_client_activity_bookings
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_activity_status_changed();

DROP TRIGGER IF EXISTS trg_notify_client_activity_shipments ON public.shipments;
CREATE TRIGGER trg_notify_client_activity_shipments
  AFTER UPDATE OF status ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_activity_status_changed();

DROP TRIGGER IF EXISTS trg_notify_client_activity_dependent_shipments ON public.dependent_shipments;
CREATE TRIGGER trg_notify_client_activity_dependent_shipments
  AFTER UPDATE OF status ON public.dependent_shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_activity_status_changed();

DROP TRIGGER IF EXISTS trg_notify_client_activity_excursion_requests ON public.excursion_requests;
CREATE TRIGGER trg_notify_client_activity_excursion_requests
  AFTER UPDATE OF status ON public.excursion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_client_activity_status_changed();


COMMENT ON FUNCTION public.notify_client_booking_phase_change() IS
  'Cliente: "Sua viagem está em andamento" (paid->confirmed) e "Você chegou ao destino" (confirmed->paid).';
COMMENT ON FUNCTION public.notify_client_shipment_phase_change() IS
  'Cliente: "Encomenda em andamento ao destino!" (confirmed->in_progress) e "Encomenda chegou ao destino!" (in_progress->delivered).';
COMMENT ON FUNCTION public.notify_client_excursion_phase_change() IS
  'Cliente: notificações da excursão (in_progress, completed, check-in de ida e volta).';
COMMENT ON FUNCTION public.notify_client_dependent_shipment_phase_change() IS
  'Cliente: notificações do envio de dependente (confirmed->in_progress e in_progress->delivered).';
COMMENT ON FUNCTION public.notify_dependent_validated() IS
  'Cliente: notifica aprovação (validated) ou reprovação (rejected) do cadastro do dependente.';
COMMENT ON FUNCTION public.notify_client_activity_status_changed() IS
  'Cliente: fallback "Sua atividade de X mudou de status", suprimindo transições já cobertas por triggers específicos.';
