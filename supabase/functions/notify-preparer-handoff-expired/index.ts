// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * notify-preparer-handoff-expired
 *
 * Cron (recomendado a cada 1–2 minutos). Busca shipments em que o cron PG
 * `shipment_process_expired_preparer_handoffs` declarou expirado o handoff
 * do preparador (preparer_handoff_expired_at NOT NULL AND
 * preparer_handoff_notified_at IS NULL). Para cada um, respeita a preferência
 * do motorista (RPC public.should_notify_user), insere a notificação com
 * deeplink para o envio e marca `preparer_handoff_notified_at` para garantir
 * idempotência.
 *
 * Autenticação: aceita apenas service-role key no header Authorization.
 * Agendamento sugerido (Supabase cron ou pg_cron):
 *   every 1 minute
 *   POST <project>/functions/v1/notify-preparer-handoff-expired
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

type ShipmentRow = {
  id: string;
  driver_id: string;
  scheduled_trip_id: string | null;
  origin_address: string | null;
  destination_address: string | null;
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

  const { data, error } = await admin
    .from("shipments")
    .select("id, driver_id, scheduled_trip_id, origin_address, destination_address")
    .not("preparer_handoff_expired_at", "is", null)
    .is("preparer_handoff_notified_at", null)
    .not("driver_id", "is", null)
    .limit(500);

  if (error) {
    console.error("[notify-preparer-handoff-expired] select:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao consultar shipments", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const shipments = (data ?? []) as ShipmentRow[];
  let sent = 0;
  const errors: unknown[] = [];

  for (const s of shipments) {
    try {
      const { data: allowed, error: prefErr } = await admin.rpc(
        "should_notify_user",
        { p_user_id: s.driver_id, p_category: "shipments_deliveries" } as any,
      );
      if (prefErr) {
        errors.push({ shipment: s.id, step: "pref", detail: prefErr.message });
        continue;
      }

      if (allowed) {
        const { error: insErr } = await admin.from("notifications").insert({
          user_id: s.driver_id,
          title: "Coleta agora é com você",
          message: `O preparador não confirmou a tempo. Você buscará o pacote ${truncate(s.origin_address, 60) ? `em ${truncate(s.origin_address, 60)}` : "na casa do cliente"}.`,
          category: "shipments_deliveries",
          target_app_slug: "motorista",
          // Deeplink: navega o motorista pra ActiveTrip (root route).
          // Se ainda não há trip vinculado (raro), cai em PendingRequests.
          data: {
            kind: "preparer_handoff_expired",
            shipment_id: s.id,
            ...(s.scheduled_trip_id
              ? { route: "ActiveTrip", params: { tripId: s.scheduled_trip_id } }
              : { route: "PendingRequests" }),
          },
        } as never);

        if (insErr) {
          errors.push({ shipment: s.id, step: "insert", detail: insErr.message });
          continue;
        }
        sent += 1;
      }

      // Marca como tratada mesmo quando a preferência bloqueou — evita tentar
      // de novo a cada ciclo para quem desligou o alerta.
      const { error: upErr } = await admin
        .from("shipments")
        .update({ preparer_handoff_notified_at: new Date().toISOString() } as never)
        .eq("id", s.id)
        .is("preparer_handoff_notified_at", null);

      if (upErr) {
        errors.push({ shipment: s.id, step: "update", detail: upErr.message });
      }
    } catch (e) {
      errors.push({
        shipment: s.id,
        step: "catch",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      scanned: shipments.length,
      sent,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
