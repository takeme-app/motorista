-- Pontos nomeados globais (lat/lng/nome) cadastrados pelo admin direto no banco.
-- Aparecem como sugestões na busca de endereço do app cliente e no admin (PlacesAddressInput),
-- mostrando o NOME. Leitura pública (authenticated); escrita só admin.
-- Não há tela de configuração — o admin insere/edita via SQL/MCP.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

CREATE TABLE IF NOT EXISTS public.custom_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,            -- opcional; se vazio, usa o nome como endereço exibido
  city text,
  state text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_places_active ON public.custom_places (is_active);

ALTER TABLE public.custom_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_places read" ON public.custom_places;
CREATE POLICY "custom_places read" ON public.custom_places
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "custom_places admin insert" ON public.custom_places;
CREATE POLICY "custom_places admin insert" ON public.custom_places
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "custom_places admin update" ON public.custom_places;
CREATE POLICY "custom_places admin update" ON public.custom_places
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "custom_places admin delete" ON public.custom_places;
CREATE POLICY "custom_places admin delete" ON public.custom_places
  FOR DELETE TO authenticated USING (public.is_admin());
