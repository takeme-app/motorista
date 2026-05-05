import { supabase } from './supabase';
import { getUserErrorMessage } from '../utils/errorMessage';
import { computeOrderPricing, PricingDenominatorOverflowError } from '@take-me/shared';
import { parseTimeSlotRange, toISODateFromUtcIso, toISODate } from './dateTimeSlots';
import type { WhenTimeResult } from '../hooks/useWhenTimeSelection';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toTimeString().slice(0, 5);
}

/** Origem do preço: por pessoa (multiplica no checkout) vs valor fixo da viagem (`amount_cents` legado). */
export type TripPriceBasis = 'per_person' | 'flat_trip';

/**
 * Resolve preço da oferta e indica se a base deve ser multiplicada pelo nº de passageiros no checkout.
 * `flat_trip` = caiu só em `amount_cents` (sem price_per_person na rota nem na viagem).
 */
export function resolveTripPriceWithBasis(
  trip: {
    route_id?: string | null;
    price_per_person_cents?: number | null;
    amount_cents?: number | null;
  },
  routePriceById: Map<string, number | null>,
): { cents: number | null; basis: TripPriceBasis | null } {
  const routeId = trip.route_id;
  if (routeId && routePriceById.has(routeId)) {
    const fromRoute = routePriceById.get(routeId);
    if (fromRoute != null && fromRoute >= 0) return { cents: fromRoute, basis: 'per_person' };
  }
  const tripPpp = trip.price_per_person_cents;
  if (tripPpp != null && tripPpp >= 0) return { cents: tripPpp, basis: 'per_person' };
  const legacy = trip.amount_cents;
  if (legacy != null && legacy >= 0) return { cents: legacy, basis: 'flat_trip' };
  return { cents: null, basis: null };
}

/** Preço exibido e usado no checkout: rota (worker_routes) > coluna na viagem > amount_cents legado. */
export function resolveTripPriceCents(
  trip: {
    route_id?: string | null;
    price_per_person_cents?: number | null;
    amount_cents?: number | null;
  },
  routePriceById: Map<string, number | null>
): number | null {
  return resolveTripPriceWithBasis(trip, routePriceById).cents;
}

/**
 * Lê `scheduled_trips` + `worker_routes` e devolve o mesmo preço que a lista usa.
 * Usar no checkout ao gravar `bookings.amount_cents` (não confiar só nos params de navegação).
 */
export async function fetchResolvedPriceCentsForScheduledTrip(
  scheduledTripId: string
): Promise<{ cents: number | null; basis: TripPriceBasis | null; error: string | null }> {
  const sb = supabase as { from: (table: string) => any };
  const { data: trip, error: tripErr } = await sb
    .from('scheduled_trips')
    .select('route_id, price_per_person_cents, amount_cents')
    .eq('id', scheduledTripId)
    .maybeSingle();
  if (tripErr) {
    return { cents: null, basis: null, error: getUserErrorMessage(tripErr, 'Não foi possível obter os dados da viagem.') };
  }
  if (!trip) {
    return { cents: null, basis: null, error: 'Viagem não encontrada.' };
  }
  const routeId = trip.route_id as string | null | undefined;
  const routePriceById = new Map<string, number | null>();
  if (routeId) {
    const { data: route, error: routeErr } = await sb
      .from('worker_routes')
      .select('id, price_per_person_cents')
      .eq('id', routeId)
      .eq('is_active', true)
      .maybeSingle();
    if (routeErr) {
      return { cents: null, basis: null, error: getUserErrorMessage(routeErr, 'Não foi possível obter o preço da rota.') };
    }
    if (route) {
      routePriceById.set(route.id as string, (route.price_per_person_cents as number | null) ?? null);
    }
  }
  const { cents, basis } = resolveTripPriceWithBasis(
    {
      route_id: trip.route_id as string | null | undefined,
      price_per_person_cents: trip.price_per_person_cents as number | null | undefined,
      amount_cents: trip.amount_cents as number | null | undefined,
    },
    routePriceById
  );
  return { cents, basis, error: null };
}

