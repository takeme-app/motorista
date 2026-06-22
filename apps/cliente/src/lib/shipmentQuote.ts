/**
 * Precificação de encomendas (cliente) — fórmula gross-up do PDF.
 *
 * Hierarquia do preço base:
 *   1) Override do preparador: worker_profiles.shipment_delivery_fee_cents / shipment_per_km_fee_cents
 *   2) Padrão global: platform_settings.shipment_base_delivery_fee_cents / km_price_cents
 *   3) Catálogo: pricing_routes (role_type='preparer_shipments' | 'driver_shipments', is_active=true)
 *
 * Adicionais automáticos (surcharge_catalog.surcharge_mode='automatic',
 * surcharge_type='encomenda') entram como `surchargesCents` e não sofrem
 * gross-up — somam-se diretamente ao admin_earning.
 *
 * Valor fixo por tamanho do pacote (somado à base por km, NÃO multiplicador):
 *   - Lido de platform_settings.shipment_package_size_prices_cents (JSON em centavos
 *     `{"pequeno":0,"medio":500,"grande":1000}`) quando disponível; senão usa 0.
 *
 * A função `computeOrderPricing` (shared) aplica gross-up literal:
 *   Total = (base + adicionais) / (1 − ganho% + desconto% − admin%)
 *
 * O passo de promoção (ganho_motorista / desconto_passageiro) é aplicado na
 * camada de edge (`charge-shipments`) após este quote, já que depende do
 * usuário autenticado. Aqui consideramos gainPct=discountPct=0.
 */

import { supabase } from './supabase';
import { getRouteWithDuration, type RoutePoint } from './route';
import {
  computeOrderPricing,
  PricingDenominatorOverflowError,
  resolvePlatformFeePct,
  type PlatformFeeServiceType,
} from '@take-me/shared';

export type PreparerShipmentPricingRoute = {
  id: string;
  origin_address: string | null;
  destination_address: string;
  pricing_mode: 'daily_rate' | 'per_km' | 'fixed';
  price_cents: number;
  admin_pct: number;
  created_at?: string;
};

/** Corte “bom” para confiar no pareamento texto↔trecho. */
const MATCH_SCORE_STRICT = 0.32;
/** Corte relaxado: ainda exige alguma sobreposição de palavras/endereço. */
const MATCH_SCORE_RELAXED = 0.12;

/**
 * Valor fixo por tamanho (em centavos), SOMADO à base por km do trecho.
 * Fallback (0) quando `platform_settings.shipment_package_size_prices_cents`
 * não estiver configurado — o admin define os valores em Configurações.
 */
const PACKAGE_SIZE_PRICE_FALLBACK_CENTS: Record<'pequeno' | 'medio' | 'grande', number> = {
  pequeno: 0,
  medio: 0,
  grande: 0,
};

