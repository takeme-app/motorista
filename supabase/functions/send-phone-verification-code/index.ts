import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 1000 + (buf[0]! % 9000);
  return String(n);
}

type Purpose = "signup" | "password_reset";

function parsePurpose(raw: unknown): Purpose {
  if (raw === "password_reset") return "password_reset";
  return "signup";
}

function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

function normalizePhoneForZapi(phoneDigits: string): string | null {
  const digits = phoneDigits.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return null;
}

async function sendZapiCode(input: {
  phoneDigits: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID")?.trim() ?? "";
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN")?.trim() ?? "";
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN")?.trim() ?? "";

  if (!instanceId || !instanceToken || !clientToken) {
    return {
      ok: false,
      status: 503,
      error: "WhatsApp não configurado. Defina ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN e ZAPI_CLIENT_TOKEN.",
    };
  }

  const phone = normalizePhoneForZapi(input.phoneDigits);
  if (!phone) {
    return {
      ok: false,
      status: 400,
      error: "Telefone inválido para envio via WhatsApp.",
    };
  }

  const message = `Seu código Take Me é: ${input.code}. Ele expira em 10 minutos.`;
  const url = `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Client-Token": clientToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message }),
    });
  } catch (err) {
    console.error("[send-phone-verification-code] Z-API fetch error:", err);
    return {
      ok: false,
      status: 502,
      error: "Não foi possível contatar o provedor de WhatsApp.",
    };
  }

  if (response.ok) {
    return { ok: true };
  }

  let providerMessage = "";
  try {
    const body = await response.json();
    const candidate =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
        ? body.error
        : "";
    providerMessage = candidate.trim();
  } catch {
    try {
      providerMessage = (await response.text()).trim();
    } catch {
      providerMessage = "";
    }
  }

  console.error("[send-phone-verification-code] Z-API error:", {
    status: response.status,
    message: providerMessage || null,
  });

  return {
    ok: false,
    status: response.status >= 400 && response.status < 600 ? response.status : 502,
    error: providerMessage || "Falha ao enviar WhatsApp. Tente novamente.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("[send-phone-verification-code] requisição recebida");
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Corpo JSON inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { phone, purpose: purposeRaw } = body as {
      phone?: string;
      purpose?: string;
    };

    const phoneDigits = normalizePhoneBR(phone);
    if (!phoneDigits) {
      return new Response(
        JSON.stringify({ error: "Telefone inválido. Informe DDD + número." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[send-phone-verification-code] SUPABASE_URL/SERVICE_ROLE_KEY ausente");
      return new Response(
        JSON.stringify({ error: "Configuração da função incompleta." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const purpose = parsePurpose(purposeRaw);

    const phoneVariants = new Set<string>([phoneDigits]);
    if (phoneDigits.startsWith("55") && phoneDigits.length > 12) {
      phoneVariants.add(phoneDigits.slice(2));
    }

    let existingPhoneId: string | null = null;
    for (const candidate of phoneVariants) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone", candidate)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        existingPhoneId = data.id as string;
        break;
      }
    }

    if (purpose === "signup" && existingPhoneId) {
      return new Response(
        JSON.stringify({
          error: "Este telefone já está cadastrado. Faça login ou use outro número.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (purpose === "password_reset" && !existingPhoneId) {
      return new Response(
        JSON.stringify({
          error: "Não encontramos uma conta com este telefone. Verifique o número ou cadastre-se.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Limpa códigos anteriores para esse telefone/purpose.
    const { error: delErr } = await supabase
      .from("phone_verification_codes")
      .delete()
      .eq("phone", phoneDigits)
      .eq("purpose", purpose);
    if (delErr) {
      console.error("[send-phone-verification-code] delete códigos anteriores:", delErr);
    }

    const code = generateCode();

    const insertRow: Record<string, unknown> = {
      phone: phoneDigits,
      code,
      purpose,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    const { error: insertError } = await supabase
      .from("phone_verification_codes")
      .insert(insertRow as never);

    if (insertError) {
      console.error("[send-phone-verification-code] insert error:", insertError);
      const rawMsg = `${insertError.message ?? ""} ${(insertError as { details?: string }).details ?? ""}`;
      const msg = rawMsg.toLowerCase();
      const missingTable =
        msg.includes("could not find") && msg.includes("phone_verification_codes");
      const userMsg = missingTable
        ? "Banco de dados desatualizado: aplique a migração de phone_verification_codes."
        : "Erro ao gerar código. Tente novamente.";
      return new Response(JSON.stringify({ error: userMsg }), {
        status: missingTable ? 503 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const zapiResult = await sendZapiCode({ phoneDigits, code });
    if (!zapiResult.ok) {
      await supabase
        .from("phone_verification_codes")
        .delete()
        .eq("phone", phoneDigits)
        .eq("purpose", purpose);

      return new Response(JSON.stringify({ error: zapiResult.error }), {
        status: zapiResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[send-phone-verification-code] código enviado via Z-API", {
      phone: phoneDigits,
      purpose,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-phone-verification-code] exceção:", err);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
