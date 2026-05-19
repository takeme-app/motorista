import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type",
};

type StopType =
  | "passenger_pickup"
  | "passenger_dropoff"
  | "dependent_pickup"
  | "dependent_dropoff"
  | "package_pickup"
  | "package_dropoff"
  | "shipment_pickup"
  | "shipment_dropoff";

type EntityType = "booking" | "shipment" | "dependent_shipment";

function entityTypeForStop(stopType: string): EntityType | null {
  const t = stopType.toLowerCase().trim();
  if (t === "passenger_pickup" || t === "passenger_dropoff") return "booking";
  if (
    t === "package_pickup" ||
    t === "package_dropoff" ||
    t === "shipment_pickup" ||
    t === "shipment_dropoff"
  ) {
    return "shipment";
  }
  if (t === "dependent_pickup" || t === "dependent_dropoff") {
    return "dependent_shipment";
  }
  return null;
}

function tableFor(entityType: EntityType): string {
  if (entityType === "booking") return "bookings";
  if (entityType === "shipment") return "shipments";
  return "dependent_shipments";
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
      trip_stop_id?: string;
    };
    const tripStopId =
      typeof body.trip_stop_id === "string" ? body.trip_stop_id.trim() : "";
    if (!tripStopId) {
      return new Response(
        JSON.stringify({ error: "trip_stop_id obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Carrega a parada via admin (RLS livre) e valida que o motorista autenticado é dono da viagem.
    type TripStopRow = {
      id: string;
      scheduled_trip_id: string;
      stop_type: string;
      entity_id: string | null;
      status: string;
    };
    const { data: stopRaw, error: stopErr } = await admin
      .from("trip_stops")
      .select("id, scheduled_trip_id, stop_type, entity_id, status")
      .eq("id", tripStopId)
      .maybeSingle();
    if (stopErr || !stopRaw) {
      return new Response(JSON.stringify({ error: "Parada não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const stop = stopRaw as unknown as TripStopRow;

    const { data: tripRaw } = await admin
      .from("scheduled_trips")
      .select("id, driver_id")
      .eq("id", stop.scheduled_trip_id)
      .maybeSingle();
    const trip = tripRaw as { id: string; driver_id: string | null } | null;
    if (!trip || trip.driver_id !== user.id) {
      return new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reutiliza a RPC existente: marca pickup + dropoff correspondente como `skipped`.
    // Chamada com o JWT do motorista (sem service role) para preservar o auth.uid() esperado pela RPC.
    const { data: rpcData, error: rpcErr } = await userClient.rpc(
      "driver_cancel_pickup" as never,
      { p_trip_stop_id: tripStopId } as never,
    );
    if (rpcErr) {
      return new Response(
        JSON.stringify({ error: `Falha ao cancelar parada: ${rpcErr.message}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const rpcPayload = (rpcData ?? {}) as {
      ok?: boolean;
      error?: string;
      already_final?: boolean;
    };
    if (rpcPayload.ok === false) {
      return new Response(
        JSON.stringify({ error: rpcPayload.error ?? "Não foi possível cancelar a parada" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const entityType = entityTypeForStop(stop.stop_type);
    if (!entityType || !stop.entity_id) {
      // Sem entidade associada (raro) — só pula stops, sem refund.
      return new Response(
        JSON.stringify({ cancelled: true, refunded: false, reason: "no_entity" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const table = tableFor(entityType);

    type EntityRow = {
      id: string;
      user_id: string | null;
      status: string | null;
      amount_cents: number | null;
      stripe_payment_intent_id: string | null;
    };
    const { data: entityRaw } = await admin
      .from(table)
      .select("id, user_id, status, amount_cents, stripe_payment_intent_id")
      .eq("id", stop.entity_id)
      .maybeSingle();
    const entity = entityRaw as unknown as EntityRow | null;
    if (!entity) {
      return new Response(
        JSON.stringify({ cancelled: true, refunded: false, reason: "entity_missing" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const currentStatus = String(entity.status ?? "").toLowerCase();
    const alreadyTerminal = ["cancelled", "canceled", "completed", "delivered"].includes(
      currentStatus,
    );

    let refunded = false;
    let refundAmountCents = 0;
    let refundError: string | null = null;

    const wasPaid =
      !alreadyTerminal &&
      Boolean(entity.stripe_payment_intent_id) &&
      Math.floor(Number(entity.amount_cents ?? 0)) > 0;

    if (wasPaid) {
      const refundRes = await fetch(`${supabaseUrl}/functions/v1/process-refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: stop.entity_id,
          reason: "driver_pickup_cancelled",
        }),
      });
      const refundBody = (await refundRes.json().catch(() => ({}))) as {
        error?: string;
        refund_amount_cents?: number;
      };
      if (refundRes.ok) {
        refunded = true;
        refundAmountCents = Math.max(
          0,
          Math.floor(Number(refundBody.refund_amount_cents ?? entity.amount_cents ?? 0)),
        );
      } else {
        refundError = refundBody.error ?? `HTTP ${refundRes.status}`;
        console.error("[driver-cancel-pickup] refund error:", refundError);
      }
    }

    // Aplica metadados — process-refund já marca status='cancelled' quando o refund roda.
    // Quando não houve refund (sem PI / já paga / amount=0), garantimos aqui.
    // shipments / dependent_shipments só têm `status`, `cancellation_reason` e `updated_at`.
    // bookings tem também `cancelled_at` e `cancelled_by` — só seta nelas.
    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status: "cancelled",
      cancellation_reason: "driver_pickup_cancelled",
      updated_at: nowIso,
    };
    if (entityType === "booking") {
      updatePayload.cancelled_at = nowIso;
      updatePayload.cancelled_by = "driver";
    }
    if (!alreadyTerminal) {
      const { error: updErr } = await admin
        .from(table)
        .update(updatePayload as never)
        .eq("id", stop.entity_id);
      if (updErr) {
        console.error(`[driver-cancel-pickup] update ${table} error:`, updErr.message);
        return new Response(
          JSON.stringify({
            error: `Falha ao marcar ${entityType} como cancelado: ${updErr.message}`,
            partial: true,
            refunded,
            refund_amount_cents: refundAmountCents,
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Cancela payout pendente se ainda não foi estornado.
    if (!refunded && !alreadyTerminal) {
      await admin
        .from("payouts")
        .update({
          status: "cancelled",
          cancelled_reason: "driver_pickup_cancelled",
          updated_at: nowIso,
        } as never)
        .eq("entity_type", entityType)
        .eq("entity_id", stop.entity_id)
        .in("status", ["pending", "processing"]);
    }

    // Notifica o cliente.
    if (entity.user_id) {
      try {
        await admin.from("notifications").insert({
          user_id: entity.user_id,
          title: refunded
            ? "Reserva cancelada pelo motorista com estorno"
            : "Reserva cancelada pelo motorista",
          message: refunded
            ? `O motorista cancelou sua reserva. O estorno integral está sendo processado e pode levar de 5 a 10 dias para aparecer no cartão.`
            : `O motorista cancelou sua reserva. Se houver questionamento sobre o valor, abra um chamado no suporte.`,
          category: entityType,
        } as never);
      } catch (e) {
        console.warn("[driver-cancel-pickup] notification warn:", e);
      }
    }

    return new Response(
      JSON.stringify({
        cancelled: true,
        refunded,
        refund_amount_cents: refundAmountCents,
        refund_error: refundError,
        entity_type: entityType,
        entity_id: stop.entity_id,
        pickup_stop_id: rpcPayload && (rpcPayload as Record<string, unknown>).pickup_stop_id,
        dropoff_stop_id: rpcPayload && (rpcPayload as Record<string, unknown>).dropoff_stop_id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[driver-cancel-pickup]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