/** Fallback para `default_admin_pct` quando a linha não existir — espelha o seed da plataforma. */
const DEFAULT_ADMIN_PCT_FALLBACK = 15;

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function normalizeAddr(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distância em km (Haversine). */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Pontuação 0–1: quanto o endereço do usuário combina com o trecho cadastrado.
 * Origem vazia no trecho = aceita qualquer origem (1.0).
 */
function scoreAddressMatch(
  userAddr: string,
  routeAddr: string | null | undefined,
  routePartOptional: boolean
): number {
  if (!routeAddr?.trim()) return routePartOptional ? 1 : 0.35;
  const u = normalizeAddr(userAddr);
  const r = normalizeAddr(routeAddr);
  if (!r.length) return routePartOptional ? 1 : 0.35;
  if (u === r) return 1;
  if (u.includes(r) || r.includes(u)) return 0.92;
  const uWords = new Set(u.split(/[\s,]+/).filter((w) => w.length >= 4));
  const rWords = r.split(/[\s,]+/).filter((w) => w.length >= 4);
  if (rWords.length === 0) return 0.5;
  const hits = rWords.filter((w) => uWords.has(w)).length;
  return Math.min(1, hits / rWords.length);
}

function bestScoredInList(
  routes: PreparerShipmentPricingRoute[],
  originAddress: string,
  destAddress: string
): { route: PreparerShipmentPricingRoute; score: number } | null {
  if (!routes.length) return null;
  let best: { route: PreparerShipmentPricingRoute; score: number } | null = null;
  for (const route of routes) {
    const so = scoreAddressMatch(originAddress, route.origin_address, true);
    const sd = scoreAddressMatch(destAddress, route.destination_address, false);
    const score = so * 0.42 + sd * 0.58;
    if (!best || score > best.score) best = { route, score };
  }
  return best;
}

function pickFromSubsetIfMinScore(
  routes: PreparerShipmentPricingRoute[],
  originAddress: string,
  destAddress: string,
  minScore: number
): PreparerShipmentPricingRoute | null {
  const best = bestScoredInList(routes, originAddress, destAddress);
  if (!best) return null;
  if (best.score >= minScore) return best.route;
  return null;
}

function newestRoute(subset: PreparerShipmentPricingRoute[]): PreparerShipmentPricingRoute | null {
  if (!subset.length) return null;
  const sorted = [...subset].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  return sorted[0] ?? null;
}

/**
 * Escolhe trecho priorizando `per_km`:
 * 1) match forte → 2) match fraco → 3) único trecho per_km → idem fixed → 4) per_km mais recente → 5) qualquer mais recente.
 * Evita ficar sem preço quando há catálogo mas o texto do endereço não bate 100% com o cadastro.
 */
function pickBestRoutePreferPerKm(
  routes: PreparerShipmentPricingRoute[],
  originAddress: string,
  destAddress: string
): PreparerShipmentPricingRoute | null {
  if (!routes.length) return null;
  const perKm = routes.filter((r) => r.pricing_mode === 'per_km');
  const others = routes.filter((r) => r.pricing_mode !== 'per_km');

  return (
    pickFromSubsetIfMinScore(perKm, originAddress, destAddress, MATCH_SCORE_STRICT) ??
    pickFromSubsetIfMinScore(perKm, originAddress, destAddress, MATCH_SCORE_RELAXED) ??
    (perKm.length === 1 ? perKm[0] : null) ??
    pickFromSubsetIfMinScore(others, originAddress, destAddress, MATCH_SCORE_STRICT) ??
    pickFromSubsetIfMinScore(others, originAddress, destAddress, MATCH_SCORE_RELAXED) ??
    (others.length === 1 ? others[0] : null) ??
    newestRoute(perKm) ??
    newestRoute(others) ??
    newestRoute(routes)
  );
}

/** Km para cobrança per_km: distância da rota (Mapbox/OSRM) quando existir; senão Haversine. */
async function billableKmForShipment(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<number> {
  const origin: RoutePoint = { latitude: originLat, longitude: originLng };
  const dest: RoutePoint = { latitude: destLat, longitude: destLng };
  const rt = await getRouteWithDuration(origin, dest);
  if (rt?.distanceMeters != null && Number.isFinite(rt.distanceMeters) && rt.distanceMeters > 0) {
    return Math.max(0, rt.distanceMeters / 1000);
  }
  return Math.max(0, haversineKm(originLat, originLng, destLat, destLng));
}

/**
 * Valor fixo por tamanho da ROTA (trecho de Motorista), em centavos.
 * Casa por ORIGEM/DESTINO: scheduled_trip → worker_routes(origin/destination) →
 * melhor trecho `pricing_routes` role 'driver' com mesma origem→destino (não depende
 * do vínculo de importação). Assim um trecho novo/editado vale para rotas já existentes.
 * Retorna null quando não há trecho casado ou sem override p/ o tamanho (cai no global).
 */
async function resolveRouteSizePriceCents(
  scheduledTripId: string,
  packageSize: 'pequeno' | 'medio' | 'grande',
): Promise<number | null> {
  try {
    const sb = supabase as { from: (t: string) => any };
    const { data: trip } = await sb
      .from('scheduled_trips').select('route_id').eq('id', scheduledTripId).maybeSingle();
    const routeId = trip?.route_id;
    if (!routeId) return null;
    const { data: wr } = await sb
      .from('worker_routes').select('origin_address, destination_address').eq('id', routeId).maybeSingle();
    if (!wr) return null;
    const wOrigin = String(wr.origin_address ?? '');
    const wDest = String(wr.destination_address ?? '');
    if (!wDest.trim()) return null;
    const { data: rows } = await sb
      .from('pricing_routes')
      .select('origin_address, destination_address, size_price_pequeno_cents, size_price_medio_cents, size_price_grande_cents')
      .eq('role_type', 'driver')
      .eq('is_active', true);
    if (!rows?.length) return null;
    // Melhor casamento por origem (opcional) + destino (obrigatório).
    let best: any = null;
    let bestScore = 0;
    for (const r of rows as any[]) {
      const oScore = scoreAddressMatch(wOrigin, r.origin_address, true);
      const dScore = scoreAddressMatch(wDest, r.destination_address, false);
      const score = (oScore + dScore) / 2;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best || bestScore < MATCH_SCORE_STRICT) return null;
    const col =
      packageSize === 'pequeno' ? best.size_price_pequeno_cents
        : packageSize === 'medio' ? best.size_price_medio_cents
          : best.size_price_grande_cents;
    return Number.isFinite(Number(col)) && Number(col) >= 0 ? Math.round(Number(col)) : null;
  } catch {
    return null;
  }
}

function catalogBaseCentsFixed(route: PreparerShipmentPricingRoute): number {
  return clampInt(route.price_cents);
}

async function catalogBaseCentsAsync(
  route: PreparerShipmentPricingRoute,
  km: number
): Promise<number> {
  const mode = route.pricing_mode;
  const pc = route.price_cents;
  if (mode === 'fixed' || mode === 'daily_rate') {
    return catalogBaseCentsFixed(route);
  }
  if (mode === 'per_km') {
    return clampInt(km * pc);
  }
  return clampInt(pc);
}

type PackageSizePricesCents = Record<'pequeno' | 'medio' | 'grande', number>;

type ShipmentSurcharge = {
  id: string;
  name: string;
  value_cents: number;
  surcharge_mode: 'automatic' | 'manual';
};

type PricingDefaults = {
  /** Override do preparador (se houver). */
  preparer: {
    shipment_delivery_fee_cents: number | null;
    shipment_per_km_fee_cents: number | null;
  } | null;
  /** Padrão global do admin. */
  globals: {
    km_price_cents: number | null;
    shipment_base_delivery_fee_cents: number | null;
    default_admin_pct: number | null;
    platform_fee_pct_by_service: unknown;
    package_size_prices_cents: PackageSizePricesCents;
  };
  /** Catálogo antigo (fallback). */
  routes: PreparerShipmentPricingRoute[];
  /** Adicionais automáticos aplicáveis a encomendas (qualquer papel). */
  surcharges: ShipmentSurcharge[];
  /** Tarifa da BASE da encomenda (sobrepõe o global; global vira default). */
  baseTariff: {
    mode: 'per_km' | 'fixed';
    km_price_cents: number | null;
    fixed_cents: number | null;
  } | null;
  /** Coordenadas da base (para as pernas Origem→Base e Base→Destino). */
  baseLat: number | null;
  baseLng: number | null;
};

type PlatformSettingRow = { key: string; value: unknown };
type WorkerPricingRow = {
  shipment_delivery_fee_cents: number | null;
  shipment_per_km_fee_cents: number | null;
};

function parseIntValue(raw: unknown, field = 'value'): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const n = obj[field];
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function parsePackageSizePricesCents(raw: unknown): PackageSizePricesCents {
  const fallback = PACKAGE_SIZE_PRICE_FALLBACK_CENTS;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const src = (obj.value && typeof obj.value === 'object' ? (obj.value as Record<string, unknown>) : obj);
    const p = Number(src.pequeno);
    const m = Number(src.medio);
    const g = Number(src.grande);
    if ([p, m, g].every((n) => Number.isFinite(n) && n >= 0)) {
      return { pequeno: Math.round(p), medio: Math.round(m), grande: Math.round(g) };
    }
  }
  return fallback;
}

/** Lê em paralelo: override do preparador + padrões globais + catálogo + tarifa da base. */
async function readPricingDefaults(preparerId?: string, baseId?: string | null): Promise<PricingDefaults> {
  const sb = supabase as { from: (t: string) => any };

  const settingsPromise = sb
    .from('platform_settings')
    .select('key, value')
    .in('key', [
      'km_price_cents',
      'shipment_base_delivery_fee_cents',
      'default_admin_pct',
      'platform_fee_pct_by_service',
      'shipment_package_size_prices_cents',
    ]);

  const routesPromise = sb
    .from('pricing_routes')
    .select(
      'id, origin_address, destination_address, pricing_mode, price_cents, admin_pct, role_type, is_active, created_at'
    )
    .eq('role_type', 'preparer_shipments')
    .eq('is_active', true);

  const surchargesPromise = sb
    .from('surcharge_catalog')
    .select('id, name, default_value_cents, surcharge_mode, surcharge_type, is_active')
    .eq('surcharge_type', 'encomenda')
    .eq('surcharge_mode', 'automatic')
    .eq('is_active', true);

  const preparerPromise = preparerId
    ? sb
        .from('worker_profiles')
        .select('shipment_delivery_fee_cents, shipment_per_km_fee_cents')
        .eq('id', preparerId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const basePromise = baseId
    ? sb
        .from('bases')
        .select('preparer_pricing_mode, preparer_km_price_cents, preparer_fixed_cents, lat, lng')
        .eq('id', baseId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const [settingsRes, routesRes, surchargesRes, prepRes, baseRes] = await Promise.all([
    settingsPromise,
    routesPromise,
    surchargesPromise,
    preparerPromise,
    basePromise,
  ]);

  const settingsRows = ((settingsRes.data ?? []) as PlatformSettingRow[]) || [];
  const settingMap = new Map(settingsRows.map((row) => [row.key, row.value]));

  const globals = {
    km_price_cents: parseIntValue(settingMap.get('km_price_cents')),
    shipment_base_delivery_fee_cents: parseIntValue(
      settingMap.get('shipment_base_delivery_fee_cents'),
    ),
    default_admin_pct: parseIntValue(settingMap.get('default_admin_pct'), 'percentage'),
    platform_fee_pct_by_service: settingMap.get('platform_fee_pct_by_service'),
    package_size_prices_cents: parsePackageSizePricesCents(
      settingMap.get('shipment_package_size_prices_cents'),
    ),
  };

  const routes = ((routesRes.data ?? []) as PreparerShipmentPricingRoute[]) || [];

  const surchargeRows = (surchargesRes.data ?? []) as Array<{
    id: string;
    name: string;
    default_value_cents: number | null;
    surcharge_mode: 'automatic' | 'manual';
  }>;
  const surcharges: ShipmentSurcharge[] = surchargeRows
    .filter((r) => Number.isFinite(Number(r.default_value_cents)) && Number(r.default_value_cents) > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      value_cents: Math.max(0, Math.round(Number(r.default_value_cents))),
      surcharge_mode: r.surcharge_mode,
    }));

  const prepRow = (prepRes.data ?? null) as WorkerPricingRow | null;
  const preparer = prepRow
    ? {
        shipment_delivery_fee_cents: prepRow.shipment_delivery_fee_cents ?? null,
        shipment_per_km_fee_cents: prepRow.shipment_per_km_fee_cents ?? null,
      }
    : null;

  const baseRow = (baseRes.data ?? null) as {
    preparer_pricing_mode: 'per_km' | 'fixed' | null;
    preparer_km_price_cents: number | null;
    preparer_fixed_cents: number | null;
    lat: number | null;
    lng: number | null;
  } | null;
  const baseTariff =
    baseRow && (baseRow.preparer_pricing_mode === 'per_km' || baseRow.preparer_pricing_mode === 'fixed')
      ? {
          mode: baseRow.preparer_pricing_mode,
          km_price_cents: baseRow.preparer_km_price_cents ?? null,
          fixed_cents: baseRow.preparer_fixed_cents ?? null,
        }
      : null;
  const baseLat = baseRow && Number.isFinite(Number(baseRow.lat)) ? Number(baseRow.lat) : null;
  const baseLng = baseRow && Number.isFinite(Number(baseRow.lng)) ? Number(baseRow.lng) : null;

  return { preparer, globals, routes, surcharges, baseTariff, baseLat, baseLng };
}

export type ShipmentQuoteOk = {
  pricingRouteId: string | null;
  /** Base pura após pkg multiplier (sem adicionais nem admin). */
  priceRouteBaseCents: number;
  /**
   * Compatibilidade: mesmo que `priceRouteBaseCents` (pré gross-up),
   * já que no novo modelo o "subtotal" passou a ser base + adicionais.
   */
  pricingSubtotalCents: number;
  /** Soma dos adicionais automáticos em centavos. */
  surchargesCents: number;
  surcharges: ShipmentSurcharge[];
  /** Taxa da plataforma no total (= admin_pct × total). */
  platformFeeCents: number;
  /** Valor final cobrado (já com gross-up da taxa admin). */
  amountCents: number;
  /** Parte do MOTORISTA na cobrança (com base: perna Base→Destino + tamanho; sem base: base inteira). */
  workerEarningCents: number;
  /** Parte do PREPARADOR (perna Origem→Base). 0 quando não há base. */
  preparerPayoutCents: number;
  /** Parte da plataforma (= admin_fee + adicionais). */
  adminEarningCents: number;
  adminPctApplied: number;
};

export type ShipmentQuoteResponse = { ok: true; quote: ShipmentQuoteOk } | { ok: false; error: string };

export async function quoteShipmentForClient(params: {
  originAddress: string;
  destinationAddress: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  packageSize: 'pequeno' | 'medio' | 'grande';
  /** Quando informado, aplica override do preparador (nível 1 da hierarquia). */
  preparerId?: string;
  /** Base resolvida da encomenda; se a base tiver tarifa, ela SOBREPÕE o global (global vira default). */
  baseId?: string | null;
  /** Viagem (rota) que levará a encomenda; aplica os ajustes da rota (fds/noturno/feriado) sobre a base. */
  scheduledTripId?: string | null;
}): Promise<ShipmentQuoteResponse> {
  let defaults: PricingDefaults;
  try {
    defaults = await readPricingDefaults(params.preparerId, params.baseId);
  } catch {
    return { ok: false, error: 'Não foi possível carregar a tabela de preços. Tente novamente.' };
  }

  const serviceType: PlatformFeeServiceType = params.preparerId
    ? 'shipment_preparer'
    : 'shipment_driver';
  const resolvedAdminPct = resolvePlatformFeePct(
    defaults.globals.platform_fee_pct_by_service,
    serviceType,
    defaults.globals.default_admin_pct ?? DEFAULT_ADMIN_PCT_FALLBACK,
  );
  const adminPctApplied = resolvedAdminPct;

  // Ajuste de horário da ROTA (fim de semana / noturno / feriado) — % sobre a base.
  let timeSurchargePct = 0;
  if (params.scheduledTripId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .rpc('resolve_trip_time_surcharge_pct', { p_scheduled_trip_id: params.scheduledTripId });
      const pct = Number(data);
      if (Number.isFinite(pct) && pct > 0) timeSurchargePct = pct;
    } catch {
      /* sem ajuste de horário */
    }
  }
  const tsMul = 1 + timeSurchargePct / 100;

  // Valor fixo por tamanho do pacote (somado ao repasse do motorista).
  // Override POR ROTA do motorista (trecho) sobrepõe o global; sem viagem/override → global.
  const routeSizeOverride = params.scheduledTripId
    ? await resolveRouteSizePriceCents(params.scheduledTripId, params.packageSize)
    : null;
  const sizeFixedCents =
    routeSizeOverride != null
      ? routeSizeOverride
      : defaults.globals.package_size_prices_cents[params.packageSize] ?? 0;

  // Modelo de pernas só quando há base com coordenadas.
  const hasBaseLeg =
    params.baseId != null &&
    defaults.baseLat != null && defaults.baseLng != null &&
    Number.isFinite(params.originLat) && Number.isFinite(params.originLng) &&
    Number.isFinite(params.destinationLat) && Number.isFinite(params.destinationLng);

  let basePricedCents: number;                  // base p/ gross-up (= soma dos repasses)
  let preparerPayoutCents = 0;                  // perna Origem→Base (preparador)
  let workerOverrideCents: number | null = null; // motorista (perna Base→Destino + tamanho)
  let pricingRouteIdUsed: string | null = null;

  if (hasBaseLeg) {
    // Pernas: preparador = Origem→Base; motorista = Base→Destino (+ valor do tamanho).
    const rate =
      (defaults.baseTariff?.mode === 'per_km' ? defaults.baseTariff.km_price_cents : null) ??
      defaults.globals.km_price_cents ??
      null;
    if (rate == null || rate <= 0) {
      return {
        ok: false,
        error:
          'Ainda não há preço por km configurado para encomendas. Peça ao administrador para definir em Configurações ou na base.',
      };
    }
    const legOBkm = await billableKmForShipment(
      params.originLat, params.originLng, defaults.baseLat as number, defaults.baseLng as number,
    );
    const legBDkm = await billableKmForShipment(
      defaults.baseLat as number, defaults.baseLng as number, params.destinationLat, params.destinationLng,
    );
    preparerPayoutCents = clampInt(rate * legOBkm * tsMul);
    const motoristaLegCents = clampInt(rate * legBDkm * tsMul);
    const sizeTsCents = clampInt(sizeFixedCents * tsMul);
    workerOverrideCents = motoristaLegCents + sizeTsCents;
    basePricedCents = preparerPayoutCents + workerOverrideCents;
  } else {
    // Sem base (coleta direta): modelo atual — distância única origem→destino.
    const km = await billableKmForShipment(
      params.originLat, params.originLng, params.destinationLat, params.destinationLng,
    );
    const effPerKm =
      defaults.preparer?.shipment_per_km_fee_cents ?? defaults.globals.km_price_cents ?? null;
    const effDelivery =
      defaults.preparer?.shipment_delivery_fee_cents ??
      defaults.globals.shipment_base_delivery_fee_cents ??
      null;
    const hasOverride = effPerKm != null || effDelivery != null;
    const bestRoute = pickBestRoutePreferPerKm(
      defaults.routes, params.originAddress, params.destinationAddress,
    );
    pricingRouteIdUsed = bestRoute?.id ?? null;
    const baseTariff = defaults.baseTariff;
    const baseTariffCents =
      baseTariff?.mode === 'fixed'
        ? baseTariff.fixed_cents
        : baseTariff?.mode === 'per_km'
          ? baseTariff.km_price_cents
          : null;
    let baseCents: number;
    if (baseTariff && baseTariffCents != null && baseTariffCents > 0) {
      baseCents = baseTariff.mode === 'fixed' ? clampInt(baseTariffCents) : clampInt(km * baseTariffCents);
    } else if (hasOverride) {
      baseCents = clampInt((effDelivery ?? 0) + km * (effPerKm ?? 0));
    } else if (bestRoute) {
      baseCents = await catalogBaseCentsAsync(bestRoute, km);
    } else {
      return {
        ok: false,
        error:
          'Ainda não há preços de encomenda configurados. Peça ao administrador para definir os valores padrão em Configurações.',
      };
    }
    basePricedCents = clampInt(clampInt(baseCents + sizeFixedCents) * tsMul);
  }

  const surchargesCents = defaults.surcharges.reduce((acc, s) => acc + s.value_cents, 0);

  let totalCents: number;
  let platformFeeCents: number;
  let workerEarningCents: number;
  let adminEarningCents: number;
  try {
    const pricing = computeOrderPricing({
      baseCents: basePricedCents,
      surchargesCents,
      adminPct: adminPctApplied,
      gainPct: 0,
      discountPct: 0,
    });
    totalCents = pricing.totalCents;
    platformFeeCents = pricing.adminFeeCents;
    // No modelo de pernas, o motorista fica só com a perna Base→Destino (+ tamanho);
    // a perna Origem→Base é do preparador. Sem base, mantém a base inteira.
    workerEarningCents = workerOverrideCents != null ? workerOverrideCents : pricing.workerEarningCents;
    adminEarningCents = pricing.adminEarningCents;
  } catch (e) {
    if (e instanceof PricingDenominatorOverflowError) {
      return {
        ok: false,
        error:
          'Configuração de taxas inválida: a comissão da plataforma é muito alta. Peça ao administrador para ajustar.',
      };
    }
    throw e;
  }

  return {
    ok: true,
    quote: {
      pricingRouteId: pricingRouteIdUsed,
      priceRouteBaseCents: basePricedCents,
      pricingSubtotalCents: basePricedCents,
      surchargesCents,
      surcharges: defaults.surcharges,
      platformFeeCents,
      preparerPayoutCents,
      amountCents: totalCents,
      workerEarningCents,
      adminEarningCents,
      adminPctApplied,
    },
  };
}
