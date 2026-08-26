/**
 * pixQueries — data layer do gestor de provedores Pix (aba Pix em Configurações
 * e tela /pagamentos/pix). Módulo isolado de queries.ts (4400+ linhas).
 *
 * ⚠️ CONTRATO FLAT: `platform_settings.pix_provider` e `pix_palliative` são
 * objetos FLAT (sem wrapper `{value}`). NUNCA escrever essas chaves via
 * `usePlatformSettings.updateSetting` — o hook embrulha em `{value}` e
 * quebraria o app cliente em produção. Escrita SÓ pelas funções deste módulo.
 *
 * As tabelas `pix_charges`/`pix_refunds_pending` podem não existir ainda
 * (backend da Fase 0/1 pendente): erro de leitura vira ESTADO (tableMissing),
 * nunca exceção — o admin degrada, não quebra.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { invokeEdgeFunction } from './queries';

/** Tabelas fora do `Database` gerado — evita erros de tipo em `.from()`. */
const sb = supabase as any;

// ── Types ────────────────────────────────────────────────────────────────

export type PixProviderMode = 'palliative' | 'asaas' | 'bradesco';
export type PixRealProvider = 'asaas' | 'bradesco';

/** Shape FLAT de platform_settings.pix_provider (contrato compartilhado). */
export interface PixProviderSetting {
  mode: PixProviderMode;
  test_provider: PixRealProvider | null;
  allowlist_user_ids: string[];
  charge_ttl_minutes: number;
  /** Metadados da linha (não fazem parte do value). */
  updated_at: string | null;
  updated_by: string | null;
}

export const DEFAULT_PIX_PROVIDER_SETTING: PixProviderSetting = {
  mode: 'palliative',
  test_provider: null,
  allowlist_user_ids: [],
  charge_ttl_minutes: 15,
  updated_at: null,
  updated_by: null,
};

/** Shape FLAT de platform_settings.pix_palliative (contrato com palliativePixConfig.ts do cliente). */
export interface PixPalliativeSetting {
  copia_e_cola: string;
  qr_image_url: string;
  updated_at: string | null;
  updated_by: string | null;
}

export interface ProfileSummary {
  id: string;
  full_name: string | null;
  phone: string | null;
  cpf: string | null;
}

export type PixChargeStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'amount_mismatch'
  | 'paid_orphan'
  | 'create_failed';

export const PIX_CHARGE_STATUSES: PixChargeStatus[] = [
  'pending', 'paid', 'expired', 'cancelled', 'amount_mismatch', 'paid_orphan', 'create_failed',
];

