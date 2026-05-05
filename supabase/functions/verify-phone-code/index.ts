// TODO (onboarding telefone/WhatsApp):
// - Este endpoint é irmão de `verify-email-code`, mas identifica o usuário por telefone.
// - Integra com a Z-API (envio em `send-phone-verification-code`).
// - Cria a conta em auth.users usando e-mail FAKE no formato `{phoneDigits}@takeme.com`
//   + senha. O telefone real fica em `user_metadata.phone` e é replicado para
//   `profiles.phone` por trigger. Dessa forma, `login-with-phone` encontra o e-mail
//   real via `profiles.phone → auth.users.email` e faz signIn normal.
// - Quando `password_reset: true`, não cria conta — apenas valida o OTP e devolve um
//   token HMAC compatível com `complete-password-reset` (mesmo formato do e-mail).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createPasswordResetToken,
  findAuthUserIdByPhone,
} from "../_shared/passwordResetToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RegistrationType = "take_me" | "parceiro" | "preparador_excursões" | "preparador_encomendas";

function parseRegistrationType(raw: unknown): RegistrationType | null {
  if (
    raw === "take_me" ||
    raw === "parceiro" ||
    raw === "preparador_excursões" ||
    raw === "preparador_encomendas"
  ) {
    return raw;
  }
  return null;
}

function mapDriverTypeToSubtype(t: RegistrationType): {
  role: "driver" | "preparer";
  subtype: "takeme" | "partner" | "excursions" | "shipments";
} {
  if (t === "take_me") return { role: "driver", subtype: "takeme" };
  if (t === "parceiro") return { role: "driver", subtype: "partner" };
  if (t === "preparador_excursões") return { role: "preparer", subtype: "excursions" };
  return { role: "preparer", subtype: "shipments" };
}

function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

/**
 * E-mail fake usado para criar a conta Auth quando o cadastro é por telefone.
 * Formato: `{digitosDoTelefone}@takeme.com`. Mantém o telefone como identidade
 * primária em `profiles.phone` (populado por trigger a partir de `user_metadata.phone`).
 */
function phoneToFakeEmail(digits: string): string {
  return `${digits}@takeme.com`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as {
      phone?: string;
      code?: string;
      password?: string;
      fullName?: string;
      driver_type?: string;
      password_reset?: boolean | string | number;
    };
    const { phone, code, password, fullName, driver_type, password_reset } = body;
    const wantsPasswordReset =
      password_reset === true || password_reset === "true" || password_reset === 1;
    const registrationType = parseRegistrationType(driver_type);

    const phoneDigits = normalizePhoneBR(phone);
    if (!phoneDigits) {
      return new Response(
        JSON.stringify({ error: "Telefone inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Código é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (
      !wantsPasswordReset &&
      (!password || typeof password !== "string" || password.length < 6)
    ) {
      return new Response(
        JSON.stringify({ error: "Senha é obrigatória (mínimo 6 caracteres)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const codeTrim = code.replace(/\D/g, "").slice(0, 4);
    if (codeTrim.length !== 4) {
      return new Response(
        JSON.stringify({ error: "Código inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const nowIso = new Date().toISOString();
    const purpose = wantsPasswordReset ? "password_reset" : "signup";

    const { data: candidates, error: selectError } = await admin
      .from("phone_verification_codes")
      .select("id, code, user_id")
      .eq("phone", phoneDigits)
      .eq("purpose", purpose)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(20);

    if (selectError) {
      console.error("[verify-phone-code] select codes", selectError);
      return new Response(
        JSON.stringify({ error: "Código inválido ou expirado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const normalizeOtp = (raw: unknown) =>
      String(raw ?? "")
        .replace(/\D/g, "")
        .slice(0, 4);

    const matched =
      (candidates ?? []).find(
        (c: { id: string; code: string }) => normalizeOtp(c.code) === codeTrim,
      ) ?? null;

    if (!matched?.id) {
      return new Response(
        JSON.stringify({ error: "Código inválido ou expirado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await admin.from("phone_verification_codes").delete().eq("id", matched.id);

    if (wantsPasswordReset) {
      const userId =
        matched.user_id ??
        (await findAuthUserIdByPhone(admin, phoneDigits));
      if (!userId) {
        return new Response(
          JSON.stringify({ error: "Conta não encontrada." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      try {
        const token = await createPasswordResetToken(userId, phoneToFakeEmail(phoneDigits));
        return new Response(
          JSON.stringify({ ok: true, password_reset_token: token }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        console.error("[verify-phone-code] password reset token", e);
        return new Response(
          JSON.stringify({
            error:
              "Configuração do servidor incompleta (token de redefinição). Defina PASSWORD_RESET_TOKEN_SECRET ou SUPABASE_JWT_SECRET.",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", phoneDigits)
      .limit(1)
      .maybeSingle();

    if (existingProfile) {
      return new Response(
        JSON.stringify({ error: "Este telefone já está cadastrado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fakeEmail = phoneToFakeEmail(phoneDigits);
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email: fakeEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName ?? null,
        phone: phoneDigits,
      },
    });

    if (createError) {
      const msg = (createError.message ?? "").toLowerCase();
      const userMsg =
        msg.includes("already") || msg.includes("registered")
          ? "Este telefone já está cadastrado."
          : msg.includes("password") || msg.includes("senha")
          ? "Senha inválida. Use no mínimo 6 caracteres."
          : "Erro ao criar conta. Tente novamente.";
      return new Response(JSON.stringify({ error: userMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = createData?.user?.id;

    if (newUserId && registrationType) {
      const { role, subtype } = mapDriverTypeToSubtype(registrationType);
      const { error: wpErr } = await admin.from("worker_profiles").insert({
        id: newUserId,
        role,
        subtype,
        status: "inactive",
      });
      if (wpErr) {
        console.error("[verify-phone-code] worker_profiles insert:", wpErr);
        try {
          await admin.auth.admin.deleteUser(newUserId);
        } catch (delErr) {
          console.error("[verify-phone-code] rollback auth.admin.deleteUser:", delErr);
        }
        return new Response(
          JSON.stringify({
            error:
              "Não foi possível concluir seu cadastro agora. Tente novamente em instantes; se persistir, contate o suporte.",
            debug: wpErr.message,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (newUserId) {
      await admin.from("notifications").insert({
        user_id: newUserId,
        title: "Conta criada",
        message: "Seu telefone foi verificado e sua conta está ativa.",
        category: "account",
      });
    }

    return new Response(
      JSON.stringify({ ok: true, user_id: newUserId ?? null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[verify-phone-code] exceção:", err);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
