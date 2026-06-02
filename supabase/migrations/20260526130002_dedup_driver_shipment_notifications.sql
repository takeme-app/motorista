-- =====================================================================
-- Deduplica notificações de shipment / dependent_shipment para o motorista.
--
-- CONTEXTO: dois triggers ativos em `shipments` notificam o driver:
--   1) on_shipment_trip_notify_driver  → notify_driver_shipment_on_trip
--      (dispara quando shipment é linkado a uma trip sem driver_id)
--   2) on_shipment_offer_assigned_notify_driver → notify_driver_shipment_offer_assigned
--      (dispara em current_offer_driver_id ou driver_id NULL→NOT NULL,
--       já tem guard `driver_request_notified_at`)
--
-- Em fluxos onde o cliente escolhe um motorista específico ANTES da
-- oferta entrar em fila, ambos podem disparar pelo mesmo shipment e
-- inserir duas linhas em `notifications`. FCM collapse_key esconde no
-- Android, mas: (i) badge unread conta 2; (ii) iOS pode mostrar
-- duplicado; (iii) lista de notificações exibe duplicado.
--
-- SOLUÇÃO: aplicar idempotência via `driver_request_notified_at` em
-- AMBOS os triggers. O primeiro que disparar seta o timestamp e o
-- segundo pula (early return).
--
-- Para `dependent_shipments`, replicar o padrão (adicionando a coluna,
-- que ainda não existe, e respeitando-a no único trigger ativo).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Adicionar coluna de idempotência em dependent_shipments.
-- ---------------------------------------------------------------------
ALTER TABLE public.dependent_shipments
  ADD COLUMN IF NOT EXISTS driver_request_notified_at timestamptz;

COMMENT ON COLUMN public.dependent_shipments.driver_request_notified_at IS
  'NOT NULL quando o motorista responsável já foi notificado do envio do dependente. Idempotência cross-trigger.';


-- ---------------------------------------------------------------------
-- 2) notify_driver_shipment_on_trip — passa a respeitar
--    `driver_request_notified_at` (compartilhado com notify_driver_shipment_offer_assigned).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_shipment_on_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  drv uuid;
  became_linked boolean;
BEGIN
  -- Idempotência: se algum outro trigger já notificou pelo mesmo shipment, sai.
  IF NEW.driver_request_notified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.scheduled_trip_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;
  IF NEW.driver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  became_linked :=
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND (OLD.scheduled_trip_id IS DISTINCT FROM NEW.scheduled_trip_id));

  IF NOT became_linked THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT st.driver_id INTO drv
    FROM public.scheduled_trips st
    WHERE st.id = NEW.scheduled_trip_id;

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
      'Um cliente adicionou um envio à sua rota. Veja em Solicitações pendentes.',
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
    RAISE WARNING '[notify_driver_shipment_on_trip] ignorado: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------
-- 3) notify_driver_dependent_shipment_assigned — passa a usar
--    `driver_request_notified_at` para idempotência.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_driver_dependent_shipment_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  drv uuid;
  v_trip_id uuid;
BEGIN
  -- Idempotência (cross-trigger / cross-run).
  IF NEW.driver_request_notified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_trip_id := NEW.scheduled_trip_id;

  IF v_trip_id IS NOT NULL THEN
    SELECT st.driver_id INTO drv
    FROM public.scheduled_trips st
    WHERE st.id = v_trip_id;
  END IF;

  IF drv IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND OLD.scheduled_trip_id IS DISTINCT FROM NEW.scheduled_trip_id)
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NOT public.should_notify_user(drv, 'shipments_deliveries') THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
    VALUES (
      drv,
      'Novo envio de dependente na sua viagem',
      'Um cliente solicitou um envio de dependente na sua rota. Veja em Solicitações pendentes.',
      'shipments_deliveries',
      'motorista',
      jsonb_build_object(
        'route', 'PendingRequests',
        'dependent_shipment_id', NEW.id,
        'fcm_collapse_key', 'dependent_shipment_request_' || NEW.id::text,
        'fcm_android_tag', 'dependent_shipment_request_' || NEW.id::text
      )
    );

    UPDATE public.dependent_shipments
       SET driver_request_notified_at = now()
     WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_driver_dependent_shipment_assigned] ignorado: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;


COMMENT ON FUNCTION public.notify_driver_shipment_on_trip() IS
  'Notifica motorista quando shipment é linkado a uma trip sem driver_id. Idempotente via shipments.driver_request_notified_at (compartilhado com notify_driver_shipment_offer_assigned).';
COMMENT ON FUNCTION public.notify_driver_dependent_shipment_assigned() IS
  'Notifica motorista quando dependent_shipment é linkado a sua trip. Idempotente via dependent_shipments.driver_request_notified_at.';
