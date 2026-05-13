-- Timeout do handoff do preparador → fallback motorista
--
-- Regra de produto: depois que o motorista aceita um envio com base
-- configurada (`shipments.base_id NOT NULL`), o preparador da base tem até
-- 1 hora antes do `scheduled_trips.departure_at` para "reclamar" a coleta.
-- Se nenhum preparador reclamar a tempo, o motorista assume a coleta direta
-- (busca na casa do cliente) — exatamente como envios sem base.
--
-- Esta migration NÃO altera quem é ofertado primeiro (continua motorista-first
-- desde 20260424200000). Apenas adiciona o prazo de handoff + cron que expira
-- + bloqueio do preparador após expirar.
--
-- A notificação push ao motorista é responsabilidade da edge function
-- `notify-preparer-handoff-expired` (segue o padrão de
-- `notify-driver-upcoming-trips`): cron externo do Supabase Dashboard chama a
-- function a cada 1–2 minutos, ela lê `preparer_handoff_expired_at IS NOT NULL
-- AND preparer_handoff_notified_at IS NULL`, insere notification e marca.

-- 1. Colunas
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS preparer_handoff_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparer_handoff_expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparer_handoff_notified_at timestamptz;

COMMENT ON COLUMN public.shipments.preparer_handoff_expires_at IS
  'Prazo para qualquer preparador da base reclamar a coleta. Setado em shipment_driver_accept_offer como scheduled_trip.departure_at - 1h.';
COMMENT ON COLUMN public.shipments.preparer_handoff_expired_at IS
  'NOT NULL quando shipment_process_expired_preparer_handoffs declarou que ninguém da base reclamou a tempo. Motorista assume a coleta direta.';
COMMENT ON COLUMN public.shipments.preparer_handoff_notified_at IS
  'NOT NULL após edge function notify-preparer-handoff-expired ter inserido a notificação para o motorista.';

-- Índice partial para o cron — leitura barata quando há muitos envios completos no histórico.
CREATE INDEX IF NOT EXISTS idx_shipments_preparer_handoff_pending
  ON public.shipments (preparer_handoff_expires_at)
  WHERE base_id IS NOT NULL
    AND preparer_id IS NULL
    AND preparer_handoff_expired_at IS NULL;

