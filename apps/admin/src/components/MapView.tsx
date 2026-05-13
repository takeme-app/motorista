import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getMapboxAccessToken } from '../lib/expoExtra';

// CSS síncrono no web: `await import('.css')` no efeito pode aplicar depois dos markers,
// o que deixa pins invisíveis ou fora do lugar até o próximo resize.
if (Platform.OS === 'web') {
  try {
    require('mapbox-gl/dist/mapbox-gl.css');
  } catch {
    /* ignore */
  }
}

// ── Types ────────────────────────────────────────────────────────────
export interface MapCoord {
  lat: number;
  lng: number;
}

/** Perfil da [Directions API](https://docs.mapbox.com/api/navigation/directions/) v5. */
export type MapboxDirectionsProfile = 'driving' | 'driving-traffic' | 'walking' | 'cycling';

export interface MapWaypoint extends MapCoord {
  label?: string;
  color?: string;
  /** Tipo da parada (para icone customizado) */
  type?: 'driver_origin' | 'passenger_pickup' | 'shipment_pickup' | 'base_dropoff' | 'trip_destination' | string;
  /** Ordem no roteiro (`trip_stops.sequence_order`) — rota Directions respeita esta ordem. */
  sortOrder?: number;
  /** Parada já concluída pelo motorista (`trip_stops.status`). */
  completed?: boolean;
  /** Próxima parada pendente no roteiro (destaque no mapa). */
  isNext?: boolean;
  /** Metadados opcionais para waypoints sintéticos de encomenda. */
  entityId?: string;
  shipmentLeg?: 'pickup' | 'dropoff';
}

export interface MapViewProps {
  origin?: MapCoord;
  destination?: MapCoord;
  /**
   * Partida real do motorista (ex.: `trip_stops.driver_origin` ou `scheduled_trips.origin_*`).
   * Quando definido, o pin de carro fica aqui e a rota Directions começa neste ponto;
   * `origin` continua a representar o embarque do passageiro (waypoints / booking).
   */
  driverStart?: MapCoord;
  /** Pontos intermediarios (passageiros, encomendas, bases) — renderizados na ordem */
  waypoints?: MapWaypoint[];
  /** Ponto atual (tracking em tempo real) */
  currentPosition?: MapCoord;
  /** Altura do container (default 300) */
  height?: number;
  /**
   * true = só imagem estática (rápido, sem interação).
   * false = Mapbox GL real (pan/zoom, marcadores, rota).
   */
  staticMode?: boolean;
  /**
   * Desenhar trajeto entre origem e destino no GL (Directions API; fallback linha reta).
   */
  connectPoints?: boolean;
  /**
   * `driving-traffic` usa dados de trânsito onde a Mapbox disponibiliza.
   * Requer o mesmo token usado no mapa (scopes de Directions).
   */
  directionsProfile?: MapboxDirectionsProfile;
  /**
   * Overlays do Figma (792:1593 + 792:1595). Default off para mapa limpo como referência de produto.
   */
  showFigmaMapChrome?: boolean;
  /** Quando true, o mapa aproxima e centra em `followTarget` (ex.: veículo); atualiza se as coords mudarem. */
  followVehicle?: boolean;
  followTarget?: MapCoord;
  /** Chamado quando o utilizador arrasta ou roda o mapa — para desligar o modo acompanhar. */
  onFollowVehicleInterrupted?: () => void;
  /**
   * Viagem encerrada no painel (`concluído`): todos os pins mostram check cinza, como no motorista
   * quando o roteiro terminou (mesmo se algum `trip_stops.status` não estiver sincronizado).
   */
  tripCompleted?: boolean;
  /** Texto opcional no marcador ao vivo (ex.: "5 min") — alinhado ao `DriverEtaMarkerIcon` do app cliente. */
  liveVehicleEta?: string;
  style?: React.CSSProperties;
}

const FOLLOW_VEHICLE_ZOOM_MIN = 14;
const FOLLOW_VEHICLE_ZOOM_MAX = 17;

const LINE_SOURCE_ID = 'takeme-trip-line';
const LINE_LAYER_ID = 'takeme-trip-line-layer';
const LINE_NAV_SOURCE_ID = 'takeme-trip-nav-line';
const LINE_NAV_LAYER_ID = 'takeme-trip-nav-line-layer';
const LINE_LIVE_TRAIL_SOURCE_ID = 'takeme-live-trail-source';
const LINE_LIVE_TRAIL_LAYER_ID = 'takeme-live-trail-layer';

/** Path do ícone carro em `DriverEtaMarkerIcon` (cliente) — viewBox 0 0 40 40. */
const DRIVER_ETA_CAR_PATH =
  'M25.7667 14.175C25.6 13.6834 25.1333 13.3334 24.5833 13.3334H15.4167C14.8667 13.3334 14.4083 13.6834 14.2333 14.175L12.5917 18.9C12.5333 19.075 12.5 19.2584 12.5 19.45V25.4167C12.5 26.1084 13.0583 26.6667 13.75 26.6667C14.4417 26.6667 15 26.1084 15 25.4167V25H25V25.4167C25 26.1 25.5583 26.6667 26.25 26.6667C26.9333 26.6667 27.5 26.1084 27.5 25.4167V19.45C27.5 19.2667 27.4667 19.075 27.4083 18.9L25.7667 14.175ZM15.4167 22.5C14.725 22.5 14.1667 21.9417 14.1667 21.25C14.1667 20.5584 14.725 20 15.4167 20C16.1083 20 16.6667 20.5584 16.6667 21.25C16.6667 21.9417 16.1083 22.5 15.4167 22.5ZM24.5833 22.5C23.8917 22.5 23.3333 21.9417 23.3333 21.25C23.3333 20.5584 23.8917 20 24.5833 20C25.275 20 25.8333 20.5584 25.8333 21.25C25.8333 21.9417 25.275 22.5 24.5833 22.5ZM14.1667 18.3334L15.225 15.15C15.3417 14.8167 15.6583 14.5834 16.0167 14.5834H23.9833C24.3417 14.5834 24.6583 14.8167 24.775 15.15L25.8333 18.3334H14.1667Z';

const LIVE_TRAIL_FETCH_DEBOUNCE_MS = 750;

/** Mesma paleta do app motorista (TripDetail / Home / viagem ativa). */
const MOTORISTA_GOLD = '#C9A227';
const MOTORISTA_DARK = '#111827';
/** Parada concluída no mapa (ActiveTrip — marker cinza). */
const MOTORISTA_COMPLETED_BG = '#4B5563';

/**
 * Cores por `stop_type` — espelha `STOP_TYPE_COLORS` em `apps/motorista/src/hooks/useTripStops.ts`
 * (inclui aliases `shipment_*` vindos do Postgres).
 */
