// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { JWT } from "npm:google-auth-library@9";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GOOGLE_PROJECT_ID = Deno.env.get("GOOGLE_PROJECT_ID");
const GOOGLE_CLIENT_EMAIL = Deno.env.get("GOOGLE_CLIENT_EMAIL");
const GOOGLE_PRIVATE_KEY = (Deno.env.get("GOOGLE_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
/** Opcional: mesmo valor no header `x-webhook-secret` do Database Webhook. */
const NOTIFICATION_FCM_WEBHOOK_SECRET = Deno.env.get("NOTIFICATION_FCM_WEBHOOK_SECRET") || "";

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function json(status: number, data: Record<string, unknown>) {
  // HTTP/Fetch spec: alguns status não permitem body. Normaliza para 200.
  const safeStatus = NULL_BODY_STATUSES.has(status) ? 200 : status;
  return new Response(JSON.stringify(data), {
    status: safeStatus,
    headers: { "Content-Type": "application/json" },
  });
}

function getRecordFromBody(body: any): Record<string, unknown> | null {
  if (body && typeof body.record === "object" && body.record !== null) {
    return body.record as Record<string, unknown>;
  }
  if (body && typeof body === "object" && !body.type && !body.table) {
    return body as Record<string, unknown>;
  }
  return null;
}

async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const jwtClient = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    jwtClient.authorize((err: unknown, tokens: { access_token?: string } | null | undefined) => {
      if (err) return reject(err);
      if (!tokens?.access_token) return reject(new Error("No access_token"));
      resolve(tokens.access_token);
    });
  });
}

Deno.serve(async (req) => {
  const error_id = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  try {
    if (NOTIFICATION_FCM_WEBHOOK_SECRET) {
      const sent = req.headers.get("x-webhook-secret") ?? "";
      if (sent !== NOTIFICATION_FCM_WEBHOOK_SECRET) {
        return json(401, { error: "Unauthorized", error_id });
      }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase envs", error_id });
    }
    if (!GOOGLE_PROJECT_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      return json(500, { error: "Missing Google FCM envs", error_id });
    }

    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      return json(200, { ok: true, info: "No JSON body", error_id });
    }

    if (payload?.table && payload.table !== "notifications") {
      return json(200, { ok: true, info: "Ignored: other table", error_id });
    }

    // Só envia push em INSERT. O trigger `notifications_push` dispara em
    // AFTER INSERT OR UPDATE; sem este guard, qualquer UPDATE da linha
    // (ex.: marcar como lida -> read_at) reenviava o MESMO push, gerando
    // notificação duplicada no device.
    if (payload?.type === "UPDATE" || payload?.type === "DELETE") {
      return json(200, { ok: true, info: `Ignored: ${payload.type} (no re-send)`, error_id });
    }

    const record = getRecordFromBody(payload);
    if (!record) {
      return json(200, { ok: true, info: "No record", error_id });
    }

    const userId = record.user_id as string | undefined;
    if (!userId) {
      return json(400, { error: "No user_id on notification record", error_id });
    }

    const rawTarget = record.target_app_slug as string | undefined;
    const targetAppSlug = rawTarget === "motorista" ? "motorista" : "cliente";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: tokenRows, error: tokErr } = await supabase
      .from("profile_fcm_tokens")
      .select("fcm_token")
      .eq("profile_id", userId)
      .eq("app_slug", targetAppSlug);

    if (tokErr) {
      return json(500, { error: `Tokens query: ${tokErr.message}`, error_id });
    }

    const tokens = (tokenRows ?? [])
      .map((r: { fcm_token: string }) => r.fcm_token)
      .filter(Boolean);
    if (tokens.length === 0) {
      return json(200, {
        ok: true,
        info: "No FCM tokens for profile",
        target_app_slug: targetAppSlug,
        error_id,
      });
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY);
    } catch (e: unknown) {
      return json(500, {
        error: "FCM token error",
        detail: String(e instanceof Error ? e.message : e),
        error_id,
      });
    }

    const title = String(record.title ?? "Nova notificação");
    const bodyText = record.message != null ? String(record.message) : "";
    const customData: Record<string, string> = {
      notification_id: String(record.id ?? ""),
      category: String(record.category ?? ""),
      target_app_slug: targetAppSlug,
      read_at: record.read_at != null ? String(record.read_at) : "",
      created_at: String(record.created_at ?? ""),
    };

    // Deeplink: `notifications.data` guarda `{ route, params }`. O FCM só aceita
    // valores string em `data`, então enviamos `route` como string e `params`
    // como JSON string (o parser dos apps já desserializa params string).
    // Sem isto, o app recebe a push mas não sabe para onde navegar ao tocar.
    let deeplink: Record<string, unknown> | null = null;
    const rawData = record.data;
    if (rawData && typeof rawData === "object") {
      deeplink = rawData as Record<string, unknown>;
    } else if (typeof rawData === "string" && rawData.trim()) {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed && typeof parsed === "object") {
          deeplink = parsed as Record<string, unknown>;
        }
      } catch {
        /* data não era JSON válido — segue sem deeplink */
      }
    }
    if (deeplink && typeof deeplink.route === "string" && deeplink.route.trim()) {
      customData.route = deeplink.route.trim();
      if (deeplink.params != null) {
        customData.params =
          typeof deeplink.params === "string"
            ? deeplink.params
            : JSON.stringify(deeplink.params);
      }
    }

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/messages:send`;
    const results: unknown[] = [];

    for (const token of tokens) {
      // Android: data-only (SEM o bloco `notification`) — o sistema NÃO auto-exibe
      // na bandeja; o app renderiza exatamente 1x via Notifee (foreground onMessage
      // + setBackgroundMessageHandler). Isso elimina a dupla (bandeja do sistema +
      // Notifee). title/body viajam no `data` (display_title/display_body), que o app
      // já lê. iOS: alerta via apns (sem `content-available`, p/ não acionar o handler
      // de background no iOS e evitar dupla lá também).
      const dataPayload: Record<string, string> = {
        ...customData,
        display_title: title,
        display_body: bodyText,
        // id estável p/ o Notifee (substitui/colapsa em vez de empilhar duplicado).
        fcm_android_tag: String(record.id ?? ""),
      };
      const messagePayload = {
        message: {
          token,
          data: dataPayload,
          android: {
            priority: "HIGH",
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: {
              aps: {
                alert: { title, body: bodyText },
                sound: "default",
              },
            },
          },
        },
      };

      const r = await fetch(fcmUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(messagePayload),
      });
      const resText = await r.text();
      let resJson: unknown = null;
      try {
        resJson = JSON.parse(resText);
      } catch {
        resJson = resText;
      }
      if (!r.ok) {
        results.push({ token: token.slice(0, 12) + "...", error: resJson });
      } else {
        results.push({ token: token.slice(0, 12) + "...", ok: true });
      }
    }

    const anyFail = results.some((x: any) => x && x.error);
    return json(anyFail ? 502 : 200, {
      ok: !anyFail,
      sent: tokens.length,
      results,
      error_id,
    });
  } catch (e: unknown) {
    console.error("dispatch-notification-fcm", e, error_id);
    return json(500, { error: "Internal Error", error_id });
  }
});
