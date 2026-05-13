/**
 * HistoricoViagensScreen — Histórico completo de viagens (Figma 844:20671; dados Supabase).
 * React.createElement() only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { webStyles } from '../styles/webStyles';
import { fetchViagens, fetchBookingsForDriver, fetchBookingsForPassengerUser, formatCurrencyBRL } from '../data/queries';
import type { ViagemListItem } from '../data/types';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

function viagemStatusLabel(s: ViagemListItem['status']): string {
  switch (s) {
    case 'concluído': return 'Concluído';
    case 'cancelado': return 'Cancelado';
    case 'agendado': return 'Agendado';
    case 'em_andamento': return 'Em andamento';
    default: return 'Agendado';
  }
}

const iconSvg = (type: string) => {
  const s = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } as React.CSSProperties };
  const p = { stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'list': return React.createElement('svg', s, React.createElement('path', { ...p, d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }));
    case 'check': return React.createElement('svg', s, React.createElement('path', { ...p, d: 'M22 11.08V12a10 10 0 11-5.93-9.14' }), React.createElement('path', { ...p, d: 'M22 4L12 14.01l-3-3' }));
    case 'calendar': return React.createElement('svg', s, React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ...p }), React.createElement('path', { ...p, d: 'M16 2v4M8 2v4M3 10h18' }));
    case 'send': return React.createElement('svg', s, React.createElement('path', { ...p, d: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' }));
    case 'x': return React.createElement('svg', s, React.createElement('circle', { cx: 12, cy: 12, r: 10, ...p }), React.createElement('path', { ...p, d: 'M15 9l-6 6M9 9l6 6' }));
    default: return null;
  }
};

type TripRow = {
  id: string;
  rota: string;
  data: string;
  horarios: string;
  passageiros: number;
  bagageiro: string;
  preco: string;
  gastos: string;
  status: string;
};

const statusStyle: Record<string, { bg: string; color: string }> = {
  'Cancelado': { bg: '#eeafaa', color: '#551611' },
  'Agendado': { bg: '#a8c6ef', color: '#102d57' },
  'Em andamento': { bg: '#fee59a', color: '#654c01' },
  'Concluído': { bg: '#b0e8d1', color: '#174f38' },
};

const cols = [
  { label: 'ID', flex: '0 0 70px' },
  { label: 'Origem → Destino', flex: '1 1 22%' },
  { label: 'Data', flex: '0 0 90px' },
  { label: 'Horários', flex: '0 0 90px' },
  { label: 'Passageiros', flex: '0 0 80px' },
  { label: 'Bagageiro', flex: '0 0 72px' },
  { label: 'Preço Total', flex: '0 0 100px' },
  { label: 'Gastos', flex: '0 0 90px' },
  { label: 'Status', flex: '0 0 120px' },
];

function itemsToRows(items: ViagemListItem[]): TripRow[] {
  return items.map((v) => ({
    id: `#${String(v.bookingId || v.tripId).slice(0, 8)}`,
    rota: `${v.origem} → ${v.destino}`,
    data: v.data,
    horarios: `${v.embarque} → ${v.chegada}`,
    passageiros: v.passengerCount,
    bagageiro: v.trunkOccupancyPct > 0 ? `${v.trunkOccupancyPct}%` : '—',
    preco: formatCurrencyBRL(v.amountCents),
    gastos: '—',
    status: viagemStatusLabel(v.status),
  }));
}

export default function HistoricoViagensScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeBookingId, mid: motoristaId, pid: passengerPid } = useParams<{
    id?: string;
    mid?: string;
    pid?: string;
  }>();
  const [items, setItems] = useState<ViagemListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const isPassengerHistorico =
    Boolean(passengerPid) && location.pathname.includes('/passageiros/') && location.pathname.includes('/historico');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setLoadErr(null);
    const p = passengerPid
      ? fetchBookingsForPassengerUser(passengerPid)
      : motoristaId
        ? fetchBookingsForDriver(motoristaId)
        : fetchViagens();
    p.then((list) => {
      if (cancel) return;
      setItems(list);
      setLoading(false);
    }).catch(() => {
      if (cancel) return;
      setLoadErr('Não foi possível carregar as viagens.');
      setItems([]);
      setLoading(false);
    });
    return () => { cancel = true; };
  }, [motoristaId, passengerPid]);

  const trips = useMemo(() => itemsToRows(items), [items]);

  const statusCounts = useMemo(() => {
    const total = items.length;
    const concluidas = items.filter((v) => v.status === 'concluído').length;
    const agendadas = items.filter((v) => v.status === 'agendado').length;
    const emAndamento = items.filter((v) => v.status === 'em_andamento').length;
    const canceladas = items.filter((v) => v.status === 'cancelado').length;
    return { total, concluidas, agendadas, emAndamento, canceladas };
  }, [items]);

  const metrics = useMemo(() => {
    const { total, concluidas, agendadas, emAndamento, canceladas } = statusCounts;
    return [
      { title: 'Viagens totais', value: String(total), icon: 'list' },
      { title: 'Viagens concluídas', value: String(concluidas), icon: 'check' },
      { title: 'Viagens agendadas', value: String(agendadas), icon: 'calendar' },
      { title: 'Viagens em andamento', value: String(emAndamento), icon: 'send' },
      { title: 'Viagens canceladas', value: String(canceladas), icon: 'x' },
    ];
  }, [statusCounts]);

  const fromLabel = location.pathname.startsWith('/motoristas') ? 'Motoristas'
    : location.pathname.startsWith('/passageiros') ? 'Passageiros'
    : 'Viagens';

  const crumb = (text: string, opts?: { current?: boolean; onClick?: () => void }) =>
    React.createElement(
      opts?.onClick ? 'button' : 'span',
      opts?.onClick
        ? {
            type: 'button' as const,
            onClick: opts.onClick,
            style: {
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12,
              fontWeight: 600,
              color: opts.current ? '#0d0d0d' : '#767676',
              ...font,
            },
          }
        : { style: { fontSize: 12, fontWeight: 600, color: opts?.current ? '#0d0d0d' : '#767676', ...font } },
      text,
    );

  const chevronCrumb = React.createElement('span', { style: { margin: '0 4px', color: '#767676' } }, '›');

  // ── Breadcrumb (Figma 844:20673 — passageiros: 3 níveis) ────────────
  const breadcrumb = isPassengerHistorico && routeBookingId
    ? React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 0, fontSize: 12, fontWeight: 600, ...font },
      },
        crumb('Passageiros', { onClick: () => navigate('/passageiros') }),
        chevronCrumb,
        crumb('Editar viagem', {
          onClick: () => navigate(`/passageiros/${passengerPid}/viagem/${routeBookingId}/editar`),
        }),
        chevronCrumb,
        crumb('Histórico completo de viagens', { current: true }))
    : React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#767676', ...font },
      },
        React.createElement('span', null, fromLabel),
        React.createElement('span', { style: { margin: '0 4px' } }, '›'),
        React.createElement('span', { style: { color: '#0d0d0d' } }, 'Histórico completo de viagens'));

  const arrowBackSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  // ── Metric cards ────────────────────────────────────────────────────
  const metricCards = React.createElement('div', {
    style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const, width: '100%' },
  },
    ...metrics.map((m, i) =>
      React.createElement('div', {
        key: m.title,
        style: {
          flex: i < 3 ? '1 1 calc(33% - 12px)' : '1 1 calc(50% - 8px)', minWidth: 180,
          background: '#f6f6f6', borderRadius: 16, padding: '16px 20px',
          display: 'flex', flexDirection: 'column' as const, gap: 8, boxSizing: 'border-box' as const,
        },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#767676', ...font } }, m.title),
          iconSvg(m.icon)),
        React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, m.value))));

  // ── Recharts PieChart (mesmo padrão de ViagensScreen / Home) ─────────
  const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = require('recharts');
  const { total: chartTotal, concluidas, agendadas, emAndamento, canceladas } = statusCounts;
  const statusPieData = [
    { name: 'Concluídas', value: concluidas, color: '#0d8344' },
    { name: 'Agendadas', value: agendadas, color: '#016df9' },
    { name: 'Em andamento', value: emAndamento, color: '#cba04b' },
    { name: 'Canceladas', value: canceladas, color: '#d64545' },
  ].filter((d) => d.value > 0);
  if (statusPieData.length === 0) statusPieData.push({ name: 'Sem dados', value: 1, color: '#e2e2e2' });

  const statusTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { name: string; value: number } }[] }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const t = chartTotal || 1;
    const pct = Math.round((d.value / t) * 100);
    return React.createElement('div', {
      style: {
        background: '#0d0d0d',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        ...font,
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      },
    }, `${d.name}: ${pct}% (${d.value})`);
  };

  const legendDot = (bg: string): React.CSSProperties => ({
    width: 20,
    height: 20,
    borderRadius: 999,
    background: bg,
    flexShrink: 0,
  });

  const totalForPct = chartTotal || 1;
  const pctConc = Math.round((concluidas / totalForPct) * 100);
  const pctAgen = Math.round((agendadas / totalForPct) * 100);
  const pctAnda = Math.round((emAndamento / totalForPct) * 100);
  const pctCanc = Math.round((canceladas / totalForPct) * 100);

  const chartSection = React.createElement('div', {
    style: { width: '100%', background: '#f6f6f6', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16, boxSizing: 'border-box' as const },
  },
    React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Distribuição por status'),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 56, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { width: 260, height: 260, flexShrink: 0 } },
        React.createElement(ResponsiveContainer, { width: '100%', height: '100%' },
          React.createElement(PieChart, null,
            React.createElement(Pie, {
              data: statusPieData,
              cx: '50%',
              cy: '50%',
              innerRadius: 0,
              outerRadius: 120,
              dataKey: 'value',
              stroke: '#f6f6f6',
              strokeWidth: 2,
              animationBegin: 0,
              animationDuration: 800,
            },
              ...statusPieData.map((entry: { color: string }, idx: number) =>
                React.createElement(Cell, { key: `cell-${idx}`, fill: entry.color }))),
            React.createElement(Tooltip, { content: statusTooltip })))),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: legendDot('#0d8344') }),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#0d8344', ...font, lineHeight: 1.5 } }, `${pctConc}% Concluídas`)),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: legendDot('#016df9') }),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#016df9', ...font, lineHeight: 1.5 } }, `${pctAgen}% Agendadas`)),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: legendDot('#cba04b') }),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#cba04b', ...font, lineHeight: 1.5 } }, `${pctAnda}% Em andamento`)),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: legendDot('#d64545') }),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#d64545', ...font, lineHeight: 1.5 } }, `${pctCanc}% Canceladas`)))));

  // ── Table ───────────────────────────────────────────────────────────
  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 13, color: '#0d0d0d', ...font, padding: '0 6px' };

  const tableHeader = React.createElement('div', {
    style: { display: 'flex', height: 48, background: '#e2e2e2', padding: '0 16px', alignItems: 'center' },
  },
    ...cols.map((c) => React.createElement('div', {
      key: c.label, style: { flex: c.flex, fontSize: 12, fontWeight: 400, color: '#767676', ...font, padding: '0 6px', display: 'flex', alignItems: 'center' },
    }, c.label)));

  const tableRows = items.map((v, idx) => {
    const t = trips[idx];
    const st = statusStyle[t.status] || statusStyle['Agendado'];
    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f6f6f6';
    return React.createElement('div', {
      key: `${String(v.bookingId || '')}:${v.tripId}:${idx}`,
      style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '6px 16px', borderBottom: '1px solid #e8e8e8', background: rowBg },
    },
      React.createElement('div', { style: { ...cellBase, flex: cols[0].flex, fontWeight: 600 } }, t.id),
      React.createElement('div', { style: { ...cellBase, flex: cols[1].flex } }, t.rota),
      React.createElement('div', { style: { ...cellBase, flex: cols[2].flex } }, t.data),
      React.createElement('div', { style: { ...cellBase, flex: cols[3].flex, whiteSpace: 'nowrap' as const } }, t.horarios),
      React.createElement('div', { style: { ...cellBase, flex: cols[4].flex, justifyContent: 'center' } }, String(t.passageiros)),
      React.createElement('div', { style: { ...cellBase, flex: cols[5].flex } }, t.bagageiro),
      React.createElement('div', { style: { ...cellBase, flex: cols[6].flex, fontWeight: 600 } }, t.preco),
      React.createElement('div', { style: { ...cellBase, flex: cols[7].flex } }, t.gastos),
      React.createElement('div', { style: { ...cellBase, flex: cols[8].flex } },
        React.createElement('span', {
          style: { padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: st.bg, color: st.color, whiteSpace: 'nowrap' as const, ...font },
        }, t.status)));
  });

  const tableSection = React.createElement('div', {
    style: { background: '#f6f6f6', borderRadius: 16, overflow: 'hidden', width: '100%' },
  },
    React.createElement('div', { style: { padding: '20px 24px' } },
      React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Lista de viagens')),
    React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } },
      tableHeader,
      loading
        ? React.createElement('div', { style: { padding: 24, ...font, color: '#767676' } }, 'Carregando…')
        : loadErr
          ? React.createElement('div', { style: { padding: 24, color: '#b53838', ...font } }, loadErr)
          : trips.length === 0
            ? React.createElement('div', { style: { padding: 24, color: '#767676', ...font } }, 'Nenhuma viagem encontrada.')
            : React.createElement(React.Fragment, null, ...tableRows)));

  return React.createElement('div', { style: { ...webStyles.detailPage, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
    breadcrumb,
    React.createElement('button', {
      type: 'button',
      onClick: () => navigate(-1),
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minWidth: 104,
        height: 44,
        padding: '8px 24px',
        background: 'transparent',
        border: 'none',
        borderRadius: 999,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
        color: '#0d0d0d',
        ...font,
        alignSelf: 'flex-start',
      },
    }, arrowBackSvg, 'Voltar'),
    metricCards,
    chartSection,
    tableSection);
}
