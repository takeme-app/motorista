import type { PlaceResolved } from '../components/PlacesAddressInput';

export type BasePlaceResolved = {
  formattedAddress: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
};

/** Extrai cidade e UF a partir dos address_components do Google Places. */
export function parseCityStateFromPlace(p: PlaceResolved): { city: string; state: string } {
  const components = p.addressComponents ?? [];
  let state = '';
  let city = '';
  for (const c of components) {
    if (c.types.includes('administrative_area_level_1')) state = c.shortName;
    if (c.types.includes('locality')) city = c.longName;
  }
  if (!city) {
    const level2 = components.find((c) => c.types.includes('administrative_area_level_2'));
    if (level2) city = level2.longName;
  }
  return { city, state };
}

export function toBasePlaceResolved(p: PlaceResolved): BasePlaceResolved {
  const { city, state } = parseCityStateFromPlace(p);
  return {
    formattedAddress: p.formattedAddress,
    lat: p.lat,
    lng: p.lng,
    city,
    state,
  };
}

export function basePlaceFromRow(row: {
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
}): BasePlaceResolved | null {
  if (row.lat == null || row.lng == null || !row.city.trim()) return null;
  return {
    formattedAddress: row.address,
    lat: row.lat,
    lng: row.lng,
    city: row.city,
    state: row.state,
  };
}
