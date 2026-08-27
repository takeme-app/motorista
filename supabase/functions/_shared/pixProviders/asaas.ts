// Adapter Asaas (provedor Pix real).
//
// Secrets: ASAAS_API_KEY + ASAAS_API_URL (https://api-sandbox.asaas.com/v3 ou
// https://api.asaas.com/v3) — o env (sandbox/production) é inferido da URL.
// Headers obrigatórios: `access_token` E `User-Agent` (o Asaas BLOQUEIA
// requisições sem User-Agent).
//
// Expiração é NOSSA (cron expire-pix-charges marca expired + DELETE /payments
// best-effort); o dueDate de hoje só evita OVERDUE prematuro do lado deles.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  CreatePixChargeInput,
  CreatePixChargeResult,
  PixProvider,
  PixProviderEnv,
  ProviderChargeSnapshot,
  ProviderChargeStatus,
} from "./types.ts";
import { PixProviderUnavailableError } from "./types.ts";

const ASAAS_USER_AGENT = "TakeMe-Supabase-Edge/1.0";

type AsaasPayment = {
  id?: string;
  status?: string;
  value?: number;
  externalReference?: string | null;
  billingType?: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
};

/** Mapa de status do Asaas → status normalizado (conforme o plano). */
function mapAsaasStatus(status: string | undefined): ProviderChargeStatus {
  switch ((status ?? "").toUpperCase()) {
    case "RECEIVED":
    case "CONFIRMED":
      return "paid";
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return "pending";
    case "OVERDUE":
      return "expired";
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
      return "refunded";
    default:
      return "unknown";
  }
}

/** Data de hoje em America/Sao_Paulo (UTC-3 fixo, Brasil sem DST) como YYYY-MM-DD. */
function todaySaoPauloDate(): string {
  const SP_OFFSET_HOURS = 3;
  const nowSp = new Date(Date.now() - SP_OFFSET_HOURS * 3600 * 1000);
  return nowSp.toISOString().slice(0, 10);
}

function paymentToSnapshot(payment: AsaasPayment): ProviderChargeSnapshot {
  const value = Number(payment.value);
  return {
    providerChargeId: payment.id ?? "",
    status: mapAsaasStatus(payment.status),
    paidAmountCents: Number.isFinite(value) ? Math.round(value * 100) : null,
    paidAt: payment.clientPaymentDate ?? payment.paymentDate ?? payment.confirmedDate ?? null,
    externalReference: payment.externalReference ?? null,
    raw: payment,
  };
}

export class AsaasProvider implements PixProvider {
  readonly name = "asaas" as const;
  readonly env: PixProviderEnv;

  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly admin: SupabaseClient;

  constructor(admin: SupabaseClient) {
    const apiKey = Deno.env.get("ASAAS_API_KEY")?.trim();
    const apiUrl = Deno.env.get("ASAAS_API_URL")?.trim().replace(/\/+$/, "");
    if (!apiKey || !apiUrl) {
      throw new PixProviderUnavailableError(
        "Asaas não configurado (ASAAS_API_KEY/ASAAS_API_URL ausentes)",
      );
    }
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.env = apiUrl.includes("sandbox") ? "sandbox" : "production";
    this.admin = admin;
  }

