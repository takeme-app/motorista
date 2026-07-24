import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Cancelamento de reserva PELO ADMIN (painel). Espelha `cancel-booking` (fluxo do
// passageiro), mas:
//  - autoriza por admin (app_metadata.role === 'admin'), sem checagem de dono;
//  - aplica a MESMA política de janela de reembolso p/ cartão (process-refund);
//  - pix/dinheiro: apenas cancela (estorno é manual/presencial);
//  - NÃO insere notificação própria: a notificação ao cliente é disparada pelo
//    trigger `notify_client_booking_phase_change` ao status virar 'cancelled'
//    (reason 'admin_cancellation' não é suprimida por ele).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_FREE_WINDOW_HOURS = 2;

async function readFreeWindowHours(admin: ReturnType<typeof createClient>): Promise<number> {
  try {
    const { data } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "booking_cancellation_free_window_hours")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    const num =
      typeof raw === "number"
        ? raw
        : typeof raw === "object" && raw !== null && "value" in raw
          ? Number((raw as { value: unknown }).value)
          : Number(raw);
    if (Number.isFinite(num) && num >= 0) return num;
  } catch (e) {
    console.warn("[admin-cancel-booking] fallback window hours:", e);
  }
  return DEFAULT_FREE_WINDOW_HOURS;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("x-auth-token");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : (authHeader ?? "").trim();

    if (!token) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token);
    if (userError || !user?.id) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const role =
      (user.app_metadata as { role?: string } | undefined)?.role ?? "";
    if (role !== "admin") {
      return new Response(JSON.stringify({ error: "Acesso restrito ao admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as {
      booking_id?: string;
      reason?: string;
    };
    const bookingId =
      typeof body.booking_id === "string" ? body.booking_id.trim() : "";
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "booking_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    type BookingRow = {
      id: string;
      user_id: string;
      status: string;
      amount_cents: number | null;
      payment_method: string | null;
      stripe_payment_intent_id: string | null;
      scheduled_trip_id: string;
      scheduled_trips:
        | { departure_at: string | null; status: string | null }
        | null;
    };

    const { data: bookingRaw, error: bookingErr } = await admin
      .from("bookings")
      .select(
        "id, user_id, status, amount_cents, payment_method, stripe_payment_intent_id, scheduled_trip_id, scheduled_trips:scheduled_trip_id(departure_at, status)"
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingErr || !bookingRaw) {
      return new Response(JSON.stringify({ error: "Reserva não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const booking = bookingRaw as unknown as BookingRow;

    const cancellableStatuses = new Set(["pending", "paid", "confirmed"]);
    if (!cancellableStatuses.has(booking.status)) {
      return new Response(
        JSON.stringify({
          error: `Reserva não pode ser cancelada (status atual: ${booking.status}).`,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tripStatus = (booking.scheduled_trips?.status ?? "")
      .toString()
      .toLowerCase();
    const blockedTripStatuses = new Set(["completed", "cancelled", "canceled"]);
    if (blockedTripStatuses.has(tripStatus)) {
      return new Response(
        JSON.stringify({
          error: `Viagem não pode mais ser cancelada (status: ${tripStatus}).`,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const paymentMethod = (booking.payment_method ?? "card").toLowerCase();
    const departureIso = booking.scheduled_trips?.departure_at ?? null;
    const nowMs = Date.now();
    const departureMs = departureIso ? Date.parse(departureIso) : NaN;
    const hoursUntilDeparture = Number.isFinite(departureMs)
      ? (departureMs - nowMs) / (1000 * 60 * 60)
      : Number.POSITIVE_INFINITY;

    const thresholdHours = await readFreeWindowHours(admin);
    const insideWindow = hoursUntilDeparture >= thresholdHours;

    // Só cartão com payment_intent e valor > 0 é elegível a estorno automático.
    const cardRefundable =
      paymentMethod === "card" &&
      (booking.status === "paid" || booking.status === "confirmed") &&
      Boolean(booking.stripe_payment_intent_id) &&
      Math.floor(Number(booking.amount_cents ?? 0)) > 0;

    const nowIso = new Date().toISOString();
    const policySnapshot: Record<string, unknown> = {
      threshold_hours: thresholdHours,
      hours_until_departure: Number.isFinite(hoursUntilDeparture)
        ? Number(hoursUntilDeparture.toFixed(4))
        : null,
      inside_free_window: insideWindow,
      payment_method: paymentMethod,
      will_refund: insideWindow && cardRefundable,
      departure_at: departureIso,
      cancelled_at: nowIso,
      cancelled_via: "admin",
    };

    let refunded = false;
    let refundAmountCents = 0;

    if (insideWindow && cardRefundable) {
      const refundRes = await fetch(`${supabaseUrl}/functions/v1/process-refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          entity_type: "booking",
          entity_id: bookingId,
          reason: "admin_cancellation_within_window",
        }),
      });
      const refundBody = (await refundRes.json().catch(() => ({}))) as {
        error?: string;
        refund_amount_cents?: number;
      };
      if (!refundRes.ok) {
        return new Response(
          JSON.stringify({
            error: `Falha ao estornar: ${refundBody.error ?? refundRes.statusText}`,
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      refunded = true;
      refundAmountCents = Math.max(
        0,
        Math.floor(Number(refundBody.refund_amount_cents ?? booking.amount_cents ?? 0))
      );
      policySnapshot.refund_amount_cents = refundAmountCents;
    }

    // Metadados do cancelamento. Reason 'admin_cancellation' dispara a notificação
    // genérica do trigger notify_client_booking_phase_change ("Sua viagem foi cancelada").
    const updatePayload: Record<string, unknown> = {
      status: "cancelled",
      cancelled_by: "admin",
      cancelled_at: nowIso,
      cancellation_reason: "admin_cancellation",
      cancellation_policy_applied: policySnapshot,
      updated_at: nowIso,
    };

    const { error: updErr } = await admin
      .from("bookings")
      .update(updatePayload as never)
      .eq("id", bookingId);

    if (updErr) {
      console.error("[admin-cancel-booking] update error:", updErr.message);
      return new Response(
        JSON.stringify({ error: "Não foi possível cancelar a reserva." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Cancela payout pendente (quando não houve estorno Stripe).
    if (!refunded) {
      await admin
        .from("payouts")
        .update({
          status: "cancelled",
          cancelled_reason: "booking_cancelled",
          updated_at: nowIso,
        } as never)
        .eq("entity_type", "booking")
        .eq("entity_id", bookingId)
        .in("status", ["pending", "processing"]);
    }

    // Encerra conversa ativa da reserva (não bloqueia o cancelamento).
    try {
      await admin
        .from("conversations")
        .update({ status: "closed", updated_at: nowIso } as never)
        .eq("booking_id", bookingId)
        .eq("status", "active");
    } catch (e) {
      console.warn("[admin-cancel-booking] close conversation warn:", e);
    }

    // Pix não integrado: sinaliza devolução manual pendente (para o front avisar).
    const manualRefundPending = paymentMethod === "pix" && insideWindow;

    return new Response(
      JSON.stringify({
        cancelled: true,
        refunded,
        refund_amount_cents: refundAmountCents,
        payment_method: paymentMethod,
        inside_window: insideWindow,
        threshold_hours: thresholdHours,
        hours_until_departure: Number.isFinite(hoursUntilDeparture)
          ? hoursUntilDeparture
          : null,
        manual_refund_pending: manualRefundPending,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("[admin-cancel-booking]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