const MOTORISTA_STOP_TYPE_COLORS: Record<string, string> = {
  passenger_pickup: '#10B981',
  passenger_dropoff: '#3B82F6',
  package_pickup: '#F59E0B',
  package_dropoff: '#6366F1',
  shipment_pickup: '#F59E0B',
  shipment_dropoff: '#6366F1',
  excursion_stop: '#EC4899',
  driver_origin: '#64748B',
  trip_destination: '#1D4ED8',
  base_dropoff: '#EA580C',
};

function waypointMarkerBackground(wp: MapWaypoint): string {
  if (wp.color) return wp.color;
  const t = wp.type || '';
  return MOTORISTA_STOP_TYPE_COLORS[t] || '#64748B';
}

/**
 * Mesma lógica de `StopKindMarkerIcon` em `ActiveTripScreen` (motorista): ícone por tipo de parada.
 * Aliases `shipment_*` vêm do Postgres como no hook do motorista.
 */
function normalizeStopTypeForIcon(raw: string | undefined): string {
  const t = String(raw ?? '').trim();
  if (t === 'shipment_pickup') return 'package_pickup';
  if (t === 'shipment_dropoff') return 'package_dropoff';
  return t;
}

type StopIconKind = 'person' | 'package' | 'car' | 'flag' | 'business' | 'place' | 'check';

function iconKindForStopType(type: string | undefined): StopIconKind {
  const t = normalizeStopTypeForIcon(type);
  if (t === 'passenger_pickup' || t === 'passenger_dropoff') return 'person';
  if (t === 'package_pickup' || t === 'package_dropoff') return 'package';
  if (t === 'driver_origin') return 'car';
  if (t === 'trip_destination') return 'flag';
  if (t === 'base_dropoff') return 'business';
  if (t === 'excursion_stop') return 'place';
  return 'place';
}

/** Paths 24×24 (Material Icons) — equivalente aos `MaterialIcons` da viagem ativa. */
const STOP_ICON_PATH: Record<StopIconKind, string> = {
  person:
    'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  package:
    'M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-.9-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z',
  car:
    'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16C5.67 16 5 15.33 5 14.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  flag: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z',
  business:
    'M12 7V3H2v18h20V7H12zM8 19H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V9h2v2zm0-4H6V5h2v2zm4 12h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm8 12h-6v-2h2v-2h-2v-2h2v-2h-2V9h6v10zm-4-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
  place:
    'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
};

const VIAGEM_ATIVA_MARKER_PX = 40;
/** Igual `anchor={{ x: 0.5, y: 0.5 }}` nos markers da viagem ativa no motorista. */
const MAP_MARKER_ANCHOR = 'center' as const;

/**
 * Marcador estilo viagem ativa (motorista): círculo 40px, borda branca, só o ícone — sem letras A/B/C.
 * Âncora `center` — igual `MapMarker` + `anchor={{ x: 0.5, y: 0.5 }}` no ActiveTrip.
 */
function createViagemAtivaStyleMarkerElement(
  backgroundColor: string,
  iconKind: StopIconKind,
  title?: string,
  ringHighlight?: boolean,
): HTMLDivElement {
  const el = document.createElement('div');
  const size = VIAGEM_ATIVA_MARKER_PX;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = '50%';
  el.style.background = backgroundColor;
  el.style.border = '2px solid #ffffff';
  el.style.boxShadow = ringHighlight
    ? '0 0 0 3px rgba(59,130,246,0.95), 0 2px 10px rgba(0,0,0,0.25)'
    : '0 2px 10px rgba(0,0,0,0.25)';
  el.style.boxSizing = 'border-box';
  el.style.flexShrink = '0';
  el.style.pointerEvents = 'none';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.overflow = 'hidden';
  if (title) el.title = title;

  const path = STOP_ICON_PATH[iconKind];
  const iconPx = 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${iconPx}" height="${iconPx}" fill="#ffffff" aria-hidden="true"><path d="${path}"/></svg>`;

  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">${svg}</div>`;
  return el;
}

function createDriverStartMarkerElement(completed: boolean): HTMLDivElement {
  if (completed) {
    return createViagemAtivaStyleMarkerElement(MOTORISTA_COMPLETED_BG, 'check', 'Partida concluída', false);
  }
  return createViagemAtivaStyleMarkerElement(MOTORISTA_DARK, 'car', 'Partida', false);
}

function createTripDestinationMarkerElement(completed: boolean): HTMLDivElement {
  if (completed) {
    return createViagemAtivaStyleMarkerElement(MOTORISTA_COMPLETED_BG, 'check', 'Destino final concluído', false);
  }
  return createViagemAtivaStyleMarkerElement(MOTORISTA_GOLD, 'flag', 'Destino final', false);
}

function createPassengerEmbarkMarkerElement(
  title?: string,
  ringHighlight?: boolean,
  completed?: boolean,
): HTMLDivElement {
  if (completed) {
    return createViagemAtivaStyleMarkerElement(MOTORISTA_COMPLETED_BG, 'check', title ?? 'Embarque concluído', false);
  }
  return createViagemAtivaStyleMarkerElement(
    MOTORISTA_STOP_TYPE_COLORS.passenger_pickup,
    'person',
    title ?? 'Embarque passageiro',
    Boolean(ringHighlight),
  );
}

function createRoteiroWaypointMarkerElement(wp: MapWaypoint): HTMLDivElement {
  if (wp.completed) {
    return createViagemAtivaStyleMarkerElement(MOTORISTA_COMPLETED_BG, 'check', wp.label, false);
  }
  const bg = waypointMarkerBackground(wp);
  const kind = iconKindForStopType(wp.type);
  return createViagemAtivaStyleMarkerElement(bg, kind, wp.label, Boolean(wp.isNext));
}

/** Estilo claro minimal (referência de produto). */
const MAPBOX_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';
const MAPBOX_STATIC_STYLE_LIGHT = 'mapbox/light-v11';

/**
 * No web, `mapbox://...` + token só em `mapboxgl.accessToken` por vezes resulta em mapa cinza
 * (worker não propaga o token ao carregar o JSON do estilo). URL HTTPS com `access_token` corrige.
 */
