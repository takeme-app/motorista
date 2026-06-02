-- =====================================================================
-- Consolida triggers de notificação do motorista para eliminar dups.
--
-- DESCOBERTA: apesar do guard `driver_request_notified_at` adicionado em
-- 20260526130002, ainda há cenários em que dois triggers AFTER UPDATE
-- disparam no MESMO statement e nenhum vê o flag atualizado pelo outro
-- (NEW é snapshot pré-trigger). Notifs históricas confirmaram pares:
--   - "Um cliente solicitou um envio na sua rota..." (notify_driver_shipment_offer_assigned)
--   - "Um cliente adicionou um envio à sua rota..." (notify_driver_shipment_on_trip)
-- ambas geradas pelo MESMO shipment em milissegundos.
--
-- SOLUÇÃO: consolidar tudo em `notify_driver_shipment_offer_assigned`
-- (já tem o guard idempotente + payload com fcm_collapse_key). Dropar
-- a função/trigger `notify_driver_shipment_on_trip` — seu único caso
-- útil (shipment criado linkado a uma trip sem driver_id) passa a ser
-- coberto pela função consolidada via lookup do driver pela trip.
--
-- Também refina `notify_driver_activity_status_changed`:
--   - Bookings: pular `paid→confirmed` (motorista aceita) e
--     `confirmed→paid` (motorista finaliza) — o motorista já sabe que
--     fez essas transições; mandar push é ruído.
--   - Shipments: pular `pending_review→confirmed` (cliente pagou —
--     irrelevante pro motorista) e `confirmed→in_progress` /
--     `in_progress→delivered` (motorista coleta/entrega — ele sabe).
--   - Dependent_shipments: pular as mesmas transições.
--   - Mantém os branches específicos de cancelamento (passenger/admin).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Consolidar notify_driver_shipment_offer_assigned.
--    Adiciona o caso `INSERT/UPDATE com scheduled_trip_id NOT NULL e
--    driver_id IS NULL` (busca o driver via scheduled_trips).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_shipment_offer_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  drv uuid;
  trip_driver uuid;
  became_linked boolean;
BEGIN
  -- Guard idempotente: se já notificamos esse shipment, sai.
  IF NEW.driver_request_notified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Determina o driver a notificar, em ordem de prioridade:
  --   (a) `current_offer_driver_id` foi setado neste UPDATE — oferta na fila
  --   (b) `driver_id` foi populado (INSERT ou UPDATE NULL→X) — aceite direto
  --   (c) shipment ganhou `scheduled_trip_id` sem driver_id próprio — usa
  --       o driver da trip.
  IF TG_OP = 'UPDATE'
     AND OLD.current_offer_driver_id IS DISTINCT FROM NEW.current_offer_driver_id
     AND NEW.current_offer_driver_id IS NOT NULL THEN
    drv := NEW.current_offer_driver_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL THEN
    drv := NEW.driver_id;
  ELSIF TG_OP = 'INSERT' AND NEW.driver_id IS NOT NULL THEN
    drv := NEW.driver_id;
  ELSE
    became_linked :=
      TG_OP = 'INSERT'
      OR (TG_OP = 'UPDATE' AND (OLD.scheduled_trip_id IS DISTINCT FROM NEW.scheduled_trip_id));
    IF became_linked
       AND NEW.scheduled_trip_id IS NOT NULL
       AND NEW.driver_id IS NULL THEN
      SELECT st.driver_id INTO trip_driver
      FROM public.scheduled_trips st
      WHERE st.id = NEW.scheduled_trip_id;
      IF trip_driver IS NULL THEN
        RETURN NEW;
      END IF;
      drv := trip_driver;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    IF drv IS NULL THEN
      RETURN NEW;
    END IF;

    IF NOT public.should_notify_user(drv, 'shipments_deliveries') THEN
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
       SET driver_request_notified_at = now()
     WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_driver_shipment_offer_assigned] ignorado: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------
-- 2) Drop do trigger e função redundantes (substituídos pelo consolidado).
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_shipment_trip_notify_driver ON public.shipments;
DROP FUNCTION IF EXISTS public.notify_driver_shipment_on_trip();


-- ---------------------------------------------------------------------
-- 3) Refinar notify_driver_activity_status_changed:
--    pular transições naturais que o próprio motorista executa ou que
--    não interessam (cliente pagando, etc).
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

  -- Transições naturais — não notificar (motorista já sabe ou é irrelevante).
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Bookings:
    --   pending→paid/confirmed: já cobertos por notify_driver_new_booking_request (INSERT)
    --   paid→confirmed: motorista que aceitou via app
    --   confirmed→paid: motorista que finalizou via app
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

    -- Shipments:
    --   pending_review→confirmed: cliente pagou — não interessa pro motorista
    --   confirmed→in_progress: motorista coletou (sabe)
    --   in_progress→delivered: motorista entregou (sabe)
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

    -- Dependent_shipments: mesmas transições.
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


COMMENT ON FUNCTION public.notify_driver_shipment_offer_assigned() IS
  'Notifica motorista de nova encomenda — consolida 3 caminhos (INSERT direto, oferta na fila, shipment linkado à trip sem driver_id). Idempotente via shipments.driver_request_notified_at.';
COMMENT ON FUNCTION public.notify_driver_activity_status_changed() IS
  'Notifica motorista de mudanças de status genéricas, pulando: (a) cancelamentos cobertos por triggers específicos; (b) transições naturais que o motorista executa (paid→confirmed, confirmed→paid, pickup→in_progress, in_progress→delivered) ou que não lhe interessam (pending_review→confirmed do shipment).';
