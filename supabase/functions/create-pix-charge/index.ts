import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  resolveActivePixProvider,
} from "../_shared/pixProviders/index.ts";
import { PixProviderUnavailableError } from "../_shared/pixProviders/types.ts";
import { computeBookingDraftPricing } from "../_shared/pricing/bookingPricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type",
};

const MAX_PENDING_CHARGES_PER_USER = 3;

/**
 * create-pix-charge — cria uma cobrança Pix REAL no provedor ativo.
 *
 * Fase 1: só entity_type='booking' (viagem). Fluxo:
 *   1. provedor efetivo (flag pix_provider + allowlist/test_provider);
 *      palliative ⇒ 409 pix_provider_not_active (o app cai no fluxo antigo);
 *   2. CPF (profiles.cpf ou body; Asaas exige) ⇒ 422 cpf_required se faltar;
 *   3. dedup de retomada: cobrança pendente não expirada do mesmo user+viagem
 *      devolve o MESMO QR (não segura vaga em dobro); máx 3 pendentes ⇒ 429;
 *   4. preço recalculado NO SERVIDOR (mesmo bloco canônico do charge-booking —
 *      taxa da plataforma registrada como no cartão);
 *   5. INSERT pix_charges ANTES do provedor (externalReference = pix_charges.id)
 *      e INSERT do booking 'pending' JÁ com pix_charge_id (o gate de notificação
 *      exige; o trigger de capacidade segura a vaga ou devolve 409);
 *   6. createCharge no provedor; falha ⇒ charge create_failed + booking
 *      cancelled/pix_create_failed (vaga devolvida) + 502.
 *
 * A confirmação do pagamento chega pelo webhook do provedor (asaas-webhook) ou
 * pelo polling get-pix-charge-status — nunca por este endpoint.
 */

