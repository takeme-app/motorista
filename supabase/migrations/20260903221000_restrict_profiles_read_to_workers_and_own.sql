-- Quarta policy do mesmo erro: "Authenticated admin can read all profiles"
-- usava auth.role() = 'authenticated', então qualquer usuário logado lia a
-- tabela de perfis inteira — 12 perfis, 7 deles com CPF exposto.
--
-- Aqui não bastava remover: o app do cliente precisa do perfil do MOTORISTA
-- (nome, avatar, nota) ao navegar viagens, no card da corrida e no chat.
-- Removendo sem substituta, o cliente deixava de ver o motorista da própria
-- viagem — medido: ve_o_motorista = 0.
--
-- Substituta: perfil de TRABALHADOR é legível por quem está logado; perfil de
-- cliente, não. A checagem passa por função SECURITY DEFINER porque
-- worker_profiles tem RLS própria e um cliente comum lê 0 linhas dela — um
-- EXISTS direto na policy avaliaria sempre falso.
--
-- Verificado com a identidade de um cliente comum:
--   vê o motorista da viagem      sim
--   vê o próprio perfil           sim
--   vê o perfil de outro cliente  NÃO (antes via)
--
-- Dívida registrada: o perfil do trabalhador é devolvido inteiro, incluindo
-- CPF e telefone. O certo é uma view com só nome/avatar/nota.
CREATE OR REPLACE FUNCTION public.profile_is_worker(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.worker_profiles w WHERE w.id = p_id)
$$;

DROP POLICY IF EXISTS "Authenticated can read worker profiles" ON public.profiles;
CREATE POLICY "Authenticated can read worker profiles"
ON public.profiles
FOR SELECT
USING (public.profile_is_worker(id));

DROP POLICY IF EXISTS "Authenticated admin can read all profiles" ON public.profiles;
