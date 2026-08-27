// Pricing canônico de reservas (bookings) — CÓPIA FIEL do bloco do
// charge-booking/index.ts (resolvePriceCentsForScheduledTrip +
// loadPromotionForRoute + getBookingAdminPct + RPCs de surcharge +
// computePricing), extraída para o create-pix-charge recalcular o preço no
// servidor SEM tocar o caminho Stripe em produção.
//
// ⚠️ NÃO inclui a lógica de abate/Connect (consume_platform_fee_owed /
// application_fee) — isso é exclusivo da cobrança com split no Stripe.
// Refatorar o charge-booking para importar daqui é cleanup posterior.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type OrderPricing = {
  total_cents: number;
  base_cents: number;
  surcharges_cents: number;
  admin_fee_cents: number;
  promo_gain_cents: number;
  promo_discount_cents: number;
  worker_earning_cents: number;
  admin_earning_cents: number;
  admin_pct_applied: number;
  gain_pct_applied: number;
  discount_pct_applied: number;
};

export type PromoLookup = {
  promotion_id: string | null;
  gain_pct: number;
  discount_pct: number;
  promo_worker_route_id: string | null;
};

export async function loadPromotionForRoute(
  admin: SupabaseClient,
  orderType: "bookings" | "shipments" | "dependent_shipments" | "excursions",
  userId: string,
  baseCents: number,
  workerRouteId: string | null,
  pricingRouteId: string | null,
): Promise<PromoLookup> {
  const { data, error } = await admin.rpc("apply_active_promotion", {
    p_order_type: orderType,
    p_user_id: userId,
    p_amount_cents: baseCents,
    p_worker_route_id: workerRouteId,
    p_pricing_route_id: pricingRouteId,
  });
  if (error) {
    console.error("[bookingPricing] apply_active_promotion:", error.message);
    return { promotion_id: null, gain_pct: 0, discount_pct: 0, promo_worker_route_id: null };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    promotion_id: (row?.promotion_id as string | null) ?? null,
    gain_pct: Number(row?.gain_pct ?? 0),
    discount_pct: Number(row?.discount_pct ?? 0),
    promo_worker_route_id: (row?.promo_worker_route_id as string | null) ?? null,
  };
}

export async function computePricing(
  admin: SupabaseClient,
  baseCents: number,
  surchargesCents: number,
  adminPct: number,
  gainPct: number,
  discountPct: number,
): Promise<OrderPricing | { error: string }> {
  const { data, error } = await admin.rpc("compute_order_pricing", {
    p_base_cents: baseCents,
    p_surcharges_cents: surchargesCents,
    p_admin_pct: adminPct,
    p_gain_pct: gainPct,
    p_discount_pct: discountPct,
  });
  if (error) return { error: error.message };
  return data as OrderPricing;
}

const DEFAULT_PLATFORM_FEE_PCT = 15;
const MAX_PLATFORM_FEE_PCT = 40;

function readValidPlatformFeePct(value: unknown): number | null {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > MAX_PLATFORM_FEE_PCT) return null;
  return pct;
}

function readDefaultAdminPctValue(raw: unknown): number {
  if (raw && typeof raw === "object") {
    const obj = raw as { percentage?: unknown; value?: unknown };
    return readValidPlatformFeePct(obj.percentage ?? obj.value) ?? DEFAULT_PLATFORM_FEE_PCT;
  }
  return DEFAULT_PLATFORM_FEE_PCT;
}

function readServiceAdminPctValue(raw: unknown, fallbackPct: number): number {
  const source =
    raw && typeof raw === "object" && "value" in raw && (raw as { value?: unknown }).value != null
      ? (raw as { value?: unknown }).value
      : raw;
  if (source && typeof source === "object") {
    const servicePct = readValidPlatformFeePct((source as { booking?: unknown }).booking);
    if (servicePct != null) return servicePct;
  }
  return fallbackPct;
}

export async function getBookingAdminPct(admin: SupabaseClient): Promise<number> {
  const { data } = await admin
    .from("platform_settings")
    .select("key, value")
    .in("key", ["default_admin_pct", "platform_fee_pct_by_service"]);
  const rows = Array.isArray(data) ? data : [];
  const defaultRow = rows.find((row: { key?: string }) => row.key === "default_admin_pct");
  const byServiceRow = rows.find((row: { key?: string }) => row.key === "platform_fee_pct_by_service");
  const fallbackPct = readDefaultAdminPctValue((defaultRow as { value?: unknown } | undefined)?.value);
  return readServiceAdminPctValue((byServiceRow as { value?: unknown } | undefined)?.value, fallbackPct);
}

function resolveTripPriceCents(
  trip: {
    route_id?: string | null;
    price_per_person_cents?: number | null;
    amount_cents?: number | null;
  },
  routePriceById: Map<string, number | null>,
): number | null {
  const routeId = trip.route_id;
  if (routeId && routePriceById.has(routeId)) {
    const fromRoute = routePriceById.get(routeId);
    if (fromRoute != null && fromRoute >= 0) return fromRoute;
  }
  const tripPpp = trip.price_per_person_cents;
  if (tripPpp != null && tripPpp >= 0) return tripPpp;
  const legacy = trip.amount_cents;
  if (legacy != null && legacy >= 0) return legacy;
  return null;
}

