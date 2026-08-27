import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PIX_CHARGE_ROW_COLUMNS,
  type PixChargeRow,
  refreshAndSettlePixCharge,
} from "../_shared/pixProviders/settle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type",
};

/**
 * get-pix-charge-status — polling com AUTO-CORREÇÃO (fallback do realtime).
 *
 * POST { pix_charge_id } → { status, paid_at, expires_at, entity_type, entity_id }.
 *
 * Se a cobrança está pending e já tem provider_charge_id, re-consulta o
 * provedor da PRÓPRIA linha e liquida com o MESMO settlePixCharge do webhook —
 * webhook fora do ar não trava a confirmação (e o reconcile diário acharia de
 * qualquer jeito). Só o dono da cobrança pode consultar.
 */

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("x-auth-token");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : (authHeader ?? "").trim();
    if (!token) {
      return jsonRes({ error: "Não autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const claims = claimsData?.claims as { sub?: string } | undefined;
    const userId = claims?.sub;
    if (claimsError || !userId) {
      return jsonRes({ error: "Sessão inválida ou expirada" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as { pix_charge_id?: string };
    const chargeId = body.pix_charge_id?.trim();
    if (!chargeId) {
      return jsonRes({ error: "pix_charge_id é obrigatório" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const loadCharge = async (): Promise<(PixChargeRow & { paid_at: string | null }) | null> => {
      const { data } = await admin
        .from("pix_charges")
        .select(`${PIX_CHARGE_ROW_COLUMNS}, paid_at`)
        .eq("id", chargeId)
        .maybeSingle();
      return (data as (PixChargeRow & { paid_at: string | null }) | null) ?? null;
    };

    let charge = await loadCharge();
    if (!charge || charge.user_id !== userId) {
      return jsonRes({ error: "Cobrança não encontrada" }, 404);
    }

    // Auto-correção: pending com provider_charge_id → re-consulta + settle.
    if (charge.status === "pending" && charge.provider_charge_id) {
      try {
        await refreshAndSettlePixCharge(admin, charge);
        charge = (await loadCharge()) ?? charge;
      } catch (e) {
        // Provedor fora do ar: devolve o estado atual do banco (polling continua).
        console.warn("[get-pix-charge-status] re-consulta falhou:", e instanceof Error ? e.message : e);
      }
    }

    return jsonRes({
      status: charge.status,
      paid_at: charge.paid_at,
      expires_at: charge.expires_at,
      entity_type: charge.entity_type,
      entity_id: charge.entity_id,
    });
  } catch (err) {
    console.error("get-pix-charge-status:", err);
    return jsonRes(
      { error: err instanceof Error ? err.message : "Erro ao consultar cobrança" },
      500,
    );
  }
});
