import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type",
};

const STRIPE_API = "https://api.stripe.com/v1";

type DraftBookingBody = {
  scheduled_trip_id?: string;
  origin_address?: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_address?: string;
  destination_lat?: number;
  destination_lng?: number;
  passenger_count?: number;
  bags_count?: number;
  passenger_data?: unknown;
  /** Mantidos apenas por compatibilidade; edge recomputa via RPC. */
  promotion_id?: string;
  promo_discount_cents?: number;
};

type OrderPricing = {
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

type PromoLookup = {
  promotion_id: string | null;
  gain_pct: number;
  discount_pct: number;
  promo_worker_route_id: string | null;
};

type AbateResult = { extraCents: number; ledgerId: string | null };

const NO_ABATE: AbateResult = { extraCents: 0, ledgerId: null };

/**
 * Abate da taxa da plataforma (saldo devido em corridas-dinheiro) no momento de
 * uma cobrança Connect com cartão/Pix. Consome transacionalmente (FOR UPDATE) até
 * `min(adminEarning, workerEarning)` do saldo devido — o cap por corrida é a taxa
 * admin, e o segundo limite garante que `application_fee_amount <= amount` (o
 * líquido do motorista no Stripe nunca fica negativo). Registra um debit
 * `connect_charge_abate` no ledger e devolve o valor a somar no application_fee.
 */
async function consumePlatformFeeOwed(
  admin: SupabaseClient,
  workerId: string,
  adminEarningCents: number,
  workerEarningCents: number,
  bookingId: string | null,
): Promise<AbateResult> {
  const cap = Math.min(
    Math.max(0, Math.floor(adminEarningCents)),
    Math.max(0, Math.floor(workerEarningCents)),
  );
  if (!workerId || cap <= 0) return NO_ABATE;
  const { data, error } = await admin.rpc("consume_platform_fee_owed", {
    p_worker_id: workerId,
    p_max_cents: cap,
    p_booking_id: bookingId,
  });
  if (error) {
    console.error("[charge-booking] consume_platform_fee_owed:", error.message);
    return NO_ABATE;
  }
  const row = data as { extra_cents?: unknown; ledger_id?: unknown } | null;
  const extraCents = Math.max(0, Math.floor(Number(row?.extra_cents ?? 0)));
  const ledgerId = typeof row?.ledger_id === "string" ? row.ledger_id : null;
  return { extraCents, ledgerId };
}

/** Desfaz o débito de abate quando a cobrança não se concretiza (falha do PI/insert). */
async function revertAbateLedger(admin: SupabaseClient, ledgerId: string | null): Promise<void> {
  if (!ledgerId) return;
  const { error } = await admin.from("driver_platform_fee_ledger").delete().eq("id", ledgerId);
  if (error) console.error("[charge-booking] revertAbateLedger:", error.message);
}

async function loadPromotionForRoute(
  admin: SupabaseClient,
  orderType: 'bookings' | 'shipments' | 'dependent_shipments' | 'excursions',
  userId: string,
  baseCents: number,
  workerRouteId: string | null,
  pricingRouteId: string | null
): Promise<PromoLookup> {
  const { data, error } = await admin.rpc('apply_active_promotion', {
    p_order_type: orderType,
    p_user_id: userId,
    p_amount_cents: baseCents,
    p_worker_route_id: workerRouteId,
    p_pricing_route_id: pricingRouteId,
  });
  if (error) {
    console.error('[charge-booking] apply_active_promotion:', error.message);
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

async function computePricing(
  admin: SupabaseClient,
  baseCents: number,
  surchargesCents: number,
  adminPct: number,
  gainPct: number,
  discountPct: number
): Promise<OrderPricing | { error: string }> {
  const { data, error } = await admin.rpc('compute_order_pricing', {
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

async function getBookingAdminPct(admin: SupabaseClient): Promise<number> {
  const { data } = await admin
    .from('platform_settings')
    .select('key, value')
    .in('key', ['default_admin_pct', 'platform_fee_pct_by_service']);
  const rows = Array.isArray(data) ? data : [];
  const defaultRow = rows.find((row: { key?: string }) => row.key === 'default_admin_pct');
  const byServiceRow = rows.find((row: { key?: string }) => row.key === 'platform_fee_pct_by_service');
  const fallbackPct = readDefaultAdminPctValue((defaultRow as { value?: unknown } | undefined)?.value);
  return readServiceAdminPctValue((byServiceRow as { value?: unknown } | undefined)?.value, fallbackPct);
}

async function stripeFetch(
  secretKey: string,
  method: string,
  path: string,
  body?: URLSearchParams
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${STRIPE_API}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
  };
  if (body && method !== "GET") opts.body = body.toString();
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(err);
  }
  return data;
}

async function stripeRefundPaymentIntent(secretKey: string, paymentIntentId: string): Promise<void> {
  const params = new URLSearchParams({ payment_intent: paymentIntentId });
  await stripeFetch(secretKey, "POST", "/refunds", params);
}

type CardFunding = "credit" | "debit" | "prepaid" | "unknown";

/**
 * Lê `card.funding` (`credit`/`debit`/`prepaid`/`unknown`) do PaymentMethod.
 * Usado para validar a intenção do cliente (cartão "combo" no BR é roteado pelo emissor;
 * sem este check, débito e crédito chegam idênticos no Stripe).
 */
async function fetchPaymentMethodFunding(
  secretKey: string,
  paymentMethodId: string,
): Promise<CardFunding | null> {
  try {
    const pm = (await stripeFetch(
      secretKey,
      "GET",
      `/payment_methods/${paymentMethodId}`,
    )) as { card?: { funding?: string } };
    const f = pm.card?.funding;
    if (f === "credit" || f === "debit" || f === "prepaid" || f === "unknown") return f;
    return null;
  } catch {
    return null;
  }
}

function fundingMismatchMessage(intent: "credit" | "debit", funding: CardFunding): string | null {
  if (intent === "debit" && funding === "credit") {
    return "Este cartão é processado como crédito pelo emissor; tente a opção 'Cartão de crédito' ou pague via Pix.";
  }
  if (intent === "credit" && funding === "debit") {
    return "Este cartão é débito; selecione 'Cartão de débito' para concluir.";
  }
  return null;
}

function resolveTripPriceCents(
  trip: {
    route_id?: string | null;
    price_per_person_cents?: number | null;
    amount_cents?: number | null;
  },
  routePriceById: Map<string, number | null>
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

async function resolvePriceCentsForScheduledTrip(
  admin: SupabaseClient,
  scheduledTripId: string
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
    routePriceById
  );
  return { cents, error: null };
}

async function resolveStripePaymentMethodId(
  admin: SupabaseClient,
  userId: string,
  paymentMethodIdSupabase: string | undefined,
  stripePaymentMethodIdFromClient: string | undefined
): Promise<{ pm: string } | { error: string; status: number }> {
  if (stripePaymentMethodIdFromClient) {
    return { pm: stripePaymentMethodIdFromClient };
  }
  if (paymentMethodIdSupabase) {
    const { data: pmRow, error: pmErr } = await admin
      .from("payment_methods")
      .select("id, user_id, provider_id")
      .eq("id", paymentMethodIdSupabase)
      .eq("user_id", userId)
      .single();
    if (pmErr || !pmRow?.provider_id) {
      return { error: "Método de pagamento não encontrado", status: 404 };
    }
    return { pm: pmRow.provider_id as string };
  }
  return { error: "Informe stripe_payment_method_id ou payment_method_id", status: 400 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("x-auth-token");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : (authHeader ?? "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Não autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) {
      return new Response(
        JSON.stringify({ error: "Stripe não configurado (STRIPE_SECRET_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const claims = claimsData?.claims as { sub?: string } | undefined;
    const userId = claims?.sub;
    if (claimsError || !userId) {
      return new Response(
        JSON.stringify({ error: "Sessão inválida ou expirada" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      booking_id?: string;
      draft_booking?: DraftBookingBody;
      payment_method_id?: string;
      stripe_payment_method_id?: string;
      /** "card" (default) ou "pix"; pix só é aceito no modo legado (booking_id já criado pelo cliente). */
      payment_method_kind?: "card" | "pix";
      /** Quando "card", indica a intenção do usuário (selecionado em PaymentMethodSection). */
      card_intent?: "credit" | "debit";
    };
    const bookingId = body.booking_id?.trim();
    const paymentMethodIdSupabase = body.payment_method_id?.trim();
    const stripePaymentMethodIdFromClient = body.stripe_payment_method_id?.trim();
    const draft = body.draft_booking;
    const hasDraft = Boolean(draft?.scheduled_trip_id?.trim());
    const hasLegacyBooking = Boolean(bookingId);
    const paymentMethodKind: "card" | "pix" =
      body.payment_method_kind === "pix" ? "pix" : "card";
    const cardIntent: "credit" | "debit" | null =
      body.card_intent === "credit" || body.card_intent === "debit" ? body.card_intent : null;

    if (hasDraft && hasLegacyBooking) {
      return new Response(
        JSON.stringify({ error: "Envie apenas draft_booking ou apenas booking_id, não os dois." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!hasDraft && !hasLegacyBooking) {
      return new Response(
        JSON.stringify({
          error: "Envie booking_id (reserva já criada) ou draft_booking (checkout com cartão).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (paymentMethodKind === "pix" && hasDraft) {
      return new Response(
        JSON.stringify({
          error: "Pix exige booking_id (reserva pré-criada). Crie a reserva como pending antes de chamar a cobrança Pix.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let stripePaymentMethodId = "";
    let cardFunding: CardFunding | null = null;
    if (paymentMethodKind === "card") {
      const pmRes = await resolveStripePaymentMethodId(
        admin,
        userId,
        paymentMethodIdSupabase,
        stripePaymentMethodIdFromClient
      );
      if ("error" in pmRes) {
        return new Response(JSON.stringify({ error: pmRes.error }), {
          status: pmRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      stripePaymentMethodId = pmRes.pm;

      // Validação de funding vs intenção (cartão "combo" no BR é roteado pelo emissor;
      // sem este check, a chamada Stripe é idêntica para débito e crédito).
      if (cardIntent) {
        cardFunding = await fetchPaymentMethodFunding(stripeSecret, stripePaymentMethodId);
        if (cardFunding) {
          const mismatch = fundingMismatchMessage(cardIntent, cardFunding);
          if (mismatch) {
            return new Response(JSON.stringify({ error: mismatch }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }
    }

    const { data: profile } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).single();
    const customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      return new Response(
        JSON.stringify({ error: "Cliente Stripe não encontrado; adicione um método de pagamento primeiro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Modo: nova reserva (cartão) — cobrar antes de inserir ──
    if (hasDraft && draft) {
      const sid = draft.scheduled_trip_id!.trim();
      const pax = Math.max(1, Math.floor(Number(draft.passenger_count ?? 0)));
      const bags = Math.max(0, Math.floor(Number(draft.bags_count ?? 0)));
      if (!draft.origin_address?.trim() || !draft.destination_address?.trim()) {
        return new Response(JSON.stringify({ error: "Endereços de origem e destino são obrigatórios." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (
        !Number.isFinite(draft.origin_lat) ||
        !Number.isFinite(draft.origin_lng) ||
        !Number.isFinite(draft.destination_lat) ||
        !Number.isFinite(draft.destination_lng)
      ) {
        return new Response(JSON.stringify({ error: "Coordenadas inválidas." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: tripRow, error: tripLoadErr } = await admin
        .from("scheduled_trips")
        .select("id, status, seats_available, driver_id")
        .eq("id", sid)
        .maybeSingle();
      if (tripLoadErr || !tripRow) {
        return new Response(JSON.stringify({ error: "Viagem não encontrada." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if ((tripRow.status as string) !== "active") {
        return new Response(JSON.stringify({ error: "Esta viagem não está disponível para reserva." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const seatsAvail = Number(tripRow.seats_available ?? 0);
      if (!Number.isFinite(seatsAvail) || seatsAvail < pax) {
        return new Response(JSON.stringify({ error: "Capacidade insuficiente para esta viagem." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { cents: amountCentsResolved, error: priceErr } = await resolvePriceCentsForScheduledTrip(admin, sid);
      if (priceErr) {
        return new Response(JSON.stringify({ error: priceErr }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const amountCents = amountCentsResolved != null ? Number(amountCentsResolved) : NaN;
      if (!Number.isInteger(amountCents) || amountCents < 1) {
        return new Response(JSON.stringify({ error: "Valor da viagem inválido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Resolve rota do motorista + pricing_route_id (para matching de promoção).
      const { data: routeInfo } = await admin
        .from("scheduled_trips")
        .select("route_id, worker_routes:route_id (id, pricing_route_id)")
        .eq("id", sid)
        .maybeSingle();
      const workerRouteId =
        (routeInfo?.route_id as string | null | undefined) ?? null;
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
        pricingRouteId
      );
      const baseAdminPct = await getBookingAdminPct(admin);
      const pricing = await computePricing(
        admin,
        amountCents,
        0,
        baseAdminPct,
        promo.gain_pct,
        promo.discount_pct
      );
      if ("error" in pricing) {
        return new Response(JSON.stringify({ error: `Falha no cálculo de preço: ${pricing.error}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const chargeAmountCents = Math.max(1, pricing.total_cents);
      const promoId = promo.promotion_id;
      const promoDiscountCents = pricing.promo_discount_cents;
      const promoGainCents = pricing.promo_gain_cents;
      const platformFeeCents = pricing.admin_fee_cents;
      const workerEarningCents = pricing.worker_earning_cents;
      const adminEarningCents = pricing.admin_earning_cents;

      const driverId = (tripRow.driver_id as string | undefined)?.trim() ?? "";
      let connectAccountId: string | null = null;
      let applicationFeeCents: number | null = null;
      let extraDebitCents = 0;
      let abateLedgerId: string | null = null;
      if (driverId) {
        const { data: wp } = await admin
          .from("worker_profiles")
          .select("stripe_connect_account_id, stripe_connect_charges_enabled")
          .eq("id", driverId)
          .maybeSingle();
        const rawAcct = (wp?.stripe_connect_account_id as string | null | undefined)?.trim() ?? null;
        // Só aplica split quando a Stripe habilitou o destino (charges_enabled). Caso contrário
        // cobra sem transfer_data — o repasse fica para depois via payouts manuais.
        connectAccountId = rawAcct && wp?.stripe_connect_charges_enabled === true ? rawAcct : null;
        if (connectAccountId) {
          // PDF split: motorista recebe worker_earning; plataforma retém admin_earning.
          if (workerEarningCents < 0 || workerEarningCents > chargeAmountCents) {
            return new Response(
              JSON.stringify({ error: "Inconsistência de valores da reserva (repasse inválido)" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          // Abate do saldo devido (corridas-dinheiro) — booking ainda não existe: linka depois.
          const abate = await consumePlatformFeeOwed(admin, driverId, adminEarningCents, workerEarningCents, null);
          extraDebitCents = abate.extraCents;
          abateLedgerId = abate.ledgerId;
          applicationFeeCents = adminEarningCents + extraDebitCents;
        }
      }

      const piParams = new URLSearchParams({
        amount: String(chargeAmountCents),
        currency: "brl",
        customer: customerId,
        "payment_method": stripePaymentMethodId,
        confirm: "true",
        /** Só cartão: evita Link/outros métodos que exigem redirect sem `return_url` no servidor. */
        "payment_method_types[0]": "card",
        "metadata[scheduled_trip_id]": sid,
        "metadata[user_id]": userId,
        "metadata[worker_earning_cents]": String(workerEarningCents),
        "metadata[admin_earning_cents]": String(adminEarningCents),
      });
      if (cardIntent) piParams.set("metadata[requested_card_intent]", cardIntent);
      if (cardFunding) piParams.set("metadata[card_funding]", cardFunding);
      if (promoId) piParams.set("metadata[promotion_id]", promoId);
      if (connectAccountId && applicationFeeCents != null) {
        piParams.set("application_fee_amount", String(applicationFeeCents));
        piParams.set("transfer_data[destination]", connectAccountId);
        piParams.set("metadata[stripe_connect_destination]", connectAccountId);
      }

      let pi: { id?: string; status?: string; amount?: number; last_payment_error?: { message?: string } };
      try {
        pi = await stripeFetch(stripeSecret, "POST", "/payment_intents", piParams) as typeof pi;
      } catch (e) {
        await revertAbateLedger(admin, abateLedgerId);
        return new Response(
          JSON.stringify({ error: e instanceof Error ? e.message : "Falha ao cobrar no Stripe" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (pi.status === "requires_action") {
        await revertAbateLedger(admin, abateLedgerId);
        return new Response(
          JSON.stringify({
            error:
              "Seu banco pediu uma confirmação extra neste cartão que não pode ser concluída neste fluxo. Tente outro cartão ou use Pix.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (pi.status !== "succeeded" && pi.status !== "requires_capture") {
        await revertAbateLedger(admin, abateLedgerId);
        const errMsg = pi.last_payment_error?.message ?? "Pagamento não foi aprovado";
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      /** Valor efetivamente debitado (fonte de verdade = Stripe, em centavos). */
      const billedCents =
        typeof pi.amount === "number" && Number.isFinite(pi.amount) && Math.floor(pi.amount) >= 1
          ? Math.floor(pi.amount)
          : chargeAmountCents;

      const passengerDataJson = draft.passenger_data ?? [];
      const insertRow = {
        user_id: userId,
        scheduled_trip_id: sid,
        origin_address: draft.origin_address!.trim(),
        origin_lat: draft.origin_lat!,
        origin_lng: draft.origin_lng!,
        destination_address: draft.destination_address!.trim(),
        destination_lat: draft.destination_lat!,
        destination_lng: draft.destination_lng!,
        passenger_count: pax,
        bags_count: bags,
        passenger_data: passengerDataJson,
        price_route_base_cents: amountCents,
        pricing_subtotal_cents: workerEarningCents,
        pricing_surcharges_cents: pricing.surcharges_cents,
        platform_fee_cents: platformFeeCents,
        promo_discount_cents: promoDiscountCents,
        promo_gain_cents: promoGainCents,
        worker_earning_cents: workerEarningCents,
        admin_earning_cents: adminEarningCents,
        promotion_id: promoId || null,
        promo_worker_route_id: promo.promo_worker_route_id,
        admin_pct_applied: pricing.admin_pct_applied,
        amount_cents: billedCents,
        platform_fee_extra_debit_cents: extraDebitCents,
        status: "paid",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stripe_payment_intent_id: pi.id ?? null,
      };

      const { data: inserted, error: insErr } = await admin
        .from("bookings")
        .insert(insertRow as never)
        .select("id, worker_payout_cents")
        .single();

      if (insErr || !inserted?.id) {
        console.error(
          "[charge-booking] insert após cobrança:",
          JSON.stringify({ message: insErr?.message, details: insErr?.details, hint: insErr?.hint, code: insErr?.code }),
        );
        if (pi.id) {
          try {
            await stripeRefundPaymentIntent(stripeSecret, pi.id);
          } catch (re) {
            console.error("[charge-booking] estorno após falha no insert:", re);
          }
        }
        await revertAbateLedger(admin, abateLedgerId);
        const detail = insErr?.message?.trim() || "sem detalhe";
        return new Response(
          JSON.stringify({
            error:
              `Pagamento autorizado, mas não foi possível registrar a reserva. O valor será estornado automaticamente; se não refletir em até 5 dias úteis, contate o suporte. (detalhe: ${detail})`,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newBookingId = inserted.id as string;

      // Linka o débito de abate ao booking recém-criado (para auditoria e reversão).
      if (abateLedgerId) {
        const { error: linkErr } = await admin
          .from("driver_platform_fee_ledger")
          .update({ booking_id: newBookingId } as never)
          .eq("id", abateLedgerId);
        if (linkErr) console.error("[charge-booking] link abate->booking:", linkErr.message);
      }

      // Payout é criado automaticamente pelo trigger SQL quando a trip é completada
      // (fn_create_payouts_on_trip_complete). Não criamos aqui no charge.

      return new Response(
        JSON.stringify({ ok: true, booking_id: newBookingId, amount_cents: billedCents }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Modo legado: reserva pending já criada ──
    const { data: booking, error: bookingErr } = await admin
      .from("bookings")
      .select("id, user_id, amount_cents, status, worker_payout_cents, worker_earning_cents, admin_earning_cents, scheduled_trips(driver_id)")
      .eq("id", bookingId)
      .eq("user_id", userId)
      .single();
    if (bookingErr || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva não encontrada ou não pertence ao usuário" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (booking.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Reserva já foi paga ou cancelada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountCents = Number(booking.amount_cents);
    if (!Number.isInteger(amountCents) || amountCents < 1) {
      return new Response(
        JSON.stringify({ error: "Valor da reserva inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stRaw = booking.scheduled_trips as { driver_id?: string } | { driver_id?: string }[] | null;
    const st = Array.isArray(stRaw) ? stRaw[0] : stRaw;
    const driverId = st?.driver_id?.trim();
    let connectAccountId: string | null = null;
    let applicationFeeCents: number | null = null;
    let extraDebitCents = 0;
    let abateLedgerId: string | null = null;

    if (driverId) {
      const { data: wp } = await admin
        .from("worker_profiles")
        .select("stripe_connect_account_id, stripe_connect_charges_enabled")
        .eq("id", driverId)
        .maybeSingle();
      const rawAcct = (wp?.stripe_connect_account_id as string | null | undefined)?.trim() ?? null;
      // Split Connect só com charges_enabled; caso contrário pagamento manual.
      connectAccountId = rawAcct && wp?.stripe_connect_charges_enabled === true ? rawAcct : null;

      // Prioridade: usa o split persistido no booking (worker_earning/admin_earning);
      // fallback para worker_payout_cents (legado gerado pela constraint antiga).
      const adminEarningStored = Number(booking.admin_earning_cents);
      const workerEarningStored = Number(booking.worker_earning_cents);
      if (
        connectAccountId &&
        Number.isFinite(adminEarningStored) &&
        adminEarningStored >= 0
      ) {
        applicationFeeCents = Math.floor(adminEarningStored);
        // Abate do saldo devido (corridas-dinheiro) — booking já existe.
        const abate = await consumePlatformFeeOwed(
          admin,
          driverId,
          adminEarningStored,
          Number.isFinite(workerEarningStored) ? workerEarningStored : amountCents - Math.floor(adminEarningStored),
          bookingId,
        );
        extraDebitCents = abate.extraCents;
        abateLedgerId = abate.ledgerId;
        applicationFeeCents = Math.floor(adminEarningStored) + extraDebitCents;
      } else if (connectAccountId) {
        const workerPayout = Number(booking.worker_payout_cents ?? workerEarningStored ?? 0);
        const payout = Number.isFinite(workerPayout)
          ? Math.max(0, Math.floor(workerPayout))
          : 0;
        if (payout > amountCents) {
          return new Response(
            JSON.stringify({ error: "Inconsistência de valores da reserva (repasse > total)" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        applicationFeeCents = amountCents - payout;
      }
    }

    // ── Pix (modo legado): a reserva já está pending; confirma o webhook depois ──
    if (paymentMethodKind === "pix") {
      const pixParams = new URLSearchParams({
        amount: String(amountCents),
        currency: "brl",
        customer: customerId,
        "payment_method_types[]": "pix",
        confirm: "true",
        "metadata[booking_id]": bookingId!,
        "metadata[user_id]": userId,
      });
      if (connectAccountId && applicationFeeCents != null) {
        pixParams.set("application_fee_amount", String(applicationFeeCents));
        pixParams.set("transfer_data[destination]", connectAccountId);
        pixParams.set("metadata[stripe_connect_destination]", connectAccountId);
      }
      const piPix = (await stripeFetch(stripeSecret, "POST", "/payment_intents", pixParams)) as {
        id?: string;
        status?: string;
        last_payment_error?: { message?: string };
        next_action?: {
          type?: string;
          pix_display_qr_code?: {
            image_url_png?: string;
            hosted_voucher_url?: string;
            data?: string;
          };
        };
      };
      if (piPix.status === "succeeded" || piPix.status === "requires_capture") {
        // Caminho raro (Pix com saldo já casado): grava PI já; webhook vai promover status.
        await admin
          .from("bookings")
          .update({
            stripe_payment_intent_id: piPix.id ?? null,
            platform_fee_extra_debit_cents: extraDebitCents,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", bookingId!)
          .eq("user_id", userId);
        return new Response(
          JSON.stringify({ ok: true, booking_id: bookingId, amount_cents: amountCents }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (piPix.status === "requires_action" && piPix.next_action?.type === "pix_display_qr_code") {
        // Registra o abate no booking; se o Pix não for pago e o booking for cancelado,
        // o trigger trg_bookings_revert_platform_fee_abate devolve o saldo ao motorista.
        if (extraDebitCents > 0) {
          await admin
            .from("bookings")
            .update({ platform_fee_extra_debit_cents: extraDebitCents, updated_at: new Date().toISOString() } as never)
            .eq("id", bookingId!)
            .eq("user_id", userId);
        }
        const qr = piPix.next_action.pix_display_qr_code;
        return new Response(
          JSON.stringify({
            ok: true,
            pix_requires_payment: true,
            booking_id: bookingId,
            payment_intent_id: piPix.id ?? null,
            image_url_png: qr?.image_url_png ?? null,
            hosted_voucher_url: qr?.hosted_voucher_url ?? null,
            pix_copy_paste: qr?.data ?? null,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      await revertAbateLedger(admin, abateLedgerId);
      const errMsg = piPix.last_payment_error?.message ?? `Pix não disponível (status=${piPix.status ?? "?"})`;
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const piParams = new URLSearchParams({
      amount: String(amountCents),
      currency: "brl",
      customer: customerId,
      "payment_method": stripePaymentMethodId,
      confirm: "true",
      "payment_method_types[0]": "card",
      "metadata[booking_id]": bookingId,
      "metadata[user_id]": userId,
    });
    if (cardIntent) piParams.set("metadata[requested_card_intent]", cardIntent);
    if (cardFunding) piParams.set("metadata[card_funding]", cardFunding);
    if (connectAccountId && applicationFeeCents != null) {
      piParams.set("application_fee_amount", String(applicationFeeCents));
      piParams.set("transfer_data[destination]", connectAccountId);
      piParams.set("metadata[stripe_connect_destination]", connectAccountId);
    }
    const pi = await stripeFetch(stripeSecret, "POST", "/payment_intents", piParams) as {
      id?: string;
      status?: string;
      last_payment_error?: { message?: string };
    };
    if (pi.status === "requires_action") {
      await revertAbateLedger(admin, abateLedgerId);
      return new Response(
        JSON.stringify({
          error:
            "Seu banco pediu uma confirmação extra neste cartão que não pode ser concluída neste fluxo. Tente outro cartão ou use Pix.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (pi.status !== "succeeded" && pi.status !== "requires_capture") {
      await revertAbateLedger(admin, abateLedgerId);
      const errMsg = pi.last_payment_error?.message ?? "Pagamento não foi aprovado";
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateErr } = await admin
      .from("bookings")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stripe_payment_intent_id: pi.id ?? null,
        platform_fee_extra_debit_cents: extraDebitCents,
      })
      .eq("id", bookingId)
      .eq("user_id", userId);
    if (updateErr) {
      console.error(
        "[charge-booking] update após cobrança (legacy):",
        JSON.stringify({ message: updateErr.message, details: updateErr.details, hint: updateErr.hint, code: updateErr.code }),
      );
      const detail = updateErr.message?.trim() || "sem detalhe";
      return new Response(
        JSON.stringify({ error: `Reserva cobrada mas falha ao atualizar status; contate o suporte. (detalhe: ${detail})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Payout é criado automaticamente pelo trigger SQL quando a trip é completada
    // (fn_create_payouts_on_trip_complete). Não criamos aqui no charge.

    return new Response(
      JSON.stringify({ ok: true, booking_id: bookingId, amount_cents: amountCents }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("charge-booking:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao processar cobrança" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
