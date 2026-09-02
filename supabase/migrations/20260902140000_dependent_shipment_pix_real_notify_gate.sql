-- Portão de Pix REAL no envio de dependente.
--
-- Diferente da encomenda, o envio de dependente não tem fila de ofertas: o
-- cliente escolhe a viagem e notify_driver_dependent_shipment_assigned avisa o
-- motorista dela. Sem portão, o Pix real notificaria o motorista no INSERT —
-- antes de qualquer pagamento — porque no Pix real quem insere a linha é o
-- servidor (create-pix-charge), já ancorada na cobrança.
--
-- Duas mudanças, espelhando o que foi feito na encomenda:
--   1. não notifica enquanto a cobrança existir e pix_paid_at for nulo;
--   2. reavalia quando pix_paid_at muda — é a liquidação que dispara o aviso.
--
-- Cartão, dinheiro e Pix paliativo seguem idênticos: nenhum deles tem
-- pix_charge_id, então o portão nem é avaliado.

CREATE OR REPLACE FUNCTION public.notify_driver_dependent_shipment_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  drv uuid;
  v_trip_id uuid;
BEGIN
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
    OR (TG_OP = 'UPDATE' AND (
         OLD.scheduled_trip_id IS DISTINCT FROM NEW.scheduled_trip_id
         OR OLD.pix_paid_at IS DISTINCT FROM NEW.pix_paid_at
    ))
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Pix REAL ainda não liquidado: a cobrança existe (pix_charge_id) mas o
  -- pagamento não entrou. Não aciona o motorista.
  IF lower(coalesce(NEW.payment_method, '')) = 'pix'
     AND NEW.pix_charge_id IS NOT NULL
     AND NEW.pix_paid_at IS NULL
  THEN
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

-- O corpo reavalia em pix_paid_at, mas o gatilho precisa ser ACORDADO por ela:
-- a liquidação (entities.ts) toca APENAS pix_paid_at. Foi exatamente esta
-- omissão que deixou a encomenda paga sem oferta (20260902120000).
DROP TRIGGER IF EXISTS on_dependent_shipment_trip_notify_driver ON public.dependent_shipments;

CREATE TRIGGER on_dependent_shipment_trip_notify_driver
AFTER INSERT OR UPDATE OF scheduled_trip_id, status, pix_paid_at
ON public.dependent_shipments
FOR EACH ROW
EXECUTE FUNCTION public.notify_driver_dependent_shipment_assigned();
