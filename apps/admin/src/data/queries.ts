import { supabase, isSupabaseConfigured } from '../lib/supabase';
import Constants from 'expo-constants';
import { preparadorEncomendaSlug } from '../utils/preparadorSlug';

/** Tabelas fora do `Database` gerado — evita erros de tipo em `.from()`. */
const sb = supabase as any;
import type {
  ViagemListItem,
  PassageiroListItem,
  EncomendaListItem,
  MotoristaListItem,
  DestinoListItem,
  DestinoTripStatusCounts,
  PreparadorListItem,
  PreparadorEditDetail,
  PreparadorEditPassenger,
  PreparadorCandidate,
  ExcursionStatusHistoryRow,
  PromocaoListItem,
  PagamentoListItem,
  PagamentoCounts,
  PricingRouteRow,
  SurchargeCatalogRow,
  PaymentMethodRow,
  AdminUserListItem,
  BookingDetailForAdmin,
  EncomendaEditDetail,
  TripShipmentListItem,
  SpedyInvoiceLookupItem,
  DriverPlatformFeeLedgerRow,
  MotoristaPlatformFeeDebtItem,
  BookingPaymentMethod,
} from './types';

// ── Edge Function Helper ─────────────────────────────────────────────────

const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;
const supabaseUrl = (
  (extra?.supabaseUrl && String(extra.supabaseUrl).trim()) ||
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_SUPABASE_URL
    ? String(process.env.EXPO_PUBLIC_SUPABASE_URL).trim()
    : '') ||
  ''
);
const supabaseAnonKey = (
  (extra?.supabaseAnonKey && String(extra.supabaseAnonKey).trim()) ||
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ? String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).trim()
    : '') ||
  ''
);

export async function invokeEdgeFunction<T = any>(
  name: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  params?: Record<string, string>,
  body?: any,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { data: null, error: 'Não autenticado' };

    const url = new URL(`${supabaseUrl}/functions/v1/${name}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error || `HTTP ${res.status}` };
    return { data: json as T, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Erro desconhecido' };
  }
}

// ── CRUD: Promotions ────────────────────────────────────────────────────

export async function createPromotion(body: {
  title: string;
  description?: string;
  start_at: string;
  end_at: string;
  target_audiences: string[];
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  applies_to: string[];
  is_active?: boolean;
  gain_pct_to_worker?: number;
  discount_pct_to_passenger?: number;
  worker_route_id?: string | null;
  pricing_route_id?: string | null;
  origin_city?: string | null;
}) {
  return invokeEdgeFunction('manage-promotions', 'POST', undefined, body);
}

export async function updatePromotion(id: string, updates: Record<string, any>) {
  return invokeEdgeFunction('manage-promotions', 'PUT', { id }, updates);
}

export async function deletePromotion(id: string) {
  return invokeEdgeFunction('manage-promotions', 'DELETE', { id });
}

// ── CRUD: Pricing Routes ────────────────────────────────────────────────

export async function createPricingRoute(body: {
  role_type: string;
  title?: string;
  origin_address?: string;
  destination_address: string;
  pricing_mode: string;
  price_cents: number;
  driver_pct?: number;
  admin_pct?: number;
  surcharges?: Array<{ surcharge_id: string; value_cents?: number }>;
}) {
  return invokeEdgeFunction('manage-pricing-routes', 'POST', undefined, body);
}

export async function updatePricingRoute(id: string, updates: Record<string, any>) {
  return invokeEdgeFunction('manage-pricing-routes', 'PUT', { id }, updates);
}

export async function deletePricingRoute(id: string) {
  return invokeEdgeFunction('manage-pricing-routes', 'DELETE', { id });
}

// ── CRUD: Excursion Budget ──────────────────────────────────────────────

export async function submitExcursionBudget(
  excursionId: string,
  budgetLines: any,
  finalize = false,
  extra?: {
    driver_id?: string | null;
    preparer_id?: string | null;
    preparer_payout_cents?: number;
  },
) {
  const body: Record<string, unknown> = {
    excursion_id: excursionId,
    action: finalize ? 'finalize' : 'save_draft',
    budget_lines: budgetLines,
    total_amount_cents: budgetLines?.total_cents,
  };
  if (extra?.driver_id) body.driver_id = extra.driver_id;
  if (extra?.preparer_id) body.preparer_id = extra.preparer_id;
  if (typeof extra?.preparer_payout_cents === 'number') {
    body.preparer_payout_cents = extra.preparer_payout_cents;
  }
  return invokeEdgeFunction('manage-excursion-budget', 'POST', undefined, body);
}

export async function runChargeExcursionRequest(
  excursionId: string,
  method: 'pix' | 'card',
): Promise<{ data: unknown | null; error: string | null }> {
  const payment_method = method === 'pix' ? 'pix' : 'credit_card';
  return invokeEdgeFunction('charge-excursion-request', 'POST', undefined, {
    excursion_request_id: excursionId,
    payment_method,
  });
}

export async function runStripeConnectSync(workerId: string) {
  return invokeEdgeFunction('stripe-connect-sync', 'POST', undefined, { worker_id: workerId });
}

// ── CRUD: Admin Users (via edge function) ───────────────────────────────

export async function createAdminUser(body: {
  email: string;
  password?: string;
  full_name: string;
  permissions?: Record<string, boolean>;
  /** admin | suporte | financeiro */
  backoffice_subtype?: string;
}) {
  return invokeEdgeFunction('manage-admin-users', 'POST', undefined, body);
}

export async function updateAdminUser(
  id: string,
  updates: { permissions?: Record<string, boolean>; status?: string; backoffice_subtype?: string },
) {
  return invokeEdgeFunction('manage-admin-users', 'PUT', { id }, updates);
}

export async function deleteAdminUser(id: string) {
  return invokeEdgeFunction('manage-admin-users', 'DELETE', { id });
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function shortAddr(addr: string): string {
  const parts = addr.split(',').map((s) => s.trim());
  if (parts.length >= 2) return `${parts[0]} - ${parts[parts.length - 1]}`;
  return addr;
}

/** Comparação tolerante a PT/EN, maiúsculas e acentos (dados legados ou edição manual no SQL). */
function normViagemStatusKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function viagemDbIsCancelled(s: string): boolean {
  const n = normViagemStatusKey(s);
  return n === 'cancelled' || n === 'canceled' || n === 'cancelado' || n === 'cancelada';
}

function viagemDbIsPaidBooking(s: string): boolean {
  const n = normViagemStatusKey(s);
  return n === 'paid' || n === 'pago';
}

function viagemDbIsTripCompleted(s: string): boolean {
  const n = normViagemStatusKey(s);
  return n === 'completed' || n === 'concluido' || n === 'concluida';
}

function viagemDbIsTripActive(s: string): boolean {
  const n = normViagemStatusKey(s);
  return n === 'active' || n === 'ativo' || n === '';
}

function viagemDbIsConfirmed(s: string): boolean {
  const n = normViagemStatusKey(s);
  return n === 'confirmed' || n === 'confirmado' || n === 'confirmada';
}

function viagemDbIsPending(s: string): boolean {
  const n = normViagemStatusKey(s);
  return n === 'pending' || n === 'pendente';
}

function mapViagemStatus(bookingStatusRaw: unknown, tripStatusRaw: unknown): ViagemListItem['status'] {
  const bookingKey = normViagemStatusKey(bookingStatusRaw);
  const tripStr = String(tripStatusRaw ?? '').trim();
  const tripKey = tripStr === '' ? normViagemStatusKey('active') : normViagemStatusKey(tripStatusRaw);

  if (viagemDbIsCancelled(bookingKey) || viagemDbIsCancelled(tripKey)) return 'cancelado';
  if (viagemDbIsTripCompleted(tripKey) || viagemDbIsPaidBooking(bookingKey)) return 'concluído';
  if (viagemDbIsTripActive(tripKey) && (viagemDbIsConfirmed(bookingKey) || viagemDbIsPending(bookingKey))) return 'em_andamento';
  return 'agendado';
}

type ShipmentDbStatus = 'pending_review' | 'confirmed' | 'in_progress' | 'delivered' | 'cancelled';

function mapEncomendaStatus(s: ShipmentDbStatus): EncomendaListItem['status'] {
  if (s === 'cancelled') return 'Cancelado';
  if (s === 'delivered') return 'Concluído';
  if (s === 'in_progress') return 'Em andamento';
  return 'Agendado';
}

type ExcursionDbStatus = 'pending' | 'contacted' | 'quoted' | 'cancelled' | 'in_analysis' | 'approved' | 'scheduled' | 'in_progress' | 'completed';

function mapPreparadorStatus(s: ExcursionDbStatus): PreparadorListItem['status'] {
  if (s === 'cancelled') return 'Cancelado';
  if (s === 'completed') return 'Concluído';
  if (s === 'in_progress') return 'Em andamento';
  return 'Agendado';
}

// ── Viagens ─────────────────────────────────────────────────────────────

function normalizeBookingPaymentMethod(raw: unknown): BookingPaymentMethod {
  const s = String(raw ?? 'card').toLowerCase();
  if (s === 'pix') return 'pix';
  if (s === 'cash') return 'cash';
  return 'card';
}

/** Linha `bookings` sintética a partir de `scheduled_trips` + primeiro `shipments` (mesmo contrato que `listItemFromBookingJoin`). */
function syntheticJoinRowFromTripShipment(trip: any, ship: any | null): any {
  const tr = trip as any;
  const created_at = tr.departure_at ?? tr.created_at ?? new Date().toISOString();
  return {
    id: '',
    user_id: ship?.user_id ?? null,
    origin_address: ship?.origin_address ?? tr.origin_address ?? '—',
    destination_address: ship?.destination_address ?? tr.destination_address ?? '—',
    origin_lat: ship?.origin_lat ?? tr.origin_lat ?? null,
    origin_lng: ship?.origin_lng ?? tr.origin_lng ?? null,
    destination_lat: ship?.destination_lat ?? tr.destination_lat ?? null,
    destination_lng: ship?.destination_lng ?? tr.destination_lng ?? null,
    status: 'confirmed',
    created_at,
    passenger_count: 1,
    bags_count: 0,
    passenger_data: [],
    amount_cents: 0,
    payment_method: 'card',
    platform_fee_extra_debit_cents: 0,
    scheduled_trip_id: tr.id,
    scheduled_trips: trip,
    stripe_payment_intent_id: null,
  };
}

export async function fetchViagens(): Promise<ViagemListItem[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, user_id, origin_address, destination_address, status, created_at,
      passenger_count, amount_cents, scheduled_trip_id,
      payment_method, platform_fee_extra_debit_cents,
      scheduled_trips!inner ( id, departure_at, arrival_at, driver_id, status, trunk_occupancy_pct )
    `)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  const tripIdsFromBookings = new Set<string>();
  for (const b of data as any[]) {
    const tid = String(b.scheduled_trips?.id ?? b.scheduled_trip_id ?? '').trim();
    if (tid) tripIdsFromBookings.add(tid);
  }

  const { data: shipLinkRows } = await supabase
    .from('shipments')
    .select('scheduled_trip_id, created_at')
    .not('scheduled_trip_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  const orphanTripIds: string[] = [];
  const seenOrphan = new Set<string>();
  for (const row of shipLinkRows || []) {
    const tid = String((row as any).scheduled_trip_id ?? '').trim();
    if (!tid || tripIdsFromBookings.has(tid) || seenOrphan.has(tid)) continue;
    seenOrphan.add(tid);
    orphanTripIds.push(tid);
    if (orphanTripIds.length >= 200) break;
  }

  const { data: orphanTrips } = orphanTripIds.length
    ? await supabase
      .from('scheduled_trips')
      .select(
        'id, departure_at, arrival_at, driver_id, status, seats_available, bags_available, trunk_occupancy_pct, created_at, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng',
      )
      .in('id', orphanTripIds)
    : { data: null as any[] | null };

  const tripByOrphanId = new Map<string, any>();
  for (const t of orphanTrips || []) tripByOrphanId.set(String((t as any).id), t);

  const { data: orphanShips } = orphanTripIds.length
    ? await supabase
      .from('shipments')
      .select(
        'id, user_id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, scheduled_trip_id, created_at',
      )
      .in('scheduled_trip_id', orphanTripIds)
      .order('created_at', { ascending: true })
    : { data: null as any[] | null };

  const firstShipByTrip = new Map<string, any>();
  for (const sh of orphanShips || []) {
    const tid = String((sh as any).scheduled_trip_id);
    if (!firstShipByTrip.has(tid)) firstShipByTrip.set(tid, sh);
  }

  const userIds = [...new Set(data.map((b: any) => b.user_id).filter(Boolean))] as string[];
  for (const tid of orphanTripIds) {
    const uid = firstShipByTrip.get(tid)?.user_id;
    if (uid) userIds.push(uid);
  }
  const uniqueUserIds = [...new Set(userIds)];

  const profileMap: Record<string, string> = {};
  if (uniqueUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', uniqueUserIds);
    if (profiles) profiles.forEach((p: any) => { profileMap[p.id] = p.full_name; });
  }

  const driverIds = [...new Set(data.map((b: any) => b.scheduled_trips?.driver_id).filter(Boolean))] as string[];
  for (const tid of orphanTripIds) {
    const did = tripByOrphanId.get(tid)?.driver_id;
    if (did) driverIds.push(did);
  }
  const uniqueDriverIds = [...new Set(driverIds)];

  const driverNameMap: Record<string, string> = {};
  const driverPartnerMap: Record<string, boolean> = {};
  if (uniqueDriverIds.length > 0) {
    const { data: driverProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', uniqueDriverIds);
    (driverProfiles || []).forEach((p: any) => { driverNameMap[p.id] = p.full_name || 'Sem nome'; });
    const { data: workers } = await (supabase as any)
      .from('worker_profiles')
      .select('id, subtype')
      .in('id', uniqueDriverIds);
    (workers || []).forEach((w: any) => { driverPartnerMap[w.id] = w.subtype === 'partner'; });
  }

  const bookingItems: ViagemListItem[] = (data as any[]).map((b: any) =>
    listItemFromBookingJoin(b, profileMap, driverNameMap, driverPartnerMap),
  );

  const orphanItems: ViagemListItem[] = [];
  for (const tid of orphanTripIds) {
    const trip = tripByOrphanId.get(tid);
    if (!trip) continue;
    const ship = firstShipByTrip.get(tid) ?? null;
    const row = syntheticJoinRowFromTripShipment(trip, ship);
    orphanItems.push(listItemFromBookingJoin(row, profileMap, driverNameMap, driverPartnerMap));
  }

  const merged = [...bookingItems, ...orphanItems];
  merged.sort((a, b) => {
    const ta = new Date(a.departureAtIso).getTime();
    const tb = new Date(b.departureAtIso).getTime();
    if (tb !== ta) return tb - ta;
    return String(b.tripId).localeCompare(String(a.tripId));
  });
  return merged.slice(0, 200);
}

/**
 * Viagem agendada sem linha em `bookings` (ex.: só encomendas no veículo).
 * Monta objeto no formato esperado por `listItemFromBookingJoin` / restante de `fetchBookingDetailForAdmin`.
 */
async function syntheticBookingRowForScheduledTrip(
  scheduledTripId: string,
  preferShipmentId?: string | null,
): Promise<any | null> {
  const { data: trip, error } = await supabase
    .from('scheduled_trips')
    .select(
      'id, departure_at, arrival_at, driver_id, status, seats_available, bags_available, trunk_occupancy_pct, created_at, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng',
    )
    .eq('id', scheduledTripId)
    .maybeSingle();
  if (error || !trip) return null;

  let ship: any = null;
  if (preferShipmentId) {
    const { data: s } = await supabase
      .from('shipments')
      .select(
        'id, user_id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, scheduled_trip_id, created_at',
      )
      .eq('id', preferShipmentId)
      .maybeSingle();
    if (s && String((s as any).scheduled_trip_id) === String(scheduledTripId)) ship = s;
  }
  if (!ship) {
    const { data: rows } = await supabase
      .from('shipments')
      .select(
        'id, user_id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, scheduled_trip_id, created_at',
      )
      .eq('scheduled_trip_id', scheduledTripId)
      .order('created_at', { ascending: true })
      .limit(1);
    ship = rows?.[0] ?? null;
  }

  return syntheticJoinRowFromTripShipment(trip, ship);
}

function listItemFromBookingJoin(
  b: any,
  profileMap: Record<string, string>,
  driverNameMap: Record<string, string>,
  driverPartnerMap: Record<string, boolean>,
): ViagemListItem {
  const trip = b.scheduled_trips;
  const dep = trip?.departure_at ?? b.created_at;
  const driverId = (trip?.driver_id ?? '') as string;
  const isPartner = driverId ? !!driverPartnerMap[driverId] : false;
  const trunk = Number(trip?.trunk_occupancy_pct);
  return {
    bookingId: String(b.id ?? ''),
    passageiro: profileMap[b.user_id] ?? 'Sem nome',
    origem: shortAddr(b.origin_address),
    destino: shortAddr(b.destination_address),
    data: fmtDate(dep),
    embarque: fmtTime(dep),
    chegada: fmtTime(trip?.arrival_at ?? b.created_at),
    status: mapViagemStatus(b.status, trip?.status ?? 'active'),
    tripId: trip?.id ?? b.scheduled_trip_id ?? '',
    driverId,
    departureAtIso: dep ? new Date(dep).toISOString() : new Date(b.created_at).toISOString(),
    motoristaNome: driverId ? (driverNameMap[driverId] ?? '—') : '—',
    motoristaCategoria: (isPartner ? 'motorista' : 'take_me') as 'take_me' | 'motorista',
    bookingDbStatus: String(b.status ?? ''),
    passengerCount: Number(b.passenger_count ?? 1),
    amountCents: Number(b.amount_cents ?? 0),
    trunkOccupancyPct: Number.isFinite(trunk) ? Math.round(trunk) : 0,
    paymentMethod: normalizeBookingPaymentMethod(b.payment_method),
    platformFeeExtraDebitCents: Math.max(0, Math.round(Number(b.platform_fee_extra_debit_cents ?? 0))),
  };
}

/** Slug em `/pagamentos/gestao/motorista/:slug` (igual à navegação a partir da lista). */
export function slugifyMotoristaNome(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function findMotoristaIdByPaymentSlug(slug: string, motoristas: MotoristaListItem[]): string | null {
  const t = slug.trim().toLowerCase();
  for (const m of motoristas) {
    if (slugifyMotoristaNome(m.nome) === t) return m.id;
  }
  return null;
}

export function findPreparadorEncomendaIdBySlug(slug: string, preparadores: PreparadorListItem[]): string | null {
  const t = slug.trim().toLowerCase();
  for (const p of preparadores) {
    if (preparadorEncomendaSlug(p.nome) === t) return p.id;
  }
  return null;
}

export type FetchBookingDetailForAdminOpts = {
  /** Em `/encomendas/:eid/viagem/:tripId`, prioriza este envio para origem/destino e remetente no painel. */
  preferShipmentId?: string | null;
};

/**
 * Várias reservas podem partilhar o mesmo `scheduled_trip_id`. A mais antiga (`limit(1)` asc) pode ser
 * teste/cancelada sem `pickup_code`, escondendo o PIN no admin em viagens «Em andamento» abertas por `tripId`.
 * Preferimos reserva com PIN; senão a mais recente.
 */
function pickBookingRowForTripDetail(rows: any[] | null | undefined): any | null {
  if (!rows?.length) return null;
  const withPin = rows.find((r) => String(r?.pickup_code ?? '').trim());
  if (withPin) return withPin;
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a?.created_at ?? 0).getTime();
    const tb = new Date(b?.created_at ?? 0).getTime();
    return tb - ta;
  });
  return sorted[0] ?? null;
}

