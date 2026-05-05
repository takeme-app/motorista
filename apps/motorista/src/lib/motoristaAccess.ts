import { supabase } from './supabase';
import type { RegistrationType } from '../navigation/types';
import { hasSkippedStripeConnectSetup } from './stripeConnectSkip';

/** Único status que libera o app (definido com o admin). */
export const MOTORISTA_ACTIVE_STATUS = 'approved';

/**
 * Status inicial aplicado pela verify-(email|phone)-code ao criar o worker_profile
 * após o PIN. Significa "conta criada, etapa 2 (Complete seu perfil) ainda não finalizada".
 * Ao logar de novo nesse estado, o usuário deve retomar na etapa 2, e não ver
 * "Cadastro em análise" nem "Não encontramos cadastro de motorista".
 */
export const MOTORISTA_DRAFT_STATUS = 'inactive';

/** Converte (role, subtype) do DB no RegistrationType usado pelas telas de cadastro. */
export function mapWorkerProfileToRegistrationType(
  role: string | null | undefined,
  subtype: string | null | undefined,
): RegistrationType | null {
  if (role === 'preparer' && subtype === 'excursions') return 'preparador_excursões';
  if (role === 'preparer' && subtype === 'shipments') return 'preparador_encomendas';
  if (role === 'driver' && subtype === 'partner') return 'parceiro';
  if (role === 'driver' && (subtype === 'takeme' || subtype == null)) return 'take_me';
  return null;
}

export type StripeConnectState =
  /** Conta ainda não foi criada na Stripe. */
  | 'none'
  /** Conta criada, mas motorista não concluiu o Account Link (details_submitted=false). */
  | 'incomplete'
  /** Dados enviados (details_submitted=true), Stripe ainda não liberou charges_enabled. */
  | 'in_review'
  /**
   * Dados enviados, mas a Stripe pediu informações adicionais
   * (`requirements.currently_due` ou `past_due` não vazios). Motorista precisa
   * reabrir o Stripe via Account Link `account_update`.
   */
  | 'action_required'
  /** Conta totalmente habilitada (charges_enabled=true). */
  | 'active';

export type StripeConnectRow = {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_details_submitted: boolean | null;
  stripe_connect_requirements_due_count?: number | null;
  /** Campos já enviados, em análise pela Stripe (ex.: PEP do representante). */
  stripe_connect_pending_verification_count?: number | null;
};

/**
 * Deriva o estado do onboarding Stripe Connect a partir das flags espelhadas
 * pelo webhook `account.updated` (ou pela função `stripe-connect-sync`).
 */
export function getStripeConnectState(row: StripeConnectRow | null | undefined): StripeConnectState {
  if (!row?.stripe_connect_account_id) return 'none';
  if (row.stripe_connect_charges_enabled === true) return 'active';
  if (row.stripe_connect_details_submitted === true) {
    if ((row.stripe_connect_requirements_due_count ?? 0) > 0) return 'action_required';
    return 'in_review';
  }
  return 'incomplete';
}

/**
 * O motorista pode usar o app quando terminou de enviar os dados (even if Stripe ainda
 * está analisando). As cobranças feitas nesse intervalo são retidas na plataforma e
 * repassadas depois (charge-booking não aplica transfer_data enquanto charges_enabled
 * é false — ver supabase/functions/charge-booking/index.ts).
 */
export function canUseAppWithStripeState(state: StripeConnectState): boolean {
  return state === 'active' || state === 'in_review' || state === 'action_required';
}

/** @deprecated usar `getStripeConnectState` + `canUseAppWithStripeState`. */
export function isStripeConnectReadyForApp(row: {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean | null;
}): boolean {
  return Boolean(row.stripe_connect_account_id) && row.stripe_connect_charges_enabled === true;
}

export type MotoristaGateResult =
  | { kind: 'active'; role: string; subtype: string; stripeState: StripeConnectState }
  | { kind: 'needs_stripe_connect'; role: string; subtype: string; stripeState: StripeConnectState }
  /**
   * Usuário autenticado passou pela verificação do PIN (worker_profile existe com
   * status='inactive'), mas abandonou a etapa 2 (Complete seu perfil). Login deve
   * retomar exatamente nessa etapa, sem exigir novo cadastro ou mostrar "em análise".
   */
  | { kind: 'needs_profile_completion'; registrationType: RegistrationType | null; role: string; subtype: string }
  | { kind: 'pending'; status: string }
  | { kind: 'missing_profile' }
  | { kind: 'error'; message: string };

export async function checkMotoristaCanAccessApp(userId: string): Promise<MotoristaGateResult> {
  const { data, error } = await supabase
    .from('worker_profiles')
    .select(
      'status, role, subtype, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due_count, stripe_connect_pending_verification_count'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return {
      kind: 'error',
      message: [error.message, error.hint].filter(Boolean).join(' — ') || 'Erro ao carregar perfil.',
    };
  }
  if (!data?.status) {
    return { kind: 'missing_profile' };
  }
  if (data.status === MOTORISTA_DRAFT_STATUS) {
    const role = (data.role as string | null) ?? 'driver';
    const subtype = (data.subtype as string | null) ?? 'takeme';
    return {
      kind: 'needs_profile_completion',
      registrationType: mapWorkerProfileToRegistrationType(role, subtype),
      role,
      subtype,
    };
  }
  if (data.status === MOTORISTA_ACTIVE_STATUS) {
    const stripeState = getStripeConnectState(data);
    const role = (data.role as string | null) ?? 'driver';
    const subtype = normalizeWorkerSubtype(role, data.subtype);
    const skippedStripeConnect = await hasSkippedStripeConnectSetup(userId);
    if (!canUseAppWithStripeState(stripeState) && !skippedStripeConnect) {
      return { kind: 'needs_stripe_connect', role, subtype, stripeState };
    }
    return { kind: 'active', role, subtype, stripeState };
  }
  return { kind: 'pending', status: data.status };
}

export function getMotoristaPendingCopy(status: string): { title: string; message: string } {
  if (status === 'rejected') {
    return {
      title: 'Cadastro não aprovado',
      message:
        'Seu cadastro não foi aprovado. Em caso de dúvida, entre em contato com o suporte Take Me.',
    };
  }
  if (status === 'suspended') {
    return {
      title: 'Conta suspensa',
      message: 'Sua conta está suspensa. Entre em contato com o suporte Take Me para mais informações.',
    };
  }
  return {
    title: 'Cadastro em análise',
    message:
      'Seu cadastro está passando por aprovação da equipe administrativa. Você será notificado quando estiver liberado para usar o app.',
  };
}

/** Mapeia subtype do DB para a rota principal correta. */
export function subtypeToMainRoute(
  subtype: string,
  role: string = 'driver',
): 'Main' | 'MainExcursoes' | 'MainEncomendas' {
  if (role === 'preparer' && subtype !== 'excursions') return 'MainEncomendas';
  if (subtype === 'excursions') return 'MainExcursoes';
  if (subtype === 'shipments') return 'MainEncomendas';
  return 'Main';
}

function normalizeWorkerSubtype(role: string, subtype: string | null | undefined): string {
  if (role === 'preparer') {
    return subtype === 'excursions' ? 'excursions' : 'shipments';
  }
  return subtype === 'partner' ? 'partner' : 'takeme';
}
