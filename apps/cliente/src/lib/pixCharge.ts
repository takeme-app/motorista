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

export type ReopenPixChargeResult =
  | { ok: true; charge: PixChargeCreated; renewed: boolean }
  | { ok: false; code: 'order_not_payable' | 'error'; message: string };

/**
 * Reabre o pagamento de um pedido a partir da cobrança que ele já teve.
 *
 * O servidor decide: cobrança ainda no prazo devolve a MESMA (não abre outra no
 * provedor nem deixa duas em aberto para o mesmo pedido); expirada gera uma
 * nova para o mesmo pedido. Antes disto a tela lia a cobrança direto da tabela
 * e, se tivesse expirado, só sabia dizer "não está mais disponível" — o cliente
 * ficava preso sem como pagar.
 *
 * Se o pedido já tiver sido cancelado (o cron varre as expiradas a cada 2 min),
 * volta `order_not_payable` com a explicação.
 */
export async function reopenPixCharge(pixChargeId: string): Promise<ReopenPixChargeResult> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { ok: false, code: 'error', message: 'Sessão expirada. Faça login novamente.' };
    }
    const { data, error } = await supabase.functions.invoke(EDGE_CREATE_PIX_CHARGE_SLUG, {
      headers: { Authorization: `Bearer ${token}` },
      body: { renew_pix_charge_id: pixChargeId },
    });
    if (error) {
      const { body } = await readInvokeErrorInfo(data, error);
      const code = readErrorCode(body);
      if (code === 'order_not_payable') {
        const msg = typeof body?.message === 'string' ? body.message : '';
        return {
          ok: false,
          code: 'order_not_payable',
          message:
            msg ||
            'Este pedido não está mais disponível para pagamento porque o código expirou. Faça uma nova solicitação.',
        };
      }
      const message =
        formatEdgeFunctionBody(body) ?? (await describeInvokeFailure(data, error));
      return { ok: false, code: 'error', message };
    }
    const b = parseInvokeData(data);
    const id = typeof b?.pix_charge_id === 'string' ? b.pix_charge_id : '';
    const qrPayload = typeof b?.qr_payload === 'string' ? b.qr_payload : '';
    const expiresAt = typeof b?.expires_at === 'string' ? b.expires_at : '';
    const amountCents = Number(b?.amount_cents);
    if (!id || !qrPayload || !expiresAt || !Number.isFinite(amountCents)) {
      return { ok: false, code: 'error', message: 'Resposta inesperada ao reabrir o Pix.' };
    }
    return {
      ok: true,
      renewed: b?.renewed === true,
      charge: {
        pixChargeId: id,
        entityType: typeof b?.entity_type === 'string' ? b.entity_type : '',
        entityId: b?.entity_id != null ? String(b.entity_id) : '',
        amountCents: Math.floor(amountCents),
        qrPayload,
        qrImageBase64:
          typeof b?.qr_image_base64 === 'string' && b.qr_image_base64.trim()
            ? b.qr_image_base64.trim()
            : null,
        expiresAt,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, code: 'error', message: msg || 'Não foi possível reabrir o Pix agora.' };
  }
}
