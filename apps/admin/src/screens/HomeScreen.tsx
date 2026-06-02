/**
 * HomeScreen — Home dashboard content extracted from App.tsx (lines 632-793 + 1014-1020).
 * Uses React.createElement() calls (NOT JSX).
 * Does NOT include header/navbar (that's in Layout).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import React from 'react';
import {
  webStyles,
  chevronDownSvg,
  filterIconSvg,
  infoIconSvg,
  arrowForwardSvg,
  calendarIconSvg,
  closeIconSvg,
} from '../styles/webStyles';
import {
  fetchPagamentoCountsByCategory,
  fetchViagens,
  fetchEncomendas,
  filterViagemListItem,
  filterEncomendaForHome,
  viagemCountsFromItems,
  encomendaCountsFromItems,
  fetchApprovedTripExpensesCents,
  fetchPendingCounts,
  fetchStuckPayoutsSummary,
  type ViagemListFilter,
  type PagamentoCountsByCategory,
  type PendingCounts,
} from '../data/queries';
import { useNavigate } from 'react-router-dom';
import type { PagamentoCounts } from '../data/types';

export default function HomeScreen() {
  const [homeSubTab, setHomeSubTab] = useState<'viagens' | 'encomendas'>('viagens');
  const [pagCounts, setPagCounts] = useState<PagamentoCounts | null>(null);
  const [pagByCategory, setPagByCategory] = useState<PagamentoCountsByCategory | null>(null);
  const [approvedExpenseCents, setApprovedExpenseCents] = useState(0);
  const [pending, setPending] = useState<PendingCounts>({ pendingWorkers: 0, pendingPayouts: 0 });
  const [stuckPayouts, setStuckPayouts] = useState<{ count: number; totalCents: number }>({ count: 0, totalCents: 0 });
  const navigate = useNavigate();

  // Dados carregados UMA vez — filtros aplicados localmente (instantâneo)
  const [allViagens, setAllViagens] = useState<import('../data/types').ViagemListItem[]>([]);
  const [allEncomendas, setAllEncomendas] = useState<import('../data/types').EncomendaListItem[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchViagens(),
      fetchEncomendas(),
      fetchPagamentoCountsByCategory(),
      fetchApprovedTripExpensesCents(),
      fetchPendingCounts(),
      fetchStuckPayoutsSummary(),
    ]).then(([v, e, pbc, exp, pc, stuck]) => {
      if (!cancelled) {
        setAllViagens(v);
        setAllEncomendas(e);
        setPagCounts(pbc.all);
        setPagByCategory(pbc);
        setApprovedExpenseCents(exp.totalCents);
        setPending(pc);
        setStuckPayouts({ count: stuck.count, totalCents: stuck.totalCents });
        setDataLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterDateInicio, setFilterDateInicio] = useState('');
  const [filterDateFim, setFilterDateFim] = useState('');
  const [filterStatus, setFilterStatus] = useState<'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas'>('todos');
  const [filterCategoria, setFilterCategoria] = useState<Set<'take_me' | 'motorista'>>(new Set(['take_me']));
  const [takeMeDropdownOpen, setTakeMeDropdownOpen] = useState(false);
  const [takeMeSelectedOption, setTakeMeSelectedOption] = useState<'Take Me' | 'Motorista parceiro'>('Take Me');

  const homeCategoriaToFilter = (set: Set<'take_me' | 'motorista'>): ViagemListFilter['categoria'] => {
    const hasT = set.has('take_me');
    const hasM = set.has('motorista');
    if (hasT && hasM) return 'todos';
    if (hasT) return 'take_me';
    if (hasM) return 'motorista';
    return 'todos';
  };

  // Filtrar localmente — instantâneo, sem query ao Supabase
  const homeCounts = useMemo(() => {
    if (!dataLoaded) return null;
    const cat = homeCategoriaToFilter(filterCategoria);
    const vf: ViagemListFilter = {
      status: filterStatus,
      categoria: cat,
      nomeNeedle: '',
      origemNeedle: '',
      tableDateYmd: '',
      periodoInicioYmd: filterDateInicio,
      periodoFimYmd: filterDateFim,
      datasIncluidas: 'passadas_e_futuras',
    };
    const vFil = allViagens.filter((v) => filterViagemListItem(v, vf));
    const eFil = allEncomendas.filter((e) => filterEncomendaForHome(e, filterStatus, filterDateInicio, filterDateFim));
    return {
      viagens: viagemCountsFromItems(vFil),
      encomendas: encomendaCountsFromItems(eFil),
    };
  }, [dataLoaded, allViagens, allEncomendas, filterCategoria, filterStatus, filterDateInicio, filterDateFim]);

  const aplicarFiltroHome = useCallback(() => {
    // Filtros já são aplicados via useMemo — só fechar o modal
    setFilterModalOpen(false);
  }, []);

  const isEncomendas = homeSubTab === 'encomendas';
  const subTabsSection = React.createElement('div', { style: webStyles.subTabsWrap },
    React.createElement('div', { style: webStyles.subTabs },
      React.createElement('button', {
        type: 'button',
        style: { ...webStyles.subTab, ...(!isEncomendas ? webStyles.subTabActive : {}) } as React.CSSProperties,
        onClick: () => setHomeSubTab('viagens'),
      }, React.createElement('span', null, 'Viagens'), !isEncomendas ? React.createElement('span', { style: webStyles.subTabIndicator }) : null),
      React.createElement('button', {
        type: 'button',
        style: { ...webStyles.subTab, ...(isEncomendas ? webStyles.subTabActive : {}) } as React.CSSProperties,
        onClick: () => setHomeSubTab('encomendas'),
      }, React.createElement('span', null, 'Encomendas'), isEncomendas ? React.createElement('span', { style: webStyles.subTabIndicator }) : null)));

  const searchSection = React.createElement('div', { style: { ...webStyles.searchRow, justifyContent: 'flex-end' } },
    React.createElement('div', { style: webStyles.filterGroup },
      React.createElement('button', {
        key: 'filtro', type: 'button', 'data-testid': 'home-open-filter',
        'aria-label': 'Abrir filtro do Início', style: webStyles.filterBtn, onClick: () => setFilterModalOpen(true),
      }, React.createElement('span', null, filterIconSvg), 'Filtro')));

  const fmtExpenseBRL = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const expenseCardEl = React.createElement('div', { style: webStyles.expenseCard },
    React.createElement('div', { style: webStyles.expenseCardIcon }, infoIconSvg),
    React.createElement('div', { style: webStyles.expenseCardBody },
      React.createElement('p', { style: webStyles.expenseCardTitle }, 'Despesas aprovadas pelo backoffice'),
      React.createElement('p', { style: webStyles.expenseCardDesc }, 'Total de pagamentos realizados para motoristas e preparadores no período selecionado.'),
      React.createElement('p', { style: webStyles.expenseCardLabel }, 'Total de despesas aprovadas no período'),
      React.createElement('p', { style: webStyles.expenseCardValue }, fmtExpenseBRL(approvedExpenseCents)),
      React.createElement('button', { type: 'button', style: webStyles.expenseCardLink, onClick: () => navigate('/pagamentos') }, 'Ver detalhes em Pagamentos', React.createElement('span', null, arrowForwardSvg))));

  // Contagens filtradas — refletem os filtros aplicados (data, status, categoria)
  const vc = homeCounts?.viagens;
  const ec = homeCounts?.encomendas;

  // Indicador se filtro está ativo
  const isFilterActive = filterDateInicio !== '' || filterDateFim !== '' || filterStatus !== 'todos';
  const statCardsData = isEncomendas
    ? [
        { title: 'Entregas em andamento', value: String(ec?.emAndamento ?? '—'), positive: true, testId: 'home-stat-encomendas-em-andamento' as const },
        { title: 'Agendadas', value: String(ec?.agendadas ?? '—'), positive: true, testId: 'home-stat-encomendas-agendadas' as const },
        { title: 'Concluídas', value: String(ec?.concluidas ?? '—'), positive: true, testId: 'home-stat-encomendas-concluidas' as const },
        { title: 'Canceladas', value: String(ec?.canceladas ?? '—'), positive: false, testId: 'home-stat-encomendas-canceladas' as const },
      ]
    : [
        { title: 'Viagens em andamento', value: String(vc?.emAndamento ?? '—'), positive: true, testId: 'home-stat-viagens-em-andamento' as const },
        { title: 'Agendadas', value: String(vc?.agendadas ?? '—'), positive: true, testId: 'home-stat-viagens-agendadas' as const },
        { title: 'Concluídas', value: String(vc?.concluidas ?? '—'), positive: true, testId: 'home-stat-viagens-concluidas' as const },
        { title: 'Canceladas', value: String(vc?.canceladas ?? '—'), positive: false, testId: 'home-stat-viagens-canceladas' as const },
      ];

  const statCards = statCardsData.map((s) =>
    React.createElement('div', {
      key: s.title,
      style: webStyles.statCard,
    },
      React.createElement('div', { style: webStyles.statCardHeader },
        React.createElement('span', { style: webStyles.statCardTitle }, s.title)),
      React.createElement('span', { style: webStyles.statCardValue, 'data-testid': s.testId }, s.value)));

  const fmtBRL = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

  // ── Gráfico com Recharts (PieChart) ──────────────────────────────────
  const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = require('recharts');

  const CHART_COLORS = ['#cba04b', '#545454', '#0d0d0d'];

  const buildChartSection = (
    title: string,
    desc: string,
    chart: { grossCents: number; adminCents: number; workerCents: number } | undefined,
  ) => {
    const gross = chart?.grossCents ?? 0;
    const taxas = chart?.adminCents ?? 0;
    const liquido = chart?.workerCents ?? 0;
    const despesas = Math.max(0, gross - taxas - liquido);

    const pieData = [
      { name: 'Taxas', value: taxas, color: '#cba04b' },
      { name: 'Valor líquido', value: liquido, color: '#545454' },
      { name: 'Despesas', value: despesas, color: '#0d0d0d' },
    ].filter((d) => d.value > 0);

    // Se não tem dados, mostrar placeholder
    if (pieData.length === 0) pieData.push({ name: 'Sem dados', value: 1, color: '#e2e2e2' });

    const dot = (bg: string): React.CSSProperties => ({ width: 20, height: 20, borderRadius: 999, background: bg, flexShrink: 0 });
    const legendText: React.CSSProperties = { fontSize: 16, fontWeight: 400, color: '#0d0d0d', ...font };
    const total = gross || 1;
    const taxasPct = Math.round((taxas / total) * 100);
    const liquidoPct = Math.round((liquido / total) * 100);
    const despesasPct = Math.max(0, 100 - taxasPct - liquidoPct);

    const customTooltip = ({ active, payload }: any) => {
      if (!active || !payload?.[0]) return null;
      const d = payload[0].payload;
      const pct = gross > 0 ? Math.round((d.value / gross) * 100) : 0;
      return React.createElement('div', {
        style: { background: '#0d0d0d', color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, ...font, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' },
      }, `${d.name}: ${pct}% (${fmtBRL(d.value)})`);
    };

    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, gap: 40, padding: 24, borderRadius: 16, background: '#f6f6f6', width: '100%', boxSizing: 'border-box' as const },
    },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
        React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.5, ...font } }, title),
        React.createElement('p', { style: { fontSize: 14, fontWeight: 400, color: '#767676', margin: 0, lineHeight: 1.5, ...font } }, desc)),
      React.createElement('div', {
        style: { display: 'flex', gap: 56, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' as const, width: '100%' },
      },
        // Recharts PieChart
        React.createElement('div', { style: { width: 280, height: 280, flexShrink: 0 } },
          React.createElement(ResponsiveContainer, { width: '100%', height: '100%' },
            React.createElement(PieChart, null,
              React.createElement(Pie, {
                data: pieData,
                cx: '50%', cy: '50%',
                innerRadius: 0, outerRadius: 120,
                dataKey: 'value',
                stroke: '#f6f6f6', strokeWidth: 2,
                animationBegin: 0, animationDuration: 800,
              },
                ...pieData.map((entry: any, idx: number) =>
                  React.createElement(Cell, { key: `cell-${idx}`, fill: entry.color }))),
              React.createElement(Tooltip, { content: customTooltip })))),
        // Legenda
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 40 } },
          React.createElement('p', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } },
            `Faturamento total: ${fmtBRL(gross)}`),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, maxWidth: 340 } },
            React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              React.createElement('div', { style: dot('#cba04b') }),
              React.createElement('span', { style: legendText }, `${taxasPct}% Taxas`)),
            React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              React.createElement('div', { style: dot('#545454') }),
              React.createElement('span', { style: legendText }, `${liquidoPct}% Valor líquido`)),
            React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              React.createElement('div', { style: dot('#0d0d0d') }),
              React.createElement('span', { style: legendText }, `${despesasPct}% Despesas`))))));
  };

  // Calcular totais do gráfico com base nos itens FILTRADOS
  const filteredChartData = useMemo(() => {
    if (!dataLoaded) return { grossCents: 0, adminCents: 0, workerCents: 0 };
    const cat = homeCategoriaToFilter(filterCategoria);
    const vf: ViagemListFilter = {
      status: filterStatus, categoria: cat, nomeNeedle: '', origemNeedle: '',
      tableDateYmd: '', periodoInicioYmd: filterDateInicio, periodoFimYmd: filterDateFim,
      datasIncluidas: 'passadas_e_futuras',
    };
    if (isEncomendas) {
      const eFil = allEncomendas.filter((e) => filterEncomendaForHome(e, filterStatus, filterDateInicio, filterDateFim));
      const gross = eFil.reduce((s, e) => s + e.amountCents, 0);
      // Estimar split: 30% admin, 70% worker (sem dados granulares de payout por item filtrado)
      const adminPctEstimate = pagByCategory?.chartEncomendas?.grossCents
        ? (pagByCategory.chartEncomendas.adminCents / pagByCategory.chartEncomendas.grossCents) : 0.3;
      return { grossCents: gross, adminCents: Math.round(gross * adminPctEstimate), workerCents: Math.round(gross * (1 - adminPctEstimate)) };
    } else {
      const vFil = allViagens.filter((v) => filterViagemListItem(v, vf));
      const gross = vFil.reduce((s, v) => s + v.amountCents, 0);
      const adminPctEstimate = pagByCategory?.chartPassageiros?.grossCents
        ? (pagByCategory.chartPassageiros.adminCents / pagByCategory.chartPassageiros.grossCents) : 0.3;
      return { grossCents: gross, adminCents: Math.round(gross * adminPctEstimate), workerCents: Math.round(gross * (1 - adminPctEstimate)) };
    }
  }, [dataLoaded, isEncomendas, allViagens, allEncomendas, filterCategoria, filterStatus, filterDateInicio, filterDateFim, pagByCategory]);

  const filterLabel = isFilterActive ? ' (filtrado)' : '';
  const chartCardEl = isEncomendas
    ? buildChartSection(
        'Distribuição de valores das encomendas' + filterLabel,
        'Distribuição de valores das encomendas no período filtrado.',
        filteredChartData)
    : buildChartSection(
        'Distribuição de receitas' + filterLabel,
        'A receita total inclui todas as viagens no período filtrado.',
        filteredChartData);

  // Modal Filtro Início (Figma 756-19720)
  const statusOptions: { id: 'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas'; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'em_andamento', label: 'Em andamento' },
    { id: 'agendadas', label: 'Agendadas' },
    { id: 'concluidas', label: 'Concluídas' },
    { id: 'canceladas', label: 'Canceladas' },
  ];
  const categoriaOptionsInicio: { id: 'take_me' | 'motorista'; label: string }[] = [
    { id: 'take_me', label: 'Take Me' },
    { id: 'motorista', label: 'Motorista parceiro' },
  ];
  const toggleCategoria = (id: 'take_me' | 'motorista') => {
    setFilterCategoria((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };
  const resetFilters = useCallback(() => {
    setFilterStatus('todos');
    setFilterDateInicio('');
    setFilterDateFim('');
    setFilterCategoria(new Set(['take_me', 'motorista']));
  }, []);

  const closeModalSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
    React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

  const filterModalInicioContent = React.createElement('div', { style: { ...webStyles.modalBoxInicio, maxWidth: 560 }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingBottom: 20, borderBottom: '1px solid #e2e2e2', boxSizing: 'border-box' as const },
    },
      React.createElement('h2', { id: 'home-filtro-modal-titulo', style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, fontFamily: 'Inter, sans-serif' } }, 'Filtro'),
      React.createElement('button', {
        type: 'button', onClick: () => setFilterModalOpen(false),
        style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
      }, closeModalSvg)),
    React.createElement('div', { style: webStyles.modalSection },
      React.createElement('h3', { style: webStyles.modalSectionTitle }, 'Data da atividade'),
      React.createElement('div', { style: webStyles.modalDateField },
        React.createElement('label', { style: webStyles.modalDateLabel }, 'Data inicial'),
        React.createElement('div', { style: webStyles.modalDateInputWrap },
          React.createElement('span', { style: webStyles.modalDateIcon }, calendarIconSvg),
          React.createElement('input', { type: 'date', value: filterDateInicio, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilterDateInicio(e.target.value), style: webStyles.modalDateInput, 'aria-label': 'Data inicial' }))),
      React.createElement('div', { style: { ...webStyles.modalDateField, marginTop: 8 } },
        React.createElement('label', { style: webStyles.modalDateLabel }, 'Data final'),
        React.createElement('div', { style: webStyles.modalDateInputWrap },
          React.createElement('span', { style: webStyles.modalDateIcon }, calendarIconSvg),
          React.createElement('input', { type: 'date', value: filterDateFim, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilterDateFim(e.target.value), style: webStyles.modalDateInput, 'aria-label': 'Data final' })))),
    React.createElement('div', { style: webStyles.modalSectionGap12 },
      React.createElement('h3', { style: webStyles.modalSectionTitle }, 'Status da viagem'),
      React.createElement('div', { style: webStyles.modalChips }, ...statusOptions.map((opt) =>
        React.createElement('button', { key: opt.id, type: 'button', style: { ...webStyles.modalChip, ...(filterStatus === opt.id ? webStyles.modalChipActive : webStyles.modalChipInactive) } as React.CSSProperties, onClick: () => setFilterStatus(opt.id) }, opt.label)))),
    React.createElement('div', { style: webStyles.modalSectionGap12 },
      React.createElement('h3', { style: webStyles.modalSectionTitle }, 'Categoria'),
      React.createElement('div', { style: webStyles.modalChips }, ...categoriaOptionsInicio.map((opt) =>
        React.createElement('button', { key: opt.id, type: 'button', style: { ...webStyles.modalChip, ...(filterCategoria.has(opt.id) ? webStyles.modalChipActive : webStyles.modalChipInactive) } as React.CSSProperties, onClick: () => toggleCategoria(opt.id) }, opt.label))),
    React.createElement('div', { style: { width: '100%', display: 'flex', flexDirection: 'column' as const, gap: 12, marginTop: 8 } },
      React.createElement('button', {
        type: 'button',
        onClick: () => { void aplicarFiltroHome(); },
        style: { width: '100%', minHeight: 48, height: 48, borderRadius: 999, border: 'none', background: '#0d0d0d', fontSize: 16, fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const },
      }, 'Aplicar filtro'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { resetFilters(); setFilterModalOpen(false); },
        style: { width: '100%', minHeight: 48, height: 48, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', fontSize: 16, fontWeight: 600, color: '#b53838', cursor: 'pointer', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const },
      }, 'Resetar filtros'))));

  const filterModalEl = filterModalOpen
    ? React.createElement('div', { style: webStyles.modalOverlay, onClick: () => setFilterModalOpen(false), role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'home-filtro-modal-titulo' }, filterModalInicioContent)
    : null;

  const hasPending = pending.pendingWorkers > 0 || pending.pendingPayouts > 0;
  const pendingSection = hasPending ? React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%', padding: '16px 20px', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 16, boxSizing: 'border-box' as const, cursor: 'pointer' },
    onClick: () => navigate('/pagamentos'),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigate('/pagamentos');
      }
    },
    role: 'button',
    tabIndex: 0,
    'aria-label': 'Abrir página de Pagamentos',
  },
    React.createElement('span', { style: { fontSize: 16, fontWeight: 700, color: '#92400e', ...font } }, 'Pendências que requerem atenção'),
    React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' as const } },
      pending.pendingWorkers > 0 ? React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fff', borderRadius: 12, border: '1px solid #e2e2e2' },
      },
        React.createElement('span', { style: { width: 28, height: 28, borderRadius: '50%', background: '#fee59a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#92400e', ...font } }, String(pending.pendingWorkers)),
        React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Motoristas aguardando aprovação')) : null,
      pending.pendingPayouts > 0 ? React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fff', borderRadius: 12, border: '1px solid #e2e2e2' },
      },
        React.createElement('span', { style: { width: 28, height: 28, borderRadius: '50%', background: '#fee59a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#92400e', ...font } }, String(pending.pendingPayouts)),
        React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Pagamentos aguardando liberação')) : null)) : null;

  const stuckSection = stuckPayouts.count > 0
    ? React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', padding: '16px 20px', background: '#fee2e2', border: '1px solid #b91c1c', borderRadius: 16, boxSizing: 'border-box' as const, cursor: 'pointer' },
        onClick: () => navigate('/pagamentos'),
        role: 'button', 'aria-label': 'Abrir Pagamentos para ver payouts retidos',
      },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 16, fontWeight: 700, color: '#7f1d1d', ...font } }, 'Payouts retidos > 3 dias'),
          React.createElement('span', { style: { fontSize: 13, color: '#7f1d1d', ...font } }, `${stuckPayouts.count} payout${stuckPayouts.count === 1 ? '' : 's'} aguardando — R$ ${(stuckPayouts.totalCents / 100).toFixed(2).replace('.', ',')}`)),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#7f1d1d', textDecoration: 'underline', ...font } }, 'Ver pagamentos'))
    : null;

  return React.createElement(React.Fragment, null,
    React.createElement('h1', { style: webStyles.homeTitle }, 'Início'),
    stuckSection,
    pendingSection,
    subTabsSection,
    searchSection,
    expenseCardEl,
    React.createElement('div', { style: webStyles.statCardsRow }, ...statCards),
    chartCardEl,
    filterModalEl);
}
