// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * notify-preparer-handoff-expired
 *
 * Cron (recomendado a cada 1–2 minutos). Busca shipments em que o cron PG
 * `shipment_process_expired_preparer_handoffs` declarou expirado o handoff
 * do preparador (preparer_handoff_expired_at NOT NULL). Para cada um,
 * notifica DOIS destinatários, respeitando preferências de cada
 * (RPC public.should_notify_user):
 *   - Motorista (categoria 'shipments_deliveries'): "Coleta agora é com você"
 *   - Cliente   (categoria 'shipments_deliveries'): "Código de coleta agora
 *     é do motorista"
 *
 * Idempotência por destinatário: cada lado usa a sua própria flag
 * (`preparer_handoff_notified_at` para o motorista,
 *  `preparer_handoff_client_notified_at` para o cliente), de modo que
 * falha em um destinatário não impede o reenvio no próximo tick.
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
  user_id: string;
  driver_id: string;
  scheduled_trip_id: string | null;
  origin_address: string | null;
  destination_address: string | null;
  preparer_handoff_notified_at: string | null;
  preparer_handoff_client_notified_at: string | null;
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

  // Inclui shipments em que QUALQUER um dos destinatários ainda não foi
  // notificado. Cada lado tem seu próprio flag de idempotência abaixo.
  const { data, error } = await admin
    .from("shipments")
    .select(
      "id, user_id, driver_id, scheduled_trip_id, origin_address, destination_address, preparer_handoff_notified_at, preparer_handoff_client_notified_at",
    )
    .not("preparer_handoff_expired_at", "is", null)
    .or(
      "preparer_handoff_notified_at.is.null,preparer_handoff_client_notified_at.is.null",
    )
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
  let sentDriver = 0;
  let sentClient = 0;
  const errors: unknown[] = [];

  // Notifica um destinatário (motorista ou cliente). Retorna true se inseriu
  // a notification, false se a preferência bloqueou. Em qualquer caso (inclusive
  // bloqueio por preferência), marca a flag de idempotência para evitar
  // retentativas a cada tick.
  async function notifyOne(opts: {
    shipmentId: string;
    userId: string;
    category: string;
    title: string;
    message: string;
    targetAppSlug: "motorista" | "cliente";
    data: Record<string, unknown>;
    flagColumn:
      | "preparer_handoff_notified_at"
      | "preparer_handoff_client_notified_at";
  }): Promise<boolean> {
    const { data: allowed, error: prefErr } = await admin.rpc(
      "should_notify_user",
      { p_user_id: opts.userId, p_category: opts.category } as any,
    );
    if (prefErr) {
      errors.push({
        shipment: opts.shipmentId,
        recipient: opts.targetAppSlug,
        step: "pref",
        detail: prefErr.message,
      });
      return false;
    }

    let inserted = false;
    if (allowed) {
      const { error: insErr } = await admin.from("notifications").insert({
        user_id: opts.userId,
        title: opts.title,
        message: opts.message,
        category: opts.category,
        target_app_slug: opts.targetAppSlug,
        data: opts.data,
      } as never);
      if (insErr) {
        errors.push({
          shipment: opts.shipmentId,
          recipient: opts.targetAppSlug,
          step: "insert",
          detail: insErr.message,
        });
        return false;
      }
      inserted = true;
    }

    const { error: upErr } = await admin
      .from("shipments")
      .update({ [opts.flagColumn]: new Date().toISOString() } as never)
      .eq("id", opts.shipmentId)
      .is(opts.flagColumn, null);
    if (upErr) {
      errors.push({
        shipment: opts.shipmentId,
        recipient: opts.targetAppSlug,
        step: "update",
        detail: upErr.message,
      });
    }
    return inserted;
  }

  for (const s of shipments) {
    try {
      // 1) Motorista — só se ainda não foi notificado.
      if (!s.preparer_handoff_notified_at && s.driver_id) {
        const okDriver = await notifyOne({
          shipmentId: s.id,
          userId: s.driver_id,
          category: "shipments_deliveries",
          title: "Coleta agora é com você",
          message: `O preparador não confirmou a tempo. Você buscará o pacote ${
            truncate(s.origin_address, 60)
              ? `em ${truncate(s.origin_address, 60)}`
              : "na casa do cliente"
          }.`,
          targetAppSlug: "motorista",
          data: {
            kind: "preparer_handoff_expired",
            shipment_id: s.id,
            ...(s.scheduled_trip_id
              ? { route: "ActiveTrip", params: { tripId: s.scheduled_trip_id } }
              : { route: "PendingRequests" }),
          },
          flagColumn: "preparer_handoff_notified_at",
        });
        if (okDriver) sentDriver += 1;
      }

      // 2) Cliente — só se ainda não foi notificado.
      if (!s.preparer_handoff_client_notified_at && s.user_id) {
        const okClient = await notifyOne({
          shipmentId: s.id,
          userId: s.user_id,
          category: "shipments_deliveries",
          title: "Coleta agora é direta com o motorista",
          message:
            "O preparador não confirmou a tempo. Quando o motorista chegar, ele informará um novo código de 4 dígitos — digite-o no app para confirmar a coleta.",
          targetAppSlug: "cliente",
          data: {
            kind: "preparer_handoff_expired_client",
            shipment_id: s.id,
            route: "ShipmentDetail",
            params: { shipmentId: s.id },
          },
          flagColumn: "preparer_handoff_client_notified_at",
        });
        if (okClient) sentClient += 1;
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
      sent_driver: sentDriver,
      sent_client: sentClient,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
