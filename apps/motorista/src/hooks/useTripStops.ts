import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { latLngFromDbColumns, isValidGlobeCoordinate } from '../components/googleMaps';
import { onlyDigits } from '../utils/formatCpf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StopType =
  | 'passenger_pickup'
  | 'passenger_dropoff'
  | 'dependent_pickup'
  | 'dependent_dropoff'
  | 'package_pickup'
  | 'package_dropoff'
  | 'excursion_stop'
  | 'driver_origin'
  | 'trip_destination'
  | 'base_dropoff';

export type StopStatus = 'pending' | 'completed' | 'skipped';

/** Perna da encomenda no app do motorista (com base: retirada na base → destino; sem base: cliente → destino). */
export type PackageDriverLeg = 'client_pickup' | 'base_pickup' | 'destination_dropoff';

export type TripStop = {
  id: string;
  scheduledTripId: string;
  stopType: StopType;
  entityId: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  sequenceOrder: number;
  status: StopStatus;
  notes: string | null;
  code: string | null;
  /** Só `package_pickup` / `package_dropoff`: origem do cliente, retirada na base ou entrega final. */
  packageDriverLeg?: PackageDriverLeg;
};

// Colors per stop_type (PRD Admin §6.5)
export const STOP_TYPE_COLORS: Record<StopType, string> = {
  passenger_pickup: '#10B981',   // green  — embarque passageiro
  passenger_dropoff: '#3B82F6',  // blue   — desembarque passageiro
  dependent_pickup: '#059669',   // emerald — embarque dependente
  dependent_dropoff: '#2563EB', // blue-600 — desembarque dependente
  package_pickup: '#F59E0B',     // amber  — coleta encomenda
  package_dropoff: '#6366F1',    // indigo — entrega encomenda
  excursion_stop: '#EC4899',     // pink   — parada excursão
  driver_origin: '#64748B',      // slate  — partida / ponto do motorista
  trip_destination: '#1D4ED8',   // blue   — destino final da viagem
  base_dropoff: '#EA580C',       // orange — entrega em base
};

/** IDs sintéticos (fallback sem linha em `trip_stops`) — devem ser trocados pelo UUID do banco quando existir. */
export function isSyntheticTripStopId(id: string): boolean {
  return /^(booking|shipment|dependent)-(pickup|dropoff)-/i.test(id);
}

/** UUID de `dependent_shipments` embutido em `dependent-pickup-…` / `dependent-dropoff-…`. */
export function dependentShipmentIdFromSyntheticStopId(id: string): string | null {
  const m = String(id ?? '').match(/^dependent-(pickup|dropoff)-([0-9a-f-]{36})$/i);
  return m?.[2] ? m[2].toLowerCase() : null;
}

/**
 * Para cada id de envio na viagem, devolve o conjunto { id do envio, dependent_id? } em minúsculas,
 * para casar `trip_stops.entity_id` com o que o `generate_trip_stops` gravou (id vs dependent_id).
 */
export async function fetchDependentShipmentEntityAliasKeys(
  tripId: string,
  shipmentIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const ids = [
    ...new Set(
      shipmentIds.map((x) => String(x ?? '').trim().toLowerCase()).filter((x) => x.length >= 32),
    ),
  ];
  if (!tripId || ids.length === 0) return out;
  const { data } = await supabase
    .from('dependent_shipments')
    .select('id, dependent_id')
    .eq('scheduled_trip_id', tripId)
    .in('id', ids);
  for (const r of (data ?? []) as { id: string; dependent_id?: string | null }[]) {
    const set = new Set<string>();
    const idl = String(r.id).trim().toLowerCase();
    set.add(idl);
    if (r.dependent_id) set.add(String(r.dependent_id).trim().toLowerCase());
    out.set(idl, set);
  }
  return out;
}

/**
 * Materializa passageiros/encomendas/dependentes em `trip_stops` (idempotente), preenchendo
 * `trip_stops.code` a partir das entidades origem. Usa `ensure_all_trip_stops` quando disponível;
 * fallback para as RPCs específicas em deploys antigos onde a agregadora ainda não existe.
 */
export async function ensureAllTripStopsRemote(tripId: string): Promise<void> {
  if (!tripId) return;
  const agg = await supabase.rpc('ensure_all_trip_stops' as never, { p_trip_id: tripId } as never);
  if (!agg.error) return;
  // Fallback: deploys que ainda não receberam 20260520130000_*.
  await Promise.all([
    supabase.rpc('ensure_passenger_trip_stops' as never, { p_trip_id: tripId } as never),
    supabase.rpc('ensure_shipment_trip_stops' as never, { p_trip_id: tripId } as never),
    supabase.rpc('ensure_dependent_trip_stops' as never, { p_trip_id: tripId } as never),
  ]);
}

