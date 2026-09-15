import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AsaasProvider } from "../_shared/pixProviders/asaas.ts";
import { BradescoProvider } from "../_shared/pixProviders/bradesco.ts";
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

    // Bradesco: mTLS + OAuth. "Configurado" = os 6 secrets presentes.
    const bradescoUrl = Deno.env.get("BRADESCO_API_URL")?.trim() ?? "";
    const bradescoConfigured = Boolean(
      bradescoUrl &&
        Deno.env.get("BRADESCO_CLIENT_ID")?.trim() &&
        Deno.env.get("BRADESCO_CLIENT_SECRET")?.trim() &&
        Deno.env.get("BRADESCO_CERT_PEM") &&
        Deno.env.get("BRADESCO_KEY_PEM") &&
        Deno.env.get("BRADESCO_PIX_KEY")?.trim(),
    );

    const providers: Record<string, Record<string, unknown>> = {
      asaas: {
        configured: asaasConfigured,
        env: asaasConfigured ? (asaasUrl.includes("sandbox") ? "sandbox" : "production") : null,
      },
      bradesco: {
        configured: bradescoConfigured,
        env: bradescoConfigured
          ? (/sandbox|prebanco/i.test(bradescoUrl) ? "sandbox" : "production")
          : null,
      },
    };

    if (ping) {
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const pingOne = async (
        name: string,
        configured: boolean,
        make: () => { ping: () => Promise<{ ok: boolean; detail: string }> },
      ) => {
        if (!configured) {
          providers[name].ping = { ok: false, detail: "secrets não configurados" };
          return;
        }
        try {
          providers[name].ping = await make().ping();
        } catch (e) {
          providers[name].ping = {
            ok: false,
            detail: e instanceof PixProviderUnavailableError
              ? e.message
              : "falha ao inicializar o provedor",
          };
        }
      };

      await pingOne("asaas", asaasConfigured, () => new AsaasProvider(admin));
      await pingOne("bradesco", bradescoConfigured, () => new BradescoProvider(admin));
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