export async function fetchBookingDetailForAdmin(
  bookingOrTripId: string,
  opts?: FetchBookingDetailForAdminOpts,
): Promise<BookingDetailForAdmin | null> {
  if (!isSupabaseConfigured) return null;
  const sel = `
    id, user_id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng,
    status, created_at,
    passenger_count, bags_count, passenger_data, amount_cents, scheduled_trip_id, pickup_code,
    stripe_payment_intent_id,
    payment_method, platform_fee_extra_debit_cents, admin_earning_cents,
    scheduled_trips ( id, departure_at, arrival_at, driver_id, status, seats_available, bags_available, trunk_occupancy_pct )
  `;
  let { data: b, error } = await supabase.from('bookings').select(sel).eq('id', bookingOrTripId).maybeSingle();
  if (error || !b) {
    const r2 = await supabase
      .from('bookings')
      .select(sel)
      .eq('scheduled_trip_id', bookingOrTripId)
      .order('created_at', { ascending: false })
      .limit(40);
    b = pickBookingRowForTripDetail(r2.data as any[] | undefined) ?? null;
  }
  if (!b) {
    b = await syntheticBookingRowForScheduledTrip(bookingOrTripId, opts?.preferShipmentId);
  }
  if (!b) return null;

  const row = b as any;
  const userIds = [row.user_id].filter(Boolean);
  const trip = row.scheduled_trips;
  const driverId = trip?.driver_id as string | undefined;
  const driverIds = driverId ? [driverId] : [];

  const profileMap: Record<string, string> = {};
  let clientPhone: string | null = null;
  let clientAvatarUrl: string | null = null;
  if (userIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, phone, avatar_url').in('id', userIds);
    (profiles || []).forEach((p: any) => {
      profileMap[p.id] = p.full_name ?? 'Sem nome';
      clientPhone = p.phone ?? null;
      if (p.id === row.user_id) clientAvatarUrl = p.avatar_url ?? null;
    });
  }

  const driverNameMap: Record<string, string> = {};
  const driverPartnerMap: Record<string, boolean> = {};
  if (driverIds.length) {
    const { data: driverProfiles } = await supabase.from('profiles').select('id, full_name').in('id', driverIds);
    (driverProfiles || []).forEach((p: any) => { driverNameMap[p.id] = p.full_name || 'Sem nome'; });
    const { data: workers } = await sb.from('worker_profiles').select('id, subtype').in('id', driverIds);
    (workers || []).forEach((w: any) => { driverPartnerMap[w.id] = w.subtype === 'partner'; });
  }

  const pd = row.passenger_data;
  const passengerData = Array.isArray(pd) ? pd as Array<{ name?: string; cpf?: string; bags?: number }> : [];

  const cpfDigitsOnly = (cpf: string | undefined) => (cpf || '').replace(/\D/g, '');
  const cpfVariantsForQuery = (digits: string): string[] => {
    const d = cpfDigitsOnly(digits);
    if (d.length !== 11) return d ? [d] : [];
    return [d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`];
  };
  const cpfDigitKeys = [...new Set(passengerData.map((p) => cpfDigitsOnly(p.cpf)).filter((x) => x.length >= 11))];
  const cpfVariants = [...new Set(cpfDigitKeys.flatMap(cpfVariantsForQuery))];
  const avatarUrlByPassengerCpfDigits: Record<string, string | null> = {};
  if (cpfVariants.length) {
    const { data: cpfProfs } = await supabase.from('profiles').select('cpf, avatar_url').in('cpf', cpfVariants);
    (cpfProfs || []).forEach((p: any) => {
      const k = cpfDigitsOnly(p.cpf);
      if (k) avatarUrlByPassengerCpfDigits[k] = p.avatar_url ?? null;
    });
  }

  const listItem = listItemFromBookingJoin(row, profileMap, driverNameMap, driverPartnerMap);
  const trunk = Number(trip?.trunk_occupancy_pct);
  const numOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const depAt = trip?.departure_at;
  const arrAt = trip?.arrival_at;
  const seatsRaw = trip?.seats_available;
  const bagsTripRaw = trip?.bags_available;
  const seatsAvailable =
    seatsRaw != null && Number.isFinite(Number(seatsRaw)) ? Math.round(Number(seatsRaw)) : null;
  const bagsAvailable =
    bagsTripRaw != null && Number.isFinite(Number(bagsTripRaw)) ? Math.round(Number(bagsTripRaw)) : null;
  const createdRaw = row.created_at as string | undefined;

  let supportConversationId: string | null = null;
  if (row.id) {
    const { data: bookConvRows } = await (supabase as any)
      .from('conversations')
      .select('id')
      .eq('conversation_kind', 'support_backoffice')
      .eq('status', 'active')
      .eq('booking_id', row.id)
      .order('created_at', { ascending: false })
      .limit(1);
    const bookConvFirst = Array.isArray(bookConvRows) && bookConvRows.length > 0 ? bookConvRows[0] : null;
    if (bookConvFirst?.id != null && String(bookConvFirst.id).trim()) {
      supportConversationId = String(bookConvFirst.id);
    }
  }

  return {
    listItem,
    originFull: row.origin_address ?? '',
    destinationFull: row.destination_address ?? '',
    originLat: numOrNull(row.origin_lat),
    originLng: numOrNull(row.origin_lng),
    destinationLat: numOrNull(row.destination_lat),
    destinationLng: numOrNull(row.destination_lng),
    amountCents: Number(row.amount_cents ?? 0),
    passengerCount: Number(row.passenger_count ?? 1),
    bagsCount: Number(row.bags_count ?? 0),
    passengerData,
    userId: row.user_id,
    clientAvatarUrl,
    avatarUrlByPassengerCpfDigits,
    clientPhone,
    trunkOccupancyPct: Number.isFinite(trunk) ? trunk : 0,
    tripDepartureAtIso: depAt ? new Date(depAt as string).toISOString() : null,
    tripArrivalAtIso: arrAt ? new Date(arrAt as string).toISOString() : null,
    seatsAvailable,
    bagsAvailable,
    bookingCreatedAtIso: createdRaw ? new Date(createdRaw).toISOString() : null,
    supportConversationId,
    pickupCode:
      row.pickup_code != null && String(row.pickup_code).trim()
        ? String(row.pickup_code).trim()
        : null,
    stripePaymentIntentId:
      row.stripe_payment_intent_id != null && String(row.stripe_payment_intent_id).trim()
        ? String(row.stripe_payment_intent_id).trim()
        : null,
    paymentMethod: normalizeBookingPaymentMethod(row.payment_method),
    platformFeeExtraDebitCents: Math.max(0, Math.round(Number(row.platform_fee_extra_debit_cents ?? 0))),
    adminEarningCents: Math.max(0, Math.round(Number(row.admin_earning_cents ?? 0))),
  };
}

/** Consulta notas na Spedy pelo PaymentIntent (integração Stripe → Spedy). */
export async function lookupSpedyInvoiceByStripePi(
  stripePaymentIntentId: string,
): Promise<{ data: { invoices: SpedyInvoiceLookupItem[] } | null; error: string | null }> {
  return invokeEdgeFunction<{ invoices: SpedyInvoiceLookupItem[] }>(
    'lookup-spedy-invoice',
    'POST',
    undefined,
    { stripe_payment_intent_id: stripePaymentIntentId },
  );
}

/** Baixa PDF da NF na Spedy (chave Spedy só no servidor). */
export async function fetchSpedyInvoicePdfAsBlob(
  invoiceId: string,
  model: 'productInvoice' | 'serviceInvoice',
): Promise<{ blob: Blob | null; error: string | null }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { blob: null, error: 'Não autenticado' };

    const url = new URL(`${supabaseUrl}/functions/v1/get-fiscal-document-pdf`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ invoice_id: invoiceId, model }),
    });

    const ct = res.headers.get('Content-Type') || '';
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        if (ct.includes('application/json')) {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } else {
          const t = await res.text();
          if (t) msg = t.slice(0, 200);
        }
      } catch {
        /* ignore */
      }
      return { blob: null, error: msg };
    }

    if (!ct.includes('application/pdf')) {
      return { blob: null, error: 'Resposta inesperada (não é PDF).' };
    }

    return { blob: await res.blob(), error: null };
  } catch (err: any) {
    return { blob: null, error: err?.message || 'Erro ao baixar PDF' };
  }
}

/** Encomendas atribuídas à viagem agendada (`shipments.scheduled_trip_id`). */
export async function fetchShipmentsForScheduledTrip(tripId: string): Promise<TripShipmentListItem[]> {
  if (!isSupabaseConfigured || !tripId) return [];
  const { data, error } = await supabase
    .from('shipments')
    .select(
      [
        'id, user_id, package_size, amount_cents, recipient_name, recipient_phone',
        'origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng',
        'instructions, photo_url, status, base_id',
        'pickup_code, passenger_to_preparer_code, preparer_to_base_code, base_to_driver_code, delivery_code',
        'picked_up_by_preparer_at, delivered_to_base_at, picked_up_by_driver_from_base_at, picked_up_at, delivered_at',
      ].join(', '),
    )
    .eq('scheduled_trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return [];
  type Row = {
    id: string;
    user_id: string;
    package_size?: string | null;
    amount_cents?: number | null;
    recipient_name?: string | null;
    recipient_phone?: string | null;
    origin_address?: string | null;
    origin_lat?: number | null;
    origin_lng?: number | null;
    destination_address?: string | null;
    destination_lat?: number | null;
    destination_lng?: number | null;
    instructions?: string | null;
    photo_url?: string | null;
    status?: string | null;
    base_id?: string | null;
    pickup_code?: string | null;
    passenger_to_preparer_code?: string | null;
    preparer_to_base_code?: string | null;
    base_to_driver_code?: string | null;
    delivery_code?: string | null;
    picked_up_by_preparer_at?: string | null;
    delivered_to_base_at?: string | null;
    picked_up_by_driver_from_base_at?: string | null;
    picked_up_at?: string | null;
    delivered_at?: string | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const userIds = [...new Set(rows.map((s) => s.user_id).filter(Boolean))];
  const senderMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    (profs || []).forEach((p: { id: string; full_name?: string | null }) => {
      senderMap[p.id] = p.full_name?.trim() || '—';
    });
  }

  const shipSupportMap = new Map<string, string>();
  const shipIds = rows.map((s) => s.id).filter(Boolean);
  if (shipIds.length > 0) {
    const { data: convRows } = await (supabase as any)
      .from('conversations')
      .select('id, shipment_id, created_at')
      .eq('conversation_kind', 'support_backoffice')
      .eq('status', 'active')
      .in('shipment_id', shipIds)
      .order('created_at', { ascending: false });
    for (const c of convRows ?? []) {
      const sid = c?.shipment_id != null ? String(c.shipment_id) : '';
      if (!sid || shipSupportMap.has(sid)) continue;
      shipSupportMap.set(sid, String(c.id));
    }
  }

  const strOrNull = (v: unknown): string | null => {
    if (v == null) return null;
    const t = String(v).trim();
    return t || null;
  };
  const isoOrNull = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    try {
      return new Date(v as string).toISOString();
    } catch {
      return strOrNull(v);
    }
  };
  return rows.map((s) => ({
    id: s.id,
    packageSize: s.package_size ?? null,
    amountCents: Number(s.amount_cents ?? 0),
    recipientName: (s.recipient_name && String(s.recipient_name).trim()) || '—',
    recipientPhone: s.recipient_phone != null && String(s.recipient_phone).trim() ? String(s.recipient_phone).trim() : null,
    senderName: senderMap[s.user_id] ?? '—',
    originAddress: s.origin_address ?? '',
    destinationAddress: s.destination_address ?? '',
    originLat: s.origin_lat != null && Number.isFinite(Number(s.origin_lat)) ? Number(s.origin_lat) : null,
    originLng: s.origin_lng != null && Number.isFinite(Number(s.origin_lng)) ? Number(s.origin_lng) : null,
    destinationLat: s.destination_lat != null && Number.isFinite(Number(s.destination_lat)) ? Number(s.destination_lat) : null,
    destinationLng: s.destination_lng != null && Number.isFinite(Number(s.destination_lng)) ? Number(s.destination_lng) : null,
    instructions: s.instructions ?? null,
    photoUrl: s.photo_url ?? null,
    status: String(s.status ?? ''),
    supportConversationId: shipSupportMap.get(String(s.id)) ?? null,
    baseId: s.base_id != null && String(s.base_id).trim() ? String(s.base_id) : null,
    pickupCode: strOrNull(s.pickup_code),
    passengerToPreparerCode: strOrNull(s.passenger_to_preparer_code),
    preparerToBaseCode: strOrNull(s.preparer_to_base_code),
    baseToDriverCode: strOrNull(s.base_to_driver_code),
    deliveryCode: strOrNull(s.delivery_code),
    pickedUpByPreparerAt: isoOrNull(s.picked_up_by_preparer_at),
    deliveredToBaseAt: isoOrNull(s.delivered_to_base_at),
    pickedUpByDriverFromBaseAt: isoOrNull(s.picked_up_by_driver_from_base_at),
    pickedUpAt: isoOrNull(s.picked_up_at),
    deliveredAt: isoOrNull(s.delivered_at),
  }));
}

export async function fetchBookingsForDriver(driverId: string): Promise<ViagemListItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, user_id, origin_address, destination_address, status, created_at,
      passenger_count, amount_cents, scheduled_trip_id,
      payment_method, platform_fee_extra_debit_cents,
      scheduled_trips!inner ( id, departure_at, arrival_at, driver_id, status, trunk_occupancy_pct )
    `)
    .eq('scheduled_trips.driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(150);

  if (error || !data?.length) return [];

  const userIds = [...new Set(data.map((x: any) => x.user_id).filter(Boolean))];
  const profileMap: Record<string, string> = {};
  if (userIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
  }
  const driverNameMap: Record<string, string> = {};
  const driverPartnerMap: Record<string, boolean> = {};
  const { data: driverProfiles } = await supabase.from('profiles').select('id, full_name').in('id', [driverId]);
  (driverProfiles || []).forEach((p: any) => { driverNameMap[p.id] = p.full_name || 'Sem nome'; });
  const { data: workers } = await sb.from('worker_profiles').select('id, subtype').eq('id', driverId);
  (workers || []).forEach((w: any) => { driverPartnerMap[w.id] = w.subtype === 'partner'; });

  return (data as any[]).map((row) => listItemFromBookingJoin(row, profileMap, driverNameMap, driverPartnerMap));
}

export async function fetchBookingsForPassengerUser(userId: string): Promise<ViagemListItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, user_id, origin_address, destination_address, status, created_at,
      passenger_count, amount_cents, scheduled_trip_id,
      payment_method, platform_fee_extra_debit_cents,
      scheduled_trips ( id, departure_at, arrival_at, driver_id, status, trunk_occupancy_pct )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data?.length) return [];

  const userIds = [...new Set(data.map((x: any) => x.user_id).filter(Boolean))];
  const driverIds = [...new Set(data.map((x: any) => x.scheduled_trips?.driver_id).filter(Boolean))] as string[];
  const profileMap: Record<string, string> = {};
  if (userIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
  }
  const driverNameMap: Record<string, string> = {};
  const driverPartnerMap: Record<string, boolean> = {};
  if (driverIds.length) {
    const { data: driverProfiles } = await supabase.from('profiles').select('id, full_name').in('id', driverIds);
    (driverProfiles || []).forEach((p: any) => { driverNameMap[p.id] = p.full_name || 'Sem nome'; });
    const { data: workers } = await sb.from('worker_profiles').select('id, subtype').in('id', driverIds);
    (workers || []).forEach((w: any) => { driverPartnerMap[w.id] = w.subtype === 'partner'; });
  }

  return (data as any[]).map((row) => listItemFromBookingJoin(row, profileMap, driverNameMap, driverPartnerMap));
}