/** Índice da primeira parada ainda não concluída; se todas concluídas, retorna `stops.length`. */
export function computeFirstIncompleteStopIndex(stops: TripStop[]): number {
  if (stops.length === 0) return 0;
  const idx = stops.findIndex((s) => s.status !== 'completed');
  return idx === -1 ? stops.length : idx;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTripStops(tripId: string | null) {
  const [stops, setStops] = useState<TripStop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }): Promise<TripStop[]> => {
    const silent = opts?.silent === true;
    if (!tripId) {
      setStops([]);
      return [];
    }
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    let out: TripStop[] = [];

    try {
      // Materializa TODAS as paradas (passageiro/encomenda/dependente) de forma idempotente,
      // preenchendo `trip_stops.code` a partir de bookings/shipments/dependent_shipments.
      // Evitamos `generate_trip_stops` (remoto) porque ele é destrutivo (DELETE inicial) e
      // incompleto (não cria dropoffs nem paradas de dependente, não copia codes).
      await ensureAllTripStopsRemote(tripId);

      // 1. Try trip_stops table
      const { data, error: fetchErr } = await supabase
        .from('trip_stops')
        .select('*')
        .eq('scheduled_trip_id', tripId)
        .order('sequence_order', { ascending: true });

      if (fetchErr) {
        const fallback = await buildStopsManually(tripId);
        out = await finalizeStopsForTrip(tripId, fallback);
      } else if (data && data.length > 0) {
        out = await finalizeStopsForTrip(tripId, mapRows(data));
      } else {
        // 2. Sem linhas: o `ensure_all_trip_stops` só materializa passageiros/encomendas/dependentes,
        //    mas não cria `driver_origin` nem `trip_destination`. Sem a âncora `driver_origin`,
        //    algumas views antigas podem falhar em montar a ordem — usamos o fallback local.
        const fallback = await buildStopsManually(tripId);
        out = await finalizeStopsForTrip(tripId, fallback);
      }

      setStops(out);
      return out;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar paradas';
      setError(msg);
      setStops([]);
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tripId) return;

    const scheduleSilentReload = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null;
        void load({ silent: true });
      }, 500);
    };

    const channel = supabase
      .channel(`active-trip-stops-${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trip_stops',
          filter: `scheduled_trip_id=eq.${tripId}`,
        },
        scheduleSilentReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scheduled_trips',
          filter: `id=eq.${tripId}`,
        },
        scheduleSilentReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `scheduled_trip_id=eq.${tripId}`,
        },
        scheduleSilentReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shipments',
          filter: `scheduled_trip_id=eq.${tripId}`,
        },
        scheduleSilentReload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dependent_shipments',
          filter: `scheduled_trip_id=eq.${tripId}`,
        },
        scheduleSilentReload,
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [tripId, load]);

  return { stops, loading, error, reload: load };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type StopRowMeta = { label?: string | null; sequence_order?: number | null };

/** Metadados opcionais de `trip_stops` para heurística `driver_origin`. */
export type DbStopTypeMeta = { label?: string | null; sequence_order?: number | null };

/** Admin/PRD usam shipment_*; o app motorista usa package_* nos helpers de mapa. */
function normalizeDbStopType(db: string, row?: StopRowMeta): StopType {
  const raw = String(db ?? '').trim();
  const canonical = raw.replace(/\s+/g, '_').toLowerCase();
  const labelNorm = String(row?.label ?? '').trim().toLowerCase();
  const seq = row?.sequence_order;

  // Alguns deploys marcam o 1º ponto (partida do motorista) como shipment/package_pickup.
  if (
    (canonical === 'shipment_pickup' || canonical === 'package_pickup') &&
    (seq === 1 || seq === 0) &&
    (labelNorm === 'motorista' || labelNorm.includes('motorista'))
  ) {
    return 'driver_origin';
  }

  // `generate_trip_stops` / migrações antigas: variantes de texto (não batem no switch exato).
  if (canonical.includes('dependent')) {
    if (
      canonical.includes('pickup') ||
      canonical.includes('embark') ||
      canonical.includes('board') ||
      canonical.includes('collect')
    ) {
      return 'dependent_pickup';
    }
    if (
      canonical.includes('dropoff') ||
      canonical.includes('drop_off') ||
      canonical.includes('delivery') ||
      canonical.includes('debark')
    ) {
      return 'dependent_dropoff';
    }
  }

  switch (canonical) {
    case 'shipment_pickup':
      return 'package_pickup';
    case 'shipment_dropoff':
      return 'package_dropoff';
    case 'passenger_pickup':
    case 'passenger_dropoff':
    case 'dependent_pickup':
    case 'dependent_dropoff':
    case 'package_pickup':
    case 'package_dropoff':
    case 'excursion_stop':
    case 'driver_origin':
    case 'trip_destination':
    case 'base_dropoff':
      return canonical as StopType;
    default:
      return 'excursion_stop';
  }
}

/** Expõe `normalizeDbStopType` para telas que precisam casar `trip_stops` cru com o app. */
export function normalizeTripStopTypeFromDb(db: string, row?: DbStopTypeMeta): StopType {
  return normalizeDbStopType(db, row);
}

function mapRows(rows: any[]): TripStop[] {
  return rows.map((r) => ({
    id: r.id,
    scheduledTripId: r.scheduled_trip_id,
    stopType: normalizeDbStopType(String(r.stop_type ?? ''), {
      label: r.label,
      sequence_order: r.sequence_order,
    }),
    entityId: r.entity_id,
    label: r.label ?? '',
    address: r.address ?? '',
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    sequenceOrder: r.sequence_order,
    status: (r.status ?? 'pending') as StopStatus,
    notes: r.notes ?? null,
    code: r.code ?? null,
    packageDriverLeg: ((r as { package_driver_leg?: string }).package_driver_leg as PackageDriverLeg | undefined) ??
      undefined,
  }));
}

/** Ponto de “partida cadastrada” não entra na rota do app: o GPS já é o início da corrida. */
function omitDriverOriginStops(stops: TripStop[]): TripStop[] {
  return stops.filter((s) => s.stopType !== 'driver_origin');
}

type ShipmentRow = {
  id: string;
  base_id?: string | null;
  instructions?: string | null;
  origin_address?: string | null;
  destination_address?: string | null;
  origin_lat?: unknown;
  origin_lng?: unknown;
  destination_lat?: unknown;
  destination_lng?: unknown;
  recipient_name?: string | null;
  pickup_code?: string | null;
  delivery_code?: string | null;
  /** PDF cenário 3: PIN C (motorista digita ao retirar na base). */
  base_to_driver_code?: string | null;
};

type BaseRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
};

function haversineKmApprox(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Paradas de coleta/entrega derivadas de `shipments` (motorista = driver da viagem). Com `base_id`: retirada na base → destino (preparador já levou cliente → base). */
async function buildShipmentStopsOnly(tripId: string): Promise<TripStop[]> {
  const { data: tripDriverRow } = await supabase
    .from('scheduled_trips')
    .select('driver_id')
    .eq('id', tripId)
    .maybeSingle();
  const tripDriverId = (tripDriverRow as { driver_id?: string | null } | null)?.driver_id ?? null;
  if (!tripDriverId) return [];

  const { data: shipments } = await supabase
    .from('shipments')
    .select(`
      id,
      base_id,
      instructions,
      origin_address,
      destination_address,
      origin_lat,
      origin_lng,
      destination_lat,
      destination_lng,
      recipient_name,
      pickup_code,
      delivery_code,
      base_to_driver_code
    `)
    .eq('scheduled_trip_id', tripId)
    .eq('driver_id', tripDriverId)
    .in('status', ['confirmed', 'in_progress']);

  const rows = (shipments ?? []) as ShipmentRow[];
  const baseIds = [...new Set(rows.map((r) => r.base_id).filter(Boolean))] as string[];
  let baseById = new Map<string, BaseRow>();
  if (baseIds.length > 0) {
    const { data: bases } = await supabase
      .from('bases')
      .select('id, name, address, city, lat, lng')
      .in('id', baseIds)
      .eq('is_active', true);
    baseById = new Map(
      ((bases ?? []) as BaseRow[]).map((b) => [b.id, b]),
    );
  }

  const out: TripStop[] = [];
  for (const s of rows) {
    const dropLL = latLngFromDbColumns(s.destination_lat, s.destination_lng);
    const baseId = s.base_id ? String(s.base_id) : null;
    const b = baseId ? baseById.get(baseId) : null;

    if (b) {
      const baseLL = latLngFromDbColumns(b.lat, b.lng);
      const baseAddr = [b.name, b.address, b.city].filter(Boolean).join(' — ') || b.address || '';
      // PDF cenário 3: motorista valida PIN C (base_to_driver_code) ao retirar na base.
      // Fallback para pickup_code mantém compatibilidade com encomendas antigas
      // que ainda não tiveram o backfill aplicado.
      const baseRetirada = s.base_to_driver_code ?? s.pickup_code ?? null;
      out.push({
        id: `shipment-pickup-${s.id}`,
        scheduledTripId: tripId,
        stopType: 'package_pickup',
        entityId: s.id,
        label: `Retirada na base — ${b.name}`,
        address: baseAddr,
        lat: baseLL?.latitude ?? null,
        lng: baseLL?.longitude ?? null,
        sequenceOrder: 0,
        status: 'pending',
        notes: s.instructions ?? null,
        code: baseRetirada,
        packageDriverLeg: 'base_pickup',
      });
      out.push({
        id: `shipment-dropoff-${s.id}`,
        scheduledTripId: tripId,
        stopType: 'package_dropoff',
        entityId: s.id,
        label: s.recipient_name?.trim() || 'Destinatário',
        address: s.destination_address ?? '',
        lat: dropLL?.latitude ?? null,
        lng: dropLL?.longitude ?? null,
        sequenceOrder: 0,
        status: 'pending',
        notes: null,
        code: s.delivery_code ?? null,
        packageDriverLeg: 'destination_dropoff',
      });
      continue;
    }

    const originShort = (s.origin_address ?? '').split(',')[0]?.trim() || 'Coleta';
    const pickupLL = latLngFromDbColumns(s.origin_lat, s.origin_lng);
    out.push({
      id: `shipment-pickup-${s.id}`,
      scheduledTripId: tripId,
      stopType: 'package_pickup',
      entityId: s.id,
      label: originShort,
      address: s.origin_address ?? '',
      lat: pickupLL?.latitude ?? null,
      lng: pickupLL?.longitude ?? null,
      sequenceOrder: 0,
      status: 'pending',
      notes: s.instructions ?? null,
      code: s.pickup_code ?? null,
      packageDriverLeg: 'client_pickup',
    });
    out.push({
      id: `shipment-dropoff-${s.id}`,
      scheduledTripId: tripId,
      stopType: 'package_dropoff',
      entityId: s.id,
      label: s.recipient_name?.trim() || 'Destinatário',
      address: s.destination_address ?? '',
      lat: dropLL?.latitude ?? null,
      lng: dropLL?.longitude ?? null,
      sequenceOrder: 0,
      status: 'pending',
      notes: null,
      code: s.delivery_code ?? null,
      packageDriverLeg: 'destination_dropoff',
    });
  }
  return out;
}

type DependentShipmentRow = {
  id: string;
  full_name?: string | null;
  origin_address?: string | null;
  destination_address?: string | null;
  origin_lat?: unknown;
  origin_lng?: unknown;
  destination_lat?: unknown;
  destination_lng?: unknown;
  instructions?: string | null;
  status?: string | null;
  pickup_code?: string | null;
  delivery_code?: string | null;
};

/** Coleta e entrega do dependente na mesma viagem (origem/destino do envio). */
async function buildDependentStopsOnly(tripId: string): Promise<TripStop[]> {
  const { data: tripDriverRow } = await supabase
    .from('scheduled_trips')
    .select('driver_id')
    .eq('id', tripId)
    .maybeSingle();
  const tripDriverId = (tripDriverRow as { driver_id?: string | null } | null)?.driver_id ?? null;
  if (!tripDriverId) return [];

  const { data: rows } = await supabase
    .from('dependent_shipments')
    .select(
      'id, full_name, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, instructions, status, pickup_code, delivery_code',
    )
    .eq('scheduled_trip_id', tripId)
    .in('status', ['confirmed', 'in_progress']);

  const out: TripStop[] = [];
  for (const d of (rows ?? []) as DependentShipmentRow[]) {
    const oLL = latLngFromDbColumns(d.origin_lat, d.origin_lng);
    const destLL = latLngFromDbColumns(d.destination_lat, d.destination_lng);
    const name = String(d.full_name ?? '').trim() || 'Dependente';
    out.push({
      id: `dependent-pickup-${d.id}`,
      scheduledTripId: tripId,
      stopType: 'dependent_pickup',
      entityId: d.id,
      label: name,
      address: d.origin_address ?? '',
      lat: oLL?.latitude ?? null,
      lng: oLL?.longitude ?? null,
      sequenceOrder: 0,
      status: 'pending',
      notes: d.instructions ?? null,
      code: d.pickup_code != null ? String(d.pickup_code).trim() : null,
    });
    out.push({
      id: `dependent-dropoff-${d.id}`,
      scheduledTripId: tripId,
      stopType: 'dependent_dropoff',
      entityId: d.id,
      label: name,
      address: d.destination_address ?? '',
      lat: destLL?.latitude ?? null,
      lng: destLL?.longitude ?? null,
      sequenceOrder: 0,
      status: 'pending',
      notes: null,
      code: d.delivery_code != null ? String(d.delivery_code).trim() : null,
    });
  }
  return out;
}

function renumberStopSequence(stops: TripStop[]): TripStop[] {
  return stops.map((s, i) => ({ ...s, sequenceOrder: i + 1 }));
}

/**
 * Ordem operacional para o motorista: todas as buscas/embarques e coletas antes de
 * entregas/desembarques e do fim da rota — evita ir à entrega da encomenda antes de
 * buscar dependente/passageiro na mesma região (o `generate_trip_stops` remoto pode vir
 * em ordem mista). Dentro de cada fase mantém a ordem relativa original (sort estável).
 */
function reorderStopsPickupPhaseBeforeDeliveryPhase(stops: TripStop[]): TripStop[] {
  if (stops.length <= 1) return stops;

  const driverSortTier = (st: TripStop): number => {
    switch (st.stopType) {
      case 'passenger_pickup':
      case 'dependent_pickup':
      case 'package_pickup':
        return 0;
      case 'package_dropoff':
      case 'passenger_dropoff':
      case 'dependent_dropoff':
        return 1;
      case 'excursion_stop':
        return 2;
      case 'trip_destination':
      case 'base_dropoff':
        return 3;
      default:
        return 2;
    }
  };

  const tagged = stops.map((s, i) => ({ s, i }));
  tagged.sort((a, b) => {
    const ta = driverSortTier(a.s);
    const tb = driverSortTier(b.s);
    if (ta !== tb) return ta - tb;
    return a.i - b.i;
  });
  return tagged.map((x) => x.s);
}

/** Primeira entrega/desembarque ou fim de rota — inserções de coleta/embarque vão antes disso. */
function indexOfFirstDeliveryPhaseStop(stops: TripStop[]): number {
  const deliveryTypes: StopType[] = [
    'package_dropoff',
    'passenger_dropoff',
    'dependent_dropoff',
    'trip_destination',
    'base_dropoff',
  ];
  return stops.findIndex((s) => deliveryTypes.includes(s.stopType));
}

/**
 * Substitui paradas de encomenda vindas do banco pela versão derivada de `shipments` (evita coleta no cliente quando há `base_id`).
 */
async function replaceShipmentPackageStopsWithManual(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  const manual = await buildShipmentStopsOnly(tripId);
  if (manual.length === 0) return stops;
  const entityIds = new Set(manual.map((s) => s.entityId));
  const filtered = stops.filter((s) => {
    if (s.stopType !== 'package_pickup' && s.stopType !== 'package_dropoff') return true;
    return !entityIds.has(s.entityId);
  });
  const anchorIdx = indexOfFirstDeliveryPhaseStop(filtered);
  if (anchorIdx === -1) return [...filtered, ...manual];
  return [...filtered.slice(0, anchorIdx), ...manual, ...filtered.slice(anchorIdx)];
}

/** Mesmo shipment: `entity_id` no trip_stops ou id sintético `shipment-pickup|dropoff-{uuid}`. */
function normalizeShipmentEntityKey(stop: TripStop): string {
  const raw = String(stop.entityId ?? '').trim().toLowerCase();
  if (raw) return raw;
  const m = String(stop.id).match(/^shipment-(?:pickup|dropoff)-([0-9a-f-]{36})$/i);
  return (m?.[1] ?? '').toLowerCase();
}

function shipmentLegAlreadyInStops(
  stops: TripStop[],
  shipmentId: string,
  leg: 'package_pickup' | 'package_dropoff',
): boolean {
  const sid = shipmentId.trim().toLowerCase();
  return stops.some((x) => {
    if (x.stopType !== leg) return false;
    if (String(x.entityId ?? '').trim().toLowerCase() === sid) return true;
    const wantId = leg === 'package_pickup' ? `shipment-pickup-${shipmentId}` : `shipment-dropoff-${shipmentId}`;
    return x.id === wantId;
  });
}

/** Remove coleta/entrega duplicada do mesmo envio (merge + trip_stops com chaves diferentes). */
function dedupePackageStopsByShipment(stops: TripStop[]): TripStop[] {
  const seenPickup = new Set<string>();
  const seenDropoff = new Set<string>();
  const out: TripStop[] = [];
  for (const s of stops) {
    if (s.stopType !== 'package_pickup' && s.stopType !== 'package_dropoff') {
      out.push(s);
      continue;
    }
    const key = normalizeShipmentEntityKey(s);
    if (!key) {
      out.push(s);
      continue;
    }
    if (s.stopType === 'package_pickup') {
      if (seenPickup.has(key)) continue;
      seenPickup.add(key);
    } else {
      if (seenDropoff.has(key)) continue;
      seenDropoff.add(key);
    }
    out.push(s);
  }
  return out;
}

/**
 * `trip_stops` pode existir sem linhas de encomenda; o app ainda precisa exibir coleta/entrega do `shipments`.
 */
async function mergeMissingShipmentStopsIntoList(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  const manual = await buildShipmentStopsOnly(tripId);
  if (manual.length === 0) return stops;

  const byEntity = new Map<string, { pickup?: TripStop; dropoff?: TripStop }>();
  for (const s of manual) {
    const cur = byEntity.get(s.entityId) ?? {};
    if (s.stopType === 'package_pickup') cur.pickup = s;
    if (s.stopType === 'package_dropoff') cur.dropoff = s;
    byEntity.set(s.entityId, cur);
  }

  const additions: TripStop[] = [];
  for (const [entityId, pair] of byEntity) {
    const hasP = shipmentLegAlreadyInStops(stops, entityId, 'package_pickup');
    const hasD = shipmentLegAlreadyInStops(stops, entityId, 'package_dropoff');
    if (hasP && hasD) continue;
    if (!hasP && pair.pickup) additions.push(pair.pickup);
    if (!hasD && pair.dropoff) additions.push(pair.dropoff);
  }

  if (additions.length === 0) return stops;

  const anchorIdx = indexOfFirstDeliveryPhaseStop(stops);
  const merged =
    anchorIdx === -1
      ? [...stops, ...additions]
      : [...stops.slice(0, anchorIdx), ...additions, ...stops.slice(anchorIdx)];

  return renumberStopSequence(merged);
}

function dependentLegAlreadyInStops(
  stops: TripStop[],
  depId: string,
  leg: 'dependent_pickup' | 'dependent_dropoff',
): boolean {
  const sid = depId.trim().toLowerCase();
  return stops.some((x) => {
    if (x.stopType !== leg) return false;
    if (String(x.entityId ?? '').trim().toLowerCase() === sid) return true;
    const wantId = leg === 'dependent_pickup' ? `dependent-pickup-${depId}` : `dependent-dropoff-${depId}`;
    return x.id === wantId;
  });
}

/** Garante paradas de envio de dependente na lista (ex.: `generate_trip_stops` remoto ainda não as cria). */
async function mergeMissingDependentStopsIntoList(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  const manual = await buildDependentStopsOnly(tripId);
  if (manual.length === 0) return stops;

  const byEntity = new Map<string, { pickup?: TripStop; dropoff?: TripStop }>();
  for (const s of manual) {
    const cur = byEntity.get(s.entityId) ?? {};
    if (s.stopType === 'dependent_pickup') cur.pickup = s;
    if (s.stopType === 'dependent_dropoff') cur.dropoff = s;
    byEntity.set(s.entityId, cur);
  }

  const additions: TripStop[] = [];
  for (const [entityId, pair] of byEntity) {
    const hasP = dependentLegAlreadyInStops(stops, entityId, 'dependent_pickup');
    const hasD = dependentLegAlreadyInStops(stops, entityId, 'dependent_dropoff');
    if (hasP && hasD) continue;
    if (!hasP && pair.pickup) additions.push(pair.pickup);
    if (!hasD && pair.dropoff) additions.push(pair.dropoff);
  }

  if (additions.length === 0) return stops;

  const anchorIdx = indexOfFirstDeliveryPhaseStop(stops);
  const merged =
    anchorIdx === -1
      ? [...stops, ...additions]
      : [...stops.slice(0, anchorIdx), ...additions, ...stops.slice(anchorIdx)];

  return renumberStopSequence(merged);
}

function dedupeDependentStopsByShipment(stops: TripStop[]): TripStop[] {
  const seenPickup = new Set<string>();
  const seenDropoff = new Set<string>();
  const out: TripStop[] = [];
  for (const s of stops) {
    if (s.stopType !== 'dependent_pickup' && s.stopType !== 'dependent_dropoff') {
      out.push(s);
      continue;
    }
    const key = String(s.entityId ?? '').trim().toLowerCase();
    if (!key) {
      out.push(s);
      continue;
    }
    if (s.stopType === 'dependent_pickup') {
      if (seenPickup.has(key)) continue;
      seenPickup.add(key);
    } else {
      if (seenDropoff.has(key)) continue;
      seenDropoff.add(key);
    }
    out.push(s);
  }
  return out;
}

async function enrichDependentStopsFromRows(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  const needs = stops.some(
    (s) =>
      (s.stopType === 'dependent_pickup' || s.stopType === 'dependent_dropoff') &&
      Boolean(s.entityId) &&
      (s.lat == null || s.lng == null || !isValidGlobeCoordinate(s.lat, s.lng)),
  );
  if (!needs) return stops;

  const { data: rows } = await supabase
    .from('dependent_shipments')
    .select('id, origin_lat, origin_lng, destination_lat, destination_lng')
    .eq('scheduled_trip_id', tripId)
    .in('status', ['confirmed', 'in_progress', 'delivered']);

  const byId = new Map<
    string,
    { origin_lat: unknown; origin_lng: unknown; destination_lat: unknown; destination_lng: unknown }
  >();
  for (const r of rows ?? []) {
    const row = r as { id?: string };
    if (row.id) {
      byId.set(
        row.id,
        r as { origin_lat: unknown; origin_lng: unknown; destination_lat: unknown; destination_lng: unknown },
      );
    }
  }

  return stops.map((s) => {
    if (s.stopType !== 'dependent_pickup' && s.stopType !== 'dependent_dropoff') return s;
    if (s.lat != null && s.lng != null && isValidGlobeCoordinate(s.lat, s.lng)) return s;
    const row = byId.get(String(s.entityId));
    if (!row) return s;
    if (s.stopType === 'dependent_pickup') {
      const ll = latLngFromDbColumns(row.origin_lat, row.origin_lng);
      if (!ll) return s;
      return { ...s, lat: ll.latitude, lng: ll.longitude };
    }
    const ll = latLngFromDbColumns(row.destination_lat, row.destination_lng);
    if (!ll) return s;
    return { ...s, lat: ll.latitude, lng: ll.longitude };
  });
}

/**
 * trip_stops do admin podem vir sem lat/lng; preenche coleta/entrega a partir de `shipments`
 * para o mapa traçar rota até origem e destino da encomenda.
 */
async function enrichPackageStopsFromShipments(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  const needs = stops.some(
    (s) =>
      (s.stopType === 'package_pickup' || s.stopType === 'package_dropoff') &&
      Boolean(s.entityId) &&
      (s.lat == null || s.lng == null || !isValidGlobeCoordinate(s.lat, s.lng)),
  );
  if (!needs) return stops;

  const { data: tripDriverRow } = await supabase
    .from('scheduled_trips')
    .select('driver_id')
    .eq('id', tripId)
    .maybeSingle();
  const tripDriverId = (tripDriverRow as { driver_id?: string | null } | null)?.driver_id ?? null;
  if (!tripDriverId) return stops;

  const { data: rows } = await supabase
    .from('shipments')
    .select('id, base_id, origin_lat, origin_lng, destination_lat, destination_lng')
    .eq('scheduled_trip_id', tripId)
    .eq('driver_id', tripDriverId)
    .in('status', ['confirmed', 'in_progress']);

  const byId = new Map<
    string,
    {
      base_id: string | null;
      origin_lat: unknown;
      origin_lng: unknown;
      destination_lat: unknown;
      destination_lng: unknown;
    }
  >();
  const baseIds = new Set<string>();
  for (const r of rows ?? []) {
    const row = r as { id?: string; base_id?: string | null };
    if (row.id) {
      byId.set(row.id, r as { base_id: string | null; origin_lat: unknown; origin_lng: unknown; destination_lat: unknown; destination_lng: unknown });
      if (row.base_id) baseIds.add(String(row.base_id));
    }
  }

  let baseCoords = new Map<string, { lat: number | null; lng: number | null }>();
  if (baseIds.size > 0) {
    const { data: bases } = await supabase
      .from('bases')
      .select('id, lat, lng')
      .in('id', [...baseIds])
      .eq('is_active', true);
    baseCoords = new Map(
      ((bases ?? []) as { id: string; lat: number | null; lng: number | null }[]).map((b) => [
        b.id,
        { lat: b.lat, lng: b.lng },
      ]),
    );
  }

  return stops.map((s) => {
    if (s.stopType !== 'package_pickup' && s.stopType !== 'package_dropoff') return s;
    if (s.lat != null && s.lng != null && isValidGlobeCoordinate(s.lat, s.lng)) return s;
    const row = byId.get(s.entityId);
    if (!row) return s;
    if (s.stopType === 'package_pickup') {
      if (row.base_id) {
        const bc = baseCoords.get(String(row.base_id));
        if (bc) {
          const ll = latLngFromDbColumns(bc.lat, bc.lng);
          if (ll) return { ...s, lat: ll.latitude, lng: ll.longitude };
        }
      }
      const ll = latLngFromDbColumns(row.origin_lat, row.origin_lng);
      if (!ll) return s;
      return { ...s, lat: ll.latitude, lng: ll.longitude };
    }
    const ll = latLngFromDbColumns(row.destination_lat, row.destination_lng);
    if (!ll) return s;
    return { ...s, lat: ll.latitude, lng: ll.longitude };
  });
}

/**
 * Quando o fallback monta IDs `booking-*` / `shipment-*`, substitui pelo `id` real de `trip_stops`
 * (mesmo `entity_id` + tipo normalizado) para permitir RPC `complete_trip_stop` e status persistido.
 */
async function attachRealTripStopIds(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  if (!stops.some((s) => isSyntheticTripStopId(s.id))) return stops;
  const { data, error } = await supabase
    .from('trip_stops')
    .select('*')
    .eq('scheduled_trip_id', tripId);
  if (error || !data?.length) return stops;
  const dbMapped = mapRows(data);
  const rawRows = data as Record<string, unknown>[];

  const syntheticDepShipmentIds = new Set<string>();
  for (const s of stops) {
    if (!isSyntheticTripStopId(s.id)) continue;
    if (s.stopType !== 'dependent_pickup' && s.stopType !== 'dependent_dropoff') continue;
    const sid = dependentShipmentIdFromSyntheticStopId(s.id);
    if (sid) syntheticDepShipmentIds.add(sid);
  }
  const depEntityAliasByShipment =
    syntheticDepShipmentIds.size > 0
      ? await fetchDependentShipmentEntityAliasKeys(tripId, [...syntheticDepShipmentIds])
      : new Map<string, Set<string>>();

  return stops.map((s) => {
    if (!isSyntheticTripStopId(s.id)) return s;

    const dependentKeys =
      s.stopType === 'dependent_pickup' || s.stopType === 'dependent_dropoff'
        ? new Set(
            [String(s.entityId ?? '').trim().toLowerCase(), dependentShipmentIdFromSyntheticStopId(s.id)].filter(
              (x): x is string => Boolean(x),
            ),
          )
        : null;
    if (dependentKeys?.size) {
      const shipId = dependentShipmentIdFromSyntheticStopId(s.id);
      if (shipId) {
        const aliases = depEntityAliasByShipment.get(shipId);
        if (aliases) for (const a of aliases) dependentKeys.add(a);
      }
    }

    const entityMatches = (dEntity: string): boolean => {
      const de = String(dEntity ?? '').trim().toLowerCase();
      if (!de) return false;
      if (dependentKeys) return dependentKeys.has(de);
      return de === String(s.entityId ?? '').trim().toLowerCase();
    };

    const candidates = dbMapped.filter((d) => entityMatches(String(d.entityId ?? '')) && d.stopType === s.stopType);
    let match: TripStop | undefined;
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1 && s.lat != null && s.lng != null && isValidGlobeCoordinate(s.lat, s.lng)) {
      let best = candidates[0]!;
      let bestKm = Infinity;
      for (const c of candidates) {
        if (c.lat == null || c.lng == null || !isValidGlobeCoordinate(c.lat, c.lng)) continue;
        const km = haversineKmApprox(
          { latitude: s.lat, longitude: s.lng },
          { latitude: c.lat, longitude: c.lng },
        );
        if (km < bestKm) {
          bestKm = km;
          best = c;
        }
      }
      match = bestKm <= 2 ? best : candidates[0];
    } else {
      match = candidates[0];
    }

    // Linha existe com `entity_id` certo mas `stop_type` fora do switch (antes virava `excursion_stop`).
    if (!match && dependentKeys?.size) {
      for (const raw of rawRows) {
        const eid = String(raw.entity_id ?? '').trim().toLowerCase();
        if (!dependentKeys.has(eid)) continue;
        const rawT = String(raw.stop_type ?? '');
        const c = rawT.replace(/\s+/g, '_').toLowerCase();
        if (!c.includes('dependent')) continue;
        const legOk =
          s.stopType === 'dependent_pickup'
            ? c.includes('pickup') || c.includes('embark') || c.includes('board') || c.includes('collect')
            : c.includes('dropoff') ||
              c.includes('drop_off') ||
              c.includes('delivery') ||
              c.includes('debark');
        if (!legOk) continue;
        const mapped = mapRows([raw as never])[0];
        if (mapped) {
          match = mapped;
          break;
        }
      }
    }

    if (!match) return s;
    return {
      ...s,
      id: match.id,
      status: match.status,
      code: match.code ?? s.code,
      packageDriverLeg: s.packageDriverLeg ?? match.packageDriverLeg,
    };
  });
}

/** Preenche `code` em paradas de passageiro a partir da reserva quando `trip_stops.code` veio vazio. */
async function enrichPassengerBookingCodes(stops: TripStop[]): Promise<TripStop[]> {
  const missing = new Set<string>();
  for (const s of stops) {
    if ((s.stopType === 'passenger_pickup' || s.stopType === 'passenger_dropoff') && s.entityId) {
      if (onlyDigits(s.code ?? '').length !== 4) missing.add(String(s.entityId));
    }
  }
  if (missing.size === 0) return stops;
  const { data } = await supabase
    .from('bookings')
    .select('id, pickup_code, delivery_code')
    .in('id', [...missing]);
  const byId = new Map<string, { pickup_code?: string | null; delivery_code?: string | null }>();
  for (const row of (data ?? []) as { id: string; pickup_code?: string | null; delivery_code?: string | null }[]) {
    byId.set(row.id, row);
  }
  return stops.map((s) => {
    if (s.stopType !== 'passenger_pickup' && s.stopType !== 'passenger_dropoff') return s;
    if (!s.entityId || onlyDigits(s.code ?? '').length === 4) return s;
    const r = byId.get(String(s.entityId));
    if (!r) return s;
    const raw = s.stopType === 'passenger_pickup' ? r.pickup_code : r.delivery_code;
    const next = String(raw ?? '').trim();
    return next ? { ...s, code: next } : s;
  });
}

/**
 * Preenche `code` nas paradas de encomenda (coleta/retirada/entrega) quando `trip_stops.code`
 * veio vazio. `generate_trip_stops` remoto não copia `shipments.pickup_code/delivery_code` para
 * `trip_stops.code`, e a validação client-side usa `stop.code` antes de chamar `complete_trip_stop`.
 */
async function enrichShipmentPackageCodes(stops: TripStop[]): Promise<TripStop[]> {
  const shipmentIds = new Set<string>();
  for (const s of stops) {
    if ((s.stopType === 'package_pickup' || s.stopType === 'package_dropoff') && s.entityId) {
      shipmentIds.add(String(s.entityId));
    }
  }
  if (shipmentIds.size === 0) return stops;
  const { data } = await supabase
    .from('shipments')
    .select('id, pickup_code, delivery_code, base_to_driver_code, base_id')
    .in('id', [...shipmentIds]);
  type Row = {
    id: string;
    pickup_code?: string | null;
    delivery_code?: string | null;
    base_to_driver_code?: string | null;
    base_id?: string | null;
  };
  const byId = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) {
    byId.set(row.id, row);
  }
  return stops.map((s) => {
    if (s.stopType !== 'package_pickup' && s.stopType !== 'package_dropoff') return s;
    if (!s.entityId) return s;
    const r = byId.get(String(s.entityId));
    if (!r) return s;
    // PDF cenário 3 (com base): retirada do motorista valida base_to_driver_code (PIN C).
    // PDF cenário 4 (sem base): retirada usa pickup_code. Entrega: delivery_code (PIN D).
    let raw: string | null | undefined;
    if (s.stopType === 'package_pickup') {
      raw = r.base_id ? (r.base_to_driver_code ?? r.pickup_code) : r.pickup_code;
    } else {
      raw = r.delivery_code;
    }
    const next = String(raw ?? '').trim();
    return next ? { ...s, code: next } : s;
  });
}

/** Preenche `code` nas paradas de dependente quando `trip_stops.code` veio vazio. */
async function enrichDependentShipmentCodes(stops: TripStop[]): Promise<TripStop[]> {
  const missing = new Set<string>();
  for (const s of stops) {
    if ((s.stopType === 'dependent_pickup' || s.stopType === 'dependent_dropoff') && s.entityId) {
      if (onlyDigits(s.code ?? '').length !== 4) missing.add(String(s.entityId));
    }
  }
  if (missing.size === 0) return stops;
  const { data } = await supabase
    .from('dependent_shipments')
    .select('id, pickup_code, delivery_code')
    .in('id', [...missing]);
  const byId = new Map<string, { pickup_code?: string | null; delivery_code?: string | null }>();
  for (const row of (data ?? []) as { id: string; pickup_code?: string | null; delivery_code?: string | null }[]) {
    byId.set(row.id, row);
  }
  return stops.map((s) => {
    if (s.stopType !== 'dependent_pickup' && s.stopType !== 'dependent_dropoff') return s;
    if (!s.entityId || onlyDigits(s.code ?? '').length === 4) return s;
    const r = byId.get(String(s.entityId));
    if (!r) return s;
    const raw = s.stopType === 'dependent_pickup' ? r.pickup_code : r.delivery_code;
    const next = String(raw ?? '').trim();
    return next ? { ...s, code: next } : s;
  });
}

/**
 * Remove paradas de entidades ainda não aceitas pelo motorista (reserva paid/pending,
 * encomenda sem `driver_id`, dependente em `pending_review`). `trip_stops` remoto pode
 * incluir essas linhas antes do aceite em Solicitações pendentes.
 */
async function filterStopsExcludedUntilDriverAccepted(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  if (stops.length === 0) return stops;

  const { data: tripRow } = await supabase
    .from('scheduled_trips')
    .select('driver_id')
    .eq('id', tripId)
    .maybeSingle();
  const driverId = String((tripRow as { driver_id?: string | null } | null)?.driver_id ?? '').trim();
  if (!driverId) return stops;

  const bookingIds = new Set<string>();
  const shipmentIds = new Set<string>();
  const dependentIds = new Set<string>();
  for (const s of stops) {
    const eid = String(s.entityId ?? '').trim();
    if (!eid) continue;
    if (s.stopType === 'passenger_pickup' || s.stopType === 'passenger_dropoff') bookingIds.add(eid);
    if (s.stopType === 'package_pickup' || s.stopType === 'package_dropoff') shipmentIds.add(eid);
    if (s.stopType === 'dependent_pickup' || s.stopType === 'dependent_dropoff') dependentIds.add(eid);
  }

  const excludedBookings = new Set<string>();
  if (bookingIds.size > 0) {
    const { data } = await supabase.from('bookings').select('id, status').in('id', [...bookingIds]);
    const statusById = new Map(
      (data ?? []).map((r) => {
        const row = r as { id: string; status?: string | null };
        return [String(row.id), String(row.status ?? '').toLowerCase()] as const;
      }),
    );
    for (const id of bookingIds) {
      const st = statusById.get(id);
      if (st !== 'confirmed' && st !== 'in_progress') excludedBookings.add(id);
    }
  }

  const excludedShipments = new Set<string>();
  if (shipmentIds.size > 0) {
    const { data } = await supabase.from('shipments').select('id, status, driver_id').in('id', [...shipmentIds]);
    const rowById = new Map(
      (data ?? []).map((r) => {
        const row = r as { id: string; status?: string | null; driver_id?: string | null };
        return [String(row.id), row] as const;
      }),
    );
    for (const id of shipmentIds) {
      const row = rowById.get(id);
      if (!row) {
        excludedShipments.add(id);
        continue;
      }
      const st = String(row.status ?? '').toLowerCase();
      const driverOk = String(row.driver_id ?? '').trim() === driverId;
      const statusOk = st === 'confirmed' || st === 'in_progress' || st === 'delivered';
      if (!driverOk || !statusOk) excludedShipments.add(id);
    }
  }

  const excludedDependents = new Set<string>();
  if (dependentIds.size > 0) {
    const { data } = await supabase.from('dependent_shipments').select('id, status').in('id', [...dependentIds]);
    const statusById = new Map(
      (data ?? []).map((r) => {
        const row = r as { id: string; status?: string | null };
        return [String(row.id), String(row.status ?? '').toLowerCase()] as const;
      }),
    );
    for (const id of dependentIds) {
      const st = statusById.get(id);
      if (st !== 'confirmed' && st !== 'in_progress' && st !== 'delivered') excludedDependents.add(id);
    }
  }

  return stops.filter((s) => {
    const eid = String(s.entityId ?? '').trim();
    if (!eid) return true;
    if (s.stopType === 'passenger_pickup' || s.stopType === 'passenger_dropoff') {
      return !excludedBookings.has(eid);
    }
    if (s.stopType === 'package_pickup' || s.stopType === 'package_dropoff') {
      return !excludedShipments.has(eid);
    }
    if (s.stopType === 'dependent_pickup' || s.stopType === 'dependent_dropoff') {
      return !excludedDependents.has(eid);
    }
    return true;
  });
}

async function finalizeStopsForTrip(tripId: string, stops: TripStop[]): Promise<TripStop[]> {
  const acceptedOnly = await filterStopsExcludedUntilDriverAccepted(tripId, stops);
  const replaced = await replaceShipmentPackageStopsWithManual(tripId, acceptedOnly);
  const mergedShip = await mergeMissingShipmentStopsIntoList(tripId, replaced);
  const mergedDep = await mergeMissingDependentStopsIntoList(tripId, mergedShip);
  const withoutOrigin = omitDriverOriginStops(mergedDep);
  const enrichedPkg = await enrichPackageStopsFromShipments(tripId, withoutOrigin);
  const enrichedDep = await enrichDependentStopsFromRows(tripId, enrichedPkg);
  const withPassengerCodes = await enrichPassengerBookingCodes(enrichedDep);
  const withDependentCodes = await enrichDependentShipmentCodes(withPassengerCodes);
  const withPackageCodes = await enrichShipmentPackageCodes(withDependentCodes);
  const dedupedPkg = dedupePackageStopsByShipment(withPackageCodes);
  const deduped = dedupeDependentStopsByShipment(dedupedPkg);
  const reordered = reorderStopsPickupPhaseBeforeDeliveryPhase(deduped);
  const ordered = renumberStopSequence(reordered);
  return attachRealTripStopIds(tripId, ordered);
}

async function buildStopsManually(tripId: string): Promise<TripStop[]> {
  const result: TripStop[] = [];
  let seq = 1;

  // Bookings: origem/destino do passageiro vêm das colunas do booking (igual ao app cliente no checkout).
  const { data: bookings } = await supabase
    .from('bookings')
    .select(`
      id,
      passenger_count,
      notes,
      origin_address,
      origin_lat,
      origin_lng,
      destination_address,
      destination_lat,
      destination_lng,
      pickup_code,
      delivery_code,
      profiles ( full_name )
    `)
    .eq('scheduled_trip_id', tripId)
    .in('status', ['confirmed', 'in_progress']);

  type BookingRow = {
    id: string;
    notes?: string | null;
    origin_address?: string | null;
    origin_lat?: unknown;
    origin_lng?: unknown;
    destination_address?: string | null;
    destination_lat?: unknown;
    destination_lng?: unknown;
    pickup_code?: string | null;
    delivery_code?: string | null;
    profiles?: { full_name?: string | null } | null;
  };

  for (const b of (bookings ?? []) as BookingRow[]) {
    const name = b.profiles?.full_name?.trim() || 'Passageiro';
    const oAddr = b.origin_address?.trim() || 'Ponto de embarque';
    const dAddr = b.destination_address?.trim() || 'Ponto de desembarque';
    const oLL = latLngFromDbColumns(b.origin_lat, b.origin_lng);
    const dLL = latLngFromDbColumns(b.destination_lat, b.destination_lng);
    result.push({
      id: `booking-pickup-${b.id}`,
      scheduledTripId: tripId,
      stopType: 'passenger_pickup',
      entityId: b.id,
      label: name,
      address: oAddr,
      lat: oLL?.latitude ?? null,
      lng: oLL?.longitude ?? null,
      sequenceOrder: seq++,
      status: 'pending',
      notes: b.notes ?? null,
      code: b.pickup_code != null ? String(b.pickup_code).trim() : null,
    });
    result.push({
      id: `booking-dropoff-${b.id}`,
      scheduledTripId: tripId,
      stopType: 'passenger_dropoff',
      entityId: b.id,
      label: name,
      address: dAddr,
      lat: dLL?.latitude ?? null,
      lng: dLL?.longitude ?? null,
      sequenceOrder: seq++,
      status: 'pending',
      notes: null,
      code: b.delivery_code != null ? String(b.delivery_code).trim() : null,
    });
  }

  const dependentStops = await buildDependentStopsOnly(tripId);
  for (const s of dependentStops) {
    result.push({ ...s, sequenceOrder: seq++ });
  }

  const shipmentStops = await buildShipmentStopsOnly(tripId);
  for (const s of shipmentStops) {
    result.push({ ...s, sequenceOrder: seq++ });
  }

  return result;
}
