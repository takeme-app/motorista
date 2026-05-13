/** Distância em metros entre dois pontos WGS84 (fórmula de haversine). */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Mesma rota para efeito de envio / fila de motoristas: origem e destino próximos o suficiente.
 *
 * Tolerância 15 000 m em cada extremo — paridade com o fluxo de Viagens
 * (`SearchTripScreen` usa caixa de ~0.15° = ~16.5 km lat). Antes era 1500 m,
 * mas geocoding do mesmo endereço em devices/providers diferentes costuma
 * variar 300–1 000 m — fazia a viagem do motorista \"sumir\" em Encomendas/
 * Dependentes em um device mas não em outro, mesmo com Viagens funcionando.
 * Tem que casar com `public.shipment_same_route_as_trip` no banco.
 */
export function sameShipmentRouteCoords(
  a: { originLat: number; originLng: number; destinationLat: number; destinationLng: number },
  b: { originLat: number; originLng: number; destinationLat: number; destinationLng: number },
  maxEndpointMeters = 15_000
): boolean {
  return (
    haversineDistanceMeters(a.originLat, a.originLng, b.originLat, b.originLng) <= maxEndpointMeters &&
    haversineDistanceMeters(a.destinationLat, a.destinationLng, b.destinationLat, b.destinationLng) <=
      maxEndpointMeters
  );
}
