import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createPixProvider } from "../_shared/pixProviders/index.ts";
import {
  PIX_CHARGE_ROW_COLUMNS,
  type PixChargeRow,
  refreshAndSettlePixCharge,
} from "../_shared/pixProviders/settle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * expire-pix-charges — cron (a cada 2 min): expira cobranças Pix pendentes
 * vencidas (a expiração é NOSSA; o dueDate no provedor só evita OVERDUE
 * prematuro).
 *
 * Para cada pendente vencida (LIMIT 100 por ciclo):
 *   1. re-consulta o provedor PRIMEIRO — pago no último segundo ⇒ liquida com
 *      o mesmo settlePixCharge do webhook e NÃO expira;
 *   2. senão: charge → expired; booking → cancelled/pix_expired (a vaga volta
 *      pelo trigger de capacidade); cancelamento no provedor best-effort
 *      (DELETE /payments/{id} no Asaas).
 *
 * ZERO notificações: os gates da migration 20260826000005 suprimem tanto o
 * INSERT pendente quanto o cancelamento com reason pix_expired.
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

async function expireCharge(
  admin: SupabaseClient,
  charge: PixChargeRow,
  nowIso: string,
): Promise<void> {
  const { data: updated } = await admin
    .from("pix_charges")
    .update({ status: "expired", updated_at: nowIso } as never)
    .eq("id", charge.id)
    .eq("status", "pending")
    .select("id");
  if (!Array.isArray(updated) || updated.length === 0) {
    // Outro processo (webhook/polling) liquidou no meio do caminho.
    return;
  }

  // Fase 1: só bookings. Cancela devolvendo a vaga (trigger de capacidade).
  if (charge.entity_type === "booking") {
    const { error: cancelErr } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: "system",
        cancelled_at: nowIso,
        cancellation_reason: "pix_expired",
        updated_at: nowIso,
      } as never)
      .eq("id", charge.entity_id)
      .eq("status", "pending");
    if (cancelErr) {
      console.error(`[expire-pix-charges] cancel booking ${charge.entity_id}:`, cancelErr.message);
    }
  }

  // Cancela no provedor (best-effort — se falhar, o dueDate segura o OVERDUE
  // e o settle trata pagamento tardio como paid_after_expiry).
  if (charge.provider_charge_id) {
    try {
      const provider = createPixProvider(admin, charge.provider);
      await provider.cancelCharge(charge.provider_charge_id);
    } catch (e) {
      console.warn(
        `[expire-pix-charges] cancelCharge ${charge.provider_charge_id}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
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
    const nowIso = new Date().toISOString();

    const { data, error } = await admin
      .from("pix_charges")
      .select(PIX_CHARGE_ROW_COLUMNS)
      .eq("status", "pending")
      .lt("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(100);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = { settled_last_second: 0, expired: 0 };
    const errors: string[] = [];

    for (const row of (data ?? []) as unknown as PixChargeRow[]) {
      try {
        // 1) Pago no último segundo? Re-consulta antes de expirar.
        if (row.provider_charge_id) {
          try {
            const { result: settleResult } = await refreshAndSettlePixCharge(admin, row);
            if (settleResult === "settled" || settleResult === "duplicate" || settleResult === "mismatch" || settleResult === "orphan") {
              result.settled_last_second++;
              continue;
            }
          } catch (e) {
            // Provedor fora do ar: segue expirando — pagamento tardio vira
            // paid_after_expiry via webhook/reconcile.
            console.warn(
              `[expire-pix-charges] re-consulta ${row.provider_charge_id}:`,
              e instanceof Error ? e.message : e,
            );
          }
        }

        // 2) Expira + cancela pedido + cancela no provedor.
        await expireCharge(admin, row, nowIso);
        result.expired++;
      } catch (e) {
        errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, ...result, errors: errors.length ? errors : undefined }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[expire-pix-charges] unhandled:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