export async function updateBookingFields(
  bookingId: string,
  fields: {
    origin_address?: string;
    destination_address?: string;
    origin_lat?: number;
    origin_lng?: number;
    destination_lat?: number;
    destination_lng?: number;
    passenger_count?: number;
    bags_count?: number;
    passenger_data?: unknown;
  },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { data: existing, error: fe } = await supabase
    .from('bookings')
    .select('id')
    .eq('id', bookingId)
    .maybeSingle();
  if (fe || !existing) return { error: fe?.message || 'Reserva não encontrada' };
  const upd: any = { updated_at: new Date().toISOString() };
  if (fields.origin_address != null) upd.origin_address = fields.origin_address;
  if (fields.destination_address != null) upd.destination_address = fields.destination_address;
  if (
    fields.origin_lat != null &&
    fields.origin_lng != null &&
    Number.isFinite(fields.origin_lat) &&
    Number.isFinite(fields.origin_lng)
  ) {
    upd.origin_lat = fields.origin_lat;
    upd.origin_lng = fields.origin_lng;
  }
  if (
    fields.destination_lat != null &&
    fields.destination_lng != null &&
    Number.isFinite(fields.destination_lat) &&
    Number.isFinite(fields.destination_lng)
  ) {
    upd.destination_lat = fields.destination_lat;
    upd.destination_lng = fields.destination_lng;
  }
  if (fields.passenger_count != null) upd.passenger_count = fields.passenger_count;
  if (fields.bags_count != null) upd.bags_count = fields.bags_count;
  if (fields.passenger_data != null) upd.passenger_data = fields.passenger_data;
  const { error } = await (supabase.from('bookings') as any).update(upd).eq('id', bookingId);
  return { error: error ? (error as Error).message : null };
}

export async function updateScheduledTripFields(
  tripId: string,
  fields: {
    departure_at?: string;
    arrival_at?: string;
    driver_id?: string;
    seats_available?: number;
    bags_available?: number;
    trunk_occupancy_pct?: number;
  },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const upd: any = { updated_at: new Date().toISOString() };
  if (fields.departure_at != null) upd.departure_at = fields.departure_at;
  if (fields.arrival_at != null) upd.arrival_at = fields.arrival_at;
  if (fields.driver_id != null) upd.driver_id = fields.driver_id;
  if (fields.seats_available != null) upd.seats_available = fields.seats_available;
  if (fields.bags_available != null) upd.bags_available = fields.bags_available;
  if (fields.trunk_occupancy_pct != null) upd.trunk_occupancy_pct = fields.trunk_occupancy_pct;
  const { error } = await (supabase.from('scheduled_trips') as any).update(upd).eq('id', tripId);
  return { error: error ? (error as Error).message : null };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function fetchEncomendaEditDetail(id: string): Promise<EncomendaEditDetail | null> {
  if (!isSupabaseConfigured) return null;
  const { data: s, error } = await supabase
    .from('shipments')
    .select(`
      *,
      scheduled_trips ( departure_at, arrival_at, driver_id )
    `)
    .eq('id', id)
    .maybeSingle();
  if (!error && s) {
    const r = s as any;
    const trip = r.scheduled_trips;
    const uid = r.user_id as string | undefined;
    let senderName = '—';
    if (uid) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      senderName = ((prof as any)?.full_name as string | undefined)?.trim() || '—';
    }
    return {
      kind: 'shipment',
      id: r.id,
      originAddress: r.origin_address ?? '',
      destinationAddress: r.destination_address ?? '',
      originLat: numOrNull(r.origin_lat),
      originLng: numOrNull(r.origin_lng),
      destinationLat: numOrNull(r.destination_lat),
      destinationLng: numOrNull(r.destination_lng),
      scheduledTripId: r.scheduled_trip_id ?? null,
      tripDriverId: (trip?.driver_id as string | undefined) ?? null,
      tripDepartureAt: trip?.departure_at ?? null,
      tripArrivalAt: trip?.arrival_at ?? null,
      senderName,
      photoUrl: r.photo_url ?? null,
      recipientName: r.recipient_name ?? '',
      recipientPhone: r.recipient_phone ?? '',
      recipientEmail: r.recipient_email ?? '',
      packageSize: r.package_size ?? '',
      amountCents: r.amount_cents ?? 0,
      status: r.status ?? '',
      instructions: r.instructions ?? null,
      whenOption: r.when_option ?? '',
      createdAt: r.created_at ?? '',
      scheduledAt: r.scheduled_at ?? null,
    };
  }
  const { data: d, error: e2 } = await supabase.from('dependent_shipments').select('*').eq('id', id).maybeSingle();
  if (e2 || !d) return null;
  const r = d as any;
  return {
    kind: 'dependent_shipment',
    id: r.id,
    originAddress: r.origin_address ?? '',
    destinationAddress: r.destination_address ?? '',
    originLat: numOrNull(r.origin_lat),
    originLng: numOrNull(r.origin_lng),
    destinationLat: numOrNull(r.destination_lat),
    destinationLng: numOrNull(r.destination_lng),
    fullName: r.full_name ?? '',
    contactPhone: r.contact_phone ?? '',
    receiverName: r.receiver_name ?? null,
    amountCents: r.amount_cents ?? 0,
    status: r.status ?? '',
    instructions: r.instructions ?? null,
    whenOption: r.when_option ?? '',
    createdAt: r.created_at ?? '',
    bagsCount: r.bags_count ?? 0,
    scheduledAt: r.scheduled_at ?? null,
  };
}

export async function updateShipmentFields(
  id: string,
  patch: {
    instructions?: string | null;
    status?: string;
    origin_address?: string;
    origin_lat?: number | null;
    origin_lng?: number | null;
    destination_address?: string;
    destination_lat?: number | null;
    destination_lng?: number | null;
    recipient_name?: string;
    recipient_phone?: string;
    recipient_email?: string;
    package_size?: string;
    when_option?: string;
    scheduled_at?: string | null;
    scheduled_trip_id?: string | null;
  },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await (supabase.from('shipments') as any).update(patch).eq('id', id);
  return { error: error ? (error as Error).message : null };
}

export async function updateDependentShipmentFields(
  id: string,
  patch: {
    instructions?: string | null;
    status?: string;
    origin_address?: string;
    origin_lat?: number | null;
    origin_lng?: number | null;
    destination_address?: string;
    destination_lat?: number | null;
    destination_lng?: number | null;
    full_name?: string;
    contact_phone?: string;
    receiver_name?: string | null;
    when_option?: string;
    bags_count?: number;
    scheduled_at?: string | null;
  },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await (supabase.from('dependent_shipments') as any).update(patch).eq('id', id);
  return { error: error ? (error as Error).message : null };
}

export interface DriverTripRow {
  tripId: string;
  origem: string;
  destino: string;
  data: string;
  embarque: string;
  chegada: string;
  valor: string;
  pctMotorista: string;
  pctAdmin: string;
  pagamento: string;
}

export async function fetchDriverTripRowsForPaymentDetail(driverId: string): Promise<DriverTripRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data: trips, error } = await supabase
    .from('scheduled_trips')
    .select('id, origin_address, destination_address, departure_at, arrival_at, amount_cents, driver_id')
    .eq('driver_id', driverId)
    .order('departure_at', { ascending: false })
    .limit(50);
  if (error || !trips?.length) return [];
  const fmtMoney = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

  // Buscar payouts vinculados às viagens para calcular splits reais
  const tripIds = (trips as any[]).map((t) => t.id);
  const { data: payouts } = await (supabase as any)
    .from('payouts')
    .select('entity_id, worker_amount_cents, admin_amount_cents, gross_amount_cents, status, payment_method')
    .in('entity_id', tripIds);

  const payoutMap = new Map<string, any>();
  for (const p of (payouts ?? []) as any[]) {
    payoutMap.set(p.entity_id, p);
  }

  const fmtPct = (num: number, denom: number) =>
    denom > 0 ? `${Math.round((num / denom) * 100)}%` : '—';
  const fmtPayMethod = (method: string | null) => {
    if (!method) return '—';
    if (method === 'pix') return 'Pix';
    if (method === 'credit_card') return 'Crédito';
    if (method === 'debit_card') return 'Débito';
    return method;
  };

  return (trips as any[]).map((t) => {
    const payout = payoutMap.get(t.id);
    const gross = Number(payout?.gross_amount_cents ?? 0);
    const workerAmt = Number(payout?.worker_amount_cents ?? 0);
    const adminAmt = Number(payout?.admin_amount_cents ?? 0);
    return {
      tripId: t.id,
      origem: shortAddr(t.origin_address || ''),
      destino: shortAddr(t.destination_address || ''),
      data: t.departure_at ? fmtDate(t.departure_at) : '—',
      embarque: t.departure_at ? fmtTime(t.departure_at) : '—',
      chegada: t.arrival_at ? fmtTime(t.arrival_at) : '—',
      valor: fmtMoney(Number(t.amount_cents ?? 0)),
      pctMotorista: payout ? fmtPct(workerAmt, gross) : '—',
      pctAdmin: payout ? fmtPct(adminAmt, gross) : '—',
      pagamento: payout ? fmtPayMethod(payout.payment_method) : '—',
    };
  });
}

export interface PreparerEncTrechoRow {
  origem: string;
  destino: string;
  valor: string;
  idaLinha1: string;
  idaLinha2: string;
  retLinha1: string;
  retLinha2: string;
  valorKm: string;
  pctAdmin: string;
}

export function pricingRoutesToPreparerEncRows(routes: PricingRouteRow[]): PreparerEncTrechoRow[] {
  const fmtMoney = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  return routes.map((r) => ({
    origem: r.origin_address || '—',
    destino: r.destination_address || '—',
    valor: fmtMoney(r.price_cents),
    idaLinha1: '',
    idaLinha2: '',
    retLinha1: '',
    retLinha2: '',
    valorKm: r.pricing_mode === 'per_km' ? fmtMoney(r.price_cents) : '—',
    pctAdmin: `${r.admin_pct ?? 0}%`,
  }));
}

export interface MotoristaPaymentHeader {
  nome: string;
  rating: number;
  pixChave: string;
  numRotas: number;
  mediaAval: string;
  ganhoMes: string;
  ganhoAno: string;
  totalMensal: string;
  lucroMedio: string;
}

export async function fetchMotoristaPaymentHeader(driverId: string): Promise<MotoristaPaymentHeader> {
  const empty = (): MotoristaPaymentHeader => ({
    nome: 'Motorista',
    rating: 0,
    pixChave: '—',
    numRotas: 0,
    mediaAval: '—',
    ganhoMes: 'R$ 0,00',
    ganhoAno: 'R$ 0,00',
    totalMensal: 'R$ 0,00',
    lucroMedio: '—',
  });
  if (!isSupabaseConfigured) return empty();
  const { data: prof } = await supabase.from('profiles').select('full_name, rating').eq('id', driverId).maybeSingle();
  const { data: worker } = await sb.from('worker_profiles').select('pix_key').eq('id', driverId).maybeSingle();
  const { count } = await supabase.from('scheduled_trips').select('*', { count: 'exact', head: true }).eq('driver_id', driverId);
  const { data: payouts } = await sb
    .from('payouts')
    .select('gross_amount_cents, worker_amount_cents, admin_amount_cents, status, created_at')
    .eq('worker_id', driverId)
    .order('created_at', { ascending: false })
    .limit(200);
  const nome = (prof as any)?.full_name ?? 'Motorista';
  const rating = Number((prof as any)?.rating ?? 0);
  const pixChave = (worker as any)?.pix_key ?? '—';
  const numRotas = count ?? 0;
  const paid = (payouts || []).filter((p: any) => p.status === 'paid');
  const sumGross = paid.reduce((s: number, p: any) => s + (p.gross_amount_cents || 0), 0);
  const sumWorker = paid.reduce((s: number, p: any) => s + (p.worker_amount_cents || 0), 0);
  const fmt = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lucroMedio = paid.length && sumGross > 0
    ? `${Math.round((sumWorker / sumGross) * 100)}%`
    : '—';
  return {
    nome,
    rating,
    pixChave,
    numRotas,
    mediaAval: rating ? String(rating) : '—',
    ganhoMes: fmt(Math.round(sumWorker * 0.2)),
    ganhoAno: fmt(sumWorker),
    totalMensal: fmt(sumWorker),
    lucroMedio,
  };
}

export interface PreparerEncPaymentHeader {
  nome: string;
  rating: number;
  pixChave: string;
}

export async function fetchPreparerEncPaymentHeader(preparerId: string): Promise<PreparerEncPaymentHeader> {
  if (!isSupabaseConfigured) return { nome: 'Preparador', rating: 0, pixChave: '—' };
  const { data: prof } = await supabase.from('profiles').select('full_name, rating').eq('id', preparerId).maybeSingle();
  const { data: worker } = await sb.from('worker_profiles').select('pix_key').eq('id', preparerId).maybeSingle();
  return {
    nome: (prof as any)?.full_name ?? 'Preparador',
    rating: Number((prof as any)?.rating ?? 0),
    pixChave: (worker as any)?.pix_key ?? '—',
  };
}

export interface ApprovedDriverCandidate {
  id: string;
  nome: string;
  rating: number | null;
  totalViagens: number;
  isPartner: boolean;
  avatarUrl: string | null;
}

export async function fetchApprovedDriversForEncomendaUI(): Promise<ApprovedDriverCandidate[]> {
  const motoristas = await fetchMotoristas();
  if (!motoristas.length) return [];
  const ids = motoristas.map((m) => m.id);
  const { data: workers } = await sb.from('worker_profiles').select('id, subtype, status').in('id', ids);
  type W = { id: string; subtype?: string; status?: string };
  const statusMap = new Map<string, W>((workers || []).map((w: W) => [w.id, w]));
  return motoristas
    .filter((m) => (statusMap.get(m.id)?.status ?? 'approved') === 'approved')
    .map((m) => {
      const w = statusMap.get(m.id);
      return {
        id: m.id,
        nome: m.nome,
        rating: m.rating,
        totalViagens: m.totalViagens,
        isPartner: w?.subtype === 'partner',
        avatarUrl: m.avatarUrl ?? null,
      };
    });
}

export interface HomeApprovedExpenseCents {
  totalCents: number;
}

