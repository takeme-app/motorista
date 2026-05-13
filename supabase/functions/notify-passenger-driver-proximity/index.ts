// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getFcmAccessToken, sendFcmV1Message } from "../_shared/fcm_v1.ts";

/**
 * notify-passenger-driver-proximity
 *
 * Cron (recomendado a cada 2–3 min) com service-role:
 *   POST .../notify-passenger-driver-proximity
 *   Authorization: Bearer <SERVICE_ROLE_KEY>
 *
 * 1) Milestones (INSERT em public.notifications, respeitando should_notify_user):
 *    - "Motorista está a cerca de 5 minutos" — distância/velocidade média ≈ 4–8 min
 *    - "Motorista chegou a você" — distância ao ponto de embarque < ~120 m
 *
 * 2) Atualização contínua da ETA na mesma notificação Android (tag idêntico ao
 *    disparo "Motorista a caminho" / passenger_eta_<bookingId>): envio FCM direto
 *    sem nova linha na inbox (substitui visualmente com mesmo tag).
 *
 * Escopo v1: bookings (status=paid) + dependent_shipments (status=confirmed) com
 * coordenadas de origem; não cobre paradas intermediárias de encomenda multi-hop.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isServiceRoleToken(token: string): boolean {
  const p = decodeJwtPayload(token);
  return p?.role === "service_role" && p?.iss === "supabase";
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Velocidade urbana média conservadora (km/h) para ETA linear ponto a ponto. */
const AVG_SPEED_KMH = 22;

function etaMinutesStraightLine(distanceMeters: number): number {
  const speedMs = AVG_SPEED_KMH / 3.6;
  return distanceMeters / speedMs / 60;
}

type LiveRow = {
  scheduled_trip_id: string;
  latitude: number;
  longitude: number;
};

type BookingRow = {
  id: string;
  user_id: string;
  scheduled_trip_id: string;
  origin_lat: number;
  origin_lng: number;
  driver_eta_5min_notified_at: string | null;
  driver_arrived_pickup_notified_at: string | null;
};

type DepRow = {
  id: string;
  user_id: string;
  scheduled_trip_id: string;
  origin_lat: number | null;
  origin_lng: number | null;
  driver_eta_5min_notified_at: string | null;
  driver_arrived_pickup_notified_at: string | null;
};