export type ClientScheduledTripItem = {
  id: string;
  driver_id: string;
  title: string;
  driverName: string;
  driverAvatarUrl: string | null;
  rating: number;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  /** Capacidade máxima de passageiros do veículo (quando cadastrada), para exibir/validar oferta. */
  vehicle_passenger_capacity: number | null;
  badge: string;
  departure: string;
  arrival: string;
  seats: number;
  bags: number;
  latitude: number;
  longitude: number;
  origin_lat: number;
  origin_lng: number;
  amount_cents: number | null;
  departure_at: string;
};

type ScheduledTripRow = {
  id: string;
  title?: string | null;
  driver_id: string;
  route_id?: string | null;
  origin_address?: string | null;
  origin_lat: number;
  origin_lng: number;
  destination_address?: string | null;
  destination_lat: number;
  destination_lng: number;
  departure_at: string;
  arrival_at: string;
  seats_available: number;
  bags_available: number;
  capacity?: number | null;
  badge?: string | null;
  amount_cents?: number | null;
  price_per_person_cents?: number | null;
};

/**
 * Ordenação de negócio: horário de saída (origem) crescente; em empate, motoristas Take Me antes dos demais.
 */
export function compareTripsByDepartureAndBadge(a: ClientScheduledTripItem, b: ClientScheduledTripItem): number {
  const ta = new Date(a.departure_at).getTime();
  const tb = new Date(b.departure_at).getTime();
  if (ta !== tb) return ta - tb;
  const rank = (x: ClientScheduledTripItem) => (x.badge === 'Take Me' ? 0 : 1);
  return rank(a) - rank(b);
}

/** Indica se a oferta comporta passageiros e malas pedidos (lugares/malas restantes na viagem). */
export function tripFitsPassengersAndBags(
  trip: Pick<ClientScheduledTripItem, 'seats' | 'bags'>,
  passengerCount: number,
  bagsCount: number
): boolean {
  const p = Math.max(1, Math.floor(passengerCount));
  const b = Math.max(0, Math.floor(bagsCount));
  return trip.seats >= p && trip.bags >= b;
}

/**
 * Restringe ofertas pela escolha «Agora» vs data/horário agendados (mesmo critério que PlanRideScreen).
 * «Agora» = apenas `departure_at` no **mesmo dia civil local** que hoje — não listar viagens só da próxima segunda, etc.
 */
export function filterScheduledTripsByWhenSelection(
  trips: ClientScheduledTripItem[],
  when: WhenTimeResult,
  /** Referência de «hoje» (testes); padrão = relógio do aparelho. */
  nowRef: Date = new Date(),
): ClientScheduledTripItem[] {
  let list = [...trips];
  if (when.whenOption === 'now') {
    const todayId = toISODate(nowRef);
    list = list.filter((t) => t.departure_at && toISODateFromUtcIso(t.departure_at) === todayId);
  } else if (when.whenOption === 'later' && when.scheduledDateId) {
    const dateId = when.scheduledDateId;
    const slotStr = when.scheduledTimeSlot;
    list = list.filter((t) => {
      if (!t.departure_at) return false;
      const tripDate = toISODateFromUtcIso(t.departure_at);
      if (tripDate !== dateId) return false;
      if (!slotStr) return true;
      const slot = parseTimeSlotRange(slotStr);
      if (!slot) return true;
      const dep = new Date(t.departure_at);
      const depMinutes = dep.getHours() * 60 + dep.getMinutes();
      return depMinutes >= slot.startMinutes && depMinutes < slot.endMinutes;
    });
  }
  return list;
}

export type LoadClientScheduledTripsOptions = {
  /**
   * Quando true (padrão), aplica a mesma promoção ativa de `bookings` que o checkout usa,
   * para o valor exibido na lista coincidir com o débito no cartão.
   * Desligar em fluxos que reutilizam a lista mas não são reserva de passageiro (ex.: escolher motorista para encomenda).
   */
  applyBookingsPromoToList?: boolean;
};

type PromoBatchRow = {
  ord: number;
  gain_pct?: number | string | null;
  discount_pct?: number | string | null;
  promotion_id?: string | null;
};