export async function fetchApprovedTripExpensesCents(): Promise<HomeApprovedExpenseCents> {
  if (!isSupabaseConfigured) return { totalCents: 0 };
  // Usa function SQL que soma TODOS os payouts sem limite
  const { data, error } = await (sb as any).rpc('admin_approved_expenses_cents');
  if (error || data == null) return { totalCents: 0 };
  return { totalCents: Number(data) || 0 };
}

export interface ConversationCategoryCount {
  label: string;
  count: number;
}

export async function fetchConversationCategoryCounts(): Promise<ConversationCategoryCount[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await sb.from('conversations').select('id, status');
  if (error || !data) return [];
  const active = data.filter((c: any) => c.status === 'active').length;
  const closed = data.filter((c: any) => c.status !== 'active').length;
  return [
    { label: 'Todos', count: data.length },
    { label: 'Em atendimento', count: active },
    { label: 'Finalizadas', count: closed },
  ];
}

export interface PagamentosGestaoMotoristaRow {
  nome: string;
  rating: number;
  numTrechos: string;
  horario: string;
  dataInicio: string;
  primaryTipo: 'takeme' | 'parceiros';
  secondaryTipo: 'viagem' | 'excursao';
  driverId: string;
}

export function motoristasToGestaoRows(motoristas: MotoristaListItem[], workers: { id: string; subtype?: string }[]): PagamentosGestaoMotoristaRow[] {
  const sub = new Map(workers.map((w) => [w.id, w.subtype]));
  return motoristas.map((m) => ({
    nome: m.nome,
    rating: Number(m.rating ?? 0),
    numTrechos: `${m.totalViagens} rotas`,
    horario: '—',
    dataInicio: '—',
    primaryTipo: sub.get(m.id) === 'partner' ? 'parceiros' : 'takeme',
    secondaryTipo: 'viagem' as const,
    driverId: m.id,
  }));
}

export async function fetchWorkerSubtypesForGestao(): Promise<{ id: string; subtype?: string }[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await sb.from('worker_profiles').select('id, subtype');
  return ((data || []) as { id: string; subtype?: string | null }[]).map((w) => ({
    id: w.id,
    subtype: w.subtype ?? undefined,
  }));
}

export interface ViagemCounts {
  total: number;
  concluidas: number;
  agendadas: number;
  emAndamento: number;
  canceladas: number;
}

export async function fetchViagemCounts(): Promise<ViagemCounts> {
  const items = await fetchViagens();
  return viagemCountsFromItems(items);
}

export function viagemCountsFromItems(items: ViagemListItem[]): ViagemCounts {
  return {
    total: items.length,
    concluidas: items.filter((i) => i.status === 'concluído').length,
    agendadas: items.filter((i) => i.status === 'agendado').length,
    emAndamento: items.filter((i) => i.status === 'em_andamento').length,
    canceladas: items.filter((i) => i.status === 'cancelado').length,
  };
}

/** YYYY-MM-DD no fuso local */
export function localYmdFromIso(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalYmd(): string {
  return localYmdFromIso(new Date().toISOString());
}

export type ViagemDatasIncluidas = 'somente_passadas' | 'passadas_e_futuras' | 'somente_futuras';

export type ViagemListFilter = {
  status: 'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas';
  categoria: 'todos' | 'take_me' | 'motorista';
  /** Filtro por `bookings.payment_method` (omitir ou `'todos'` = sem filtro) */
  paymentMethod?: 'todos' | BookingPaymentMethod;
  nomeNeedle: string;
  origemNeedle: string;
  /** YYYY-MM-DD — filtro opcional da tabela (dia exato) */
  tableDateYmd: string;
  /** YYYY-MM-DD — período barra de pesquisa */
  periodoInicioYmd: string;
  periodoFimYmd: string;
  datasIncluidas: ViagemDatasIncluidas;
};

const STATUS_BUCKET: Record<ViagemListFilter['status'], ViagemListItem['status'][]> = {
  todos: ['em_andamento', 'agendado', 'concluído', 'cancelado'],
  em_andamento: ['em_andamento'],
  agendadas: ['agendado'],
  concluidas: ['concluído'],
  canceladas: ['cancelado'],
};

export function filterViagemListItem(v: ViagemListItem, f: ViagemListFilter): boolean {
  if (f.status !== 'todos') {
    const bucket = STATUS_BUCKET[f.status];
    if (!bucket.includes(v.status)) return false;
  }
  if (f.categoria === 'take_me' && v.motoristaCategoria !== 'take_me') return false;
  if (f.categoria === 'motorista' && v.motoristaCategoria !== 'motorista') return false;
  const pay = f.paymentMethod ?? 'todos';
  if (pay !== 'todos' && v.paymentMethod !== pay) return false;
  const n = f.nomeNeedle.trim().toLowerCase();
  if (n) {
    const hay = `${v.passageiro} ${v.motoristaNome}`.toLowerCase();
    if (!hay.includes(n)) return false;
  }
  const o = f.origemNeedle.trim().toLowerCase();
  if (o && !(`${v.origem} ${v.destino}`.toLowerCase().includes(o))) return false;
  if (f.tableDateYmd) {
    const dep = localYmdFromIso(v.departureAtIso);
    if (dep !== f.tableDateYmd) return false;
  }
  const depY = localYmdFromIso(v.departureAtIso);
  if (f.periodoInicioYmd && depY && depY < f.periodoInicioYmd) return false;
  if (f.periodoFimYmd && depY && depY > f.periodoFimYmd) return false;
  const today = todayLocalYmd();
  if (f.datasIncluidas === 'somente_passadas' && depY && !(depY < today)) return false;
  if (f.datasIncluidas === 'somente_futuras' && depY && !(depY > today)) return false;
  return true;
}

export type HomeEncomendaFilterStatus = 'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas';

const ENC_STATUS_BUCKET: Record<HomeEncomendaFilterStatus, EncomendaListItem['status'][]> = {
  todos: ['Em andamento', 'Agendado', 'Concluído', 'Cancelado'],
  em_andamento: ['Em andamento'],
  agendadas: ['Agendado'],
  concluidas: ['Concluído'],
  canceladas: ['Cancelado'],
};

export function filterEncomendaForHome(
  e: EncomendaListItem,
  status: HomeEncomendaFilterStatus,
  periodoInicioYmd: string,
  periodoFimYmd: string,
): boolean {
  if (status !== 'todos' && !ENC_STATUS_BUCKET[status].includes(e.status)) return false;
  const cy = localYmdFromIso(e.createdAtIso);
  if (periodoInicioYmd && cy && cy < periodoInicioYmd) return false;
  if (periodoFimYmd && cy && cy > periodoFimYmd) return false;
  return true;
}

// ── Passageiros ─────────────────────────────────────────────────────────

export async function fetchPassageiros(): Promise<PassageiroListItem[]> {
  // Exclude workers (drivers, preparers, admins) — only show client app users
  const { data: workerIds } = await sb
    .from('worker_profiles')
    .select('id');
  const excludeSet = new Set((workerIds ?? []).map((w: any) => w.id));

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, avatar_url, cpf, city, state, verified, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !data) return [];

  return data
    .filter((p: any) => !excludeSet.has(p.id))
    .map((p: any) => ({
      id: p.id,
      nome: p.full_name ?? 'Sem nome',
      cidade: p.city ?? '—',
      estado: p.state ?? '—',
      dataCriacao: fmtDate(p.created_at),
      createdAtIso: p.created_at ? (p.created_at as string).slice(0, 10) : '',
      cpf: p.cpf ?? '—',
      status: p.verified ? 'Ativo' as const : 'Inativo' as const,
      avatarUrl: p.avatar_url,
    }));
}

export interface PassageiroCounts {
  total: number;
  ativos: number;
  inativos: number;
}

export async function fetchPassageiroCounts(): Promise<PassageiroCounts> {
  const items = await fetchPassageiros();
  return {
    total: items.length,
    ativos: items.filter((i) => i.status === 'Ativo').length,
    inativos: items.filter((i) => i.status === 'Inativo').length,
  };
}

/** Detalhe admin por `profiles.id` (exclui workers). */
export async function fetchPassageiroDetailForAdmin(userId: string): Promise<PassageiroListItem & { phone: string | null } | null> {
  if (!isSupabaseConfigured) return null;
  const { data: worker } = await sb.from('worker_profiles').select('id').eq('id', userId).maybeSingle();
  if (worker) return null;
  const { data: p, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, avatar_url, cpf, city, state, verified, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error || !p) return null;
  const row = p as any;
  return {
    id: row.id,
    nome: row.full_name ?? 'Sem nome',
    cidade: row.city ?? '—',
    estado: row.state ?? '—',
    dataCriacao: fmtDate(row.created_at),
    createdAtIso: row.created_at ? (row.created_at as string).slice(0, 10) : '',
    cpf: row.cpf ?? '—',
    status: row.verified ? 'Ativo' : 'Inativo',
    avatarUrl: row.avatar_url,
    phone: row.phone ?? null,
  };
}

// ── Encomendas ──────────────────────────────────────────────────────────

export async function fetchEncomendas(): Promise<EncomendaListItem[]> {
  const [shipRes, depRes, convRes] = await Promise.all([
    supabase
      .from('shipments')
      .select(`
        id, origin_address, destination_address, recipient_name, status, amount_cents, package_size, created_at,
        scheduled_trip_id, stripe_payment_intent_id,
        scheduled_trips ( departure_at, arrival_at )
      `)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('dependent_shipments')
      .select('id, origin_address, destination_address, full_name, status, amount_cents, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    sb
      .from('conversations')
      .select('id, shipment_id, context')
      .eq('conversation_kind', 'support_backoffice')
      .eq('category', 'encomendas')
      .eq('status', 'active'),
  ]);

  // Mapear shipment_id e dependent_shipment_id para conversation id
  const shipConvMap = new Map<string, string>();
  const depConvMap = new Map<string, string>();
  for (const c of (convRes.data ?? []) as any[]) {
    if (c.shipment_id) shipConvMap.set(String(c.shipment_id), String(c.id));
    const depId = c.context?.dependent_shipment_id;
    if (depId) depConvMap.set(String(depId), String(c.id));
  }

  const shipments: EncomendaListItem[] = (shipRes.data ?? []).map((s: any) => {
    const trip = s.scheduled_trips as { departure_at?: string; arrival_at?: string } | null | undefined;
    const depAt = trip?.departure_at;
    const arrAt = trip?.arrival_at;
    return {
      id: s.id,
      tipo: 'shipment' as const,
      destino: shortAddr(s.destination_address),
      origem: shortAddr(s.origin_address),
      remetente: s.recipient_name,
      data: fmtDate(s.created_at),
      status: mapEncomendaStatus(s.status),
      amountCents: s.amount_cents,
      packageSize: s.package_size,
      createdAtIso: s.created_at ? new Date(s.created_at).toISOString() : '',
      embarque: depAt ? fmtTime(depAt) : '—',
      chegada: arrAt ? fmtTime(arrAt) : '—',
      rawStatus: String(s.status ?? ''),
      scheduledTripId: s.scheduled_trip_id ? String(s.scheduled_trip_id) : null,
      supportConversationId: shipConvMap.get(String(s.id)) ?? null,
      paymentStatus: (() => {
        if (!s.stripe_payment_intent_id) return null;
        const st = String(s.status ?? '');
        if (st === 'completed' || st === 'delivered') return 'paid' as const;
        return 'pending' as const;
      })(),
    };
  });

  const depShipments: EncomendaListItem[] = (depRes.data ?? []).map((d: any) => ({
    id: d.id,
    tipo: 'dependent_shipment' as const,
    destino: shortAddr(d.destination_address),
    origem: shortAddr(d.origin_address),
    remetente: d.full_name,
    data: fmtDate(d.created_at),
    status: mapEncomendaStatus(d.status),
    amountCents: d.amount_cents,
    createdAtIso: d.created_at ? new Date(d.created_at).toISOString() : '',
    embarque: '—',
    chegada: '—',
    rawStatus: String(d.status ?? ''),
    scheduledTripId: null,
    supportConversationId: depConvMap.get(String(d.id)) ?? null,
    paymentStatus: null,
  }));

  return [...shipments, ...depShipments].sort(
    (a, b) => b.data.localeCompare(a.data),
  );
}

export interface EncomendaCounts {
  total: number;
  concluidas: number;
  emAndamento: number;
  agendadas: number;
  canceladas: number;
}

export function encomendaCountsFromItems(items: EncomendaListItem[]): EncomendaCounts {
  return {
    total: items.length,
    concluidas: items.filter((i) => i.status === 'Concluído').length,
    emAndamento: items.filter((i) => i.status === 'Em andamento').length,
    agendadas: items.filter((i) => i.status === 'Agendado').length,
    canceladas: items.filter((i) => i.status === 'Cancelado').length,
  };
}

export async function fetchEncomendaCounts(): Promise<EncomendaCounts> {
  const items = await fetchEncomendas();
  return encomendaCountsFromItems(items);
}

// ── Motoristas ──────────────────────────────────────────────────────────

/**
 * Lista motoristas para KPIs e selects admin.
 * Agrega viagens por `scheduled_trips`, mas a base de IDs vem também de `worker_profiles` (role = driver),
 * alinhado à lista de cadastros. Assim o total / média / ranking não zeram quando não há viagens visíveis
 * (RLS, erro na query) ou motoristas ainda sem viagem.
 */
export async function fetchMotoristas(): Promise<MotoristaListItem[]> {
  if (!isSupabaseConfigured) return [];

  const [{ data: trips, error: tripsError }, { data: workers, error: workersError }] = await Promise.all([
    supabase.from('scheduled_trips').select('driver_id, status').limit(5000),
    sb.from('worker_profiles').select('id').eq('role', 'driver').order('created_at', { ascending: false }).limit(500),
  ]);

  const driverMap = new Map<string, { total: number; active: number; scheduled: number }>();
  if (!tripsError && trips) {
    for (const t of trips as any[]) {
      const did = t.driver_id as string | null | undefined;
      if (!did) continue;
      const entry = driverMap.get(did) ?? { total: 0, active: 0, scheduled: 0 };
      entry.total++;
      if (t.status === 'active') entry.active++;
      if (t.status === 'scheduled') entry.scheduled++;
      driverMap.set(did, entry);
    }
  }

  const workerIds: string[] =
    !workersError && workers?.length
      ? (workers as any[]).map((w) => w.id as string)
      : [];

  const allIds = new Set<string>([...workerIds, ...driverMap.keys()]);
  if (allIds.size === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, rating')
    .in('id', [...allIds]);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  return [...allIds].map((did) => {
    const stats = driverMap.get(did) ?? { total: 0, active: 0, scheduled: 0 };
    const p = profileMap.get(did) as any;
    return {
      id: did,
      nome: p?.full_name ?? 'Sem nome',
      totalViagens: stats.total,
      viagensAtivas: stats.active,
      viagensAgendadas: stats.scheduled,
      avatarUrl: p?.avatar_url ?? null,
      rating: p?.rating ?? null,
    };
  }).sort((a, b) => b.totalViagens - a.totalViagens);
}

/** Motoristas com saldo devido à plataforma (`worker_profiles.platform_fee_owed_cents > 0`). */
export async function fetchMotoristasComTaxaPlataformaDevida(): Promise<MotoristaPlatformFeeDebtItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data: workers, error } = await sb
    .from('worker_profiles')
    .select('id, platform_fee_owed_cents')
    .eq('role', 'driver')
    .gt('platform_fee_owed_cents', 0)
    .order('platform_fee_owed_cents', { ascending: false })
    .limit(200);
  if (error || !workers?.length) return [];
  const ids = (workers as any[]).map((w) => w.id as string);
  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
  const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name ?? 'Sem nome']));
  return (workers as any[]).map((w) => ({
    id: w.id,
    nome: nameMap.get(w.id) ?? 'Sem nome',
    platformFeeOwedCents: Number(w.platform_fee_owed_cents ?? 0),
  }));
}

export async function fetchDriverPlatformFeeLedger(
  workerId: string,
  limit = 80,
): Promise<DriverPlatformFeeLedgerRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await sb
    .from('driver_platform_fee_ledger')
    .select('id, worker_id, booking_id, kind, amount_cents, note, created_at')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    workerId: r.worker_id,
    bookingId: r.booking_id ?? null,
    kind: r.kind === 'debit' ? 'debit' : 'credit',
    amountCents: Number(r.amount_cents ?? 0),
    note: String(r.note ?? ''),
    createdAt: String(r.created_at ?? ''),
  }));
}

