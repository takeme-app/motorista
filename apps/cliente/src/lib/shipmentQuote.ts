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
 * Multiplicador por tamanho do pacote:
 *   - Lido de platform_settings.shipment_package_size_multipliers (JSON
 *     `{"pequeno":1,"medio":1.12,"grande":1.28}`) quando disponível; senão
 *     usa o fallback hardcoded.
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
 * Multiplicador por tamanho (sobre o valor base do trecho).
 * Usado como fallback quando `platform_settings.shipment_package_size_multipliers`
 * não estiver configurado.
 */
const PACKAGE_SIZE_MULT_FALLBACK: Record<'pequeno' | 'medio' | 'grande', number> = {
  pequeno: 1,
  medio: 1.12,
  grande: 1.28,
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

type PackageSizeMultipliers = Record<'pequeno' | 'medio' | 'grande', number>;

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
    package_size_multipliers: PackageSizeMultipliers;
  };
  /** Catálogo antigo (fallback). */
  routes: PreparerShipmentPricingRoute[];
  /** Adicionais automáticos aplicáveis a encomendas (qualquer papel). */
  surcharges: ShipmentSurcharge[];
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

function parsePackageMultipliers(raw: unknown): PackageSizeMultipliers {
  const fallback = PACKAGE_SIZE_MULT_FALLBACK;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const src = (obj.value && typeof obj.value === 'object' ? (obj.value as Record<string, unknown>) : obj);
    const p = Number(src.pequeno);
    const m = Number(src.medio);
    const g = Number(src.grande);
    if ([p, m, g].every((n) => Number.isFinite(n) && n > 0)) {
      return { pequeno: p, medio: m, grande: g };
    }
  }
  return fallback;
}

/** Lê em paralelo: override do preparador + padrões globais + catálogo. */
async function readPricingDefaults(preparerId?: string): Promise<PricingDefaults> {
  const sb = supabase as { from: (t: string) => any };

  const settingsPromise = sb
    .from('platform_settings')
    .select('key, value')
    .in('key', [
      'km_price_cents',
      'shipment_base_delivery_fee_cents',
      'default_admin_pct',
      'platform_fee_pct_by_service',
      'shipment_package_size_multipliers',
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
    .select('id, name, value_cents, surcharge_mode, surcharge_type, is_active')
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

  const [settingsRes, routesRes, surchargesRes, prepRes] = await Promise.all([
    settingsPromise,
    routesPromise,
    surchargesPromise,
    preparerPromise,
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
    package_size_multipliers: parsePackageMultipliers(
      settingMap.get('shipment_package_size_multipliers'),
    ),
  };

  const routes = ((routesRes.data ?? []) as PreparerShipmentPricingRoute[]) || [];

  const surchargeRows = (surchargesRes.data ?? []) as Array<{
    id: string;
    name: string;
    value_cents: number | null;
    surcharge_mode: 'automatic' | 'manual';
  }>;
  const surcharges: ShipmentSurcharge[] = surchargeRows
    .filter((r) => Number.isFinite(Number(r.value_cents)) && Number(r.value_cents) > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      value_cents: Math.max(0, Math.round(Number(r.value_cents))),
      surcharge_mode: r.surcharge_mode,
    }));

  const prepRow = (prepRes.data ?? null) as WorkerPricingRow | null;
  const preparer = prepRow
    ? {
        shipment_delivery_fee_cents: prepRow.shipment_delivery_fee_cents ?? null,
        shipment_per_km_fee_cents: prepRow.shipment_per_km_fee_cents ?? null,
      }
    : null;

  return { preparer, globals, routes, surcharges };
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
  /** Parte do preparador/motorista na cobrança (= base, sem promoção nesta etapa). */
  workerEarningCents: number;
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
}): Promise<ShipmentQuoteResponse> {
  let defaults: PricingDefaults;
  try {
    defaults = await readPricingDefaults(params.preparerId);
  } catch {
    return { ok: false, error: 'Não foi possível carregar a tabela de preços. Tente novamente.' };
  }

  const km = await billableKmForShipment(
    params.originLat,
    params.originLng,
    params.destinationLat,
    params.destinationLng,
  );
  const serviceType: PlatformFeeServiceType = params.preparerId
    ? 'shipment_preparer'
    : 'shipment_driver';
  const resolvedAdminPct = resolvePlatformFeePct(
    defaults.globals.platform_fee_pct_by_service,
    serviceType,
    defaults.globals.default_admin_pct ?? DEFAULT_ADMIN_PCT_FALLBACK,
  );

  // Tarifas efetivas após precedência (preparador > admin global).
  const effPerKm =
    defaults.preparer?.shipment_per_km_fee_cents ?? defaults.globals.km_price_cents ?? null;
  const effDelivery =
    defaults.preparer?.shipment_delivery_fee_cents ??
    defaults.globals.shipment_base_delivery_fee_cents ??
    null;
  const hasOverride = effPerKm != null || effDelivery != null;

  // Route do catálogo (pode ser usada como base ou apenas como FK/âncora histórica).
  const bestRoute = pickBestRoutePreferPerKm(
    defaults.routes,
    params.originAddress,
    params.destinationAddress,
  );

  let baseCents: number;
  let adminPctApplied: number;

  if (hasOverride) {
    baseCents = clampInt((effDelivery ?? 0) + km * (effPerKm ?? 0));
    adminPctApplied = resolvedAdminPct;
  } else if (bestRoute) {
    baseCents = await catalogBaseCentsAsync(bestRoute, km);
    adminPctApplied = resolvedAdminPct;
  } else {
    return {
      ok: false,
      error:
        'Ainda não há preços de encomenda configurados. Peça ao administrador para definir os valores padrão em Configurações.',
    };
  }

  const pkgMul = defaults.globals.package_size_multipliers[params.packageSize];
  const basePricedCents = clampInt(baseCents * pkgMul);

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
    workerEarningCents = pricing.workerEarningCents;
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
      pricingRouteId: bestRoute?.id ?? null,
      priceRouteBaseCents: basePricedCents,
      pricingSubtotalCents: basePricedCents,
      surchargesCents,
      surcharges: defaults.surcharges,
      platformFeeCents,
      amountCents: totalCents,
      workerEarningCents,
      adminEarningCents,
      adminPctApplied,
    },
  };
}
