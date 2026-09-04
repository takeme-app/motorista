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
      /** Encomenda: payload de insert montado pelo app (mesmo do caminho cartão). */
      shipment_draft?: Record<string, unknown>;
      /** Envio de dependente: idem (o preço também é do app). */
      dependent_draft?: Record<string, unknown>;
      /** Excursão: o pedido JÁ existe (orçado); só anexamos a cobrança. */
      excursion_request_id?: string;
      /**
       * RENOVAÇÃO: id de uma cobrança já emitida. Devolve a MESMA se ainda
       * estiver válida; emite outra para o mesmo pedido se tiver expirado.
       * Dispensa entity_type — ele vem da própria cobrança.
       */
      renew_pix_charge_id?: string;
    };

    const renewId = body.renew_pix_charge_id?.trim();
    const entityType = (body.entity_type ?? "").trim();
    if (
      !renewId &&
      entityType !== "booking" &&
      entityType !== "shipment" &&
      entityType !== "dependent_shipment" &&
      entityType !== "excursion"
    ) {
      return jsonRes(
        { error: `entity_type '${entityType || "?"}' ainda não suportado no Pix real (fases 2+).` },
        501,
      );
    }

    const sid = body.scheduled_trip_id?.trim();
    const draft = body.draft;
    if (!renewId && entityType === "booking" && (!sid || !draft)) {
      return jsonRes({ error: "scheduled_trip_id e draft são obrigatórios." }, 400);
    }
    if (!renewId && entityType === "shipment" && !body.shipment_draft) {
      return jsonRes({ error: "shipment_draft é obrigatório." }, 400);
    }
    if (!renewId && entityType === "dependent_shipment" && !body.dependent_draft) {
      return jsonRes({ error: "dependent_draft é obrigatório." }, 400);
    }
    if (!renewId && entityType === "excursion" && !body.excursion_request_id?.trim()) {
      return jsonRes({ error: "excursion_request_id é obrigatório." }, 400);
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

    // ══ RENOVAÇÃO DE COBRANÇA ═════════════════════════════════════════
    // O cliente voltou ao pedido e pediu o código de novo. Dois casos:
    //   ainda válida  → devolve a MESMA (não abre cobrança nova no provedor,
    //                   nem deixa duas em aberto para o mesmo pedido);
    //   expirada      → emite outra para o MESMO pedido.
    //
    // Sem isto o cliente ficava preso: o código expirava, o cron leva até 2
    // minutos para cancelar o pedido, e nessa janela a tela só sabia dizer
    // "este código não está mais disponível".
    if (renewId) {
      const { data: oldChargeRow } = await admin
        .from("pix_charges")
        .select("id, entity_type, entity_id, user_id, status, expires_at, qr_payload, qr_image_base64, expected_amount_cents")
        .eq("id", renewId)
        .maybeSingle();
      const oldCharge = oldChargeRow as {
        id: string;
        entity_type: string;
        entity_id: string;
        user_id: string;
        status: string;
        expires_at: string | null;
        qr_payload: string | null;
        qr_image_base64: string | null;
        expected_amount_cents: number;
      } | null;
      if (!oldCharge || oldCharge.user_id !== userId) {
        return jsonRes({ error: "Cobrança não encontrada." }, 404);
      }

      // Ainda no prazo e pagável: devolve exatamente a mesma.
      const stillValid =
        oldCharge.status === "pending" &&
        oldCharge.qr_payload &&
        oldCharge.expires_at &&
        Date.parse(oldCharge.expires_at) > Date.now();
      if (stillValid) {
        return jsonRes({
          ok: true,
          pix_charge_id: oldCharge.id,
          entity_type: oldCharge.entity_type,
          entity_id: oldCharge.entity_id,
          amount_cents: oldCharge.expected_amount_cents,
          qr_payload: oldCharge.qr_payload,
          qr_image_base64: oldCharge.qr_image_base64,
          expires_at: oldCharge.expires_at,
          reused: true,
        });
      }

      if (oldCharge.status === "paid") {
        return jsonRes({ error: "Este pedido já foi pago." }, 409);
      }

      // Configuração do pedido por tipo: onde ler o valor e quais estados
      // ainda aceitam pagamento.
      const RENEWABLE = {
        booking: { table: "bookings", amount: "amount_cents", ok: ["pending"] },
        shipment: { table: "shipments", amount: "amount_cents", ok: ["confirmed", "pending_review"] },
        dependent_shipment: {
          table: "dependent_shipments",
          amount: "amount_cents",
          ok: ["confirmed", "pending_review"],
        },
        excursion: { table: "excursion_requests", amount: "total_amount_cents", ok: ["quoted"] },
      } as const;
      const cfgRenew = RENEWABLE[oldCharge.entity_type as keyof typeof RENEWABLE];
      if (!cfgRenew) {
        return jsonRes({ error: "Tipo de pedido não suporta nova cobrança." }, 400);
      }

      const { data: orderRow } = await admin
        .from(cfgRenew.table)
        .select(`id, user_id, status, pix_paid_at, ${cfgRenew.amount}`)
        .eq("id", oldCharge.entity_id)
        .maybeSingle();
      const order = orderRow as Record<string, unknown> | null;
      if (!order || String(order.user_id) !== userId) {
        return jsonRes({ error: "Pedido não encontrado." }, 404);
      }
      if (order.pix_paid_at) {
        return jsonRes({ error: "Este pedido já foi pago." }, 409);
      }
      const orderStatus = String(order.status ?? "");
      if (!(cfgRenew.ok as readonly string[]).includes(orderStatus)) {
        // Caso mais comum: o cron já cancelou o pedido depois da expiração.
        return jsonRes(
          {
            error: "order_not_payable",
            message:
              "Este pedido não está mais disponível para pagamento porque o código expirou. Faça uma nova solicitação.",
          },
          409,
        );
      }

      const amountRenew = Math.floor(Number(order[cfgRenew.amount] ?? 0));
      if (!Number.isInteger(amountRenew) || amountRenew < 1) {
        return jsonRes({ error: "Valor do pedido inválido." }, 400);
      }

      // Fecha a antiga que ainda estiver 'pending' (expirada mas não varrida),
      // para não ficar cobrança órfã em aberto no provedor.
      if (oldCharge.status === "pending") {
        await admin
          .from("pix_charges")
          .update({ status: "expired", updated_at: new Date().toISOString() } as never)
          .eq("id", oldCharge.id)
          .eq("status", "pending");
      }

      const ttlRenew = setting.charge_ttl_minutes;
      const expiresAtRenew = new Date(Date.now() + ttlRenew * 60 * 1000).toISOString();
      const { data: newChargeRow, error: newChargeErr } = await admin
        .from("pix_charges")
        .insert({
          provider: provider.name,
          provider_env: provider.env,
          provider_charge_id: null,
          entity_type: oldCharge.entity_type,
          entity_id: oldCharge.entity_id,
          user_id: userId,
          expected_amount_cents: amountRenew,
          status: "pending",
          expires_at: expiresAtRenew,
        } as never)
        .select("id")
        .single();
      if (newChargeErr || !newChargeRow?.id) {
        console.error("[create-pix-charge] renovação: insert pix_charges:", newChargeErr?.message);
        return jsonRes({ error: "Não foi possível gerar um novo código Pix." }, 500);
      }
      const newChargeId = newChargeRow.id as string;

      const customerNameRenew = ((profile?.full_name as string | null) ?? "").trim() || "Cliente Take Me";
      let createdRenew;
      try {
        createdRenew = await provider.createCharge({
          internalId: newChargeId,
          userId,
          amountCents: amountRenew,
          cpfDigits,
          customerName: customerNameRenew,
          description: "Take Me — novo código Pix",
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error("[create-pix-charge] renovação: provedor falhou:", reason);
        await markChargeCreateFailed(admin, newChargeId, reason);
        return jsonRes({ error: "Provedor Pix indisponível no momento. Tente novamente." }, 502);
      }

      await admin
        .from("pix_charges")
        .update({
          provider_charge_id: createdRenew.providerChargeId,
          qr_payload: createdRenew.qrPayload,
          qr_image_base64: createdRenew.qrImageBase64,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", newChargeId);

      // Aponta o pedido para a cobrança nova, senão os gatilhos e a tela
      // continuariam olhando para a antiga.
      await admin
        .from(cfgRenew.table)
        .update({ pix_charge_id: newChargeId, updated_at: new Date().toISOString() } as never)
        .eq("id", oldCharge.entity_id);

      return jsonRes({
        ok: true,
        pix_charge_id: newChargeId,
        entity_type: oldCharge.entity_type,
        entity_id: oldCharge.entity_id,
        amount_cents: amountRenew,
        qr_payload: createdRenew.qrPayload,
        qr_image_base64: createdRenew.qrImageBase64,
        expires_at: expiresAtRenew,
        renewed: true,
      });
    }

    // ══ EXCURSÃO ══════════════════════════════════════════════════════
    // Único fluxo em que o pedido JÁ EXISTE quando o Pix é gerado: o cliente
    // pede, o preparador orça ('quoted') e o pagamento é que aprova. Então aqui
    // NÃO inserimos nada — só anexamos a cobrança ao orçamento existente.
    // Espelha o charge-excursion-request (cartão): mesma validação, mesma
    // promoção, mesmo valor líquido cobrado; a transição para 'approved' e os
    // payouts ficam na liquidação (entities.ts), como no stripe-webhook.
    if (entityType === "excursion") {
      const excursionId = body.excursion_request_id!.trim();

      const { data: excRow, error: excErr } = await admin
        .from("excursion_requests")
        .select(
          "id, user_id, total_amount_cents, worker_payout_cents, admin_earning_cents, status, stripe_payment_intent_id, pix_charge_id, pix_paid_at",
        )
        .eq("id", excursionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (excErr || !excRow) {
        return jsonRes({ error: "Orçamento não encontrado ou não pertence ao usuário." }, 404);
      }
      const exc = excRow as {
        total_amount_cents: number | null;
        worker_payout_cents: number | null;
        admin_earning_cents: number | null;
        status: string;
        stripe_payment_intent_id: string | null;
        pix_charge_id: string | null;
        pix_paid_at: string | null;
      };

      if (exc.stripe_payment_intent_id) {
        return jsonRes(
          { error: "Este orçamento já foi cobrado no cartão; não pode ser pago por Pix." },
          400,
        );
      }
      if (exc.pix_paid_at) {
        return jsonRes({ error: "Este orçamento já foi pago." }, 400);
      }
      if (exc.status !== "quoted") {
        return jsonRes(
          {
            error: exc.status === "approved"
              ? "Este orçamento já foi aprovado/pago."
              : `Status atual (${exc.status}) não permite pagamento; aguarde o orçamento.`,
          },
          400,
        );
      }

      const totalCents = Number(exc.total_amount_cents);
      if (!Number.isInteger(totalCents) || totalCents < 1) {
        return jsonRes(
          { error: "Orçamento sem valor definido ainda; solicite ao preparador." },
          400,
        );
      }

      // Retomada: cobrança pendente e não expirada deste MESMO orçamento devolve
      // o QR existente. Sem isto, cada toque em "pagar" abriria uma cobrança
      // nova no Asaas para o mesmo pedido — e o cliente poderia pagar duas.
      const nowIsoExc = new Date().toISOString();
      const { data: openCharge } = await admin
        .from("pix_charges")
        .select("id, qr_payload, qr_image_base64, expires_at, expected_amount_cents")
        .eq("entity_type", "excursion")
        .eq("entity_id", excursionId)
        .eq("status", "pending")
        .gt("expires_at", nowIsoExc)
        .not("qr_payload", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openCharge?.id) {
        const c = openCharge as {
          id: string;
          qr_payload: string;
          qr_image_base64: string | null;
          expires_at: string;
          expected_amount_cents: number;
        };
        return jsonRes({
          ok: true,
          pix_charge_id: c.id,
          entity_type: "excursion",
          entity_id: excursionId,
          amount_cents: c.expected_amount_cents,
          qr_payload: c.qr_payload,
          qr_image_base64: c.qr_image_base64,
          expires_at: c.expires_at,
          resumed: true,
        });
      }

      // Promoção: mesmo cálculo do charge-excursion-request — o desconto é
      // absorvido pela plataforma (cap no resíduo dela) e cobramos o líquido.
      let discountCents = 0;
      let promotionId: string | null = null;
      try {
        const { data: promo } = await admin.rpc("apply_active_promotion", {
          p_order_type: "excursions",
          p_user_id: userId,
          p_amount_cents: totalCents,
        });
        const promoRow = (Array.isArray(promo) ? promo[0] : promo) as
          | { promotion_id?: string | null; promo_discount_cents?: number | null }
          | null;
        if (promoRow) {
          const adminCap = Math.max(0, totalCents - (Number(exc.worker_payout_cents) || 0));
          discountCents = Math.max(
            0,
            Math.min(Math.floor(Number(promoRow.promo_discount_cents) || 0), adminCap),
          );
          promotionId = promoRow.promotion_id ?? null;
        }
      } catch (_e) {
        /* sem promoção ativa */
      }
      const chargeCentsExc = Math.max(1, totalCents - discountCents);

      const ttlExc = setting.charge_ttl_minutes;
      const expiresAtExc = new Date(Date.now() + ttlExc * 60 * 1000).toISOString();

      const { data: chargeInsExc, error: chargeErrExc } = await admin
        .from("pix_charges")
        .insert({
          provider: provider.name,
          provider_env: provider.env,
          provider_charge_id: null,
          entity_type: "excursion",
          entity_id: excursionId,
          user_id: userId,
          expected_amount_cents: chargeCentsExc,
          status: "pending",
          expires_at: expiresAtExc,
        } as never)
        .select("id")
        .single();
      if (chargeErrExc || !chargeInsExc?.id) {
        console.error("[create-pix-charge] insert pix_charges (excursion):", chargeErrExc?.message);
        return jsonRes({ error: "Não foi possível iniciar a cobrança Pix." }, 500);
      }
      const chargeIdExc = chargeInsExc.id as string;

      // Anexa a cobrança ao orçamento (guard em 'quoted': se o preparador ou o
      // cartão mudaram o status no meio, não sobrescreve).
      const { data: attached, error: attachErr } = await admin
        .from("excursion_requests")
        .update({
          pix_charge_id: chargeIdExc,
          ...(discountCents > 0
            ? {
              promo_discount_cents: discountCents,
              ...(promotionId ? { promotion_id: promotionId } : {}),
            }
            : {}),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", excursionId)
        .eq("status", "quoted")
        .select("id");
      if (attachErr || !Array.isArray(attached) || attached.length === 0) {
        await markChargeCreateFailed(
          admin,
          chargeIdExc,
          `anexar cobrança ao orçamento: ${attachErr?.message ?? "status mudou"}`,
        );
        return jsonRes({ error: "O orçamento mudou de estado. Recarregue e tente de novo." }, 409);
      }

      const customerNameExc = ((profile?.full_name as string | null) ?? "").trim() || "Cliente Take Me";
      let createdExc;
      try {
        createdExc = await provider.createCharge({
          internalId: chargeIdExc,
          userId,
          amountCents: chargeCentsExc,
          cpfDigits,
          customerName: customerNameExc,
          description: "Take Me — excursão",
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error("[create-pix-charge] provedor falhou (excursion):", reason);
        // A excursão EXISTIA antes da cobrança: não cancelar o orçamento, só
        // desanexar para o cliente poder tentar de novo.
        const { error: detachErr } = await admin
          .from("excursion_requests")
          .update({ pix_charge_id: null, updated_at: new Date().toISOString() } as never)
          .eq("id", excursionId)
          .eq("pix_charge_id", chargeIdExc);
        if (detachErr) console.error("[create-pix-charge] detach excursion:", detachErr.message);
        await markChargeCreateFailed(admin, chargeIdExc, reason);
        return jsonRes({ error: "Provedor Pix indisponível no momento. Tente novamente." }, 502);
      }

      const { error: qrErrExc } = await admin
        .from("pix_charges")
        .update({
          provider_charge_id: createdExc.providerChargeId,
          qr_payload: createdExc.qrPayload,
          qr_image_base64: createdExc.qrImageBase64,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", chargeIdExc);
      if (qrErrExc) console.error("[create-pix-charge] update QR (excursion):", qrErrExc.message);

      return jsonRes({
        ok: true,
        pix_charge_id: chargeIdExc,
        entity_type: "excursion",
        entity_id: excursionId,
        amount_cents: chargeCentsExc,
        qr_payload: createdExc.qrPayload,
        qr_image_base64: createdExc.qrImageBase64,
        expires_at: expiresAtExc,
      });
    }

    // ══ ENCOMENDA e ENVIO DE DEPENDENTE ═══════════════════════════════
    // Diferente da viagem, o preço destes dois é calculado no app (depende de
    // rota/base/distância e vive em shipmentQuote.ts / dependentPricing). O
    // caminho do CARTÃO já funciona assim — o app insere a linha e a função de
    // cobrança apenas lê o amount_cents dela. Aqui seguimos a MESMA forma, com
    // uma diferença importante: quem insere é o SERVIDOR, para que a linha já
    // nasça com pix_charge_id e o gatilho que aciona o motorista não dispare
    // antes do pagamento.
    //
    //   encomenda  → gatilho de FILA de ofertas (shipment_pix_real_queue_gate)
    //   dependente → gatilho de NOTIFICAÇÃO do motorista da viagem escolhida
    //                (dependent_shipment_pix_real_notify_gate)
    //
    // O que libera os dois é o mesmo: pix_paid_at deixar de ser nulo.
    const PIX_APP_PRICED_ENTITIES = {
      shipment: {
        table: "shipments",
        label: "a encomenda",
        draft: body.shipment_draft,
        description: "Take Me — envio de encomenda",
        defaultStatus: "confirmed",
        // Whitelist: o app manda o payload inteiro, mas só estes campos entram.
        // Sem isto um cliente poderia se autoatribuir driver_id,
        // admin_approved_at ou driver_offer_index e furar a fila de ofertas.
        fields: [
          "origin_address", "origin_lat", "origin_lng", "origin_city",
          "destination_address", "destination_lat", "destination_lng",
          "client_preferred_driver_id", "scheduled_trip_id", "base_id",
          "when_option", "scheduled_at", "package_size",
          "recipient_name", "recipient_email", "recipient_phone", "instructions",
          "photo_url", "photo_paths",
          "pricing_route_id", "price_route_base_cents", "pricing_subtotal_cents",
          "pricing_surcharges_cents", "platform_fee_cents", "promo_discount_cents",
          "promo_gain_cents", "worker_earning_cents", "admin_earning_cents",
          "admin_pct_applied", "promotion_id", "promo_worker_route_id",
          "preparer_payout_cents", "preparer_id", "amount_cents",
        ],
      },
      dependent_shipment: {
        table: "dependent_shipments",
        label: "o envio do dependente",
        draft: body.dependent_draft,
        description: "Take Me — envio de dependente",
        // O envio de dependente sempre nasce em análise (o motorista aceita).
        defaultStatus: "pending_review",
        // Mesma regra da encomenda: fora daqui, nada do app entra na linha —
        // em especial driver_request_notified_at, que silenciaria a
        // notificação do motorista, e stripe_payment_intent_id.
        fields: [
          "dependent_id", "full_name", "contact_phone", "bags_count",
          "instructions", "receiver_name",
          "origin_address", "origin_lat", "origin_lng",
          "destination_address", "destination_lat", "destination_lng",
          "when_option", "scheduled_at", "scheduled_trip_id",
          "photo_url", "photo_paths",
          "pricing_route_id", "price_route_base_cents", "pricing_subtotal_cents",
          "pricing_surcharges_cents", "platform_fee_cents", "promo_discount_cents",
          "promo_gain_cents", "worker_earning_cents", "admin_earning_cents",
          "worker_payout_cents", "admin_pct_applied", "promotion_id",
          "promo_worker_route_id", "amount_cents",
        ],
      },
    } as const;

    if (entityType === "shipment" || entityType === "dependent_shipment") {
      const cfg = PIX_APP_PRICED_ENTITIES[entityType];
      const d = (cfg.draft ?? {}) as Record<string, unknown>;
      const amountCents = Math.floor(Number(d.amount_cents ?? 0));
      if (!Number.isInteger(amountCents) || amountCents < 1) {
        return jsonRes({ error: `Valor inválido para ${cfg.label}.` }, 400);
      }

      // Limite de cobranças pendentes por usuário (mesmo teto da viagem).
      const nowIsoApp = new Date().toISOString();
      const { data: pendingApp } = await admin
        .from("pix_charges")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", nowIsoApp);
      if (Array.isArray(pendingApp) && pendingApp.length >= MAX_PENDING_CHARGES_PER_USER) {
        return jsonRes(
          { error: "Você já tem cobranças Pix pendentes demais. Pague ou aguarde expirarem." },
          429,
        );
      }

      const entityRow: Record<string, unknown> = {};
      for (const k of cfg.fields) {
        if (d[k] !== undefined) entityRow[k] = d[k];
      }

      const rawStatus = String(d.status ?? cfg.defaultStatus);
      const status = rawStatus === "pending_review" ? "pending_review" : cfg.defaultStatus;

      const entityId = crypto.randomUUID();
      const ttlApp = setting.charge_ttl_minutes;
      const expiresAtApp = new Date(Date.now() + ttlApp * 60 * 1000).toISOString();

      const { data: chargeIns, error: chargeErrApp } = await admin
        .from("pix_charges")
        .insert({
          provider: provider.name,
          provider_env: provider.env,
          provider_charge_id: null,
          entity_type: entityType,
          entity_id: entityId,
          user_id: userId,
          expected_amount_cents: amountCents,
          status: "pending",
          expires_at: expiresAtApp,
        } as never)
        .select("id")
        .single();
      if (chargeErrApp || !chargeIns?.id) {
        console.error(`[create-pix-charge] insert pix_charges (${entityType}):`, chargeErrApp?.message);
        return jsonRes({ error: "Não foi possível iniciar a cobrança Pix." }, 500);
      }
      const chargeIdApp = chargeIns.id as string;

      const { error: entityInsErr } = await admin.from(cfg.table).insert({
        ...entityRow,
        id: entityId,
        user_id: userId,
        payment_method: "pix",
        status,
        pix_charge_id: chargeIdApp,
      } as never);
      if (entityInsErr) {
        await markChargeCreateFailed(admin, chargeIdApp, `insert ${cfg.table}: ${entityInsErr.message}`);
        console.error(`[create-pix-charge] insert ${cfg.table}:`, entityInsErr.message);
        return jsonRes({ error: `Não foi possível registrar ${cfg.label}.` }, 500);
      }

      const customerNameApp = ((profile?.full_name as string | null) ?? "").trim() || "Cliente Take Me";
      let createdApp;
      try {
        createdApp = await provider.createCharge({
          internalId: chargeIdApp,
          userId,
          amountCents,
          cpfDigits,
          customerName: customerNameApp,
          description: cfg.description,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error(`[create-pix-charge] provedor falhou (${entityType}):`, reason);
        // Mesma ordem da viagem: cancela o pedido ANTES de marcar a charge, para
        // que um crash no meio deixe a charge 'pending' e o cron resgate.
        const cancelIso = new Date().toISOString();
        const { error: cancelErr } = await admin
          .from(cfg.table)
          .update({
            status: "cancelled",
            cancellation_reason: "pix_create_failed",
            updated_at: cancelIso,
          } as never)
          .eq("id", entityId);
        if (cancelErr) console.error(`[create-pix-charge] cancel ${cfg.table}:`, cancelErr.message);
        await markChargeCreateFailed(admin, chargeIdApp, reason);
        return jsonRes({ error: "Provedor Pix indisponível no momento. Tente novamente." }, 502);
      }

      const { error: qrErrApp } = await admin
        .from("pix_charges")
        .update({
          provider_charge_id: createdApp.providerChargeId,
          qr_payload: createdApp.qrPayload,
          qr_image_base64: createdApp.qrImageBase64,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", chargeIdApp);
      if (qrErrApp) console.error(`[create-pix-charge] update QR (${entityType}):`, qrErrApp.message);

      return jsonRes({
        ok: true,
        pix_charge_id: chargeIdApp,
        entity_type: entityType,
        entity_id: entityId,
        amount_cents: amountCents,
        qr_payload: createdApp.qrPayload,
        qr_image_base64: createdApp.qrImageBase64,
        expires_at: expiresAtApp,
      });
    }

    // ── 3a) Já tem reserva ativa nesta viagem? ──
    // Uma reserva ATIVA por usuário por viagem (índice parcial
    // bookings_one_active_per_user_trip garante no banco). Sem isto, quem já
    // pagou conseguia reservar a MESMA viagem de novo e pagar um segundo Pix —
    // aconteceu em produção (usuário pagou R$ 10 numa viagem de R$ 5, provável
    // por não ter visto a confirmação do primeiro pagamento). Pix não tem
    // estorno automático, então o dinheiro extra ficava preso na fila manual.
    //
    // 'pending' entra na checagem porque uma reserva pendente de OUTRO método
    // (dinheiro, paliativo) também ocupa a vaga — a dedup logo abaixo só
    // enxerga pendentes com cobrança Pix.
    const { data: existingBooking } = await admin
      .from("bookings")
      .select("id, status, payment_method")
      .eq("user_id", userId)
      .eq("scheduled_trip_id", sid)
      .in("status", ["pending", "paid", "confirmed"])
      .limit(1);
    const existingRow = Array.isArray(existingBooking) ? existingBooking[0] : undefined;
    // Reserva Pix ainda pendente cai na dedup de retomada abaixo (devolve o
    // MESMO QR em vez de barrar) — só bloqueia aqui o que ela não cobre.
    const isResumablePixPending =
      existingRow?.status === "pending" && existingRow?.payment_method === "pix";
    if (existingRow && !isResumablePixPending) {
      return jsonRes(
        {
          error: "Você já tem uma reserva nesta viagem. Para mudar a quantidade de lugares, cancele a reserva atual e faça uma nova.",
          code: "already_booked",
          booking_id: existingRow.id,
        },
        409,
      );
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
    const priced = await computeBookingDraftPricing(admin, userId, sid, pax);
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
