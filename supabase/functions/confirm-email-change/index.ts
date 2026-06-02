import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyEmailChangeToken } from "../_shared/emailChangeToken.ts";

/**
 * Endpoint PÚBLICO (GET) aberto pelo link do e-mail de confirmação.
 * Aplica a troca de e-mail via admin e devolve uma mensagem simples.
 * Deploy com --no-verify-jwt (a segurança é o token assinado na query).
 *
 * Obs.: o gateway das Edge Functions força `text/plain` + `nosniff` nas
 * respostas, então devolvemos TEXTO PURO (HTML apareceria cru ao usuário).
 */

function textPage(title: string, message: string): Response {
  return new Response(`${title}\n\n${message}`, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token) {
      return textPage("Link inválido", "O link de confirmação está incompleto.");
    }

    let payload: { sub: string; newEmail: string };
    try {
      payload = await verifyEmailChangeToken(token);
    } catch (e) {
      const msg = e instanceof Error && e.message === "Token expirado"
        ? "Este link expirou. Solicite a alteração novamente no app."
        : "Link de confirmação inválido.";
      return textPage("Não foi possível confirmar", msg);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[confirm-email-change] missing env");
      return textPage("Erro", "Configuração do servidor incompleta.");
    }
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const newEmail = payload.newEmail.trim().toLowerCase();

    // Idempotência: se já está com o e-mail novo, mostra sucesso.
    const { data: current } = await admin.auth.admin.getUserById(payload.sub);
    if ((current?.user?.email ?? "").trim().toLowerCase() === newEmail) {
      return textPage("E-mail confirmado", "Seu e-mail já está atualizado. Pode voltar ao app.");
    }

    // Revalida unicidade (corrida entre pedido e confirmação).
    const { data: existingId } = await admin.rpc(
      "lookup_auth_user_id_by_normalized_email",
      { p_email: newEmail },
    );
    if (existingId && existingId !== payload.sub) {
      return textPage(
        "Não foi possível confirmar",
        "Este e-mail já está cadastrado em outra conta.",
      );
    }

    const prevMeta = (current?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const { error: updErr } = await admin.auth.admin.updateUserById(payload.sub, {
      email: newEmail,
      email_confirm: true,
      user_metadata: { ...prevMeta, email: newEmail, login_method: "email" },
    });
    if (updErr) {
      console.error("[confirm-email-change] updateUserById", updErr.message);
      const dup = /already|exists|registered|duplicate|unique/i.test(updErr.message ?? "");
      return textPage(
        "Não foi possível confirmar",
        dup ? "Este e-mail já está cadastrado em outra conta." : "Tente novamente mais tarde.",
      );
    }

    return textPage(
      "E-mail confirmado",
      "Seu e-mail foi alterado com sucesso. Pode voltar ao app.",
    );
  } catch (err) {
    console.error("[confirm-email-change]", err);
    return textPage("Erro", "Não foi possível processar o link. Tente novamente.");
  }
});