export async function adminManualSettlePlatformFee(
  workerId: string,
  amountCents: number,
): Promise<{ ok: boolean; error: string | null; settledCents?: number; owedAfter?: number }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase not configured' };
  const { data, error } = await (supabase as any).rpc('admin_manual_platform_fee_settle', {
    p_worker_id: workerId,
    p_amount_cents: amountCents,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== 'object') return { ok: false, error: 'Resposta inválida' };
  if (row.ok !== true) return { ok: false, error: String(row.error ?? 'Erro') };
  return {
    ok: true,
    error: null,
    settledCents: Number(row.settled_cents ?? 0),
    owedAfter: Number(row.owed_after ?? 0),
  };
}

// ── Motorista Table Rows (with trip details) ────────────────────────────

/**
 * `worker_profiles.subtype` no Postgres (CHECK): 'takeme' | 'partner' | 'shipments' | 'excursions'.
 * UI admin: take_me = frota Take Me; parceiro = motorista parceiro.
 * Qualquer valor que não seja claramente parceiro cai em take_me (incl. takeme, null, shipments em linhas legadas).
 */
function motoristaCategoriaFromWorkerSubtype(subtype: string | null | undefined): 'take_me' | 'parceiro' {
  const s = String(subtype ?? '').trim().toLowerCase();
  if (s === 'partner' || s === 'parceiro') return 'parceiro';
  return 'take_me';
}

export interface MotoristaTableRow {
  tripId: string;
  nome: string;
  origem: string;
  destino: string;
  data: string;
  /** ISO date string for filtering (e.g. '2025-09-01') */
  dataIso: string;
  embarque: string;
  chegada: string;
  status: 'Concluído' | 'Cancelado' | 'Agendado' | 'Em andamento';
  driverId: string;
  avatarUrl: string | null;
  /** 'take_me' ou 'parceiro' — derivado de worker_profiles.subtype */
  categoria: 'take_me' | 'parceiro';
}

export async function fetchMotoristaTableRows(): Promise<MotoristaTableRow[]> {
  // Get trips with driver profiles
  const { data: trips, error } = await supabase
    .from('scheduled_trips')
    .select('id, driver_id, origin_address, destination_address, departure_at, arrival_at, status')
    .order('departure_at', { ascending: false })
    .limit(5000);

  if (error || !trips || trips.length === 0) return [];

  const driverIds = [...new Set((trips as any[]).map((t) => t.driver_id))];
  const [{ data: profiles }, { data: workers }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, avatar_url').in('id', driverIds),
    (supabase as any).from('worker_profiles').select('id, subtype').in('id', driverIds),
  ]);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const workerMap = new Map((workers ?? []).map((w: any) => [w.id, w]));

  return (trips as any[]).map((t) => {
    const p = profileMap.get(t.driver_id) as any;
    const w = workerMap.get(t.driver_id) as any;
    const tripStatus = t.status as string;
    let uiStatus: MotoristaTableRow['status'] = 'Em andamento';
    if (tripStatus === 'completed') uiStatus = 'Concluído';
    else if (tripStatus === 'cancelled') uiStatus = 'Cancelado';
    else if (tripStatus === 'scheduled') uiStatus = 'Agendado';

    return {
      tripId: String(t.id ?? ''),
      nome: p?.full_name ?? 'Sem nome',
      origem: shortAddr(t.origin_address || ''),
      destino: shortAddr(t.destination_address || ''),
      data: t.departure_at ? fmtDate(t.departure_at) : '—',
      dataIso: t.departure_at ? new Date(t.departure_at).toISOString().slice(0, 10) : '',
      embarque: t.departure_at ? fmtTime(t.departure_at) : '—',
      chegada: t.arrival_at ? fmtTime(t.arrival_at) : '—',
      status: uiStatus,
      driverId: t.driver_id,
      avatarUrl: p?.avatar_url ?? null,
      categoria: motoristaCategoriaFromWorkerSubtype(w?.subtype),
    };
  });
}

/** Fetches ALL worker profiles (all approval statuses) for the admin approval view. */
export async function fetchAllMotoristaProfiles(): Promise<import('./types').WorkerApprovalRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data: workers, error } = await (supabase as any)
    .from('worker_profiles')
    .select(
      'id, role, subtype, status, rejection_reason, reviewed_at, created_at, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted',
    )
    .eq('role', 'driver')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error || !workers || workers.length === 0) return [];

  const ids: string[] = workers.map((w: any) => w.id as string);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, rating, phone')
    .in('id', ids);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  return workers.map((w: any) => {
    const p = profileMap.get(w.id) as any;
    return {
      id: w.id as string,
      nome: p?.full_name ?? 'Sem nome',
      phone: p?.phone ?? null,
      avatarUrl: p?.avatar_url ?? null,
      rating: typeof p?.rating === 'number' ? p.rating : null,
      subtype: motoristaCategoriaFromWorkerSubtype(w.subtype),
      approvalStatus: (w.status ?? 'pending') as import('./types').WorkerApprovalStatus,
      rejectionReason: w.rejection_reason ?? null,
      createdAt: w.created_at ?? '',
      reviewedAt: w.reviewed_at ?? null,
      connect: {
        accountId: (w.stripe_connect_account_id as string | null) ?? null,
        chargesEnabled: Boolean(w.stripe_connect_charges_enabled),
        payoutsEnabled: Boolean(w.stripe_connect_payouts_enabled),
        detailsSubmitted: Boolean(w.stripe_connect_details_submitted),
      },
    };
  });
}

// ── Destinos ────────────────────────────────────────────────────────────

function emptyDestinoTripCounts(): DestinoTripStatusCounts {
  return { em_andamento: 0, agendadas: 0, concluidas: 0, canceladas: 0 };
}

function mapScheduledTripToDestinoBucket(status: string): keyof DestinoTripStatusCounts {
  if (status === 'cancelled') return 'canceladas';
  if (status === 'completed') return 'concluidas';
  if (status === 'active') return 'em_andamento';
  return 'agendadas';
}

export async function fetchDestinos(): Promise<DestinoListItem[]> {
  const { data, error } = await supabase
    .from('scheduled_trips')
    .select('origin_address, destination_address, status, created_at, driver_id, departure_at')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error || !data) return [];

  const driverIds = [...new Set((data as any[]).map((t) => t.driver_id).filter(Boolean))] as string[];
  const partnerDriverIds = new Set<string>();
  if (driverIds.length > 0) {
    const { data: workers } = await (supabase as any)
      .from('worker_profiles')
      .select('id, subtype')
      .in('id', driverIds);
    (workers || []).forEach((w: any) => {
      if (w.subtype === 'partner') partnerDriverIds.add(w.id);
    });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  type Agg = {
    count: number;
    firstDate: string;
    hasActive: boolean;
    tripStatusCounts: DestinoTripStatusCounts;
    takeMeCount: number;
    partnerCount: number;
    hasPastDeparture: boolean;
    hasFutureDeparture: boolean;
  };

  const routeMap = new Map<string, Agg>();
  for (const t of data as any[]) {
    const key = `${shortAddr(t.origin_address)}|||${shortAddr(t.destination_address)}`;
    const bucket = mapScheduledTripToDestinoBucket(String(t.status ?? ''));
    const prev = routeMap.get(key);
    const entry: Agg = prev ?? {
      count: 0,
      firstDate: t.created_at,
      hasActive: false,
      tripStatusCounts: emptyDestinoTripCounts(),
      takeMeCount: 0,
      partnerCount: 0,
      hasPastDeparture: false,
      hasFutureDeparture: false,
    };
    entry.count++;
    entry.tripStatusCounts[bucket]++;
    if (t.status === 'active') entry.hasActive = true;
    if (t.created_at && t.created_at < entry.firstDate) entry.firstDate = t.created_at;
    const did = t.driver_id as string | null;
    if (did && partnerDriverIds.has(did)) entry.partnerCount++;
    else entry.takeMeCount++;
    if (t.departure_at) {
      const dep = new Date(t.departure_at);
      if (!Number.isNaN(dep.getTime())) {
        if (dep < startOfToday) entry.hasPastDeparture = true;
        if (dep > endOfToday) entry.hasFutureDeparture = true;
      }
    }
    routeMap.set(key, entry);
  }

  const fromTrips = Array.from(routeMap.entries()).map(([key, val]) => {
    const [origem, destino] = key.split('|||');
    const primeiraDataIso = localYmdFromIso(val.firstDate);
    return {
      origem,
      destino,
      totalAtividades: val.count,
      primeiraData: fmtDate(val.firstDate),
      primeiraDataIso,
      ativo: val.hasActive,
      tripStatusCounts: val.tripStatusCounts,
      takeMeCount: val.takeMeCount,
      partnerCount: val.partnerCount,
      hasPastDeparture: val.hasPastDeparture,
      hasFutureDeparture: val.hasFutureDeparture,
    };
  });

  const seenKeys = new Set(fromTrips.map((d) => `${d.origem}|||${d.destino}`));
  const { data: takemeRows } = await sb
    .from('takeme_routes')
    .select('origin_address, destination_address, is_active, created_at')
    .order('created_at', { ascending: false });

  const fromTakeme: DestinoListItem[] = [];
  for (const r of (takemeRows || []) as any[]) {
    const origem = shortAddr(String(r.origin_address ?? ''));
    const destino = shortAddr(String(r.destination_address ?? ''));
    const k = `${origem}|||${destino}`;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    const created = r.created_at as string;
    fromTakeme.push({
      origem,
      destino,
      totalAtividades: 0,
      primeiraData: fmtDate(created),
      primeiraDataIso: localYmdFromIso(created),
      ativo: Boolean(r.is_active),
      tripStatusCounts: emptyDestinoTripCounts(),
      takeMeCount: 1,
      partnerCount: 0,
      hasPastDeparture: false,
      hasFutureDeparture: false,
      sourceTakemeOnly: true,
    });
  }

  return [...fromTrips, ...fromTakeme].sort((a, b) => b.totalAtividades - a.totalAtividades);
}

// ── Preparadores ────────────────────────────────────────────────────────

function fmtBRLFromCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents) / 100);
}

