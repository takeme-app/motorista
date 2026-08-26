import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AsaasProvider } from "../_shared/pixProviders/asaas.ts";
import { PixProviderUnavailableError } from "../_shared/pixProviders/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * pix-provider-health — saúde dos provedores Pix para a aba do admin.
 *
 * Exige admin (app_metadata.role === 'admin').
 *   GET          → { providers: { asaas: { configured, env }, bradesco: { configured } } }
 *                  (só presença de env — barato, sem chamada externa)
 *   GET ?ping=1  → adiciona ping real de credencial (GET /v3/myAccount no
 *                  Asaas) → { ok, detail }.
 *
 * A resposta NUNCA contém a chave (nem trechos dela).
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
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : "";
    if (!token) {
      return jsonRes({ error: "Não autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user || user.app_metadata?.role !== "admin") {
      return jsonRes({ error: "Acesso restrito a administradores" }, 403);
    }

    const url = new URL(req.url);
    const ping = url.searchParams.get("ping") === "1";

    const asaasKey = Deno.env.get("ASAAS_API_KEY")?.trim() ?? "";
    const asaasUrl = Deno.env.get("ASAAS_API_URL")?.trim() ?? "";
    const asaasConfigured = Boolean(asaasKey && asaasUrl);

    const providers: Record<string, Record<string, unknown>> = {
      asaas: {
        configured: asaasConfigured,
        env: asaasConfigured ? (asaasUrl.includes("sandbox") ? "sandbox" : "production") : null,
      },
      bradesco: {
        configured: false,
        env: null,
      },
    };

    if (ping && asaasConfigured) {
      const admin = createClient(supabaseUrl, serviceRoleKey);
      try {
        const asaas = new AsaasProvider(admin);
        providers.asaas.ping = await asaas.ping();
      } catch (e) {
        providers.asaas.ping = {
          ok: false,
          detail: e instanceof PixProviderUnavailableError ? e.message : "falha ao inicializar o provedor",
        };
      }
    } else if (ping) {
      providers.asaas.ping = { ok: false, detail: "secrets não configurados" };
    }

    return jsonRes({ ok: true, providers });
  } catch (err) {
    console.error("pix-provider-health:", err);
    return jsonRes(
      { error: err instanceof Error ? err.message : "Erro ao consultar saúde dos provedores" },
      500,
    );
  }
});