-- 2. shipment_driver_accept_offer — passa a setar o deadline ao aceitar.
-- Cópia integral da última versão (20260415160000_shipment_driver_offer_window_30_minutes.sql)
-- + bloco do preparer_handoff_expires_at no UPDATE final.
CREATE OR REPLACE FUNCTION public.shipment_driver_accept_offer(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.shipments%ROWTYPE;
  trip_id uuid;
  trip_departure timestamptz;
BEGIN
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF s.current_offer_driver_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_offer');
  END IF;
  IF s.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_assigned');
  END IF;
  IF s.current_offer_expires_at IS NOT NULL AND s.current_offer_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_expired');
  END IF;

  SELECT st.id, st.departure_at INTO trip_id, trip_departure
  FROM public.scheduled_trips st
  WHERE st.driver_id = auth.uid()
    AND st.status = 'active'
    AND st.is_active IS TRUE
    AND st.driver_journey_started_at IS NULL
    AND st.departure_at > now()
    AND public.shipment_same_route_as_trip(
      s.origin_lat, s.origin_lng, s.destination_lat, s.destination_lng,
      st.origin_lat, st.origin_lng, st.destination_lat, st.destination_lng
    )
  ORDER BY st.departure_at ASC
  LIMIT 1;

  IF trip_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_matching_trip');
  END IF;

  UPDATE public.shipments
  SET
    driver_id = auth.uid(),
    driver_accepted_at = now(),
    scheduled_trip_id = trip_id,
    current_offer_driver_id = NULL,
    current_offer_expires_at = NULL,
    driver_offer_index = -1,
    driver_offer_queue = NULL,
    -- Handoff só aplica para envios com base — preparador opera dentro da base.
    -- Deadline = departure_at - 1h. Se o motorista aceitar com departure_at no
    -- passado (não deveria acontecer; já há filtro acima), expires fica
    -- imediato e o cron expira no próximo tick.
    preparer_handoff_expires_at = CASE
      WHEN s.base_id IS NOT NULL THEN trip_departure - INTERVAL '1 hour'
      ELSE NULL
    END
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object('ok', true, 'scheduled_trip_id', trip_id);
END;
$$;

REVOKE ALL ON FUNCTION public.shipment_driver_accept_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shipment_driver_accept_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_driver_accept_offer(uuid) TO service_role;

-- 3. shipment_preparer_accept_claim — rejeita após expirar.
-- Cópia integral da versão atual (20260424220000) + guard.
CREATE OR REPLACE FUNCTION public.shipment_preparer_accept_claim(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.shipments%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF s.base_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_base');
  END IF;
  IF NOT public.worker_is_shipments_preparer_for_base(s.base_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF s.driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_driver');
  END IF;
  -- Novo guard: depois que o cron declarou expirado, o motorista assume.
  -- Preparador não pode mais reclamar.
  IF s.preparer_handoff_expired_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'preparer_handoff_expired');
  END IF;
  IF s.preparer_id IS NOT NULL AND s.preparer_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
  END IF;
  IF s.preparer_id = auth.uid() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  UPDATE public.shipments
  SET preparer_id = auth.uid()
  WHERE id = p_shipment_id
    AND preparer_id IS NULL
    AND preparer_handoff_expired_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.shipment_preparer_accept_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shipment_preparer_accept_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_preparer_accept_claim(uuid) TO service_role;

-- 4. preparer_shipment_queue — esconde envios expirados da fila.
CREATE OR REPLACE FUNCTION public.preparer_shipment_queue()
RETURNS SETOF public.shipments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
  FROM public.shipments s
  INNER JOIN public.worker_profiles wp
    ON wp.id = auth.uid()
   AND wp.subtype = 'shipments'
   AND wp.base_id IS NOT NULL
   AND wp.base_id = s.base_id
  WHERE s.driver_id IS NOT NULL
    AND s.status IN ('pending_review', 'confirmed')
    AND s.base_id IS NOT NULL
    AND s.preparer_handoff_expired_at IS NULL
    AND (s.preparer_id IS NULL OR s.preparer_id = auth.uid())
  ORDER BY s.driver_accepted_at DESC NULLS LAST, s.created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.preparer_shipment_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preparer_shipment_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.preparer_shipment_queue() TO service_role;

-- 5. RPC do cron: declara envios expirados (apenas marca o timestamp).
-- Push fica a cargo da edge function notify-preparer-handoff-expired.
CREATE OR REPLACE FUNCTION public.shipment_process_expired_preparer_handoffs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.shipments
    SET preparer_handoff_expired_at = now()
    WHERE base_id IS NOT NULL
      AND preparer_id IS NULL
      AND preparer_handoff_expires_at IS NOT NULL
      AND preparer_handoff_expires_at <= now()
      AND preparer_handoff_expired_at IS NULL
      AND status IN ('confirmed', 'in_progress')
    RETURNING id
  )
  SELECT count(*) INTO expired_count FROM expired;
  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.shipment_process_expired_preparer_handoffs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shipment_process_expired_preparer_handoffs() TO service_role;

COMMENT ON FUNCTION public.shipment_process_expired_preparer_handoffs() IS
  'Cron a cada minuto: marca preparer_handoff_expired_at em envios cujo deadline passou sem preparer_id. Não envia push — isso é trabalho da edge function notify-preparer-handoff-expired.';

-- 6. Agenda o cron via pg_cron (segue o padrão de 20260417093500).
DO $cron$
DECLARE
  jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'shipment-process-expired-preparer-handoffs'
    LOOP
      PERFORM cron.unschedule(jid);
    END LOOP;
    PERFORM cron.schedule(
      'shipment-process-expired-preparer-handoffs',
      '* * * * *',
      $$SELECT public.shipment_process_expired_preparer_handoffs();$$
    );
  END IF;
END;
$cron$;