/** Exibe centavos em BRL (ex.: painel preparador). */
export function formatCurrencyBRL(cents: number | null | undefined): string {
  return fmtBRLFromCents(cents);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export async function fetchPreparadores(): Promise<PreparadorListItem[]> {
  // FK preparer_id → auth.users (not public.profiles), so we do two queries
  const { data, error } = await (supabase as any)
    .from('excursion_requests')
    .select('id, destination, excursion_date, status, preparer_id, scheduled_departure_at, created_at')
    .not('preparer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data || data.length === 0) return [];

  // Fetch preparer names from profiles (keyed by user id)
  const preparerIds: string[] = [...new Set<string>(data.map((e: any) => e.preparer_id as string))];
  const { data: profilesData } = await (supabase as any)
    .from('profiles')
    .select('id, full_name')
    .in('id', preparerIds);

  const profileMap: Record<string, string> = {};
  (profilesData ?? []).forEach((p: any) => { profileMap[p.id] = p.full_name ?? 'Preparador'; });

  return data.map((e: any) => {
    const dateIso: string = (e.scheduled_departure_at || e.excursion_date || '');
    return {
      id: e.id,
      nome: profileMap[e.preparer_id] ?? 'Preparador',
      origem: '—',
      destino: e.destination,
      dataInicio: dateIso ? `${fmtDate(dateIso)}\n${fmtTime(dateIso)}` : '—',
      rawDate: dateIso ? dateIso.slice(0, 10) : '',
      previsao: '—',
      avaliacao: null,
      status: mapPreparadorStatus(e.status),
    };
  });
}

/**
 * Lista preparadores cadastrados em `worker_profiles` por subtype.
 * Alinhado ao Figma (898-20340): cada linha é um preparador, não um pedido.
 * Campos origem/destino/previsão vêm como "—" porque não se aplicam ao cadastro do worker.
 * `dataInicio` usa `created_at` (data do cadastro) para permitir filtros por período.
 * `status` é derivado de `worker_profiles.status`: approved→Em andamento, pending/under_review→Agendado,
 * inactive/rejected→Cancelado.
 */
export async function fetchPreparadoresWorkersBySubtype(
  subtype: 'excursions' | 'shipments',
): Promise<PreparadorListItem[]> {
  if (!isSupabaseConfigured) return [];

  const { data: workers, error } = await sb
    .from('worker_profiles')
    .select('id, status, created_at')
    .eq('role', 'preparer')
    .eq('subtype', subtype)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !workers || workers.length === 0) return [];

  const workerIds = (workers as any[]).map((w) => w.id as string);
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('id, full_name, rating')
    .in('id', workerIds);

  const profileMap = new Map<string, { full_name: string | null; rating: number | null }>();
  (profilesData ?? []).forEach((p: any) => {
    profileMap.set(p.id, { full_name: p.full_name ?? null, rating: p.rating != null ? Number(p.rating) : null });
  });

  const statusLabel = (raw: string): PreparadorListItem['status'] => {
    if (raw === 'approved') return 'Em andamento';
    if (raw === 'pending' || raw === 'under_review') return 'Agendado';
    if (raw === 'rejected' || raw === 'inactive') return 'Cancelado';
    return 'Agendado';
  };

  return (workers as any[]).map((w) => {
    const prof = profileMap.get(w.id);
    const created: string = w.created_at ?? '';
    return {
      id: w.id,
      nome: prof?.full_name ?? 'Preparador',
      origem: '—',
      destino: '—',
      dataInicio: created ? `${fmtDate(created)}\n${fmtTime(created)}` : '—',
      rawDate: created ? created.slice(0, 10) : '',
      previsao: '—',
      avaliacao: prof?.rating ?? null,
      status: statusLabel(String(w.status ?? '')),
    };
  });
}

export async function fetchPreparadorById(id: string): Promise<PreparadorListItem | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await (supabase as any)
    .from('excursion_requests')
    .select('id, destination, excursion_date, status, preparer_id, scheduled_departure_at, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const e = data as any;
  let nome = 'Preparador';
  if (e.preparer_id) {
    const { data: prof } = await (supabase as any)
      .from('profiles').select('full_name').eq('id', e.preparer_id).maybeSingle();
    if (prof?.full_name) nome = prof.full_name;
  }
  const dateIso: string = (e.scheduled_departure_at || e.excursion_date || '');
  return {
    id: e.id,
    nome,
    origem: '—',
    destino: e.destination,
    dataInicio: dateIso ? `${fmtDate(dateIso)}\n${fmtTime(dateIso)}` : '—',
    rawDate: dateIso ? dateIso.slice(0, 10) : '',
    previsao: '—',
    avaliacao: null,
    status: mapPreparadorStatus(e.status),
  };
}

export async function fetchPreparadorEditDetail(id: string): Promise<PreparadorEditDetail | null> {
  if (!isSupabaseConfigured) return null;

  const { data: er, error } = await supabase
    .from('excursion_requests')
    .select(`
      id, user_id, destination, excursion_date, people_count, fleet_type, observations, status,
      total_amount_cents, scheduled_departure_at, scheduled_return_at, preparer_id, driver_id, vehicle_details, budget_lines, assignment_notes,
      stripe_payment_intent_id, worker_payout_cents, preparer_payout_cents, worker_earning_cents, admin_earning_cents,
      excursion_passengers ( id, full_name, cpf, phone, observations, status_departure, status_return, absence_justified, age )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !er) return null;

  const row = er as any;
  const passengersRaw = row.excursion_passengers as any[] | null;
  const passengers: PreparadorEditPassenger[] = (passengersRaw ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name ?? '',
    cpf: p.cpf ?? null,
    phone: p.phone ?? null,
    observations: p.observations ?? null,
    statusDeparture: (p.status_departure ?? null) as PreparadorEditPassenger['statusDeparture'],
    statusReturn: p.status_return ?? null,
    absenceJustified: p.absence_justified === true,
    age: typeof p.age === 'number' ? p.age : null,
  }));

  const [{ data: clientProf }, { data: prepProf }, { data: worker }, { data: vehs }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, cpf, city, state').eq('id', row.user_id).maybeSingle(),
    row.preparer_id
      ? supabase.from('profiles').select('full_name, phone, cpf, city, state, avatar_url, rating').eq('id', row.preparer_id).maybeSingle()
      : Promise.resolve({ data: null } as const),
    row.preparer_id
      ? sb.from('worker_profiles').select('cpf, age, experience_years, bank_code, bank_agency, bank_account, pix_key, subtype').eq('id', row.preparer_id).maybeSingle()
      : Promise.resolve({ data: null } as const),
    row.preparer_id
      ? sb.from('vehicles').select('id, year, model, plate, passenger_capacity').eq('worker_id', row.preparer_id).eq('is_active', true).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] } as const),
  ]);

  const cp = clientProf as any;
  const pp = prepProf as any;
  const wk = worker as any;
  const vehiclesList = (vehs as any[]) ?? [];

  const workerPayout = row.worker_payout_cents != null ? Number(row.worker_payout_cents) : null;
  const preparerPayout = row.preparer_payout_cents != null ? Number(row.preparer_payout_cents) : null;
  const driverPayout =
    workerPayout != null && preparerPayout != null ? Math.max(0, workerPayout - preparerPayout) : null;

  return {
    id: row.id,
    userId: row.user_id,
    destination: row.destination ?? '',
    excursionDate: row.excursion_date ?? '',
    scheduledDepartureAt: row.scheduled_departure_at ?? null,
    scheduledReturnAt: row.scheduled_return_at ?? null,
    peopleCount: row.people_count ?? 1,
    fleetType: row.fleet_type ?? 'carro',
    observations: row.observations ?? null,
    statusRaw: row.status ?? 'pending',
    statusLabel: mapPreparadorStatus(row.status as ExcursionDbStatus),
    totalAmountCents: row.total_amount_cents ?? null,
    preparerId: row.preparer_id ?? null,
    vehicleDetails: asRecord(row.vehicle_details),
    budgetLines: Array.isArray(row.budget_lines) ? row.budget_lines : [],
    assignmentNotes: asRecord(row.assignment_notes),
    clientNome: cp?.full_name ?? null,
    clientCity: cp?.city ?? null,
    clientState: cp?.state ?? null,
    clientCpf: cp?.cpf ?? null,
    clientPhone: cp?.phone ?? null,
    passengers,
    preparerProfile: row.preparer_id
      ? {
          fullName: pp?.full_name ?? null,
          phone: pp?.phone ?? null,
          cpf: pp?.cpf ?? null,
          city: pp?.city ?? null,
          state: pp?.state ?? null,
          avatarUrl: pp?.avatar_url ?? null,
          rating: pp?.rating != null ? Number(pp.rating) : null,
        }
      : null,
    preparerWorker: row.preparer_id && wk
      ? {
          cpf: wk.cpf ?? null,
          age: wk.age ?? null,
          experienceYears: wk.experience_years ?? null,
          bankCode: wk.bank_code ?? null,
          bankAgency: wk.bank_agency ?? null,
          bankAccount: wk.bank_account ?? null,
          pixKey: wk.pix_key ?? null,
          subtype: wk.subtype ?? null,
        }
      : null,
    vehicles: vehiclesList.map((v) => ({
      id: v.id,
      year: v.year ?? null,
      model: v.model ?? null,
      plate: v.plate ?? null,
      passengerCapacity: v.passenger_capacity ?? null,
    })),
    driverId: row.driver_id ?? null,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? null,
    preparerPayoutCents: preparerPayout,
    driverPayoutCents: driverPayout,
    workerPayoutCents: workerPayout,
    platformFeeCents:
      row.admin_earning_cents != null ? Number(row.admin_earning_cents) : null,
  };
}

export async function fetchPreparadorCandidates(): Promise<PreparadorCandidate[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await sb
    .from('worker_profiles')
    .select('id, subtype, profiles ( full_name, avatar_url, rating )')
    .in('subtype', ['excursions', 'shipments'])
    .neq('status', 'inactive')
    .order('created_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];

  return (data as any[]).map((w) => {
    const p = w.profiles;
    const badge: 'takeme' | 'parceiro' = w.subtype === 'partner' ? 'parceiro' : 'takeme';
    return {
      id: w.id,
      nome: p?.full_name ?? 'Preparador',
      rating: p?.rating != null ? Number(p.rating) : null,
      avatarUrl: p?.avatar_url ?? null,
      subtype: w.subtype ?? '',
      badge,
      valorKm: '—',
      valorFixo: '—',
    };
  });
}

export async function fetchExcursionStatusHistory(excursionId: string): Promise<ExcursionStatusHistoryRow[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await sb
    .from('status_history')
    .select('status, changed_at')
    .eq('entity_type', 'excursion')
    .eq('entity_id', excursionId)
    .order('changed_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];
  return (data as any[]).map((r) => ({ status: r.status, changedAt: r.changed_at }));
}

export async function savePreparadorExcursionFields(
  excursionId: string,
  fields: {
    destination?: string;
    scheduled_departure_at?: string | null;
    observations?: string | null;
    fleet_type?: string;
    preparer_id?: string | null;
    vehicle_details?: Record<string, unknown> | null;
    assignment_notes?: Record<string, unknown> | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await (supabase.from('excursion_requests') as any).update(fields).eq('id', excursionId);
  return { error: error ? (error as Error).message : null };
}

export async function saveProfileFields(
  profileId: string,
  fields: {
    full_name?: string;
    cpf?: string | null;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await (supabase.from('profiles') as any).update(fields).eq('id', profileId);
  return { error: error ? (error as Error).message : null };
}

export async function saveWorkerProfileFields(
  workerId: string,
  fields: {
    cpf?: string | null;
    age?: number | null;
    experience_years?: number | null;
    city?: string | null;
    has_own_vehicle?: boolean;
    bank_code?: string | null;
    bank_agency?: string | null;
    bank_account?: string | null;
    pix_key?: string | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await sb
    .from('worker_profiles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', workerId);
  return { error: error ? (error as Error).message : null };
}

export async function saveVehicleFields(
  vehicleId: string,
  fields: { year?: number | null; model?: string | null; plate?: string | null },
): Promise<{ error: string | null }> {
  const { error } = await sb.from('vehicles').update(fields).eq('id', vehicleId);
  return { error: error ? (error as Error).message : null };
}

// ── Worker status management (approve/reject/suspend) ───────────────

export async function updateWorkerStatus(
  workerId: string,
  status: 'approved' | 'rejected' | 'suspended' | 'pending',
  opts?: { rejection_reason?: string },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { data: { user } } = await supabase.auth.getUser();
  const updateFields: any = {
    status,
    reviewed_by: user?.id ?? null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (opts?.rejection_reason) updateFields.rejection_reason = opts.rejection_reason;
  const { error } = await sb.from('worker_profiles').update(updateFields).eq('id', workerId);
  return { error: error ? (error as Error).message : null };
}

export async function updateVehicleStatus(
  vehicleId: string,
  status: 'approved' | 'rejected' | 'pending',
  opts?: { rejection_reason?: string },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const updateFields: any = {
    status,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (opts?.rejection_reason) updateFields.rejection_reason = opts.rejection_reason;
  const { error } = await sb.from('vehicles').update(updateFields).eq('id', vehicleId);
  return { error: error ? (error as Error).message : null };
}

// ── Shipment/Booking status management ──────────────────────────────

export async function updateBookingStatus(
  bookingId: string,
  status: 'confirmed' | 'paid' | 'cancelled',
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const updateFields: any = { status, updated_at: new Date().toISOString() };
  if (status === 'paid') updateFields.paid_at = new Date().toISOString();
  const { error } = await (supabase.from('bookings') as any).update(updateFields).eq('id', bookingId);
  return { error: error ? (error as Error).message : null };
}

export async function updateShipmentStatus(
  shipmentId: string,
  status: 'confirmed' | 'in_progress' | 'delivered' | 'cancelled',
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const updateFields: any = { status };
  if (status === 'delivered') updateFields.delivered_at = new Date().toISOString();
  const { error } = await (supabase.from('shipments') as any).update(updateFields).eq('id', shipmentId);
  return { error: error ? (error as Error).message : null };
}

export async function updateDependentShipmentStatus(
  id: string,
  status: 'confirmed' | 'in_progress' | 'delivered' | 'cancelled',
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const updateFields: any = { status };
  if (status === 'delivered') updateFields.delivered_at = new Date().toISOString();
  const { error } = await (supabase.from('dependent_shipments') as any).update(updateFields).eq('id', id);
  return { error: error ? (error as Error).message : null };
}

// ── Passageiro/Dependente management ────────────────────────────────

export async function updateProfileVerified(
  profileId: string,
  verified: boolean,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await (supabase.from('profiles') as any)
    .update({ verified, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  return { error: error ? (error as Error).message : null };
}

export async function updateDependentStatus(
  dependentId: string,
  status: 'pending' | 'validated',
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await (supabase.from('dependents') as any)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', dependentId);
  return { error: error ? (error as Error).message : null };
}

export async function fetchDependentsByUser(userId: string): Promise<any[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('dependents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Excursion status management ─────────────────────────────────────

export async function updateExcursionStatus(
  excursionId: string,
  status: string,
  opts?: { driver_id?: string; preparer_id?: string },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const updateFields: any = { status };
  if (opts?.driver_id) updateFields.driver_id = opts.driver_id;
  if (opts?.preparer_id) updateFields.preparer_id = opts.preparer_id;
  if (status === 'approved') updateFields.confirmed_at = new Date().toISOString();
  const { error } = await (supabase.from('excursion_requests') as any).update(updateFields).eq('id', excursionId);
  return { error: error ? (error as Error).message : null };
}

// ── TakeMe Routes CRUD ──────────────────────────────────────────────

export async function fetchTakemeRoutes(): Promise<any[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await sb
    .from('takeme_routes')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function createTakemeRoute(route: {
  origin_address: string;
  destination_address: string;
  price_per_person_cents: number;
  is_active?: boolean;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
}): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await sb.from('takeme_routes').insert(route);
  return { error: error ? (error as Error).message : null };
}

export async function updateTakemeRoute(
  id: string,
  fields: {
    origin_address?: string;
    destination_address?: string;
    price_per_person_cents?: number;
    is_active?: boolean;
    origin_lat?: number | null;
    origin_lng?: number | null;
    destination_lat?: number | null;
    destination_lng?: number | null;
  },
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await sb.from('takeme_routes').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  return { error: error ? (error as Error).message : null };
}

export async function deleteTakemeRoute(id: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase not configured' };
  const { error } = await sb.from('takeme_routes').delete().eq('id', id);
  return { error: error ? (error as Error).message : null };
}

// ── Home dashboard counts ───────────────────────────────────────────────

export interface HomeCounts {
  viagens: ViagemCounts;
  encomendas: EncomendaCounts;
}

export async function fetchHomeCounts(): Promise<HomeCounts> {
  const [viagens, encomendas] = await Promise.all([
    fetchViagemCounts(),
    fetchEncomendaCounts(),
  ]);
  return { viagens, encomendas };
}

// ── Promotions ──────────────────────────────────────────────────────

function mapTargetAudience(audiences: string[]): string {
  const map: Record<string, string> = {
    drivers: 'Motorista', passengers: 'Passageiro',
    preparers_shipments: 'Prep. Encomendas', preparers_excursions: 'Prep. Excursões',
  };
  return audiences.map((a) => map[a] || a).join(', ');
}

function mapAppliesTo(applies: string[]): string {
  const map: Record<string, string> = {
    bookings: 'Viagens', shipments: 'Encomendas',
    dependent_shipments: 'Dependentes', excursions: 'Excursões',
  };
  return applies.map((a) => map[a] || a).join(', ');
}

export async function fetchPromocoes(): Promise<PromocaoListItem[]> {
  const { data, error } = await sb
    .from('promotions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((p: any) => ({
    id: p.id,
    nome: p.title,
    descricao: p.description || '',
    dataInicio: fmtDate(p.start_at),
    dataTermino: fmtDate(p.end_at),
    startAtIso: p.start_at ?? '',
    endAtIso: p.end_at ?? '',
    tipoPublico: mapTargetAudience(p.target_audiences || []),
    tipoDesconto: p.discount_type === 'percentage' ? 'Percentual' : 'Fixo',
    valorDesconto: p.discount_value,
    aplicaA: mapAppliesTo(p.applies_to || []),
    status: p.is_active ? 'Ativo' as const : 'Inativo' as const,
    rawTargetAudiences: Array.isArray(p.target_audiences) ? p.target_audiences : [],
    rawAppliesTo: Array.isArray(p.applies_to) ? p.applies_to : [],
    rawDiscountType: p.discount_type === 'fixed' ? 'fixed' : 'percentage',
    rawDiscountPctToPassenger: Number(p.discount_pct_to_passenger ?? 0),
    rawGainPctToWorker: Number(p.gain_pct_to_worker ?? 0),
    rawWorkerRouteId: p.worker_route_id ?? null,
    rawPricingRouteId: p.pricing_route_id ?? null,
    rawOriginCity: p.origin_city ?? null,
  }));
}

export interface PromocaoCounts { total: number; ativas: number; inativas: number; }
export async function fetchPromocaoCounts(): Promise<PromocaoCounts> {
  const items = await fetchPromocoes();
  return {
    total: items.length,
    ativas: items.filter((i) => i.status === 'Ativo').length,
    inativas: items.filter((i) => i.status === 'Inativo').length,
  };
}

// ── Pagamentos / Payouts ────────────────────────────────────────────

function mapPayoutStatus(s: string): PagamentoListItem['status'] {
  if (s === 'paid') return 'Concluído';
  if (s === 'processing') return 'Em andamento';
  if (s === 'failed') return 'Cancelado';
  return 'Agendado';
}

function mapEntityType(t: string): string {
  const map: Record<string, string> = {
    booking: 'Viagem', shipment: 'Encomenda',
    dependent_shipment: 'Dependente', excursion: 'Excursão',
  };
  return map[t] || t;
}

/** Colunas de transfer na tabela `payouts` variam entre deploys; normaliza a partir da linha crua. */
function payoutStripeTransferFields(p: Record<string, unknown>): {
  stripeTransferId: string | null;
  stripeTransferAt: string | null;
  stripeTransferError: string | null;
} {
  const str = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };
  const stripeTransferId =
    str(p.stripe_transfer_id) ??
    str(p.stripe_connect_transfer_id) ??
    str(p.connect_transfer_id);
  const stripeTransferAt =
    str(p.stripe_transfer_created_at) ??
    str(p.stripe_transfer_at) ??
    str(p.transfer_created_at);
  const stripeTransferError =
    str(p.stripe_transfer_error) ??
    str(p.stripe_transfer_last_error) ??
    str(p.transfer_error);
  return { stripeTransferId, stripeTransferAt, stripeTransferError };
}

function workerHasConnectFromProfile(w: Record<string, unknown> | undefined): boolean {
  if (!w) return false;
  const accountId = String(w.stripe_connect_account_id ?? '').trim();
  const chargesEnabled = Boolean(w.stripe_connect_charges_enabled);
  const payoutsEnabled = Boolean(w.stripe_connect_payouts_enabled);
  return Boolean(accountId && chargesEnabled && payoutsEnabled);
}

/** Resposta da edge `process-payouts` (dry-run e execução), alinhada a PagamentosScreen. */
export interface ProcessPayoutsResult {
  stripe_connect_transfers_created: number;
  stripe_connect_transfers_failed?: number;
  stripe_connect_auto_paid: number;
  manual_pix_processing: number;
  manual_pix_paid?: number;
  below_threshold_skipped?: number;
}

export async function runProcessPayoutsDryRun(
  payoutIds: string[],
): Promise<{ data: { processed: ProcessPayoutsResult } | null; error: string | null }> {
  if (!isSupabaseConfigured) return { data: null, error: 'Supabase não configurado' };
  return invokeEdgeFunction<{ processed: ProcessPayoutsResult }>('process-payouts', 'POST', undefined, {
    payout_ids: payoutIds,
    dry_run: true,
  });
}

export async function runProcessPayouts(
  payoutIds: string[],
  opts?: { mark_paid?: boolean; receipt_url?: string; force?: boolean },
): Promise<{ data: { ok: boolean; processed?: ProcessPayoutsResult } | null; error: string | null }> {
  if (!isSupabaseConfigured) return { data: null, error: 'Supabase não configurado' };
  return invokeEdgeFunction<{ ok: boolean; processed?: ProcessPayoutsResult }>('process-payouts', 'POST', undefined, {
    payout_ids: payoutIds,
    dry_run: false,
    mark_paid: opts?.mark_paid,
    receipt_url: opts?.receipt_url,
    force: opts?.force,
  });
}

export async function fetchPagamentos(): Promise<PagamentoListItem[]> {
  const { data, error } = await sb
    .from('payouts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  const payoutRows = data as Record<string, unknown>[];
  const workerIds: string[] = [...new Set(payoutRows.map((p) => String(p.worker_id ?? '')).filter(Boolean))];

  const nameMap: Record<string, string> = {};
  const connectMap = new Map<string, boolean>();
  if (workerIds.length > 0) {
    const { data: workers } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', workerIds);
    (workers || []).forEach((w: any) => { nameMap[w.id] = w.full_name || 'Sem nome'; });

    const { data: wprofiles } = await sb
      .from('worker_profiles')
      .select('id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled')
      .in('id', workerIds);
    for (const wp of wprofiles || []) {
      connectMap.set(String((wp as any).id), workerHasConnectFromProfile(wp as Record<string, unknown>));
    }
  }

  return payoutRows.map((p: Record<string, unknown>) => {
    const wid = String(p.worker_id ?? '');
    const transfer = payoutStripeTransferFields(p);
    return {
      id: String(p.id ?? ''),
      workerId: wid,
      workerHasConnect: connectMap.get(wid) ?? false,
      workerName: nameMap[wid] || 'Sem nome',
      entityType: mapEntityType(String(p.entity_type ?? '')),
      entityTypeRaw: String(p.entity_type ?? ''),
      statusRaw: String(p.status ?? ''),
      stripeTransferId: transfer.stripeTransferId,
      stripeTransferAt: transfer.stripeTransferAt,
      stripeTransferError: transfer.stripeTransferError,
      dataFinalizacao: p.paid_at ? fmtDate(String(p.paid_at)) : fmtDate(String(p.created_at ?? '')),
      dateAtIso: String(p.paid_at || p.created_at || ''),
      status: mapPayoutStatus(String(p.status ?? '')),
      grossAmountCents: Number(p.gross_amount_cents ?? 0),
      workerAmountCents: Number(p.worker_amount_cents ?? 0),
      adminAmountCents: Number(p.admin_amount_cents ?? 0),
    };
  });
}

export interface PagamentoCountsByCategory {
  all: PagamentoCounts;
  passageiros: PagamentoCounts;
  encomendas: PagamentoCounts;
  /** Totais para o gráfico (inclui pending + paid) */
  chartAll: PayoutTotals;
  chartPassageiros: PayoutTotals;
  chartEncomendas: PayoutTotals;
}

export interface PayoutTotals {
  grossCents: number;
  adminCents: number;
  workerCents: number;
}

function sumPayouts(rows: any[]): PagamentoCounts {
  const pending = rows.filter((p: any) => p.status === 'pending' || p.status === 'processing');
  const paid = rows.filter((p: any) => p.status === 'paid');
  return {
    pagamentosPrevistos: pending.reduce((s: number, p: any) => s + (p.gross_amount_cents || 0), 0),
    pagamentosFeitos: paid.reduce((s: number, p: any) => s + (p.gross_amount_cents || 0), 0),
    lucro: paid.reduce((s: number, p: any) => s + (p.admin_amount_cents || 0), 0),
  };
}

function sumPayoutTotals(rows: any[]): PayoutTotals {
  return {
    grossCents: rows.reduce((s: number, p: any) => s + (p.gross_amount_cents || 0), 0),
    adminCents: rows.reduce((s: number, p: any) => s + (p.admin_amount_cents || 0), 0),
    workerCents: rows.reduce((s: number, p: any) => s + (p.worker_amount_cents || 0), 0),
  };
}

export async function fetchPagamentoCounts(): Promise<PagamentoCounts> {
  const res = await fetchPagamentoCountsByCategory();
  return res.all;
}

export async function fetchPagamentoCountsByCategory(): Promise<PagamentoCountsByCategory> {
  const { data, error } = await sb
    .from('payouts')
    .select('status, gross_amount_cents, admin_amount_cents, worker_amount_cents, entity_type');

  if (error || !data) {
    const zero = { pagamentosPrevistos: 0, pagamentosFeitos: 0, lucro: 0 };
    const zeroChart = { grossCents: 0, adminCents: 0, workerCents: 0 };
    return { all: zero, passageiros: zero, encomendas: zero, chartAll: zeroChart, chartPassageiros: zeroChart, chartEncomendas: zeroChart };
  }

  const passageiros = data.filter((p: any) => p.entity_type === 'booking' || p.entity_type === 'excursion');
  const encomendas = data.filter((p: any) => p.entity_type === 'shipment' || p.entity_type === 'dependent_shipment');

  return {
    all: sumPayouts(data),
    passageiros: sumPayouts(passageiros),
    encomendas: sumPayouts(encomendas),
    chartAll: sumPayoutTotals(data),
    chartPassageiros: sumPayoutTotals(passageiros),
    chartEncomendas: sumPayoutTotals(encomendas),
  };
}

// ── Pricing Routes ──────────────────────────────────────────────────

export async function fetchPricingRoutes(roleType?: string): Promise<PricingRouteRow[]> {
  let query = sb
    .from('pricing_routes')
    .select('*')
    .order('created_at', { ascending: false });

  if (roleType) query = query.eq('role_type', roleType);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as PricingRouteRow[];
}

export async function fetchSurchargeCatalog(): Promise<SurchargeCatalogRow[]> {
  const { data, error } = await sb
    .from('surcharge_catalog')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error || !data) return [];
  return data as SurchargeCatalogRow[];
}

// ── Payment Methods (read-only) ─────────────────────────────────────

export async function fetchPassageiroPaymentMethods(userId: string): Promise<PaymentMethodRow[]> {
  const { data, error } = await sb
    .from('payment_methods')
    .select('id, user_id, type, last_four, brand, holder_name, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as PaymentMethodRow[];
}

/** Cadastro pelo admin: grava só last_four e metadados (sem número completo nem CVV). Requer RLS admin. */
export async function insertPassengerPaymentMethodAdmin(params: {
  userId: string;
  type: 'credit' | 'debit';
  holderName: string;
  lastFour: string;
  brand: string | null;
  expiryMonth: number;
  expiryYear: number;
}): Promise<{ error: string | null }> {
  const last = params.lastFour.replace(/\D/g, '').slice(-4);
  if (last.length !== 4) return { error: 'Últimos 4 dígitos inválidos.' };

  const { error } = await sb.from('payment_methods').insert({
    user_id: params.userId,
    type: params.type,
    holder_name: params.holderName.trim() || null,
    last_four: last,
    brand: params.brand,
    expiry_month: params.expiryMonth,
    expiry_year: params.expiryYear,
    provider: null,
    provider_id: null,
  });

  if (error) {
    const msg = error.message || 'Não foi possível salvar o cartão.';
    if (/row-level security|rls|violates/i.test(msg)) {
      return { error: 'Sem permissão para cadastrar cartão (confira se o usuário é admin no Supabase).' };
    }
    return { error: msg };
  }
  return { error: null };
}

// ── Passageiro Bookings (for detail screen) ─────────────────────────

export async function fetchPassageiroBookings(userId: string): Promise<ViagemListItem[]> {
  return fetchBookingsForPassengerUser(userId);
}

export interface PassageiroEncomendaItem {
  id: string;
  tipo: 'shipment' | 'dependent_shipment';
  origem: string;
  destino: string;
  status: string;
  amountCents: number;
  packageSize: string;
  createdAt: string;
}

export async function fetchPassageiroEncomendas(userId: string): Promise<PassageiroEncomendaItem[]> {
  const [shipRes, depRes] = await Promise.all([
    sb.from('shipments')
      .select('id, origin_address, destination_address, status, amount_cents, package_size, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    sb.from('dependent_shipments')
      .select('id, origin_address, destination_address, status, amount_cents, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const ships: PassageiroEncomendaItem[] = (shipRes.data ?? []).map((s: any) => ({
    id: s.id, tipo: 'shipment' as const,
    origem: shortAddr(s.origin_address), destino: shortAddr(s.destination_address),
    status: String(s.status ?? ''), amountCents: s.amount_cents ?? 0,
    packageSize: s.package_size ?? '—', createdAt: s.created_at ?? '',
  }));
  const deps: PassageiroEncomendaItem[] = (depRes.data ?? []).map((d: any) => ({
    id: d.id, tipo: 'dependent_shipment' as const,
    origem: shortAddr(d.origin_address), destino: shortAddr(d.destination_address),
    status: String(d.status ?? ''), amountCents: d.amount_cents ?? 0,
    packageSize: '—', createdAt: d.created_at ?? '',
  }));
  return [...ships, ...deps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Atendimento / conversas de suporte ───────────────────────────────

export interface SupportConversationDetail {
  id: string;
  client_id: string;
  status: string;
  category: string | null;
  admin_id: string | null;
  booking_id: string | null;
  shipment_id: string | null;
  context: Record<string, unknown>;
  conversation_kind: string | null;
  participant_name: string | null;
  created_at: string;
  sla_deadline_at: string | null;
  finish_note: string | null;
}

export async function fetchSupportConversationDetail(conversationId: string): Promise<SupportConversationDetail | null> {
  const { data, error } = await sb
    .from('conversations')
    .select(
      'id, client_id, status, category, admin_id, booking_id, shipment_id, context, conversation_kind, participant_name, created_at, sla_deadline_at, finish_note',
    )
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as any;
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    status: String(row.status),
    category: row.category ?? null,
    admin_id: row.admin_id ? String(row.admin_id) : null,
    booking_id: row.booking_id ? String(row.booking_id) : null,
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
    context: (row.context && typeof row.context === 'object' ? row.context : {}) as Record<string, unknown>,
    conversation_kind: row.conversation_kind ?? null,
    participant_name: row.participant_name ?? null,
    created_at: row.created_at,
    sla_deadline_at: row.sla_deadline_at ?? null,
    finish_note: row.finish_note ?? null,
  };
}

/** Admin: reutiliza ticket ativo ou cria novo (`admin_open_support_ticket_for_entity`). */
export async function adminOpenSupportTicketForEntity(params: {
  bookingId?: string | null;
  shipmentId?: string | null;
  /** Envio dependente: RPC grava `context.dependent_shipment_id`. */
  dependentShipmentId?: string | null;
  category?: string | null;
  context?: Record<string, unknown>;
}): Promise<{ conversationId: string | null; error: string | null }> {
  if (!isSupabaseConfigured) return { conversationId: null, error: 'Supabase não configurado.' };
  const { bookingId, shipmentId, dependentShipmentId, category, context } = params;
  const hasB = bookingId != null && String(bookingId).trim() !== '';
  const hasS = shipmentId != null && String(shipmentId).trim() !== '';
  const hasD = dependentShipmentId != null && String(dependentShipmentId).trim() !== '';
  const n = (hasB ? 1 : 0) + (hasS ? 1 : 0) + (hasD ? 1 : 0);
  if (n !== 1) {
    return {
      conversationId: null,
      error: n === 0 ? 'É necessário reserva, envio ou envio dependente.' : 'Indique apenas uma entidade por pedido.',
    };
  }

  const { data, error } = await sb.rpc('admin_open_support_ticket_for_entity', {
    p_booking_id: hasB ? String(bookingId).trim() : null,
    p_shipment_id: hasS ? String(shipmentId).trim() : null,
    p_category: category ?? null,
    p_context: context ?? {},
    p_dependent_shipment_id: hasD ? String(dependentShipmentId).trim() : null,
  });

  if (error) return { conversationId: null, error: error.message || 'Erro ao criar ticket.' };
  const raw = data as string | null | undefined;
  const id = raw != null ? String(raw).trim() : '';
  if (!id) return { conversationId: null, error: 'Resposta inesperada do servidor.' };
  return { conversationId: id, error: null };
}

export interface SupportHistoryItem {
  id: string;
  titulo: string;
  data: string;
  atendente: string;
  desc: string;
  desc2: string;
}

export async function fetchSupportHistoryForClient(
  clientId: string,
  excludeConversationId: string,
): Promise<SupportHistoryItem[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data, error } = await sb
    .from('conversations')
    .select('id, category, created_at, updated_at, status, finish_note, admin_id, last_message, participant_name')
    .eq('conversation_kind', 'support_backoffice')
    .eq('client_id', clientId)
    .neq('id', excludeConversationId)
    .gte('created_at', since.toISOString())
    .order('updated_at', { ascending: false })
    .limit(30);
  if (error || !data?.length) return [];

  const adminIds = [...new Set((data as any[]).map((r) => r.admin_id).filter(Boolean))] as string[];
  let adminNames: Record<string, string> = {};
  if (adminIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', adminIds);
    (profs || []).forEach((p: any) => { adminNames[p.id] = p.full_name || '—'; });
  }

  const catLabel: Record<string, string> = {
    excursao: 'Excursão',
    encomendas: 'Encomendas',
    reembolso: 'Reembolso',
    cadastro_transporte: 'Cadastro de transporte',
    autorizar_menores: 'Autorizar menores',
    denuncia: 'Denúncia',
    ouvidoria: 'Ouvidoria',
    outros: 'Outros',
  };

  return (data as any[]).map((r) => {
    const shortId = String(r.id).replace(/-/g, '').slice(0, 8).toUpperCase();
    const cat = catLabel[r.category] || r.category || 'Atendimento';
    const closed = String(r.status) === 'closed';
    const preview = typeof r.finish_note === 'string' && r.finish_note.trim()
      ? r.finish_note.trim()
      : typeof r.last_message === 'string' && r.last_message.trim()
        ? r.last_message.trim()
        : closed
          ? 'Atendimento encerrado.'
          : 'Solicitação em andamento.';
    return {
      id: String(r.id),
      titulo: `${cat} · #${shortId}`,
      data: fmtDate(r.updated_at || r.created_at),
      atendente: r.admin_id ? (adminNames[r.admin_id] || '—') : '—',
      desc: preview.length > 220 ? `${preview.slice(0, 220)}…` : preview,
      desc2: closed ? 'Encerrado' : 'Em aberto',
    };
  });
}

