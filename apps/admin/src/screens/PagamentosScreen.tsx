/**
 * PagamentosScreen — Pagamentos conforme Figma 905-15884.
 * Modal filtro da tabela: Figma 905-21772.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  webStyles,
  searchIconSvg,
  filterIconSvg,
} from '../styles/webStyles';
import { PAGAMENTOS_GESTAO_PREPARADORES_HREF } from '../constants/pagamentosGestaoNav';
import {
  fetchPagamentos,
  fetchPagamentoCounts,
  runProcessPayoutsDryRun,
  runProcessPayouts,
} from '../data/queries';
import type { ProcessPayoutsResult } from '../data/queries';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { PagamentoListItem, PagamentoCounts } from '../data/types';
import { exportPayoutsReport } from '../utils/exportCsv';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const calendarSvgLg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const closeModalSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

type PagPeriodoFiltro = 'semana' | 'mes' | 'ano';
type PagStatusFiltro = PagamentoListItem['status'];

function getPeriodRange(t: PagPeriodoFiltro): { start: Date; end: Date } {
  const now = new Date();
  if (t === 'semana') {
    const d = new Date(now);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }
  if (t === 'mes') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
}

function payoutDateInPeriod(iso: string, rangeStart: Date, rangeEnd: Date): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return t >= rangeStart.getTime() && t <= rangeEnd.getTime();
}

const chipFiltro = (label: string, selecionado: boolean, onClick: () => void) =>
  React.createElement('button', {
    type: 'button',
    onClick,
    style: {
      height: 40,
      padding: '0 16px',
      borderRadius: 90,
      border: 'none',
      cursor: 'pointer',
      background: selecionado ? '#0d0d0d' : '#f1f1f1',
      color: selecionado ? '#fff' : '#0d0d0d',
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 1.5,
      whiteSpace: 'nowrap' as const,
      ...font,
    },
  }, label);

function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const tableCols = [
  { label: '', flex: '0 0 40px', minWidth: 40 },
  { label: 'Profissional', flex: '1 1 20%', minWidth: 150 },
  { label: 'Tipo', flex: '0 0 120px', minWidth: 120 },
  { label: 'Transfer', flex: '0 0 140px', minWidth: 140 },
  { label: 'Valor bruto', flex: '0 0 130px', minWidth: 130 },
  { label: 'Data', flex: '0 0 110px', minWidth: 110 },
  { label: 'Status', flex: '0 0 130px', minWidth: 130 },
];

const statusStyles: Record<string, { bg: string; color: string }> = {
  'Em andamento': { bg: '#fee59a', color: '#654c01' },
  'Agendado': { bg: '#a8c6ef', color: '#102d57' },
  'Cancelado': { bg: '#eeafaa', color: '#551611' },
  'Concluído': { bg: '#b0e8d1', color: '#174f38' },
};

// Cor por entity_type para dar distincao visual em lote (booking vs shipment vs excursion).
const entityTypeStyles: Record<string, { bg: string; color: string; label: string }> = {
  booking: { bg: '#dbeafe', color: '#1e3a8a', label: 'Viagem' },
  shipment: { bg: '#dcfce7', color: '#14532d', label: 'Encomenda' },
  dependent_shipment: { bg: '#ccfbf1', color: '#134e4a', label: 'Dependente' },
  excursion: { bg: '#ede9fe', color: '#4c1d95', label: 'Excursão' },
};

function entityBadge(entityTypeRaw: string, fallbackLabel: string) {
  const meta = entityTypeStyles[entityTypeRaw] ?? { bg: '#f1f1f1', color: '#444', label: fallbackLabel };
  return React.createElement('span', {
    style: {
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap' as const,
      background: meta.bg, color: meta.color, ...font,
    },
  }, meta.label);
}

const s = {
  metricCard: {
    flex: '1 1 0', minWidth: 200, background: '#f6f6f6', borderRadius: 16,
    padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 8,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
};

type PagAppliedFiltro = {
  status: PagStatusFiltro;
  periodo: PagPeriodoFiltro;
  dataIni?: string;
  dataFim?: string;
};

export default function PagamentosScreen() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pagamentos, setPagamentos] = useState<PagamentoListItem[]>([]);
  const [counts, setCounts] = useState<PagamentoCounts>({ pagamentosPrevistos: 0, pagamentosFeitos: 0, lucro: 0 });
  const [loading, setLoading] = useState(true);
  const [filtroModalOpen, setFiltroModalOpen] = useState(false);
  // ── Batch selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<'connect_release' | 'manual_pix_confirm'>('connect_release');
  const [dryRunPreview, setDryRunPreview] = useState<ProcessPayoutsResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [stuckPayouts, setStuckPayouts] = useState<Array<{
    payout_id: string;
    worker_id: string;
    subtype: string | null;
    entity_type: string;
    worker_amount_cents: number;
    status: string;
    created_at: string;
  }>>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const refetchAll = useCallback(async () => {
    const [items, c] = await Promise.all([fetchPagamentos(), fetchPagamentoCounts()]);
    setPagamentos(items);
    setCounts(c);
    setSelectedIds(new Set());
  }, []);
  const [filtroTabelaAtivo, setFiltroTabelaAtivo] = useState(false);
  const [appliedFiltro, setAppliedFiltro] = useState<PagAppliedFiltro>({
    status: 'Concluído',
    periodo: 'mes',
  });
  const [draftStatus, setDraftStatus] = useState<PagStatusFiltro>('Concluído');
  const [draftPeriodo, setDraftPeriodo] = useState<PagPeriodoFiltro>('mes');
  const [draftDataIni, setDraftDataIni] = useState('');
  const [draftDataFim, setDraftDataFim] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPagamentos(), fetchPagamentoCounts()]).then(([items, c]) => {
      if (!cancelled) { setPagamentos(items); setCounts(c); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  // View admin_shipment_payouts_stuck: payouts de shipment/excursion com
  // mais de 3 dias pendentes/processing. Sinal para alertar sobre dinheiro
  // retido na plataforma (opcao B de arquitetura — charge-shipments e
  // charge-excursion-request cobram centralizado; process-payouts precisa
  // rodar para liberar via stripe.transfers.create).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (supabase as any)
      .from('admin_shipment_payouts_stuck')
      .select('payout_id, worker_id, subtype, entity_type, worker_amount_cents, status, created_at')
      .order('created_at', { ascending: true })
      .limit(50)
      .then(({ data, error }: any) => {
        if (cancelled) return;
        if (error) {
          // View pode nao existir em ambientes nao migrados ainda — ignorar silenciosamente.
          console.warn('[PagamentosScreen] admin_shipment_payouts_stuck indisponivel:', error.message);
          return;
        }
        setStuckPayouts(data ?? []);
      });
    return () => { cancelled = true; };
  }, []);

  const abrirFiltroModal = useCallback(() => {
    if (filtroTabelaAtivo) {
      setDraftStatus(appliedFiltro.status);
      setDraftPeriodo(appliedFiltro.periodo);
      setDraftDataIni(appliedFiltro.dataIni ?? '');
      setDraftDataFim(appliedFiltro.dataFim ?? '');
    } else {
      setDraftStatus('Concluído');
      setDraftPeriodo('mes');
      setDraftDataIni('');
      setDraftDataFim('');
    }
    setFiltroModalOpen(true);
  }, [filtroTabelaAtivo, appliedFiltro]);

  const fecharFiltroModal = useCallback(() => setFiltroModalOpen(false), []);

  const aplicarFiltroModal = useCallback(() => {
    setAppliedFiltro({
      status: draftStatus,
      periodo: draftPeriodo,
      dataIni: draftDataIni.trim() || undefined,
      dataFim: draftDataFim.trim() || undefined,
    });
    setFiltroTabelaAtivo(true);
    setFiltroModalOpen(false);
  }, [draftStatus, draftPeriodo, draftDataIni, draftDataFim]);

  useEffect(() => {
    if (!filtroModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharFiltroModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtroModalOpen, fecharFiltroModal]);

  const filteredRows = useMemo(() => {
    return pagamentos.filter((r) => {
      if (search) {
        const s = search.toLowerCase();
        if (!r.workerName.toLowerCase().includes(s) && !r.entityType.toLowerCase().includes(s)) return false;
      }
      if (!filtroTabelaAtivo) return true;
      if (r.status !== appliedFiltro.status) return false;
      const { start, end } = getPeriodRange(appliedFiltro.periodo);
      if (!payoutDateInPeriod(r.dateAtIso, start, end)) return false;
      if (appliedFiltro.dataIni) {
        const q = appliedFiltro.dataIni.toLowerCase();
        if (!r.dataFinalizacao.toLowerCase().includes(q)) return false;
      }
      if (appliedFiltro.dataFim) {
        const q = appliedFiltro.dataFim.toLowerCase();
        if (!r.dataFinalizacao.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [pagamentos, search, filtroTabelaAtivo, appliedFiltro]);

  // KPIs reativos aos filtros
  const filteredPrevistos = filteredRows.reduce((s, r) => s + r.grossAmountCents, 0);
  const filteredFeitos = filteredRows.filter((r) => r.status === 'Concluído').reduce((s, r) => s + r.workerAmountCents, 0);
  const filteredLucro = filteredRows.filter((r) => r.status === 'Concluído').reduce((s, r) => s + r.adminAmountCents, 0);
  const pendingCount = filteredRows.filter((p) => p.status === 'Agendado').length;

  const pctVsOrig = (filtered: number, original: number) => {
    if (original === 0) return filtered > 0 ? '+100%' : '';
    const pct = Math.round(((filtered - original) / original) * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  };

  const metrics = [
    { title: 'Pagamentos previstos', value: fmtBRL(filteredPrevistos), pct: pctVsOrig(filteredPrevistos, counts.pagamentosPrevistos), desc: 'vs período anterior' },
    { title: 'Pagamentos feitos', value: fmtBRL(filteredFeitos), pct: pctVsOrig(filteredFeitos, counts.pagamentosFeitos), desc: 'vs período anterior' },
    { title: 'Lucro', value: fmtBRL(filteredLucro), pct: pctVsOrig(filteredLucro, counts.lucro), desc: 'vs período anterior', negative: filteredLucro <= 0 },
    { title: 'Aguardando liberação', value: String(pendingCount), pct: '', desc: 'pagamentos pendentes', negative: pendingCount > 0, isCount: true },
  ];

  const inputTabelaStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 16,
    fontWeight: 400,
    color: '#0d0d0d',
    padding: '0 16px',
    height: '100%',
    ...font,
  };

  const tituloSecaoModal18: React.CSSProperties = { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font };

  const campoDataPagamento = (rotulo: string, valor: string, onChange: (v: string) => void, placeholder: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%', gap: 0 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, rotulo),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, borderRadius: 8, background: '#f1f1f1', paddingLeft: 16, overflow: 'hidden', width: '100%', boxSizing: 'border-box' as const } },
        calendarSvgLg,
        React.createElement('input', {
          type: 'text',
          value: valor,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          placeholder,
          style: { ...inputTabelaStyle, color: valor ? '#0d0d0d' : '#767676' },
        })));

  const overlayModalStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    boxSizing: 'border-box',
  };

  const filtroTabelaModal = filtroModalOpen
    ? React.createElement('div', {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'filtro-tabela-pagamentos-titulo',
      style: overlayModalStyle,
      onClick: fecharFiltroModal,
    },
      React.createElement('div', {
        style: {
          background: '#fff',
          borderRadius: 16,
          boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
          width: '100%',
          maxWidth: 420,
          maxHeight: '90vh',
          overflowY: 'auto' as const,
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 24,
          padding: '24px 0',
          boxSizing: 'border-box' as const,
        },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingLeft: 16, paddingRight: 16, width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('h2', { id: 'filtro-tabela-pagamentos-titulo', style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Filtro da tabela'),
            React.createElement('button', {
              type: 'button',
              onClick: fecharFiltroModal,
              'aria-label': 'Fechar',
              style: {
                width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, marginTop: -2,
              },
            }, closeModalSvg))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('span', { style: tituloSecaoModal18 }, 'Data da atividade'),
          campoDataPagamento('Data inicial', draftDataIni, setDraftDataIni, '05 de setembro'),
          campoDataPagamento('Data final', draftDataFim, setDraftDataFim, '30 de setembro')),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('span', { style: tituloSecaoModal18 }, 'Status da excursão'),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, alignItems: 'center' } },
            chipFiltro('Concluída', draftStatus === 'Concluído', () => setDraftStatus('Concluído')),
            chipFiltro('Agendada', draftStatus === 'Agendado', () => setDraftStatus('Agendado')),
            chipFiltro('Em andamento', draftStatus === 'Em andamento', () => setDraftStatus('Em andamento')),
            chipFiltro('Cancelada', draftStatus === 'Cancelado', () => setDraftStatus('Cancelado')))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('span', { style: tituloSecaoModal18 }, 'Período'),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, alignItems: 'center' } },
            chipFiltro('Esta semana', draftPeriodo === 'semana', () => setDraftPeriodo('semana')),
            chipFiltro('Este mês', draftPeriodo === 'mes', () => setDraftPeriodo('mes')),
            chipFiltro('Este ano', draftPeriodo === 'ano', () => setDraftPeriodo('ano')))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('button', {
            type: 'button',
            onClick: aplicarFiltroModal,
            style: {
              width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff',
              fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font,
            },
          }, 'Aplicar filtro'),
          React.createElement('button', {
            type: 'button',
            onClick: fecharFiltroModal,
            style: {
              width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'transparent', color: '#0d0d0d',
              fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font,
            },
          }, 'Voltar'))))
    : null;

  const title = React.createElement('h1', { style: webStyles.homeTitle }, 'Pagamentos');

  // ── Batch data & handlers (must be before searchRow) ───────────────────
  const pendingFilteredRows = filteredRows.filter((r) => r.status === 'Agendado');
  const allPendingSelected = pendingFilteredRows.length > 0 && pendingFilteredRows.every((r) => selectedIds.has(r.id));

  const handleSelectAllPending = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = pendingFilteredRows.map((r) => r.id);
      const next = new Set(prev);
      if (allPendingSelected) { ids.forEach((id) => next.delete(id)); } else { ids.forEach((id) => next.add(id)); }
      return next;
    });
  }, [pendingFilteredRows, allPendingSelected]);

  /**
   * Abre modal de confirmacao em modo "Connect release":
   * - Dispara dry_run para contar o que vai virar transfer/paid/manual.
   * - NAO passa mark_paid=true (deixa a edge criar stripe.transfers.create
   *   para quem tem Connect e marcar processing para quem nao tem).
   */
  const handleBatchRelease = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setConfirmMode('connect_release');
    setDryRunPreview(null);
    setDryRunLoading(true);
    setConfirmModalOpen(true);
    try {
      const { data, error } = await runProcessPayoutsDryRun([...selectedIds]);
      if (error) {
        showToast('❌ Dry-run falhou: ' + error);
      } else if (data?.processed) {
        setDryRunPreview(data.processed);
      }
    } finally {
      setDryRunLoading(false);
    }
  }, [selectedIds, showToast]);

  /**
   * Modo "Marcar pago manualmente" (PIX/banco). Valido SO para selecao
   * homogenea de linhas sem Stripe Connect. O botao que chama este handler
   * so aparece quando selectedNoConnect > 0 e selectedWithConnect === 0.
   */
  const handleBatchMarkPaid = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setConfirmMode('manual_pix_confirm');
    setDryRunPreview(null);
    setDryRunLoading(true);
    setConfirmModalOpen(true);
    try {
      const { data, error } = await runProcessPayoutsDryRun([...selectedIds]);
      if (error) {
        showToast('❌ Dry-run falhou: ' + error);
      } else if (data?.processed) {
        setDryRunPreview(data.processed);
      }
    } finally {
      setDryRunLoading(false);
    }
  }, [selectedIds, showToast]);

  const executeRelease = useCallback(async () => {
    setConfirmModalOpen(false);
    setBatchLoading(true);
    try {
      let receiptUrl: string | undefined;
      if (receiptFile) {
        const ext = receiptFile.name.split('.').pop() || 'jpg';
        const path = `receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await (supabase as any).storage
          .from('payout-receipts')
          .upload(path, receiptFile, { contentType: receiptFile.type, upsert: false });
        if (!upErr) {
          const { data: urlData } = (supabase as any).storage.from('payout-receipts').getPublicUrl(path);
          receiptUrl = urlData?.publicUrl;
        }
      }

      const markPaid = confirmMode === 'manual_pix_confirm';
      const { data, error } = await runProcessPayouts([...selectedIds], {
        mark_paid: markPaid,
        receipt_url: receiptUrl,
      });
      if (error) {
        showToast('❌ ' + error);
      } else if (data?.ok) {
        const p = data.processed || ({} as Partial<ProcessPayoutsResult>);
        if (markPaid) {
          showToast(`✅ ${p.manual_pix_paid || 0} pagamento(s) confirmado(s) manualmente`);
        } else {
          const tNew = p.stripe_connect_transfers_created || 0;
          const tOld = p.stripe_connect_auto_paid || 0;
          const mp = p.manual_pix_processing || 0;
          showToast(`✅ ${tNew} transfer(s), ${tOld} booking(s), ${mp} p/ PIX manual`);
          if (p.stripe_connect_transfers_failed && p.stripe_connect_transfers_failed > 0) {
            showToast(`⚠️ ${p.stripe_connect_transfers_failed} transfer(s) falhou — verifique coluna Transfer`);
          }
        }
      } else {
        showToast('❌ Erro ao liberar pagamentos');
      }
    } catch (e: any) {
      showToast('❌ ' + (e?.message || 'Erro ao liberar'));
    }
    setReceiptFile(null);
    setReceiptPreview(null);
    await refetchAll();
    setBatchLoading(false);
  }, [selectedIds, confirmMode, refetchAll, showToast, receiptFile]);

  const handleReleaseAll = useCallback(async () => {
    if (!confirm(
      'Liberar TODOS os pagamentos pendentes?\n\n' +
      '• Workers com Stripe Connect: será criado stripe.transfers.create automaticamente (entity_type ∈ shipment/excursion/dependent_shipment) ou apenas marcado paid (booking).\n' +
      '• Workers sem Connect: ficam em "processing" aguardando PIX manual.',
    )) return;
    setBatchLoading(true);
    try {
      const { data, error } = await runProcessPayouts([], { force: true });
      if (error) {
        showToast('❌ ' + error);
      } else if (data?.ok) {
        const p = data.processed || ({} as Partial<ProcessPayoutsResult>);
        const tNew = p.stripe_connect_transfers_created || 0;
        const tOld = p.stripe_connect_auto_paid || 0;
        const mp = p.manual_pix_processing || 0;
        showToast(`✅ ${tNew} transfer(s), ${tOld} booking(s), ${mp} p/ PIX manual`);
        if (p.stripe_connect_transfers_failed && p.stripe_connect_transfers_failed > 0) {
          showToast(`⚠️ ${p.stripe_connect_transfers_failed} transfer(s) falhou`);
        }
      } else {
        showToast('❌ Erro ao processar pagamentos');
      }
    } catch (e: any) {
      showToast('❌ ' + (e?.message || 'Erro ao processar'));
    }
    await refetchAll();
    setBatchLoading(false);
  }, [refetchAll, showToast]);

  const handleExportCsv = useCallback(async () => {
    setBatchLoading(true);
    try {
      const count = await exportPayoutsReport(pagamentos);
      if (count > 0) { showToast(`📥 Relatório exportado com ${count} profissional(is)`); }
      else { showToast('Nenhum pagamento pendente para exportar'); }
    } catch (e: any) {
      showToast('❌ ' + (e?.message || 'Erro ao exportar'));
    }
    setBatchLoading(false);
  }, [pagamentos, showToast]);

  // ── Search row ────────────────────────────────────────────────────────
  const actionBtnStyle = (bg: string, color: string, border?: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 16px',
    borderRadius: 10, border: border || 'none', background: bg, color,
    fontSize: 13, fontWeight: 600, cursor: batchLoading ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const, ...font,
    opacity: batchLoading ? 0.6 : 1,
    transition: 'opacity 0.15s',
  });

  const searchRow = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%' },
  },
    // Row 1: Search + filter + gestão
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 12, width: '100%' },
    },
      React.createElement('div', {
        style: {
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: '#f1f1f1', borderRadius: 999, height: 44, paddingLeft: 16, paddingRight: 16,
        },
      },
        searchIconSvg,
        React.createElement('input', {
          type: 'text', value: search, placeholder: 'Buscar por profissional, tipo...',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
          style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: '#0d0d0d', ...font },
        })),
      React.createElement('button', {
        type: 'button',
        onClick: abrirFiltroModal,
        'data-testid': 'pagamentos-open-table-filter',
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px',
          background: '#f1f1f1', border: 'none', borderRadius: 999,
          fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font,
        },
      }, filterIconSvg, 'Filtro'),
      React.createElement('button', {
        type: 'button',
        onClick: () => navigate(PAGAMENTOS_GESTAO_PREPARADORES_HREF),
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px',
          background: '#0d0d0d', color: '#fff', border: 'none', borderRadius: 999,
          fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, ...font,
        },
      }, 'Gestão de pagamentos')));

  // ── Selection bar (between KPIs and table) ─────────────────────────────
  // Particionamento da selecao por Stripe Connect — define quais botoes exibir.
  const selectedRows = pagamentos.filter((p) => selectedIds.has(p.id));
  const selectedWithConnectCount = selectedRows.filter((r) => r.workerHasConnect).length;
  const selectedNoConnectCount = selectedRows.length - selectedWithConnectCount;
  const mixedSelection = selectedWithConnectCount > 0 && selectedNoConnectCount > 0;

  const selectionBar = pendingFilteredRows.length > 0
    ? React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', flexWrap: 'wrap' as const },
      },
        React.createElement('button', {
          type: 'button', onClick: handleSelectAllPending,
          style: {
            ...actionBtnStyle('#fff', '#0d0d0d', '1.5px solid #e2e2e2'),
            background: allPendingSelected ? '#f5f5f5' : '#fff',
          },
        },
          React.createElement('div', {
            style: {
              width: 16, height: 16, borderRadius: 3,
              border: allPendingSelected ? 'none' : '2px solid #c4c4c4',
              background: allPendingSelected ? '#0d0d0d' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            },
          }, allPendingSelected
            ? React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'none' },
                React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round' }))
            : null),
          allPendingSelected ? 'Desmarcar todos' : `Selecionar pendentes (${pendingFilteredRows.length})`),

        // Aviso para selecao mista (Connect + sem Connect).
        mixedSelection
          ? React.createElement('span', {
              style: {
                fontSize: 12, color: '#b91c1c', fontWeight: 600, padding: '0 8px', ...font,
              },
            }, `Selecao mista: ${selectedWithConnectCount} com Connect + ${selectedNoConnectCount} sem Connect. Separe para liberar.`)
          : null,

        // Botao PRIMARIO: liberar via Stripe Connect (sem mark_paid) — apenas
        // quando todas as selecionadas tem Connect.
        selectedIds.size > 0 && !mixedSelection && selectedWithConnectCount === selectedIds.size
          ? React.createElement('button', {
              type: 'button', onClick: handleBatchRelease, disabled: batchLoading,
              style: actionBtnStyle('#22c55e', '#fff'),
            },
              React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
                React.createElement('path', { d: 'M22 2L11 13', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' }),
                React.createElement('path', { d: 'M22 2l-7 20-4-9-9-4z', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
              batchLoading ? 'Processando...' : `Liberar via Connect (${selectedIds.size})`)
          : null,

        // Botao SECUNDARIO: marcar pago manualmente — apenas quando todas as
        // selecionadas NAO tem Connect (fluxo PIX manual).
        selectedIds.size > 0 && !mixedSelection && selectedNoConnectCount === selectedIds.size
          ? React.createElement('button', {
              type: 'button', onClick: handleBatchMarkPaid, disabled: batchLoading,
              style: actionBtnStyle('#0d0d0d', '#fff'),
            },
              React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
                React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2.5, strokeLinecap: 'round' })),
              batchLoading ? 'Processando...' : `Confirmar pago (PIX/banco) (${selectedIds.size})`)
          : null,

        React.createElement('div', { style: { flex: 1 } }),

        // Liberar todos com force (atinge todos pendentes do banco, nao so filtrados).
        React.createElement('button', {
          type: 'button', onClick: handleReleaseAll, disabled: batchLoading,
          style: actionBtnStyle('#fff', '#b91c1c', '1.5px solid #fecaca'),
        },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
            React.createElement('path', { d: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z', stroke: '#b91c1c', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
          'Liberar todos pendentes (force)'),

        React.createElement('button', {
          type: 'button', onClick: handleExportCsv, disabled: batchLoading,
          style: actionBtnStyle('#fff', '#0d0d0d', '1.5px solid #e2e2e2'),
        },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
            React.createElement('path', { d: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }),
            React.createElement('polyline', { points: '7 10 12 15 17 10', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
            React.createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })),
          'Exportar relatório'))
    : null;

  // ── Alerta: payouts de shipment/excursion pendentes ha >3 dias ────────
  // Banner vermelho (severidade alta, conforme plano) com link "Ver lista"
  // que filtra a tabela por status Agendado/Em andamento.
  const stuckTotalCents = stuckPayouts.reduce((acc, p) => acc + (Number(p.worker_amount_cents) || 0), 0);
  const stuckBanner = stuckPayouts.length > 0
    ? React.createElement('div', {
        style: {
          display: 'flex', gap: 16, alignItems: 'flex-start',
          background: '#fee2e2', border: '1.5px solid #b91c1c', borderRadius: 12,
          padding: '16px 20px', width: '100%', boxSizing: 'border-box' as const,
        },
      },
        React.createElement('div', {
          style: {
            width: 40, height: 40, borderRadius: '50%', background: '#b91c1c',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          },
        },
          React.createElement('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
            React.createElement('path', { d: 'M12 9v4M12 17h.01', stroke: '#fff', strokeWidth: 2.5, strokeLinecap: 'round' }),
            React.createElement('path', {
              d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
              stroke: '#fff', strokeWidth: 2, strokeLinejoin: 'round',
            }))),
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', {
            style: { fontSize: 15, fontWeight: 700, color: '#7f1d1d', ...font },
          }, `Dinheiro retido: ${stuckPayouts.length} payout(s) de encomenda/excursão há mais de 3 dias`),
          React.createElement('span', {
            style: { fontSize: 13, color: '#991b1b', lineHeight: 1.5, ...font },
          }, `Total bruto: ${fmtBRL(stuckTotalCents)}. Liberação via process-payouts cria stripe.transfers.create para cada worker com Connect; sem Connect, marca processing para pagamento manual via PIX.`),
          React.createElement('button', {
            type: 'button',
            onClick: () => {
              setAppliedFiltro({ status: 'Agendado', periodo: 'mes' });
              setFiltroTabelaAtivo(true);
            },
            style: {
              alignSelf: 'flex-start', marginTop: 8,
              background: '#b91c1c', color: '#fff', border: 'none',
              borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', ...font,
            },
          }, 'Ver lista (filtrar por Agendado)')))
    : null;

  // ── Toast notification ─────────────────────────────────────────────────
  const toastEl = toast
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, top: 20, right: 20, zIndex: 9999,
          background: '#0d0d0d', color: '#fff', padding: '12px 24px', borderRadius: 12,
          fontSize: 14, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', ...font,
          animation: 'fadeIn 0.3s ease-out',
        },
      }, toast)
    : null;

  // ── Metrics ───────────────────────────────────────────────────────────
  const metricCards = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const },
  },
    ...metrics.map((m: any) =>
      React.createElement('div', { key: m.title, style: { ...s.metricCard, ...(m.isCount && pendingCount > 0 ? { border: '1px solid #fbbf24', background: '#fffbeb' } : {}) } },
        React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, m.title),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
          m.pct ? React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: m.negative ? '#b53838' : '#22c55e', ...font } }, m.pct) : null,
          React.createElement('span', { style: { fontSize: 12, color: m.negative ? '#b53838' : '#767676', ...font } }, m.desc)),
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: m.isCount && pendingCount > 0 ? '#b53838' : '#0d0d0d', margin: 0, ...font } }, m.value))));

  // ── Table ─────────────────────────────────────────────────────────────
  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font, padding: '0 6px' };

  const tableHeader = React.createElement('div', {
    style: {
      display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9',
      padding: '0 16px', alignItems: 'center',
    },
  },
    ...tableCols.map((c) => React.createElement('div', {
      key: c.label,
      style: {
        flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font,
        padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%', whiteSpace: 'pre-line' as const,
      },
    }, c.label)));

  const tableRowEls = filteredRows.map((row) => {
    const st = statusStyles[row.status];
    const isPending = row.status === 'Agendado';
    const isSelected = selectedIds.has(row.id);
    // Destaque visual quando transfer explicito (shipment/excursion) falhou.
    const hasTransferError = Boolean(row.stripeTransferError);
    const rowBg = hasTransferError ? '#fef2f2' : (isSelected ? '#f0fdf4' : '#fff');

    // Celula Transfer: verde (sucesso) | vermelho (erro) | cinza (booking sem transfer).
    let transferCell: React.ReactNode = '—';
    if (row.stripeTransferError) {
      transferCell = React.createElement('span', {
        title: row.stripeTransferError,
        style: {
          display: 'inline-block', padding: '3px 10px', borderRadius: 999,
          fontSize: 11, fontWeight: 700, color: '#7f1d1d', background: '#fee2e2',
          border: '1px solid #fecaca', cursor: 'help', ...font,
        },
      }, 'Erro');
    } else if (row.stripeTransferId) {
      const shortId = row.stripeTransferId.length > 14 ? `${row.stripeTransferId.slice(0, 10)}…` : row.stripeTransferId;
      transferCell = React.createElement('span', {
        title: row.stripeTransferAt ? `Criado em ${new Date(row.stripeTransferAt).toLocaleString('pt-BR')}` : row.stripeTransferId,
        style: {
          display: 'inline-block', padding: '3px 10px', borderRadius: 999,
          fontSize: 11, fontWeight: 600, color: '#14532d', background: '#dcfce7',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          cursor: 'help',
        },
      }, shortId);
    } else if (row.entityTypeRaw === 'booking' && row.statusRaw === 'paid') {
      // booking usa transfer_data no charge → nao precisa de transfer explicito.
      transferCell = React.createElement('span', {
        title: 'Booking: split feito via transfer_data no charge (sem transfer explícito).',
        style: { fontSize: 12, color: '#767676', fontStyle: 'italic' as const, cursor: 'help', ...font },
      }, 'no charge');
    }

    return React.createElement('div', {
      key: row.id,
      'data-testid': 'pagamento-table-row',
      style: {
        display: 'flex', minHeight: 64, alignItems: 'center', padding: '8px 16px',
        borderBottom: '1px solid #d9d9d9', background: rowBg,
      },
    },
      React.createElement('div', { style: { ...cellBase, flex: tableCols[0].flex, minWidth: tableCols[0].minWidth, justifyContent: 'center' } },
        isPending
          ? React.createElement('button', {
              type: 'button', onClick: () => toggleSelect(row.id),
              style: { width: 18, height: 18, borderRadius: 3, border: isSelected ? 'none' : '2px solid #d9d9d9', background: isSelected ? '#0d0d0d' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
            }, isSelected ? React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'none' },
              React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round' })) : null)
          : null),
      React.createElement('div', { style: { ...cellBase, flex: tableCols[1].flex, minWidth: tableCols[1].minWidth, fontWeight: 500, flexDirection: 'column' as const, alignItems: 'flex-start', gap: 2 } },
        React.createElement('span', null, row.workerName),
        !row.workerHasConnect
          ? React.createElement('span', {
              style: { fontSize: 10, color: '#b91c1c', fontWeight: 600, ...font },
            }, 'sem Stripe Connect')
          : null),
      React.createElement('div', { style: { ...cellBase, flex: tableCols[2].flex, minWidth: tableCols[2].minWidth } },
        entityBadge(row.entityTypeRaw, row.entityType)),
      React.createElement('div', { style: { ...cellBase, flex: tableCols[3].flex, minWidth: tableCols[3].minWidth } }, transferCell),
      React.createElement('div', { style: { ...cellBase, flex: tableCols[4].flex, minWidth: tableCols[4].minWidth } }, fmtBRL(row.grossAmountCents)),
      React.createElement('div', { style: { ...cellBase, flex: tableCols[5].flex, minWidth: tableCols[5].minWidth, whiteSpace: 'pre-line' as const, fontSize: 13, lineHeight: 1.4 } }, row.dataFinalizacao),
      React.createElement('div', { style: { ...cellBase, flex: tableCols[6].flex, minWidth: tableCols[6].minWidth } },
        React.createElement('span', {
          style: {
            display: 'inline-block', padding: '4px 12px', borderRadius: 999,
            fontSize: 13, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'nowrap' as const,
            background: st.bg, color: st.color, ...font,
          },
        }, row.status)));
  });

  const tableSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  },
    React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', border: '1px solid #e2e2e2' } },
      React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } },
        tableHeader,
        ...tableRowEls)));

  if (loading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando pagamentos...'));
  }

  const emptyMsg = filteredRows.length === 0
    ? React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', ...font } }, 'Nenhum pagamento encontrado.')
    : null;

  // ── Confirmation modal ──────────────────────────────────────────────────
  const selectedPayouts = pagamentos.filter((p) => selectedIds.has(p.id));
  const confirmTotalWorkerCents = selectedPayouts.reduce((s, p) => s + p.workerAmountCents, 0);
  const confirmTotalGrossCents = selectedPayouts.reduce((s, p) => s + p.grossAmountCents, 0);
  // Group by worker for summary
  const confirmByWorker: Record<string, { name: string; total: number; count: number }> = {};
  for (const p of selectedPayouts) {
    if (!confirmByWorker[p.workerId]) confirmByWorker[p.workerId] = { name: p.workerName, total: 0, count: 0 };
    confirmByWorker[p.workerId].total += p.workerAmountCents;
    confirmByWorker[p.workerId].count += 1;
  }

  // Linha de detalhamento do dry-run (aparece no modal antes de confirmar).
  const dryRunRow = (label: string, value: number | string, emphasis?: boolean) =>
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' } },
      React.createElement('span', { style: { fontSize: 13, color: '#444', ...font } }, label),
      React.createElement('span', { style: { fontSize: 14, fontWeight: emphasis ? 700 : 600, color: emphasis ? '#0d0d0d' : '#444', ...font } }, String(value)));

  const dryRunSection = dryRunLoading
    ? React.createElement('div', {
        style: { background: '#f8f9fa', borderRadius: 12, padding: '16px 20px', textAlign: 'center' as const, color: '#767676', fontSize: 13, ...font },
      }, 'Simulando liberação…')
    : dryRunPreview
      ? React.createElement('div', {
          style: { background: '#f8f9fa', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
        },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: '#0d0d0d', marginBottom: 4, ...font } }, 'Prévia (dry-run)'),
          dryRunRow('Connect — transfers a criar', dryRunPreview.stripe_connect_transfers_created, true),
          dryRunRow('Connect — bookings pagos no charge', dryRunPreview.stripe_connect_auto_paid),
          dryRunRow('Sem Connect — para PIX manual (processing)', dryRunPreview.manual_pix_processing),
          confirmMode === 'manual_pix_confirm'
            ? dryRunRow('Sem Connect — serão marcados paid', dryRunPreview.manual_pix_paid ?? 0, true)
            : null,
          dryRunPreview.below_threshold_skipped
            ? dryRunRow('Abaixo do limite — ignorados', dryRunPreview.below_threshold_skipped ?? 0)
            : null)
      : null;

  const confirmTitle = confirmMode === 'manual_pix_confirm'
    ? 'Confirmar pagamento manual (PIX/banco)'
    : 'Liberar via Stripe Connect';

  const confirmCtaLabel = confirmMode === 'manual_pix_confirm'
    ? (batchLoading ? 'Processando...' : 'Confirmar pago manualmente')
    : (batchLoading ? 'Processando...' : 'Liberar via Connect');

  const confirmHint = confirmMode === 'manual_pix_confirm'
    ? 'Use somente após efetuar o PIX/transferência manual fora do sistema. O registro será marcado como paid imediatamente.'
    : 'A função process-payouts cria stripe.transfers.create para shipments/excursions dos workers com Connect; bookings são marcados paid direto (split no charge).';

  const confirmModal = confirmModalOpen
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        },
        onClick: () => setConfirmModalOpen(false),
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, padding: '28px 32px',
            display: 'flex', flexDirection: 'column' as const, gap: 20,
            boxShadow: '0 20px 60px rgba(0,0,0,.18)', maxHeight: '80vh', overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, confirmTitle),
            React.createElement('button', {
              type: 'button', onClick: () => setConfirmModalOpen(false),
              style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
            },
              React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),

          // Resumo
          React.createElement('div', {
            style: { background: '#f8f9fa', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 },
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Total de pagamentos'),
              React.createElement('span', { style: { fontSize: 16, fontWeight: 700, color: '#0d0d0d', ...font } }, String(selectedPayouts.length))),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Valor bruto total'),
              React.createElement('span', { style: { fontSize: 16, fontWeight: 700, color: '#0d0d0d', ...font } }, fmtBRL(confirmTotalGrossCents))),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Valor a liberar (profissionais)'),
              React.createElement('span', { style: { fontSize: 20, fontWeight: 700, color: '#22c55e', ...font } }, fmtBRL(confirmTotalWorkerCents)))),

          dryRunSection,

          // Lista por profissional
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0 } },
            React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#767676', marginBottom: 8, ...font } }, 'Detalhamento por profissional'),
            ...Object.values(confirmByWorker).map((w) =>
              React.createElement('div', {
                key: w.name,
                style: {
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0', borderBottom: '1px solid #f0f0f0',
                },
              },
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
                  React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, w.name),
                  React.createElement('span', { style: { fontSize: 12, color: '#999', ...font } }, `${w.count} pagamento(s)`)),
                React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, fmtBRL(w.total))))),

          // Upload comprovante
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
            React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Comprovante de pagamento (opcional)'),
            React.createElement('label', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                height: 48, borderRadius: 10, border: '2px dashed #d9d9d9', cursor: 'pointer',
                background: receiptPreview ? '#f0fdf4' : '#fafafa', transition: 'background 0.15s',
              },
            },
              React.createElement('input', {
                type: 'file', accept: 'image/*,.pdf',
                style: { display: 'none' },
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setReceiptFile(file);
                    if (file.type.startsWith('image/')) {
                      const reader = new FileReader();
                      reader.onload = () => setReceiptPreview(reader.result as string);
                      reader.readAsDataURL(file);
                    } else {
                      setReceiptPreview(file.name);
                    }
                  }
                },
              }),
              receiptPreview
                ? React.createElement(React.Fragment, null,
                    React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
                      React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#22c55e', strokeWidth: 2, strokeLinecap: 'round' })),
                    React.createElement('span', { style: { fontSize: 13, color: '#22c55e', fontWeight: 500, ...font } },
                      receiptFile?.name || 'Comprovante selecionado'))
                : React.createElement(React.Fragment, null,
                    React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
                      React.createElement('path', { d: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', stroke: '#999', strokeWidth: 2, strokeLinecap: 'round' }),
                      React.createElement('polyline', { points: '17 8 12 3 7 8', stroke: '#999', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                      React.createElement('line', { x1: 12, y1: 3, x2: 12, y2: 15, stroke: '#999', strokeWidth: 2, strokeLinecap: 'round' })),
                    React.createElement('span', { style: { fontSize: 13, color: '#999', ...font } }, 'Anexar comprovante (imagem ou PDF)')))),

          React.createElement('p', {
            style: { fontSize: 12, color: '#999', margin: 0, lineHeight: 1.5, ...font },
          }, confirmHint),

          React.createElement('div', { style: { display: 'flex', gap: 12, marginTop: 4 } },
            React.createElement('button', {
              type: 'button', onClick: () => setConfirmModalOpen(false),
              style: {
                flex: 1, height: 48, borderRadius: 12, border: '1.5px solid #e2e2e2', background: '#fff',
                fontSize: 15, fontWeight: 600, color: '#0d0d0d', cursor: 'pointer', ...font,
              },
            }, 'Cancelar'),
            React.createElement('button', {
              type: 'button', onClick: executeRelease, disabled: batchLoading || dryRunLoading,
              style: {
                flex: 1, height: 48, borderRadius: 12, border: 'none',
                background: confirmMode === 'manual_pix_confirm' ? '#0d0d0d' : '#22c55e',
                fontSize: 15, fontWeight: 600, color: '#fff', cursor: 'pointer', ...font,
                opacity: (batchLoading || dryRunLoading) ? 0.6 : 1,
              },
            }, confirmCtaLabel))))
    : null;

  return React.createElement(React.Fragment, null,
    title, searchRow, stuckBanner, metricCards, selectionBar, emptyMsg || tableSection, filtroTabelaModal, toastEl, confirmModal);
}
