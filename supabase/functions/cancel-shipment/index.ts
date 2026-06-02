import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * cancel-shipment
 *
 * Cancelamento de encomenda pelo passageiro. Espelha `cancel-booking` (que
 * cancela viagens), mas sem regras de janela/refund — pagamento de encomenda
 * é tratado em outro fluxo.
 *
 * Body: { shipment_id: string }
 *
 * O que faz:
 *   - Valida que o user autenticado é o dono da encomenda.
 *   - Valida que a encomenda ainda pode ser cancelada (status pré-final).
 *   - UPDATE shipments SET status='cancelled',
 *       cancellation_reason='passenger_cancellation'.
 *   - Encerra conversation ativa vinculada (driver_client), espelhando
 *     `cancel-booking`. Falhas aqui não bloqueiam.
 *
 * As notificações ao cliente e ao motorista são disparadas via triggers
 * de Postgres em `notify_client_shipment_phase_change` e
 * `notify_driver_activity_status_changed`, que reconhecem o
 * cancellation_reason 'passenger_cancellation'.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type",
};

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
      shipment_id?: string;
    };
    const shipmentId =
      typeof body.shipment_id === "string" ? body.shipment_id.trim() : "";
    if (!shipmentId) {
      return new Response(
        JSON.stringify({ error: "shipment_id obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    type ShipmentRow = {
      id: string;
      user_id: string;
      status: string;
    };

    const { data: shipmentData, error: shipErr } = await admin
      .from("shipments")
      .select("id, user_id, status")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shipErr) {
      console.error("[cancel-shipment] select:", shipErr.message);
      return new Response(
        JSON.stringify({ error: "Erro ao buscar encomenda" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const shipment = shipmentData as ShipmentRow | null;
    if (!shipment) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (shipment.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Status finais não podem ser revertidos.
    const FINAL_STATUSES = new Set(["delivered", "cancelled"]);
    if (FINAL_STATUSES.has(shipment.status)) {
      return new Response(
        JSON.stringify({ error: "invalid_status", current: shipment.status }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const nowIso = new Date().toISOString();

    const { error: updErr } = await admin
      .from("shipments")
      .update({
        status: "cancelled",
        cancellation_reason: "passenger_cancellation",
      } as never)
      .eq("id", shipmentId)
      .eq("user_id", user.id);

    if (updErr) {
      console.error("[cancel-shipment] update:", updErr.message);
      return new Response(
        JSON.stringify({ error: "Falha ao cancelar encomenda" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Encerra conversation ativa vinculada — mantém histórico, mas tira da
    // lista "Recentes". Falhas aqui não bloqueiam o cancelamento.
    try {
      await admin
        .from("conversations")
        .update({
          status: "closed",
          updated_at: nowIso,
        } as never)
        .eq("shipment_id", shipmentId)
        .eq("status", "active");
    } catch (e) {
      console.warn("[cancel-shipment] close conversation warn:", e);
    }

    return new Response(JSON.stringify({ cancelled: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[cancel-shipment]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