export async function fetchProfileBasics(userId: string): Promise<{ full_name: string | null; email_hint: string | null }> {
  const { data } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return { full_name: (data as any)?.full_name ?? null, email_hint: null };
}


export async function fetchAdminUsers(): Promise<AdminUserListItem[]> {
  const { data, error } = await sb
    .from('worker_profiles')
    .select('id, role, subtype, status, created_at')
    .eq('role', 'admin');

  if (error || !data) return [];

  const adminIds = data.map((a: any) => a.id);
  if (adminIds.length === 0) return [];

  // Fetch profiles for names
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', adminIds);

  const nameMap: Record<string, string> = {};
  (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Sem nome'; });

  // Fetch permissions from user_preferences
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('user_id, value')
    .in('user_id', adminIds)
    .eq('key', 'admin_permissions');

  const permMap: Record<string, Record<string, boolean>> = {};
  (prefs || []).forEach((p: any) => { permMap[p.user_id] = p.value || {}; });

  const nivelLabel = (sub: string | undefined) => {
    if (sub === 'admin') return 'Administrador';
    if (sub === 'suporte') return 'Suporte';
    if (sub === 'financeiro') return 'Financeiro';
    return sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : '—';
  };

  return data.map((a: any) => ({
    id: a.id,
    nome: nameMap[a.id] || 'Sem nome',
    email: '', // email is in auth.users, not accessible via client
    nivel: nivelLabel(a.subtype),
    dataCriacao: fmtDate(a.created_at),
    status: a.status === 'approved' ? 'Ativo' as const : 'Inativo' as const,
    permissions: permMap[a.id] || {},
    subtype: a.subtype as string | undefined,
  }));
}

// ── Worker Ratings (for PagamentosGestao Avaliações tab) ────────────

export interface RatingListItem {
  id: string;
  workerName: string;
  ratedByName: string;
  entityType: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export async function fetchWorkerRatings(): Promise<RatingListItem[]> {
  const { data: bookingRatings } = await supabase
    .from('booking_ratings')
    .select('id, booking_id, rating, comment, created_at, user_id')
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: shipmentRatings } = await supabase
    .from('shipment_ratings')
    .select('id, shipment_id, rating, comment, created_at, user_id')
    .order('created_at', { ascending: false })
    .limit(50);

  const all = [
    ...(bookingRatings || []).map((r: any) => ({ ...r, entityType: 'Viagem' })),
    ...(shipmentRatings || []).map((r: any) => ({ ...r, entityType: 'Encomenda' })),
  ];

  // Get user names
  const userIds = [...new Set(all.map((r) => r.user_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
  const nameMap: Record<string, string> = {};
  (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Anônimo'; });

  return all.map((r) => ({
    id: r.id,
    workerName: '—',
    ratedByName: nameMap[r.user_id] || 'Anônimo',
    entityType: r.entityType,
    rating: r.rating,
    comment: r.comment || '',
    createdAt: fmtDate(r.created_at),
  }));
}

// ── Bases (centros de recebimento de encomendas) ──────────────────────

export type BaseListItem = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  createdAt: string;
};

export async function fetchBases(): Promise<BaseListItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await sb
    .from('bases')
    .select('id, name, address, city, state, lat, lng, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((b: any) => ({
    id: b.id,
    name: b.name,
    address: b.address,
    city: b.city,
    state: b.state ?? '',
    lat: b.lat,
    lng: b.lng,
    isActive: b.is_active,
    createdAt: fmtDate(b.created_at),
  }));
}

export type CreateBaseInput = {
  name: string;
  address: string;
  city: string;
  state: string;
  lat?: number;
  lng?: number;
};

export async function createBase(input: CreateBaseInput): Promise<BaseListItem | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await sb
    .from('bases')
    .insert({
      name: input.name,
      address: input.address,
      city: input.city,
      state: input.state,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    })
    .select()
    .single();

  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    address: data.address,
    city: data.city,
    state: data.state ?? '',
    lat: data.lat,
    lng: data.lng,
    isActive: data.is_active,
    createdAt: fmtDate(data.created_at),
  };
}

