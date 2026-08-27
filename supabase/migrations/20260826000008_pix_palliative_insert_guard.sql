-- Guard de servidor: bloqueia INSERT de booking Pix "paliativo" (sem cobrança
-- ancorada) quando o provedor real está ativo para aquele usuário.
--
-- A matriz de compatibilidade do rollout DEPENDE deste guard: um app antigo
-- (sem OTA) ou um app novo cuja leitura da flag falhou (timeout) cai no fluxo
-- paliativo — que insere o booking direto, sem cobrança. Sem este trigger,
-- com o Asaas ativo, isso criaria reserva sem pagamento verificado, com vaga
-- ocupada e motorista notificado. Com ele, o insert é rejeitado com um erro
-- identificável; o app mostra "tentar novamente" e, no retry, relê a flag.
--
-- Regra do provedor efetivo (a MESMA de create-pix-charge e do app):
--   allowlist inclui o usuário && test_provider definido ? test_provider : mode
--
-- Não afeta: cartão/dinheiro (payment_method != 'pix'), Pix real (o booking do
-- create-pix-charge já nasce com pix_charge_id), e o modo palliative (default).

CREATE OR REPLACE FUNCTION public.enforce_pix_provider_on_booking_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw jsonb;
  v_cfg jsonb;
  v_mode text;
  v_test text;
  v_allow jsonb;
  v_effective text;
BEGIN
  -- Só governa Pix sem cobrança ancorada; todo o resto passa intacto.
  IF NEW.payment_method IS DISTINCT FROM 'pix' OR NEW.pix_charge_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_raw FROM public.platform_settings WHERE key = 'pix_provider';
  IF v_raw IS NULL THEN
    RETURN NEW; -- sem flag = paliativo (default histórico)
  END IF;

  v_cfg := COALESCE(v_raw->'value', v_raw); -- unwrap defensivo ({value} ou flat)
  v_mode := COALESCE(NULLIF(v_cfg->>'mode', ''), 'palliative');
  v_test := NULLIF(v_cfg->>'test_provider', '');
  v_allow := CASE
    WHEN jsonb_typeof(v_cfg->'allowlist_user_ids') = 'array' THEN v_cfg->'allowlist_user_ids'
    ELSE '[]'::jsonb
  END;

  v_effective := v_mode;
  IF v_test IS NOT NULL AND NEW.user_id IS NOT NULL AND v_allow ? (NEW.user_id::text) THEN
    v_effective := v_test;
  END IF;

  IF v_effective IS DISTINCT FROM 'palliative' THEN
    RAISE EXCEPTION 'pix_provider_not_active: o pagamento Pix agora é confirmado automaticamente. Atualize o app e tente novamente.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bookings_enforce_pix_provider ON public.bookings;
CREATE TRIGGER trg_bookings_enforce_pix_provider
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_pix_provider_on_booking_insert();

COMMENT ON FUNCTION public.enforce_pix_provider_on_booking_insert() IS
  'Rejeita booking Pix sem pix_charge_id quando o provedor efetivo do usuário não é palliative — impede reserva paliativa sem cobrança com o Pix real ativo (apps antigos/fallback).';
