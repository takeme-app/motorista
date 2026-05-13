/**
 * ViagensScreen — Lista de viagens conforme Figma node 783-10796.
 * Uses React.createElement() calls (NOT JSX).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  webStyles,
  searchIconSvg,
  filterIconSvg,
  editIconSvg,
  calendarIconSvg,
  closeIconSvg,
  listBulletedSvg,
  checkCircleSvg,
  calendarTodaySvg,
  nearMeSvg,
  cancelSvg,
  statusStyles,
  statusLabels,
  statusPill,
  type ViagemRow,
} from '../styles/webStyles';
import {
  fetchViagens,
  updateBookingStatus,
  filterViagemListItem,
  viagemCountsFromItems,
  type ViagemListFilter,
} from '../data/queries';
import type { ViagemListItem, BookingPaymentMethod } from '../data/types';
import { resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/** Reserva real ou, em viagem só-encomenda, `scheduled_trips.id` para `/viagens/:id` e detalhe admin. */
function viagemListRouteId(item: ViagemListItem): string {
  const bid = String(item.bookingId ?? '').trim();
  return bid || String(item.tripId ?? '').trim();
}

// SVG icons for view/edit actions (stroke-based, matching project icons)
const eyeActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const pencilActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// Avatar colors by initial
const avatarColors: Record<string, string> = {
  C: '#4A90D9', J: '#7B61FF', E: '#E8725C', M: '#50C878', D: '#F5A623',
};