export interface PixChargeRow {
  id: string;
  provider: PixRealProvider;
  provider_env: 'sandbox' | 'production' | null;
  provider_charge_id: string | null;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  expected_amount_cents: number;
  paid_amount_cents: number | null;
  status: PixChargeStatus;
  qr_payload: string | null;
  expires_at: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface PixChargesFilter {
  status?: PixChargeStatus | 'all';
  provider?: PixRealProvider | 'all';
  /** ISO date (yyyy-mm-dd) inclusivo. */
  dateFrom?: string;
  /** ISO date (yyyy-mm-dd) inclusivo. */
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface PixChargesResult {
  rows: PixChargeRow[];
  total: number;
  error: string | null;
  /** true quando a tabela ainda não existe neste ambiente (backend não publicado). */
  tableMissing: boolean;
}

export interface PixChargeCountsResult {
  counts: Record<PixChargeStatus, number>;
  error: string | null;
  tableMissing: boolean;
}

export type PixRefundReason =
  | 'paid_after_expiry'
  | 'amount_mismatch'
  | 'expired_not_realized'
  | 'user_cancelled_in_window'
  | 'admin_cancelled'
  | 'orphan_payment';

export interface PixRefundRow {
  id: string;
  pix_charge_id: string | null;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  amount_cents: number;
  reason: PixRefundReason;
  status: 'pending' | 'done' | 'dismissed';
  notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface PixRefundsResult {
  rows: PixRefundRow[];
  error: string | null;
  tableMissing: boolean;
}

export interface PixProviderHealthEntry {
  configured: boolean;
  ok?: boolean;
  detail?: string;
}

export interface PixProviderHealthResult {
  providers: Record<string, PixProviderHealthEntry>;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Erro do PostgREST quando a tabela não existe / não está no schema cache. */
function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache');
}

/** Desembrulha defensivamente `{value: {...}}` (não repetir o bug do process-payouts). */
function unwrapFlat(raw: any): any {
  if (raw && typeof raw === 'object' && 'value' in raw && raw.value && typeof raw.value === 'object') {
    return raw.value;
  }
  return raw;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  return data?.session?.user?.id ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cpfVariantsForQuery(digits: string): string[] {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 11) return d ? [d] : [];
  return [d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`];
}

// ── platform_settings.pix_provider ───────────────────────────────────────

export async function fetchPixProviderSetting(): Promise<PixProviderSetting> {
  if (!isSupabaseConfigured) return { ...DEFAULT_PIX_PROVIDER_SETTING };
  const { data, error } = await sb
    .from('platform_settings')
    .select('key, value, updated_at, updated_by')
    .eq('key', 'pix_provider')
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_PIX_PROVIDER_SETTING };
  const v = unwrapFlat(data.value) || {};
  const mode: PixProviderMode =
    v.mode === 'asaas' || v.mode === 'bradesco' ? v.mode : 'palliative';
  const test: PixRealProvider | null =
    v.test_provider === 'asaas' || v.test_provider === 'bradesco' ? v.test_provider : null;
  const allowlist = Array.isArray(v.allowlist_user_ids)
    ? v.allowlist_user_ids.filter((x: unknown) => typeof x === 'string')
    : [];
  const ttl = Number(v.charge_ttl_minutes);
  return {
    mode,
    test_provider: test,
    allowlist_user_ids: allowlist,
    charge_ttl_minutes: Number.isFinite(ttl) && ttl > 0 ? ttl : 15,
    updated_at: data.updated_at ?? null,
    updated_by: data.updated_by ?? null,
  };
}

/**
 * Upsert FLAT direto (SEM wrapper `{value}`). O backend lê `value->>'mode'`.
 */
export async function updatePixProviderSetting(next: {
  mode: PixProviderMode;
  test_provider: PixRealProvider | null;
  allowlist_user_ids: string[];
  charge_ttl_minutes: number;
}): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase não configurado' };
  const userId = await currentUserId();
  const ttl = Number(next.charge_ttl_minutes);
  const flat = {
    mode: next.mode,
    test_provider: next.test_provider,
    allowlist_user_ids: [...new Set(next.allowlist_user_ids)],
    charge_ttl_minutes: Number.isFinite(ttl) && ttl > 0 ? Math.round(ttl) : 15,
  };
  const { error } = await sb
    .from('platform_settings')
    .upsert({
      key: 'pix_provider',
      value: flat,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }, { onConflict: 'key' });
  return { error: error ? (error.message || 'Erro ao salvar') : null };
}

// ── platform_settings.pix_palliative ─────────────────────────────────────

export async function fetchPixPalliativeSetting(): Promise<PixPalliativeSetting> {
  const empty: PixPalliativeSetting = { copia_e_cola: '', qr_image_url: '', updated_at: null, updated_by: null };
  if (!isSupabaseConfigured) return empty;
  const { data, error } = await sb
    .from('platform_settings')
    .select('key, value, updated_at, updated_by')
    .eq('key', 'pix_palliative')
    .maybeSingle();
  if (error || !data) return empty;
  const v = unwrapFlat(data.value) || {};
  return {
    copia_e_cola: typeof v.copia_e_cola === 'string' ? v.copia_e_cola : '',
    qr_image_url: typeof v.qr_image_url === 'string' ? v.qr_image_url : '',
    updated_at: data.updated_at ?? null,
    updated_by: data.updated_by ?? null,
  };
}

/**
 * Upsert FLAT `{copia_e_cola, qr_image_url}` — contrato com o
 * `palliativePixConfig.ts` do app cliente (produção). NUNCA embrulhar em `{value}`.
 */
export async function updatePixPalliativeSetting(next: {
  copia_e_cola: string;
  qr_image_url: string;
}): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase não configurado' };
  const userId = await currentUserId();
  const { error } = await sb
    .from('platform_settings')
    .upsert({
      key: 'pix_palliative',
      value: {
        copia_e_cola: next.copia_e_cola.trim(),
        qr_image_url: next.qr_image_url.trim(),
      },
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }, { onConflict: 'key' });
  return { error: error ? (error.message || 'Erro ao salvar') : null };
}

// ── Profiles (allowlist e exibição) ──────────────────────────────────────

/**
 * Resolve um perfil por UUID, CPF ou telefone (e-mail NÃO — profiles não tem
 * e-mail). O chamador armazena sempre o `id` (user_id) na allowlist.
 */
export async function findProfileByIdentifier(
  identifier: string,
): Promise<{ profile: ProfileSummary | null; error: string | null }> {
  if (!isSupabaseConfigured) return { profile: null, error: 'Supabase não configurado' };
  const raw = identifier.trim();
  if (!raw) return { profile: null, error: 'Informe um identificador' };
  const select = 'id, full_name, phone, cpf';

  if (UUID_RE.test(raw)) {
    const { data, error } = await sb.from('profiles').select(select).eq('id', raw).maybeSingle();
    if (error) return { profile: null, error: error.message || 'Erro na busca' };
    return { profile: (data as ProfileSummary) ?? null, error: data ? null : 'Nenhum perfil com esse ID' };
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && !raw.includes('+') && !/^\s*\(/.test(raw) && !UUID_RE.test(raw)) {
    // 11 dígitos: pode ser CPF ou celular — tenta CPF primeiro (variantes com e sem máscara).
    const variants = cpfVariantsForQuery(digits);
    const { data, error } = await sb.from('profiles').select(select).in('cpf', variants).limit(1);
    if (error) return { profile: null, error: error.message || 'Erro na busca' };
    if (data && data.length > 0) return { profile: data[0] as ProfileSummary, error: null };
  }

  if (digits.length >= 8) {
    // Telefone: match por sufixo de dígitos (banco pode ter máscara/DDI variados).
    const { data, error } = await sb
      .from('profiles')
      .select(select)
      .ilike('phone', `%${digits.slice(-8)}%`)
      .limit(5);
    if (error) return { profile: null, error: error.message || 'Erro na busca' };
    const rows = (data || []) as ProfileSummary[];
    const exact = rows.find((p) => (p.phone || '').replace(/\D/g, '').endsWith(digits));
    const found = exact ?? (rows.length === 1 ? rows[0] : null);
    if (found) return { profile: found, error: null };
    if (rows.length > 1) return { profile: null, error: 'Mais de um perfil com esse telefone — use o UUID' };
  }

  return { profile: null, error: 'Nenhum perfil encontrado (use UUID, CPF ou telefone)' };
}

/** Nomes por id — para "por {nome}", allowlist e tabelas. Falha ⇒ mapa parcial/vazio. */
export async function fetchProfileNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map: Record<string, string> = {};
  if (!isSupabaseConfigured || unique.length === 0) return map;
  const { data } = await sb.from('profiles').select('id, full_name').in('id', unique);
  (data || []).forEach((p: any) => { map[p.id] = p.full_name || 'Sem nome'; });
  return map;
}

// ── Saúde dos provedores (edge pix-provider-health) ──────────────────────

/**
 * GET pix-provider-health (exige admin). Sem `ping`: só presença dos secrets
 * (barato). Com `ping`: chamada real de credencial no provedor.
 */
export async function fetchPixProviderHealth(ping?: boolean): Promise<PixProviderHealthResult> {
  const { data, error } = await invokeEdgeFunction<{ providers?: Record<string, PixProviderHealthEntry> }>(
    'pix-provider-health',
    'GET',
    ping ? { ping: '1' } : undefined,
  );
  if (error || !data) return { providers: {}, error: error || 'Sem resposta' };
  return { providers: data.providers || {}, error: null };
}

// ── pix_charges ──────────────────────────────────────────────────────────

export async function fetchPixCharges(filters: PixChargesFilter = {}): Promise<PixChargesResult> {
  const emptyResult = (error: string | null, tableMissing: boolean): PixChargesResult =>
    ({ rows: [], total: 0, error, tableMissing });
  if (!isSupabaseConfigured) return emptyResult(null, true);

  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 50;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const from = (page - 1) * pageSize;

  let q = sb
    .from('pix_charges')
    .select(
      'id, provider, provider_env, provider_charge_id, entity_type, entity_id, user_id, expected_amount_cents, paid_amount_cents, status, qr_payload, expires_at, paid_at, failure_reason, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
  if (filters.provider && filters.provider !== 'all') q = q.eq('provider', filters.provider);
  if (filters.dateFrom) q = q.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) q = q.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);

  const { data, error, count } = await q;
  if (error) {
    if (isTableMissingError(error)) return emptyResult(null, true);
    return emptyResult(error.message || 'Erro ao carregar cobranças', false);
  }
  return { rows: (data || []) as PixChargeRow[], total: count ?? 0, error: null, tableMissing: false };
}

export async function fetchPixChargeCounts(): Promise<PixChargeCountsResult> {
  const zero = () =>
    PIX_CHARGE_STATUSES.reduce((acc, s) => { acc[s] = 0; return acc; }, {} as Record<PixChargeStatus, number>);
  if (!isSupabaseConfigured) return { counts: zero(), error: null, tableMissing: true };

  const results = await Promise.all(
    PIX_CHARGE_STATUSES.map((status) =>
      sb.from('pix_charges').select('id', { count: 'exact', head: true }).eq('status', status),
    ),
  );
  const counts = zero();
  for (let i = 0; i < PIX_CHARGE_STATUSES.length; i++) {
    const { count, error } = results[i] as { count: number | null; error: any };
    if (error) {
      if (isTableMissingError(error)) return { counts: zero(), error: null, tableMissing: true };
      return { counts: zero(), error: error.message || 'Erro ao contar cobranças', tableMissing: false };
    }
    counts[PIX_CHARGE_STATUSES[i]] = count ?? 0;
  }
  return { counts, error: null, tableMissing: false };
}

// ── pix_refunds_pending ──────────────────────────────────────────────────

export async function fetchPixRefunds(includeResolved: boolean): Promise<PixRefundsResult> {
  if (!isSupabaseConfigured) return { rows: [], error: null, tableMissing: true };
  let q = sb
    .from('pix_refunds_pending')
    .select('id, pix_charge_id, entity_type, entity_id, user_id, amount_cents, reason, status, notes, resolved_at, resolved_by, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!includeResolved) q = q.eq('status', 'pending');
  const { data, error } = await q;
  if (error) {
    if (isTableMissingError(error)) return { rows: [], error: null, tableMissing: true };
    return { rows: [], error: error.message || 'Erro ao carregar devoluções', tableMissing: false };
  }
  return { rows: (data || []) as PixRefundRow[], error: null, tableMissing: false };
}

/** Contagem da fila aberta — badge no PagamentosScreen. Qualquer erro ⇒ 0 (degrada). */
export async function fetchPixRefundsPendingCount(): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  const { count, error } = await sb
    .from('pix_refunds_pending')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) return 0;
  return count ?? 0;
}

/**
 * Marca uma devolução como feita (status 'done'). NÃO move dinheiro — apenas
 * registra que a devolução JÁ FOI FEITA fora do sistema.
 */
export async function markPixRefundResolved(id: string, notes?: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'Supabase não configurado' };
  const userId = await currentUserId();
  const patch: Record<string, unknown> = {
    status: 'done',
    resolved_at: new Date().toISOString(),
    resolved_by: userId || null,
  };
  if (notes && notes.trim()) patch.notes = notes.trim();
  const { error } = await sb
    .from('pix_refunds_pending')
    .update(patch)
    .eq('id', id)
    .eq('status', 'pending');
  return { error: error ? (error.message || 'Erro ao marcar devolução') : null };
}
