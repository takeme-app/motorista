import { supabase } from './supabase';
import {
  describeInvokeFailure,
  formatEdgeFunctionBody,
  parseInvokeData,
} from '../utils/edgeFunctionResponse';
import type { PixBookingDraftParam } from '../navigation/types';

/**
 * Cliente das edge functions do Pix REAL (gestor de provedores — ex.: Asaas).
 *
 * Contrato do `create-pix-charge` (fase viagem):
 *   POST { entity_type:'booking', scheduled_trip_id, cpf?, draft:{origin_*,
 *          destination_*, passenger_count, bags_count, passenger_data, promotion_id?} }
 *   200 { ok, pix_charge_id, entity_type, entity_id, amount_cents,   // recalculado no servidor
 *         qr_payload, qr_image_base64, expires_at }
 *   409 { error:'pix_provider_not_active' } → app cai no fluxo paliativo
 *   422 { error:'cpf_required' }            → app coleta CPF
 *
 * Token via getSession + refreshSession (SEM ensure-stripe-customer — Pix real
 * não passa pela Stripe). Erros legíveis via utils/edgeFunctionResponse.
 */

const EDGE_CREATE_PIX_CHARGE_SLUG = 'create-pix-charge';
const EDGE_GET_PIX_CHARGE_STATUS_SLUG = 'get-pix-charge-status';

export type PixChargeStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'amount_mismatch'
  | 'paid_orphan'
  | 'create_failed';

const KNOWN_STATUSES: readonly PixChargeStatus[] = [
  'pending',
  'paid',
  'expired',
  'cancelled',
  'amount_mismatch',
  'paid_orphan',
  'create_failed',
];

/** Status desconhecido do servidor ⇒ trata como pendente (segue observando; nunca crasha). */
function normalizeStatus(value: unknown): PixChargeStatus {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as PixChargeStatus)
    : 'pending';
}

export type PixChargeCreated = {
  pixChargeId: string;
  entityType: string;
  /** Id do pedido criado pelo servidor (booking na fase viagem). */
  entityId: string;
  /** Valor recalculado NO SERVIDOR. */
  amountCents: number;
  /** Copia-e-cola. */
  qrPayload: string;
  /** PNG base64 do QR (sem prefixo data:), ou null — fallback: só copia-e-cola. */
  qrImageBase64: string | null;
  expiresAt: string;
};

export type CreatePixChargeResult =
  | { ok: true; charge: PixChargeCreated }
  | { ok: false; code: 'palliative_mode' | 'cpf_required' | 'error'; message?: string };

export type PixChargeStatusResult =
  | {
      ok: true;
      status: PixChargeStatus;
      paidAt: string | null;
      expiresAt: string | null;
      entityType: string | null;
      entityId: string | null;
    }
  | { ok: false; message: string };

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const { data: refreshData } = await supabase.auth.refreshSession();
    return refreshData.session?.access_token ?? session.access_token;
  } catch {
    return session.access_token;
  }
}

type InvokeErrorInfo = { status: number | null; body: Record<string, unknown> | null };

/**
 * Extrai status HTTP + corpo JSON do erro do invoke (FunctionsHttpError guarda
 * o fetch Response em `context`/`context.response`). Nunca lança.
 */
async function readInvokeErrorInfo(fnData: unknown, fnError: unknown): Promise<InvokeErrorInfo> {
  let status: number | null = null;
  let body: Record<string, unknown> | null = parseInvokeData(fnData);
  try {
    const ctx = (fnError as { context?: unknown } | null | undefined)?.context;
    const resp =
      ctx && typeof ctx === 'object' && 'response' in (ctx as Record<string, unknown>)
        ? (ctx as { response?: unknown }).response
        : ctx;
    if (resp && typeof resp === 'object') {
      const st = Number((resp as { status?: unknown }).status);
      if (Number.isFinite(st) && st > 0) status = st;
      if (!body && typeof (resp as { json?: unknown }).json === 'function') {
        try {
          const parsed: unknown = await (resp as { json: () => Promise<unknown> }).json();
          if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
        } catch {
          /* corpo não-JSON ou já consumido */
        }
      }
    }
  } catch {
    /* defensivo */
  }
  return { status, body };
}

function readErrorCode(body: Record<string, unknown> | null): string {
  if (!body) return '';
  const err = body.error;
  if (typeof err === 'string') return err.trim();
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code.trim();
  }
  return '';
}

/**
 * Cria a cobrança Pix real no servidor (que recalcula o preço e insere o pedido
 * `pending`, segurando a vaga). Retomada é do servidor: cobrança pendente não
 * expirada do mesmo usuário+viagem devolve o MESMO QR.
 */
