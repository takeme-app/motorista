-- Habilita Realtime (Postgres Changes) para excursion_requests, para o app
-- cliente atualizar o tracking de status ao vivo. RLS já restringe SELECT ao
-- dono (user_id = auth.uid()), então o realtime respeita a mesma política.
ALTER PUBLICATION supabase_realtime ADD TABLE public.excursion_requests;
