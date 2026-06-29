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
  body?: URLSearchParams
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
    const err = (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(err);
  }
  return data;
}

type Row = {
  id: string;
  user_id: string;
  amount_cents: number;
  status: string;
  payment_method: string;
  stripe_payment_intent_id: string | null;
  worker_earning_cents?: number | null;
  admin_earning_cents?: number | null;
  driver_id?: string | null;
  preparer_id?: string | null;
  base_id?: string | null;
};

type CardFunding = "credit" | "debit" | "prepaid" | "unknown";

async function fetchPaymentMethodFunding(
  secretKey: string,
  paymentMethodId: string,
): Promise<CardFunding | null> {
  try {
    const pm = (await stripeFetch(
      secretKey,
      "GET",
      `/payment_methods/${paymentMethodId}`,
    )) as { card?: { funding?: string } };
    const f = pm.card?.funding;
    if (f === "credit" || f === "debit" || f === "prepaid" || f === "unknown") return f;
    return null;
  } catch {
    return null;
  }
}

function fundingMismatchMessage(intent: "credit" | "debit", funding: CardFunding): string | null {
  if (intent === "debit" && funding === "credit") {
    return "Este cartão é processado como crédito pelo emissor; tente a opção 'Cartão de crédito' ou pague via Pix.";
  }
  if (intent === "credit" && funding === "debit") {
    return "Este cartão é débito; selecione 'Cartão de débito' para concluir.";
  }
  return null;
}