function mapboxGlStyleUrl(token: string): string {
  const t = token.trim();
  if (!t) return MAPBOX_STYLE_LIGHT;
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STATIC_STYLE_LIGHT}?access_token=${encodeURIComponent(t)}`;
}

/** Padding na Static API: mais margem interna ajuda a não colar atribuição Mapbox na borda do PNG. */
const STATIC_MAP_API_PADDING = 96;

/** Fundo do container estático — próximo ao `mapContainer` do TripDetail no motorista. */
const STATIC_MAP_LETTERBOX_BG = '#E5E7EB';

// ── Directions API ─────────────────────────────────────────────────────
async function fetchDirectionsPolyline(
  origin: MapCoord,
  destination: MapCoord,
  token: string,
  profile: MapboxDirectionsProfile,
  signal?: AbortSignal,
): Promise<string | null> {
  const coordPath = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordPath}` +
    `?geometries=polyline&overview=full&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    code?: string;
    routes?: Array<{ geometry?: unknown }>;
  };
  if (data.code !== 'Ok' || !data.routes?.[0]) return null;
  const g = data.routes[0].geometry;
  return typeof g === 'string' && g.length > 0 ? g : null;
}

async function fetchDirectionsLineString(
  origin: MapCoord,
  destination: MapCoord,
  token: string,
  profile: MapboxDirectionsProfile,
  signal?: AbortSignal,
  intermediatePoints?: MapCoord[],
): Promise<{ type: 'LineString'; coordinates: number[][] } | null> {
  // Multi-waypoint: origin ; wp1 ; wp2 ; ... ; destination
  const allPoints = [origin, ...(intermediatePoints || []), destination];
  const coordPath = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordPath}` +
    `?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    code?: string;
    routes?: Array<{ geometry?: { type?: string; coordinates?: number[][] } }>;
  };
  if (data.code !== 'Ok' || !data.routes?.[0]?.geometry) return null;
  const g = data.routes[0].geometry;
  if (g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;
  return { type: 'LineString', coordinates: g.coordinates };
}

function fitMapToCoordinates(map: any, mapboxgl: any, coordinates: number[][]) {
  if (coordinates.length === 0) return;
  const bounds = new mapboxgl.LngLatBounds();
  for (const c of coordinates) {
    if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      bounds.extend(c as [number, number]);
    }
  }
  map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
}

function coordsNearlyEqual(a: MapCoord, b: MapCoord, eps = 1e-5): boolean {
  return Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps;
}

/** ~55 m em graus (evita ocultar entrega de encomenda que coincide com destino da viagem). */
const COORDS_DEDupe_DEST_EPS = 0.0005;

/**
 * Ordem do roteiro para Directions (`sortOrder` / `sequence_order`).
 * Não remove `package_dropoff` por proximidade ao destino final da viagem: no motorista são paradas distintas
 * (entrega da encomenda vs `trip_destination` / fim do trajeto passageiro).
 */
function orderedRouteWaypoints(waypoints: MapWaypoint[] | undefined, _destination?: MapCoord): MapWaypoint[] {
  return [...(waypoints || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Pin explícito de embarque quando o MapView não o recebe como waypoint (ex.: trip_stops sem lat/lng). */
function needsExplicitPassengerEmbarkMarker(
  origin: MapCoord | undefined,
  waypoints: MapWaypoint[] | undefined,
): boolean {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return false;
  const hasPassengerWp = (waypoints || []).some((wp) => {
    const t = normalizeStopTypeForIcon(wp.type);
    if (t !== 'passenger_pickup' && t !== 'passenger_dropoff') return false;
    return coordsNearlyEqual(wp, origin, COORDS_DEDupe_DEST_EPS);
  });
  return !hasPassengerWp;
}

function embarkMarkerOffsetPx(
  origin: MapCoord,
  driverStart: MapCoord | undefined,
  waypoints: MapWaypoint[] | undefined,
): [number, number] {
  if (!driverStart || !coordsNearlyEqual(origin, driverStart, COORDS_DEDupe_DEST_EPS)) return [0, 0];
  const dupWp = (waypoints || []).some((wp) => coordsNearlyEqual(wp, origin, COORDS_DEDupe_DEST_EPS));
  if (dupWp) return [0, 0];
  return [26, 0];
}

function resolveNextNavTarget(
  destination: MapCoord | undefined,
  waypoints: MapWaypoint[] | undefined,
): MapCoord | undefined {
  const ordered = orderedRouteWaypoints(waypoints, destination);
  const next = ordered.find((w) => !w.completed);
  if (next) return next;
  return destination;
}

/** Desloca o pin do carro em px quando partilha coordenadas com um waypoint (ex.: mesmo edifício). */
function carMarkerOffsetPx(
  driverStart: MapCoord | undefined,
  origin: MapCoord | undefined,
  waypoints: MapWaypoint[] | undefined,
): [number, number] {
  const anchor = driverStart ?? origin;
  if (!anchor || !waypoints?.length) return [0, 0];
  const dup = waypoints.some((wp) => coordsNearlyEqual(wp, anchor));
  return dup ? [-22, 0] : [0, 0];
}

/** Inclui a polyline e todos os pins relevantes — evita cortar o motorista fora do viewport. */
function fitMapToRouteAndMarkers(
  map: any,
  mapboxgl: any,
  lineCoordinates: number[][] | null | undefined,
  markerPoints: Array<MapCoord | undefined>,
) {
  const bounds = new mapboxgl.LngLatBounds();
  let has = false;
  if (lineCoordinates?.length) {
    for (const c of lineCoordinates) {
      if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        bounds.extend(c as [number, number]);
        has = true;
      }
    }
  }
  for (const p of markerPoints) {
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      bounds.extend([p.lng, p.lat]);
      has = true;
    }
  }
  if (has) {
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
/** Evita lixo de float na URL; coords já validadas como números finitos. */
function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Largura pedida à Static API: mais nítida em containers largos/altos, com teto seguro para URL. */
function staticSnapshotWidthPx(forHeight: number): number {
  return Math.max(600, Math.min(1280, Math.round(forHeight * 2)));
}

/**
 * Static Images API: overlays `pin-s-*` devem ir **literais** no path (ex.: `pin-s-a+22c55e(lon,lat)`).
 * `encodeURIComponent` no overlay transforma `+` em `%2B` e a API responde 422.
 * @see https://docs.mapbox.com/api/maps/static-images/#overlay-options
 */
function buildStaticUrl(origin?: MapCoord, destination?: MapCoord, width = 600, height = 300): string {
  const token = getMapboxAccessToken();
  if (!token) return '';
  const markers: string[] = [];
  // Mesmas cores da Home do motorista: origem #111827, destino #C9A227.
  if (origin) markers.push(`pin-s-a+111827(${r6(origin.lng)},${r6(origin.lat)})`);
  if (destination) markers.push(`pin-s-b+c9a227(${r6(destination.lng)},${r6(destination.lat)})`);

  if (origin && destination) {
    // `auto` ajusta zoom/ângulo aos overlays (recomendado na doc). Bbox manual com
    // trechos muito longos (ex. vários estados) costuma falhar com 422.
    // @see https://docs.mapbox.com/api/maps/static-images/#example-request-static-map-with-a-polyline-overlay
    const overlay = markers.join(',');
    // `STATIC_MAP_API_PADDING`: afasta o enquadramento da borda do tile e dá folga à atribuição no PNG.
    return `https://api.mapbox.com/styles/v1/${MAPBOX_STATIC_STYLE_LIGHT}/static/${overlay}/auto/${width}x${height}@2x` +
      `?access_token=${encodeURIComponent(token)}&padding=${STATIC_MAP_API_PADDING}`;
  }

  const center = origin || destination;
  if (center) {
    return `https://api.mapbox.com/styles/v1/${MAPBOX_STATIC_STYLE_LIGHT}/static/${markers.join(',')}/${r6(center.lng)},${r6(center.lat)},11/` +
      `${width}x${height}@2x?access_token=${encodeURIComponent(token)}`;
  }
  return '';
}

