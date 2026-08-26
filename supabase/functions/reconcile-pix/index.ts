import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AsaasProvider } from "../_shared/pixProviders/asaas.ts";
import { PixProviderUnavailableError } from "../_shared/pixProviders/types.ts";
import {
  PIX_CHARGE_ROW_COLUMNS,
  type PixChargeRow,
  queuePixRefund,
  refreshAndSettlePixCharge,
} from "../_shared/pixProviders/settle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * reconcile-pix — cron diário: rede de segurança nas DUAS direções.
 *
 *   banco → provedor: cobranças não-terminais (pending) são re-consultadas e
 *   liquidadas com o mesmo settlePixCharge do webhook (webhook desligado ou
 *   evento perdido não deixa dinheiro sem pedido).
 *
 *   provedor → banco: pagamentos Pix RECEIVED dos últimos dias (D-2 a D0,
 *   paginado) sem par em pix_charges viram fila orphan_payment (dinheiro que
 *   entrou na conta sem cobrança conhecida — nunca some em silêncio).
 *
 * Cobranças de env divergente do adapter atual (ex.: sandbox durante piloto em
 * produção) são IGNORADAS na re-consulta. Divergência > 0 notifica os admins
 * (worker_profiles.role='admin').
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

/** Datas (YYYY-MM-DD, America/Sao_Paulo UTC-3) de D-2 até hoje. */
function lastDaysSaoPaulo(days: number): string[] {
  const SP_OFFSET_HOURS = 3;
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000 - i * 24 * 3600 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function notifyAdmins(admin: SupabaseClient, message: string): Promise<void> {
  const { data: admins } = await admin
    .from("worker_profiles")
    .select("id")
    .eq("role", "admin");
  const rows = ((admins ?? []) as Array<{ id: string }>).map((a) => ({
    user_id: a.id,
    title: "Divergências na conciliação Pix",
    message,
    category: "payment_received",
    target_app_slug: "motorista",
    data: { route: "PaymentHistory" },
  }));
  if (rows.length === 0) return;
  const { error } = await admin.from("notifications").insert(rows as never);
  if (error) console.error("[reconcile-pix] notifyAdmins:", error.message);
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

    // Asaas é o único provedor real por ora; sem secrets, roda em vazio.
    let asaas: AsaasProvider | null = null;
    try {
      asaas = new AsaasProvider(admin);
    } catch (e) {
      if (!(e instanceof PixProviderUnavailableError)) throw e;
    }

    const result = {
      checked_pending: 0,
      corrected: 0,
      mismatches: 0,
      orphans_found: 0,
      skipped_env: 0,
    };
    const errors: string[] = [];

    // ── 1) banco → provedor: pendentes re-consultadas ──
    {
      const { data, error } = await admin
        .from("pix_charges")
        .select(PIX_CHARGE_ROW_COLUMNS)
        .eq("status", "pending")
        .not("provider_charge_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) errors.push(`fetch pendentes: ${error.message}`);

      for (const row of (data ?? []) as unknown as PixChargeRow[]) {
        // Env divergente do adapter atual (piloto sandbox em produção): ignora.
        if (asaas && row.provider === "asaas" && row.provider_env !== asaas.env) {
          result.skipped_env++;
          continue;
        }
        result.checked_pending++;
        try {
          const { result: settleResult } = await refreshAndSettlePixCharge(admin, row);
          if (settleResult === "settled" || settleResult === "orphan") result.corrected++;
          if (settleResult === "mismatch") result.mismatches++;
        } catch (e) {
          errors.push(`refresh ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // ── 2) provedor → banco: RECEIVED D-2..D0 sem par viram fila ──
    if (asaas) {
      for (const day of lastDaysSaoPaulo(3)) {
        let payments;
        try {
          payments = await asaas.listReceivedPayments(day);
        } catch (e) {
          errors.push(`list ${day}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        for (const payment of payments) {
          try {
            const { data: byPid } = await admin
              .from("pix_charges")
              .select("id")
              .eq("provider", "asaas")
              .eq("provider_charge_id", payment.providerChargeId)
              .maybeSingle();
            if (byPid) continue;

            if (payment.externalReference) {
              const { data: byRef } = await admin
                .from("pix_charges")
                .select("id")
                .eq("id", payment.externalReference)
                .maybeSingle();
              if (byRef) continue;
            }

            // Sem par no banco: fila de devolução (dedup pelo marcador no notes).
            const marker = `asaas payment ${payment.providerChargeId}`;
            const { data: queued } = await admin
              .from("pix_refunds_pending")
              .select("id")
              .like("notes", `%${marker}%`)
              .limit(1);
            if (Array.isArray(queued) && queued.length > 0) continue;

            await queuePixRefund(admin, {
              pix_charge_id: null,
              entity_type: null,
              entity_id: null,
              user_id: null,
              amount_cents: payment.paidAmountCents ?? 0,
              reason: "orphan_payment",
              notes: `${marker} sem par em pix_charges (reconcile ${day})`,
            });
            result.orphans_found++;
          } catch (e) {
            errors.push(
              `orphan ${payment.providerChargeId}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }

    const divergences = result.corrected + result.mismatches + result.orphans_found;
    if (divergences > 0) {
      await notifyAdmins(
        admin,
        `Conciliação Pix encontrou ${divergences} divergência(s): ` +
          `${result.corrected} corrigida(s), ${result.mismatches} com valor divergente, ` +
          `${result.orphans_found} pagamento(s) órfão(s). Veja Pagamentos → Pix no admin.`,
      );
    }

    return new Response(
      JSON.stringify({ ok: true, ...result, errors: errors.length ? errors : undefined }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[reconcile-pix] unhandled:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