export async function createPixCharge(
  input:
    | { service: 'booking'; cpf?: string; draft: PixBookingDraftParam }
    // Encomenda: o preço vem da cotação do app (shipmentQuote), como no cartão.
    // Mandamos o payload de insert e o servidor cria a encomenda já ancorada na
    // cobrança, para o gatilho de fila não ofertá-la antes do pagamento.
    | { service: 'shipment'; cpf?: string; shipmentDraft: Record<string, unknown> }
    // Envio de dependente: idem encomenda.
    | { service: 'dependent_shipment'; cpf?: string; dependentDraft: Record<string, unknown> }
    // Excursão: o orçamento já existe; só mandamos o id.
    | { service: 'excursion'; cpf?: string; excursionRequestId: string },
): Promise<CreatePixChargeResult> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { ok: false, code: 'error', message: 'Sessão expirada. Faça login novamente.' };
    }
    const payload =
      input.service === 'shipment'
        ? { entity_type: 'shipment', shipment_draft: input.shipmentDraft }
        : input.service === 'dependent_shipment'
        ? { entity_type: 'dependent_shipment', dependent_draft: input.dependentDraft }
        : input.service === 'excursion'
        ? { entity_type: 'excursion', excursion_request_id: input.excursionRequestId }
        : (() => {
            const { scheduled_trip_id, ...draftRest } = input.draft;
            return { entity_type: 'booking', scheduled_trip_id, draft: draftRest };
          })();
    const { data, error } = await supabase.functions.invoke(EDGE_CREATE_PIX_CHARGE_SLUG, {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        ...payload,
        ...(input.cpf ? { cpf: input.cpf } : {}),
      },
    });

    if (error) {
      const { status, body } = await readInvokeErrorInfo(data, error);
      const code = readErrorCode(body);
      if (code === 'pix_provider_not_active') return { ok: false, code: 'palliative_mode' };
      if (code === 'cpf_required' || status === 422) return { ok: false, code: 'cpf_required' };
      const message =
        formatEdgeFunctionBody(body) ?? (await describeInvokeFailure(data, error));
      return { ok: false, code: 'error', message };
    }

    const bodyOk = parseInvokeData(data);
    const pixChargeId = typeof bodyOk?.pix_charge_id === 'string' ? bodyOk.pix_charge_id : '';
    const entityId = bodyOk?.entity_id != null ? String(bodyOk.entity_id) : '';
    const amountCents = Number(bodyOk?.amount_cents);
    const qrPayload = typeof bodyOk?.qr_payload === 'string' ? bodyOk.qr_payload : '';
    const qrImageBase64 =
      typeof bodyOk?.qr_image_base64 === 'string' && bodyOk.qr_image_base64.trim()
        ? bodyOk.qr_image_base64.trim()
        : null;
    const expiresAt = typeof bodyOk?.expires_at === 'string' ? bodyOk.expires_at : '';

    if (!pixChargeId || !qrPayload || !expiresAt || !Number.isFinite(amountCents) || amountCents < 1) {
      return {
        ok: false,
        code: 'error',
        message: 'Resposta inesperada ao gerar a cobrança Pix. Tente novamente.',
      };
    }

    return {
      ok: true,
      charge: {
        pixChargeId,
        entityType: typeof bodyOk?.entity_type === 'string' ? bodyOk.entity_type : input.service,
        entityId,
        amountCents: Math.floor(amountCents),
        qrPayload,
        qrImageBase64,
        expiresAt,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return {
      ok: false,
      code: 'error',
      message: msg || 'Não foi possível gerar a cobrança Pix. Verifique sua conexão e tente novamente.',
    };
  }
}

/**
 * Status da cobrança (`get-pix-charge-status` re-consulta o provedor quando
 * pendente e se auto-corrige — funciona mesmo com webhook fora do ar).
 */
export async function getPixChargeStatus(pixChargeId: string): Promise<PixChargeStatusResult> {
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, message: 'Sessão expirada. Faça login novamente.' };
    const { data, error } = await supabase.functions.invoke(EDGE_GET_PIX_CHARGE_STATUS_SLUG, {
      headers: { Authorization: `Bearer ${token}` },
      body: { pix_charge_id: pixChargeId },
    });
    if (error) {
      const message = await describeInvokeFailure(data, error);
      return { ok: false, message };
    }
    const body = parseInvokeData(data);
    if (!body) return { ok: false, message: 'Resposta inesperada ao consultar o pagamento.' };
    return {
      ok: true,
      status: normalizeStatus(body.status),
      paidAt: typeof body.paid_at === 'string' ? body.paid_at : null,
      expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
      entityType: typeof body.entity_type === 'string' ? body.entity_type : null,
      entityId: body.entity_id != null ? String(body.entity_id) : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, message: msg || 'Não foi possível consultar o pagamento agora.' };
  }
}

export type OpenPixCharge = {
  pixChargeId: string;
  entityType: string;
  entityId: string;
  amountCents: number;
  qrPayload: string;
  qrImageBase64: string | null;
  expiresAt: string;
};

/**
 * Relê uma cobrança Pix JÁ criada, para o cliente voltar ao QR depois de sair
 * da tela. Sem isto o pedido ficava visível em Atividades como "Aguardando
 * pagamento" e não havia caminho de volta para pagar — a pessoa só podia
 * esperar expirar.
 *
 * Lê a tabela direto: a RLS `pix_charges_select_own` já limita ao dono, e o
 * get-pix-charge-status não devolve o QR.
 */
export async function fetchOpenPixCharge(pixChargeId: string): Promise<OpenPixCharge | null> {
  try {
    // Tipos gerados (packages/shared) não têm pix_charges; cast como o resto
    // do app já faz para tabelas fora do schema gerado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('pix_charges')
      .select('id, entity_type, entity_id, expected_amount_cents, qr_payload, qr_image_base64, expires_at, status')
      .eq('id', pixChargeId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as {
      id: string;
      entity_type: string;
      entity_id: string;
      expected_amount_cents: number;
      qr_payload: string | null;
      qr_image_base64: string | null;
      expires_at: string | null;
      status: string;
    };
    if (row.status !== 'pending' || !row.qr_payload || !row.expires_at) return null;
    return {
      pixChargeId: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      amountCents: Number(row.expected_amount_cents) || 0,
      qrPayload: row.qr_payload,
      qrImageBase64: row.qr_image_base64,
      expiresAt: row.expires_at,
    };
  } catch {
    return null;
  }
}
