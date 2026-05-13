-- Dedup do push "Nova encomenda na sua viagem" no motorista.
--
-- Hoje o trigger on_shipment_offer_assigned_notify_driver dispara em duas
-- transições sequenciais quando uma oferta é aceita:
--   1) UPDATE shipments SET current_offer_driver_id = X  (caminho A)
--   2) UPDATE shipments SET driver_id = X, current_offer_driver_id = NULL
--      (caminho B do mesmo trigger)
--
-- Resultado: o motorista recebe 2 pushes idênticos e 2 linhas em
-- public.notifications (o fcm_collapse_key colapsa a UI no Android, mas
-- não dedup'a a inbox nem o iOS).
--
-- Solução: marcar shipments.driver_request_notified_at quando o motorista
-- for notificado e, no segundo disparo (mesmo motorista no aceite), pular.
-- O caminho A continua emitindo normalmente para o próximo motorista
-- quando current_offer_driver_id é reatribuído (reset implícito na guarda).

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS driver_request_notified_at timestamptz NULL;

COMMENT ON COLUMN public.shipments.driver_request_notified_at IS
  'Marcado quando o motorista atual foi notificado da solicitação (oferta ou atribuição direta). Reset implícito quando current_offer_driver_id muda para um novo motorista, permitindo que o próximo da fila receba seu push.';

CREATE OR REPLACE FUNCTION public.notify_driver_shipment_offer_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  drv uuid;
BEGIN
  -- Guarda de duplicação: bloqueia o aceite quando a oferta já notificou o
  -- mesmo motorista. Pulado quando o trigger entra pelo caminho A (nova
  -- oferta para outro motorista) — esse caminho redefine driver_request_notified_at
  -- abaixo, mantendo a inbox correta.
  IF TG_OP = 'UPDATE'
     AND OLD.current_offer_driver_id IS DISTINCT FROM NEW.current_offer_driver_id
     AND NEW.current_offer_driver_id IS NOT NULL THEN
    NULL;
  ELSIF NEW.driver_request_notified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Caminho A: oferta foi atribuída a um motorista (current_offer_driver_id passou de NULL → X)
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

  -- Caminho C: insert direto com driver_id já preenchido
  ELSIF TG_OP = 'INSERT' AND NEW.driver_id IS NOT NULL THEN
    drv := NEW.driver_id;

  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
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
$$;

COMMENT ON FUNCTION public.notify_driver_shipment_offer_assigned() IS
  'Best-effort: notifica o motorista quando current_offer_driver_id ou driver_id é preenchido em shipments. Usa driver_request_notified_at como guarda para não duplicar quando a mesma oferta vira aceite.';