const ANDROID_CH_CLIENTE = "cliente-default";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const projectId = Deno.env.get("GOOGLE_PROJECT_ID")!;
  const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL")!;
  const privateKey = (Deno.env.get("GOOGLE_PRIVATE_KEY") || "").replace(/\\n/g, "\n");

  const token = (req.headers.get("Authorization") ?? "")
    .replace("Bearer ", "")
    .trim();
  if (!isServiceRoleToken(token) && token !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!privateKey || !projectId || !clientEmail) {
    return new Response(JSON.stringify({ error: "FCM envs ausentes (Google)" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken(clientEmail, privateKey);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Token Google", detail: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: liveRows, error: liveErr } = await admin
    .from("scheduled_trip_live_locations")
    .select("scheduled_trip_id, latitude, longitude");

  if (liveErr) {
    return new Response(JSON.stringify({ error: liveErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const liveByTrip = new Map<string, LiveRow>();
  for (const r of liveRows ?? []) {
    liveByTrip.set((r as LiveRow).scheduled_trip_id, r as LiveRow);
  }

  const { data: trips, error: tripErr } = await admin
    .from("scheduled_trips")
    .select("id, status, driver_journey_started_at")
    .eq("status", "active")
    .not("driver_journey_started_at", "is", null);

  if (tripErr) {
    return new Response(JSON.stringify({ error: tripErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const activeTripIds = (trips ?? [])
    .map((t: { id: string }) => t.id)
    .filter((id: string) => liveByTrip.has(id));

  const stats = {
    trips_scanned: activeTripIds.length,
    eta_push_attempts: 0,
    milestones_5min: 0,
    milestones_arrived: 0,
    errors: [] as unknown[],
  };

  async function fetchTokens(profileId: string): Promise<string[]> {
    const { data: rows, error: e } = await admin
      .from("profile_fcm_tokens")
      .select("fcm_token")
      .eq("profile_id", profileId)
      .eq("app_slug", "cliente");
    if (e) {
      stats.errors.push({ step: "tokens", profileId, detail: e.message });
      return [];
    }
    return (rows ?? []).map((x: { fcm_token: string }) => x.fcm_token).filter(Boolean);
  }

  async function sendEtaRefresh(args: {
    userId: string;
    tag: string;
    tripId: string;
    entity: "booking" | "dependent";
    entityId: string;
    etaMin: number;
  }) {
    const { data: allowed } = await admin.rpc("should_notify_user", {
      p_user_id: args.userId,
      p_category: "trip_eta_live",
    } as any);
    if (!allowed) return;

    const tokens = await fetchTokens(args.userId);
    if (tokens.length === 0) return;

    const etaRounded = Math.max(1, Math.round(args.etaMin));
    const title = `Motorista a ${etaRounded} min`;
    const body = "Toque para acompanhar a localização em tempo real.";
    const collapse = args.tag;

    const baseData: Record<string, string> = {
      trip_eta_live: "1",
      category: "trip_eta_live",
      target_app_slug: "cliente",
      display_title: title,
      display_body: body,
      route: args.entity === "booking" ? "DriverOnTheWay" : "DependentShipmentDetail",
      trip_id: args.tripId,
      fcm_android_tag: args.tag,
      fcm_collapse_key: collapse,
    };
    if (args.entity === "booking") {
      baseData.booking_id = args.entityId;
      baseData.params = JSON.stringify({ tripId: args.tripId, bookingId: args.entityId });
    } else {
      baseData.dependent_shipment_id = args.entityId;
      baseData.params = JSON.stringify({ dependentShipmentId: args.entityId });
    }

    for (const tok of tokens) {
      stats.eta_push_attempts += 1;
      const r = await sendFcmV1Message(projectId, accessToken, {
        token: tok,
        title,
        body,
        androidChannelId: ANDROID_CH_CLIENTE,
        androidNotificationTag: args.tag,
        collapseKey: collapse,
        data: baseData,
        dataOnly: false,
      });
      if (!r.ok) stats.errors.push({ step: "fcm_eta", tag: args.tag, body: r.body });
    }
  }

  for (const tripId of activeTripIds) {
    const live = liveByTrip.get(tripId)!;
    const dLat = live.latitude;
    const dLng = live.longitude;

    const { data: bookings } = await admin
      .from("bookings")
      .select(
        "id, user_id, scheduled_trip_id, origin_lat, origin_lng, driver_eta_5min_notified_at, driver_arrived_pickup_notified_at",
      )
      .eq("scheduled_trip_id", tripId)
      .eq("status", "paid");

    for (const b of (bookings ?? []) as BookingRow[]) {
      const dist = haversineMeters(dLat, dLng, b.origin_lat, b.origin_lng);
      const etaMin = etaMinutesStraightLine(dist);

      const { data: allowTravel } = await admin.rpc("should_notify_user", {
        p_user_id: b.user_id,
        p_category: "travel_updates",
      } as any);

      let skipEtaRefresh = false;

      if (allowTravel && dist < 120 && !b.driver_arrived_pickup_notified_at) {
        const { error: insE } = await admin.from("notifications").insert({
          user_id: b.user_id,
          title: "Motorista chegou a você",
          message: "O motorista está no ponto de embarque. Confira no app.",
          category: "driver_arrived_pickup",
          target_app_slug: "cliente",
          data: {
            route: "DriverOnTheWay",
            params: { tripId: b.scheduled_trip_id, bookingId: b.id },
            fcm_android_tag: `passenger_eta_${b.id}`,
            fcm_collapse_key: `passenger_eta_${b.id}`,
          },
        } as never);
        if (!insE) {
          stats.milestones_arrived += 1;
          skipEtaRefresh = true;
          await admin
            .from("bookings")
            .update({ driver_arrived_pickup_notified_at: new Date().toISOString() } as never)
            .eq("id", b.id);
        } else {
          stats.errors.push({ step: "insert_arrived", booking: b.id, detail: insE.message });
        }
      } else if (
        allowTravel &&
        !b.driver_eta_5min_notified_at &&
        etaMin >= 4 &&
        etaMin <= 8 &&
        dist >= 120
      ) {
        const { error: ins5 } = await admin.from("notifications").insert({
          user_id: b.user_id,
          title: "Motorista está a cerca de 5 minutos",
          message: "Prepare-se para o embarque. Acompanhe no app.",
          category: "driver_eta_5min",
          target_app_slug: "cliente",
          data: {
            route: "DriverOnTheWay",
            params: { tripId: b.scheduled_trip_id, bookingId: b.id },
            fcm_android_tag: `passenger_eta_${b.id}`,
            fcm_collapse_key: `passenger_eta_${b.id}`,
          },
        } as never);
        if (!ins5) {
          stats.milestones_5min += 1;
          skipEtaRefresh = true;
          await admin
            .from("bookings")
            .update({ driver_eta_5min_notified_at: new Date().toISOString() } as never)
            .eq("id", b.id);
        } else {
          stats.errors.push({ step: "insert_5min", booking: b.id, detail: ins5.message });
        }
      }

      if (
        !skipEtaRefresh &&
        allowTravel &&
        !b.driver_arrived_pickup_notified_at &&
        etaMin <= 90 &&
        etaMin >= 1
      ) {
        await sendEtaRefresh({
          userId: b.user_id,
          tag: `passenger_eta_${b.id}`,
          tripId: b.scheduled_trip_id,
          entity: "booking",
          entityId: b.id,
          etaMin,
        });
      }
    }

    const { data: dependents } = await admin
      .from("dependent_shipments")
      .select(
        "id, user_id, scheduled_trip_id, origin_lat, origin_lng, driver_eta_5min_notified_at, driver_arrived_pickup_notified_at",
      )
      .eq("scheduled_trip_id", tripId)
      .eq("status", "confirmed");

    for (const ds of (dependents ?? []) as DepRow[]) {
      if (ds.origin_lat == null || ds.origin_lng == null) continue;

      const dist = haversineMeters(dLat, dLng, ds.origin_lat, ds.origin_lng);
      const etaMin = etaMinutesStraightLine(dist);

      const { data: allowTravel } = await admin.rpc("should_notify_user", {
        p_user_id: ds.user_id,
        p_category: "travel_updates",
      } as any);

      let skipEtaRefreshDs = false;

      if (allowTravel && dist < 120 && !ds.driver_arrived_pickup_notified_at) {
        const { error: insE } = await admin.from("notifications").insert({
          user_id: ds.user_id,
          title: "Motorista chegou a você",
          message: "O motorista está no ponto combinado. Confira no app.",
          category: "driver_arrived_pickup",
          target_app_slug: "cliente",
          data: {
            route: "DependentShipmentDetail",
            params: { dependentShipmentId: ds.id },
            fcm_android_tag: `passenger_eta_ds_${ds.id}`,
            fcm_collapse_key: `passenger_eta_ds_${ds.id}`,
          },
        } as never);
        if (!insE) {
          stats.milestones_arrived += 1;
          skipEtaRefreshDs = true;
          await admin
            .from("dependent_shipments")
            .update({ driver_arrived_pickup_notified_at: new Date().toISOString() } as never)
            .eq("id", ds.id);
        } else {
          stats.errors.push({ step: "insert_arrived_ds", dependent: ds.id, detail: insE.message });
        }
      } else if (
        allowTravel &&
        !ds.driver_eta_5min_notified_at &&
        etaMin >= 4 &&
        etaMin <= 8 &&
        dist >= 120
      ) {
        const { error: ins5 } = await admin.from("notifications").insert({
          user_id: ds.user_id,
          title: "Motorista está a cerca de 5 minutos",
          message: "Prepare-se para o embarque do dependente. Acompanhe no app.",
          category: "driver_eta_5min",
          target_app_slug: "cliente",
          data: {
            route: "DependentShipmentDetail",
            params: { dependentShipmentId: ds.id },
            fcm_android_tag: `passenger_eta_ds_${ds.id}`,
            fcm_collapse_key: `passenger_eta_ds_${ds.id}`,
          },
        } as never);
        if (!ins5) {
          stats.milestones_5min += 1;
          skipEtaRefreshDs = true;
          await admin
            .from("dependent_shipments")
            .update({ driver_eta_5min_notified_at: new Date().toISOString() } as never)
            .eq("id", ds.id);
        } else {
          stats.errors.push({ step: "insert_5min_ds", dependent: ds.id, detail: ins5.message });
        }
      }

      if (
        !skipEtaRefreshDs &&
        allowTravel &&
        !ds.driver_arrived_pickup_notified_at &&
        etaMin <= 90 &&
        etaMin >= 1
      ) {
        await sendEtaRefresh({
          userId: ds.user_id,
          tag: `passenger_eta_ds_${ds.id}`,
          tripId: ds.scheduled_trip_id,
          entity: "dependent",
          entityId: ds.id,
          etaMin,
        });
      }
    }
  }

  return new Response(JSON.stringify({ ok: stats.errors.length === 0, ...stats }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
