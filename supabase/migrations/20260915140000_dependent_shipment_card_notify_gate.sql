-- Envio de dependente no cartão: não acionar o motorista antes de cobrar.
--
-- notify_driver_dependent_shipment_assigned já tinha portão de Pix real, mas
-- nenhum de cartão. O app insere a linha e só DEPOIS chama a cobrança, então no
-- credito/debito o motorista era acionado antes de o dinheiro entrar — mesma
-- classe do problema que o Pix real já resolvia. Encomendas (shipments) já têm
-- esse portão desde 20260831180000; aqui ele faltava.
--
-- Duas metades, e a segunda é a que costuma ser esquecida:
--   1. o portão, que silencia o INSERT enquanto não há PaymentIntent;
--   2. `stripe_payment_intent_id` na lista do CREATE TRIGGER e na condição de
--      reavaliação — sem isso o trigger nunca acorda quando a cobrança entra e
--      o motorista NUNCA seria avisado. Foi exatamente o que aconteceu com
--      pix_paid_at nas encomendas (ver 20260902120000).

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
         OR OLD.stripe_payment_intent_id IS DISTINCT FROM NEW.stripe_payment_intent_id
    ))
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('pending_review', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Pix real ainda não liquidado.
  IF lower(coalesce(NEW.payment_method, '')) = 'pix'
     AND NEW.pix_charge_id IS NOT NULL
     AND NEW.pix_paid_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  -- Cartão ainda não cobrado (espelha o portão das encomendas).
  IF lower(coalesce(NEW.payment_method, '')) IN ('credito', 'debito')
     AND (NEW.stripe_payment_intent_id IS NULL OR btrim(NEW.stripe_payment_intent_id) = '')
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

-- A metade 2: sem stripe_payment_intent_id aqui, o portão vira um bloqueio
-- permanente para o cartão.
DROP TRIGGER IF EXISTS on_dependent_shipment_trip_notify_driver ON public.dependent_shipments;
CREATE TRIGGER on_dependent_shipment_trip_notify_driver
AFTER INSERT OR UPDATE OF scheduled_trip_id, status, pix_paid_at, stripe_payment_intent_id
ON public.dependent_shipments
FOR EACH ROW
EXECUTE FUNCTION public.notify_driver_dependent_shipment_assigned();
