// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * notify-driver-upcoming-trips
 *
 * Cron (recomendado a cada 10 minutos). Busca viagens com status=active
 * e departure_at dentro da janela [now+55min, now+65min] ainda sem
 * `upcoming_1h_notified_at`. Para cada uma, respeita a preferência do
 * motorista (via RPC public.should_notify_user), insere a notificação
 * (com deeplink TripDetail {tripId}) e marca `upcoming_1h_notified_at`
 * para garantir idempotência.
 *
 * Autenticação: aceita apenas service-role key no header Authorization.
 * Agendamento sugerido (Supabase cron ou pg_cron):
 *   every 10 minutes
 *   POST <project>/functions/v1/notify-driver-upcoming-trips
 *   Header: Authorization: Bearer <SERVICE_ROLE_KEY>
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

type TripRow = {
  id: string;
  driver_id: string;
  origin_address: string | null;
  destination_address: string | null;
  departure_at: string;
};

function truncate(v: string | null | undefined, max: number): string {
  const s = (v ?? "").trim();
  return s.length <= max ? s : s.slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const token = (req.headers.get("Authorization") ?? "")
    .replace("Bearer ", "")
    .trim();
  if (!isServiceRoleToken(token) && token !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const nowMs = Date.now();
  const lower = new Date(nowMs + 55 * 60_000).toISOString();
  const upper = new Date(nowMs + 65 * 60_000).toISOString();

  // Filtros de elegibilidade da notificação "Falta 1 hora":
  // - status='active'  → viagem cadastrada e ativa.
  // - is_active=true   → viagem não foi soft-deleted/cancelada por outro fluxo.
  // - driver_journey_started_at IS NULL → motorista ainda NÃO iniciou. Sem
  //   isso, a notificação continuava saindo durante a viagem em andamento
  //   (status='active' não muda ao iniciar — só ao concluir).
  // - upcoming_1h_notified_at IS NULL → idempotência.
  // - departure_at ∈ [now+55min, now+65min] → janela de 1h antes.
  const { data, error } = await admin
    .from("scheduled_trips")
    .select("id, driver_id, origin_address, destination_address, departure_at")
    .eq("status", "active")
    .eq("is_active", true)
    .is("driver_journey_started_at", null)
    .is("upcoming_1h_notified_at", null)
    .gte("departure_at", lower)
    .lte("departure_at", upper)
    .limit(500);

  if (error) {
    console.error("[notify-driver-upcoming-trips] select:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao consultar viagens", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const trips = (data ?? []) as TripRow[];
  let sent = 0;
  const errors: unknown[] = [];

  for (const t of trips) {
    try {
      const { data: allowed, error: prefErr } = await admin.rpc(
        "should_notify_user",
        { p_user_id: t.driver_id, p_category: "trip_upcoming_1h" } as any,
      );
      if (prefErr) {
        errors.push({ trip: t.id, step: "pref", detail: prefErr.message });
        continue;
      }

      if (allowed) {
        const { error: insErr } = await admin.from("notifications").insert({
          user_id: t.driver_id,
          title: "Falta 1 hora para iniciar sua próxima Viagem!",
          message: `Prepare-se para ${truncate(t.origin_address, 60) || "origem"} → ${truncate(t.destination_address, 60) || "destino"}. Toque para ver detalhes.`,
          category: "trip_upcoming_1h",
          target_app_slug: "motorista",
          data: {
            route: "TripDetail",
            params: { tripId: t.id },
          },
        } as never);

        if (insErr) {
          errors.push({ trip: t.id, step: "insert", detail: insErr.message });
          continue;
        }
        sent += 1;
      }

      // Marca como tratada mesmo quando a preferência bloqueou — evita tentar
      // de novo a cada 10min para quem desligou o alerta.
      const { error: upErr } = await admin
        .from("scheduled_trips")
        .update({ upcoming_1h_notified_at: new Date().toISOString() } as never)
        .eq("id", t.id)
        .is("upcoming_1h_notified_at", null);

      if (upErr) {
        errors.push({ trip: t.id, step: "update", detail: upErr.message });
      }
    } catch (e) {
      errors.push({
        trip: t.id,
        step: "catch",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      scanned: trips.length,
      sent,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
