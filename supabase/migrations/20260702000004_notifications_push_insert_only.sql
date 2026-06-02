-- Push de notificação só em INSERT. O trigger antes era AFTER INSERT OR UPDATE,
-- o que reinvocava dispatch-notification-fcm a cada UPDATE da linha (ex.: marcar
-- como lida). O dispatch v26 já ignora UPDATE, mas isso elimina a invocação inútil
-- e qualquer risco de reenvio.
DROP TRIGGER IF EXISTS notifications_push ON public.notifications;
CREATE TRIGGER notifications_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://xdxzxyzdgwpucwuaxvik.supabase.co/functions/v1/dispatch-notification-fcm',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '2000'
  );