async function readDefaultAdminPct(): Promise<number> {
  const sb = supabase as { from: (table: string) => any };
  const { data } = await sb
    .from('platform_settings')
    .select('value')
    .eq('key', 'default_admin_pct')
    .maybeSingle();
  const raw = data?.value;
  if (raw && typeof raw === 'object') {
    const pct = Number((raw as { percentage?: unknown; value?: unknown }).percentage ?? (raw as { value?: unknown }).value);
    if (Number.isFinite(pct) && pct >= 0) return pct;
  }
  return 15;
}

/**
 * Ajusta os `amount_cents` exibidos na lista aplicando o gross-up canônico
 * (admin_pct + ganho_motorista − desconto_passageiro) com a promoção ativa que
 * incidiria sobre a rota da viagem. Resultado é exatamente o total que será
 * cobrado no cartão em CheckoutScreen.
 */
async function applyPricingToTripListAmounts(
  items: ClientScheduledTripItem[],
  userId: string,
  adminPct: number,
  workerRouteIdByTripId: Map<string, string | null>,
): Promise<void> {
  if (items.length === 0) return;

  const groups = new Map<string | 'none', number[]>();
  items.forEach((it, idx) => {
    const routeKey = workerRouteIdByTripId.get(it.id) ?? 'none';
    const arr = groups.get(routeKey) ?? [];
    arr.push(idx);
    groups.set(routeKey, arr);
  });

  const applied = new Map<number, { gainPct: number; discountPct: number }>();

  await Promise.all(
    [...groups.entries()].map(async ([routeKey, idxs]) => {
      const p_amounts = idxs.map((i) => {
        const base = items[i].amount_cents;
        return base != null && base >= 1 ? Math.floor(Number(base)) : 0;
      });
      const payload: Record<string, unknown> = {
        p_order_type: 'bookings',
        p_user_id: userId,
        p_amounts,
      };
      if (routeKey !== 'none') payload.p_worker_route_id = routeKey;

      const { data, error } = await supabase.rpc('apply_active_promotion_for_amounts', payload);
      if (error || !Array.isArray(data)) return;

      for (const row of data as PromoBatchRow[]) {
        const ord = row?.ord != null ? Number(row.ord) : NaN;
        if (!Number.isFinite(ord) || ord < 1) continue;
        const globalIdx = idxs[ord - 1];
        if (globalIdx == null) continue;
        applied.set(globalIdx, {
          gainPct: Math.max(0, Number(row.gain_pct ?? 0)),
          discountPct: Math.max(0, Number(row.discount_pct ?? 0)),
        });
      }
    }),
  );

  for (let i = 0; i < items.length; i++) {
    const base = items[i].amount_cents;
    if (base == null || base < 1) continue;
    const promo = applied.get(i) ?? { gainPct: 0, discountPct: 0 };
    try {
      const pricing = computeOrderPricing({
        baseCents: base,
        surchargesCents: 0,
        adminPct,
        gainPct: promo.gainPct,
        discountPct: promo.discountPct,
      });
      items[i].amount_cents = pricing.totalCents;
    } catch (e) {
      if (e instanceof PricingDenominatorOverflowError) continue;
    }
  }
}

