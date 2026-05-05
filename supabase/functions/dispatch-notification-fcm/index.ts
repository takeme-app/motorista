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

/** Converte `notifications.data` (jsonb) em mapa string→string (FCM) e lê metadados de colapso/tag. */
function parseNotificationDataJson(record: Record<string, unknown>): {
  flat: Record<string, string>;
  fcmAndroidTag?: string;
  fcmCollapseKey?: string;
  fcmDataOnly: boolean;
} {
  const raw = record.data;
  let obj: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object" && !Array.isArray(p)) obj = p as Record<string, unknown>;
    } catch {
      /* manter vazio */
    }
  }
  const fcmAndroidTag = obj.fcm_android_tag != null ? String(obj.fcm_android_tag) : undefined;
  const fcmCollapseKey = obj.fcm_collapse_key != null ? String(obj.fcm_collapse_key) : undefined;
  const fcmDataOnly = obj.fcm_data_only === true || obj.fcm_data_only === "true";
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "object") flat[k] = JSON.stringify(v);
    else flat[k] = String(v);
  }
  return { flat, fcmAndroidTag, fcmCollapseKey, fcmDataOnly };
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

/** Resposta HTTP v1 da FCM: token inválido/desinstalado — remover linha em profile_fcm_tokens. */
function fcmErrorIndicatesStaleToken(resJson: unknown): boolean {
  if (!resJson || typeof resJson !== "object") return false;
  const root = resJson as { error?: unknown };
  const err = root.error;
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: string; message?: string; details?: unknown[] };
  if (e.status === "NOT_FOUND") return true;
  const details = e.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d === "object" && (d as { errorCode?: string }).errorCode === "UNREGISTERED") {
        return true;
      }
    }
  }
  if (typeof e.message === "string") {
    if (/Requested entity was not found/i.test(e.message)) return true;
    if (/not a valid FCM registration token/i.test(e.message)) return true;
  }
  return false;
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
    const parsed = parseNotificationDataJson(record);
    const customData: Record<string, string> = {
      notification_id: String(record.id ?? ""),
      category: String(record.category ?? ""),
      target_app_slug: targetAppSlug,
      read_at: record.read_at != null ? String(record.read_at) : "",
      created_at: String(record.created_at ?? ""),
      ...parsed.flat,
    };

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/messages:send`;
    const results: unknown[] = [];

    // Channel id precisa bater com o criado em runtime por cada app via
    // Notifee (react-native-notify-kit): garante que o FCM em background e
    // o display local em foreground usem o mesmo canal HIGH, evitando canais
    // duplicados e "heads-up" faltando no Android.
    const androidChannelId =
      targetAppSlug === "motorista" ? "motorista-default" : "cliente-default";

    for (const token of tokens) {
      const androidNotif: Record<string, unknown> = {
        sound: "default",
        channel_id: androidChannelId,
      };
      if (parsed.fcmAndroidTag) {
        androidNotif.tag = parsed.fcmAndroidTag;
      }

      const messageInner: Record<string, unknown> = parsed.fcmDataOnly
        ? {
          token,
          data: {
            ...customData,
            display_title: title,
            display_body: bodyText,
          },
          android: {
            priority: "HIGH",
            ...(parsed.fcmCollapseKey || parsed.fcmAndroidTag
              ? { collapse_key: parsed.fcmCollapseKey ?? parsed.fcmAndroidTag }
              : {}),
          },
        }
        : {
          token,
          notification: { title, body: bodyText },
          data: customData,
          android: {
            priority: "HIGH",
            notification: androidNotif,
            ...(parsed.fcmCollapseKey ? { collapse_key: parsed.fcmCollapseKey } : {}),
          },
        };

      const messagePayload = { message: messageInner };

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
        if (fcmErrorIndicatesStaleToken(resJson)) {
          const { error: delErr } = await supabase.from("profile_fcm_tokens").delete().eq("fcm_token", token);
          if (delErr) {
            console.error("dispatch-notification-fcm remove stale token", delErr.message, error_id);
          }
        } else {
          console.error("dispatch-notification-fcm fcm send failed", error_id, resJson);
        }
      } else {
        results.push({ token: token.slice(0, 12) + "...", ok: true });
      }
    }

    const anyFail = results.some((x: any) => x && x.error);
    // 200: webhook tratado; falha de entrega fica em ok / results (502 confundia gateway e gerava retries).
    return json(200, {
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