export default function ViagensScreen() {
  const navigate = useNavigate();

  // ── Real data from Supabase ─────────────────────────────────────────
  const [viagens, setViagens] = useState<ViagemListItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (showSpinner: boolean) => {
      if (showSpinner) setDataLoading(true);
      const items = await fetchViagens();
      if (!cancelled) {
        setViagens(items);
        setDataLoading(false);
      }
    };
    void load(true);

    if (!isSupabaseConfigured) {
      return () => { cancelled = true; };
    }

    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void (async () => {
          const items = await fetchViagens();
          if (!cancelled) setViagens(items);
        })();
      }, 450);
    };

    const channel = supabase
      .channel('admin-viagens-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_trips' }, scheduleRefetch)
      .subscribe();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, []);

  // Search row filter modal (Figma 763-21823)
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterDateInicio, setFilterDateInicio] = useState('');
  const [filterDateFim, setFilterDateFim] = useState('');
  const [filterDatasIncluidas, setFilterDatasIncluidas] = useState<'somente_passadas' | 'passadas_e_futuras' | 'somente_futuras'>('passadas_e_futuras');
  const [filterStatus, setFilterStatus] = useState<'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas'>('todos');
  const [filterCategoria, setFilterCategoria] = useState<'todos' | 'take_me' | 'motorista'>('todos');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<'todos' | BookingPaymentMethod>('todos');
  // Table filter modal (Figma 1132-26548) — status/categoria partilhados com o modal da barra (estado único)
  const [tableFilterOpen, setTableFilterOpen] = useState(false);
  const [tableFilterNome, setTableFilterNome] = useState('');
  const [tableFilterOrigem, setTableFilterOrigem] = useState('');
  const [tableFilterDate, setTableFilterDate] = useState('');

  const listFilter: ViagemListFilter = useMemo(
    () => ({
      status: filterStatus,
      categoria: filterCategoria,
      paymentMethod: filterPaymentMethod,
      nomeNeedle: tableFilterNome,
      origemNeedle: tableFilterOrigem,
      tableDateYmd: tableFilterDate,
      periodoInicioYmd: filterDateInicio,
      periodoFimYmd: filterDateFim,
      datasIncluidas: filterDatasIncluidas,
    }),
    [filterStatus, filterCategoria, filterPaymentMethod, tableFilterNome, tableFilterOrigem, tableFilterDate, filterDateInicio, filterDateFim, filterDatasIncluidas],
  );

  const viagensFiltradas = useMemo(
    () => viagens.filter((v) => filterViagemListItem(v, listFilter)),
    [viagens, listFilter],
  );

  const counts = useMemo(() => viagemCountsFromItems(viagensFiltradas), [viagensFiltradas]);

  // ── Alterar passageiro panel (Figma 1271-32750) ────────────────────
  const [alterarPassageiroOpen, setAlterarPassageiroOpen] = useState(false);
  const [alterarPassageiroData, setAlterarPassageiroData] = useState({ id: '', nome: '', contato: '', mala: 'Pequena', valor: 'R$ 25,00' });
  const [alterarPassageiroMalaOpen, setAlterarPassageiroMalaOpen] = useState(false);

  // ── Trocar motorista panel (Figma 1170-37420) ─────────────────────
  const [trocarMotoristaOpen, setTrocarMotoristaOpen] = useState(false);
  const [trocarMotoristaSelected, setTrocarMotoristaSelected] = useState(0);
  const [trocarMotoristaDate, setTrocarMotoristaDate] = useState('01 de setembro');
  const [trocarMotoristaMotivo, setTrocarMotoristaMotivo] = useState('');

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToastMsg(msg); }, []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const viagensSearchRow = React.createElement('div', { style: { ...webStyles.searchRow, justifyContent: 'flex-end' } },
    React.createElement('div', { style: webStyles.filterGroup },
      React.createElement('button', { type: 'button', style: webStyles.filterBtn, onClick: () => setFilterModalOpen(true) }, React.createElement('span', null, filterIconSvg), 'Filtro')));

  const viagensMetrics = [
    { title: 'Viagens totais', value: String(counts.total), icon: listBulletedSvg },
    { title: 'Viagens concluídas', value: String(counts.concluidas), icon: checkCircleSvg },
    { title: 'Viagens agendadas', value: String(counts.agendadas), icon: calendarTodaySvg },
    { title: 'Viagens em andamento', value: String(counts.emAndamento), icon: nearMeSvg },
    { title: 'Viagens canceladas', value: String(counts.canceladas), icon: cancelSvg },
  ];
  const viagensMetricCardEl = (m: typeof viagensMetrics[0]) =>
    React.createElement('div', { key: m.title, style: webStyles.viagensMetricCard },
      React.createElement('div', { style: webStyles.viagensMetricCardHeader },
        React.createElement('span', { style: webStyles.viagensMetricCardTitle }, m.title),
        React.createElement('div', { style: webStyles.viagensMetricCardIcon }, m.icon)),
      React.createElement('span', { style: webStyles.viagensMetricCardValue }, m.value));
  const viagensMetricCards = React.createElement(React.Fragment, null,
    React.createElement('div', { style: { ...webStyles.statCardsRow, marginBottom: 0 } }, ...viagensMetrics.slice(0, 3).map(viagensMetricCardEl)),
    React.createElement('div', { style: webStyles.statCardsRow }, ...viagensMetrics.slice(3, 5).map(viagensMetricCardEl)));

  // ── Recharts PieChart para distribuição por status ─────────────────
  const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = require('recharts');
  const statusPieData = [
    { name: 'Concluídas', value: counts.concluidas, color: '#0d8344' },
    { name: 'Agendadas', value: counts.agendadas, color: '#016df9' },
    { name: 'Em andamento', value: counts.emAndamento, color: '#cba04b' },
    { name: 'Canceladas', value: counts.canceladas, color: '#d64545' },
  ].filter((d) => d.value > 0);
  if (statusPieData.length === 0) statusPieData.push({ name: 'Sem dados', value: 1, color: '#e2e2e2' });

  const statusTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const total = counts.total || 1;
    const pct = Math.round((d.value / total) * 100);
    return React.createElement('div', {
      style: { background: '#0d0d0d', color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'Inter, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' },
    }, `${d.name}: ${pct}% (${d.value})`);
  };

  const legendDot = (bg: string): React.CSSProperties => ({ width: 20, height: 20, borderRadius: 999, background: bg, flexShrink: 0 });

  const viagensChartCard = React.createElement('div', { style: webStyles.viagensChartCard },
    React.createElement('h3', { style: webStyles.chartCardTitle }, 'Distribuição de viagens por status'),
    React.createElement('p', { style: webStyles.chartCardDesc }, 'Dados consolidados com base no período selecionado'),
    React.createElement('p', {
      style: {
        ...webStyles.chartCardDesc,
        fontSize: 12,
        marginTop: 4,
        color: '#767676',
      },
    }, 'Esta página reage a alterações em reservas e viagens (tempo quase real). Ida e volta: duas reservas, um trecho cada.'),
    React.createElement('div', { style: { display: 'flex', gap: 72, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' as const } },
      // Recharts PieChart (260px conforme Figma)
      React.createElement('div', { style: { width: 260, height: 260, flexShrink: 0 } },
        React.createElement(ResponsiveContainer, { width: '100%', height: '100%' },
          React.createElement(PieChart, null,
            React.createElement(Pie, {
              data: statusPieData, cx: '50%', cy: '50%',
              innerRadius: 0, outerRadius: 120, dataKey: 'value',
              stroke: '#f6f6f6', strokeWidth: 2,
              animationBegin: 0, animationDuration: 800,
            },
              ...statusPieData.map((entry: any, idx: number) =>
                React.createElement(Cell, { key: `cell-${idx}`, fill: entry.color }))),
            React.createElement(Tooltip, { content: statusTooltip })))),
      // Legenda conforme Figma com % antes do título
      (() => {
        const total = counts.total || 1;
        const pctConc = Math.round((counts.concluidas / total) * 100);
        const pctAgen = Math.round((counts.agendadas / total) * 100);
        const pctAnda = Math.round((counts.emAndamento / total) * 100);
        const pctCanc = Math.round((counts.canceladas / total) * 100);
        return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('span', { style: legendDot('#0d8344') }),
            React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#0d8344', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 } }, `${pctConc}% Concluídas`)),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('span', { style: legendDot('#016df9') }),
            React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#016df9', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 } }, `${pctAgen}% Agendadas`)),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('span', { style: legendDot('#cba04b') }),
            React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#cba04b', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 } }, `${pctAnda}% Em andamento`)),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('span', { style: legendDot('#d64545') }),
            React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#d64545', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 } }, `${pctCanc}% Canceladas`)));
      })()));

  // Table columns — use flex proportions to fit container width
  const tableCols = [
    { label: 'Passageiros', flex: '1 1 15%', minWidth: 140 },
    { label: 'Origem', flex: '1 1 13%', minWidth: 100 },
    { label: 'Destino', flex: '1 1 13%', minWidth: 100 },
    { label: 'Data', flex: '0 0 96px', minWidth: 96 },
    { label: 'Embarque', flex: '0 0 72px', minWidth: 72 },
    { label: 'Chegada', flex: '0 0 68px', minWidth: 68 },
    { label: 'Pag.', flex: '0 0 48px', minWidth: 48 },
    { label: 'Status', flex: '0 0 118px', minWidth: 118 },
    { label: 'Visualizar/Editar', flex: '0 0 96px', minWidth: 96 },
  ];
  const viagemPagamentoShort = (m: ViagemListItem['paymentMethod']) =>
    (m === 'cash' ? 'Din.' : m === 'pix' ? 'Pix' : 'Cart.');

  type RowWithItem = { row: ViagemRow; item: ViagemListItem };
  const viagensTableRows: RowWithItem[] = viagensFiltradas.map((v) => ({
    item: v,
    row: {
      passageiro: v.passageiro,
      origem: v.origem,
      destino: v.destino,
      data: v.data,
      embarque: v.embarque,
      chegada: v.chegada,
      status: v.status,
    },
  }));

  // Table header
  const viagensTableHeader = React.createElement('div', {
    style: { ...webStyles.viagensTableHeader, display: 'flex' },
  },
    ...tableCols.map((c) => React.createElement('div', {
      key: c.label,
      style: {
        flex: c.flex, minWidth: c.minWidth, padding: '0 8px',
        display: 'flex', alignItems: 'center',
        fontSize: 12, fontWeight: 400, lineHeight: '1.5',
      },
    }, c.label)));

  const openTripDetail = (row: ViagemRow, item: ViagemListItem) => {
    navigate(`/viagens/${viagemListRouteId(item)}`, { state: { trip: row } });
  };

  // Resolve avatar URLs from storage paths
  const [resolvedAvatars, setResolvedAvatars] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const paths = [...new Set(viagens.map((v) => v.passageiroAvatarUrl).filter(Boolean))] as string[];
    if (paths.length === 0) return;
    void (async () => {
      const map: Record<string, string> = {};
      for (const p of paths) {
        const url = await resolveStorageDisplayUrl(supabase as any, p);
        if (url) map[p] = url;
      }
      if (!cancelled) setResolvedAvatars(map);
    })();
    return () => { cancelled = true; };
  }, [viagens]);

  // Render avatar with photo or initial letter
  const renderAvatar = (name: string, avatarPath?: string | null) => {
    const resolved = avatarPath ? resolvedAvatars[avatarPath] : null;
    if (resolved) {
      return React.createElement('img', {
        src: resolved, alt: name,
        style: { ...webStyles.viagensAvatar, objectFit: 'cover' as const },
      });
    }
    const initial = name.charAt(0).toUpperCase();
    const bg = avatarColors[initial] || '#999';
    return React.createElement('div', {
      style: { ...webStyles.viagensAvatar, background: bg },
    }, React.createElement('span', {
      style: { color: '#fff', fontSize: 16, fontWeight: 600, fontFamily: 'Inter, sans-serif' },
    }, initial));
  };

  // Table rows
  const cellBase = { display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', padding: '0 8px' } as const;
  const viagensTableRowEl = (entry: RowWithItem, idx: number) => {
    const { row, item } = entry;
    const st = statusStyles[row.status];
    const hasBooking = Boolean(String(item.bookingId ?? '').trim());
    const rowKey = hasBooking ? item.bookingId : `trip:${item.tripId}`;
    return React.createElement('div', {
      key: rowKey,
      'data-testid': 'viagem-table-row',
      style: { ...webStyles.viagensTableRow, display: 'flex', cursor: 'pointer' },
      onClick: () => openTripDetail(row, item),
      role: 'button',
      tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTripDetail(row, item); } },
    },
      // Passageiros
      React.createElement('div', { style: { ...webStyles.viagensPassengerCell, flex: tableCols[0].flex, minWidth: tableCols[0].minWidth } },
        React.createElement('div', {
          style: { cursor: hasBooking ? 'pointer' : 'default', opacity: hasBooking ? 1 : 0.85 },
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!hasBooking) return;
            setAlterarPassageiroData({ id: item.bookingId, nome: row.passageiro, contato: '(21) 98888-7777', mala: 'Pequena', valor: 'R$ 25,00' });
            setAlterarPassageiroOpen(true);
          },
        }, renderAvatar(row.passageiro, item.passageiroAvatarUrl)),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', lineHeight: '1.5' } }, row.passageiro)),
      // Origem
      React.createElement('div', { style: { ...cellBase, flex: tableCols[1].flex, minWidth: tableCols[1].minWidth, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, row.origem),
      // Destino
      React.createElement('div', { style: { ...cellBase, flex: tableCols[2].flex, minWidth: tableCols[2].minWidth, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, row.destino),
      // Data
      React.createElement('div', { style: { ...cellBase, flex: tableCols[3].flex, minWidth: tableCols[3].minWidth, fontWeight: 400 } }, row.data),
      // Embarque
      React.createElement('div', { style: { ...cellBase, flex: tableCols[4].flex, minWidth: tableCols[4].minWidth, fontWeight: 400 } }, row.embarque),
      // Chegada
      React.createElement('div', { style: { ...cellBase, flex: tableCols[5].flex, minWidth: tableCols[5].minWidth, fontWeight: 400 } }, row.chegada),
      // Pagamento
      React.createElement('div', {
        style: {
          ...cellBase, flex: tableCols[6].flex, minWidth: tableCols[6].minWidth, fontWeight: 500, fontSize: 12,
          color: item.paymentMethod === 'cash' ? '#b45309' : '#3a3a3a',
        },
      }, viagemPagamentoShort(item.paymentMethod)),
      // Status
      React.createElement('div', { style: { ...cellBase, flex: tableCols[7].flex, minWidth: tableCols[7].minWidth } },
        statusPill(statusLabels[row.status], st.bg, st.color)),
      // Visualizar/Editar
      React.createElement('div', {
        style: { flex: tableCols[8].flex, minWidth: tableCols[8].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('div', { style: webStyles.viagensActionIcons },
          React.createElement('button', {
            type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Visualizar',
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); openTripDetail(row, item); },
          }, eyeActionSvg),
          React.createElement('button', {
            type: 'button',
            style: { ...webStyles.viagensActionBtn, opacity: hasBooking ? 1 : 0.4, cursor: hasBooking ? 'pointer' : 'not-allowed' },
            'aria-label': 'Editar',
            'aria-disabled': !hasBooking,
            title: hasBooking ? 'Editar reserva' : 'Sem reserva de passageiro — use o módulo Encomendas para o envio',
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              if (!hasBooking) return;
              navigate(`/viagens/${item.bookingId}/editar`, { state: { trip: row } });
            },
          }, pencilActionSvg))));
  };

  const viagensTableBody = viagensTableRows.map((entry, idx) => viagensTableRowEl(entry, idx));

  // Filtro button for section header (pill style matching Figma)
  const filtroBtn = React.createElement('button', {
    type: 'button',
    'data-testid': 'viagens-open-table-filter',
    'aria-label': 'Abrir filtro da tabela de viagens',
    style: {
      display: 'flex', alignItems: 'center', gap: 8, height: 40,
      padding: '8px 24px', borderRadius: 999, border: 'none',
      background: '#ffffff', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
      fontSize: 14, fontWeight: 500, color: '#0d0d0d', minWidth: 104,
      justifyContent: 'center',
    } as React.CSSProperties,
    onClick: () => setTableFilterOpen(true),
  }, React.createElement('span', { style: { display: 'flex', alignItems: 'center' } }, filterIconSvg), 'Filtro');

  const viagensTableSection = React.createElement('div', { style: webStyles.viagensTableSection },
    React.createElement('div', { style: webStyles.viagensTableSectionHeader },
      React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', lineHeight: '1.5' } }, 'Lista de viagens'),
      filtroBtn),
    viagensTableHeader,
    ...viagensTableBody);

  // Modal Filtro da tabela (Figma 1132-26548)
  const statusOptions: { id: 'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas'; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'em_andamento', label: 'Em andamento' },
    { id: 'agendadas', label: 'Agendadas' },
    { id: 'concluidas', label: 'Concluídas' },
    { id: 'canceladas', label: 'Canceladas' },
  ];
  const categoriaOptions: { id: typeof filterCategoria; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'take_me', label: 'Take Me' },
    { id: 'motorista', label: 'Motorista parceiro' },
  ];
  const paymentMethodFilterOptions: { id: 'todos' | BookingPaymentMethod; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'card', label: 'Cartão' },
    { id: 'pix', label: 'Pix' },
    { id: 'cash', label: 'Dinheiro' },
  ];

  // Shared styles for the modal
  const modalBox: React.CSSProperties = {
    background: '#ffffff', borderRadius: 16, padding: '24px 0', display: 'flex', flexDirection: 'column',
    gap: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '6px 6px 12px 0px rgba(0,0,0,0.15)', fontFamily: 'Inter, sans-serif',
  };
  const modalHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
    paddingBottom: 24, borderBottom: '1px solid #e2e2e2',
  };
  const modalCloseStyle: React.CSSProperties = {
    width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };
  const modalFieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', padding: '0 24px', width: '100%', boxSizing: 'border-box' };
  const modalLabel: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', lineHeight: '40px' };
  const modalInput: React.CSSProperties = {
    width: '100%', height: 44, background: '#f1f1f1', border: 'none', borderRadius: 8,
    padding: '0 16px', fontSize: 16, fontWeight: 400, color: '#0d0d0d', fontFamily: 'Inter, sans-serif',
    boxSizing: 'border-box', outline: 'none',
  };
  const modalDateWrap: React.CSSProperties = {
    width: '100%', height: 44, background: '#f1f1f1', border: 'none', borderRadius: 8,
    display: 'flex', alignItems: 'center', paddingLeft: 16, boxSizing: 'border-box',
  };
  const modalSectionLabel: React.CSSProperties = { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: '1.5', marginBottom: 12 };
  const chipBase: React.CSSProperties = {
    height: 40, padding: '0 16px', borderRadius: 90, border: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: 500, fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
  };
  const chipActive: React.CSSProperties = { ...chipBase, background: '#0d0d0d', color: '#ffffff' };
  const chipInactive: React.CSSProperties = { ...chipBase, background: '#f1f1f1', color: '#0d0d0d' };
  const modalPrimaryBtn: React.CSSProperties = {
    width: '100%', height: 48, background: '#0d0d0d', color: '#ffffff', border: 'none',
    borderRadius: 8, fontSize: 16, fontWeight: 500, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
  };
  const modalSecBtn: React.CSSProperties = {
    width: '100%', height: 48, background: 'transparent', color: '#0d0d0d', border: 'none',
    borderRadius: 8, fontSize: 16, fontWeight: 500, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
  };

  // Radio button style
  const radioRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', padding: '0 12px 0 0', width: '100%',
    background: 'none', border: 'none', cursor: 'pointer', boxSizing: 'border-box',
  };
  const radioCircle = (checked: boolean): React.CSSProperties => ({
    width: 20, height: 20, borderRadius: '50%', border: `2px solid ${checked ? '#0d0d0d' : '#767676'}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    margin: 10,
  });
  const radioDot: React.CSSProperties = { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' };
  const radioLabel: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' };

  const datasIncluidasOptions: { id: typeof filterDatasIncluidas; label: string }[] = [
    { id: 'somente_passadas', label: 'Somente passadas' },
    { id: 'passadas_e_futuras', label: 'Passadas e futuras' },
    { id: 'somente_futuras', label: 'Somente futuras' },
  ];

  // ── Search row filter modal (Figma 763-21823) ──
  const searchFilterContent = React.createElement('div', { style: modalBox, onClick: (e: React.MouseEvent) => e.stopPropagation() },
    // Header
    React.createElement('div', { style: modalHeaderStyle },
      React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0 } }, 'Filtro'),
      React.createElement('button', { type: 'button', style: modalCloseStyle, onClick: () => setFilterModalOpen(false), 'aria-label': 'Fechar' }, closeIconSvg)),
    // Data da atividade
    React.createElement('div', { style: { ...modalFieldWrap, gap: 8 } },
      React.createElement('span', { style: modalSectionLabel }, 'Data da atividade'),
      // Data inicial
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement('label', { style: modalLabel }, 'Data inicial'),
        React.createElement('div', { style: modalDateWrap },
          React.createElement('span', { style: { display: 'flex', alignItems: 'center', marginRight: 16 } }, calendarIconSvg),
          React.createElement('input', {
            type: 'date', style: { ...modalInput, background: 'transparent', paddingLeft: 0 },
            value: filterDateInicio, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilterDateInicio(e.target.value),
          }))),
      // Data final
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement('label', { style: modalLabel }, 'Data final'),
        React.createElement('div', { style: modalDateWrap },
          React.createElement('span', { style: { display: 'flex', alignItems: 'center', marginRight: 16 } }, calendarIconSvg),
          React.createElement('input', {
            type: 'date', style: { ...modalInput, background: 'transparent', paddingLeft: 0 },
            value: filterDateFim, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilterDateFim(e.target.value),
          })))),
    // Datas incluídas
    React.createElement('div', { style: { ...modalFieldWrap, gap: 12 } },
      React.createElement('span', { style: modalSectionLabel }, 'Datas incluídas'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
        ...datasIncluidasOptions.map((opt) =>
          React.createElement('button', { key: opt.id, type: 'button', style: radioRow, onClick: () => setFilterDatasIncluidas(opt.id) },
            React.createElement('div', { style: radioCircle(filterDatasIncluidas === opt.id) },
              filterDatasIncluidas === opt.id ? React.createElement('div', { style: radioDot }) : null),
            React.createElement('span', { style: radioLabel }, opt.label))))),
    // Status da viagem
    React.createElement('div', { style: { ...modalFieldWrap, gap: 0 } },
      React.createElement('span', { style: modalSectionLabel }, 'Status da viagem'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        ...statusOptions.map((opt) =>
          React.createElement('button', {
            key: opt.id, type: 'button',
            style: filterStatus === opt.id ? chipActive : chipInactive,
            onClick: () => setFilterStatus(opt.id),
          }, opt.label)))),
    // Categoria
    React.createElement('div', { style: { ...modalFieldWrap, gap: 0 } },
      React.createElement('span', { style: modalSectionLabel }, 'Categoria'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        ...categoriaOptions.map((opt) =>
          React.createElement('button', {
            key: opt.id, type: 'button',
            style: filterCategoria === opt.id ? chipActive : chipInactive,
            onClick: () => setFilterCategoria(opt.id),
          }, opt.label)))),
    React.createElement('div', { style: { ...modalFieldWrap, gap: 0 } },
      React.createElement('span', { style: modalSectionLabel }, 'Pagamento'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        ...paymentMethodFilterOptions.map((opt) =>
          React.createElement('button', {
            key: opt.id, type: 'button',
            style: filterPaymentMethod === opt.id ? chipActive : chipInactive,
            onClick: () => setFilterPaymentMethod(opt.id),
          }, opt.label)))),
    // Buttons
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '0 23px' } },
      React.createElement('button', { type: 'button', style: modalPrimaryBtn, onClick: () => setFilterModalOpen(false) }, 'Aplicar filtro'),
      React.createElement('button', { type: 'button', style: { ...modalSecBtn, color: '#b53838' }, onClick: () => { setFilterStatus('todos'); setFilterCategoria('todos'); setFilterPaymentMethod('todos'); setFilterDateInicio(''); setFilterDateFim(''); setFilterDatasIncluidas('passadas_e_futuras'); setFilterModalOpen(false); } }, 'Resetar filtros')));

  // ── Table filter modal (Figma 1132-26548) ──
  const tableFilterContent = React.createElement('div', { style: modalBox, onClick: (e: React.MouseEvent) => e.stopPropagation() },
    React.createElement('div', { style: modalHeaderStyle },
      React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0 } }, 'Filtro da tabela'),
      React.createElement('button', { type: 'button', style: modalCloseStyle, onClick: () => setTableFilterOpen(false), 'aria-label': 'Fechar' }, closeIconSvg)),
    React.createElement('div', { style: modalFieldWrap },
      React.createElement('label', { style: modalLabel }, 'Nome do motorista'),
      React.createElement('input', {
        type: 'text', placeholder: 'Ex: Carlos Silva', style: modalInput,
        value: tableFilterNome, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTableFilterNome(e.target.value),
      })),
    React.createElement('div', { style: modalFieldWrap },
      React.createElement('label', { style: modalLabel }, 'Origem'),
      React.createElement('input', {
        type: 'text', placeholder: 'Ex: São Paulo', style: modalInput,
        value: tableFilterOrigem, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTableFilterOrigem(e.target.value),
      })),
    React.createElement('div', { style: modalFieldWrap },
      React.createElement('label', { style: modalLabel }, 'Data inicial'),
      React.createElement('div', { style: modalDateWrap },
        React.createElement('span', { style: { display: 'flex', alignItems: 'center', marginRight: 16 } }, calendarIconSvg),
        React.createElement('input', {
          type: 'date', style: { ...modalInput, background: 'transparent', paddingLeft: 0 },
          value: tableFilterDate, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTableFilterDate(e.target.value),
        }))),
    React.createElement('div', { style: { ...modalFieldWrap, gap: 0 } },
      React.createElement('span', { style: modalSectionLabel }, 'Status da viagem'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        ...statusOptions.map((opt) =>
          React.createElement('button', {
            key: opt.id, type: 'button',
            style: filterStatus === opt.id ? chipActive : chipInactive,
            onClick: () => setFilterStatus(opt.id),
          }, opt.label)))),
    React.createElement('div', { style: { ...modalFieldWrap, gap: 0 } },
      React.createElement('span', { style: modalSectionLabel }, 'Categoria'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        ...categoriaOptions.map((opt) =>
          React.createElement('button', {
            key: opt.id, type: 'button',
            style: filterCategoria === opt.id ? chipActive : chipInactive,
            onClick: () => setFilterCategoria(opt.id),
          }, opt.label)))),
    React.createElement('div', { style: { ...modalFieldWrap, gap: 0 } },
      React.createElement('span', { style: modalSectionLabel }, 'Pagamento'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        ...paymentMethodFilterOptions.map((opt) =>
          React.createElement('button', {
            key: opt.id, type: 'button',
            style: filterPaymentMethod === opt.id ? chipActive : chipInactive,
            onClick: () => setFilterPaymentMethod(opt.id),
          }, opt.label)))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '0 23px' } },
      React.createElement('button', { type: 'button', style: modalPrimaryBtn, onClick: () => setTableFilterOpen(false) }, 'Aplicar filtro'),
      React.createElement('button', { type: 'button', style: { ...modalSecBtn, color: '#b53838' }, onClick: () => { setTableFilterNome(''); setTableFilterOrigem(''); setTableFilterDate(''); setFilterStatus('todos'); setFilterCategoria('todos'); setFilterPaymentMethod('todos'); setTableFilterOpen(false); } }, 'Resetar filtros')));

  const searchFilterEl = filterModalOpen
    ? React.createElement('div', { style: webStyles.modalOverlay, onClick: () => setFilterModalOpen(false), role: 'dialog', 'aria-modal': true, 'aria-label': 'Filtro' }, searchFilterContent)
    : null;
  const tableFilterEl = tableFilterOpen
    ? React.createElement('div', { style: webStyles.modalOverlay, onClick: () => setTableFilterOpen(false), role: 'dialog', 'aria-modal': true, 'aria-label': 'Filtro da tabela' }, tableFilterContent)
    : null;

  // ── Trocar motorista slide panel ────────────────────────────────────
  const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };
  const tmDrivers = [
    { name: 'Maria Joaquina', rota: 'Rio de Janeiro - RJ → São Paulo - SP', data: '25/10/2025', valorTotal: 'R$ 150,00', valorUnit: 'R$ 75,00', pessoas: '2', ocupacao: '80%' },
    { name: 'Pedro Albuquerque', rota: 'Rio de Janeiro - RJ → São Paulo - SP', data: '26/10/2025', valorTotal: 'R$ 145,00', valorUnit: 'R$ 70,00', pessoas: '3', ocupacao: '70%' },
    { name: 'Marcio Felipe', rota: 'Rio de Janeiro - RJ → São Paulo - SP', data: '26/10/2025', valorTotal: 'R$ 145,00', valorUnit: 'R$ 70,00', pessoas: '3', ocupacao: '70%' },
    { name: 'Pedro Albuquerque', rota: 'Rio de Janeiro - RJ → São Paulo - SP', data: '26/10/2025', valorTotal: 'R$ 145,00', valorUnit: 'R$ 70,00', pessoas: '3', ocupacao: '70%' },
  ];

  const tmInfoRow = (label: string, value: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, label),
      React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#0d0d0d', ...font } }, value));

  const tmRadioSvg = (selected: boolean) =>
    React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
      React.createElement('circle', { cx: 12, cy: 12, r: 9, stroke: selected ? '#0d0d0d' : '#767676', strokeWidth: 2 }),
      selected ? React.createElement('circle', { cx: 12, cy: 12, r: 5, fill: '#0d0d0d' }) : null);

  const tmDriverCard = (d: typeof tmDrivers[0], idx: number, isFirst: boolean) =>
    React.createElement('div', { key: idx, style: { display: 'flex', flexDirection: 'column' as const } },
      React.createElement('button', {
        type: 'button',
        onClick: () => setTrocarMotoristaSelected(idx),
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 0', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6 },
      },
        tmRadioSvg(trocarMotoristaSelected === idx),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, d.name)),
      React.createElement('div', { style: { paddingLeft: 39, paddingBottom: 16, borderBottom: '1px solid #e2e2e2', display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        tmInfoRow('Origem - Destino', d.rota),
        tmInfoRow('Data', d.data),
        tmInfoRow('Valor total', d.valorTotal),
        tmInfoRow('Valor unitário', d.valorUnit),
        tmInfoRow('Pessoas restantes', d.pessoas),
        tmInfoRow('Ocupação do bagageiro', d.ocupacao)));

  const trocarMotoristaPanel = trocarMotoristaOpen
    ? React.createElement('div', {
        style: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 9999 },
        onClick: () => setTrocarMotoristaOpen(false),
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: '16px 0 0 16px', width: '100%', maxWidth: 520,
            maxHeight: '100vh', boxShadow: '6px 6px 12px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column' as const, padding: '24px 32px',
            overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid #e2e2e2', marginBottom: 24, flexShrink: 0 } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, maxWidth: 344 } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Trocar motorista'),
              React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Selecione outro motorista disponível para continuar.')),
            React.createElement('button', {
              type: 'button', 'aria-label': 'Fechar',
              onClick: () => setTrocarMotoristaOpen(false),
              style: { width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
            }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
              React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
          // Content
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, paddingLeft: 16, paddingRight: 16 } },
            // Data da atividade
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, paddingBottom: 16 } },
              React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Data da atividade'),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
                React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Data'),
                React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                  React.createElement('div', { style: { position: 'absolute' as const, left: 16, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' as const } }, calendarIconSvg),
                  React.createElement('input', {
                    type: 'text', value: trocarMotoristaDate,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTrocarMotoristaDate(e.target.value),
                    style: { width: '100%', height: 44, background: '#f1f1f1', border: 'none', borderRadius: 8, paddingLeft: 48, fontSize: 16, color: '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
                  })))),
            // Viagem atual
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Viagem atual'),
              tmDriverCard(tmDrivers[0], 0, true)),
            // Outras viagens disponíveis
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Outras viagens disponíveis'),
              ...tmDrivers.slice(1).map((d, i) => tmDriverCard(d, i + 1, false))),
            // Motivo textarea
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Motivo'),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Opcional')),
              React.createElement('textarea', {
                value: trocarMotoristaMotivo, placeholder: 'Veículo teve problema mecânico.',
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setTrocarMotoristaMotivo(e.target.value),
                style: { width: '100%', height: 156, background: '#f1f1f1', border: 'none', borderRadius: 8, padding: 16, fontSize: 16, color: trocarMotoristaMotivo ? '#3a3a3a' : '#767676', outline: 'none', boxSizing: 'border-box' as const, resize: 'vertical' as const, lineHeight: 'normal', ...font },
              }))),
          // Buttons
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 24, padding: '0 23px', flexShrink: 0 } },
            React.createElement('button', {
              type: 'button', onClick: () => { setTrocarMotoristaOpen(false); showToast('Motorista trocado com sucesso'); },
              style: { width: '100%', height: 48, background: '#0d0d0d', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#fff', ...font },
            }, 'Confirmar troca'),
            React.createElement('button', {
              type: 'button', onClick: () => setTrocarMotoristaOpen(false),
              style: { width: '100%', height: 48, background: '#f1f1f1', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#b53838', ...font },
            }, 'Cancelar'))))
    : null;

  // ── Alterar passageiro slide panel (Figma 1271-32750) ───────────────
  const malaOptions = ['Pequena', 'Média', 'Grande'];
  const apInputStyle: React.CSSProperties = {
    width: '100%', height: 44, background: '#f1f1f1', border: 'none', borderRadius: 8,
    paddingLeft: 16, fontSize: 16, color: '#3a3a3a', outline: 'none', boxSizing: 'border-box' as const, ...font,
  };
  const apLabelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font };
  const apField = (label: string, value: string, onChange: (v: string) => void) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('label', { style: apLabelStyle }, label),
      React.createElement('input', { type: 'text', value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value), style: apInputStyle }));

  const chevronDownSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#3a3a3a', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  const alterarPassageiroPanel = alterarPassageiroOpen
    ? React.createElement('div', {
        style: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 9999 },
        onClick: () => { setAlterarPassageiroOpen(false); setAlterarPassageiroMalaOpen(false); },
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: '16px 0 0 16px', width: '100%', maxWidth: 520,
            maxHeight: '100vh', boxShadow: '6px 6px 12px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between',
            padding: '64px 32px 88px', overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Top content
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 32 } },
            // Header
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid #e2e2e2' } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Alterar passageiro'),
              React.createElement('button', {
                type: 'button', 'aria-label': 'Fechar',
                onClick: () => { setAlterarPassageiroOpen(false); setAlterarPassageiroMalaOpen(false); },
                style: { width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            // Fields
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
              apField('ID do passageiro', alterarPassageiroData.id, (v) => setAlterarPassageiroData({ ...alterarPassageiroData, id: v })),
              apField('Nome completo', alterarPassageiroData.nome, (v) => setAlterarPassageiroData({ ...alterarPassageiroData, nome: v })),
              apField('Contato', alterarPassageiroData.contato, (v) => setAlterarPassageiroData({ ...alterarPassageiroData, contato: v })),
              // Tamanho da mala - dropdown
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, position: 'relative' as const } },
                React.createElement('label', { style: apLabelStyle }, 'Tamanho da mala'),
                React.createElement('button', {
                  type: 'button',
                  onClick: () => setAlterarPassageiroMalaOpen(!alterarPassageiroMalaOpen),
                  style: {
                    ...apInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    paddingRight: 12, cursor: 'pointer', textAlign: 'left' as const,
                  },
                },
                  React.createElement('span', null, alterarPassageiroData.mala),
                  chevronDownSvg),
                // Dropdown options
                alterarPassageiroMalaOpen
                  ? React.createElement('div', {
                      style: {
                        position: 'absolute' as const, top: '100%', left: 0, right: 0, zIndex: 10,
                        background: '#fff', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        border: '1px solid #e2e2e2', overflow: 'hidden' as const, marginTop: 4,
                      },
                    },
                      ...malaOptions.map((opt) =>
                        React.createElement('button', {
                          key: opt, type: 'button',
                          onClick: () => { setAlterarPassageiroData({ ...alterarPassageiroData, mala: opt }); setAlterarPassageiroMalaOpen(false); },
                          style: {
                            width: '100%', height: 44, border: 'none', background: alterarPassageiroData.mala === opt ? '#f1f1f1' : '#fff',
                            padding: '0 16px', fontSize: 16, color: '#3a3a3a', cursor: 'pointer', textAlign: 'left' as const, ...font,
                          },
                        }, opt)))
                  : null),
              apField('Valor', alterarPassageiroData.valor, (v) => setAlterarPassageiroData({ ...alterarPassageiroData, valor: v })))),
          // Buttons
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 32 } },
            React.createElement('button', {
              type: 'button',
              onClick: () => { setAlterarPassageiroOpen(false); setAlterarPassageiroMalaOpen(false); showToast('Passageiro atualizado com sucesso'); },
              style: { width: '100%', height: 48, background: '#0d0d0d', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#fff', ...font },
            }, 'Salvar dados'),
            React.createElement('button', {
              type: 'button',
              onClick: () => { setAlterarPassageiroOpen(false); setAlterarPassageiroMalaOpen(false); },
              style: { width: '100%', height: 48, background: '#e2e2e2', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#b53838', ...font },
            }, 'Cancelar'))))
    : null;

  // Toast
  const toastCheckSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 12, cy: 12, r: 11, fill: '#fff' }),
    React.createElement('path', { d: 'M9 12l2 2 4-4', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const toastEl = toastMsg
    ? React.createElement('div', {
        key: toastMsg,
        style: {
          position: 'fixed' as const, bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: '#0d0d0d', borderRadius: 12, padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: 12, zIndex: 10000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', whiteSpace: 'nowrap' as const, opacity: 1,
        },
      },
        toastCheckSvg,
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#fff', ...font } }, toastMsg))
    : null;

  if (dataLoading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', fontFamily: 'Inter, sans-serif' } }, 'Carregando viagens...'));
  }

  return React.createElement(React.Fragment, null,
    React.createElement('h1', { style: webStyles.homeTitle }, 'Viagens'),
    viagensSearchRow,
    viagensMetricCards,
    viagensChartCard,
    viagensTableSection,
    searchFilterEl,
    tableFilterEl,
    trocarMotoristaPanel,
    alterarPassageiroPanel,
    toastEl);
}