async function resolveConnectDestination(
  admin: ReturnType<typeof createClient>,
  workerUserId: string | null | undefined
): Promise<string | null> {
  if (!workerUserId) return null;
  const { data } = await admin
    .from("worker_profiles")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled")
    .eq("id", workerUserId)
    .maybeSingle();
  const acct = (data?.stripe_connect_account_id as string | null | undefined)?.trim() ?? null;
  return acct && data?.stripe_connect_charges_enabled === true ? acct : null;
}

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
      return new Response(JSON.stringify({ error: "Stripe não configurado (STRIPE_SECRET_KEY)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      shipment_id?: string;
      dependent_shipment_id?: string;
      payment_method_id?: string;
      stripe_payment_method_id?: string;
      /** Quando cartão, intenção do usuário ("credit"/"debit") para metadata + funding mismatch. */
      card_intent?: "credit" | "debit";
    };
    const shipmentId = body.shipment_id?.trim();
    const dependentId = body.dependent_shipment_id?.trim();
    const paymentMethodIdSupabase = body.payment_method_id?.trim();
    const stripePaymentMethodIdFromClient = body.stripe_payment_method_id?.trim();
    const cardIntent: "credit" | "debit" | null =
      body.card_intent === "credit" || body.card_intent === "debit" ? body.card_intent : null;

    if ((!shipmentId && !dependentId) || (shipmentId && dependentId)) {
      return new Response(
        JSON.stringify({
          error: "Envie exatamente um de: shipment_id ou dependent_shipment_id, e o método de pagamento.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const table = shipmentId ? "shipments" : "dependent_shipments";
    const id = shipmentId ?? dependentId!;

    const selectFields = shipmentId
      ? "id, user_id, amount_cents, status, payment_method, stripe_payment_intent_id, worker_earning_cents, admin_earning_cents, driver_id, preparer_id, base_id"
      : "id, user_id, amount_cents, status, payment_method, stripe_payment_intent_id, worker_earning_cents, admin_earning_cents, driver_id";
    const { data: row, error: rowErr } = await admin
      .from(table)
      .select(selectFields)
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "Envio não encontrado ou não pertence ao usuário" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const s = row as Row;
    if (s.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: "Este envio já foi cobrado no Stripe" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["confirmed", "pending_review"].includes(s.status)) {
      return new Response(JSON.stringify({ error: "Status do envio não permite cobrança" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["credito", "debito", "pix"].includes(s.payment_method)) {
      return new Response(JSON.stringify({ error: "Cobrança Stripe só para cartão ou Pix no app" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).single();
    const customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      return new Response(
        JSON.stringify({ error: "Cliente Stripe não encontrado; adicione um método de pagamento primeiro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountCents = Number(s.amount_cents);
    if (!Number.isInteger(amountCents) || amountCents < 1) {
      return new Response(JSON.stringify({ error: "Valor do envio inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metaKey = shipmentId ? "shipment_id" : "dependent_shipment_id";

    // ── Pix (BR): só payment_method_types=pix — sem pm_ de cartão.
    if (s.payment_method === "pix") {
      if (paymentMethodIdSupabase || stripePaymentMethodIdFromClient) {
        return new Response(
          JSON.stringify({
            error:
              "Para Pix não envie payment_method_id nem stripe_payment_method_id; a cobrança usa o cliente Stripe.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Split Connect também em Pix: transfer_data é usado no Pix da mesma forma que cartão.
      // Encomenda com base (preparador + motorista) tem DOIS recebedores: não dá para usar um
      // único transfer_data; cobra-se o total na plataforma e a distribuição (motorista +
      // preparador) é feita via tabela `payouts` no stripe-webhook.
      const isBaseFlow = shipmentId ? Boolean(s.base_id) : false;
      const preparerUserIdPix = shipmentId ? (s.preparer_id ?? null) : null;
      const driverUserIdPix = s.driver_id ?? null;
      const workerUserIdPix = isBaseFlow ? null : (preparerUserIdPix ?? driverUserIdPix ?? null);
      const connectDestinationPix = await resolveConnectDestination(admin, workerUserIdPix);
      let applicationFeeCentsPix: number | null = null;
      if (connectDestinationPix) {
        const adminEarningStored = Number(s.admin_earning_cents);
        if (Number.isFinite(adminEarningStored) && adminEarningStored >= 0) {
          applicationFeeCentsPix = Math.min(amountCents, Math.max(0, Math.floor(adminEarningStored)));
        } else {
          applicationFeeCentsPix = 0;
        }
      }

      const pixParams = new URLSearchParams({
        amount: String(amountCents),
        currency: "brl",
        customer: customerId,
        "payment_method_types[]": "pix",
        confirm: "true",
        [`metadata[${metaKey}]`]: id,
        "metadata[user_id]": userId,
      });
      if (connectDestinationPix && applicationFeeCentsPix != null) {
        pixParams.set("application_fee_amount", String(applicationFeeCentsPix));
        pixParams.set("transfer_data[destination]", connectDestinationPix);
        pixParams.set("metadata[stripe_connect_destination]", connectDestinationPix);
      }
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
        const { error: updateErrPix } = await admin
          .from(table)
          .update({ stripe_payment_intent_id: piPix.id ?? null } as never)
          .eq("id", id)
          .eq("user_id", userId);
        if (updateErrPix) {
          console.error("charge-shipments: update after Pix PI succeeded", updateErrPix);
          return new Response(
            JSON.stringify({ error: "Pagamento aprovado mas falha ao gravar envio; contate o suporte" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify(
            shipmentId ? { ok: true, shipment_id: id } : { ok: true, dependent_shipment_id: id },
          ),
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
      const errMsg = piPix.last_payment_error?.message ?? `Pix não disponível (status=${piPix.status ?? "?"})`;
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        return new Response(JSON.stringify({ error: "Método de pagamento não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      stripePaymentMethodId = pmRow.provider_id as string;
    }

    let cardFunding: CardFunding | null = null;
    if (cardIntent) {
      cardFunding = await fetchPaymentMethodFunding(stripeSecret, stripePaymentMethodId);
      if (cardFunding) {
        const mismatch = fundingMismatchMessage(cardIntent, cardFunding);
        if (mismatch) {
          return new Response(JSON.stringify({ error: mismatch }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Split Stripe Connect: se worker (motorista ou preparador) tem Connect ativo,
    // faz transfer_data[destination] com application_fee_amount = admin_earning_cents.
    // Encomenda com base tem DOIS recebedores (motorista + preparador): não usa transfer_data
    // único; cobra o total na plataforma e distribui via `payouts` no stripe-webhook.
    const isBaseFlowCard = shipmentId ? Boolean(s.base_id) : false;
    const preparerUserId = shipmentId ? (s.preparer_id ?? null) : null;
    const driverUserId = s.driver_id ?? null;
    const workerUserId = isBaseFlowCard ? null : (preparerUserId ?? driverUserId ?? null);
    const connectDestination = await resolveConnectDestination(admin, workerUserId);

    let applicationFeeCents: number | null = null;
    if (connectDestination) {
      const adminEarningStored = Number(s.admin_earning_cents);
      if (Number.isFinite(adminEarningStored) && adminEarningStored >= 0) {
        applicationFeeCents = Math.min(amountCents, Math.max(0, Math.floor(adminEarningStored)));
      } else {
        // Fallback conservador: sem snapshot de split, envia 100% ao worker.
        applicationFeeCents = 0;
      }
    }

    const piParams = new URLSearchParams({
      amount: String(amountCents),
      currency: "brl",
      customer: customerId,
      "payment_method": stripePaymentMethodId,
      confirm: "true",
      "payment_method_types[0]": "card",
      [`metadata[${metaKey}]`]: id,
      "metadata[user_id]": userId,
    });
    if (cardIntent) piParams.set("metadata[requested_card_intent]", cardIntent);
    if (cardFunding) piParams.set("metadata[card_funding]", cardFunding);
    if (connectDestination && applicationFeeCents != null) {
      piParams.set("application_fee_amount", String(applicationFeeCents));
      piParams.set("transfer_data[destination]", connectDestination);
      piParams.set("metadata[stripe_connect_destination]", connectDestination);
      piParams.set("metadata[worker_earning_cents]", String(Math.max(0, amountCents - applicationFeeCents)));
      piParams.set("metadata[admin_earning_cents]", String(applicationFeeCents));
    }

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

    const { error: updateErr } = await admin
      .from(table)
      .update({
        stripe_payment_intent_id: pi.id ?? null,
      } as never)
      .eq("id", id)
      .eq("user_id", userId);

    if (updateErr) {
      console.error(
        "[charge-shipments] update after PI succeeded:",
        JSON.stringify({ message: updateErr.message, details: updateErr.details, hint: updateErr.hint, code: updateErr.code }),
      );
      const detail = updateErr.message?.trim() || "sem detalhe";
      return new Response(
        JSON.stringify({ error: `Pagamento aprovado mas falha ao gravar envio; contate o suporte. (detalhe: ${detail})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(
        shipmentId
          ? { ok: true, shipment_id: id }
          : { ok: true, dependent_shipment_id: id }
      ),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("charge-shipments:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro ao processar cobrança" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
