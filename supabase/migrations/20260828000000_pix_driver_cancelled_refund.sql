-- Cancelamento do motorista numa reserva paga por Pix real.
--
-- Contexto: cancel-scheduled-trip só sabe estornar via Stripe (gate em
-- stripe_payment_intent_id). Uma reserva paga por Pix não tem PaymentIntent,
-- então o cancelamento pelo motorista passava batido: o dinheiro ficava com a
-- plataforma, NADA entrava na fila de devolução, e o passageiro ainda recebia
-- push prometendo "estorno automático no cartão".
--
-- Aqui: (1) motivo próprio na fila de devolução — o financeiro precisa saber
-- que foi o motorista que cancelou (é diferente do passageiro desistir);
-- (2) textos de cancelamento cientes de Pix.

-- ── 1. Novo motivo na fila de devolução ─────────────────────────────────────
ALTER TABLE public.pix_refunds_pending
  DROP CONSTRAINT IF EXISTS pix_refunds_pending_reason_check;

ALTER TABLE public.pix_refunds_pending
  ADD CONSTRAINT pix_refunds_pending_reason_check CHECK (
    reason = ANY (ARRAY[
      'paid_after_expiry',
      'amount_mismatch',
      'expired_not_realized',
      'user_cancelled_in_window',
      'driver_cancelled',
      'admin_cancelled',
      'orphan_payment'
    ])
  );

-- ── 2. Notificação de cancelamento ciente de Pix ────────────────────────────
-- Reserva paga por Pix real = pix_paid_at preenchido e sem PaymentIntent.
-- Nesse caso a devolução é MANUAL (fila pix_refunds_pending), não automática
-- no cartão — prometer cartão gera chamado de suporte e quebra de confiança.
CREATE OR REPLACE FUNCTION public.notify_client_booking_phase_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_key text;
  v_data jsonb;
  v_pix boolean;
  v_refund_text text;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cancelamento técnico de Pix real (QR expirou sem pagamento / provedor
  -- indisponível na criação): silêncio total — não houve pagamento, não há
  -- estorno, e o texto genérico abaixo fala em "estorno automático no cartão".
  IF NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') IN ('pix_expired', 'pix_create_failed') THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object('route', 'TripDetail', 'params', jsonb_build_object('bookingId', NEW.id));

  -- Frase de estorno conforme o meio de pagamento efetivamente usado.
  v_pix := NEW.pix_paid_at IS NOT NULL AND NEW.stripe_payment_intent_id IS NULL;
  v_refund_text := CASE
    WHEN v_pix THEN 'A devolução do Pix será processada pela nossa equipe em até 5 dias úteis.'
    ELSE 'Caso tenha pago, o estorno é automático no cartão (5 a 10 dias). Em caso de dúvida, fale com o suporte.'
  END;

  -- Aceite
  IF OLD.status IN ('pending', 'paid') AND NEW.status = 'confirmed' THEN
    v_key := 'client:accepted';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Motorista aceitou sua viagem!',
          'O motorista confirmou a viagem. Acompanhe os detalhes pelo app.',
          'travel_updates', 'cliente', v_data);
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Concluída
  IF OLD.status = 'confirmed' AND NEW.status = 'paid' THEN
    v_key := 'client:completed';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Você chegou ao destino.',
          'Viagem concluída. Toque para avaliar sua corrida.',
          'travel_updates', 'cliente',
          jsonb_build_object('route', 'RateTrip', 'params', jsonb_build_object('bookingId', NEW.id)));
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada pelo motorista
  IF OLD.status IN ('pending', 'paid', 'confirmed')
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'driver\_%' ESCAPE '\' THEN
    v_key := 'client:cancelled_by_driver';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Motorista cancelou sua viagem',
          'O motorista cancelou esta viagem. ' || v_refund_text,
          'travel_updates', 'cliente', v_data);
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelada por admin/sistema/expiração (não motorista, não auto-cancel do passageiro)
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND COALESCE(NEW.cancellation_reason, '') NOT LIKE 'driver\_%' ESCAPE '\'
     AND COALESCE(NEW.cancellation_reason, '') <> 'passenger_cancellation' THEN
    v_key := 'client:cancelled';
    IF NOT (COALESCE(NEW.status_change_notified, '{}'::jsonb) ? v_key) THEN
      IF public.should_notify_user(v_user, 'travel_updates') THEN
        INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
        VALUES (v_user, 'Sua viagem foi cancelada',
          'Sua viagem foi cancelada. ' || v_refund_text,
          'travel_updates', 'cliente', v_data);
      END IF;
      UPDATE public.bookings SET status_change_notified = COALESCE(status_change_notified, '{}'::jsonb) || jsonb_build_object(v_key, now()) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;
