-- =====================================================================
-- Deploy das notificações do preparador (corrige DRIFT prod x repo).
--
-- As migrations 20260525100000 (excursão) e 20260526110000 (encomendas)
-- nunca foram aplicadas em produção: a função viva
-- notify_driver_account_status_change só notificava motoristas
-- (subtype IN ('takeme','partner')), então preparadores (role='preparer',
-- subtype='excursions'|'shipments') NUNCA recebiam a notificação de
-- aprovação/reprovação. Também não havia trigger notificando o preparador
-- de excursão sobre o andamento da excursão.
--
-- Esta migration (idempotente) traz a produção ao estado pretendido:
--   1) should_notify_user: inclui as categorias de excursão no grupo
--      de preferência excursions_dependents.
--   2) notify_driver_account_status_change: cobre motorista + preparer
--      excursão + preparer encomendas (mesmo trigger; sem duplicar).
--   3) notify_preparer_excursion_phase_change: in_progress / completed.
--   4) notify_preparer_excursion_activity_status_changed: demais transições.
--
-- Fora de escopo (follow-up): atividade do preparador de ENCOMENDAS
-- (fases coleta/cliente/base de 20260526110000) e o lembrete "40 min".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) should_notify_user: adiciona excursion_started/completed/upcoming_40min
--    ao grupo de preferência `excursions_dependents`.
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
      'excursion_started', 'excursion_completed', 'excursion_upcoming_40min',
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
-- 2) Cadastro aprovado/reprovado — motorista + preparer excursão + preparer
--    encomendas (textos literais do spec). Único trigger existente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_account_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_driver boolean;
  v_is_preparer_excursion boolean;
  v_is_preparer_shipment boolean;
  v_title text;
  v_message text;
  v_route text;
BEGIN
  v_is_driver := NEW.subtype IS NOT NULL AND NEW.subtype IN ('takeme', 'partner');
  v_is_preparer_excursion :=
    NEW.role = 'preparer' AND NEW.subtype = 'excursions';
  v_is_preparer_shipment :=
    NEW.role = 'preparer' AND NEW.subtype = 'shipments';

  IF NOT (v_is_driver OR v_is_preparer_excursion OR v_is_preparer_shipment) THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    IF v_is_driver THEN
      v_title := 'Cadastro Aprovado! Takeme';
      v_message := 'Aee Parabéns! Cadastro Aprovado,cadastre suas rotas e comece a viajar!';
    ELSIF v_is_preparer_excursion THEN
      v_title := 'Cadastro de Preparador Excursão Aprovado! Takeme';
      v_message := 'Aee Parabéns! Cadastro Aprovado, aguarde as excursões e comece a viajar!';
    ELSE
      v_title := 'Cadastro de Preparador de Encomendas Aprovado! Takeme';
      v_message := 'Aee Parabéns! Cadastro Aprovado, veja os pacotes e comece a viajar!';
    END IF;
    v_route := 'Main';

    INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
    VALUES (
      NEW.id,
      v_title,
      v_message,
      'account_approved',
      'motorista',
      jsonb_build_object('route', v_route)
    );

    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' THEN
    IF v_is_driver THEN
      v_title := 'Cadastro de Motorista Reprovado! Takeme';
    ELSIF v_is_preparer_excursion THEN
      v_title := 'Cadastro de Preparador Excursão Reprovado! Takeme';
    ELSE
      v_title := 'Cadastro de Preparador de Encomendas Reprovado! Takeme';
    END IF;
    v_message := 'Agradeçemos seu interesse, mas não podemos seguir com o seu cadastro no momento!';

    INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
    VALUES (
      NEW.id,
      v_title,
      v_message,
      'account_rejected',
      'motorista',
      jsonb_build_object('route', 'MotoristaPendingApproval')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_driver_account_status_change ON public.worker_profiles;
CREATE TRIGGER trg_notify_driver_account_status_change
  AFTER UPDATE OF status ON public.worker_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_driver_account_status_change();


-- ---------------------------------------------------------------------
-- 3) Fases da excursão para o preparador (in_progress / completed).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_preparer_excursion_phase_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preparer uuid;
  v_data jsonb;
BEGIN
  v_preparer := NEW.preparer_id;
  IF v_preparer IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object(
    'route', 'DetalhesExcursao',
    'params', jsonb_build_object('excursionId', NEW.id)
  );

  IF NEW.status = 'in_progress' THEN
    IF public.should_notify_user(v_preparer, 'excursion_started') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_preparer,
        'Sua Excursão está em andamento.',
        'Acompanhe o andamento da excursão pelo app.',
        'excursion_started',
        'motorista',
        v_data
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' THEN
    IF public.should_notify_user(v_preparer, 'excursion_completed') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (
        v_preparer,
        'Sua Excursão Finalizou.',
        'Obrigado pela operação! Toque para conferir o fechamento.',
        'excursion_completed',
        'motorista',
        v_data
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_preparer_excursion_phase_change ON public.excursion_requests;
CREATE TRIGGER trg_notify_preparer_excursion_phase_change
  AFTER UPDATE OF status ON public.excursion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_preparer_excursion_phase_change();


-- ---------------------------------------------------------------------
-- 4) "Sua atividade de excursão mudou de status" (demais transições).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_preparer_excursion_activity_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preparer uuid;
  v_data jsonb;
BEGIN
  v_preparer := NEW.preparer_id;
  IF v_preparer IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Cobertas por notify_preparer_excursion_phase_change.
  IF NEW.status IN ('in_progress', 'completed') THEN
    RETURN NEW;
  END IF;

  IF NOT public.should_notify_user(v_preparer, 'activity_status_changed') THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object(
    'route', 'DetalhesExcursao',
    'params', jsonb_build_object('excursionId', NEW.id)
  );

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    v_preparer,
    'Sua atividade de excursão mudou de status',
    'Sua excursão tem uma nova atualização, clique e verifique.',
    'activity_status_changed',
    'motorista',
    v_data
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_preparer_excursion_activity_status_changed ON public.excursion_requests;
CREATE TRIGGER trg_notify_preparer_excursion_activity_status_changed
  AFTER UPDATE OF status ON public.excursion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_preparer_excursion_activity_status_changed();
