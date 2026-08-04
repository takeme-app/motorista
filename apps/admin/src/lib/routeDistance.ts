import { getMapboxAccessToken } from './expoExtra';

/**
 * Distância e duração REAIS de direção via Mapbox Directions (mesma fonte usada no
 * app do cliente). `overview=false` — só precisamos de distance/duration, não da geometria.
 */
export async function fetchRouteDistanceDuration(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<{ distanceMeters: number; durationSeconds: number } | null> {
  const token = getMapboxAccessToken();
  if (!token) return null;
  const coordPath = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordPath}` +
    `?overview=false&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, signal ? { signal } : undefined);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{ distance?: number; duration?: number }>;
    };
    const r = data.routes?.[0];
    if (data.code !== 'Ok' || !r || typeof r.distance !== 'number') return null;
    return {
      distanceMeters: r.distance,
      durationSeconds: typeof r.duration === 'number' ? r.duration : 0,
    };
  } catch {
    return null;
  }
}

/** "18,4 km" / "820 m". */
export function formatKmLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  const km = meters / 1000;
  if (km < 1) return `${Math.round(meters)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}
