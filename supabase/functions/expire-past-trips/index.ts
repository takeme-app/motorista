import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * expire-past-trips — cancela (e estorna) pedidos cujo DIA agendado já passou e
 * que NÃO foram realizados (motorista não aceitou/não iniciou).
 *
 * Cobre: shipments, dependent_shipments e bookings. (Excursão fica de fora.)
 *
 * Regra de tempo ("depois do dia"): cancela quando o instante agendado é anterior
 * ao início do dia de HOJE no fuso America/Sao_Paulo (UTC-3, sem horário de verão
 * no Brasil desde 2019). Ou seja, só quando o dia inteiro já passou.
 *
 * Estorno: chama process-refund (service role). Para pagos via Stripe ele estorna
 * E cancela. Para não pagos/dinheiro (sem stripe_payment_intent_id) ele retorna
 * 400 — nesse caso cancelamos a linha aqui mesmo. A notificação ao cliente sai
 * do trigger de mudança de status.
 */

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isServiceRoleToken(token: string): boolean {
  const p = decodeJwtPayload(token);
  return p?.role === "service_role" && p?.iss === "supabase";
}

/** Início do dia de hoje em America/Sao_Paulo (UTC-3), como instante UTC ISO. */
function startOfTodaySaoPauloUtcIso(): string {
  const SP_OFFSET_HOURS = 3; // UTC-3 fixo (Brasil sem DST)
  const nowSp = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000);
  const y = nowSp.getUTCFullYear();
  const m = nowSp.getUTCMonth();
  const d = nowSp.getUTCDate();
  // 00:00 SP == 03:00 UTC do mesmo dia.
  return new Date(Date.UTC(y, m, d, SP_OFFSET_HOURS, 0, 0)).toISOString();
}

type Admin = ReturnType<typeof createClient>;

/**
 * Pix real: pedido pago via pix_charges (pix_paid_at) NÃO tem
 * stripe_payment_intent_id — cai no branch "sem pagamento" e seria cancelado
 * ficando com o dinheiro do cliente. Antes de cancelar, enfileira a devolução
 * manual (pix_refunds_pending, reason 'expired_not_realized'). Best-effort:
 * falha aqui não bloqueia o cancelamento (o reconcile/admin ainda enxergam a
 * charge paga com pedido cancelado).
 */
async function queuePixRefundIfPaid(
  admin: Admin,
  entityType: "shipment" | "dependent_shipment" | "booking",
  table: string,
  id: string,
): Promise<void> {
  try {
    const { data } = await admin
      .from(table)
      .select("id, user_id, amount_cents, pix_charge_id, pix_paid_at")
      .eq("id", id)
      .maybeSingle();
    const row = data as {
      user_id?: string | null;
      amount_cents?: number | null;
      pix_charge_id?: string | null;
      pix_paid_at?: string | null;
    } | null;
    if (!row?.pix_paid_at) return;

    // Dedup: não duplica pendência da mesma cobrança+motivo.
    if (row.pix_charge_id) {
      const { data: existing } = await admin
        .from("pix_refunds_pending")
        .select("id")
        .eq("pix_charge_id", row.pix_charge_id)
        .eq("reason", "expired_not_realized")
        .eq("status", "pending")
        .limit(1);
      if (Array.isArray(existing) && existing.length > 0) return;
    }

    const { error } = await admin.from("pix_refunds_pending").insert({
      pix_charge_id: row.pix_charge_id ?? null,
      entity_type: entityType,
      entity_id: id,
      user_id: row.user_id ?? null,
      amount_cents: Math.max(0, Math.floor(Number(row.amount_cents ?? 0))),
      reason: "expired_not_realized",
      notes: "pedido pago via Pix expirou sem ser realizado (expire-past-trips)",
    } as never);
    if (error) console.error(`[expire-past-trips] fila pix ${entityType} ${id}:`, error.message);
  } catch (e) {
    console.error(`[expire-past-trips] fila pix ${entityType} ${id}:`, e);
  }
}

