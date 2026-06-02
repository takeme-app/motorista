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

/**
 * Schema esperado do budget_lines:
 * {
 *   team: [{ role, name, worker_id?, value_cents }],
 *   basic_items: [{ name, quantity, value_cents }],
 *   additional_services: [{ name, quantity, value_cents }],
 *   recreation_items: [{ name, quantity, value_cents }],
 *   discount: { type: "percentage"|"fixed", value: number } | null,
 *   total_cents: number
 * }
 *
 * role esperada para o preparador: 'preparer' ou 'preparador' (case-insensitive).
 */
type BudgetTeamLine = {
  role: string;
  name?: string;
  worker_id?: string;
  value_cents: number;
};

type BudgetItemLine = {
  label?: string;
  name?: string;
  item?: string;
  qty?: number;
  quantity?: number;
  value_cents?: number;
  amount_cents?: number;
};

type BudgetDisplayLine = {
  kind: "team" | "basic" | "additional" | "recreation";
  label: string;
  qty: number;
  value_cents: number;
  amount_cents: number;
  worker_id?: string | null;
  role?: string;
};

type BudgetLines = {
  team?: BudgetTeamLine[];
  basic_items?: BudgetItemLine[];
  additional_services?: BudgetItemLine[];
  recreation_items?: BudgetItemLine[];
  display_lines?: BudgetDisplayLine[];
  discount?: { type: "percentage" | "fixed"; value: number } | null;
  total_cents: number;
};

function clampCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function lineLabel(row: BudgetItemLine, fallback: string): string {
  return String(row.label ?? row.name ?? row.item ?? fallback).trim() || fallback;
}

function normalizeItemLines(kind: "basic" | "additional" | "recreation", rows: BudgetItemLine[] | undefined): BudgetDisplayLine[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const qty = Math.max(1, Math.floor(Number(row.qty ?? row.quantity ?? 1) || 1));
      const unit = clampCents(row.value_cents ?? row.amount_cents);
      return {
        kind,
        label: lineLabel(row, "Item"),
        qty,
        value_cents: unit,
        amount_cents: qty * unit,
      };
    })
    .filter((row) => row.label || row.amount_cents > 0);
}

function normalizeBudgetLines(budget: BudgetLines): BudgetLines & { display_lines: BudgetDisplayLine[] } {
  const team = Array.isArray(budget.team) ? budget.team : [];
  const teamLines: BudgetDisplayLine[] = team.map((row) => {
    const role = String(row.role ?? "").toLowerCase().includes("driver") ? "driver" : "preparer";
    const amount = clampCents(row.value_cents);
    return {
      kind: "team",
      label: row.name?.trim() || (role === "driver" ? "Motorista" : "Preparador de excursões"),
      qty: 1,
      value_cents: amount,
      amount_cents: amount,
      worker_id: row.worker_id ?? null,
      role,
    };
  });
  return {
    ...budget,
    team,
    basic_items: budget.basic_items ?? [],
    additional_services: budget.additional_services ?? [],
    recreation_items: budget.recreation_items ?? [],
    display_lines: [
      ...teamLines,
      ...normalizeItemLines("basic", budget.basic_items),
      ...normalizeItemLines("additional", budget.additional_services),
      ...normalizeItemLines("recreation", budget.recreation_items),
    ],
  };
}

function deriveWorkerPayoutCents(team: BudgetTeamLine[] | undefined): number {
  if (!team?.length) return 0;
  return Math.floor(
    team.reduce((acc, t) => acc + clampCents(t.value_cents), 0),
  );
}

