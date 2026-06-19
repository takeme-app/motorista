-- Push de "Excursão cancelada": em vez de prometer estorno automático no cartão,
-- orientar o cliente a falar com o suporte Take Me caso tenha pago.
-- Demais ramos preservados (idêntico a 20260702000009, só muda a mensagem do cancelamento).
CREATE OR REPLACE FUNCTION public.notify_client_excursion_phase_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      VALUES (v_user, 'Sua Excursão está em fase de check in de ida.', 'Abra o app para conferir o embarque da sua excursão.', 'excursions', 'cliente', v_data);
    END IF;
  END IF;

  IF NEW.check_in_volta_started_at IS NOT NULL
     AND OLD.check_in_volta_started_at IS DISTINCT FROM NEW.check_in_volta_started_at
     AND OLD.check_in_volta_started_at IS NULL THEN
    IF public.should_notify_user(v_user, 'excursions') THEN
      INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
      VALUES (v_user, 'Sua Excursão está em fase de check in de volta.', 'Abra o app para conferir o embarque de volta da sua excursão.', 'excursions', 'cliente', v_data);
    END IF;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'quoted' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Orçamento da sua excursão pronto', 'Recebemos o orçamento da sua excursão. Toque para revisar e aprovar.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'approved' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Excursão aprovada', 'Sua excursão foi aprovada e está aguardando confirmação operacional.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'scheduled' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Excursão agendada', 'Sua excursão foi agendada pela operação Take Me. Estamos prontos para o embarque!', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'in_progress' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Sua excursão está em andamento', 'Acompanhe sua excursão em tempo real pelo app.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'completed' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Sua excursão finalizou.', 'Esperamos que você tenha aproveitado! Toque para ver os detalhes.', 'excursions', 'cliente', v_data);
      END IF;
    ELSIF NEW.status = 'cancelled' THEN
      IF public.should_notify_user(v_user, 'excursions') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Excursão cancelada', 'Sua excursão foi cancelada. Caso tenha pago, entre em contato com o suporte Take Me.', 'excursions', 'cliente', v_data);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