async function refundOrCancel(
  admin: Admin,
  supabaseUrl: string,
  serviceRoleKey: string,
  entityType: "shipment" | "dependent_shipment" | "booking",
  table: string,
  id: string,
  nowIso: string,
): Promise<{ done: boolean; error?: string }> {
  // 1) Tenta estorno via process-refund (ele cancela + estorna pagos via Stripe).
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/process-refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entity_type: entityType,
        entity_id: id,
        reason: "expired_not_realized",
      }),
    });
    if (res.ok) {
      return { done: true };
    }
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    const msg = payload.error ?? "";
    const noPayment =
      msg.includes("payment_intent_id") ||
      msg.includes("sem valor para estorno");
    if (!noPayment) {
      // Erro real (ex.: Stripe falhou). NÃO cancela; tenta no próximo ciclo.
      return { done: false, error: msg || `process-refund ${res.status}` };
    }
    // 2) Não pago via Stripe (dinheiro / Pix real / sem cobrança) — cancela aqui mesmo.
  } catch (e) {
    return { done: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Pix real pago (pix_paid_at): registra devolução manual ANTES de cancelar.
  await queuePixRefundIfPaid(admin, entityType, table, id);

  const update: Record<string, unknown> = { status: "cancelled", updated_at: nowIso };
  if (entityType === "booking") {
    update.cancelled_at = nowIso;
    update.cancellation_reason = "expired_not_realized";
  }
  const { error: updErr } = await admin.from(table).update(update as never).eq("id", id);
  if (updErr) return { done: false, error: updErr.message };
  return { done: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "").trim() ?? "";
    if (!isServiceRoleToken(token) && token !== serviceRoleKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser(token);
      if (!user || user.app_metadata?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const cutoff = startOfTodaySaoPauloUtcIso();
    const nowIso = new Date().toISOString();

    const result = { shipment: 0, dependent_shipment: 0, booking: 0 };
    const errors: string[] = [];

    // ---- shipments: pending_review/confirmed cujo dia agendado passou ----
    {
      const { data, error } = await admin
        .from("shipments")
        .select("id, status, scheduled_at, created_at")
        .in("status", ["pending_review", "confirmed"]);
      if (error) errors.push(`shipments fetch: ${error.message}`);
      for (const row of (data ?? []) as Array<{ id: string; scheduled_at: string | null; created_at: string }>) {
        const when = row.scheduled_at ?? row.created_at;
        if (!when || when >= cutoff) continue;
        const r = await refundOrCancel(admin, supabaseUrl, serviceRoleKey, "shipment", "shipments", row.id, nowIso);
        if (r.done) result.shipment++;
        else if (r.error) errors.push(`shipment ${row.id}: ${r.error}`);
      }
    }

    // ---- dependent_shipments ----
    {
      const { data, error } = await admin
        .from("dependent_shipments")
        .select("id, status, scheduled_at, created_at")
        .in("status", ["pending_review", "confirmed"]);
      if (error) errors.push(`dependent_shipments fetch: ${error.message}`);
      for (const row of (data ?? []) as Array<{ id: string; scheduled_at: string | null; created_at: string }>) {
        const when = row.scheduled_at ?? row.created_at;
        if (!when || when >= cutoff) continue;
        const r = await refundOrCancel(admin, supabaseUrl, serviceRoleKey, "dependent_shipment", "dependent_shipments", row.id, nowIso);
        if (r.done) result.dependent_shipment++;
        else if (r.error) errors.push(`dependent_shipment ${row.id}: ${r.error}`);
      }
    }

    // ---- bookings: viagem (scheduled_trip) cujo departure passou e nunca iniciou ----
    {
      const { data, error } = await admin
        .from("bookings")
        .select("id, status, scheduled_trip_id, scheduled_trips!inner(departure_at, driver_journey_started_at, status)")
        .in("status", ["pending", "confirmed", "paid"]);
      if (error) errors.push(`bookings fetch: ${error.message}`);
      for (const row of (data ?? []) as Array<{
        id: string;
        scheduled_trips: { departure_at: string | null; driver_journey_started_at: string | null; status: string } | null;
      }>) {
        const st = row.scheduled_trips;
        if (!st || !st.departure_at) continue;
        if (st.driver_journey_started_at) continue; // viagem iniciada = realizada
        if (st.status === "completed" || st.status === "cancelled") continue;
        if (st.departure_at >= cutoff) continue; // ainda não passou o dia
        const r = await refundOrCancel(admin, supabaseUrl, serviceRoleKey, "booking", "bookings", row.id, nowIso);
        if (r.done) result.booking++;
        else if (r.error) errors.push(`booking ${row.id}: ${r.error}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, cutoff, cancelled: result, errors: errors.length ? errors : undefined }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[expire-past-trips] unhandled:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
