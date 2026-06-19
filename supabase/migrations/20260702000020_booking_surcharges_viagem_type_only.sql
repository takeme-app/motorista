-- Garante que o preço da viagem use APENAS adicionais do tipo 'viagem'.
-- A parte "automáticos" já filtrava por tipo; aqui passamos a filtrar também a parte
-- "vinculados ao trecho" (pricing_route_surcharges), evitando que um adicional de
-- encomenda/excursão mal-vinculado a um trecho de motorista vaze para a viagem.
CREATE OR REPLACE FUNCTION public.resolve_booking_surcharges_cents(p_pricing_route_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- (a) adicionais 'viagem' vinculados ao trecho (override de value_cents quando houver)
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(prs.value_cents, sc.default_value_cents)))
      FROM public.pricing_route_surcharges prs
      JOIN public.surcharge_catalog sc ON sc.id = prs.surcharge_id
      WHERE prs.pricing_route_id = p_pricing_route_id
        AND sc.is_active = true
        AND sc.surcharge_type = 'viagem'
    ), 0)
    +
    -- (b) adicionais automáticos do catálogo 'viagem' (não duplica os já vinculados ao trecho)
    COALESCE((
      SELECT SUM(GREATEST(0, sc.default_value_cents))
      FROM public.surcharge_catalog sc
      WHERE sc.surcharge_type = 'viagem'
        AND sc.surcharge_mode = 'automatic'
        AND sc.is_active = true
        AND (
          p_pricing_route_id IS NULL
          OR sc.id NOT IN (
            SELECT prs.surcharge_id
            FROM public.pricing_route_surcharges prs
            WHERE prs.pricing_route_id = p_pricing_route_id
          )
        )
    ), 0)
  )::int;
$$;
