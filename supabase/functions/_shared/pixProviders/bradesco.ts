// Adapter Bradesco (provedor Pix real) — API "Pix - geração de QR Code" v2.
//
// Secrets:
//   BRADESCO_API_URL       https://qrpix.bradesco.com.br  (produção)
//                          https://openapisandbox.prebanco.com.br  (sandbox)
//   BRADESCO_CLIENT_ID / BRADESCO_CLIENT_SECRET   credencial do Portal Developers
//   BRADESCO_CERT_PEM / BRADESCO_KEY_PEM          par A1 usado para GERAR a credencial
//   BRADESCO_PIX_KEY       chave Pix do recebedor (campo `chave`, obrigatório)
//
// Diferenças em relação ao Asaas que moldam este arquivo:
//
//  1. TODA chamada — inclusive a do token — exige mTLS. Sem o certificado cliente o
//     Bradesco responde 401 "SSL with client authentication is required". O runtime
//     hospedado do Supabase suporta isso via Deno.createHttpClient({cert,key})
//     (verificado em 09/09/2026 no supabase-edge-runtime-1.76.0 / Deno 2.1.4).
//  2. Autenticação é OAuth2 client_credentials; o Bearer tem validade e é cacheado.
//  3. O txid é NOSSO: usamos pix_charges.id (UUID) sem hífens — 32 caracteres
//     alfanuméricos, dentro do [a-zA-Z0-9]{26,35} exigido, e único por CNPJ.
//  4. A expiração é DELES (calendario.expiracao, em segundos) — ao contrário do Asaas,
//     onde a expiração é nossa. Por isso o input carrega expiresInSeconds: se o QR do
//     banco vivesse mais que o nosso expires_at, o cliente poderia pagar uma cobrança
//     que já cancelamos (paid_orphan + devolução manual).
//  5. A criação devolve só o pixCopiaECola; a imagem (base64, JPEG) vem no GET seguinte.
import type {
  CreatePixChargeInput,
  CreatePixChargeResult,
  PixProvider,
  PixProviderEnv,
  ProviderChargeSnapshot,
  ProviderChargeStatus,
} from "./types.ts";
import { PixProviderUnavailableError } from "./types.ts";

/** Token vive no módulo: as instâncias da edge são reaproveitadas entre invocações. */
type CachedToken = { token: string; expiresAtMs: number };
let tokenCache: CachedToken | null = null;

/** Margem antes do vencimento para não usar um token que expira em trânsito. */
const TOKEN_SKEW_MS = 60_000;

type BradescoCob = {
  txid?: string;
  status?: string;
  revisao?: number;
  calendario?: { criacao?: string; expiracao?: number };
  valor?: { original?: string };
  pixCopiaECola?: string;
  emv?: string;
  base64?: string;
  loc?: { id?: number; location?: string };
  pix?: Array<{
    endToEndId?: string;
    valor?: string;
    horario?: string;
    txid?: string;
  }>;
};