/**
 * Static Images com rota ao longo das vias (polyline Directions) + pins alinhados ao tema claro.
 * Retorna '' se a URL exceder limite seguro ou token ausente.
 */
function buildStaticUrlWithRoutePolyline(
  origin: MapCoord,
  destination: MapCoord,
  polyline: string,
  width = 600,
  height = 300,
): string {
  const token = getMapboxAccessToken();
  if (!token) return '';
  const enc = encodeURIComponent(polyline);
  const pins =
    `pin-s-a+111827(${r6(origin.lng)},${r6(origin.lat)}),` +
    `pin-s-b+c9a227(${r6(destination.lng)},${r6(destination.lat)})`;
  const pathOverlay = `path-4+c9a227-1(${enc})`;
  const overlay = `${pathOverlay},${pins}`;
  const u =
    `https://api.mapbox.com/styles/v1/${MAPBOX_STATIC_STYLE_LIGHT}/static/${overlay}/auto/${width}x${height}@2x` +
    `?access_token=${encodeURIComponent(token)}&padding=${STATIC_MAP_API_PADDING}`;
  if (u.length > 7200) return '';
  return u;
}

// ── Placeholder ──────────────────────────────────────────────────────
function MapPlaceholder(props: { height: number; style?: React.CSSProperties; subMessage?: string }) {
  return React.createElement('div', {
    style: {
      width: '100%',
      minHeight: props.height,
      height: props.height,
      background: '#f1f1f1',
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      color: '#767676',
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
      padding: 16,
      boxSizing: 'border-box' as const,
      textAlign: 'center' as const,
      ...props.style,
    },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: props.subMessage ? 8 : 0 } },
      React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { flexShrink: 0 } },
        React.createElement('path', {
          d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z',
          stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        React.createElement('circle', { cx: 12, cy: 10, r: 3, stroke: '#767676', strokeWidth: 2 }),
      ),
      React.createElement('span', null, 'Mapa do trajeto'),
    ),
    props.subMessage
      ? React.createElement('span', { style: { fontSize: 12, lineHeight: 1.4, maxWidth: 320 } }, props.subMessage)
      : null,
  );
}

function removeTripLineLayer(map: any) {
  try {
    if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
    if (map.getSource(LINE_SOURCE_ID)) map.removeSource(LINE_SOURCE_ID);
  } catch { /* ignore */ }
}

function removeTripNavLineLayer(map: any) {
  try {
    if (map.getLayer(LINE_NAV_LAYER_ID)) map.removeLayer(LINE_NAV_LAYER_ID);
    if (map.getSource(LINE_NAV_SOURCE_ID)) map.removeSource(LINE_NAV_SOURCE_ID);
  } catch { /* ignore */ }
}

function removeLiveTrailLayer(map: any) {
  try {
    if (map.getLayer(LINE_LIVE_TRAIL_LAYER_ID)) map.removeLayer(LINE_LIVE_TRAIL_LAYER_ID);
    if (map.getSource(LINE_LIVE_TRAIL_SOURCE_ID)) map.removeSource(LINE_LIVE_TRAIL_SOURCE_ID);
  } catch { /* ignore */ }
}

/** Trail dourada GPS → próximo alvo (par com `TripInProgressScreen` no cliente). */
function setLiveTrailLayer(map: any, geometry: { type: 'LineString'; coordinates: number[][] }) {
  const geojson = {
    type: 'Feature' as const,
    properties: {},
    geometry,
  };
  if (map.getSource(LINE_LIVE_TRAIL_SOURCE_ID)) {
    (map.getSource(LINE_LIVE_TRAIL_SOURCE_ID) as any).setData(geojson);
  } else {
    map.addSource(LINE_LIVE_TRAIL_SOURCE_ID, { type: 'geojson', data: geojson });
    map.addLayer({
      id: LINE_LIVE_TRAIL_LAYER_ID,
      type: 'line',
      source: LINE_LIVE_TRAIL_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': MOTORISTA_GOLD,
        'line-width': 4,
        'line-opacity': 1,
      },
    });
  }
  bringLiveTrailLayerToFront(map);
}

function bringLiveTrailLayerToFront(map: any) {
  if (!map.getLayer(LINE_LIVE_TRAIL_LAYER_ID)) return;
  try {
    map.moveLayer(LINE_LIVE_TRAIL_LAYER_ID);
  } catch { /* ignore */ }
}

/** Marcador ao vivo alinhado a `DriverEtaMarkerIcon` (cliente); âncora bottom no ponto. */
function createLiveVehicleMarkerElement(eta?: string | null): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.alignItems = 'center';
  wrap.style.pointerEvents = 'none';
  const etaTrim = eta?.trim();
  if (etaTrim) {
    const badge = document.createElement('div');
    badge.textContent = etaTrim;
    badge.style.backgroundColor = '#0d0d0d';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '700';
    badge.style.padding = '3px 8px';
    badge.style.borderRadius = '6px';
    badge.style.marginBottom = '4px';
    badge.style.fontFamily = 'Inter, system-ui, sans-serif';
    wrap.appendChild(badge);
  }
  const circle = document.createElement('div');
  const size = 32;
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;
  circle.style.borderRadius = `${size / 2}px`;
  circle.style.backgroundColor = '#0d0d0d';
  circle.style.display = 'flex';
  circle.style.alignItems = 'center';
  circle.style.justifyContent = 'center';
  circle.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  const clipId = `clip_driver_eta_${Math.random().toString(36).slice(2, 11)}`;
  circle.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true">` +
    `<defs><clipPath id="${clipId}"><rect width="20" height="20" fill="white" x="10" y="10"/></clipPath></defs>` +
    `<g clip-path="url(#${clipId})"><path d="${DRIVER_ETA_CAR_PATH}" fill="#FFFFFF"/></g></svg>`;
  wrap.appendChild(circle);
  return wrap;
}

