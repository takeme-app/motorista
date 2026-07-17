import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Sem Allow-Methods o browser bloqueia PUT/DELETE após o preflight (OPTIONS),
  // quebrando editar/remover admin. GET/POST/PUT/DELETE são todos usados aqui.
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isAdmin(user: { app_metadata?: Record<string, unknown> }): boolean {
  return user?.app_metadata?.role === "admin";
}

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonRes({ error: "Não autorizado" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user || !isAdmin(user)) {
      return jsonRes({ error: "Acesso restrito a administradores" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // ── GET: listar admins ───────────────────────────────────────────
    if (req.method === "GET") {
      // Query worker_profiles with role='admin' joined with profiles
      const { data: admins, error } = await admin
        .from("worker_profiles")
        .select("id, role, subtype, status, created_at")
        .eq("role", "admin");

      if (error) return jsonRes({ error: "Erro ao listar admins", details: error.message }, 500);

      const adminIds = (admins || []).map((a: any) => a.id);
      if (adminIds.length === 0) return jsonRes([]);

      // Get profiles for names
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name, phone, avatar_url")
        .in("id", adminIds);

      // Get emails from auth.users
      const { data: { users: authUsers } } = await admin.auth.admin.listUsers();
      const emailMap: Record<string, string> = {};
      (authUsers || []).forEach((u: any) => {
        if (adminIds.includes(u.id)) emailMap[u.id] = u.email || "";
      });

      // Get permissions from user_preferences
      const { data: prefs } = await admin
        .from("user_preferences")
        .select("user_id, value")
        .in("user_id", adminIds)
        .eq("key", "admin_permissions");

      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });
      const permMap: Record<string, any> = {};
      (prefs || []).forEach((p: any) => { permMap[p.user_id] = p.value; });

      const nivelOf = (sub: string | undefined) => {
        if (sub === "admin") return "Administrador";
        if (sub === "suporte") return "Suporte";
        if (sub === "financeiro") return "Financeiro";
        return sub || "—";
      };

      const result = (admins || []).map((a: any) => ({
        id: a.id,
        full_name: profileMap[a.id]?.full_name || "Sem nome",
        email: emailMap[a.id] || "",
        phone: profileMap[a.id]?.phone || null,
        avatar_url: profileMap[a.id]?.avatar_url || null,
        nivel: nivelOf(a.subtype),
        subtype: a.subtype,
        status: a.status,
        permissions: permMap[a.id] || {},
        created_at: a.created_at,
      }));

      return jsonRes(result);
    }

    // ── POST: criar novo admin ───────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json() as {
        email: string;
        password?: string;
        full_name: string;
        permissions?: Record<string, boolean>;
        /** Perfil no backoffice: admin (pleno), suporte (fila), financeiro (reembolsos). */
        backoffice_subtype?: string;
      };

      if (!body.email?.trim() || !body.full_name?.trim()) {
        return jsonRes({ error: "email e full_name são obrigatórios" }, 400);
      }

      const rawSub = (body.backoffice_subtype || "admin").toLowerCase().trim();
      const backofficeSubtype = ["admin", "suporte", "financeiro"].includes(rawSub)
        ? rawSub
        : "admin";

      // Check if email already exists — if so, upgrade to admin
      const password = body.password || Math.random().toString(36).slice(2) + "Aa1!";
      let newUser: any = null;
      const { data: existingUsers } = await admin.auth.admin.listUsers();
      const existingUser = (existingUsers?.users || []).find((u: any) => u.email === body.email.trim());

      if (existingUser) {
        // User exists — check if already admin
        const existingWp = await admin.from("worker_profiles").select("id, role").eq("id", existingUser.id).eq("role", "admin").maybeSingle();
        if (existingWp.data) {
          return jsonRes({ error: "Este usuário já é um administrador." }, 400);
        }
        // Upgrade existing user to admin
        const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(existingUser.id, {
          app_metadata: { ...existingUser.app_metadata, role: "admin" },
          user_metadata: { ...existingUser.user_metadata, full_name: body.full_name.trim() },
          password,
        });
        if (updateErr) {
          return jsonRes({ error: "Erro ao promover usuário existente", details: updateErr.message }, 400);
        }
        newUser = { user: updated.user };
      } else {
        // Create new auth user
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: body.email.trim(),
          password,
          email_confirm: true,
          app_metadata: { role: "admin" },
          user_metadata: { full_name: body.full_name.trim() },
        });
        if (createErr) {
          return jsonRes({ error: "Erro ao criar usuário", details: createErr.message }, 400);
        }
        newUser = created;
      }

      // The handle_new_user trigger creates profiles row automatically.
      // Now create worker_profiles row
      const { error: wpErr } = await admin
        .from("worker_profiles")
        .insert({
          id: newUser.user.id,
          role: "admin",
          subtype: backofficeSubtype,
          status: "approved",
          cpf: "",
        });

      if (wpErr) {
        console.error("[manage-admin-users] worker_profiles insert:", wpErr);
      }

      // Save permissions
      if (body.permissions && Object.keys(body.permissions).length > 0) {
        await admin.from("user_preferences").upsert({
          user_id: newUser.user.id,
          key: "admin_permissions",
          value: body.permissions,
        });
      }

      return jsonRes({ ok: true, user_id: newUser.user.id, temporary_password: password }, 201);
    }

    // ── PUT: atualizar admin ─────────────────────────────────────────
    if (req.method === "PUT") {
      const url = new URL(req.url);
      const adminId = url.searchParams.get("id");
      if (!adminId) return jsonRes({ error: "id é obrigatório" }, 400);

      const body = await req.json() as {
        permissions?: Record<string, boolean>;
        status?: string;
        backoffice_subtype?: string;
      };

      if (body.permissions) {
        await admin.from("user_preferences").upsert({
          user_id: adminId,
          key: "admin_permissions",
          value: body.permissions,
        });
      }

      if (body.status) {
        await admin
          .from("worker_profiles")
          .update({ status: body.status })
          .eq("id", adminId)
          .eq("role", "admin");
      }

      if (body.backoffice_subtype) {
        const raw = body.backoffice_subtype.toLowerCase().trim();
        if (["admin", "suporte", "financeiro"].includes(raw)) {
          await admin
            .from("worker_profiles")
            .update({ subtype: raw })
            .eq("id", adminId)
            .eq("role", "admin");
        }
      }

      return jsonRes({ ok: true });
    }

    // ── DELETE: desativar admin ───────────────────────────────────────
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const adminId = url.searchParams.get("id");
      if (!adminId) return jsonRes({ error: "id é obrigatório" }, 400);

      // Don't allow deleting yourself
      if (adminId === user.id) {
        return jsonRes({ error: "Não é possível desativar seu próprio usuário" }, 400);
      }

      await admin
        .from("worker_profiles")
        .update({ status: "suspended" })
        .eq("id", adminId)
        .eq("role", "admin");

      return jsonRes({ ok: true });
    }

    return jsonRes({ error: "Método não suportado" }, 405);
  } catch (err) {
    console.error("[manage-admin-users]", err);
    return jsonRes({ error: "Erro interno" }, 500);
  }
});
