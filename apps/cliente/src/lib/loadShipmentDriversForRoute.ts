import { loadClientScheduledTrips, compareTripsByDepartureAndBadge, type ClientScheduledTripItem } from './clientScheduledTrips';
import { sameShipmentRouteCoords } from './routeCoordsMatch';

/**
 * Motoristas com viagem agendada na mesma rota (origem + destino), mesma ordenação da lista de viagens.
 * Com `hubDestination`, o destino comparado é o da base (trecho hub origem→base), alinhado ao RPC `shipment_same_route_as_trip` quando o backend passar coords da base.
 *
 * Capacidade: por padrão usa o filtro `seats_available > 0` (alinhado com Viagens/Dependentes).
 * Para Encomendas, passar `skipCapacityFilter: true` — a encomenda não consome
 * assento, então uma viagem cheia de passageiros mas com espaço de carga deve aparecer.
 * A aceitação real fica com o motorista no momento da oferta.
 */
export async function loadShipmentDriversForRoute(params: {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  hubDestination?: { latitude: number; longitude: number };
  skipCapacityFilter?: boolean;
}): Promise<{ items: ClientScheduledTripItem[]; error: string | null }> {
  const { items, error } = await loadClientScheduledTrips({
    applyBookingsPromoToList: false,
    skipCapacityFilter: params.skipCapacityFilter,
  });
  if (error) return { items: [], error };
  const destLat = params.hubDestination?.latitude ?? params.destinationLat;
  const destLng = params.hubDestination?.longitude ?? params.destinationLng;
  const filtered = items.filter((t) =>
    sameShipmentRouteCoords(
      {
        originLat: params.originLat,
        originLng: params.originLng,
        destinationLat: destLat,
        destinationLng: destLng,
      },
      {
        originLat: t.origin_lat,
        originLng: t.origin_lng,
        destinationLat: t.latitude,
        destinationLng: t.longitude,
      }
    )
  );
  filtered.sort(compareTripsByDepartureAndBadge);
  return { items: filtered, error: null };
}
