/**
 * PixGestaoScreen — /pagamentos/pix. Gestão das cobranças Pix reais
 * (pix_charges) e da fila manual de devoluções (pix_refunds_pending).
 * Herda a permissão do módulo "Pagamentos" (Layout resolve pelo 1º segmento).
 * Degrada com banner quando o backend Pix ainda não foi publicado.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { webStyles } from '../styles/webStyles';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  fetchPixCharges,
  fetchPixChargeCounts,
  fetchPixRefunds,
  markPixRefundResolved,
  fetchProfileNames,
  PIX_CHARGE_STATUSES,
  type PixChargeRow,
  type PixChargeStatus,
  type PixRefundRow,
  type PixRefundReason,
  type PixRealProvider,
} from '../data/pixQueries';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<PixChargeStatus, string> = {
  pending: 'Pendentes',
  paid: 'Pagas',
  expired: 'Expiradas',
  cancelled: 'Canceladas',
  amount_mismatch: 'Valor divergente',
  paid_orphan: 'Pagas órfãs',
  create_failed: 'Falha ao criar',
};

/** Estados que exigem ação humana — destaque vermelho nos chips e badges. */
const ATTENTION_STATUSES: PixChargeStatus[] = ['amount_mismatch', 'paid_orphan'];

const statusBadgeStyles: Record<PixChargeStatus, { bg: string; color: string }> = {
  pending: { bg: '#fee59a', color: '#654c01' },
  paid: { bg: '#b0e8d1', color: '#174f38' },
  expired: { bg: '#e2e2e2', color: '#3a3a3a' },
  cancelled: { bg: '#eeafaa', color: '#551611' },
  amount_mismatch: { bg: '#fee2e2', color: '#b91c1c' },
  paid_orphan: { bg: '#fee2e2', color: '#b91c1c' },
  create_failed: { bg: '#eeafaa', color: '#551611' },
};

const REASON_LABELS: Record<PixRefundReason, string> = {
  paid_after_expiry: 'Pago após expirar',
  amount_mismatch: 'Valor divergente',
  expired_not_realized: 'Expirou sem se realizar',
  user_cancelled_in_window: 'Cancelado na janela',
  driver_cancelled: 'Motorista cancelou',
  admin_cancelled: 'Cancelado pelo admin',
  orphan_payment: 'Pagamento órfão',
};

const refundStatusStyles: Record<PixRefundRow['status'], { bg: string; color: string; label: string }> = {
  pending: { bg: '#fee59a', color: '#654c01', label: 'Pendente' },
  done: { bg: '#b0e8d1', color: '#174f38', label: 'Devolvido' },
  dismissed: { bg: '#e2e2e2', color: '#3a3a3a', label: 'Dispensada' },
};

const entityTypeStyles: Record<string, { bg: string; color: string; label: string }> = {
  booking: { bg: '#dbeafe', color: '#1e3a8a', label: 'Viagem' },
  shipment: { bg: '#dcfce7', color: '#14532d', label: 'Encomenda' },
  dependent_shipment: { bg: '#ccfbf1', color: '#134e4a', label: 'Dependente' },
  excursion: { bg: '#ede9fe', color: '#4c1d95', label: 'Excursão' },
};

function entityBadge(entityType: string) {
  const meta = entityTypeStyles[entityType] ?? { bg: '#f1f1f1', color: '#444', label: entityType || '—' };
  return React.createElement('span', {
    style: {
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap' as const,
      background: meta.bg, color: meta.color, ...font,
    },
  }, meta.label);
}

function statusBadge(status: PixChargeStatus) {
  const st = statusBadgeStyles[status] ?? { bg: '#f1f1f1', color: '#444' };
  return React.createElement('span', {
    style: {
      display: 'inline-block', padding: '4px 12px', borderRadius: 999,
      fontSize: 12, fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap' as const,
      background: st.bg, color: st.color, ...font,
    },
  }, STATUS_LABELS[status] ?? status);
}