/** Trecho escuro motorista → próxima parada pendente (espelha polyline “driver” no ActiveTrip). */
function setTripNavSegmentLayer(map: any, from: MapCoord, to: MapCoord) {
  const geojson = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
    },
  };
  if (map.getSource(LINE_NAV_SOURCE_ID)) {
    (map.getSource(LINE_NAV_SOURCE_ID) as any).setData(geojson);
    return;
  }
  map.addSource(LINE_NAV_SOURCE_ID, { type: 'geojson', data: geojson });
  map.addLayer({
    id: LINE_NAV_LAYER_ID,
    type: 'line',
    source: LINE_NAV_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MOTORISTA_DARK,
      'line-width': 3,
      'line-opacity': 0.88,
      'line-dasharray': [1.8, 2.4],
    },
  });
}

function setTripRouteLayer(map: any, geometry: { type: 'LineString'; coordinates: number[][] }) {
  const geojson = {
    type: 'Feature' as const,
    properties: {},
    geometry,
  };

  if (map.getSource(LINE_SOURCE_ID)) {
    (map.getSource(LINE_SOURCE_ID) as any).setData(geojson);
    return;
  }

  map.addSource(LINE_SOURCE_ID, { type: 'geojson', data: geojson });
  map.addLayer({
    id: LINE_LAYER_ID,
    type: 'line',
    source: LINE_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MOTORISTA_GOLD,
      'line-width': 4,
      'line-opacity': 1,
    },
  });
}

function addStraightFallbackLine(map: any, origin: MapCoord, destination: MapCoord) {
  setTripRouteLayer(map, {
    type: 'LineString',
    coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]],
  });
}

/** Ícone drive_eta (Figma 792:1595) — carro branco, alinhado ao componente action container. */
function figmaDriveEtaIcon() {
  return React.createElement('svg', {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    style: { display: 'block' },
  },
    React.createElement('path', {
      d: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
      fill: '#ffffff',
    }));
}

/**
 * Chrome do mapa — Figma Frame 792:1593 (circle_2) + action container 792:1595.
 */
