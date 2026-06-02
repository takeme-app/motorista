import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type",
};

type ExcursionRow = {
  id: string;
  user_id: string;
  total_amount_cents: number | null;
  worker_payout_cents: number | null;
  preparer_payout_cents: number | null;
  driver_id: string | null;
  preparer_id: string | null;
  status: string;
  payment_method: string | null;
  stripe_payment_intent_id: string | null;
};

/**
 * confirm-excursion-cash — confirma um orçamento de excursão pago em dinheiro.
 *
 * Espelha charge-excursion-request (auth/validação) + stripe-webhook (aprovação
 * + criação de payouts), mas SEM Stripe: dinheiro é quitado em mãos com o motorista.
 *
 * Diferenças do fluxo Stripe:
 * - Não cria PaymentIntent nem grava stripe_payment_intent_id (segue null).
 * - A transição quoted -> approved + os payouts (driver/preparer) acontecem aqui,
 *   já que não há webhook do Stripe para disparar.
 *
 * Idempotência: o UPDATE é guardado por `.eq('status','quoted')`. Uma segunda
 * chamada encontra status='approved', não atualiza nenhuma linha e pula os payouts.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("x-auth-token");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : (authHeader ?? "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const claims = claimsData?.claims as { sub?: string } | undefined;
    const userId = claims?.sub;
    if (claimsError || !userId) {
      return new Response(JSON.stringify({ error: "Sessão inválida ou expirada" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as {
      excursion_request_id?: string;
    };
    const excursionId = body.excursion_request_id?.trim();
    if (!excursionId) {
      return new Response(
        JSON.stringify({ error: "excursion_request_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: row, error: rowErr } = await admin
      .from("excursion_requests")
      .select(
        "id, user_id, total_amount_cents, worker_payout_cents, preparer_payout_cents, driver_id, preparer_id, status, payment_method, stripe_payment_intent_id",
      )
      .eq("id", excursionId)
      .eq("user_id", userId)
      .single();

    if (rowErr || !row) {
      return new Response(
        JSON.stringify({ error: "Orçamento não encontrado ou não pertence ao usuário" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const s = row as ExcursionRow;

    if (s.stripe_payment_intent_id) {
      return new Response(
        JSON.stringify({ error: "Este orçamento já foi cobrado no Stripe; não pode ser pago em dinheiro." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Só permite confirmação após orçamento disponibilizado. `approved` já significa pago.
    if (s.status !== "quoted") {
      return new Response(
        JSON.stringify({
          error: s.status === "approved"
            ? "Este orçamento já foi aprovado/pago."
            : `Status atual (${s.status}) não permite confirmação; aguarde orçamento`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const amountCents = Number(s.total_amount_cents);
    if (!Number.isInteger(amountCents) || amountCents < 1) {
      return new Response(
        JSON.stringify({
          error: "Orçamento sem valor definido ainda; solicite ao preparador",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date().toISOString();

    // 1) Marca orçamento como pago/aprovado. Guard em status='quoted' garante
    //    idempotência (segunda chamada não reaprova nem duplica payouts).
    const { data: updated, error: updErr } = await admin
      .from("excursion_requests")
      .update({
        status: "approved",
        payment_method: "cash",
        confirmed_at: now,
        updated_at: now,
      } as never)
      .eq("id", excursionId)
      .eq("status", "quoted")
      .select(
        "id, driver_id, preparer_id, total_amount_cents, worker_payout_cents, preparer_payout_cents",
      )
      .maybeSingle();

    if (updErr) {
      console.error("[confirm-excursion-cash] update falhou:", updErr.message);
      return new Response(
        JSON.stringify({ error: "Não foi possível confirmar o pagamento em dinheiro." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!updated) {
      // Já processado por outra chamada concorrente — retry-safe.
      return new Response(
        JSON.stringify({ ok: true, excursion_request_id: excursionId, already_confirmed: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const excursion = updated as {
      id: string;
      driver_id: string | null;
      preparer_id: string | null;
      total_amount_cents: number | null;
      worker_payout_cents: number | null;
      preparer_payout_cents: number | null;
    };

    const workerTotal = Number(excursion.worker_payout_cents) || 0;
    const preparerAmount = Math.max(0, Number(excursion.preparer_payout_cents) || 0);
    const driverAmount = Math.max(0, workerTotal - preparerAmount);
    const grossTotal = Number(excursion.total_amount_cents) || workerTotal;

    // 2) Cria as rows em payouts (uma por worker), idêntico ao stripe-webhook.
    //    Invariante: driverAmount + preparerAmount == worker_payout_cents.
    //    Pula rows com amount 0 ou worker sem id.
    const payoutsToInsert: Array<Record<string, unknown>> = [];

    if (excursion.driver_id && driverAmount > 0) {
      payoutsToInsert.push({
        worker_id: excursion.driver_id,
        entity_type: "excursion",
        entity_id: excursion.id,
        gross_amount_cents: grossTotal,
        worker_amount_cents: driverAmount,
        admin_amount_cents: 0,
        payout_method: "pix",
        status: "pending",
      });
    }
    if (excursion.preparer_id && preparerAmount > 0) {
      payoutsToInsert.push({
        worker_id: excursion.preparer_id,
        entity_type: "excursion",
        entity_id: excursion.id,
        gross_amount_cents: grossTotal,
        worker_amount_cents: preparerAmount,
        admin_amount_cents: 0,
        payout_method: "pix",
        status: "pending",
      });
    }

    if (payoutsToInsert.length === 0) {
      console.warn(
        `[confirm-excursion-cash] excursion ${excursion.id} aprovada sem payouts (driver/preparer ausentes ou valores zero).`,
      );
      return new Response(
        JSON.stringify({ ok: true, excursion_request_id: excursionId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: payoutsErr } = await admin
      .from("payouts")
      .insert(payoutsToInsert as never);
    if (payoutsErr) {
      console.error(
        `[confirm-excursion-cash] falha ao inserir payouts excursion ${excursion.id}:`,
        payoutsErr.message,
      );
    }

    return new Response(
      JSON.stringify({ ok: true, excursion_request_id: excursionId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("confirm-excursion-cash:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao confirmar pagamento" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
