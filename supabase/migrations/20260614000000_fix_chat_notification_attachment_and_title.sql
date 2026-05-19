-- Corrige a notificação de chat para:
--  1) Disparar push em mensagens com apenas anexo (image/audio/file) — antes
--     `content=''` fazia a trigger retornar sem inserir nada em notifications.
--  2) Usar título adequado por tipo de conversa — antes todas as conversas
--     (inclusive driver_client) recebiam "Takeme Suporte Nova mensagem".
--
-- Preview baseado em `message_kind` usa o mesmo padrão de `handle_new_message`
-- (📷 Foto / 🎤 Áudio / 📎 Arquivo) para coerência entre o resumo da conversa
-- e o conteúdo do push.

CREATE OR REPLACE FUNCTION public.notify_chat_message_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_recipient uuid;
  v_app_slug text;
  v_preview text;
  v_title text;
  v_has_worker boolean;
BEGIN
  SELECT
    id,
    driver_id,
    client_id,
    admin_id,
    support_requester_id,
    conversation_kind
  INTO v_conv
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_conv.conversation_kind = 'driver_client' THEN
    IF NEW.sender_id = v_conv.client_id THEN
      v_recipient := v_conv.driver_id;
      v_app_slug := 'motorista';
    ELSIF NEW.sender_id = v_conv.driver_id THEN
      v_recipient := v_conv.client_id;
      v_app_slug := 'cliente';
    ELSE
      RETURN NEW;
    END IF;
    v_title := 'Nova mensagem';

  ELSIF v_conv.conversation_kind = 'support_backoffice' THEN
    IF NEW.sender_id = v_conv.admin_id AND v_conv.support_requester_id IS NOT NULL THEN
      v_recipient := v_conv.support_requester_id;
      SELECT EXISTS (
        SELECT 1 FROM public.worker_profiles wp
        WHERE wp.id = v_recipient
      ) INTO v_has_worker;
      v_app_slug := CASE WHEN v_has_worker THEN 'motorista' ELSE 'cliente' END;
    ELSE
      RETURN NEW;
    END IF;
    v_title := 'Takeme Suporte — Nova mensagem';

  ELSE
    RETURN NEW;
  END IF;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  -- Preview: prefere o texto digitado; se vazio, deriva de message_kind para
  -- que mensagens só com anexo também gerem notificação.
  v_preview := COALESCE(
    NULLIF(TRIM(NEW.content), ''),
    CASE NEW.message_kind
      WHEN 'image' THEN '📷 Foto'
      WHEN 'audio' THEN '🎤 Áudio'
      WHEN 'file'  THEN '📎 Arquivo'
      ELSE ''
    END
  );
  IF v_preview = '' THEN
    RETURN NEW;
  END IF;
  v_preview := LEFT(v_preview, 150);

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  VALUES (
    v_recipient,
    v_title,
    v_preview,
    'chat_message',
    v_app_slug,
    jsonb_build_object(
      'route', 'Chat',
      'params', jsonb_build_object('conversationId', NEW.conversation_id)
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_chat_message_received() IS
  'Dispara push de chat. Título: "Nova mensagem" (driver_client) ou "Takeme Suporte — Nova mensagem" (support_backoffice). Preview de anexos vem de message_kind quando content é vazio.';

-- O trigger não estava registrado em public.messages (provavelmente perdido em
-- migration anterior). Sem ele a função nunca era chamada — recriado aqui.
DROP TRIGGER IF EXISTS trg_notify_chat_message_received ON public.messages;
CREATE TRIGGER trg_notify_chat_message_received
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_chat_message_received();
