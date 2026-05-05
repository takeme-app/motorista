import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const arr = new Uint8Array(sig);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type PwdResetPayload = {
  sub: string;
  /** Legacy: tokens antigos por e-mail. */
  email?: string;
  /** Atual: e-mail real, e-mail fake de telefone ou telefone mascarado. */
  identifier?: string;
  exp: number;
  typ: "pwd_reset";
};

function getPasswordResetSecret(): string {
  const a = Deno.env.get("PASSWORD_RESET_TOKEN_SECRET");
  if (a && a.trim().length >= 16) return a.trim();
  const b = Deno.env.get("DRIVER_DEFERRED_SIGNUP_SECRET");
  if (b && b.trim().length >= 16) return b.trim();
  const c = Deno.env.get("SUPABASE_JWT_SECRET");
  if (c && c.trim().length >= 16) return c.trim();
  const d = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (d && d.trim().length >= 32) return d.trim().slice(0, 64);
  throw new Error("Defina PASSWORD_RESET_TOKEN_SECRET ou SUPABASE_JWT_SECRET (mín. 16 caracteres)");
}

function base64UrlDecodeToString(b64url: string): string {
  const pad = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function verifyPasswordResetToken(token: string): Promise<PwdResetPayload> {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Token inválido");
  const [payloadB64, sigHex] = parts;
  const secret = getPasswordResetSecret();
  const expected = await hmacSha256Hex(secret, payloadB64);
  if (expected !== sigHex) throw new Error("Token inválido");
  const json = base64UrlDecodeToString(payloadB64);
  const payload = JSON.parse(json) as PwdResetPayload;
  if (payload.typ !== "pwd_reset" || !payload.sub || (!payload.email && !payload.identifier)) {
    throw new Error("Token inválido");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expirado. Solicite um novo código.");
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as { token?: string; password?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!token || !password) {
      return new Response(JSON.stringify({ error: "Token e senha são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "A senha deve ter no mínimo 8 caracteres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let payload: PwdResetPayload;
    try {
      payload = await verifyPasswordResetToken(token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Token inválido";
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { error: upErr } = await admin.auth.admin.updateUserById(payload.sub, { password });
    if (upErr) {
      console.error("[complete-password-reset] updateUserById", upErr);
      const m = (upErr.message ?? "").toLowerCase();
      const userMsg =
        m.includes("password") || m.includes("weak")
          ? "Senha não atende às regras de segurança. Tente outra."
          : "Não foi possível atualizar a senha. Solicite um novo código.";
      return new Response(JSON.stringify({ error: userMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[complete-password-reset]", err);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
