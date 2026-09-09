-- Trava de servidor: pedido Pix só entra com cobrança do provedor configurado.
--
-- Até aqui a garantia de "Pix real" era só do app: as telas leem
-- platform_settings.pix_provider e, quando não é 'palliative', mandam para o
-- create-pix-charge. Mas as policies de INSERT só checam auth.uid() = user_id,
-- então QUALQUER versão do app podia inserir um pedido payment_method='pix'
-- sem pix_charge_id — que é exatamente o que o fluxo paliativo faz, e o que
-- gerou pedidos sem pagamento em 31/08 e 02/09, inclusive DEPOIS da correção
-- do app ter sido publicada (aparelho que ainda não tinha reiniciado).
--
-- Agora o banco recusa. Enquanto a flag do admin não for 'palliative', pedido
-- Pix sem cobrança é erro, não pedido grátis. Chave ausente ou ilegível ⇒
-- 'palliative' ⇒ trava desligada (fail-safe: config quebrada não derruba
-- venda).
--
-- Não afeta cartão nem dinheiro (payment_method diferente), não afeta o
-- create-pix-charge (que sempre insere com pix_charge_id) e desliga sozinha se
-- o admin voltar o provedor para paliativo.

CREATE OR REPLACE FUNCTION public.pix_provider_mode_active()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Desembrulha defensivamente {value:{...}} e {...}, como o edge function faz.
  SELECT lower(coalesce(
    ps.value #>> '{mode}',
    ps.value #>> '{value,mode}',
    'palliative'
  ))
  FROM public.platform_settings ps
  WHERE ps.key = 'pix_provider'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.trg_block_pix_order_without_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text;
BEGIN
  IF lower(coalesce(NEW.payment_method, '')) <> 'pix' THEN RETURN NEW; END IF;
  IF NEW.pix_charge_id IS NOT NULL THEN RETURN NEW; END IF;

  v_mode := coalesce(public.pix_provider_mode_active(), 'palliative');
  IF v_mode = 'palliative' THEN RETURN NEW; END IF;

  RAISE EXCEPTION
    'Atualize o aplicativo Take Me para pagar com Pix. Esta versão tenta criar o pedido sem gerar a cobrança.'
    USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS on_booking_block_pix_without_charge ON public.bookings;
CREATE TRIGGER on_booking_block_pix_without_charge
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.trg_block_pix_order_without_charge();

DROP TRIGGER IF EXISTS on_shipment_block_pix_without_charge ON public.shipments;
CREATE TRIGGER on_shipment_block_pix_without_charge
BEFORE INSERT ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.trg_block_pix_order_without_charge();

DROP TRIGGER IF EXISTS on_dependent_shipment_block_pix_without_charge ON public.dependent_shipments;
CREATE TRIGGER on_dependent_shipment_block_pix_without_charge
BEFORE INSERT ON public.dependent_shipments
FOR EACH ROW EXECUTE FUNCTION public.trg_block_pix_order_without_charge();