export async function loadClientScheduledTrips(opts?: LoadClientScheduledTripsOptions): Promise<{
  items: ClientScheduledTripItem[];
  error: string | null;
}> {
  const sb = supabase as { from: (table: string) => any };
  const nowIso = new Date().toISOString();
  const { data: tripsRaw, error: tripsErr } = await sb
    .from('scheduled_trips')
    .select(
      'id, title, driver_id, route_id, origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng, departure_at, arrival_at, seats_available, bags_available, capacity, badge, amount_cents, price_per_person_cents'
    )
    .eq('status', 'active')
    .eq('is_active', true)
    .is('driver_journey_started_at', null)
    .gt('departure_at', nowIso)
    .gt('seats_available', 0)
    .order('departure_at');
  if (tripsErr) {
    return { items: [], error: getUserErrorMessage(tripsErr, 'Não foi possível carregar as viagens.') };
  }
  const trips = (tripsRaw ?? []) as ScheduledTripRow[];
  if (!trips.length) return { items: [], error: null };

  const driverIds = [...new Set(trips.map((t) => t.driver_id))];
  const routeIds = [...new Set(trips.map((t) => t.route_id).filter((id): id is string => Boolean(id)))];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, rating, avatar_url')
    .in('id', driverIds);

  const routePriceById = new Map<string, number | null>();
  if (routeIds.length > 0) {
    const { data: routesRaw } = await sb.from('worker_routes')
      .select('id, price_per_person_cents')
      .in('id', routeIds)
      .eq('is_active', true);
    for (const r of routesRaw ?? []) {
      routePriceById.set(r.id as string, (r.price_per_person_cents as number | null) ?? null);
    }
  }

  type VehicleRow = {
    worker_id: string;
    model: string;
    year: number;
    plate: string;
    passenger_capacity: number | null;
  };
  const { data: vehiclesRaw } = await sb.from('vehicles')
    .select('worker_id, model, year, plate, passenger_capacity')
    .in('worker_id', driverIds)
    .eq('is_active', true)
    .eq('status', 'approved');
  const vehicles = (vehiclesRaw ?? []) as VehicleRow[];

  const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const vehicleByWorker = new Map<
    string,
    { model: string | null; year: number | null; plate: string | null; passenger_capacity: number | null }
  >();
  for (const v of vehicles) {
    const wid = v.worker_id;
    if (vehicleByWorker.has(wid)) continue;
    vehicleByWorker.set(wid, {
      model: v.model?.trim() ? v.model : null,
      year: v.year != null ? Number(v.year) : null,
      plate: v.plate?.trim() ? v.plate : null,
      passenger_capacity: v.passenger_capacity != null ? Number(v.passenger_capacity) : null,
    });
  }

  const items: ClientScheduledTripItem[] = [];
  for (const t of trips) {
    const prof = profileMap.get(t.driver_id);
    const veh = vehicleByWorker.get(t.driver_id);
    const tripCap = t.capacity != null ? Number(t.capacity) : null;
    const vehCap = veh?.passenger_capacity ?? null;
    /** Coerência: oferta da viagem não pode exceder a capacidade do veículo. */
    if (vehCap != null && vehCap >= 1) {
      if (t.seats_available > vehCap) continue;
      if (tripCap != null && tripCap > vehCap) continue;
    }
    items.push({
      id: t.id,
      driver_id: t.driver_id,
      title: t.title ?? `${t.origin_address} → ${t.destination_address}`,
      driverName: (prof?.full_name as string) ?? 'Motorista',
      driverAvatarUrl: (prof?.avatar_url as string | null) ?? null,
      rating: Number(prof?.rating ?? 0),
      vehicle_model: veh?.model ?? null,
      vehicle_year: veh?.year ?? null,
      vehicle_plate: veh?.plate ?? null,
      vehicle_passenger_capacity: vehCap,
      badge: t.badge ?? 'Take Me',
      departure: formatTime(t.departure_at),
      arrival: formatTime(t.arrival_at),
      seats: t.seats_available,
      bags: t.bags_available,
      latitude: t.destination_lat,
      longitude: t.destination_lng,
      origin_lat: t.origin_lat,
      origin_lng: t.origin_lng,
      amount_cents: resolveTripPriceWithBasis(
        {
          route_id: t.route_id,
          price_per_person_cents: t.price_per_person_cents,
          amount_cents: t.amount_cents,
        },
        routePriceById
      ).cents,
      departure_at: t.departure_at,
    });
  }

  items.sort(compareTripsByDepartureAndBadge);

  const applyPromo = opts?.applyBookingsPromoToList !== false;
  if (applyPromo && items.length > 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      try {
        const adminPct = await readDefaultAdminPct();
        const workerRouteByTripId = new Map<string, string | null>();
        for (const t of trips) {
          workerRouteByTripId.set(t.id, (t.route_id as string | null) ?? null);
        }
        await applyPricingToTripListAmounts(items, user.id, adminPct, workerRouteByTripId);
      } catch {
        /* RPC ausente ou rede: mantém preço base da rota */
      }
    }
  }

  return { items, error: null };
}