function mapFigmaChromeElements(): React.ReactNode[] {
  const markerFrame = React.createElement('div', {
    key: 'figma-marker',
    'aria-hidden': true,
    style: {
      position: 'absolute' as const,
      bottom: 14,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 129,
      height: 27,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none' as const,
      zIndex: 4,
    },
  },
    React.createElement('div', {
      style: {
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: MOTORISTA_GOLD,
        border: '2px solid #ffffff',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        flexShrink: 0,
      },
    }));

  const actionBtn = React.createElement('button', {
    key: 'figma-drive',
    type: 'button',
    title: 'Trajeto por estrada',
    'aria-label': 'Trajeto por estrada',
    style: {
      position: 'absolute' as const,
      bottom: 14,
      right: 14,
      width: 40,
      height: 40,
      borderRadius: '50%',
      border: 'none',
      background: MOTORISTA_DARK,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      pointerEvents: 'auto' as const,
      zIndex: 4,
      boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
      padding: 0,
    },
  },
    React.createElement('div', {
      style: {
        transform: 'rotate(-90deg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }, figmaDriveEtaIcon()));

  return [markerFrame, actionBtn];
}

// ── Componente Principal ───────────────────────────────────────────────
export default function MapView(props: MapViewProps) {
  const {
    origin,
    destination,
    driverStart,
    currentPosition,
    height = 300,
    waypoints,
    staticMode = false,
    connectPoints = true,
    directionsProfile = 'driving-traffic',
    showFigmaMapChrome = false,
    followVehicle = false,
    followTarget,
    onFollowVehicleInterrupted,
    tripCompleted = false,
    liveVehicleEta,
    style,
  } = props;
  const followVehicleRef = useRef(followVehicle);
  followVehicleRef.current = followVehicle;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mapboxglRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const currentPositionMarkerRef = useRef<any>(null);
  const [mapboxLoaded, setMapboxLoaded] = useState(false);
  const [mapStyleReady, setMapStyleReady] = useState(false);
  const [glFailed, setGlFailed] = useState(false);
  const token = getMapboxAccessToken();
  const useStatic = staticMode || !token || glFailed;
  const [staticRouteUrl, setStaticRouteUrl] = useState<string | null>(null);

  useEffect(() => {
    setGlFailed(false);
  }, [staticMode, token, origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  useEffect(() => {
    if (!useStatic || !origin || !destination || !token) {
      setStaticRouteUrl(null);
      return;
    }
    setStaticRouteUrl(null);
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      let poly = await fetchDirectionsPolyline(origin, destination, token, directionsProfile, ac.signal);
      if (cancelled) return;
      if (!poly && directionsProfile === 'driving-traffic') {
        poly = await fetchDirectionsPolyline(origin, destination, token, 'driving', ac.signal);
      }
      if (cancelled || !poly) return;
      const u = buildStaticUrlWithRoutePolyline(origin, destination, poly, staticSnapshotWidthPx(height), height);
      if (!cancelled && u) setStaticRouteUrl(u);
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    useStatic,
    token,
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
    directionsProfile,
    height,
  ]);

  useEffect(() => {
    // Não usar `glFailed` aqui: quando o GL falha, `glFailed` vira true, o efeito re-roda por estar
    // nas deps, e o guard `|| glFailed` impedia qualquer nova tentativa. Só tentamos GL quando há token.
    if (staticMode || !token) return;

    let cancelled = false;
    const ac = new AbortController();
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      try {
        const pack: any = await import('mapbox-gl');
        if (cancelled) return;
        const mapboxgl = pack.default ?? pack;

        // Sem container (ex.: ramo estático ainda montado) — não marcar GL como “carregado”.
        if (!mapContainerRef.current) return;

        /**
         * Expo + Metro no web: o worker precisa de URL absoluta. Prioridade:
         * 1) Mesma origem — ficheiro em `public/mapbox-gl-csp-worker.js` (script `postinstall` em apps/admin).
         * 2) unpkg — pode falhar com CSP / rede corporativa.
         * Sem worker válido o GL falha → `useStatic` → só `<img>` com pins A/B.
         */
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const origin = window.location.origin.replace(/\/$/, '');
          (mapboxgl as unknown as { workerUrl?: string }).workerUrl =
            `${origin}/mapbox-gl-csp-worker.js`;
        }

        mapboxglRef.current = mapboxgl;
        setMapboxLoaded(true);

        const accessToken = token.trim();
        (mapboxgl as any).accessToken = accessToken;
        const styleUrl =
          Platform.OS === 'web' ? mapboxGlStyleUrl(accessToken) : MAPBOX_STYLE_LIGHT;

        const initialCenter =
          driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng)
            ? [driverStart.lng, driverStart.lat]
            : origin
              ? [origin.lng, origin.lat]
              : [-46.6333, -23.5505];
        const map = new (mapboxgl as any).Map({
          container: mapContainerRef.current,
          style: styleUrl,
          center: initialCenter,
          zoom: 11,
          interactive: true,
          failIfMajorPerformanceCaveat: false,
        });

        map.on('error', (e: { error?: Error }) => {
          const err = e?.error;
          if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production' && err) {
            console.warn('[MapView] Erro Mapbox GL:', err.message || err);
          }
        });

        mapRef.current = map;
        markersRef.current = [];

        const resizeMap = () => {
          if (cancelled || !mapRef.current) return;
          try {
            mapRef.current.resize();
          } catch { /* ignore */ }
        };
        const parentEl = mapContainerRef.current.parentElement;
        if (typeof ResizeObserver !== 'undefined' && parentEl) {
          resizeObserver = new ResizeObserver(() => {
            resizeMap();
          });
          resizeObserver.observe(parentEl);
        }

        const placeMarkersAndRoute = async () => {
          if (cancelled || !mapRef.current) return;
          const m = mapRef.current;
          markersRef.current.forEach((mk) => mk.remove());
          markersRef.current = [];

          const routeWaypointsOrdered = orderedRouteWaypoints(waypoints, destination);
          const routeWaypoints = routeWaypointsOrdered.map((wp) => ({
            ...wp,
            completed: !!(wp.completed || tripCompleted),
            isNext: tripCompleted ? false : wp.isNext,
          }));
          const routeOrigin =
            driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng)
              ? driverStart
              : origin;
          const carOffset = carMarkerOffsetPx(
            driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng) ? driverStart : undefined,
            origin,
            routeWaypointsOrdered,
          );
          const showPassengerPin = needsExplicitPassengerEmbarkMarker(origin, routeWaypointsOrdered);
          const passengerOffset = origin
            ? embarkMarkerOffsetPx(
                origin,
                driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng)
                  ? driverStart
                  : undefined,
                routeWaypointsOrdered,
              )
            : ([0, 0] as [number, number]);
          const nextStop = resolveNextNavTarget(destination, waypoints);
          const nextIsEmbark =
            Boolean(origin && nextStop && coordsNearlyEqual(nextStop, origin, COORDS_DEDupe_DEST_EPS));

          const fitMarkerPoints: Array<MapCoord | undefined> = [
            routeOrigin,
            origin,
            destination,
            ...routeWaypoints,
          ];

          if (routeOrigin) {
            markersRef.current.push(
              new (mapboxgl as any).Marker({
                element: createDriverStartMarkerElement(tripCompleted),
                anchor: MAP_MARKER_ANCHOR,
                offset: carOffset,
              })
                .setLngLat([routeOrigin.lng, routeOrigin.lat])
                .addTo(m),
            );
          }
          if (showPassengerPin && origin) {
            markersRef.current.push(
              new (mapboxgl as any).Marker({
                element: createPassengerEmbarkMarkerElement(undefined, nextIsEmbark && !tripCompleted, tripCompleted),
                anchor: MAP_MARKER_ANCHOR,
                offset: passengerOffset,
              })
                .setLngLat([origin.lng, origin.lat])
                .addTo(m),
            );
          }
          if (destination) {
            markersRef.current.push(
              new (mapboxgl as any).Marker({
                element: createTripDestinationMarkerElement(tripCompleted),
                anchor: MAP_MARKER_ANCHOR,
              })
                .setLngLat([destination.lng, destination.lat])
                .addTo(m),
            );
          }

          if (routeWaypoints.length > 0) {
            routeWaypoints.forEach((wp) => {
              const el = createRoteiroWaypointMarkerElement(wp);
              markersRef.current.push(
                new (mapboxgl as any).Marker({ element: el, anchor: MAP_MARKER_ANCHOR })
                  .setLngLat([wp.lng, wp.lat])
                  .addTo(m),
              );
            });
          }

          if (connectPoints && routeOrigin && destination) {
            try {
              removeTripLineLayer(m);
              removeTripNavLineLayer(m);
              const intermediateCoords = routeWaypoints.filter(
                (wp) => wp.lat != null && wp.lng != null && Number.isFinite(wp.lat) && Number.isFinite(wp.lng),
              );
              let line = await fetchDirectionsLineString(routeOrigin, destination, token, directionsProfile, ac.signal, intermediateCoords);
              if (cancelled || !mapRef.current) return;
              if (!line && directionsProfile === 'driving-traffic') {
                line = await fetchDirectionsLineString(routeOrigin, destination, token, 'driving', ac.signal, intermediateCoords);
              }
              if (cancelled || !mapRef.current) return;
              if (line) {
                setTripRouteLayer(m, line);
                if (!followVehicleRef.current) {
                  fitMapToRouteAndMarkers(m, mapboxgl, line.coordinates, fitMarkerPoints);
                }
              } else {
                addStraightFallbackLine(m, routeOrigin, destination);
                if (!followVehicleRef.current) {
                  fitMapToRouteAndMarkers(
                    m,
                    mapboxgl,
                    [[routeOrigin.lng, routeOrigin.lat], [destination.lng, destination.lat]],
                    fitMarkerPoints,
                  );
                }
              }
              const navTo = !tripCompleted ? resolveNextNavTarget(destination, waypoints) : undefined;
              if (
                navTo &&
                !coordsNearlyEqual(routeOrigin, navTo, COORDS_DEDupe_DEST_EPS)
              ) {
                setTripNavSegmentLayer(m, routeOrigin, navTo);
              }
              bringLiveTrailLayerToFront(m);
            } catch {
              if (cancelled || ac.signal.aborted || !mapRef.current) return;
              try {
                removeTripLineLayer(m);
                removeTripNavLineLayer(m);
                addStraightFallbackLine(m, routeOrigin, destination);
                if (!followVehicleRef.current) {
                  fitMapToRouteAndMarkers(
                    m,
                    mapboxgl,
                    [[routeOrigin.lng, routeOrigin.lat], [destination.lng, destination.lat]],
                    fitMarkerPoints,
                  );
                }
                const navTo = !tripCompleted ? resolveNextNavTarget(destination, waypoints) : undefined;
                if (navTo && !coordsNearlyEqual(routeOrigin, navTo, COORDS_DEDupe_DEST_EPS)) {
                  setTripNavSegmentLayer(m, routeOrigin, navTo);
                }
                bringLiveTrailLayerToFront(m);
              } catch { /* ignore */ }
            }
          } else {
            removeTripLineLayer(m);
            removeTripNavLineLayer(m);
            if (routeOrigin && destination) {
              if (!followVehicleRef.current) {
                fitMapToRouteAndMarkers(m, mapboxgl, null, fitMarkerPoints);
              }
            } else if (routeOrigin) {
              if (!followVehicleRef.current) {
                m.setCenter([routeOrigin.lng, routeOrigin.lat]);
                m.setZoom(12);
              }
            } else if (destination) {
              if (!followVehicleRef.current) {
                m.setCenter([destination.lng, destination.lat]);
                m.setZoom(12);
              }
            }
          }
        };

        const onReady = () => {
          resizeMap();
          setMapStyleReady(true);
          void placeMarkersAndRoute();
        };

        const afterIdleResize = () => {
          map.once('idle', () => {
            if (cancelled || !mapRef.current) return;
            resizeMap();
          });
        };

        if (map.isStyleLoaded && map.isStyleLoaded()) {
          resizeMap();
          setMapStyleReady(true);
          void placeMarkersAndRoute();
          afterIdleResize();
        } else {
          map.once('load', () => {
            onReady();
            afterIdleResize();
          });
        }
      } catch (err) {
        if (!cancelled) {
          if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            console.warn('[MapView] Mapbox GL indisponível — usando mapa estático (pins A/B).', err);
          }
          setGlFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      resizeObserver?.disconnect();
      resizeObserver = null;
      markersRef.current = [];
      setMapStyleReady(false);
      mapboxglRef.current = null;
      setMapboxLoaded(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [
    staticMode,
    token,
    connectPoints,
    directionsProfile,
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
    driverStart?.lat,
    driverStart?.lng,
  ]);

  // ── Efeito separado: atualiza markers/rota quando waypoints mudam ──────────
  // O efeito principal cria o mapa mas não inclui waypoints nas deps (para evitar
  // recriar o mapa a cada fetch). Este efeito re-coloca os markers quando os stops
  // chegam de forma assíncrona (ex.: useTripStops carrega após o mapa ser montado).
  useEffect(() => {
    const mapboxgl = mapboxglRef.current;
    if (!mapRef.current || !mapboxgl || !mapStyleReady) return;
    const m = mapRef.current;

    // Re-colocar todos os markers (remove antigos primeiro)
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];

    const routeWaypointsOrdered = orderedRouteWaypoints(waypoints, destination);
    const routeWaypoints = routeWaypointsOrdered.map((wp) => ({
      ...wp,
      completed: !!(wp.completed || tripCompleted),
      isNext: tripCompleted ? false : wp.isNext,
    }));
    const routeOrigin =
      driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng)
        ? driverStart
        : origin;
    const carOffset = carMarkerOffsetPx(
      driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng) ? driverStart : undefined,
      origin,
      routeWaypointsOrdered,
    );
    const showPassengerPin = needsExplicitPassengerEmbarkMarker(origin, routeWaypointsOrdered);
    const passengerOffset = origin
      ? embarkMarkerOffsetPx(
          origin,
          driverStart && Number.isFinite(driverStart.lat) && Number.isFinite(driverStart.lng) ? driverStart : undefined,
          routeWaypointsOrdered,
        )
      : ([0, 0] as [number, number]);
    const nextStop = resolveNextNavTarget(destination, waypoints);
    const nextIsEmbark =
      Boolean(origin && nextStop && coordsNearlyEqual(nextStop, origin, COORDS_DEDupe_DEST_EPS));

    const fitMarkerPoints: Array<MapCoord | undefined> = [
      routeOrigin,
      origin,
      destination,
      ...routeWaypoints,
    ];

    if (routeOrigin) {
      markersRef.current.push(
        new mapboxgl.Marker({
          element: createDriverStartMarkerElement(tripCompleted),
          anchor: MAP_MARKER_ANCHOR,
          offset: carOffset,
        })
          .setLngLat([routeOrigin.lng, routeOrigin.lat])
          .addTo(m),
      );
    }
    if (showPassengerPin && origin) {
      markersRef.current.push(
        new mapboxgl.Marker({
          element: createPassengerEmbarkMarkerElement(undefined, nextIsEmbark && !tripCompleted, tripCompleted),
          anchor: MAP_MARKER_ANCHOR,
          offset: passengerOffset,
        })
          .setLngLat([origin.lng, origin.lat])
          .addTo(m),
      );
    }
    if (destination) {
      markersRef.current.push(
        new mapboxgl.Marker({
          element: createTripDestinationMarkerElement(tripCompleted),
          anchor: MAP_MARKER_ANCHOR,
        })
          .setLngLat([destination.lng, destination.lat])
          .addTo(m),
      );
    }

    if (routeWaypoints.length > 0) {
      routeWaypoints.forEach((wp) => {
        const el = createRoteiroWaypointMarkerElement(wp);
        markersRef.current.push(
          new mapboxgl.Marker({ element: el, anchor: MAP_MARKER_ANCHOR })
            .setLngLat([wp.lng, wp.lat])
            .addTo(m),
        );
      });
    }

    if (connectPoints && routeOrigin && destination && token) {
      const intermediateCoords = routeWaypoints.filter((wp) => wp.lat != null && wp.lng != null);
      let cancelled = false;
      (async () => {
        try {
          removeTripLineLayer(m);
          removeTripNavLineLayer(m);
          let line = await fetchDirectionsLineString(routeOrigin, destination, token, directionsProfile, undefined, intermediateCoords);
          if (cancelled || !mapRef.current) return;
          if (!line && directionsProfile === 'driving-traffic') {
            line = await fetchDirectionsLineString(routeOrigin, destination, token, 'driving', undefined, intermediateCoords);
          }
          if (cancelled || !mapRef.current) return;
          if (line) {
            setTripRouteLayer(m, line);
            if (!followVehicleRef.current) {
              fitMapToRouteAndMarkers(m, mapboxgl, line.coordinates, fitMarkerPoints);
            }
          } else {
            addStraightFallbackLine(m, routeOrigin, destination);
            if (!followVehicleRef.current) {
              fitMapToRouteAndMarkers(
                m,
                mapboxgl,
                [[routeOrigin.lng, routeOrigin.lat], [destination.lng, destination.lat]],
                fitMarkerPoints,
              );
            }
          }
          const navTo = !tripCompleted ? resolveNextNavTarget(destination, waypoints) : undefined;
          if (navTo && !coordsNearlyEqual(routeOrigin, navTo, COORDS_DEDupe_DEST_EPS)) {
            setTripNavSegmentLayer(m, routeOrigin, navTo);
          }
          bringLiveTrailLayerToFront(m);
        } catch { /* ignore */ }
      })();
      return () => { cancelled = true; };
    } else {
      removeTripLineLayer(m);
      removeTripNavLineLayer(m);
    }
  }, [
    mapStyleReady,
    waypoints,
    tripCompleted,
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
    driverStart?.lat,
    driverStart?.lng,
    connectPoints,
    directionsProfile,
    token,
  ]);

  // Acompanhar veículo: zoom + centro em followTarget; reage a atualizações de coordenadas (GPS futuro).
  useEffect(() => {
    if (staticMode || useStatic || !followVehicle || !followTarget) return;
    const map = mapRef.current;
    if (!map || !mapStyleReady) return;
    const { lat, lng } = followTarget;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    try {
      const cur = typeof map.getZoom === 'function' ? map.getZoom() : 11;
      const z = Math.min(FOLLOW_VEHICLE_ZOOM_MAX, Math.max(FOLLOW_VEHICLE_ZOOM_MIN, cur));
      map.easeTo({
        center: [lng, lat],
        zoom: z,
        duration: 600,
        essential: true,
      });
    } catch { /* ignore */ }
  }, [followVehicle, followTarget?.lat, followTarget?.lng, mapStyleReady, staticMode, useStatic]);

  useEffect(() => {
    if (!onFollowVehicleInterrupted || !followVehicle) return;
    if (staticMode || useStatic) return;
    const map = mapRef.current;
    if (!map || !mapStyleReady) return;
    const endFollow = () => onFollowVehicleInterrupted();
    map.on('dragstart', endFollow);
    map.on('rotatestart', endFollow);
    return () => {
      try {
        map.off('dragstart', endFollow);
        map.off('rotatestart', endFollow);
      } catch { /* ignore */ }
    };
  }, [
    followVehicle,
    onFollowVehicleInterrupted,
    mapStyleReady,
    staticMode,
    useStatic,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (staticMode || useStatic || !token || !mapStyleReady) {
      if (map) removeLiveTrailLayer(map);
      return;
    }

    if (!currentPosition || !connectPoints || tripCompleted) {
      if (map) removeLiveTrailLayer(map);
      return;
    }

    const navTarget = resolveNextNavTarget(destination, waypoints);
    if (
      !navTarget ||
      !Number.isFinite(navTarget.lat) ||
      !Number.isFinite(navTarget.lng) ||
      !Number.isFinite(currentPosition.lat) ||
      !Number.isFinite(currentPosition.lng)
    ) {
      if (map) removeLiveTrailLayer(map);
      return;
    }

    if (coordsNearlyEqual(currentPosition, navTarget, COORDS_DEDupe_DEST_EPS)) {
      if (map) removeLiveTrailLayer(map);
      return;
    }

    const ac = new AbortController();
    const from = { ...currentPosition };
    const to = { ...navTarget };
    const t = setTimeout(() => {
      void (async () => {
        if (ac.signal.aborted) return;
        const m = mapRef.current;
        if (!m || (typeof m.isStyleLoaded === 'function' && !m.isStyleLoaded())) return;
        try {
          let line = await fetchDirectionsLineString(from, to, token, directionsProfile, ac.signal);
          if (ac.signal.aborted || !mapRef.current) return;
          if (!line && directionsProfile === 'driving-traffic') {
            line = await fetchDirectionsLineString(from, to, token, 'driving', ac.signal);
          }
          if (ac.signal.aborted || !mapRef.current) return;
          const mapNow = mapRef.current;
          if (!mapNow || (typeof mapNow.isStyleLoaded === 'function' && !mapNow.isStyleLoaded())) return;
          if (line && line.coordinates.length >= 2) {
            setLiveTrailLayer(mapNow, line);
          } else {
            setLiveTrailLayer(mapNow, {
              type: 'LineString',
              coordinates: [
                [from.lng, from.lat],
                [to.lng, to.lat],
              ],
            });
          }
        } catch {
          if (ac.signal.aborted || !mapRef.current) return;
          try {
            setLiveTrailLayer(mapRef.current, {
              type: 'LineString',
              coordinates: [
                [from.lng, from.lat],
                [to.lng, to.lat],
              ],
            });
          } catch { /* ignore */ }
        }
      })();
    }, LIVE_TRAIL_FETCH_DEBOUNCE_MS);

    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [
    staticMode,
    useStatic,
    token,
    mapStyleReady,
    connectPoints,
    tripCompleted,
    directionsProfile,
    currentPosition?.lat,
    currentPosition?.lng,
    destination?.lat,
    destination?.lng,
    waypoints,
  ]);

  useEffect(() => {
    try {
      currentPositionMarkerRef.current?.remove();
      currentPositionMarkerRef.current = null;
    } catch { /* ignore */ }

    if (!mapRef.current || !currentPosition || !mapboxLoaded || !mapStyleReady || !token) return;

    const element = createLiveVehicleMarkerElement(liveVehicleEta);

    (async () => {
      try {
        const pack: any = await import('mapbox-gl');
        const mapboxgl = pack.default ?? pack;
        if (!mapRef.current) return;
        const mk = new (mapboxgl as any).Marker({ element, anchor: 'bottom' })
          .setLngLat([currentPosition.lng, currentPosition.lat])
          .addTo(mapRef.current);
        currentPositionMarkerRef.current = mk;
      } catch { /* ignore */ }
    })();

    return () => {
      try {
        currentPositionMarkerRef.current?.remove();
        currentPositionMarkerRef.current = null;
      } catch { /* ignore */ }
    };
  }, [currentPosition?.lat, currentPosition?.lng, mapboxLoaded, mapStyleReady, token, liveVehicleEta]);

  const noCoords = !origin && !destination;
  if (noCoords) {
    return React.createElement(MapPlaceholder, {
      height,
      style,
      subMessage: 'Sem coordenadas de origem/destino. Defina endereços com a busca do Google ou salve após geocodificação.',
    });
  }

  if (useStatic) {
    const baseStatic = buildStaticUrl(origin, destination, staticSnapshotWidthPx(height), height);
    const url = staticRouteUrl || baseStatic;
    if (!url) {
      return React.createElement(MapPlaceholder, {
        height,
        style,
        subMessage: token
          ? 'Não foi possível montar a imagem do mapa.'
          : 'Configure EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN (e reinicie o build) para exibir o mapa Mapbox.',
      });
    }

    // `contain` + flex centra o PNG inteiro: atribuição Mapbox no rodapé da imagem não é cortada (vs `cover`).
    return React.createElement('div', {
      style: {
        position: 'relative' as const,
        width: '100%',
        minHeight: height,
        height,
        background: STATIC_MAP_LETTERBOX_BG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box' as const,
        borderRadius: 12,
        overflow: 'hidden' as const,
        ...style,
      },
    },
      React.createElement('img', {
        src: url,
        alt: 'Mapa do trajeto',
        style: {
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain' as const,
          objectPosition: 'center',
          display: 'block',
        },
      }),
      ...(showFigmaMapChrome ? mapFigmaChromeElements() : []));
  }

  return React.createElement('div', {
    style: {
      position: 'relative' as const,
      width: '100%',
      minHeight: height,
      height,
      borderRadius: 12,
      overflow: 'hidden',
      ...style,
    },
  },
    React.createElement('div', {
      ref: mapContainerRef,
      style: {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      },
    }),
    ...(showFigmaMapChrome ? mapFigmaChromeElements() : []));
}