/** Mapa de status do Bradesco → status normalizado. */
function mapBradescoStatus(status: string | undefined): ProviderChargeStatus {
  switch ((status ?? "").toUpperCase()) {
    case "CONCLUIDA":
      return "paid";
    case "ATIVA":
      return "pending";
    case "REMOVIDA_PELO_USUARIO_RECEBEDOR":
    case "REMOVIDA_PELO_PSP":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** pix_charges.id (UUID) → txid do Bradesco: 32 chars alfanuméricos. */
export function chargeIdToTxid(internalId: string): string {
  const txid = internalId.replace(/-/g, "");
  if (!/^[a-zA-Z0-9]{26,35}$/.test(txid)) {
    throw new Error(`id de cobrança incompatível com o txid do Bradesco: ${internalId}`);
  }
  return txid;
}

/** txid (32 hex) → UUID, para devolver como externalReference. */
export function txidToChargeId(txid: string): string | null {
  if (!/^[0-9a-fA-F]{32}$/.test(txid)) return null;
  return [
    txid.slice(0, 8),
    txid.slice(8, 12),
    txid.slice(12, 16),
    txid.slice(16, 20),
    txid.slice(20),
  ].join("-").toLowerCase();
}

/** "12.34" → 1234 centavos. */
function reaisToCents(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function cobToSnapshot(cob: BradescoCob): ProviderChargeSnapshot {
  const txid = cob.txid ?? "";
  // Numa cobrança CONCLUIDA o array `pix` traz o que foi efetivamente pago.
  // Sem ele (cobrança ainda ATIVA), o valor nominal é o melhor que temos.
  const settled = Array.isArray(cob.pix) && cob.pix.length > 0 ? cob.pix[0] : null;
  return {
    providerChargeId: txid,
    status: mapBradescoStatus(cob.status),
    paidAmountCents: reaisToCents(settled?.valor ?? cob.valor?.original),
    paidAt: settled?.horario ?? null,
    externalReference: txidToChargeId(txid),
    raw: cob,
  };
}

export class BradescoProvider implements PixProvider {
  readonly name = "bradesco" as const;
  readonly env: PixProviderEnv;

  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly pixKey: string;
  private readonly httpClient: unknown;

  constructor(_admin?: unknown) {
    const apiUrl = Deno.env.get("BRADESCO_API_URL")?.trim().replace(/\/+$/, "");
    const clientId = Deno.env.get("BRADESCO_CLIENT_ID")?.trim();
    const clientSecret = Deno.env.get("BRADESCO_CLIENT_SECRET")?.trim();
    const cert = Deno.env.get("BRADESCO_CERT_PEM");
    const key = Deno.env.get("BRADESCO_KEY_PEM");
    const pixKey = Deno.env.get("BRADESCO_PIX_KEY")?.trim();

    const missing = [
      !apiUrl && "BRADESCO_API_URL",
      !clientId && "BRADESCO_CLIENT_ID",
      !clientSecret && "BRADESCO_CLIENT_SECRET",
      !cert && "BRADESCO_CERT_PEM",
      !key && "BRADESCO_KEY_PEM",
      !pixKey && "BRADESCO_PIX_KEY",
    ].filter(Boolean);
    if (missing.length) {
      throw new PixProviderUnavailableError(
        `Bradesco não configurado (${missing.join("/")} ausentes)`,
      );
    }

    const createHttpClient = (Deno as unknown as {
      createHttpClient?: (o: unknown) => unknown;
    }).createHttpClient;
    if (typeof createHttpClient !== "function") {
      throw new PixProviderUnavailableError(
        "Bradesco exige mTLS e este runtime não expõe Deno.createHttpClient",
      );
    }
    try {
      this.httpClient = createHttpClient({ cert, key });
    } catch (e) {
      // Cert/key malformados no secret caem aqui — mensagem legível no admin.
      throw new PixProviderUnavailableError(
        `Certificado do Bradesco inválido: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    this.apiUrl = apiUrl!;
    this.clientId = clientId!;
    this.clientSecret = clientSecret!;
    this.pixKey = pixKey!;
    // openapisandbox.prebanco.com.br é o host de sandbox; qrpix.bradesco.com.br, o de produção.
    this.env = /sandbox|prebanco/i.test(apiUrl!) ? "sandbox" : "production";
  }

  /** Bearer via client_credentials sobre mTLS. Cacheado até expirar. */
  private async getToken(force = false): Promise<string> {
    if (!force && tokenCache && tokenCache.expiresAtMs > Date.now()) {
      return tokenCache.token;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "",
    });
    const res = await fetch(`${this.apiUrl}/auth/server/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      client: this.httpClient,
    } as RequestInit);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data as { message?: string; error_description?: string; code?: string };
      throw new Error(
        `Bradesco token: ${d?.message ?? d?.error_description ?? `HTTP ${res.status}`}`,
      );
    }
    const token = (data as { access_token?: string }).access_token;
    if (!token) throw new Error("Bradesco não devolveu access_token");
    const expiresIn = Number((data as { expires_in?: number | string }).expires_in);
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 300_000;
    tokenCache = { token, expiresAtMs: Date.now() + Math.max(ttlMs - TOKEN_SKEW_MS, 30_000) };
    return token;
  }

  private async fetchJson(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    retriedAuth = false,
  ): Promise<unknown> {
    const token = await this.getToken();
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      client: this.httpClient,
    } as RequestInit);

    // Token revogado/expirado antes da hora: renova uma vez e repete.
    if ((res.status === 401 || res.status === 403) && !retriedAuth) {
      await res.body?.cancel();
      tokenCache = null;
      await this.getToken(true);
      return this.fetchJson(method, path, body, true);
    }

    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 300) };
    }
    if (!res.ok) {
      const d = data as {
        message?: string;
        mensagem?: string;
        detail?: string;
        code?: string;
        codigo?: string;
        violacoes?: Array<{ razao?: string; propriedade?: string }>;
      };
      const violations = Array.isArray(d?.violacoes) && d.violacoes.length
        ? d.violacoes.map((v) => `${v.propriedade ?? "?"}: ${v.razao ?? "?"}`).join("; ")
        : null;
      const detail = violations ??
        d?.message ?? d?.mensagem ?? d?.detail ??
        (d?.code ?? d?.codigo ? `código ${d.code ?? d.codigo}` : null) ??
        `HTTP ${res.status}`;
      throw new Error(`Bradesco ${method} ${path}: ${detail}`);
    }
    return data;
  }

  /** Credencial + certificado ok? (pix-provider-health?ping=1) — nunca expõe segredos. */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.getToken(true);
      return { ok: true, detail: `token obtido (${this.env})` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async createCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    const txid = chargeIdToTxid(input.internalId);

    // Sem expiração explícita o Bradesco usa 24h — muito além do nosso expires_at.
    const expiracao = input.expiresInSeconds && input.expiresInSeconds > 0
      ? Math.floor(input.expiresInSeconds)
      : 900;

    const cob = (await this.fetchJson("PUT", `/v2/cob/${txid}`, {
      calendario: { expiracao },
      valor: {
        original: (input.amountCents / 100).toFixed(2),
        modalidadeAlteracao: 0,
      },
      chave: this.pixKey,
      devedor: {
        cpf: input.cpfDigits,
        nome: (input.customerName || "Cliente Take Me").slice(0, 200),
      },
      ...(input.description ? { solicitacaoPagador: input.description.slice(0, 140) } : {}),
    })) as BradescoCob;

    const qrPayload = cob?.pixCopiaECola ?? cob?.emv;
    if (!qrPayload) throw new Error("Bradesco não devolveu o pixCopiaECola da cobrança");

    // A imagem só vem no GET. Se falhar, seguimos com o copia-e-cola: ele sozinho
    // paga, e a tela do cliente já tem fallback quando a imagem não carrega. Não
    // cancelamos a cobrança por isso (diferente do Asaas, onde o QR vinha de um
    // recurso separado que podia deixar um payment órfão no painel).
    let qrImageBase64 = cob?.base64 ?? "";
    if (!qrImageBase64) {
      try {
        const full = (await this.fetchJson("GET", `/v2/cob/${txid}`)) as BradescoCob;
        qrImageBase64 = full?.base64 ?? "";
      } catch (e) {
        console.warn(
          `[bradesco] cobrança ${txid} criada, mas a imagem do QR não veio:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    return { providerChargeId: txid, qrPayload, qrImageBase64 };
  }

  async getChargeStatus(providerChargeId: string): Promise<ProviderChargeSnapshot> {
    const cob = (await this.fetchJson(
      "GET",
      `/v2/cob/${encodeURIComponent(providerChargeId)}`,
    )) as BradescoCob;
    const snapshot = cobToSnapshot({ ...cob, txid: cob.txid ?? providerChargeId });

    // Nem toda resposta de cobrança CONCLUIDA traz o array `pix`. Sem ele não temos
    // valor pago nem horário — e o settle depende do valor para detectar divergência.
    // Nesse caso buscamos a transação pelo txid.
    if (snapshot.status === "paid" && snapshot.paidAt === null) {
      try {
        const found = await this.findReceivedByTxid(providerChargeId);
        if (found) {
          snapshot.paidAmountCents = found.paidAmountCents ?? snapshot.paidAmountCents;
          snapshot.paidAt = found.paidAt;
        }
      } catch (e) {
        console.warn(
          `[bradesco] cobrança ${providerChargeId} CONCLUIDA sem pix[]; consulta por txid falhou:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    return snapshot;
  }

  async cancelCharge(providerChargeId: string): Promise<void> {
    // Único status aceito no PATCH (erros 4007/4009 do manual).
    await this.fetchJson("PATCH", `/v2/cob/${encodeURIComponent(providerChargeId)}`, {
      status: "REMOVIDA_PELO_USUARIO_RECEBEDOR",
    });
  }

  /** Um Pix recebido, localizado pelo txid da cobrança (janela de 7 dias). */
  private async findReceivedByTxid(txid: string): Promise<ProviderChargeSnapshot | null> {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - 7 * 24 * 3600 * 1000);
    const rows = await this.listReceived(inicio, fim, txid);
    return rows[0] ?? null;
  }

  /**
   * Lista Pix recebidos num intervalo (reconcile provedor→banco).
   * `paymentDate` é YYYY-MM-DD; a API do Bradesco trabalha com inicio/fim RFC 3339.
   */
  async listReceivedPayments(paymentDate: string): Promise<ProviderChargeSnapshot[]> {
    const inicio = new Date(`${paymentDate}T00:00:00.000Z`);
    const fim = new Date(`${paymentDate}T23:59:59.999Z`);
    if (Number.isNaN(inicio.getTime())) return [];
    return this.listReceived(inicio, fim);
  }

  private async listReceived(
    inicio: Date,
    fim: Date,
    txid?: string,
  ): Promise<ProviderChargeSnapshot[]> {
    const out: ProviderChargeSnapshot[] = [];
    const itensPorPagina = 100;
    for (let pagina = 0; pagina < 20; pagina++) {
      const qs = new URLSearchParams({
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        "paginacao.paginaAtual": String(pagina),
        "paginacao.itensPorPagina": String(itensPorPagina),
        ...(txid ? { txid } : {}),
      });
      const res = (await this.fetchJson("GET", `/v2/pix?${qs.toString()}`)) as {
        pix?: Array<{ endToEndId?: string; txid?: string; valor?: string; horario?: string }>;
        parametros?: { paginacao?: { quantidadeDePaginas?: number } };
      };
      const rows = Array.isArray(res?.pix) ? res.pix : [];
      for (const p of rows) {
        // O par no nosso banco é a COBRANÇA (txid), não o endToEndId.
        const rowTxid = p.txid ?? "";
        if (!rowTxid) continue;
        out.push({
          providerChargeId: rowTxid,
          status: "paid",
          paidAmountCents: reaisToCents(p.valor),
          paidAt: p.horario ?? null,
          externalReference: txidToChargeId(rowTxid),
          raw: p,
        });
      }
      const totalPaginas = res?.parametros?.paginacao?.quantidadeDePaginas;
      if (rows.length === 0) break;
      if (Number.isFinite(totalPaginas) && pagina + 1 >= Number(totalPaginas)) break;
      if (rows.length < itensPorPagina) break;
    }
    return out;
  }
}
