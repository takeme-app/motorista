import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createPixProvider } from "../_shared/pixProviders/index.ts";
import {
  PIX_CHARGE_ROW_COLUMNS,
  type PixChargeRow,
  queuePixRefund,
  settlePixCharge,
  type SettleResult,
} from "../_shared/pixProviders/settle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

/**
 * bradesco-webhook — confirma pagamentos Pix do Bradesco.
 *
 * Diferenças em relação ao asaas-webhook, todas impostas pelo Bradesco:
 *
 *   - NÃO EXISTE token nem assinatura no callback. A segurança do arranjo é o
 *     certificado TLS; a aplicação não tem como distinguir um POST legítimo de
 *     um forjado. Por isso a **re-consulta `GET /v2/cob/{txid}` não é só uma
 *     boa prática, é a ÚNICA fonte de verdade**: nada no corpo recebido é
 *     usado para decidir pagamento, só o txid como ponteiro. Um POST forjado
 *     com txid inexistente morre na re-consulta; com txid real, a re-consulta
 *     devolve o mesmo que o banco diria de qualquer forma.
 *   - O payload é um ARRAY (`{pix:[…]}`) — um POST pode trazer vários
 *     pagamentos. Cada item vira um evento e um settlePixCharge próprio.
 *   - Não há id de evento. O dedup usa o `endToEndId`, que é único por
 *     transação Pix no arranjo do Bacen.
 *   - Não há campo de status: o callback só é disparado em RECEBIMENTO.
 *
 * Como no asaas-webhook: SEMPRE 200 depois de registrar o evento (erro vira
 * processing_result='error:…'; reconcile-pix é a rede de segurança).
 *
 * ── Proteção que o arranjo do Bradesco não oferece ──
 * Como o endpoint fica público e sem assinatura, qualquer um que descubra a URL
 * poderia inserir lixo em payment_webhook_events. Duas camadas contra isso:
 *
 *   1. SEGREDO NA URL (opcional, recomendado): se BRADESCO_WEBHOOK_TOKEN estiver
 *      configurado, exigimos `?k=<token>` — nós escolhemos a URL registrada em
 *      `PUT /v2/webhook/{chave}`, então o segredo viaja com ela. Comparação em
 *      tempo constante, 401 antes de qualquer escrita. Se o Bradesco vier a
 *      descartar a query string, isto aparece como 401 no log e basta remover o
 *      secret para voltar ao comportamento aberto.
 *   2. FORMATO DO TXID: sem o segredo configurado, só aceitamos txid no nosso
 *      formato (32 hex, derivado de pix_charges.id). Pagamento legítimo de
 *      cobrança nossa sempre casa; o que não casa seria órfão, e órfão já é
 *      coberto pela direção provedor→banco do reconcile-pix.
 *
 * ⚠️ O endpoint só passa a receber de verdade quando alguém registrar a URL no
 * Bradesco (`PUT /v2/webhook/{chave}`) — o que depende do processo de
 * Implementação/certificado. Até lá ele fica inerte, e a confirmação continua
 * vindo do polling (get-pix-charge-status) e do cron reconcile-pix.
 */

/** Comparação em tempo constante: SHA-256 dos dois valores + XOR byte a byte. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/** txid gerado por nós: pix_charges.id (UUID) sem hífens. */
const OUR_TXID = /^[0-9a-fA-F]{32}$/;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type BradescoPixItem = {
  endToEndId?: string;
  txid?: string;
  valor?: string;
  horario?: string;
};

async function setProcessingResult(
  admin: SupabaseClient,
  eventRowId: string,
  result: SettleResult | string,
): Promise<void> {
  const { error } = await admin
    .from("payment_webhook_events")
    .update({ processing_result: String(result).slice(0, 500) } as never)
    .eq("id", eventRowId);
  if (error) console.error("[bradesco-webhook] processing_result:", error.message);
}

