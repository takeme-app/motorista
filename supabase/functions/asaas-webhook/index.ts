import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createPixProvider } from "../_shared/pixProviders/index.ts";
import {
  PIX_CHARGE_ROW_COLUMNS,
  type PixChargeRow,
  queuePixRefund,
  settlePixCharge,
  type SettleResult,
} from "../_shared/pixProviders/settle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "asaas-access-token, content-type",
};

/**
 * asaas-webhook — confirma pagamentos Pix do Asaas.
 *
 * Diferenças em relação ao stripe-webhook (por design do Asaas):
 *   - autenticação por token estático no header `asaas-access-token`
 *     (ASAAS_WEBHOOK_TOKEN, mesmo valor cadastrado no painel) comparado em
 *     TEMPO CONSTANTE — 401 antes de qualquer escrita;
 *   - payload NÃO assinado ⇒ NUNCA é fonte de verdade: sempre re-consulta
 *     GET /payments/{id} antes de agir;
 *   - dedup por tabela payment_webhook_events (UNIQUE provider+event_id) com
 *     upsert ignoreDuplicates — o Stripe usa guardas condicionais, aqui a fila
 *     sequencial do Asaas reenvia eventos e trava em não-2xx;
 *   - SEMPRE 200 depois de registrar o evento (erro vira
 *     processing_result='error:…'; reconcile-pix é a rede de segurança) —
 *     o stripe-webhook usa 500 p/ retry, aqui 500 travaria a fila.
 */

/** Comparação em tempo constante: SHA-256 dos dois valores + XOR byte a byte. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Eventos que nos interessam (mesma lista habilitada no painel do Asaas). */
const HANDLED_EVENTS = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
]);

async function setProcessingResult(
  admin: SupabaseClient,
  eventRowId: string,
  result: SettleResult | string,
): Promise<void> {
  const { error } = await admin
    .from("payment_webhook_events")
    .update({ processing_result: String(result).slice(0, 500) } as never)
    .eq("id", eventRowId);
  if (error) console.error("[asaas-webhook] processing_result:", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !webhookToken) {
    return jsonRes({ error: "Configuração incompleta no servidor" }, 500);
  }

  // ── Autenticação ANTES de qualquer escrita ──
  const received = req.headers.get("asaas-access-token") ?? "";
  if (!received || !(await timingSafeEqual(received, webhookToken))) {
    return jsonRes({ error: "Não autorizado" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    event?: string;
    payment?: { id?: string };
  } | null;
  if (!body) {
    return jsonRes({ received: true, ignored: "payload inválido" });
  }

  const eventType = (body.event ?? "").trim();
  const paymentId = (body.payment?.id ?? "").trim();
  // Asaas manda `id` do evento (evt_…); fallback sintético para versões antigas.
  const eventId = (body.id ?? "").trim() || (eventType && paymentId ? `${eventType}:${paymentId}` : "");
  if (!eventId) {
    return jsonRes({ received: true, ignored: "evento sem id/payment" });
  }

  // ── Dedup: 0 linhas inseridas = evento repetido ──
  const { data: insertedEvents, error: dedupErr } = await admin
    .from("payment_webhook_events")
    .upsert(
      {
        provider: "asaas",
        event_id: eventId,
        event_type: eventType || null,
        provider_charge_id: paymentId || null,
        payload: body,
      } as never,
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("id");
  if (dedupErr) {
    // Sem registro de evento não dá para garantir idempotência: 500 força o
    // retry da fila do Asaas (única exceção ao "sempre 200").
    console.error("[asaas-webhook] dedup insert:", dedupErr.message);
    return jsonRes({ error: "Falha ao registrar evento" }, 500);
  }
  const eventRow = (insertedEvents ?? [])[0] as { id: string } | undefined;
  if (!eventRow) {
    return jsonRes({ received: true, duplicate: true });
  }

  // A partir daqui: SEMPRE 200 (erros viram processing_result='error:…').
  try {
    if (!HANDLED_EVENTS.has(eventType) || !paymentId) {
      await setProcessingResult(admin, eventRow.id, "ignored");
      return jsonRes({ received: true, ignored: eventType || "sem payment" });
    }

    // ── Re-consulta OBRIGATÓRIA: o payload nunca é fonte de verdade ──
    let fresh;
    try {
      const provider = createPixProvider(admin, "asaas");
      fresh = await provider.getChargeStatus(paymentId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[asaas-webhook] re-consulta falhou:", msg);
      await setProcessingResult(admin, eventRow.id, `error:reconsulta: ${msg}`);
      return jsonRes({ received: true, deferred: true });
    }

    // ── Localiza a charge: (provider, provider_charge_id) → externalReference ──
    let charge: PixChargeRow | null = null;
    {
      const { data } = await admin
        .from("pix_charges")
        .select(PIX_CHARGE_ROW_COLUMNS)
        .eq("provider", "asaas")
        .eq("provider_charge_id", paymentId)
        .maybeSingle();
      charge = (data as PixChargeRow | null) ?? null;
    }
    if (!charge && fresh.externalReference) {
      // create em voo: a charge existe mas ainda sem provider_charge_id.
      const { data } = await admin
        .from("pix_charges")
        .select(PIX_CHARGE_ROW_COLUMNS)
        .eq("id", fresh.externalReference)
        .eq("provider", "asaas")
        .maybeSingle();
      charge = (data as PixChargeRow | null) ?? null;
    }

    if (!charge) {
      // Pagamento órfão (sem par no banco): registra devolução manual se pago.
      if (fresh.status === "paid") {
        await queuePixRefund(admin, {
          pix_charge_id: null,
          entity_type: null,
          entity_id: null,
          user_id: null,
          amount_cents: fresh.paidAmountCents ?? 0,
          reason: "orphan_payment",
          notes: `asaas payment ${paymentId} sem par em pix_charges (webhook)`,
        });
        await setProcessingResult(admin, eventRow.id, "orphan");
        return jsonRes({ received: true, orphan: true });
      }
      await setProcessingResult(admin, eventRow.id, "ignored");
      return jsonRes({ received: true, ignored: "sem par no banco" });
    }

    const result = await settlePixCharge(admin, charge, fresh);
    await setProcessingResult(admin, eventRow.id, result);
    return jsonRes({ received: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[asaas-webhook] handler error:", msg);
    await setProcessingResult(admin, eventRow.id, `error:${msg}`);
    return jsonRes({ received: true, error_recorded: true });
  }
});
