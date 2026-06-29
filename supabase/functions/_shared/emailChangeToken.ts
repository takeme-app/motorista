// deno-lint-ignore-file no-explicit-any
import { getPasswordResetSecret } from "./passwordResetToken.ts";

/**
 * Token HMAC autocontido para confirmar a troca de e-mail (conta por e-mail).
 * `change-login-email` gera o token e envia o link por e-mail; `confirm-email-change`
 * valida o mesmo formato — `{payloadBase64Url}.{hexHmacSha256}` — e aplica a troca.
 * Reusa o mesmo segredo do fluxo de reset de senha (getPasswordResetSecret).
 */

const encoder = new TextEncoder();

export type EmailChangePayload = {
  sub: string;
  newEmail: string;
  exp: number;
  typ: "email_change";
};

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
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

/** Gera token de ~1h para confirmar a troca para `newEmail`. */
export async function createEmailChangeToken(
  userId: string,
  newEmail: string,
): Promise<string> {
  const secret = getPasswordResetSecret();
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const payload: EmailChangePayload = {
    sub: userId,
    newEmail,
    exp,
    typ: "email_change",
  };
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await hmacSha256Hex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Valida assinatura, tipo e expiração; lança em caso de token inválido/expirado. */
export async function verifyEmailChangeToken(token: string): Promise<EmailChangePayload> {
  const parts = token.split(".");
  const payloadB64 = parts[0];
  const sigHex = parts[1];
  if (!payloadB64 || !sigHex) throw new Error("Token inválido");
  const secret = getPasswordResetSecret();
  const expected = await hmacSha256Hex(secret, payloadB64);
  if (expected !== sigHex) throw new Error("Token inválido");
  const payload = JSON.parse(base64UrlDecodeToString(payloadB64)) as EmailChangePayload;
  if (payload.typ !== "email_change" || !payload.sub || !payload.newEmail) {
    throw new Error("Token inválido");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expirado");
  return payload;
}
