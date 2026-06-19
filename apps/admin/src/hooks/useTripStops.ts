import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { MapWaypoint } from '../components/MapView';
import { parseCoordPair } from '../lib/mapCoordUtils';
import { geocodeAddress } from '../lib/googleGeocoding';

// ── Types ────────────────────────────────────────────────────────────
export interface TripStop {
  id: string;
  scheduled_trip_id: string;
  stop_type: string;
  entity_id: string | null;
  label: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  sequence_order: number;
  status: string;
}

interface UseTripStopsReturn {
  stops: TripStop[];
  /** Waypoints formatados para o MapView (sem origin/destination — esses vem do trip) */
  waypoints: MapWaypoint[];
  loading: boolean;
  /** Regenera stops (chamar após trocar motorista, add/remove passageiro, vincular encomenda) */
  regenerate: () => Promise<void>;
}

/** `trip_stops.status` após confirmação no app motorista. */
function isTripStopStatusDone(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'completed';
}

// ── Cores por tipo de parada (igual `STOP_TYPE_COLORS` no app motorista) ──
const STOP_COLORS: Record<string, string> = {
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

type ShipmentMapRow = {
  id: string;
  origin_address?: string | null;
  destination_address?: string | null;
  origin_lat?: unknown;
  origin_lng?: unknown;
  destination_lat?: unknown;
  destination_lng?: unknown;
  recipient_name?: string | null;
  pickup_code?: string | null;
  delivery_code?: string | null;
};

/** `#abcd1234` — identificador curto da encomenda no mapa. */
function shortId(id: string | null | undefined): string {
  const s = String(id ?? '').trim();
  return s ? `#${s.slice(0, 8)}` : '';
}

/** Label distinto por envio: `Coleta/Entrega · <destinatário> · PIN <code> · #<id8>`. */
function formatShipmentStopLabel(
  leg: 'pickup' | 'dropoff',
  shipment: { id: string; recipient_name?: string | null; pickup_code?: string | null; delivery_code?: string | null; origin_address?: string | null; destination_address?: string | null },
): string {
  const who =
    (shipment.recipient_name && String(shipment.recipient_name).trim()) ||
    ((leg === 'pickup' ? shipment.origin_address : shipment.destination_address) ?? '').split(',')[0]?.trim() ||
    'Encomenda';
  const code = (leg === 'pickup' ? shipment.pickup_code : shipment.delivery_code)?.trim();
  const parts = [leg === 'pickup' ? 'Coleta' : 'Entrega', who];
  if (code) parts.push(`PIN ${code}`);
  const sid = shortId(shipment.id);
  if (sid) parts.push(sid);
  return parts.join(' · ');
}

type BookingMapRow = {
  id: string;
  origin_address?: string | null;
  destination_address?: string | null;
  origin_lat?: unknown;
  origin_lng?: unknown;
  destination_lat?: unknown;
  destination_lng?: unknown;
  profiles?: { full_name?: string | null } | null;
};

/** Espelha `buildStopsManually` / entidades em `trip_stops` (`entity_id` = booking.id). */
function sequenceOrderForBookingLeg(
  stops: TripStop[],
  bookingId: string,
  leg: 'pickup' | 'dropoff',
): number | null {
  const bid = bookingId.trim().toLowerCase();
  for (const st of stops) {
    const pickup = st.stop_type === 'passenger_pickup';
    const drop = st.stop_type === 'passenger_dropoff';
    if (leg === 'pickup' && !pickup) continue;
    if (leg === 'dropoff' && !drop) continue;
    if (String(st.entity_id ?? '').trim().toLowerCase() !== bid) continue;
    return st.sequence_order ?? 0;
  }
  return null;
}

function passengerLegRenderableInStops(stops: TripStop[], bookingId: string, leg: 'pickup' | 'dropoff'): boolean {
  const bid = bookingId.trim().toLowerCase();
  for (const st of stops) {
    const pickup = st.stop_type === 'passenger_pickup';
    const drop = st.stop_type === 'passenger_dropoff';
    if (leg === 'pickup' && !pickup) continue;
    if (leg === 'dropoff' && !drop) continue;
    if (String(st.entity_id ?? '').trim().toLowerCase() !== bid) continue;
    return (
      st.lat != null &&
      st.lng != null &&
      Number.isFinite(st.lat) &&
      Number.isFinite(st.lng)
    );
  }
  return false;
}

function passengerLegCompletedInStops(stops: TripStop[], bookingId: string, leg: 'pickup' | 'dropoff'): boolean {
  const bid = bookingId.trim().toLowerCase();
  for (const st of stops) {
    const pickup = st.stop_type === 'passenger_pickup';
    const drop = st.stop_type === 'passenger_dropoff';
    if (leg === 'pickup' && !pickup) continue;
    if (leg === 'dropoff' && !drop) continue;
    if (String(st.entity_id ?? '').trim().toLowerCase() !== bid) continue;
    return isTripStopStatusDone(st.status);
  }
  return false;
}

/** `null` = não há linha em `trip_stops` para este envio/perna (o chamador atribui ordem órfã única). */
function sequenceOrderForShipmentLeg(
  stops: TripStop[],
  shipmentId: string,
  leg: 'pickup' | 'dropoff',
): number | null {
  const sid = shipmentId.trim().toLowerCase();
  for (const st of stops) {
    const pickup = st.stop_type === 'package_pickup' || st.stop_type === 'shipment_pickup';
    const drop = st.stop_type === 'package_dropoff' || st.stop_type === 'shipment_dropoff';
    if (leg === 'pickup' && !pickup) continue;
    if (leg === 'dropoff' && !drop) continue;
    if (String(st.entity_id ?? '').trim().toLowerCase() !== sid) continue;
    return st.sequence_order ?? 0;
  }
  return null;
}

function shipmentLegCompletedInStops(stops: TripStop[], shipmentId: string, leg: 'pickup' | 'dropoff'): boolean {
  const sid = shipmentId.trim().toLowerCase();
  for (const st of stops) {
    const pickup = st.stop_type === 'package_pickup' || st.stop_type === 'shipment_pickup';
    const drop = st.stop_type === 'package_dropoff' || st.stop_type === 'shipment_dropoff';
    if (leg === 'pickup' && !pickup) continue;
    if (leg === 'dropoff' && !drop) continue;
    if (String(st.entity_id ?? '').trim().toLowerCase() !== sid) continue;
    return isTripStopStatusDone(st.status);
  }
  return false;
}

/** Já existe em `trip_stops` um ponto deste envio com lat/lng (o MapView não precisa de suplemento). */
function shipmentLegRenderableInStops(stops: TripStop[], shipmentId: string, leg: 'pickup' | 'dropoff'): boolean {
  const sid = shipmentId.trim().toLowerCase();
  for (const st of stops) {
    const t = st.stop_type;
    const match =
      leg === 'pickup'
        ? t === 'package_pickup' || t === 'shipment_pickup'
        : t === 'package_dropoff' || t === 'shipment_dropoff';
    if (!match) continue;
    if (String(st.entity_id ?? '').trim().toLowerCase() !== sid) continue;
    return (
      st.lat != null &&
      st.lng != null &&
      Number.isFinite(st.lat) &&
      Number.isFinite(st.lng)
    );
  }
  return false;
}

async function coordFromColumnsOrGeocode(
  lat: unknown,
  lng: unknown,
  address: string,
): Promise<{ lat: number; lng: number } | undefined> {
  const p = parseCoordPair(lat, lng);
  if (p) return p;
  const a = (address || '').trim();
  if (!a) return undefined;
  const g = await geocodeAddress(a);
  return g ? { lat: g.lat, lng: g.lng } : undefined;
}

/**
 * Pontos que faltam em `trip_stops` (sem lat/lng ou linha em falta), alinhado ao motorista:
 * `buildStopsManually` — passageiro pickup/dropoff por `bookings`; encomenda por `shipments`.
 */
async function fetchSupplementalWaypointsForTrip(tripId: string, stops: TripStop[]): Promise<MapWaypoint[]> {
  const maxSeq = stops.reduce((m, st) => Math.max(m, st.sequence_order ?? 0), 0);
  let orphanSeq = maxSeq + 1;
  const nextOrphan = () => orphanSeq++;
  const tasks: Promise<MapWaypoint | null>[] = [];

  const { data: bookingRows, error: bookErr } = await supabase
    .from('bookings')
    .select(
      'id, origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng, profiles(full_name)',
    )
    .eq('scheduled_trip_id', tripId)
    .not('status', 'eq', 'cancelled');

  if (!bookErr && bookingRows?.length) {
    for (const b of bookingRows as BookingMapRow[]) {
      const bid = b.id;
      const name = b.profiles?.full_name?.trim() || 'Passageiro';
      if (!passengerLegRenderableInStops(stops, bid, 'pickup')) {
        const sortP = sequenceOrderForBookingLeg(stops, bid, 'pickup') ?? nextOrphan();
        tasks.push(
          (async () => {
            const ll = await coordFromColumnsOrGeocode(b.origin_lat, b.origin_lng, b.origin_address ?? '');
            if (!ll) return null;
            const label = `${name} — embarque`;
            return {
              lat: ll.lat,
              lng: ll.lng,
              label,
              color: STOP_COLORS.passenger_pickup,
              type: 'passenger_pickup',
              sortOrder: sortP,
              completed: passengerLegCompletedInStops(stops, bid, 'pickup'),
              entityId: bid,
            } satisfies MapWaypoint;
          })(),
        );
      }
      if (!passengerLegRenderableInStops(stops, bid, 'dropoff')) {
        const sortD = sequenceOrderForBookingLeg(stops, bid, 'dropoff') ?? nextOrphan();
        tasks.push(
          (async () => {
            const ll = await coordFromColumnsOrGeocode(
              b.destination_lat,
              b.destination_lng,
              b.destination_address ?? '',
            );
            if (!ll) return null;
            const label = `${name} — desembarque`;
            return {
              lat: ll.lat,
              lng: ll.lng,
              label,
              color: STOP_COLORS.passenger_dropoff,
              type: 'passenger_dropoff',
              sortOrder: sortD,
              completed: passengerLegCompletedInStops(stops, bid, 'dropoff'),
              entityId: bid,
            } satisfies MapWaypoint;
          })(),
        );
      }
    }
  }

  const { data: shipRows, error: shipErr } = await supabase
    .from('shipments')
    .select(
      'id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, recipient_name, pickup_code, delivery_code, status',
    )
    .eq('scheduled_trip_id', tripId)
    .not('status', 'eq', 'cancelled');

  if (!shipErr && shipRows?.length) {
    for (const s of shipRows as ShipmentMapRow[]) {
      const sid = s.id;
      if (!shipmentLegRenderableInStops(stops, sid, 'pickup')) {
        const sortPickup = sequenceOrderForShipmentLeg(stops, sid, 'pickup') ?? nextOrphan();
        tasks.push(
          (async () => {
            const ll = await coordFromColumnsOrGeocode(s.origin_lat, s.origin_lng, s.origin_address ?? '');
            if (!ll) return null;
            const label = formatShipmentStopLabel('pickup', s);
            return {
              lat: ll.lat,
              lng: ll.lng,
              label,
              color: STOP_COLORS.package_pickup,
              type: 'package_pickup',
              sortOrder: sortPickup,
              completed: shipmentLegCompletedInStops(stops, sid, 'pickup'),
              entityId: sid,
              shipmentLeg: 'pickup' as const,
              code: s.pickup_code ?? null,
            } satisfies MapWaypoint;
          })(),
        );
      }
      if (!shipmentLegRenderableInStops(stops, sid, 'dropoff')) {
        const sortDrop = sequenceOrderForShipmentLeg(stops, sid, 'dropoff') ?? nextOrphan();
        tasks.push(
          (async () => {
            const ll = await coordFromColumnsOrGeocode(
              s.destination_lat,
              s.destination_lng,
              s.destination_address ?? '',
            );
            if (!ll) return null;
            const label = formatShipmentStopLabel('dropoff', s);
            return {
              lat: ll.lat,
              lng: ll.lng,
              label,
              color: STOP_COLORS.package_dropoff,
              type: 'package_dropoff',
              sortOrder: sortDrop,
              completed: shipmentLegCompletedInStops(stops, sid, 'dropoff'),
              entityId: sid,
              shipmentLeg: 'dropoff' as const,
              code: s.delivery_code ?? null,
            } satisfies MapWaypoint;
          })(),
        );
      }
    }
  }

  const settled = await Promise.all(tasks);
  return settled.filter((w): w is MapWaypoint => w != null);
}

// ── Hook ─────────────────────────────────────────────────────────────
export function useTripStops(tripId: string | null | undefined): UseTripStopsReturn {
  const [stops, setStops] = useState<TripStop[]>([]);
  const [supplementalWaypoints, setSupplementalWaypoints] = useState<MapWaypoint[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStops = useCallback(async () => {
    if (!tripId) { setStops([]); return; }
    setLoading(true);

    // 1. Buscar stops existentes
    const { data, error } = await (supabase as any)
      .from('trip_stops')
      .select('*')
      .eq('scheduled_trip_id', tripId)
      .order('sequence_order', { ascending: true });

    if (!error && data && data.length > 0) {
      setStops(data);
      setLoading(false);
      return;
    }

    // 2. Se não existem, gerar via function SQL
    await (supabase as any).rpc('generate_trip_stops', { p_trip_id: tripId });

    // 3. Buscar novamente
    const { data: generated } = await (supabase as any)
      .from('trip_stops')
      .select('*')
      .eq('scheduled_trip_id', tripId)
      .order('sequence_order', { ascending: true });

    setStops(generated || []);
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    fetchStops();
  }, [fetchStops]);

  useEffect(() => {
    let cancelled = false;
    if (!tripId) {
      setSupplementalWaypoints([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const extra = await fetchSupplementalWaypointsForTrip(tripId, stops);
      if (!cancelled) setSupplementalWaypoints(extra);
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, stops]);

  // Regenerar stops (ex: após trocar motorista)
  const regenerate = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    const { error: rpcErr } = await (supabase as any).rpc('generate_trip_stops', { p_trip_id: tripId });
    if (rpcErr) {
      setLoading(false);
      throw new Error(rpcErr.message || 'generate_trip_stops falhou');
    }
    const { data } = await (supabase as any)
      .from('trip_stops')
      .select('*')
      .eq('scheduled_trip_id', tripId)
      .order('sequence_order', { ascending: true });
    setStops(data || []);
    setLoading(false);
  }, [tripId]);

  // Converter stops intermediários em waypoints para MapView
  // (exclui driver_origin e trip_destination que viram origin/destination do MapView)
  // useMemo evita criar nova referência a cada render (o MapView depende da referência
  // para saber quando re-desenhar markers e buscar rota nova).
  const waypoints: MapWaypoint[] = useMemo(() => {
    const fromStops: MapWaypoint[] = stops
      .filter((s) => s.stop_type !== 'driver_origin' && s.stop_type !== 'trip_destination')
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({
        lat: s.lat!,
        lng: s.lng!,
        label: s.label || s.address,
        color: STOP_COLORS[s.stop_type] || '#767676',
        type: s.stop_type,
        sortOrder: s.sequence_order ?? 0,
        completed: isTripStopStatusDone(s.status),
        entityId: s.entity_id ?? undefined,
      }));
    const merged = [...fromStops, ...supplementalWaypoints].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    const firstPending = merged.findIndex((w) => !w.completed);
    return merged.map((w, i) => ({
      ...w,
      isNext: firstPending >= 0 && i === firstPending,
    }));
  }, [stops, supplementalWaypoints]);

  return { stops, waypoints, loading, regenerate };
}