  private async fetchJson(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        access_token: this.apiKey,
        "User-Agent": ASAAS_USER_AGENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errs = (data as { errors?: Array<{ description?: string; code?: string }> })?.errors;
      const detail = Array.isArray(errs) && errs.length
        ? errs.map((e) => e.description ?? e.code ?? "?").join("; ")
        : `HTTP ${res.status}`;
      throw new Error(`Asaas ${method} ${path}: ${detail}`);
    }
    return data;
  }

  /** Credencial ok? (pix-provider-health?ping=1) — nunca expõe a chave. */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const acct = (await this.fetchJson("GET", "/myAccount")) as { name?: string };
      return { ok: true, detail: acct?.name ? `conta: ${acct.name}` : "credencial válida" };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Resolve o customer do Asaas para o usuário: cache em pix_provider_customers
   * → GET /customers?cpfCnpj → POST /customers. Cacheia o resultado.
   */
  private async resolveCustomerId(
    userId: string,
    cpfDigits: string,
    customerName: string,
  ): Promise<string> {
    const { data: cached } = await this.admin
      .from("pix_provider_customers")
      .select("provider_customer_id")
      .eq("provider", this.name)
      .eq("user_id", userId)
      .maybeSingle();
    const fromCache = (cached as { provider_customer_id?: string } | null)?.provider_customer_id;
    if (fromCache) return fromCache;

    // Busca por CPF (usuário pode já existir na conta Asaas por outro caminho).
    let customerId: string | null = null;
    const found = (await this.fetchJson(
      "GET",
      `/customers?cpfCnpj=${encodeURIComponent(cpfDigits)}&limit=1`,
    )) as { data?: Array<{ id?: string }> };
    if (Array.isArray(found?.data) && found.data[0]?.id) {
      customerId = found.data[0].id!;
    }

    if (!customerId) {
      const created = (await this.fetchJson("POST", "/customers", {
        name: customerName || "Cliente Take Me",
        cpfCnpj: cpfDigits,
        externalReference: userId,
      })) as { id?: string };
      if (!created?.id) throw new Error("Asaas não devolveu o id do customer");
      customerId = created.id;
    }

    const { error: cacheErr } = await this.admin
      .from("pix_provider_customers")
      .upsert(
        {
          provider: this.name,
          user_id: userId,
          provider_customer_id: customerId,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "provider,user_id" },
      );
    if (cacheErr) {
      // Cache é otimização; a cobrança segue.
      console.warn("[asaas] cache de customer falhou:", cacheErr.message);
    }
    return customerId;
  }

  async createCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    const customerId = await this.resolveCustomerId(
      input.userId,
      input.cpfDigits,
      input.customerName,
    );

    // value com 2 casas decimais (Asaas trabalha em reais).
    const payment = (await this.fetchJson("POST", "/payments", {
      customer: customerId,
      billingType: "PIX",
      value: Number((input.amountCents / 100).toFixed(2)),
      dueDate: todaySaoPauloDate(),
      externalReference: input.internalId,
      ...(input.description ? { description: input.description } : {}),
    })) as AsaasPayment;
    if (!payment?.id) throw new Error("Asaas não devolveu o id do payment");

    // O payment JÁ existe no Asaas a partir daqui. Se o QR falhar (conta sem
    // chave Pix, indisponibilidade), precisamos apagá-lo antes de propagar o
    // erro — senão fica uma cobrança pendente órfã no painel do cliente a cada
    // tentativa, que ninguém consegue liquidar e alguém pode pagar por engano
    // pelo histórico (viraria paid_orphan + fila de devolução sem motivo).
    try {
      const qr = (await this.fetchJson(
        "GET",
        `/payments/${payment.id}/pixQrCode`,
      )) as { encodedImage?: string; payload?: string };
      if (!qr?.payload || !qr?.encodedImage) {
        throw new Error("Asaas não devolveu o QR Code do payment");
      }

      return {
        providerChargeId: payment.id,
        qrPayload: qr.payload,
        qrImageBase64: qr.encodedImage,
      };
    } catch (e) {
      // Best-effort: a falha do cancelamento não pode mascarar o erro original.
      try {
        await this.cancelCharge(payment.id);
        console.warn(`[asaas] payment ${payment.id} cancelado após falha no QR`);
      } catch (cancelErr) {
        console.error(
          `[asaas] payment ${payment.id} ficou ÓRFÃO — falha ao cancelar:`,
          cancelErr instanceof Error ? cancelErr.message : cancelErr,
        );
      }
      throw e;
    }
  }

  async getChargeStatus(providerChargeId: string): Promise<ProviderChargeSnapshot> {
    const payment = (await this.fetchJson(
      "GET",
      `/payments/${encodeURIComponent(providerChargeId)}`,
    )) as AsaasPayment;
    return paymentToSnapshot(payment);
  }

  async cancelCharge(providerChargeId: string): Promise<void> {
    await this.fetchJson("DELETE", `/payments/${encodeURIComponent(providerChargeId)}`);
  }

  /**
   * Lista pagamentos RECEIVED por data de pagamento (reconcile provedor→banco).
   * Paginado via offset/limit do Asaas.
   */
  async listReceivedPayments(paymentDate: string): Promise<ProviderChargeSnapshot[]> {
    const out: ProviderChargeSnapshot[] = [];
    const limit = 100;
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const res = (await this.fetchJson(
        "GET",
        `/payments?status=RECEIVED&paymentDate=${encodeURIComponent(paymentDate)}&limit=${limit}&offset=${offset}`,
      )) as { data?: AsaasPayment[]; hasMore?: boolean };
      const rows = Array.isArray(res?.data) ? res.data : [];
      for (const p of rows) {
        if ((p.billingType ?? "").toUpperCase() !== "PIX") continue;
        out.push(paymentToSnapshot(p));
      }
      if (!res?.hasMore || rows.length === 0) break;
      offset += limit;
    }
    return out;
  }
}
