-- =====================================================================
-- Notificação de chat: deeplink completo para a tela de Chat.
--
-- ANTES: trigger gerava `data = { route:'Chat', params:{ conversationId } }`.
--   - Motorista: rota 'Chat' resolvia em Profile→Chat, mas tela ficava sem
--     nome/avatar do remetente até o fetch interno carregar.
--   - Cliente: idem (Chat em ActivitiesStack/ProfileStack).
--   - Conversação de suporte abria sem `supportBackoffice: true`, então o
--     cliente caía em Chat genérico ao invés do contexto suporte.
--
-- AGORA:
--   - driver_client → motorista usa `DriverClientChat` (root); cliente
--     usa `Chat` (resolver navega para Activities→Chat).
--   - support_backoffice → cliente recebe `supportBackoffice: true`;
--     motorista usa `Chat` (Profile stack), `participantName: 'Takeme Suporte'`.
--   - Em ambos os casos `data.params` inclui nome+avatar do remetente,
--     evitando flash de "Carregando" ao abrir.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_chat_message_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_conv RECORD;
  v_recipient uuid;
  v_app_slug text;
  v_preview text;
  v_title text;
  v_has_worker boolean;
  v_route text;
  v_params jsonb;
  v_sender_name text;
  v_sender_avatar text;
BEGIN
  SELECT
    id, driver_id, client_id, admin_id,
    support_requester_id, conversation_kind
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

    SELECT p.full_name, p.avatar_url INTO v_sender_name, v_sender_avatar
    FROM public.profiles p WHERE p.id = NEW.sender_id;

    IF v_app_slug = 'motorista' THEN
      v_route := 'DriverClientChat';
      v_params := jsonb_build_object(
        'conversationId', NEW.conversation_id,
        'participantName', COALESCE(NULLIF(BTRIM(v_sender_name), ''), 'Cliente'),
        'participantAvatar', v_sender_avatar
      );
    ELSE
      v_route := 'Chat';
      v_params := jsonb_build_object(
        'conversationId', NEW.conversation_id,
        'contactName', COALESCE(NULLIF(BTRIM(v_sender_name), ''), 'Motorista'),
        'participantAvatarKey', v_sender_avatar
      );
    END IF;

  ELSIF v_conv.conversation_kind = 'support_backoffice' THEN
    IF NEW.sender_id = v_conv.admin_id AND v_conv.support_requester_id IS NOT NULL THEN
      v_recipient := v_conv.support_requester_id;
      SELECT EXISTS (
        SELECT 1 FROM public.worker_profiles wp WHERE wp.id = v_recipient
      ) INTO v_has_worker;
      v_app_slug := CASE WHEN v_has_worker THEN 'motorista' ELSE 'cliente' END;
    ELSE
      RETURN NEW;
    END IF;
    v_title := 'Takeme Suporte — Nova mensagem';

    IF v_app_slug = 'cliente' THEN
      v_route := 'Chat';
      v_params := jsonb_build_object(
        'conversationId', NEW.conversation_id,
        'contactName', 'Takeme Suporte',
        'supportBackoffice', true
      );
    ELSE
      v_route := 'Chat';
      v_params := jsonb_build_object(
        'conversationId', NEW.conversation_id,
        'participantName', 'Takeme Suporte'
      );
    END IF;

  ELSE
    RETURN NEW;
  END IF;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

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
    jsonb_build_object('route', v_route, 'params', v_params)
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.notify_chat_message_received() IS
  'Notifica destinatário de mensagem nova. Deeplink leva a DriverClientChat (motorista cliente) ou Chat (cliente / suporte) com participantName/avatar e supportBackoffice quando aplicável.';