export async function resolvePriceCentsForScheduledTrip(
  admin: SupabaseClient,
  scheduledTripId: string,
): Promise<{ cents: number | null; error: string | null }> {
  const { data: trip, error: tripErr } = await admin
    .from("scheduled_trips")
    .select("route_id, price_per_person_cents, amount_cents")
    .eq("id", scheduledTripId)
    .maybeSingle();
  if (tripErr) {
    return { cents: null, error: "Não foi possível obter os dados da viagem." };
  }
  if (!trip) {
    return { cents: null, error: "Viagem não encontrada." };
  }
  const routeId = trip.route_id as string | null | undefined;
  const routePriceById = new Map<string, number | null>();
  if (routeId) {
    const { data: route, error: routeErr } = await admin
      .from("worker_routes")
      .select("id, price_per_person_cents")
      .eq("id", routeId)
      .eq("is_active", true)
      .maybeSingle();
    if (routeErr) {
      return { cents: null, error: "Não foi possível obter o preço da rota." };
    }
    if (route) {
      routePriceById.set(route.id as string, (route.price_per_person_cents as number | null) ?? null);
    }
  }
  const cents = resolveTripPriceCents(
    {
      route_id: trip.route_id as string | null | undefined,
      price_per_person_cents: trip.price_per_person_cents as number | null | undefined,
      amount_cents: trip.amount_cents as number | null | undefined,
    },
    routePriceById,
  );
  return { cents, error: null };
}

export type BookingDraftPricing = {
  /** Base ajustada pelo adicional noturno/fim de semana (vai em price_route_base_cents). */
  adjustedBaseCents: number;
  pricing: OrderPricing;
  promo: PromoLookup;
  workerRouteId: string | null;
  pricingRouteId: string | null;
  /** Total a cobrar do cliente (>= 1). */
  chargeAmountCents: number;
};

/**
 * Recalcula no servidor o preço de um draft de reserva — espelho exato do
 * bloco do charge-booking (modo draft/cartão): resolve preço do trecho,
 * promoção ativa, % admin, adicionais fixos + % de horário e o pricing final.
 */
export async function computeBookingDraftPricing(
  admin: SupabaseClient,
  userId: string,
  scheduledTripId: string,
): Promise<BookingDraftPricing | { error: string; status: number }> {
  const { cents: amountCentsResolved, error: priceErr } = await resolvePriceCentsForScheduledTrip(
    admin,
    scheduledTripId,
  );
  if (priceErr) {
    return { error: priceErr, status: 400 };
  }
  const amountCents = amountCentsResolved != null ? Number(amountCentsResolved) : NaN;
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    return { error: "Valor da viagem inválido", status: 400 };
  }

  // Resolve rota do motorista + pricing_route_id (para matching de promoção).
  const { data: routeInfo } = await admin
    .from("scheduled_trips")
    .select("route_id, worker_routes:route_id (id, pricing_route_id)")
    .eq("id", scheduledTripId)
    .maybeSingle();
  const workerRouteId = (routeInfo?.route_id as string | null | undefined) ?? null;
  const pricingRouteId =
    ((routeInfo?.worker_routes as { pricing_route_id?: string | null } | null)
      ?.pricing_route_id as string | null | undefined) ?? null;

  // Pricing canônico: RPC apply_active_promotion + compute_order_pricing.
  const promo = await loadPromotionForRoute(
    admin,
    "bookings",
    userId,
    amountCents,
    workerRouteId,
    pricingRouteId,
  );
  const baseAdminPct = await getBookingAdminPct(admin);
  // Adicionais da viagem: vinculados ao trecho (pricing_route_surcharges) + automáticos
  // do catálogo 'viagem'. Chamado SEMPRE (mesmo sem trecho, p/ os automáticos incidirem).
  // Fonte única compartilhada com o preview do cliente → paridade exibido x cobrado.
  let surchargesCents = 0;
  {
    const { data: surTotal } = await admin.rpc("resolve_booking_surcharges_cents", {
      p_pricing_route_id: pricingRouteId,
    });
    const n = Number(surTotal);
    if (Number.isFinite(n) && n > 0) surchargesCents = Math.floor(n);
  }
  // Adicional noturno/fim de semana (% da rota × departure_at) → aumenta a base.
  let timeSurchargePct = 0;
  {
    const { data: pctData } = await admin.rpc("resolve_trip_time_surcharge_pct", {
      p_scheduled_trip_id: scheduledTripId,
    });
    const pct = Number(pctData);
    if (Number.isFinite(pct) && pct > 0) timeSurchargePct = pct;
  }
  const adjustedBaseCents = Math.round(amountCents * (1 + timeSurchargePct / 100));
  const pricing = await computePricing(
    admin,
    adjustedBaseCents,
    surchargesCents,
    baseAdminPct,
    promo.gain_pct,
    promo.discount_pct,
  );
  if ("error" in pricing) {
    return { error: `Falha no cálculo de preço: ${pricing.error}`, status: 400 };
  }

  return {
    adjustedBaseCents,
    pricing,
    promo,
    workerRouteId,
    pricingRouteId,
    chargeAmountCents: Math.max(1, pricing.total_cents),
  };
}
