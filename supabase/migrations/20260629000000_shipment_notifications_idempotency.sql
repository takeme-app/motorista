-- =====================================================================
-- Notificações duplicadas para a MESMA encomenda em 3 caminhos:
--
--   A) Motorista recebe N "Nova encomenda na sua viagem" porque
--      `notify_driver_shipment_offer_assigned` bypassa o guard global
--      `driver_request_notified_at` quando `current_offer_driver_id`
--      muda — mas se a fila rotaciona pelo MESMO motorista mais de uma
--      vez (A→B→A→…), cada reentrada dispara notificação.
--
--   B) Cliente recebe N "Motorista aceitou sua encomenda!" porque
--      `notify_client_shipment_driver_accepted` não tem flag de
--      idempotência — toda transição driver_id NULL→X dispara notif,
--      incluindo X repetidos após rotação.
--
--   C) Motorista recebe duplicadas "Sua atividade (encomenda) mudou
--      de status" (Caso 2 genérico de `notify_driver_activity_status_changed`)
--      quando o status é re-aplicado ou cascateado por outro trigger.
--
-- Fix: idempotência por destinatário, armazenada na própria linha do
-- shipment. Três colunas:
--   - offer_notified_driver_ids  uuid[]
--   - accept_notified_driver_ids uuid[]
--   - status_change_notified     jsonb   (chave: "<user_id>:<status>")
--
-- Cada trigger consulta a coluna antes de inserir notification e
-- atualiza após inserir (mesma transação). Bookings/dependent_shipments
-- não recebem a coluna — a idempotência aqui é específica de shipments.
-- =====================================================================


ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS offer_notified_driver_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS accept_notified_driver_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS status_change_notified jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.shipments.offer_notified_driver_ids IS
  'Motoristas que já receberam push "Nova encomenda na sua viagem" para esta encomenda. Idempotência de notify_driver_shipment_offer_assigned.';
COMMENT ON COLUMN public.shipments.accept_notified_driver_ids IS
  'Motoristas cujos aceites já geraram notif "Motorista aceitou sua encomenda!" ao cliente. Idempotência de notify_client_shipment_driver_accepted.';
COMMENT ON COLUMN public.shipments.status_change_notified IS
  'Map "<driver_id>:<status>" → timestamp ISO. Idempotência do Caso 2 genérico de notify_driver_activity_status_changed para shipments.';


-- ---------------------------------------------------------------------
-- A) notify_driver_shipment_offer_assigned — guard por motorista
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_shipment_offer_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  drv uuid;
BEGIN
  -- Caminho A: oferta foi atribuída a um motorista (current_offer_driver_id passou de NULL ou de outro motorista → X)
  IF TG_OP = 'UPDATE'
     AND OLD.current_offer_driver_id IS DISTINCT FROM NEW.current_offer_driver_id
     AND NEW.current_offer_driver_id IS NOT NULL
  THEN
    drv := NEW.current_offer_driver_id;

  -- Caminho B: driver_id passou de NULL → X (auto-accept, atribuição direta)
  ELSIF TG_OP = 'UPDATE'
        AND OLD.driver_id IS NULL
        AND NEW.driver_id IS NOT NULL
  THEN
    drv := NEW.driver_id;

  -- Caminho C: INSERT direto com driver_id preenchido
  ELSIF TG_OP = 'INSERT' AND NEW.driver_id IS NOT NULL THEN
    drv := NEW.driver_id;

  ELSE
    RETURN NEW;
  END IF;

  IF drv IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Idempotência por motorista: se este drv já recebeu push para este
  -- shipment, sai. Cobre rotação A→B→A onde o guard antigo
  -- (driver_request_notified_at) era bypassado.
  IF drv = ANY (COALESCE(NEW.offer_notified_driver_ids, '{}'::uuid[])) THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NOT public.should_notify_user(drv, 'shipments_deliveries') THEN
      -- Mesmo bloqueado por preferência, marca pra não revisitar a cada tick.
      UPDATE public.shipments
         SET offer_notified_driver_ids = array_append(offer_notified_driver_ids, drv),
             driver_request_notified_at = COALESCE(driver_request_notified_at, now())
       WHERE id = NEW.id;
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
    VALUES (
      drv,
      'Nova encomenda na sua viagem',
      'Um cliente solicitou um envio na sua rota. Veja em Solicitações pendentes.',
      'shipments_deliveries',
      'motorista',
      jsonb_build_object(
        'route', 'PendingRequests',
        'shipment_id', NEW.id,
        'fcm_collapse_key', 'shipment_request_' || NEW.id::text,
        'fcm_android_tag', 'shipment_request_' || NEW.id::text
      )
    );

    UPDATE public.shipments
       SET offer_notified_driver_ids = array_append(offer_notified_driver_ids, drv),
           driver_request_notified_at = now()
     WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_driver_shipment_offer_assigned] ignorado: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_driver_shipment_offer_assigned() IS
  'Notifica motorista de nova encomenda. Idempotente por (shipment, driver) via offer_notified_driver_ids — evita duplicar quando a fila rotaciona pelo mesmo motorista.';


-- ---------------------------------------------------------------------
-- B) notify_client_shipment_driver_accepted — guard por motorista
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

  -- Idempotência: cliente já foi notificado deste motorista para este shipment.
  IF NEW.driver_id = ANY (COALESCE(NEW.accept_notified_driver_ids, '{}'::uuid[])) THEN
    RETURN NEW;
  END IF;

  IF NOT public.should_notify_user(NEW.user_id, 'shipments_deliveries') THEN
    -- Marca mesmo bloqueado para não revisitar.
    UPDATE public.shipments
       SET accept_notified_driver_ids = array_append(accept_notified_driver_ids, NEW.driver_id)
     WHERE id = NEW.id;
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

  UPDATE public.shipments
     SET accept_notified_driver_ids = array_append(accept_notified_driver_ids, NEW.driver_id)
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_client_shipment_driver_accepted() IS
  'Notifica cliente quando motorista aceita encomenda. Idempotente por (shipment, driver) via accept_notified_driver_ids — evita duplicar quando driver_id é zerado e reatribuído.';


-- ---------------------------------------------------------------------
-- C) notify_driver_activity_status_changed — guard Caso 2 genérico
--    para shipments (preserva Casos 1a/1b e demais ramos).
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

  -- Caso 1a: passageiro cancelou booking (preservado da versão anterior).
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

  -- Caso 1b: passageiro cancelou shipment (com idempotência por (driver, status)).
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

  -- Caso 2: genérico "atividade mudou de status".
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

    -- Idempotência específica de shipments (bookings/dependents seguem como antes).
    IF TG_TABLE_NAME = 'shipments' THEN
      v_key := v_driver::text || ':' || COALESCE(NEW.status, 'unknown');
      IF COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key THEN
        RETURN NEW;
      END IF;
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

    IF TG_TABLE_NAME = 'shipments' THEN
      UPDATE public.shipments
         SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb)
                                        || jsonb_build_object(v_key, now())
       WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_driver_activity_status_changed() IS
  'Notifica motorista de mudanças de status. Caso 1a: passageiro cancela viagem. Caso 1b: passageiro cancela encomenda (idempotente). Caso 2: genérico (idempotente para shipments via status_change_notified).';