function fmtBRL(cents: number | null | undefined): string {
  const v = Number(cents);
  if (!Number.isFinite(v)) return '—';
  return (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** CPF só de dígitos → 000.000.000-00 (devolve o original se não tiver 11). */
function fmtCpf(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return String(raw ?? '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Telefone BR → (00) 00000-0000 / (00) 0000-0000. */
function fmtPhone(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(raw ?? '');
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const closeModalSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

const eyeSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const selectStyle: React.CSSProperties = {
  height: 40, borderRadius: 8, border: 'none', background: '#f1f1f1',
  padding: '0 36px 0 14px', fontSize: 14, color: '#0d0d0d', outline: 'none',
  boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const,
  cursor: 'pointer', ...font,
};

export default function PixGestaoScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'cobrancas' | 'devolucoes'>('cobrancas');

  // ── Cobranças ───────────────────────────────────────────────────────
  const [charges, setCharges] = useState<PixChargeRow[]>([]);
  const [chargesTotal, setChargesTotal] = useState(0);
  const [chargesLoading, setChargesLoading] = useState(true);
  const [chargesError, setChargesError] = useState<string | null>(null);
  const [chargesMissing, setChargesMissing] = useState(false);
  const [counts, setCounts] = useState<Record<PixChargeStatus, number> | null>(null);
  const [statusFilter, setStatusFilter] = useState<PixChargeStatus | 'all'>('all');
  const [providerFilter, setProviderFilter] = useState<PixRealProvider | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<PixChargeRow | null>(null);
  const [refundDetail, setRefundDetail] = useState<PixRefundRow | null>(null);
  // Consentimento de devolução: nada é gravado sem o operador marcar a caixa.
  const [resolveTarget, setResolveTarget] = useState<PixRefundRow | null>(null);
  const [resolveChecked, setResolveChecked] = useState(false);
  const [resolveNote, setResolveNote] = useState('');

  // ── Devoluções ──────────────────────────────────────────────────────
  const [refunds, setRefunds] = useState<PixRefundRow[]>([]);
  const [refundsLoading, setRefundsLoading] = useState(true);
  const [refundsError, setRefundsError] = useState<string | null>(null);
  const [refundsMissing, setRefundsMissing] = useState(false);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // ── Nomes de usuários + toast ───────────────────────────────────────
  const [names, setNames] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToastMsg(msg); }, []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const mergeNamesFor = useCallback(async (ids: (string | null)[]) => {
    const missing = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (missing.length === 0) return;
    const map = await fetchProfileNames(missing);
    if (Object.keys(map).length > 0) setNames((prev) => ({ ...prev, ...map }));
  }, []);

  const loadCharges = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setChargesLoading(true);
    const [res, countsRes] = await Promise.all([
      fetchPixCharges({
        status: statusFilter,
        provider: providerFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
      fetchPixChargeCounts(),
    ]);
    setCharges(res.rows);
    setChargesTotal(res.total);
    setChargesError(res.error);
    setChargesMissing(res.tableMissing);
    if (!countsRes.tableMissing && !countsRes.error) setCounts(countsRes.counts);
    setChargesLoading(false);
    void mergeNamesFor(res.rows.map((r) => r.user_id));
  }, [statusFilter, providerFilter, dateFrom, dateTo, page, mergeNamesFor]);

  const loadRefunds = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setRefundsLoading(true);
    const res = await fetchPixRefunds(includeResolved);
    setRefunds(res.rows);
    setRefundsError(res.error);
    setRefundsMissing(res.tableMissing);
    setRefundsLoading(false);
    void mergeNamesFor(res.rows.flatMap((r) => [r.user_id, r.resolved_by]));
  }, [includeResolved, mergeNamesFor]);

  useEffect(() => { void loadCharges(true); }, [loadCharges]);
  useEffect(() => { void loadRefunds(true); }, [loadRefunds]);

  // Realtime com debounce 450ms (padrão ViagensScreen) — só quando as tabelas existem.
  useEffect(() => {
    if (!isSupabaseConfigured || (chargesMissing && refundsMissing)) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadCharges(false);
        void loadRefunds(false);
      }, 450);
    };
    const channel = supabase
      .channel('admin-pix-gestao')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pix_charges' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pix_refunds_pending' }, scheduleRefetch)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [chargesMissing, refundsMissing, loadCharges, loadRefunds]);

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copiado!`);
    } catch {
      showToast('Não foi possível copiar');
    }
  }, [showToast]);

  // Abre o consentimento. O registro em si só acontece em confirmResolve,
  // depois de o operador marcar que a devolução JÁ foi feita no banco.
  const handleMarkResolved = useCallback((row: PixRefundRow) => {
    setResolveTarget(row);
    setResolveChecked(false);
    setResolveNote('');
  }, []);

  const confirmResolve = useCallback(async () => {
    const row = resolveTarget;
    if (!row || !resolveChecked) return;
    setResolvingId(row.id);
    const { error, alreadyResolved } = await markPixRefundResolved(row.id, resolveNote);
    setResolvingId(null);
    if (error) { showToast(`Erro: ${error}`); return; }
    setResolveTarget(null);
    showToast(alreadyResolved ? 'Esta devolução já havia sido confirmada' : 'Devolução registrada');
    void loadRefunds(false);
  }, [resolveTarget, resolveChecked, resolveNote, showToast, loadRefunds]);

  const userName = useCallback((userId: string | null) => {
    if (!userId) return '—';
    return names[userId] || `${userId.slice(0, 8)}…`;
  }, [names]);

  // ── Header ──────────────────────────────────────────────────────────
  const breadcrumb = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#767676', ...font },
  },
    React.createElement('span', null, 'Pagamentos'),
    React.createElement('span', null, '>'),
    React.createElement('span', { style: { fontWeight: 600, color: '#0d0d0d' } }, 'Pix'));

  const headerRow = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' as const, gap: 12 },
  },
    React.createElement('button', {
      type: 'button', onClick: () => navigate('/pagamentos'),
      style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 600, color: '#0d0d0d', padding: 0, ...font },
    },
      React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
        React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      'Voltar'));

  const title = React.createElement('h1', { style: { ...webStyles.homeTitle, margin: 0 } }, 'Gestão Pix');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: '0 0 auto',
    minWidth: 140,
    height: 48,
    padding: '14px 16px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    position: 'relative' as const,
    fontSize: 16,
    lineHeight: 1.5,
    ...font,
    fontWeight: active ? 600 : 400,
    color: active ? '#0d0d0d' : '#767676',
  });
  const tabUnderline = React.createElement('span', {
    style: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: 2, background: '#0d0d0d', borderRadius: 100 },
  });
  const refundsPendingCount = refunds.filter((r) => r.status === 'pending').length;
  const tabsRow = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'stretch', width: '100%' } },
      React.createElement('button', {
        type: 'button', style: tabStyle(tab === 'cobrancas'), onClick: () => setTab('cobrancas'),
      }, 'Cobranças', tab === 'cobrancas' ? tabUnderline : null),
      React.createElement('button', {
        type: 'button', style: tabStyle(tab === 'devolucoes'), onClick: () => setTab('devolucoes'),
      },
        `Devoluções${refundsPendingCount > 0 ? ` (${refundsPendingCount})` : ''}`,
        tab === 'devolucoes' ? tabUnderline : null)),
    React.createElement('div', { style: { height: 1, width: '100%', background: '#e2e2e2', marginTop: 0 } }));

  // ── Banner de degradação ────────────────────────────────────────────
  const activeMissing = tab === 'cobrancas' ? chargesMissing : refundsMissing;
  const degradedBanner = activeMissing
    ? React.createElement('div', {
        style: {
          background: '#fff8e6', border: '1px solid #cba04b', borderRadius: 12,
          padding: '14px 18px', width: '100%', boxSizing: 'border-box' as const,
        },
      },
        React.createElement('p', { style: { margin: 0, fontSize: 13, fontWeight: 700, color: '#5f4510', ...font } },
          'Backend Pix ainda não publicado neste ambiente'),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 12, color: '#5f4510', lineHeight: 1.5, ...font } },
          'As tabelas pix_charges/pix_refunds_pending ainda não existem. Esta tela passa a funcionar automaticamente assim que as migrations do gestor de provedores Pix forem aplicadas.'))
    : null;

  // ── Cobranças: chips de contagem ────────────────────────────────────
  const chipEl = (label: string, active: boolean, onClick: () => void, opts?: { count?: number; attention?: boolean }) => {
    const count = opts?.count;
    const attention = Boolean(opts?.attention && (count ?? 0) > 0);
    return React.createElement('button', {
      key: label, type: 'button', onClick,
      style: {
        height: 40, padding: '0 16px', borderRadius: 90,
        border: attention && !active ? '1.5px solid #b91c1c' : 'none',
        cursor: 'pointer',
        background: active ? '#0d0d0d' : attention ? '#fee2e2' : '#f1f1f1',
        color: active ? '#fff' : attention ? '#b91c1c' : '#0d0d0d',
        fontSize: 14, fontWeight: attention ? 700 : 500, lineHeight: 1.5,
        whiteSpace: 'nowrap' as const, ...font,
      },
    }, count == null ? label : `${label} (${count})`);
  };

  const totalCount = counts ? PIX_CHARGE_STATUSES.reduce((s, k) => s + counts[k], 0) : undefined;
  const statusChips = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 10, width: '100%' } },
    chipEl('Todas', statusFilter === 'all', () => { setStatusFilter('all'); setPage(1); }, { count: totalCount }),
    ...PIX_CHARGE_STATUSES.map((s) =>
      chipEl(STATUS_LABELS[s], statusFilter === s, () => { setStatusFilter(s); setPage(1); }, {
        count: counts ? counts[s] : undefined,
        attention: ATTENTION_STATUSES.includes(s),
      })));

  // ── Cobranças: filtros provedor/período ─────────────────────────────
  const dateInputStyle: React.CSSProperties = {
    height: 40, borderRadius: 8, border: 'none', background: '#f1f1f1',
    padding: '0 12px', fontSize: 14, color: '#0d0d0d', outline: 'none',
    boxSizing: 'border-box' as const, ...font,
  };
  const filterRow = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 12, alignItems: 'center', width: '100%' } },
    React.createElement('div', { style: { position: 'relative' as const } },
      React.createElement('select', {
        value: providerFilter,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { setProviderFilter(e.target.value as PixRealProvider | 'all'); setPage(1); },
        style: selectStyle,
      },
        React.createElement('option', { value: 'all' }, 'Todos os provedores'),
        React.createElement('option', { value: 'asaas' }, 'Asaas'),
        React.createElement('option', { value: 'bradesco' }, 'Bradesco')),
      React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
        React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
    React.createElement('label', { style: { fontSize: 13, color: '#767676', ...font } }, 'De'),
    React.createElement('input', {
      type: 'date', value: dateFrom,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setDateFrom(e.target.value); setPage(1); },
      style: dateInputStyle,
    }),
    React.createElement('label', { style: { fontSize: 13, color: '#767676', ...font } }, 'até'),
    React.createElement('input', {
      type: 'date', value: dateTo,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setDateTo(e.target.value); setPage(1); },
      style: dateInputStyle,
    }),
    (dateFrom || dateTo || providerFilter !== 'all' || statusFilter !== 'all')
      ? React.createElement('button', {
          type: 'button',
          onClick: () => { setDateFrom(''); setDateTo(''); setProviderFilter('all'); setStatusFilter('all'); setPage(1); },
          style: {
            height: 40, padding: '0 14px', borderRadius: 999, border: '1px solid #d9d9d9',
            background: '#fff', color: '#0d0d0d', fontSize: 13, fontWeight: 500, cursor: 'pointer', ...font,
          },
        }, 'Limpar filtros')
      : null);

  // ── Cobranças: tabela ───────────────────────────────────────────────
  const chargeCols = [
    { label: 'Criada em', flex: '0 0 120px', minWidth: 120 },
    { label: 'Usuário', flex: '1 1 18%', minWidth: 140 },
    { label: 'Tipo', flex: '0 0 110px', minWidth: 110 },
    { label: 'Provedor', flex: '0 0 110px', minWidth: 110 },
    { label: 'Valor', flex: '0 0 120px', minWidth: 120 },
    { label: 'Status', flex: '0 0 140px', minWidth: 140 },
    { label: 'Expira / paga em', flex: '0 0 130px', minWidth: 130 },
    { label: 'Detalhe', flex: '0 0 70px', minWidth: 70 },
  ];
  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 13, color: '#0d0d0d', ...font, padding: '0 6px' };

  const chargeHeader = React.createElement('div', {
    style: { display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', alignItems: 'center' },
  }, ...chargeCols.map((c) => React.createElement('div', {
    key: c.label,
    style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%' },
  }, c.label)));

  const chargeRowEls = charges.map((row) => React.createElement('div', {
    key: row.id,
    'data-testid': 'pix-charge-table-row',
    style: {
      display: 'flex', minHeight: 60, alignItems: 'center', padding: '8px 16px',
      borderBottom: '1px solid #d9d9d9', background: '#f6f6f6',
    },
  },
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[0].flex, minWidth: chargeCols[0].minWidth } }, fmtDateTime(row.created_at)),
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[1].flex, minWidth: chargeCols[1].minWidth, fontWeight: 500 } }, userName(row.user_id)),
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[2].flex, minWidth: chargeCols[2].minWidth } }, entityBadge(row.entity_type)),
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[3].flex, minWidth: chargeCols[3].minWidth, flexDirection: 'column' as const, alignItems: 'flex-start', gap: 2 } },
      React.createElement('span', { style: { fontWeight: 500, textTransform: 'capitalize' as const } }, row.provider),
      row.provider_env === 'sandbox'
        ? React.createElement('span', { style: { fontSize: 10, fontWeight: 700, color: '#654c01', background: '#fee59a', padding: '1px 8px', borderRadius: 999, ...font } }, 'sandbox')
        : null),
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[4].flex, minWidth: chargeCols[4].minWidth, flexDirection: 'column' as const, alignItems: 'flex-start', gap: 2 } },
      React.createElement('span', null, fmtBRL(row.expected_amount_cents)),
      row.status === 'amount_mismatch' && row.paid_amount_cents != null
        ? React.createElement('span', { style: { fontSize: 11, color: '#b91c1c', fontWeight: 600, ...font } }, `pago: ${fmtBRL(row.paid_amount_cents)}`)
        : null),
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[5].flex, minWidth: chargeCols[5].minWidth } }, statusBadge(row.status)),
    React.createElement('div', { style: { ...cellBase, flex: chargeCols[6].flex, minWidth: chargeCols[6].minWidth } },
      row.status === 'paid' || row.paid_at ? fmtDateTime(row.paid_at) : fmtDateTime(row.expires_at)),
    React.createElement('div', { style: { flex: chargeCols[7].flex, minWidth: chargeCols[7].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      React.createElement('button', {
        type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Ver detalhe da cobrança',
        onClick: () => setDetail(row),
      }, eyeSvg))));

  const totalPages = Math.max(1, Math.ceil(chargesTotal / PAGE_SIZE));
  const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
    height: 36, padding: '0 16px', borderRadius: 999, border: '1px solid #d9d9d9',
    background: '#fff', color: disabled ? '#b0b0b0' : '#0d0d0d', fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer', ...font,
  });
  const paginationRow = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', flexWrap: 'wrap' as const, gap: 8 },
  },
    React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } },
      `Página ${page} de ${totalPages} — ${chargesTotal} cobrança(s)`),
    React.createElement('div', { style: { display: 'flex', gap: 8 } },
      React.createElement('button', {
        type: 'button', disabled: page <= 1, onClick: () => setPage((p) => Math.max(1, p - 1)),
        style: pageBtnStyle(page <= 1),
      }, 'Anterior'),
      React.createElement('button', {
        type: 'button', disabled: page >= totalPages, onClick: () => setPage((p) => Math.min(totalPages, p + 1)),
        style: pageBtnStyle(page >= totalPages),
      }, 'Próxima')));

  const chargesTable = React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', border: '1px solid #e2e2e2' } },
    React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } },
      chargeHeader,
      ...chargeRowEls,
      charges.length === 0
        ? React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', fontSize: 14, ...font } },
            chargesMissing ? 'Sem dados — backend Pix não publicado.' : 'Nenhuma cobrança Pix encontrada.')
        : null),
    charges.length > 0 ? paginationRow : null);

  const cobrancasContent = chargesLoading
    ? [React.createElement('div', { key: 'loading', style: { display: 'flex', justifyContent: 'center', padding: 64 } },
        React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando cobranças Pix...'))]
    : [
        statusChips,
        filterRow,
        chargesError
          ? React.createElement('p', { key: 'err', style: { margin: 0, color: '#b53838', fontSize: 13, ...font } }, chargesError)
          : null,
        chargesTable,
      ];

  // ── Devoluções ──────────────────────────────────────────────────────
  const refundWarning = React.createElement('div', {
    style: {
      background: '#fff8e6', border: '1px solid #cba04b', borderRadius: 12,
      padding: '12px 16px', width: '100%', boxSizing: 'border-box' as const,
    },
  },
    React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#5f4510', lineHeight: 1.5, ...font } },
      'Esta fila apenas CONTROLA O TRABALHO de devolução manual — nenhuma ação aqui move dinheiro. ' +
      'Faça o Pix de devolução pelo banco e depois marque a linha como devolvida.'));

  const resolvedToggle = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
    React.createElement('button', {
      type: 'button',
      onClick: () => setIncludeResolved((v) => !v),
      style: {
        width: 52, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
        background: includeResolved ? '#22c55e' : '#d9d9d9', position: 'relative' as const,
        transition: 'background 0.2s',
      },
    },
      React.createElement('span', {
        style: {
          width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block',
          position: 'absolute' as const, top: 3, left: includeResolved ? 27 : 3, transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        },
      })),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Mostrar resolvidas'));

  const refundCols = [
    { label: 'Criada em', flex: '0 0 120px', minWidth: 120 },
    { label: 'Usuário', flex: '1 1 18%', minWidth: 140 },
    { label: 'Tipo', flex: '0 0 110px', minWidth: 110 },
    { label: 'Motivo', flex: '0 0 170px', minWidth: 170 },
    { label: 'Valor', flex: '0 0 110px', minWidth: 110 },
    { label: 'Status', flex: '0 0 110px', minWidth: 110 },
    { label: 'Ações', flex: '0 0 190px', minWidth: 190 },
  ];

  const refundHeader = React.createElement('div', {
    style: { display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', alignItems: 'center' },
  }, ...refundCols.map((c) => React.createElement('div', {
    key: c.label,
    style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%' },
  }, c.label)));

  const refundRowEls = refunds.map((row) => {
    const st = refundStatusStyles[row.status] ?? refundStatusStyles.pending;
    return React.createElement('div', {
      key: row.id,
      'data-testid': 'pix-refund-table-row',
      style: {
        display: 'flex', minHeight: 60, alignItems: 'center', padding: '8px 16px',
        borderBottom: '1px solid #d9d9d9', background: '#f6f6f6',
      },
    },
      React.createElement('div', { style: { ...cellBase, flex: refundCols[0].flex, minWidth: refundCols[0].minWidth } }, fmtDateTime(row.created_at)),
      React.createElement('div', { style: { ...cellBase, flex: refundCols[1].flex, minWidth: refundCols[1].minWidth, fontWeight: 500 } }, userName(row.user_id)),
      React.createElement('div', { style: { ...cellBase, flex: refundCols[2].flex, minWidth: refundCols[2].minWidth } }, entityBadge(row.entity_type)),
      React.createElement('div', { style: { ...cellBase, flex: refundCols[3].flex, minWidth: refundCols[3].minWidth } }, REASON_LABELS[row.reason] ?? row.reason),
      React.createElement('div', { style: { ...cellBase, flex: refundCols[4].flex, minWidth: refundCols[4].minWidth, fontWeight: 600 } }, fmtBRL(row.amount_cents)),
      React.createElement('div', { style: { ...cellBase, flex: refundCols[5].flex, minWidth: refundCols[5].minWidth } },
        React.createElement('span', {
          style: {
            display: 'inline-block', padding: '4px 12px', borderRadius: 999,
            fontSize: 12, fontWeight: 700, background: st.bg, color: st.color, whiteSpace: 'nowrap' as const, ...font,
          },
        }, st.label)),
      React.createElement('div', { style: { ...cellBase, flex: refundCols[6].flex, minWidth: refundCols[6].minWidth } },
        row.status === 'pending'
          ? React.createElement('button', {
              type: 'button',
              disabled: resolvingId === row.id,
              onClick: () => handleMarkResolved(row),
              style: {
                height: 36, padding: '0 14px', borderRadius: 999, border: 'none',
                background: '#0d0d0d', color: '#fff', fontSize: 12, fontWeight: 600,
                cursor: resolvingId === row.id ? 'wait' : 'pointer',
                opacity: resolvingId === row.id ? 0.6 : 1, ...font,
              },
            }, resolvingId === row.id ? 'Salvando...' : 'Marcar como devolvido')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, fontSize: 12, color: '#767676', ...font } },
              React.createElement('span', null, row.resolved_at ? fmtDateTime(row.resolved_at) : '—'),
              row.resolved_by
                ? React.createElement('span', { style: { fontSize: 11 } }, `por ${userName(row.resolved_by)}`)
                : null),
        React.createElement('button', {
          type: 'button',
          onClick: () => setRefundDetail(row),
          style: {
            height: 36, padding: '0 14px', marginLeft: 8, borderRadius: 999,
            border: '1px solid #d9d9d9', background: '#fff', color: '#0d0d0d',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Detalhes')));
  });

  const refundsTable = React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', border: '1px solid #e2e2e2' } },
    React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } },
      refundHeader,
      ...refundRowEls,
      refunds.length === 0
        ? React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', fontSize: 14, ...font } },
            refundsMissing ? 'Sem dados — backend Pix não publicado.' : 'Nenhuma devolução na fila.')
        : null));

  const devolucoesContent = refundsLoading
    ? [React.createElement('div', { key: 'loading', style: { display: 'flex', justifyContent: 'center', padding: 64 } },
        React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando devoluções Pix...'))]
    : [
        refundWarning,
        resolvedToggle,
        refundsError
          ? React.createElement('p', { key: 'err', style: { margin: 0, color: '#b53838', fontSize: 13, ...font } }, refundsError)
          : null,
        refundsTable,
      ];

  // ── Modal de detalhe da cobrança ────────────────────────────────────
  const detailField = (label: string, value: React.ReactNode) =>
    React.createElement('div', { key: label, style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, label),
      typeof value === 'string'
        ? React.createElement('span', { style: { fontSize: 15, color: '#0d0d0d', wordBreak: 'break-all' as const, ...font } }, value)
        : value);

  const copyableValue = (value: string | null, label: string) => value
    ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
        React.createElement('span', {
          style: {
            fontSize: 13, color: '#0d0d0d', fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            background: '#f1f1f1', borderRadius: 6, padding: '4px 8px', wordBreak: 'break-all' as const,
          },
        }, value),
        React.createElement('button', {
          type: 'button', onClick: () => copyText(value, label),
          style: {
            height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid #d9d9d9',
            background: '#fff', color: '#0d0d0d', fontSize: 12, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Copiar'))
    : React.createElement('span', { style: { fontSize: 15, color: '#767676', ...font } }, '—');

  const detailModal = detail
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: {
          position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        },
        onClick: () => setDetail(null),
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
            display: 'flex', flexDirection: 'column' as const, gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,.15)', maxHeight: '90vh', overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Detalhe da cobrança'),
            React.createElement('button', {
              type: 'button', onClick: () => setDetail(null), 'aria-label': 'Fechar',
              style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
            }, closeModalSvg)),
          React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const } },
            statusBadge(detail.status),
            entityBadge(detail.entity_type),
            detail.provider_env === 'sandbox'
              ? React.createElement('span', { style: { fontSize: 11, fontWeight: 700, color: '#654c01', background: '#fee59a', padding: '2px 10px', borderRadius: 999, ...font } }, 'sandbox')
              : null),
          detailField('ID interno (pix_charges)', copyableValue(detail.id, 'ID interno')),
          detailField('ID no provedor (provider_charge_id)', copyableValue(detail.provider_charge_id, 'ID no provedor')),
          detailField('Provedor', `${detail.provider}${detail.provider_env ? ` (${detail.provider_env})` : ''}`),
          detailField('Usuário', userName(detail.user_id)),
          detailField('Pedido (entity_id)', copyableValue(detail.entity_id, 'ID do pedido')),
          detailField('Valor esperado', fmtBRL(detail.expected_amount_cents)),
          detail.paid_amount_cents != null ? detailField('Valor pago', fmtBRL(detail.paid_amount_cents)) : null,
          detailField('Criada em', fmtDateTime(detail.created_at)),
          detailField('Expira em', fmtDateTime(detail.expires_at)),
          detail.paid_at ? detailField('Paga em', fmtDateTime(detail.paid_at)) : null,
          detail.failure_reason ? detailField('Motivo da falha', detail.failure_reason) : null,
          detail.qr_payload ? detailField('Copia-e-cola', copyableValue(detail.qr_payload, 'Copia-e-cola')) : null))
    : null;

  // ── Toast (padrão ViagemEditScreen) ─────────────────────────────────
  const checkCircleSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 12, cy: 12, r: 11, fill: '#fff' }),
    React.createElement('path', { d: 'M9 12l2 2 4-4', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const toastEl = toastMsg
    ? React.createElement('div', {
        key: toastMsg,
        style: {
          position: 'fixed' as const, bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: '#0d0d0d', borderRadius: 12, padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: 12, zIndex: 10000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', whiteSpace: 'nowrap' as const,
        },
      },
        checkCircleSvg,
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#fff', ...font } }, toastMsg))
    : null;

  const content = tab === 'cobrancas' ? cobrancasContent : devolucoesContent;

  // ── Modal de consentimento da devolução ─────────────────────────────
  // Esta tela NÃO move dinheiro: o Pix de volta é feito no banco, por fora.
  // Confirmar aqui é uma declaração do operador de que já fez — por isso a
  // caixa de consentimento explícita (um clique só, como era antes, deixava
  // fácil fechar a pendência de um valor que ninguém devolveu) e por isso
  // fica registrado quem confirmou e quando.
  const resolveModal = resolveTarget
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: {
          position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        },
        onClick: () => { if (!resolvingId) setResolveTarget(null); },
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, padding: '28px 32px',
            display: 'flex', flexDirection: 'column' as const, gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,.15)', maxHeight: '90vh', overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Confirmar devolução'),
            React.createElement('button', {
              type: 'button', onClick: () => setResolveTarget(null), 'aria-label': 'Fechar', disabled: Boolean(resolvingId),
              style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
            }, closeModalSvg)),
          React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),

          React.createElement('div', {
            style: { background: '#fff8e1', border: '1px solid #f0d68a', borderRadius: 12, padding: '14px 16px', fontSize: 13, lineHeight: 1.5, color: '#654c01', ...font },
          },
            React.createElement('strong', null, 'Esta ação não move dinheiro.'),
            ' Ela apenas registra que o Pix de devolução já foi feito por fora do sistema. Faça a devolução pelo banco antes de confirmar aqui.'),

          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
            detailField('Valor a devolver', React.createElement('span', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', ...font } }, fmtBRL(resolveTarget.amount_cents))),
            detailField('Pagador', resolveTarget.payer_name || userName(resolveTarget.user_id)),
            detailField('Motivo', REASON_LABELS[resolveTarget.reason] ?? resolveTarget.reason),
            detailField('Chave Pix / CPF', resolveTarget.payer_cpf ? fmtCpf(resolveTarget.payer_cpf) : '—')),

          detailField('Cobrança no provedor', copyableValue(resolveTarget.provider_charge_id ?? null, 'Id da cobrança')),

          React.createElement('label', {
            style: {
              display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
              background: '#f6f6f6', borderRadius: 12, padding: '14px 16px',
            },
          },
            React.createElement('input', {
              type: 'checkbox', checked: resolveChecked,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setResolveChecked(e.target.checked),
              style: { width: 18, height: 18, marginTop: 1, cursor: 'pointer', flexShrink: 0 },
            }),
            React.createElement('span', { style: { fontSize: 13, lineHeight: 1.5, color: '#0d0d0d', ...font } },
              `Confirmo que já devolvi ${fmtBRL(resolveTarget.amount_cents)} a este passageiro por fora do sistema.`)),

          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
            React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Observação (opcional) — ex.: comprovante, conta usada'),
            React.createElement('textarea', {
              value: resolveNote,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setResolveNote(e.target.value),
              rows: 2, maxLength: 300,
              style: {
                width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const,
                padding: '10px 12px', borderRadius: 10, border: '1px solid #d9d9d9',
                fontSize: 13, color: '#0d0d0d', ...font,
              },
            })),

          React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end' } },
            React.createElement('button', {
              type: 'button', onClick: () => setResolveTarget(null), disabled: Boolean(resolvingId),
              style: {
                height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid #d9d9d9',
                background: '#fff', color: '#0d0d0d', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font,
              },
            }, 'Cancelar'),
            React.createElement('button', {
              type: 'button', onClick: () => { void confirmResolve(); },
              disabled: !resolveChecked || Boolean(resolvingId),
              style: {
                height: 40, padding: '0 18px', borderRadius: 999, border: 'none',
                background: resolveChecked && !resolvingId ? '#0d0d0d' : '#c4c4c4',
                color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: resolveChecked && !resolvingId ? 'pointer' : 'not-allowed', ...font,
              },
            }, resolvingId ? 'Salvando...' : 'Confirmar devolução'))))
    : null;

  // ── Modal de detalhe da devolução ───────────────────────────────────
  // Reúne o que o financeiro precisa para devolver: id da cobrança no provedor
  // (leva direto ao estorno no painel), quem pagou e qual pedido originou.
  const refundDetailModal = refundDetail
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: {
          position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        },
        onClick: () => setRefundDetail(null),
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
            display: 'flex', flexDirection: 'column' as const, gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,.15)', maxHeight: '90vh', overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Detalhe da devolução'),
            React.createElement('button', {
              type: 'button', onClick: () => setRefundDetail(null), 'aria-label': 'Fechar',
              style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
            }, closeModalSvg)),
          React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),

          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' as const,
              background: '#f6f6f6', borderRadius: 12, padding: '14px 16px',
            },
          },
            React.createElement('span', { style: { fontSize: 26, fontWeight: 700, color: '#0d0d0d', ...font } }, fmtBRL(refundDetail.amount_cents)),
            React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } },
              REASON_LABELS[refundDetail.reason] ?? refundDetail.reason)),

          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
            detailField('Solicitada em', fmtDateTime(refundDetail.created_at)),
            detailField('Pago em', refundDetail.paid_at ? fmtDateTime(refundDetail.paid_at) : '—'),
            detailField('Pagador', refundDetail.payer_name || userName(refundDetail.user_id)),
            detailField('CPF do pagador', refundDetail.payer_cpf ? fmtCpf(refundDetail.payer_cpf) : '—'),
            detailField('Telefone', refundDetail.payer_phone ? fmtPhone(refundDetail.payer_phone) : '—'),
            detailField('Provedor', refundDetail.provider || '—')),

          React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
          detailField('Cobrança no provedor (buscar no painel para estornar)',
            copyableValue(refundDetail.provider_charge_id ?? null, 'Id da cobrança')),

          refundDetail.order_origin || refundDetail.order_destination
            ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
                React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
                detailField('Trajeto', `${refundDetail.order_origin ?? '—'} → ${refundDetail.order_destination ?? '—'}`),
                refundDetail.order_departure_at
                  ? detailField('Partida', fmtDateTime(refundDetail.order_departure_at))
                  : null)
            : null,

          refundDetail.notes
            ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
                React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
                detailField('Observação', refundDetail.notes))
            : null,

          refundDetail.resolved_at
            ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
                React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
                React.createElement('div', {
                  style: { background: '#e8f5e9', border: '1px solid #b7dfba', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: 12 },
                },
                  React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#1b5e20', ...font } }, 'Devolução confirmada'),
                  React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
                    detailField('Quando', fmtDateTime(refundDetail.resolved_at)),
                    detailField('Por quem', userName(refundDetail.resolved_by)))))
            : null,

          detailField('Id do pedido', copyableValue(refundDetail.entity_id ?? null, 'Id do pedido')))) 
    : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 20, width: '100%', alignSelf: 'stretch' } },
      breadcrumb,
      headerRow,
      title,
      tabsRow,
      degradedBanner,
      ...content.filter(Boolean)),
    detailModal,
    refundDetailModal,
    resolveModal,
    toastEl);
}
