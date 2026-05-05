function compactId(id: string): string {
  return String(id ?? '').replace(/-/g, '').toUpperCase();
}

export function formatEntityCode(id: string): string {
  const compact = compactId(id);
  return compact.length > 8 ? compact.slice(0, 8) : compact;
}

export function formatShipmentCode(id: string): string {
  return formatEntityCode(id);
}

export function formatTripCode(id: string): string {
  return formatEntityCode(id);
}

export function formatDependentShipmentCode(id: string): string {
  return formatEntityCode(id);
}
