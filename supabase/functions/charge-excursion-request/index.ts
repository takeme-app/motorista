import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type",
};

const STRIPE_API = "https://api.stripe.com/v1";

async function stripeFetch(
  secretKey: string,
  method: string,
  path: string,
  body?: URLSearchParams,
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${STRIPE_API}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
  };
  if (body && method !== "GET") opts.body = body.toString();
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(err);
  }
  return data;
}

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
  worker_earning_cents: number | null;
  admin_earning_cents: number | null;
};

/**
 * charge-excursion-request — cobra um orçamento de excursão (excursion_requests).
 *
 * Diferenças de charge-shipments:
 * - Tabela public.excursion_requests, valor em total_amount_cents.
 * - Status permitido: 'quoted' (fluxo: quoted -> pagamento/webhook -> approved).
 * - payment_method da tabela usa snake_case inglês: credit_card/debit_card/pix/cash.
 *
 * Sem transfer_data: charge vai 100% para a plataforma. O split (driver + preparer)
 * acontece em stripe.transfers.create explicito dentro do process-payouts, usando
 * worker_payout_cents - preparer_payout_cents (driver) e preparer_payout_cents (preparer).
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
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) {
      return new Response(
        JSON.stringify({ error: "Stripe não configurado (STRIPE_SECRET_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
      payment_method?: "credit_card" | "debit_card" | "pix";
      payment_method_id?: string;
      stripe_payment_method_id?: string;
    };
    const excursionId = body.excursion_request_id?.trim();
    const paymentMethodChoice = body.payment_method;
    const paymentMethodIdSupabase = body.payment_method_id?.trim();
    const stripePaymentMethodIdFromClient = body.stripe_payment_method_id?.trim();

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
        "id, user_id, total_amount_cents, worker_payout_cents, preparer_payout_cents, driver_id, preparer_id, status, payment_method, stripe_payment_intent_id, worker_earning_cents, admin_earning_cents",
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
        JSON.stringify({ error: "Este orçamento já foi cobrado no Stripe" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Só permite cobrança após orçamento disponibilizado. `approved` já significa pago.
    if (s.status !== "quoted") {
      return new Response(
        JSON.stringify({
          error: s.status === "approved"
            ? "Este orçamento já foi aprovado/pago."
            : `Status atual (${s.status}) não permite cobrança; aguarde orçamento`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (s.stripe_payment_intent_id) {
      return new Response(
        JSON.stringify({ error: "Este orçamento já possui pagamento registrado." }),
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

    // Metodo de pagamento: prioriza o que veio no body; fallback pro salvo na row.
    const resolvedMethod = paymentMethodChoice ?? s.payment_method;
    if (!resolvedMethod || !["credit_card", "debit_card", "pix"].includes(resolvedMethod)) {
      return new Response(
        JSON.stringify({ error: "Cobrança Stripe só para cartão ou Pix no app" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();
    const customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      return new Response(
        JSON.stringify({
          error: "Cliente Stripe não encontrado; adicione um método de pagamento primeiro",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Metadata: excursion_request_id é o ponteiro que o stripe-webhook usa
    // para criar os payouts do driver e do preparer em payment_intent.succeeded.
    // Incluímos worker/admin earnings para auditoria e para o process-payouts
    // poder usar como fonte de verdade no split via stripe.transfers.create.
    const workerEarn = Number(s.worker_earning_cents ?? 0);
    const adminEarn = Number(s.admin_earning_cents ?? 0);
    const baseMeta: Record<string, string> = {
      "metadata[excursion_request_id]": excursionId,
      "metadata[user_id]": userId,
      "metadata[worker_earning_cents]": String(Number.isFinite(workerEarn) ? workerEarn : 0),
      "metadata[admin_earning_cents]": String(Number.isFinite(adminEarn) ? adminEarn : 0),
    };

    if (resolvedMethod === "pix") {
      if (paymentMethodIdSupabase || stripePaymentMethodIdFromClient) {
        return new Response(
          JSON.stringify({
            error:
              "Para Pix não envie payment_method_id nem stripe_payment_method_id; a cobrança usa o cliente Stripe.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const pixParams = new URLSearchParams({
        amount: String(amountCents),
        currency: "brl",
        customer: customerId,
        "payment_method_types[]": "pix",
        confirm: "true",
        ...baseMeta,
      });
      const piPix = (await stripeFetch(stripeSecret, "POST", "/payment_intents", pixParams)) as {
        id?: string;
        status?: string;
        last_payment_error?: { message?: string };
        next_action?: {
          type?: string;
          pix_display_qr_code?: {
            image_url_png?: string;
            hosted_voucher_url?: string;
            data?: string;
          };
        };
      };

      if (piPix.status === "succeeded" || piPix.status === "requires_capture") {
        return new Response(
          JSON.stringify({ ok: true, excursion_request_id: excursionId, payment_intent_id: piPix.id ?? null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (piPix.status === "requires_action" && piPix.next_action?.type === "pix_display_qr_code") {
        const qr = piPix.next_action.pix_display_qr_code;
        return new Response(
          JSON.stringify({
            ok: true,
            pix_requires_payment: true,
            payment_intent_id: piPix.id ?? null,
            image_url_png: qr?.image_url_png ?? null,
            hosted_voucher_url: qr?.hosted_voucher_url ?? null,
            pix_copy_paste: qr?.data ?? null,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const errMsg =
        piPix.last_payment_error?.message ?? `Pix não disponível (status=${piPix.status ?? "?"})`;
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cartão (credit_card / debit_card)
    if (!paymentMethodIdSupabase && !stripePaymentMethodIdFromClient) {
      return new Response(
        JSON.stringify({
          error: "Envie payment_method_id (cartão salvo) ou stripe_payment_method_id (pm_…).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let stripePaymentMethodId: string;
    if (stripePaymentMethodIdFromClient) {
      stripePaymentMethodId = stripePaymentMethodIdFromClient;
    } else {
      const { data: pmRow, error: pmErr } = await admin
        .from("payment_methods")
        .select("id, user_id, provider_id")
        .eq("id", paymentMethodIdSupabase!)
        .eq("user_id", userId)
        .single();
      if (pmErr || !pmRow?.provider_id) {
        return new Response(
          JSON.stringify({ error: "Método de pagamento não encontrado" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      stripePaymentMethodId = pmRow.provider_id as string;
    }

    const piParams = new URLSearchParams({
      amount: String(amountCents),
      currency: "brl",
      customer: customerId,
      payment_method: stripePaymentMethodId,
      confirm: "true",
      "payment_method_types[0]": "card",
      ...baseMeta,
    });

    const pi = (await stripeFetch(stripeSecret, "POST", "/payment_intents", piParams)) as {
      id?: string;
      status?: string;
      last_payment_error?: { message?: string };
    };

    if (pi.status === "requires_action") {
      return new Response(
        JSON.stringify({
          error:
            "Seu banco pediu uma confirmação extra neste cartão que não pode ser concluída neste fluxo. Tente outro cartão ou use Pix.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (pi.status !== "succeeded" && pi.status !== "requires_capture") {
      const errMsg = pi.last_payment_error?.message ?? "Pagamento não foi aprovado";
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, excursion_request_id: excursionId, payment_intent_id: pi.id ?? null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("charge-excursion-request:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao processar cobrança" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
