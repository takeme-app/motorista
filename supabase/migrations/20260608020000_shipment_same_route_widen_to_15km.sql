-- Amplia `shipment_same_route_as_trip` de 1500 m para 15 000 m em cada extremo.
--
-- Motivo: o limite anterior fazia a mesma viagem do motorista aparecer no fluxo
-- Viagens (cliente usa tolerância de ~16.5 km) mas sumir em Encomendas/
-- Dependentes em um device e não em outro — geocoding do mesmo endereço
-- diverge facilmente 300–1 000 m entre providers, ultrapassando os 1.5 km.
-- Alinhar o backend ao raio de Viagens garante paridade total:
-- `routeCoordsMatch.ts` no client e este RPC no servidor usam o mesmo
-- threshold de 15 000 m. As RPCs `shipment_begin_driver_offering` e
-- `shipment_driver_accept_offer` herdam a nova tolerância sem mais mudanças.

CREATE OR REPLACE FUNCTION public.shipment_same_route_as_trip(
  s_origin_lat double precision,
  s_origin_lng double precision,
  s_dest_lat double precision,
  s_dest_lng double precision,
  t_origin_lat double precision,
  t_origin_lng double precision,
  t_dest_lat double precision,
  t_dest_lng double precision
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (
      6371000::double precision * 2::double precision * asin(
        sqrt(
          least(
            1::double precision,
            greatest(
              0::double precision,
              power(sin((radians(t_origin_lat) - radians(s_origin_lat)) / 2::double precision), 2::double precision)
              + cos(radians(s_origin_lat)) * cos(radians(t_origin_lat)) * power(
                sin((radians(t_origin_lng) - radians(s_origin_lng)) / 2::double precision),
                2::double precision
              )
            )
          )
        )
      )
    ) < 15000::double precision
    AND (
      6371000::double precision * 2::double precision * asin(
        sqrt(
          least(
            1::double precision,
            greatest(
              0::double precision,
              power(sin((radians(t_dest_lat) - radians(s_dest_lat)) / 2::double precision), 2::double precision)
              + cos(radians(s_dest_lat)) * cos(radians(t_dest_lat)) * power(
                sin((radians(t_dest_lng) - radians(s_dest_lng)) / 2::double precision),
                2::double precision
              )
            )
          )
        )
      )
    ) < 15000::double precision;
$$;

COMMENT ON FUNCTION public.shipment_same_route_as_trip(
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision, double precision
) IS 'Origem e destino do envio a até 15 000 m dos pontos da viagem (haversine). Paridade com routeCoordsMatch.ts e SearchTripScreen no app cliente.';