// Deriva preparer_payout_cents a partir de budget_lines.team quando o body
// nao envia o valor explicitamente.
//
// Regras (em ordem de prioridade):
//   1) body.preparer_payout_cents numerico e >= 0
//   2) soma de team[].value_cents onde worker_id == preparer_id informado
//   3) soma de team[].value_cents onde role normalizada inclui "prepar"
//   4) 0 (fallback — admin precisa editar via coluna depois)
function derivePreparerPayoutCents(
  explicit: number | undefined,
  preparerId: string | null | undefined,
  team: BudgetTeamLine[] | undefined,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  if (!team?.length) return 0;

  if (preparerId) {
    const byId = team
      .filter((t) => t.worker_id === preparerId)
      .reduce((acc, t) => acc + (Number(t.value_cents) || 0), 0);
    if (byId > 0) return Math.floor(byId);
  }

  const byRole = team
    .filter((t) => typeof t.role === "string" && t.role.toLowerCase().includes("prepar"))
    .reduce((acc, t) => acc + (Number(t.value_cents) || 0), 0);
  return Math.floor(byRole);
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

    const body = (await req.json().catch(() => ({}))) as {
      excursion_id?: string;
      action?: string;
      budget_lines?: BudgetLines;
      total_amount_cents?: number;
      driver_id?: string;
      preparer_id?: string;
      preparer_payout_cents?: number;
    };

    const {
      excursion_id,
      action,
      budget_lines,
      total_amount_cents,
      driver_id,
      preparer_id,
      preparer_payout_cents,
    } = body;

    if (!excursion_id || typeof excursion_id !== "string") {
      return new Response(
        JSON.stringify({ error: "excursion_id é obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action !== "save_draft" && action !== "finalize") {
      return new Response(
        JSON.stringify({
          error: "action deve ser 'save_draft' ou 'finalize'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: excursion, error: excErr } = await admin
      .from("excursion_requests")
      .select("id, user_id, status, preparer_id, worker_payout_cents")
      .eq("id", excursion_id)
      .single();

    if (excErr || !excursion) {
      return new Response(
        JSON.stringify({ error: "Excursão não encontrada" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Só permite criar/editar orçamento antes do cliente aceitar/pagar.
    // 'approved' já significa pago; demais status posteriores (scheduled,
    // in_progress, completed) ou encerrados (cancelled, rejected) bloqueiam.
    const EDITABLE_STATUSES = ["pending", "contacted", "quoted", "in_analysis"];
    const currentStatus = String(excursion.status ?? "");
    const wasQuoted = currentStatus === "quoted";
    if (!EDITABLE_STATUSES.includes(currentStatus)) {
      const message = currentStatus === "approved"
        ? "Orçamento já aceito/pago; não pode ser editado."
        : `Status atual (${currentStatus}) não permite editar o orçamento.`;
      return new Response(
        JSON.stringify({ error: message }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!budget_lines || typeof budget_lines !== "object") {
      return new Response(
        JSON.stringify({ error: "budget_lines é obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const normalizedBudgetLines = normalizeBudgetLines(budget_lines);
    const totalCents =
      total_amount_cents ?? normalizedBudgetLines.total_cents ?? 0;
    const workerPayout = deriveWorkerPayoutCents(normalizedBudgetLines.team);
    if (workerPayout > totalCents) {
      return new Response(
        JSON.stringify({ error: "Total do orçamento não cobre os valores de motorista/preparador" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const nowIso = new Date().toISOString();

    const effectivePreparerId =
      preparer_id ?? (excursion.preparer_id as string | null | undefined) ?? null;

    // Calcula a fatia do preparador. Fallback 0 evita quebrar o finalize quando
    // admin ainda nao discriminou o custo por funcao no budget_lines.
    const preparerPayout = derivePreparerPayoutCents(
      preparer_payout_cents,
      effectivePreparerId,
      normalizedBudgetLines.team,
    );
    const adminEarning = Math.max(0, totalCents - workerPayout);
    const adminPctApplied =
      totalCents > 0 ? Math.round((adminEarning / totalCents) * 10000) / 100 : 0;

    const updates: Record<string, unknown> = {
      budget_lines: {
        ...normalizedBudgetLines,
        total_cents: totalCents,
      },
      total_amount_cents: totalCents,
      price_route_base_cents: workerPayout,
      pricing_subtotal_cents: totalCents,
      pricing_surcharges_cents: adminEarning,
      platform_fee_cents: adminEarning,
      worker_earning_cents: workerPayout,
      admin_earning_cents: adminEarning,
      admin_pct_applied: adminPctApplied,
      preparer_payout_cents: preparerPayout,
      budget_created_by: user.id,
      budget_created_at: nowIso,
      updated_at: nowIso,
    };

    if (driver_id) updates.driver_id = driver_id;
    if (preparer_id) updates.preparer_id = preparer_id;

    if (action === "finalize") {
      updates.status = "quoted";
    }

    const { error: updateErr } = await admin
      .from("excursion_requests")
      .update(updates)
      .eq("id", excursion_id);

    if (updateErr) {
      console.error("[manage-excursion-budget] update:", updateErr);
      return new Response(
        JSON.stringify({
          error: "Erro ao salvar orçamento",
          details: updateErr.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (effectivePreparerId && effectivePreparerId !== excursion.preparer_id) {
      await admin.from("notifications").insert({
        user_id: effectivePreparerId,
        title: "Nova excursão atribuída",
        message: "Você foi vinculado a uma nova excursão. Abra o app para conferir os detalhes.",
        category: "excursion",
        target_app_slug: "motorista",
        data: {
          route: "DetalhesExcursao",
          params: { excursionId: excursion_id },
        },
      });
    }

    if (action === "finalize" && excursion.user_id) {
      const totalFmt = `R$ ${(totalCents / 100).toFixed(2).replace(".", ",")}`;
      await admin.from("notifications").insert({
        user_id: excursion.user_id,
        title: wasQuoted
          ? "Orçamento da excursão atualizado"
          : "Orçamento da excursão pronto",
        message: wasQuoted
          ? `O orçamento da sua excursão foi revisado. Novo valor total: ${totalFmt}. Acesse o app para conferir e aceitar.`
          : `O orçamento da sua excursão foi elaborado. Valor total: ${totalFmt}. Acesse o app para aceitar.`,
        category: "excursion",
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action,
        total_amount_cents: totalCents,
        preparer_payout_cents: preparerPayout,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[manage-excursion-budget] unhandled:", err);
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
