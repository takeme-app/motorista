import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createEmailChangeToken } from "../_shared/emailChangeToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** E-mail sintético `{digits}@takeme.com` = conta cujo login é o telefone. */
function isSyntheticEmail(email: string | null | undefined): boolean {
  return /^\d{6,}@takeme\.com$/i.test((email ?? "").trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Não autorizado" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("[change-login-email] missing env");
      return json({ error: "Configuração do servidor incompleta." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ error: "Sessão inválida ou expirada" }, 401);

    // Conta por telefone: e-mail é só registro, não troca de login por aqui.
    if (isSyntheticEmail(user.email)) {
      return json(
        { error: "Esta conta usa o telefone como login; o e-mail é apenas um registro." },
        400,
      );
    }

    const body = (await req.json().catch(() => ({}))) as { newEmail?: string };
    const newEmail = (body.newEmail ?? "").trim().toLowerCase();
    if (!newEmail || !EMAIL_RE.test(newEmail)) {
      return json({ error: "Informe um e-mail válido." }, 400);
    }
    if (newEmail === (user.email ?? "").trim().toLowerCase()) {
      return json({ error: "O e-mail informado é o mesmo da sua conta." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Unicidade: o e-mail novo não pode pertencer a outra conta.
    const { data: existingId, error: lookupErr } = await admin.rpc(
      "lookup_auth_user_id_by_normalized_email",
      { p_email: newEmail },
    );
    if (lookupErr) {
      console.warn("[change-login-email] lookup", lookupErr.message);
    } else if (existingId && existingId !== user.id) {
      return json({ error: "Este e-mail já está cadastrado. Use outro e-mail." }, 400);
    }

    // Token de confirmação + link para o endpoint público de confirmação.
    const changeToken = await createEmailChangeToken(user.id, newEmail);
    const link = `${supabaseUrl}/functions/v1/confirm-email-change?token=${encodeURIComponent(changeToken)}`;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "Take Me <onboarding@resend.dev>";
    if (!resendKey) {
      console.error("[change-login-email] RESEND_API_KEY não definida");
      return json({ error: "Configuração de e-mail indisponível." }, 500);
    }

    const oldEmail = (user.email ?? "").trim();
    const subject = "Confirme a alteração de e-mail - Take Me";
    const html =
      `<p>Recebemos um pedido para alterar o e-mail da sua conta Take Me para <strong>${newEmail}</strong>.</p>` +
      `<p>Para confirmar, clique no link abaixo (válido por 1 hora):</p>` +
      `<p><a href="${link}">Confirmar alteração de e-mail</a></p>` +
      `<p>Se você não solicitou, ignore este e-mail — nada será alterado.</p>`;
    const text =
      `Take Me — alteração de e-mail\n\n` +
      `Pedido para alterar o e-mail da conta para ${newEmail}.\n` +
      `Confirme pelo link (válido por 1 hora):\n${link}\n\n` +
      `Se você não solicitou, ignore este e-mail.`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({ from: fromEmail, to: [oldEmail], subject, html, text }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("[change-login-email] Resend error:", res.status, errText);
        return json({ error: "Falha ao enviar o e-mail de confirmação. Tente novamente." }, 502);
      }
    } catch (resendErr) {
      console.error("[change-login-email] Resend exceção:", resendErr);
      return json({ error: "Falha ao contatar o provedor de e-mail. Tente novamente." }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[change-login-email]", err);
    return json({ error: "Erro interno" }, 500);
  }
});
