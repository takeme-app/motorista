-- E-mail de usuários para o painel admin.
--
-- profiles NÃO tem coluna de e-mail (ele vive em auth.users, fora do alcance
-- do PostgREST) — queries.ts:3771 já registrava isso com um campo vazio. O
-- admin precisa do e-mail nos detalhes de cobrança e devolução Pix para
-- contatar quem pagou, então esta RPC faz a ponte.
--
-- SECURITY DEFINER para alcançar auth.users, com guard de is_admin() ANTES de
-- qualquer leitura: sem isso, qualquer usuário autenticado enumeraria e-mails
-- de toda a base passando uma lista de uuids.
CREATE OR REPLACE FUNCTION public.admin_lookup_user_emails(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Teto defensivo: a tela busca os ids da página atual, nunca a base inteira.
  IF array_length(p_user_ids, 1) > 200 THEN
    RAISE EXCEPTION 'too_many_ids';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY (p_user_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_lookup_user_emails(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_user_emails(uuid[]) TO authenticated;
