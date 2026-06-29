-- Permite que um participante (cliente OU motorista) marque como lidas as
-- mensagens RECEBIDAS de uma conversa (read_at). A RLS de messages só tinha
-- UPDATE para admin/suporte, então o "visualizado" (✓✓) nunca aparecia nos
-- chats cliente↔motorista. SECURITY DEFINER + guarda de participante torna isso
-- seguro (só marca mensagens de quem NÃO é o chamador).
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.driver_id = auth.uid() OR c.client_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

  UPDATE public.messages
     SET read_at = now()
   WHERE conversation_id = p_conversation_id
     AND sender_id IS DISTINCT FROM auth.uid()
     AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_read(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO service_role;
