import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type",
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
    console.warn("[cancel-booking] fallback window hours:", e);
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

    const body = (await req.json().catch(() => ({}))) as {
      booking_id?: string;
    };
    const bookingId =
      typeof body.booking_id === "string" ? body.booking_id.trim() : "";
    if (!bookingId) {
      return new Response(
        JSON.stringify({ error: "booking_id obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    type BookingRow = {
      id: string;
      user_id: string;
      status: string;
      amount_cents: number | null;
      stripe_payment_intent_id: string | null;
      pix_charge_id: string | null;
      pix_paid_at: string | null;
      scheduled_trip_id: string;
      scheduled_trips:
        | { departure_at: string | null; status: string | null }
        | null;
    };

    const { data: bookingRaw, error: bookingErr } = await admin
      .from("bookings")
      .select(
        "id, user_id, status, amount_cents, stripe_payment_intent_id, pix_charge_id, pix_paid_at, scheduled_trip_id, scheduled_trips:scheduled_trip_id(departure_at, status)"
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

    if (String(booking.user_id) !== user.id) {
      return new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Defesa em profundidade: só bloqueia se a viagem chegou a um estado FINAL
    // (completed/cancelled). Atenção: `trip.status='active'` é o default desde
    // a criação da trip — NÃO indica que motorista iniciou. O sinal correto é
    // `driver_journey_started_at IS NOT NULL`, mas a regra atual de produto
    // permite passageiro cancelar mesmo após o motorista iniciar (penalty
    // calculada pelo refund flow abaixo conforme a janela freeWindowHours).
    const tripStatus = (booking.scheduled_trips?.status ?? "")
      .toString()
      .toLowerCase();
    const blockedTripStatuses = new Set([
      "completed",
      "cancelled",
      "canceled",
    ]);
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

    const departureIso = booking.scheduled_trips?.departure_at ?? null;
    if (!departureIso) {
      return new Response(
        JSON.stringify({ error: "Viagem sem data de partida" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const nowMs = Date.now();
    const departureMs = Date.parse(departureIso);
    const hoursUntilDeparture = (departureMs - nowMs) / (1000 * 60 * 60);

    const thresholdHours = await readFreeWindowHours(admin);
    const insideWindow = hoursUntilDeparture >= thresholdHours;

    const wasPaid =
      (booking.status === "paid" || booking.status === "confirmed") &&
      Boolean(booking.stripe_payment_intent_id) &&
      Math.floor(Number(booking.amount_cents ?? 0)) > 0;

    // Pix real: pago via pix_charges (sem PaymentIntent). Estorno automático
    // está fora do escopo — dentro da janela, o cancelamento entra na fila de
    // devolução MANUAL (pix_refunds_pending) para o admin devolver por fora.
    const wasPixPaid =
      (booking.status === "paid" || booking.status === "confirmed") &&
      !booking.stripe_payment_intent_id &&
      Boolean(booking.pix_paid_at) &&
      Math.floor(Number(booking.amount_cents ?? 0)) > 0;

    const nowIso = new Date().toISOString();
    const policySnapshot = {
      threshold_hours: thresholdHours,
      hours_until_departure: Number(hoursUntilDeparture.toFixed(4)),
      inside_free_window: insideWindow,
      will_refund: insideWindow && wasPaid,
      departure_at: departureIso,
      cancelled_at: nowIso,
    };

    let refunded = false;
    let refundAmountCents = 0;

    if (insideWindow && wasPaid) {
      // Invoca process-refund com service_role (interno). process-refund marca
      // booking.status = 'cancelled' automaticamente.
      const refundRes = await fetch(`${supabaseUrl}/functions/v1/process-refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          entity_type: "booking",
          entity_id: bookingId,
          reason: "passenger_cancellation_within_window",
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
      policySnapshot.will_refund = true;
      (policySnapshot as Record<string, unknown>).refund_amount_cents =
        refundAmountCents;
    }

    // Pix real pago + dentro da janela: enfileira devolução manual.
    // (Fora da janela segue a regra de sempre: cancela sem devolução.)
    const queuePixRefundManual = async (b: {
      pix_charge_id: string | null;
      user_id: string;
      amount_cents: number | null;
    }): Promise<boolean> => {
      const amountCents = Math.max(0, Math.floor(Number(b.amount_cents ?? 0)));
      try {
        // Dedup: não duplica pendência da mesma cobrança+motivo.
        let alreadyQueued = false;
        if (b.pix_charge_id) {
          const { data: existing } = await admin
            .from("pix_refunds_pending")
            .select("id")
            .eq("pix_charge_id", b.pix_charge_id)
            .eq("reason", "user_cancelled_in_window")
            .eq("status", "pending")
            .limit(1);
          alreadyQueued = Array.isArray(existing) && existing.length > 0;
        }
        if (alreadyQueued) return true;
        const { error: queueErr } = await admin.from("pix_refunds_pending").insert({
          pix_charge_id: b.pix_charge_id ?? null,
          entity_type: "booking",
          entity_id: bookingId,
          user_id: b.user_id,
          amount_cents: amountCents,
          reason: "user_cancelled_in_window",
          notes: "passageiro cancelou dentro da janela gratuita (pagamento Pix real)",
        } as never);
        if (queueErr) {
          console.error("[cancel-booking] fila de devolução pix:", queueErr.message);
          return false;
        }
        return true;
      } catch (e) {
        console.error("[cancel-booking] fila de devolução pix:", e);
        return false;
      }
    };

    let pixRefundQueued = false;
    if (insideWindow && wasPixPaid) {
      pixRefundQueued = await queuePixRefundManual(booking);
      (policySnapshot as Record<string, unknown>).pix_refund_queued = pixRefundQueued;
    }

    // Aplica metadados do cancelamento. Se process-refund já setou status,
    // o UPDATE abaixo preserva (não força outro status).
    const updatePayload: Record<string, unknown> = {
      status: "cancelled",
      cancelled_by: "passenger",
      cancelled_at: nowIso,
      cancellation_reason: "passenger_cancellation",
      cancellation_policy_applied: policySnapshot,
      updated_at: nowIso,
    };

    // Guard de corrida: o status pode ter mudado desde a leitura lá em cima
    // (ex.: o webhook Pix liquidando pending→paid enquanto o usuário cancela).
    // Só cancela sobre o status que fundamentou a decisão; 0 linhas ⇒ re-lê e
    // re-decide — sem isso, um paid→cancelled forçado deixaria dinheiro retido
    // sem linha na fila de devolução. Quando process-refund já rodou, ele
    // próprio setou 'cancelled', então é esse o status esperado aqui.
    const expectedStatus = refunded ? "cancelled" : booking.status;
    const { data: updRows, error: updErr } = await admin
      .from("bookings")
      .update(updatePayload as never)
      .eq("id", bookingId)
      .eq("status", expectedStatus)
      .select("id");

    if (updErr) {
      console.error("[cancel-booking] update booking error:", updErr.message);
    } else if (!updRows || updRows.length === 0) {
      const { data: freshRaw } = await admin
        .from("bookings")
        .select("id, user_id, status, amount_cents, stripe_payment_intent_id, pix_charge_id, pix_paid_at")
        .eq("id", bookingId)
        .maybeSingle();
      const fresh = freshRaw as unknown as {
        user_id: string;
        status: string;
        amount_cents: number | null;
        stripe_payment_intent_id: string | null;
        pix_charge_id: string | null;
        pix_paid_at: string | null;
      } | null;
      const freshPixPaid =
        fresh != null &&
        (fresh.status === "paid" || fresh.status === "confirmed") &&
        !fresh.stripe_payment_intent_id &&
        Boolean(fresh.pix_paid_at) &&
        Math.floor(Number(fresh.amount_cents ?? 0)) > 0;
      if (fresh && freshPixPaid) {
        // Pagamento Pix liquidou no meio do cancelamento: enfileira a devolução
        // (na janela) ANTES de cancelar de novo, agora sobre o status real.
        if (insideWindow) {
          pixRefundQueued = await queuePixRefundManual(fresh);
          (policySnapshot as Record<string, unknown>).pix_refund_queued = pixRefundQueued;
          (updatePayload as Record<string, unknown>).cancellation_policy_applied = policySnapshot;
        }
        const { error: retryErr } = await admin
          .from("bookings")
          .update(updatePayload as never)
          .eq("id", bookingId)
          .eq("status", fresh.status);
        if (retryErr) {
          console.error("[cancel-booking] update booking (retry pós-corrida):", retryErr.message);
        }
      } else if (fresh && fresh.status !== "cancelled" && fresh.status !== booking.status) {
        console.error(
          `[cancel-booking] status mudou durante o cancelamento (${booking.status} → ${fresh.status}); cancelamento não aplicado`,
        );
      }
    }

    // Cancela payout pendente (caso não-Stripe tenha sido criado e refund não rodou).
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

    // Encerra conversation ativa associada a esta reserva (driver_client).
    // Mantém histórico no banco, mas remove da lista "Recentes" do motorista
    // e do passageiro. Falhas aqui não bloqueiam o cancelamento.
    try {
      await admin
        .from("conversations")
        .update({
          status: "closed",
          updated_at: nowIso,
        } as never)
        .eq("booking_id", bookingId)
        .eq("status", "active");
    } catch (e) {
      console.warn("[cancel-booking] close conversation warn:", e);
    }

    // Notificação para o passageiro.
    try {
      await admin.from("notifications").insert({
        user_id: booking.user_id,
        title: refunded || pixRefundQueued ? "Reserva cancelada com estorno" : "Reserva cancelada",
        message: refunded
          ? "Sua reserva foi cancelada e o reembolso integral foi iniciado no cartão. Pode levar de 5 a 10 dias para aparecer."
          : pixRefundQueued
            ? "Sua reserva foi cancelada. A devolução do Pix será processada pela nossa equipe em até 5 dias úteis."
            : "Sua reserva foi cancelada. Como faltava menos tempo até a partida, não há reembolso.",
        category: "booking",
      } as never);
    } catch (e) {
      console.warn("[cancel-booking] notification insert warn:", e);
    }

    return new Response(
      JSON.stringify({
        cancelled: true,
        refunded,
        refund_amount_cents: refundAmountCents,
        pix_refund_queued: pixRefundQueued,
        inside_window: insideWindow,
        threshold_hours: thresholdHours,
        hours_until_departure: hoursUntilDeparture,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("[cancel-booking]", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Erro interno",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
