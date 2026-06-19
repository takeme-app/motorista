-- Vincula a conversa de excursão à própria excursão (excursion_request_id), do mesmo modo
-- que bookings usam booking_id e encomendas usam shipment_id.
--
-- Antes: a conversa preparador<->cliente de excursão não tinha vínculo de entidade e era
-- resolvida/fechada apenas pelo par (driver_id = preparer_id, client_id). Com isso, ao concluir
-- uma excursão a conversa do par era fechada, e uma nova excursão do mesmo cliente reusava essa
-- conversa já 'closed' -> o chat abria como "Conversa encerrada".

-- 1) Coluna de vínculo com a excursão.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS excursion_request_id uuid
  REFERENCES public.excursion_requests(id) ON DELETE SET NULL;

-- 2) Uma única conversa ativa por excursão (espelha o índice de shipment).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_excursion_request_active_uidx
  ON public.conversations(excursion_request_id)
  WHERE excursion_request_id IS NOT NULL AND status = 'active';

-- 3) Backfill best-effort: vincula conversas legadas (par sem entidade) à excursão mais recente
-- daquele preparador+cliente, para que o histórico não fique órfão.
UPDATE public.conversations c
   SET excursion_request_id = e.id
  FROM (
    SELECT DISTINCT ON (preparer_id, user_id)
           id, preparer_id, user_id
      FROM public.excursion_requests
     WHERE preparer_id IS NOT NULL
     ORDER BY preparer_id, user_id, created_at DESC
  ) e
 WHERE c.excursion_request_id IS NULL
   AND c.booking_id IS NULL
   AND c.shipment_id IS NULL
   AND COALESCE(c.conversation_kind, 'driver_client') <> 'support_backoffice'
   AND c.driver_id = e.preparer_id
   AND c.client_id = e.user_id;

-- 4) Fechamento por entidade: ao concluir/cancelar UMA excursão, fecha somente a conversa daquela
-- excursão (e não todas do par preparador+cliente).
CREATE OR REPLACE FUNCTION public.close_conversation_on_excursion_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.conversations
       SET status = 'closed', updated_at = now()
     WHERE excursion_request_id = NEW.id
       AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger já existe (criado em 20260702000013); a função acima o substitui.