/** Valida CPF pelo algoritmo oficial de dígitos verificadores (espelho do app). */
function validateCpfDigits(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== parseInt(d[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== parseInt(d[10], 10)) return false;

  return true;
}

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type DraftBookingBody = {
  origin_address?: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_address?: string;
  destination_lat?: number;
  destination_lng?: number;
  passenger_count?: number;
  bags_count?: number;
  passenger_data?: unknown;
  /** Mantido por compatibilidade; a edge recomputa via RPC. */
  promotion_id?: string;
};

type ChargeResponseRow = {
  id: string;
  entity_id: string;
  expected_amount_cents: number;
  qr_payload: string | null;
  qr_image_base64: string | null;
  expires_at: string | null;
};

function chargeResponse(charge: ChargeResponseRow): Response {
  return jsonRes({
    ok: true,
    pix_charge_id: charge.id,
    entity_type: "booking",
    entity_id: charge.entity_id,
    amount_cents: charge.expected_amount_cents,
    qr_payload: charge.qr_payload,
    qr_image_base64: charge.qr_image_base64,
    expires_at: charge.expires_at,
  });
}

/** Marca a charge como create_failed (falha antes/na chamada ao provedor). */
async function markChargeCreateFailed(
  admin: SupabaseClient,
  chargeId: string,
  reason: string,
): Promise<void> {
  const { error } = await admin
    .from("pix_charges")
    .update({
      status: "create_failed",
      failure_reason: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", chargeId)
    .eq("status", "pending");
  if (error) console.error("[create-pix-charge] markChargeCreateFailed:", error.message);
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
      return jsonRes({ error: "Não autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const claims = claimsData?.claims as { sub?: string } | undefined;
    const userId = claims?.sub;
    if (claimsError || !userId) {
      return jsonRes({ error: "Sessão inválida ou expirada" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      entity_type?: string;
      scheduled_trip_id?: string;
      cpf?: string;
      draft?: DraftBookingBody;
    };

    const entityType = (body.entity_type ?? "").trim();
    if (entityType !== "booking") {
      return jsonRes(
        { error: `entity_type '${entityType || "?"}' ainda não suportado no Pix real (fases 2+).` },
        501,
      );
    }

    const sid = body.scheduled_trip_id?.trim();
    const draft = body.draft;
    if (!sid || !draft) {
      return jsonRes({ error: "scheduled_trip_id e draft são obrigatórios." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // ── 1) Provedor efetivo (a flag governa SÓ a criação) ──
    let resolution;
    try {
      resolution = await resolveActivePixProvider(admin, userId);
    } catch (e) {
      if (e instanceof PixProviderUnavailableError) {
        console.error("[create-pix-charge] provedor indisponível:", e.message);
        return jsonRes({ error: "pix_provider_unavailable" }, 502);
      }
      throw e;
    }
    if (resolution.mode === "palliative") {
      // App cai no fluxo paliativo (contrato do plano).
      return jsonRes({ error: "pix_provider_not_active" }, 409);
    }
    const { provider, setting } = resolution;

    // ── 2) CPF (Asaas exige) ──
    const { data: profile } = await admin
      .from("profiles")
      .select("cpf, full_name")
      .eq("id", userId)
      .maybeSingle();
    const profileCpfDigits = ((profile?.cpf as string | null) ?? "").replace(/\D/g, "");
    const bodyCpfDigits = (body.cpf ?? "").replace(/\D/g, "");
    let cpfDigits = "";
    if (validateCpfDigits(profileCpfDigits)) {
      cpfDigits = profileCpfDigits;
    } else if (validateCpfDigits(bodyCpfDigits)) {
      cpfDigits = bodyCpfDigits;
      // Persiste CPF novo válido (mesmo update do EditCpfScreen: só dígitos).
      const { error: cpfErr } = await admin
        .from("profiles")
        .update({ cpf: cpfDigits, updated_at: new Date().toISOString() } as never)
        .eq("id", userId);
      if (cpfErr) console.warn("[create-pix-charge] persistência de CPF falhou:", cpfErr.message);
    } else {
      return jsonRes({ error: "cpf_required" }, 422);
    }

    // ── 3) Dedup de retomada + limite de pendentes ──
    const nowIso = new Date().toISOString();
    const { data: pendingCharges } = await admin
      .from("pix_charges")
      .select("id, entity_type, entity_id, expected_amount_cents, qr_payload, qr_image_base64, expires_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", nowIso);
    const pending = (pendingCharges ?? []) as Array<ChargeResponseRow & { entity_type: string }>;

    const pendingBookingIds = pending
      .filter((c) => c.entity_type === "booking")
      .map((c) => c.entity_id);
    if (pendingBookingIds.length > 0) {
      const { data: pendingBookings } = await admin
        .from("bookings")
        .select("id, scheduled_trip_id, status")
        .in("id", pendingBookingIds)
        .eq("status", "pending")
        .eq("scheduled_trip_id", sid);
      const match = (pendingBookings ?? [])[0] as { id: string } | undefined;
      if (match) {
        const existing = pending.find((c) => c.entity_id === match.id);
        if (existing?.qr_payload) {
          // Mesmo user + mesma viagem com QR vivo: devolve o existente
          // (não segura vaga em dobro).
          return chargeResponse(existing);
        }
        if (existing) {
          // Charge da mesma viagem ainda sem QR (create em voo em outra
          // requisição): não cria segunda reserva segurando vaga em dobro.
          return jsonRes(
            { error: "Já existe uma cobrança Pix em processamento para esta viagem. Tente novamente em instantes." },
            429,
          );
        }
      }
    }

    if (pending.length >= MAX_PENDING_CHARGES_PER_USER) {
      return jsonRes(
        { error: "Você já tem cobranças Pix pendentes demais. Pague ou aguarde expirarem." },
        429,
      );
    }

    // ── 4) Validação do draft + viagem (espelho do charge-booking) ──
    const pax = Math.max(1, Math.floor(Number(draft.passenger_count ?? 0)));
    const bags = Math.max(0, Math.floor(Number(draft.bags_count ?? 0)));
    if (!draft.origin_address?.trim() || !draft.destination_address?.trim()) {
      return jsonRes({ error: "Endereços de origem e destino são obrigatórios." }, 400);
    }
    if (
      !Number.isFinite(draft.origin_lat) ||
      !Number.isFinite(draft.origin_lng) ||
      !Number.isFinite(draft.destination_lat) ||
      !Number.isFinite(draft.destination_lng)
    ) {
      return jsonRes({ error: "Coordenadas inválidas." }, 400);
    }

    const { data: tripRow, error: tripLoadErr } = await admin
      .from("scheduled_trips")
      .select("id, status, seats_available")
      .eq("id", sid)
      .maybeSingle();
    if (tripLoadErr || !tripRow) {
      return jsonRes({ error: "Viagem não encontrada." }, 404);
    }
    if ((tripRow.status as string) !== "active") {
      return jsonRes({ error: "Esta viagem não está disponível para reserva." }, 400);
    }
    const seatsAvail = Number(tripRow.seats_available ?? 0);
    if (!Number.isFinite(seatsAvail) || seatsAvail < pax) {
      return jsonRes({ error: "Viagem lotada" }, 409);
    }

    // ── 5) Preço recalculado no servidor (bloco canônico compartilhado) ──
    const priced = await computeBookingDraftPricing(admin, userId, sid);
    if ("error" in priced) {
      return jsonRes({ error: priced.error }, priced.status);
    }
    const { adjustedBaseCents, pricing, promo, chargeAmountCents } = priced;

    // ── 6) pix_charges ANTES do provedor + booking pending (vaga segurada) ──
    // O id do booking é gerado aqui para a charge nascer com entity_id e o
    // booking nascer com pix_charge_id (o gate de notificação da migration
    // 20260826000005 exige pix_charge_id NOT NULL no INSERT).
    const bookingId = crypto.randomUUID();
    const ttlMinutes = setting.charge_ttl_minutes;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    const { data: chargeInserted, error: chargeInsErr } = await admin
      .from("pix_charges")
      .insert({
        provider: provider.name,
        provider_env: provider.env,
        provider_charge_id: null,
        entity_type: "booking",
        entity_id: bookingId,
        user_id: userId,
        expected_amount_cents: chargeAmountCents,
        status: "pending",
        expires_at: expiresAt,
      } as never)
      .select("id")
      .single();
    if (chargeInsErr || !chargeInserted?.id) {
      console.error("[create-pix-charge] insert pix_charges:", chargeInsErr?.message);
      return jsonRes({ error: "Não foi possível iniciar a cobrança Pix." }, 500);
    }
    const chargeId = chargeInserted.id as string;

    const passengerDataJson = draft.passenger_data ?? [];
    const insertRow = {
      id: bookingId,
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
      price_route_base_cents: adjustedBaseCents,
      pricing_subtotal_cents: pricing.worker_earning_cents,
      pricing_surcharges_cents: pricing.surcharges_cents,
      platform_fee_cents: pricing.admin_fee_cents,
      promo_discount_cents: pricing.promo_discount_cents,
      promo_gain_cents: pricing.promo_gain_cents,
      worker_earning_cents: pricing.worker_earning_cents,
      admin_earning_cents: pricing.admin_earning_cents,
      promotion_id: promo.promotion_id || null,
      promo_worker_route_id: promo.promo_worker_route_id,
      admin_pct_applied: pricing.admin_pct_applied,
      amount_cents: chargeAmountCents,
      platform_fee_extra_debit_cents: 0,
      status: "pending",
      payment_method: "pix",
      pix_charge_id: chargeId,
      updated_at: new Date().toISOString(),
    };

    const { error: insErr } = await admin.from("bookings").insert(insertRow as never);
    if (insErr) {
      await markChargeCreateFailed(admin, chargeId, `insert booking: ${insErr.message}`);
      // Trigger de capacidade: "Capacidade insuficiente ou viagem indisponível…"
      if (insErr.message?.includes("Capacidade insuficiente")) {
        return jsonRes({ error: "Viagem lotada" }, 409);
      }
      console.error(
        "[create-pix-charge] insert booking:",
        JSON.stringify({ message: insErr.message, details: insErr.details, hint: insErr.hint, code: insErr.code }),
      );
      return jsonRes({ error: "Não foi possível registrar a reserva." }, 500);
    }

    // ── 7) Cria a cobrança no provedor (externalReference = pix_charges.id) ──
    const customerName = ((profile?.full_name as string | null) ?? "").trim() || "Cliente Take Me";
    let created;
    try {
      created = await provider.createCharge({
        internalId: chargeId,
        userId,
        amountCents: chargeAmountCents,
        cpfDigits,
        customerName,
        description: "Take Me — reserva de viagem",
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("[create-pix-charge] provedor falhou:", reason);
      // ORDEM IMPORTA: cancela o booking ANTES de marcar a charge como
      // create_failed. Se a function morrer/falhar entre os dois writes, a
      // charge continua 'pending' e o cron expire-pix-charges resgata (cancela
      // o booking e devolve a vaga). Na ordem inversa, um crash deixaria o
      // booking 'pending' segurando assento com a charge já fora da varredura.
      // cancellation_reason 'pix_create_failed' é gateado: zero notificações.
      const cancelIso = new Date().toISOString();
      const { error: cancelErr } = await admin
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_by: "system",
          cancelled_at: cancelIso,
          cancellation_reason: "pix_create_failed",
          updated_at: cancelIso,
        } as never)
        .eq("id", bookingId)
        .eq("status", "pending");
      if (cancelErr) console.error("[create-pix-charge] cancel booking:", cancelErr.message);
      await markChargeCreateFailed(admin, chargeId, reason);
      return jsonRes({ error: "Provedor Pix indisponível no momento. Tente novamente." }, 502);
    }

    const { error: qrErr } = await admin
      .from("pix_charges")
      .update({
        provider_charge_id: created.providerChargeId,
        qr_payload: created.qrPayload,
        qr_image_base64: created.qrImageBase64,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", chargeId);
    if (qrErr) {
      // A cobrança existe no provedor; o webhook ainda acha a charge pelo
      // externalReference. Loga e segue devolvendo o QR ao cliente.
      console.error("[create-pix-charge] update QR na charge:", qrErr.message);
    }

    return chargeResponse({
      id: chargeId,
      entity_id: bookingId,
      expected_amount_cents: chargeAmountCents,
      qr_payload: created.qrPayload,
      qr_image_base64: created.qrImageBase64,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error("create-pix-charge:", err);
    return jsonRes(
      { error: err instanceof Error ? err.message : "Erro ao criar cobrança Pix" },
      500,
    );
  }
});
