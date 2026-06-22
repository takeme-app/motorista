import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isAdmin(user: { app_metadata?: Record<string, unknown> }): boolean {
  return user?.app_metadata?.role === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token);
    if (userError || !user || !isAdmin(user)) {
      return new Response(
        JSON.stringify({ error: "Acesso restrito a administradores" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const url = new URL(req.url);
    const routeId = url.searchParams.get("id");
    const roleFilter = url.searchParams.get("role_type");

    // --- GET ---
    if (req.method === "GET") {
      if (routeId) {
        const { data, error } = await admin
          .from("pricing_routes")
          .select("*, pricing_route_surcharges(*, surcharge_catalog(*))")
          .eq("id", routeId)
          .single();
        if (error || !data) {
          return new Response(
            JSON.stringify({ error: "Trecho não encontrado" }),
            {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let query = admin
        .from("pricing_routes")
        .select("*, pricing_route_surcharges(*, surcharge_catalog(*))")
        .order("created_at", { ascending: false });

      if (roleFilter) {
        query = query.eq("role_type", roleFilter);
      }

      const { data, error } = await query;
      if (error) {
        return new Response(
          JSON.stringify({ error: "Erro ao listar trechos" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify(data ?? []), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- POST: criar trecho + adicionais ---
    if (req.method === "POST") {
      const body = (await req.json()) as {
        role_type?: string;
        title?: string;
        origin_address?: string;
        destination_address?: string;
        pricing_mode?: string;
        price_cents?: number;
        driver_pct?: number;
        admin_pct?: number;
        accepted_payment_methods?: string[];
        departure_at?: string;
        return_at?: string;
        origin_lat?: number;
        origin_lng?: number;
        destination_lat?: number;
        destination_lng?: number;
        size_price_pequeno_cents?: number | null;
        size_price_medio_cents?: number | null;
        size_price_grande_cents?: number | null;
        surcharges?: Array<{
          surcharge_id: string;
          value_cents?: number;
        }>;
      };

      if (
        !body.role_type?.trim() ||
        !body.destination_address?.trim() ||
        !body.pricing_mode?.trim() ||
        body.price_cents == null
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Campos obrigatórios: role_type, destination_address, pricing_mode, price_cents",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data: route, error: routeErr } = await admin
        .from("pricing_routes")
        .insert({
          role_type: body.role_type.trim(),
          title: body.title?.trim() || null,
          origin_address: body.origin_address?.trim() || null,
          destination_address: body.destination_address.trim(),
          pricing_mode: body.pricing_mode.trim(),
          price_cents: body.price_cents,
          driver_pct: body.driver_pct ?? 0,
          admin_pct: body.admin_pct ?? 0,
          accepted_payment_methods: body.accepted_payment_methods ?? [],
          departure_at: body.departure_at || null,
          return_at: body.return_at || null,
          origin_lat: typeof body.origin_lat === "number" ? body.origin_lat : null,
          origin_lng: typeof body.origin_lng === "number" ? body.origin_lng : null,
          destination_lat: typeof body.destination_lat === "number" ? body.destination_lat : null,
          destination_lng: typeof body.destination_lng === "number" ? body.destination_lng : null,
          size_price_pequeno_cents: typeof body.size_price_pequeno_cents === "number" ? body.size_price_pequeno_cents : null,
          size_price_medio_cents: typeof body.size_price_medio_cents === "number" ? body.size_price_medio_cents : null,
          size_price_grande_cents: typeof body.size_price_grande_cents === "number" ? body.size_price_grande_cents : null,
          created_by: user.id,
        })
        .select()
        .single();

      if (routeErr || !route) {
        console.error("[manage-pricing-routes] insert route:", routeErr);
        return new Response(
          JSON.stringify({
            error: "Erro ao criar trecho",
            details: routeErr?.message,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Inserir adicionais vinculados
      if (Array.isArray(body.surcharges) && body.surcharges.length > 0) {
        const surchargeRows = body.surcharges
          .filter((s) => s.surcharge_id?.trim())
          .map((s) => ({
            pricing_route_id: route.id,
            surcharge_id: s.surcharge_id.trim(),
            value_cents: s.value_cents ?? null,
          }));

        if (surchargeRows.length > 0) {
          const { error: sErr } = await admin
            .from("pricing_route_surcharges")
            .insert(surchargeRows);
          if (sErr) {
            console.error(
              "[manage-pricing-routes] insert surcharges:",
              sErr
            );
          }
        }
      }

      // Retornar com surcharges
      const { data: full } = await admin
        .from("pricing_routes")
        .select("*, pricing_route_surcharges(*, surcharge_catalog(*))")
        .eq("id", route.id)
        .single();

      return new Response(
        JSON.stringify({ ok: true, pricing_route: full ?? route }),
        {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- PUT/PATCH: atualizar ---
    if (req.method === "PUT" || req.method === "PATCH") {
      if (!routeId) {
        return new Response(
          JSON.stringify({ error: "id é obrigatório na query string" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const body = (await req.json()) as Record<string, unknown> & {
        surcharges?: Array<{ surcharge_id: string; value_cents?: number }>;
      };

      const allowedFields = [
        "role_type",
        "title",
        "origin_address",
        "destination_address",
        "pricing_mode",
        "price_cents",
        "driver_pct",
        "admin_pct",
        "accepted_payment_methods",
        "departure_at",
        "return_at",
        "is_active",
        "origin_lat",
        "origin_lng",
        "destination_lat",
        "destination_lng",
        "size_price_pequeno_cents",
        "size_price_medio_cents",
        "size_price_grande_cents",
      ];
      const updates: Record<string, unknown> = {};
      for (const key of allowedFields) {
        if (key in body) updates[key] = body[key];
      }
      updates.updated_at = new Date().toISOString();

      const { error: updateErr } = await admin
        .from("pricing_routes")
        .update(updates)
        .eq("id", routeId);

      if (updateErr) {
        console.error("[manage-pricing-routes] update:", updateErr);
        return new Response(
          JSON.stringify({
            error: "Erro ao atualizar trecho",
            details: updateErr.message,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Propaga o novo valor para as rotas de motorista que importaram este trecho.
      // worker_routes.price_per_person_cents é um snapshot do template (pricing_route_id);
      // sem isto, editar o trecho não refletiria no que o motorista cobra no app.
      if (typeof body.price_cents === "number") {
        const { error: propErr } = await admin
          .from("worker_routes")
          .update({
            price_per_person_cents: body.price_cents,
            updated_at: new Date().toISOString(),
          })
          .eq("pricing_route_id", routeId);
        if (propErr) {
          console.error("[manage-pricing-routes] propagate worker_routes:", propErr);
        }
      }

      // Atualizar surcharges (replace all)
      if (Array.isArray(body.surcharges)) {
        await admin
          .from("pricing_route_surcharges")
          .delete()
          .eq("pricing_route_id", routeId);

        const surchargeRows = body.surcharges
          .filter((s) => s.surcharge_id?.trim())
          .map((s) => ({
            pricing_route_id: routeId,
            surcharge_id: s.surcharge_id.trim(),
            value_cents: s.value_cents ?? null,
          }));

        if (surchargeRows.length > 0) {
          await admin
            .from("pricing_route_surcharges")
            .insert(surchargeRows);
        }
      }

      const { data: full } = await admin
        .from("pricing_routes")
        .select("*, pricing_route_surcharges(*, surcharge_catalog(*))")
        .eq("id", routeId)
        .single();

      return new Response(
        JSON.stringify({ ok: true, pricing_route: full }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- DELETE ---
    if (req.method === "DELETE") {
      if (!routeId) {
        return new Response(
          JSON.stringify({ error: "id é obrigatório na query string" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const { error } = await admin
        .from("pricing_routes")
        .delete()
        .eq("id", routeId);
      if (error) {
        return new Response(
          JSON.stringify({ error: "Erro ao excluir trecho" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Método não suportado" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[manage-pricing-routes] unhandled:", err);
    return new Response(
      JSON.stringify({
        error: "Erro interno",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
