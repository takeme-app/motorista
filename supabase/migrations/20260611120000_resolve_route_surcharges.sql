-- ============================================================================
-- Função: resolve_route_surcharges
-- ============================================================================
-- Resolve os adicionais (surcharge_catalog) vinculados a um trecho
-- (pricing_routes) via a tabela de junção pricing_route_surcharges.
--
-- Usada tanto pelo app do cliente (preview de preço) quanto pelas edge
-- functions de cobrança (charge-booking), garantindo paridade entre o valor
-- exibido e o valor cobrado.
--
-- Regras:
--   - Soma TODOS os adicionais vinculados ao trecho (ignora surcharge_mode;
--     o vínculo admin → trecho já expressa a intenção de aplicação).
--   - value_cents = override do vínculo (pricing_route_surcharges.value_cents)
--     quando informado; caso contrário usa surcharge_catalog.default_value_cents.
--   - Considera apenas adicionais ativos (surcharge_catalog.is_active = true).
--
-- security definer: contorna RLS para o cliente autenticado ler o catálogo
-- e a junção sem expor as tabelas diretamente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_route_surcharges(p_pricing_route_id uuid)
RETURNS TABLE (id uuid, name text, value_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sc.id,
         sc.name,
         GREATEST(0, COALESCE(prs.value_cents, sc.default_value_cents))::int AS value_cents
  FROM public.pricing_route_surcharges prs
  JOIN public.surcharge_catalog sc ON sc.id = prs.surcharge_id
  WHERE prs.pricing_route_id = p_pricing_route_id
    AND sc.is_active = true;
$$;

COMMENT ON FUNCTION public.resolve_route_surcharges(uuid) IS
  'Adicionais ativos vinculados a um trecho (pricing_route), com override de value_cents. Soma todos os vínculos (ignora surcharge_mode).';

REVOKE ALL ON FUNCTION public.resolve_route_surcharges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_route_surcharges(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_route_surcharges(uuid) TO service_role;
