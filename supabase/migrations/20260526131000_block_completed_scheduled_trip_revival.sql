-- =====================================================================
-- Bloqueia "ressuscitar" scheduled_trips finalizadas/canceladas.
--
-- CONTEXTO: Bug reproduzido — uma viagem agendada para 22h, iniciada às
-- 20h e completada antes das 22h voltava a ficar disponível para
-- bookings/shipments e o motorista podia "iniciar novamente",
-- aparecendo passageiros residuais.
--
-- Causas (auditoria 2026-05-26):
--   1) Não há proteção no banco contra a transição status='completed' -> 'active'.
--      O CHECK só valida valores; nenhuma trigger valida transições.
--      `motorista_complete_scheduled_trip` reseta `driver_journey_started_at=NULL`
--      mas a RPC ou UPDATE direto pode mudar status de volta para 'active'.
--   2) A RPC complete não finaliza bookings 'confirmed' — eles continuam
--      atrelados à trip e reaparecem se a trip for reativada.
--
-- Esta migration:
--   A) Cria trigger BEFORE UPDATE OF status que bloqueia transições
--      completed -> * e cancelled -> * (ambos estados são finais).
--   B) Atualiza RPC `motorista_complete_scheduled_trip` para também
--      marcar bookings 'confirmed' da trip como 'paid' (transição
--      terminal de booking = "passageiro desembarcou"). O trigger
--      existente `notify_client_booking_phase_change` já notifica o
--      cliente nessa transição ("Você chegou ao destino").
--   C) UPDATE single-shot para sanitizar trips completed antigas que
--      ainda possuem bookings 'confirmed' pendentes.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A) Trigger guard: bloqueia revival de trip finalizada/cancelada
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_scheduled_trip_no_revive_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'scheduled_trip_completed_is_final'
      USING ERRCODE = 'P0001',
            HINT = 'Esta viagem já foi finalizada. Crie uma nova viagem para receber novas reservas.';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'scheduled_trip_cancelled_is_final'
      USING ERRCODE = 'P0001',
            HINT = 'Esta viagem foi cancelada e não pode ser reativada.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scheduled_trip_no_revive ON public.scheduled_trips;
CREATE TRIGGER trg_guard_scheduled_trip_no_revive
  BEFORE UPDATE OF status ON public.scheduled_trips
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_scheduled_trip_no_revive_completed();

COMMENT ON FUNCTION public.guard_scheduled_trip_no_revive_completed() IS
  'Bloqueia transições saindo de status=completed ou status=cancelled em scheduled_trips. Estados finais são imutáveis.';


-- ---------------------------------------------------------------------
-- B) RPC complete: agora também fecha bookings 'confirmed' como 'paid'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.motorista_complete_scheduled_trip(
  p_trip_id uuid,
  p_expense_paths text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT st.driver_id
  INTO v_driver
  FROM public.scheduled_trips st
  WHERE st.id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_driver IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_trip');
  END IF;

  -- Fecha bookings ativos como pagos (transição terminal — passageiro desembarcou).
  -- O trigger notify_client_booking_phase_change (em 20260526130000) dispara
  -- "Você chegou ao destino." para cada um.
  UPDATE public.bookings
  SET status = 'paid', updated_at = now()
  WHERE scheduled_trip_id = p_trip_id
    AND status = 'confirmed';

  -- Marca a trip como concluída.
  UPDATE public.scheduled_trips
  SET
    status = 'completed',
    is_active = false,
    driver_journey_started_at = NULL,
    driver_expense_paths = COALESCE(p_expense_paths, driver_expense_paths),
    updated_at = now()
  WHERE id = p_trip_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;


-- ---------------------------------------------------------------------
-- C) Cleanup single-shot: bookings 'confirmed' órfãos de trips completed
-- ---------------------------------------------------------------------
UPDATE public.bookings b
SET status = 'paid', updated_at = now()
FROM public.scheduled_trips st
WHERE b.scheduled_trip_id = st.id
  AND st.status = 'completed'
  AND b.status = 'confirmed';