/** Processa um Pix recebido. Devolve o processing_result já gravado. */
async function handleItem(
  admin: SupabaseClient,
  item: BradescoPixItem,
  trusted: boolean,
): Promise<{ endToEndId: string; result: string }> {
  const endToEndId = (item.endToEndId ?? "").trim();
  const txid = (item.txid ?? "").trim();

  // A chave Pix é COMPARTILHADA com o QR paliativo estático que ainda roda em
  // produção. Um recebimento cujo txid não nasceu de cobrança nossa é dinheiro
  // legítimo de outro fluxo — não é órfão e NÃO pode virar fila de devolução.
  // Isso também impede que um POST anônimo encha payment_webhook_events.
  if (!OUR_TXID.test(txid)) {
    return {
      endToEndId,
      result: trusted ? "ignored:txid não é de cobrança nossa" : "ignored:txid fora do formato",
    };
  }

  // ── Dedup por endToEndId: 0 linhas inseridas = repetido ──
  const { data: inserted, error: dedupErr } = await admin
    .from("payment_webhook_events")
    .upsert(
      {
        provider: "bradesco",
        event_id: endToEndId,
        event_type: "PIX_RECEBIDO",
        provider_charge_id: txid || null,
        payload: item,
      } as never,
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("id");
  if (dedupErr) throw new Error(`dedup insert: ${dedupErr.message}`);

  const eventRow = (inserted ?? [])[0] as { id: string } | undefined;
  if (!eventRow) return { endToEndId, result: "duplicate" };

  try {
    if (!txid) {
      await setProcessingResult(admin, eventRow.id, "ignored");
      return { endToEndId, result: "ignored" };
    }

    // ── Re-consulta OBRIGATÓRIA: o corpo recebido nunca decide nada ──
    let fresh;
    try {
      const provider = createPixProvider(admin, "bradesco");
      fresh = await provider.getChargeStatus(txid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[bradesco-webhook] re-consulta falhou:", msg);
      await setProcessingResult(admin, eventRow.id, `error:reconsulta: ${msg}`);
      return { endToEndId, result: "deferred" };
    }

    // ── Localiza a charge: (provider, provider_charge_id) → externalReference ──
    let charge: PixChargeRow | null = null;
    {
      const { data } = await admin
        .from("pix_charges")
        .select(PIX_CHARGE_ROW_COLUMNS)
        .eq("provider", "bradesco")
        .eq("provider_charge_id", txid)
        .maybeSingle();
      charge = (data as PixChargeRow | null) ?? null;
    }
    if (!charge && fresh.externalReference) {
      // create em voo: o txid é derivado de pix_charges.id, então mesmo sem o
      // provider_charge_id gravado a linha é localizável.
      const { data } = await admin
        .from("pix_charges")
        .select(PIX_CHARGE_ROW_COLUMNS)
        .eq("id", fresh.externalReference)
        .eq("provider", "bradesco")
        .maybeSingle();
      charge = (data as PixChargeRow | null) ?? null;
    }

    if (!charge) {
      if (fresh.status === "paid") {
        await queuePixRefund(admin, {
          pix_charge_id: null,
          entity_type: null,
          entity_id: null,
          user_id: null,
          amount_cents: fresh.paidAmountCents ?? 0,
          reason: "orphan_payment",
          notes: `bradesco payment ${txid} sem par em pix_charges (webhook, e2e ${endToEndId})`,
        });
        await setProcessingResult(admin, eventRow.id, "orphan");
        return { endToEndId, result: "orphan" };
      }
      await setProcessingResult(admin, eventRow.id, "ignored");
      return { endToEndId, result: "ignored" };
    }

    const result = await settlePixCharge(admin, charge, fresh);
    await setProcessingResult(admin, eventRow.id, result);
    return { endToEndId, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bradesco-webhook] item error:", msg);
    await setProcessingResult(admin, eventRow.id, `error:${msg}`);
    return { endToEndId, result: `error:${msg}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonRes({ error: "Configuração incompleta no servidor" }, 500);
  }

  // ── Segredo na URL, ANTES de qualquer escrita ──
  const expectedToken = Deno.env.get("BRADESCO_WEBHOOK_TOKEN")?.trim() ?? "";
  let trusted = false;
  if (expectedToken) {
    const received = new URL(req.url).searchParams.get("k") ??
      req.headers.get("x-webhook-token") ?? "";
    if (!received || !(await timingSafeEqual(received, expectedToken))) {
      return jsonRes({ error: "Não autorizado" }, 401);
    }
    trusted = true;
  } else {
    console.warn(
      "[bradesco-webhook] BRADESCO_WEBHOOK_TOKEN não configurado — aceitando " +
        "apenas txid no nosso formato. Configure o secret e registre a URL com ?k=<token>.",
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const body = (await req.json().catch(() => null)) as { pix?: BradescoPixItem[] } | null;
  const items = Array.isArray(body?.pix) ? body!.pix! : [];
  if (items.length === 0) {
    return jsonRes({ received: true, ignored: "payload sem pix[]" });
  }

  const results: Array<{ endToEndId: string; result: string }> = [];
  for (const item of items) {
    if (!item?.endToEndId) {
      results.push({ endToEndId: "", result: "ignored:sem endToEndId" });
      continue;
    }
    try {
      results.push(await handleItem(admin, item, trusted));
    } catch (e) {
      // Falha ao registrar o evento: sem dedup não há idempotência. Registra e
      // segue — o reconcile-pix pega o pagamento depois.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[bradesco-webhook] handleItem:", msg);
      results.push({ endToEndId: item.endToEndId, result: `error:${msg}` });
    }
  }

  return jsonRes({ received: true, processed: results.length, results });
});
