/**
 * Autocomplete de endereços via Mapbox Search Box API (mesmo token dos mapas).
 *
 * Diferente da Geocoding v5 (`mapboxForwardGeocode`), a Search Box faz
 * autocomplete de verdade e prioriza POIs nomeados (Shopping, Hospital,
 * Aeroporto...). Fluxo em 2 passos:
 *   1. `mapboxSearchBoxSuggest` → lista de sugestões (SEM coordenadas).
 *   2. `mapboxSearchBoxRetrieve` → coordenadas de uma sugestão escolhida.
 * Use o MESMO `sessionToken` no suggest e no retrieve (billing por sessão).
 */
const SEARCHBOX_BASE = 'https://api.mapbox.com/search/searchbox/v1';
const DEFAULT_TYPES = 'poi,address,place,locality,neighborhood,street';

export type MapboxSuggestItem = {
  /** id opaco da Search Box; usar em `mapboxSearchBoxRetrieve` */
  mapboxId: string;
  /** nome principal (POI/rua) */
  name: string;
  /** rótulo pronto p/ exibir/selecionar: nome + localidade (sem ", Brasil") */
  address: string;
  /** cidade quando disponível */
  city?: string;
};

export type MapboxSuggestOptions = {
  proximity?: { latitude: number; longitude: number } | null;
  sessionToken?: string;
  country?: string;
  language?: string;
  limit?: number;
  types?: string;
};

type SearchBoxContext = {
  place?: { name?: string };
  region?: { name?: string; region_code?: string };
};

function trimCountrySuffix(s: string): string {
  return s.replace(/,\s*bra[sz]il\s*$/i, '').trim();
}

const DEFAULT_SESSION = 'takeme-default-session';

export async function mapboxSearchBoxSuggest(
  query: string,
  accessToken: string,
  options?: MapboxSuggestOptions,
): Promise<MapboxSuggestItem[]> {
  const q = query.trim();
  if (q.length < 2 || !accessToken.trim()) return [];

  const params = new URLSearchParams({
    access_token: accessToken,
    q,
    language: options?.language ?? 'pt',
    country: options?.country ?? 'br',
    limit: String(options?.limit ?? 10),
    types: options?.types ?? DEFAULT_TYPES,
    session_token: options?.sessionToken || DEFAULT_SESSION,
  });
  const prox = options?.proximity;
  if (prox && Number.isFinite(prox.latitude) && Number.isFinite(prox.longitude)) {
    params.set('proximity', `${prox.longitude},${prox.latitude}`);
  }

  try {
    const res = await fetch(`${SEARCHBOX_BASE}/suggest?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      suggestions?: Array<{
        name?: string;
        mapbox_id?: string;
        place_formatted?: string;
        context?: SearchBoxContext;
      }>;
    };
    const out: MapboxSuggestItem[] = [];
    for (const s of data.suggestions ?? []) {
      if (!s.mapbox_id || !s.name) continue;
      const place = trimCountrySuffix(s.place_formatted ?? '');
      const city = s.context?.place?.name?.trim();
      out.push({
        mapboxId: s.mapbox_id,
        name: s.name,
        address: place ? `${s.name}, ${place}` : s.name,
        ...(city ? { city } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function mapboxSearchBoxRetrieve(
  mapboxId: string,
  accessToken: string,
  options?: { sessionToken?: string },
): Promise<{ latitude: number; longitude: number; city?: string } | null> {
  if (!mapboxId || !accessToken.trim()) return null;
  const params = new URLSearchParams({
    access_token: accessToken,
    session_token: options?.sessionToken || DEFAULT_SESSION,
  });
  try {
    const res = await fetch(
      `${SEARCHBOX_BASE}/retrieve/${encodeURIComponent(mapboxId)}?${params.toString()}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { context?: SearchBoxContext };
      }>;
    };
    const f = data.features?.[0];
    const c = f?.geometry?.coordinates;
    if (!c || c.length < 2) return null;
    const [lng, lat] = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const city = f?.properties?.context?.place?.name?.trim();
    return { latitude: lat, longitude: lng, ...(city ? { city } : {}) };
  } catch {
    return null;
  }
}