// ══════════════════════════════════════════════════════════════════════
// Rotas Multi-Ponto e Encomenda como Viagem
// ══════════════════════════════════════════════════════════════════════

/**
 * Vincula uma encomenda a uma viagem existente e regenera os stops.
 */
export async function linkShipmentToTrip(
  shipmentId: string,
  tripId: string,
): Promise<{ error: string | null }> {
  const { error } = await sb.from('shipments').update({
    scheduled_trip_id: tripId,
  }).eq('id', shipmentId);
  if (error) return { error: error.message };

  // Regenerar stops da viagem
  await sb.rpc('generate_trip_stops', { p_trip_id: tripId });
  return { error: null };
}

/**
 * Cenario 1: Encomenda via moto/preparador — cria trip: motorista → cliente → base mais proxima
 */
export async function createShipmentTripViaBase(
  shipmentId: string,
  driverId: string,
): Promise<{ tripId: string | null; error: string | null }> {
  // Buscar dados da encomenda
  const { data: shipment } = await sb.from('shipments')
    .select('origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng')
    .eq('id', shipmentId).single();
  if (!shipment) return { tripId: null, error: 'Encomenda não encontrada' };

  // Buscar base mais proxima da origem do cliente
  const { data: bases } = await sb.rpc('nearest_active_base', {
    p_lat: shipment.origin_lat || 0,
    p_lng: shipment.origin_lng || 0,
  });
  const base = bases?.[0];

  // Buscar endereco do motorista (do perfil)
  const { data: driverProfile } = await supabase.from('profiles')
    .select('city, state').eq('id', driverId).single();

  // Criar trip: motorista → cliente → base
  const { data: trip, error: tripErr } = await sb.from('scheduled_trips').insert({
    driver_id: driverId,
    origin_address: driverProfile?.city ? `${driverProfile.city}, ${driverProfile.state || ''}` : shipment.origin_address,
    origin_lat: shipment.origin_lat,
    origin_lng: shipment.origin_lng,
    destination_address: base ? base.base_address : shipment.destination_address,
    destination_lat: base ? base.base_lat : shipment.destination_lat,
    destination_lng: base ? base.base_lng : shipment.destination_lng,
    departure_at: new Date().toISOString(),
    arrival_at: new Date(Date.now() + 3600000).toISOString(),
    seats_available: 0,
    bags_available: 1,
    badge: 'Take Me',
    status: 'active',
    is_active: true,
  }).select('id').single();

  if (tripErr || !trip) return { tripId: null, error: tripErr?.message || 'Erro ao criar viagem' };

  // Vincular encomenda à viagem
  await sb.from('shipments').update({ scheduled_trip_id: trip.id }).eq('id', shipmentId);

  // Gerar stops
  await sb.rpc('generate_trip_stops', { p_trip_id: trip.id });

  return { tripId: trip.id, error: null };
}

/**
 * Cenario 2: Encomenda via carro — cria trip: motorista → cliente → destino encomenda (direto)
 */
export async function createShipmentTripDirect(
  shipmentId: string,
  driverId: string,
): Promise<{ tripId: string | null; error: string | null }> {
  const { data: shipment } = await sb.from('shipments')
    .select('origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng')
    .eq('id', shipmentId).single();
  if (!shipment) return { tripId: null, error: 'Encomenda não encontrada' };

  const { data: driverProfile } = await supabase.from('profiles')
    .select('city, state').eq('id', driverId).single();

  const { data: trip, error: tripErr } = await sb.from('scheduled_trips').insert({
    driver_id: driverId,
    origin_address: driverProfile?.city ? `${driverProfile.city}, ${driverProfile.state || ''}` : shipment.origin_address,
    origin_lat: shipment.origin_lat,
    origin_lng: shipment.origin_lng,
    destination_address: shipment.destination_address,
    destination_lat: shipment.destination_lat,
    destination_lng: shipment.destination_lng,
    departure_at: new Date().toISOString(),
    arrival_at: new Date(Date.now() + 3600000).toISOString(),
    seats_available: 0,
    bags_available: 1,
    badge: 'Take Me',
    status: 'active',
    is_active: true,
  }).select('id').single();

  if (tripErr || !trip) return { tripId: null, error: tripErr?.message || 'Erro ao criar viagem' };

  await sb.from('shipments').update({ scheduled_trip_id: trip.id }).eq('id', shipmentId);
  await sb.rpc('generate_trip_stops', { p_trip_id: trip.id });

  return { tripId: trip.id, error: null };
}

/**
 * Recalcula stops de uma viagem (ex: após trocar motorista)
 */
export async function recalculateTripStops(tripId: string): Promise<void> {
  const { error } = await sb.rpc('generate_trip_stops', { p_trip_id: tripId });
  if (error) throw new Error(error.message || 'generate_trip_stops falhou');
}

// ── Worker Routes (admin CRUD) ──────────────────────────────────────────

export async function createWorkerRoute(
  workerId: string,
  data: {
    origin: string;
    destination: string;
    priceCents: number;
    originLat?: number | null;
    originLng?: number | null;
    destinationLat?: number | null;
    destinationLng?: number | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await (supabase as any).from('worker_routes').insert({
    worker_id: workerId,
    origin_address: data.origin,
    destination_address: data.destination,
    price_per_person_cents: data.priceCents,
    is_active: true,
    ...(data.originLat != null && data.originLng != null
      ? { origin_lat: data.originLat, origin_lng: data.originLng }
      : {}),
    ...(data.destinationLat != null && data.destinationLng != null
      ? { destination_lat: data.destinationLat, destination_lng: data.destinationLng }
      : {}),
  });
  let msg = error?.message ?? null;
  if (msg && /row-level security|violates row-level security/i.test(msg)) {
    msg =
      'Sem permissão para criar rota (RLS). Aplique as migrations do repositório (políticas admin em worker_routes) e garanta que seu usuário é admin: JWT app_metadata.role=admin no Supabase Auth ou linha em worker_profiles com role=admin (status approved, pending, inactive ou under_review). Depois faça login de novo.';
  }
  return { error: msg };
}

export async function toggleWorkerRouteActive(routeId: string, isActive: boolean): Promise<void> {
  await (supabase as any).from('worker_routes').update({ is_active: isActive }).eq('id', routeId);
}

export async function deleteWorkerRoute(routeId: string): Promise<void> {
  await (supabase as any).from('worker_routes').delete().eq('id', routeId);
}

// ── Pending Counts (for HomeScreen dashboard) ────────────────────────

export interface PendingCounts {
  pendingWorkers: number;
  pendingPayouts: number;
}

export async function fetchPendingCounts(): Promise<PendingCounts> {
  const [wRes, pRes] = await Promise.all([
    sb.from('worker_profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('payouts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  return {
    pendingWorkers: (wRes as any).count ?? 0,
    pendingPayouts: (pRes as any).count ?? 0,
  };
}

// ── Stuck Payouts Summary (for HomeScreen dashboard) ──────────────────
// View admin_shipment_payouts_stuck: payouts de shipment/excursion com
// mais de 3 dias pendentes/processing. Usada como sinal de "dinheiro
// retido" na plataforma (opcao B — charge-shipments/charge-excursion-request
// cobram centralizado; process-payouts precisa rodar para liberar via
// stripe.transfers.create).
export interface StuckPayoutsSummary {
  count: number;
  totalCents: number;
}

export async function fetchStuckPayoutsSummary(): Promise<StuckPayoutsSummary> {
  if (!isSupabaseConfigured) return { count: 0, totalCents: 0 };
  const { data, error } = await sb
    .from('admin_shipment_payouts_stuck')
    .select('worker_amount_cents')
    .limit(500);
  if (error || !data) {
    // View pode nao existir em ambientes nao migrados ainda — ignorar silenciosamente.
    console.warn('[fetchStuckPayoutsSummary] admin_shipment_payouts_stuck indisponivel:', error?.message);
    return { count: 0, totalCents: 0 };
  }
  const rows = data as Array<{ worker_amount_cents: number | null }>;
  const totalCents = rows.reduce((acc, r) => acc + (Number(r.worker_amount_cents) || 0), 0);
  return { count: rows.length, totalCents };
}

// ── Notifications (admin management) ─────────────────────────────────

export interface NotificationAdminRow {
  id: string;
  userId: string;
  userName: string;
  title: string;
  message: string | null;
  category: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function fetchAllNotifications(): Promise<NotificationAdminRow[]> {
  const { data, error } = await (supabase as any)
    .from('notifications')
    .select('id, user_id, title, message, category, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  const userIds = [...new Set((data as any[]).map((n: any) => n.user_id).filter(Boolean))] as string[];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Sem nome'; });
  }

  return (data as any[]).map((n: any) => ({
    id: n.id,
    userId: n.user_id,
    userName: nameMap[n.user_id] || 'Sem nome',
    title: n.title,
    message: n.message,
    category: n.category,
    readAt: n.read_at,
    createdAt: fmtDate(n.created_at),
  }));
}

export async function createNotificationForUser(userId: string, title: string, message: string, category?: string): Promise<{ error: string | null }> {
  const { error } = await (supabase as any).from('notifications').insert({
    user_id: userId,
    title,
    message,
    category: category || null,
  });
  return { error: error?.message ?? null };
}

export async function createNotificationBroadcast(title: string, message: string, category?: string): Promise<{ count: number; error: string | null }> {
  // Fetch all active user IDs (non-workers — passengers)
  const { data: profiles } = await supabase.from('profiles').select('id').limit(1000);
  if (!profiles || profiles.length === 0) return { count: 0, error: null };

  const rows = profiles.map((p: any) => ({
    user_id: p.id,
    title,
    message,
    category: category || 'broadcast',
  }));

  const { error } = await (supabase as any).from('notifications').insert(rows);
  return { count: rows.length, error: error?.message ?? null };
}

export async function deleteNotification(notifId: string): Promise<void> {
  await (supabase as any).from('notifications').delete().eq('id', notifId);
}

// ── Enhanced Ratings (admin moderation) ──────────────────────────────

export async function deleteRating(table: 'booking_ratings' | 'shipment_ratings', ratingId: string): Promise<void> {
  await (supabase as any).from(table).delete().eq('id', ratingId);
}

export async function fetchAllRatingsEnhanced(): Promise<(RatingListItem & { table: string; ratingId: string })[]> {
  const [bRes, sRes] = await Promise.all([
    supabase.from('booking_ratings').select('id, booking_id, rating, comment, created_at, user_id').order('created_at', { ascending: false }).limit(100),
    supabase.from('shipment_ratings').select('id, shipment_id, rating, comment, created_at, user_id').order('created_at', { ascending: false }).limit(100),
  ]);

  const all = [
    ...((bRes.data || []) as any[]).map((r: any) => ({ ...r, entityType: 'Viagem', table: 'booking_ratings' })),
    ...((sRes.data || []) as any[]).map((r: any) => ({ ...r, entityType: 'Encomenda', table: 'shipment_ratings' })),
  ];

  const userIds = [...new Set(all.map((r) => r.user_id).filter(Boolean))];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Anônimo'; });
  }

  return all
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((r) => ({
      id: r.id,
      ratingId: r.id,
      table: r.table,
      workerName: '—',
      ratedByName: nameMap[r.user_id] || 'Anônimo',
      entityType: r.entityType,
      rating: r.rating,
      comment: r.comment || '',
      createdAt: fmtDate(r.created_at),
    }));
}

// ── Analytics Dashboard ─────────────────────────────────────────────────

export interface AnalyticsData {
  totalRevenueCents: number;
  revenueByMonth: { month: string; revenue: number }[];
  tripsByMonth: { month: string; count: number }[];
  tripsByStatus: { status: string; count: number }[];
  totalUsers: number;
  newUsersByMonth: { month: string; count: number }[];
  totalDrivers: number;
  driversByStatus: { status: string; count: number }[];
  totalShipments: number;
  shipmentsByMonth: { month: string; count: number }[];
  avgRating: number;
  totalRatings: number;
}

export async function fetchAnalyticsData(): Promise<AnalyticsData> {
  if (!isSupabaseConfigured) {
    return {
      totalRevenueCents: 0, revenueByMonth: [], tripsByMonth: [], tripsByStatus: [],
      totalUsers: 0, newUsersByMonth: [], totalDrivers: 0, driversByStatus: [],
      totalShipments: 0, shipmentsByMonth: [], avgRating: 0, totalRatings: 0,
    };
  }

  const [bookingsRes, profilesRes, workersRes, shipmentsRes, bRatingsRes, sRatingsRes] = await Promise.all([
    sb.from('bookings').select('id, status, amount_cents, created_at'),
    supabase.from('profiles').select('id, created_at'),
    sb.from('worker_profiles').select('id, status, created_at'),
    sb.from('shipments').select('id, status, created_at'),
    sb.from('booking_ratings').select('id, rating, created_at'),
    sb.from('shipment_ratings').select('id, rating, created_at'),
  ]);

  const bookings: any[] = bookingsRes.data || [];
  const profiles: any[] = profilesRes.data || [];
  const workers: any[] = workersRes.data || [];
  const shipments: any[] = shipmentsRes.data || [];
  const bRatings: any[] = bRatingsRes.data || [];
  const sRatings: any[] = sRatingsRes.data || [];

  // Revenue
  const totalRevenueCents = bookings.reduce((s: number, b: any) => s + (b.amount_cents || 0), 0);
  const revenueByMonthMap: Record<string, number> = {};
  bookings.forEach((b: any) => {
    if (!b.created_at) return;
    const m = b.created_at.slice(0, 7);
    revenueByMonthMap[m] = (revenueByMonthMap[m] || 0) + (b.amount_cents || 0);
  });
  const revenueByMonth = Object.entries(revenueByMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, revenue]) => ({ month, revenue }));

  // Trips by month
  const tripsByMonthMap: Record<string, number> = {};
  bookings.forEach((b: any) => {
    if (!b.created_at) return;
    const m = b.created_at.slice(0, 7);
    tripsByMonthMap[m] = (tripsByMonthMap[m] || 0) + 1;
  });
  const tripsByMonth = Object.entries(tripsByMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, count]) => ({ month, count }));

  // Trips by status
  const tripStatusMap: Record<string, number> = {};
  bookings.forEach((b: any) => { tripStatusMap[b.status || 'unknown'] = (tripStatusMap[b.status || 'unknown'] || 0) + 1; });
  const tripsByStatus = Object.entries(tripStatusMap).map(([status, count]) => ({ status, count }));

  // Users
  const totalUsers = profiles.length;
  const newUsersByMonthMap: Record<string, number> = {};
  profiles.forEach((p: any) => {
    if (!p.created_at) return;
    const m = p.created_at.slice(0, 7);
    newUsersByMonthMap[m] = (newUsersByMonthMap[m] || 0) + 1;
  });
  const newUsersByMonth = Object.entries(newUsersByMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, count]) => ({ month, count }));

  // Drivers
  const totalDrivers = workers.length;
  const driverStatusMap: Record<string, number> = {};
  workers.forEach((w: any) => { driverStatusMap[w.status || 'unknown'] = (driverStatusMap[w.status || 'unknown'] || 0) + 1; });
  const driversByStatus = Object.entries(driverStatusMap).map(([status, count]) => ({ status, count }));

  // Shipments
  const totalShipments = shipments.length;
  const shipmentsByMonthMap: Record<string, number> = {};
  shipments.forEach((s: any) => {
    if (!s.created_at) return;
    const m = s.created_at.slice(0, 7);
    shipmentsByMonthMap[m] = (shipmentsByMonthMap[m] || 0) + 1;
  });
  const shipmentsByMonth = Object.entries(shipmentsByMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, count]) => ({ month, count }));

  // Ratings
  const allRatings = [...bRatings, ...sRatings];
  const totalRatings = allRatings.length;
  const avgRating = totalRatings > 0 ? allRatings.reduce((s: number, r: any) => s + r.rating, 0) / totalRatings : 0;

  return {
    totalRevenueCents, revenueByMonth, tripsByMonth, tripsByStatus,
    totalUsers, newUsersByMonth, totalDrivers, driversByStatus,
    totalShipments, shipmentsByMonth, avgRating, totalRatings,
  };
}
