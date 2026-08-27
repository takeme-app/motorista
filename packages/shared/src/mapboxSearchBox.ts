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
  /** rótulo pronto p/ exibir/selecionar: nome + endereço resumido (sem ", Brasil") */
  address: string;
  /** cidade quando disponível */
  city?: string;
  /** UF do resultado (ex.: `MA`) — usada para priorizar o estado do usuário */
  regionCode?: string;
  /** linha secundária: rua, bairro, cidade, UF (sem o nome do POI, país ou CEP) */
  secondary?: string;
  /** distância em metros a partir do ponto de `proximity` (quando informado) */
  distanceMeters?: number;
  /** tipo do resultado da Search Box (poi, address, street, place...) */
  featureType?: string;
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
  /** endereço já formatado com número, quando o resultado é um POI/endereço */
  address?: { name?: string; address_number?: string; street_name?: string };
  street?: { name?: string };
  neighborhood?: { name?: string };
  postcode?: { name?: string };
  locality?: { name?: string };
  place?: { name?: string };
  district?: { name?: string };
  region?: { name?: string; region_code?: string };
};

function trimCountrySuffix(s: string): string {
  return s.replace(/,\s*bra[sz]il\s*$/i, '').trim();
}

/** Remove CEP (12345-678 / 12345678) e sobras de pontuação do rótulo. */
function stripPostcode(s: string): string {
  return s
    .replace(/\b\d{5}-?\d{3}\b/g, '')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/** Limpa país/CEP e evita repetir o nome do POI já exibido na linha principal. */
function cleanupAddressLabel(raw: string, poiName?: string): string {
  let out = stripPostcode(trimCountrySuffix(raw ?? ''));
  const poi = poiName?.trim();
  if (poi && out.toLowerCase().startsWith(poi.toLowerCase())) {
    out = out.slice(poi.length).replace(/^[\s,]+/, '').trim();
  }
  return out;
}

/**
 * Monta a linha secundária estilo Uber (rua, número, bairro, cidade, UF) — sem o
 * nome do POI, país ou CEP.
 *
 * POIs de rede (ex.: "McDonald's") costumam vir SEM rua no `context`; nesse caso o
 * `place_formatted` traz só "Cidade, Estado CEP", o que deixa todas as unidades com
 * a mesma legenda. Por isso o fallback prioriza `full_address`, que contém rua e
 * número e permite distinguir um estabelecimento do outro.
 */
function buildSecondary(
  ctx: SearchBoxContext | undefined,
  placeFormatted: string,
  fullAddress?: string,
  poiName?: string,
): string {
  const streetLine =
    ctx?.address?.name?.trim() ||
    [ctx?.street?.name?.trim(), ctx?.address?.address_number?.trim()]
      .filter(Boolean)
      .join(', ')
      .trim();
  const neighborhood = ctx?.neighborhood?.name?.trim();
  const city = ctx?.place?.name?.trim() || ctx?.locality?.name?.trim();
  const uf = ctx?.region?.region_code?.trim();

  if (streetLine) {
    return [streetLine, neighborhood, city, uf]
      .filter((p): p is string => Boolean(p && p.length))
      .join(', ');
  }

  const fromFull = cleanupAddressLabel(fullAddress ?? '', poiName);
  if (fromFull) return fromFull;

  const parts = [neighborhood, city, uf].filter((p): p is string => Boolean(p && p.length));
  if (parts.length) return parts.join(', ');

  return cleanupAddressLabel(placeFormatted, poiName);
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
        feature_type?: string;
        place_formatted?: string;
        full_address?: string;
        distance?: number;
        context?: SearchBoxContext;
      }>;
    };
    const out: MapboxSuggestItem[] = [];
    for (const s of data.suggestions ?? []) {
      if (!s.mapbox_id || !s.name) continue;
      const placeFormatted = s.place_formatted ?? '';
      const secondary = buildSecondary(s.context, placeFormatted, s.full_address, s.name);
      const city = s.context?.place?.name?.trim() || s.context?.locality?.name?.trim();
      const regionCode = s.context?.region?.region_code?.trim().toUpperCase();
      const distanceMeters =
        typeof s.distance === 'number' && Number.isFinite(s.distance) ? s.distance : undefined;
      out.push({
        mapboxId: s.mapbox_id,
        name: s.name,
        address: secondary ? `${s.name}, ${secondary}` : s.name,
        ...(city ? { city } : {}),
        ...(regionCode ? { regionCode } : {}),
        ...(secondary ? { secondary } : {}),
        ...(distanceMeters != null ? { distanceMeters } : {}),
        ...(s.feature_type ? { featureType: s.feature_type } : {}),
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
