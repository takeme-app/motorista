/**
 * MotoristasScreen — Lista de motoristas (padrão HomeScreen/ViagensScreen).
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  webStyles,
  filterIconSvg,
} from '../styles/webStyles';
import {
  fetchMotoristas,
  fetchMotoristaTableRows,
  fetchAllMotoristaProfiles,
  fetchMotoristasComTaxaPlataformaDevida,
  updateWorkerStatus,
} from '../data/queries';
import type { MotoristaListItem, MotoristaPlatformFeeDebtItem, WorkerApprovalRow, WorkerApprovalStatus } from '../data/types';
import type { MotoristaTableRow } from '../data/queries';
import { resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import { supabase } from '../lib/supabase';

const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = require('recharts');

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

// ── SVG icons ─────────────────────────────────────────────────────────────
const eyeActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const pencilActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const closeSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

/** Última coluna: min-width cobre 2×40px ícones + até 2 pills (pendente) sem wrap na linha de 64px. */
const cadastrosGridTemplate =
  'minmax(0, 1.55fr) minmax(0, 0.58fr) minmax(0, 0.68fr) minmax(0, 0.34fr) minmax(0, 0.44fr) minmax(0, 0.52fr) minmax(220px, 0.95fr)';

// ── Avatar helper ─────────────────────────────────────────────────────────
const renderAvatar = (nome: string, resolvedAvatarUrl?: string | null) => {
  const initial = (nome || '?')[0].toUpperCase();
  const colors = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899'];
  const bg = colors[initial.charCodeAt(0) % colors.length];
  if (resolvedAvatarUrl) return React.createElement('img', { src: resolvedAvatarUrl, alt: nome, style: { width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' as const, flexShrink: 0 } });
  return React.createElement('div', { style: { width: 36, height: 36, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0, ...font } }, initial);
};

export default function MotoristasScreen() {
  const navigate = useNavigate();

  // ── Data ──────────────────────────────────────────────────────────────
  const [motoristasData, setMotoristasData] = useState<MotoristaListItem[]>([]);
  const [tableData, setTableData] = useState<MotoristaTableRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [allProfiles, setAllProfiles] = useState<WorkerApprovalRow[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [approvalFilter, setApprovalFilter] = useState<WorkerApprovalStatus | 'todos'>('todos');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [cadastrosSearch, setCadastrosSearch] = useState('');
  const [resolvedAvatars, setResolvedAvatars] = useState<Record<string, string>>({});
  const [platformFeeDebts, setPlatformFeeDebts] = useState<MotoristaPlatformFeeDebtItem[]>([]);
  useEffect(() => {
    const paths = [...new Set([
      ...tableData.map((t) => t.avatarUrl).filter(Boolean),
      ...allProfiles.map((p) => (p as any).avatarUrl).filter(Boolean),
    ])] as string[];
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const map: Record<string, string> = {};
      for (const p of paths) {
        const url = await resolveStorageDisplayUrl(supabase as any, p);
        if (url) map[p] = url;
      }
      if (!cancelled) setResolvedAvatars(map);
    })();
    return () => { cancelled = true; };
  }, [tableData, allProfiles]);

  useEffect(() => {
    let cancelled = false;
    setProfilesLoading(true);
    Promise.all([
      fetchMotoristas(),
      fetchMotoristaTableRows(),
      fetchAllMotoristaProfiles(),
      fetchMotoristasComTaxaPlataformaDevida(),
    ]).then(([stats, rows, profiles, debts]) => {
      if (!cancelled) {
        setMotoristasData(stats);
        setTableData(rows);
        setAllProfiles(profiles);
        setPlatformFeeDebts(debts);
        setDataLoading(false);
        setProfilesLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    const { error } = await updateWorkerStatus(id, 'approved');
    setActionLoading(null);
    if (error) { showToast('Erro ao aprovar motorista.'); return; }
    setAllProfiles((prev) => prev.map((p) => p.id === id ? { ...p, approvalStatus: 'approved' } : p));
    showToast('Motorista aprovado com sucesso!');
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    const { error } = await updateWorkerStatus(id, 'rejected');
    setActionLoading(null);
    if (error) { showToast('Erro ao rejeitar motorista.'); return; }
    setAllProfiles((prev) => prev.map((p) => p.id === id ? { ...p, approvalStatus: 'rejected' } : p));
    showToast('Motorista rejeitado.');
  };

  const pendingCount = useMemo(() => allProfiles.filter((p) => p.approvalStatus === 'pending').length, [allProfiles]);

  // ── Search & filter state ─────────────────────────────────────────────
  const [filtroOpen, setFiltroOpen] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'em_andamento' | 'agendadas' | 'concluidas' | 'canceladas'>('todos');
  const [filtroCategoria, setFiltroCategoria] = useState<'todos' | 'take_me' | 'parceiro'>('todos');
  const [filtroDateInicio, setFiltroDateInicio] = useState('');
  const [filtroDateFim, setFiltroDateFim] = useState('');

  const [cadastroFiltroOpen, setCadastroFiltroOpen] = useState(false);

  // ── Trocar motorista panel ─────────────────────────────────────────────
  const [trocarOpen, setTrocarOpen] = useState(false);
  const [trocarSelected, setTrocarSelected] = useState(0);
  const [trocarDate, setTrocarDate] = useState('01 de setembro');
  const [trocarMotivo, setTrocarMotivo] = useState('');

  // ── Filtered table data ────────────────────────────────────────────────
  const filteredTableData = useMemo(() => {
    return tableData.filter((t) => {
      if (filtroStatus !== 'todos') {
        const expected = filtroStatus === 'em_andamento' ? 'Em andamento'
          : filtroStatus === 'agendadas' ? 'Agendado'
          : filtroStatus === 'concluidas' ? 'Concluído'
          : 'Cancelado';
        if (t.status !== expected) return false;
      }
      if (filtroCategoria === 'take_me' && t.categoria !== 'take_me') return false;
      if (filtroCategoria === 'parceiro' && t.categoria !== 'parceiro') return false;
      if (filtroDateInicio && t.dataIso && t.dataIso < filtroDateInicio) return false;
      if (filtroDateFim && t.dataIso && t.dataIso > filtroDateFim) return false;
      return true;
    });
  }, [tableData, filtroStatus, filtroCategoria, filtroDateInicio, filtroDateFim]);

  // ── Status counts from filtered table data (for pie chart) ────────────
  const statusCounts = useMemo(() => {
    const c = { concluidas: 0, agendadas: 0, emAndamento: 0, canceladas: 0, total: 0 };
    filteredTableData.forEach((t) => {
      c.total++;
      if (t.status === 'Concluído') c.concluidas++;
      else if (t.status === 'Agendado') c.agendadas++;
      else if (t.status === 'Em andamento') c.emAndamento++;
      else if (t.status === 'Cancelado') c.canceladas++;
    });
    return c;
  }, [filteredTableData]);

  const pieData = useMemo(() => [
    { name: 'Concluídas', value: statusCounts.concluidas, color: '#0d8344' },
    { name: 'Agendadas', value: statusCounts.agendadas, color: '#016df9' },
    { name: 'Em andamento', value: statusCounts.emAndamento, color: '#cba04b' },
    { name: 'Canceladas', value: statusCounts.canceladas, color: '#d64545' },
  ].filter((d) => d.value > 0), [statusCounts]);

  // ── KPI metrics ───────────────────────────────────────────────────────
  // Universo: motoristas cadastrados (worker_profiles). "Em viagem" e
  // "Com viagens agendadas" são derivados cruzando o universo com
  // filteredTableData (scheduled_trips após filtros de período/status/categoria).
  const {
    totalMotoristas,
    emViagem,
    semViagem,
    comAgendadas,
    topDrivers,
    avgRating,
  } = useMemo(() => {
    const driversUniverse = allProfiles.filter((p) => {
      if (filtroCategoria === 'take_me' && p.subtype !== 'take_me') return false;
      if (filtroCategoria === 'parceiro' && p.subtype !== 'parceiro') return false;
      return true;
    });
    const universeIds = new Set(driversUniverse.map((p) => p.id));

    const byDriver = new Map<string, { tripCount: number; emAndamento: boolean; agendadas: boolean }>();
    for (const t of filteredTableData) {
      let cur = byDriver.get(t.driverId);
      if (!cur) {
        cur = { tripCount: 0, emAndamento: false, agendadas: false };
        byDriver.set(t.driverId, cur);
      }
      cur.tripCount++;
      if (t.status === 'Em andamento') cur.emAndamento = true;
      if (t.status === 'Agendado') cur.agendadas = true;
    }

    const totalMotoristas = driversUniverse.length;
    let emViagem = 0;
    let comAgendadas = 0;
    for (const p of driversUniverse) {
      const v = byDriver.get(p.id);
      if (v?.emAndamento) emViagem++;
      if (v?.agendadas) comAgendadas++;
    }
    const semViagem = totalMotoristas - emViagem;

    const idToMeta = new Map(motoristasData.map((m) => [m.id, m]));
    const idToProfile = new Map(driversUniverse.map((p) => [p.id, p]));
    const topDrivers = [...byDriver.entries()]
      .filter(([id]) => universeIds.has(id))
      .sort((a, b) => b[1].tripCount - a[1].tripCount)
      .slice(0, 5)
      .map(([id, v]) => {
        const nome = idToMeta.get(id)?.nome ?? idToProfile.get(id)?.nome ?? 'Sem nome';
        return { id, nome, totalViagens: v.tripCount };
      });

    const ratings = driversUniverse
      .map((p) => p.rating)
      .filter((r): r is number => r != null && r > 0);
    const avgRating = ratings.length > 0
      ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)
      : '—';
    return { totalMotoristas, emViagem, semViagem, comAgendadas, topDrivers, avgRating };
  }, [filteredTableData, motoristasData, allProfiles, filtroCategoria]);

  // ── Pie tooltip ────────────────────────────────────────────────────────
  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const total = statusCounts.total || 1;
    const pct = Math.round((d.value / total) * 100);
    return React.createElement('div', {
      style: { background: '#0d0d0d', color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, ...font, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' },
    }, `${d.name}: ${pct}% (${d.value})`);
  };

  // ── Chip helper ────────────────────────────────────────────────────────
  const fChip = (label: string, active: boolean, onClick: () => void) =>
    React.createElement('button', {
      type: 'button', key: label, onClick,
      style: { padding: '6px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, ...font, background: active ? '#0d0d0d' : '#f1f1f1', color: active ? '#fff' : '#0d0d0d' },
    }, label);

  // ── Cadastros filtered data (must be before early return to preserve hook order) ──
  const filteredProfiles = useMemo(() => {
    return allProfiles.filter((p) => {
      if (approvalFilter !== 'todos' && p.approvalStatus !== approvalFilter) return false;
      if (cadastrosSearch) {
        const q = cadastrosSearch.toLowerCase();
        if (!p.nome.toLowerCase().includes(q) && !(p.phone ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allProfiles, approvalFilter, cadastrosSearch]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (dataLoading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando motoristas...'));
  }

  // ── Metric card ────────────────────────────────────────────────────────
  const metricCard = (title: string, value: string) =>
    React.createElement('div', { key: title, style: { flex: '1 1 0', minWidth: 0, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 24, boxSizing: 'border-box' as const } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, title),
      React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, value));

  const metricCards = React.createElement('div', { style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const } },
    metricCard('Total de motoristas', String(totalMotoristas)),
    metricCard('Motoristas em viagem', String(emViagem)),
    metricCard('Motoristas sem viagem', String(semViagem)),
    metricCard('Com viagens agendadas', String(comAgendadas)));

  // ── Second row: avg rating + top drivers ──────────────────────────────
  const secondRow = React.createElement('div', { style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const } },
    React.createElement('div', { style: { flex: '1 1 calc(50% - 12px)', minWidth: 280, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 16, boxSizing: 'border-box' as const } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Avaliação média geral'),
      React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, avgRating)),
    React.createElement('div', { style: { flex: '1 1 calc(50% - 12px)', minWidth: 280, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 16, boxSizing: 'border-box' as const } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Motoristas com maior número de viagens'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        ...topDrivers.map((d) =>
          React.createElement('p', { key: d.id, style: { fontSize: 14, fontWeight: 400, color: '#0d0d0d', margin: 0, ...font } },
            `${d.totalViagens} viagens • `,
            React.createElement('span', { style: { fontWeight: 700 } }, d.nome))))));

  // ── Pie chart section ─────────────────────────────────────────────────
  const dot = (color: string) => ({ width: 20, height: 20, borderRadius: '50%', background: color, flexShrink: 0 });

  const chartSection = React.createElement('div', { style: { background: '#f6f6f6', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
    React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Distribuição de viagens'),
    React.createElement('p', { style: { fontSize: 14, fontWeight: 400, color: '#767676', margin: 0, ...font } }, 'Dados consolidados com base no período selecionado'),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { width: 280, height: 280, flexShrink: 0 } },
        React.createElement(ResponsiveContainer, { width: '100%', height: '100%' },
          React.createElement(PieChart, null,
            React.createElement(Pie, {
              data: pieData.length ? pieData : [{ name: 'Sem dados', value: 1, color: '#e2e2e2' }],
              cx: '50%', cy: '50%', innerRadius: 0, outerRadius: 120,
              dataKey: 'value', stroke: '#f6f6f6', strokeWidth: 2,
              animationBegin: 0, animationDuration: 800,
            },
              ...(pieData.length ? pieData : [{ name: 'Sem dados', value: 1, color: '#e2e2e2' }]).map((_: any, idx: number) => {
                const data = pieData.length ? pieData : [{ name: 'Sem dados', value: 1, color: '#e2e2e2' }];
                return React.createElement(Cell, { key: `cell-${idx}`, fill: data[idx].color });
              })),
            React.createElement(Tooltip, { content: customTooltip })))),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
        React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, `Total de viagens: ${statusCounts.total}`),
        ...pieData.map((d) => {
          const pct = statusCounts.total > 0 ? Math.round((d.value / statusCounts.total) * 100) : 0;
          return React.createElement('div', { key: d.name, style: { display: 'flex', alignItems: 'center', gap: 10 } },
            React.createElement('div', { style: dot(d.color) }),
            React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, `${d.name}: ${pct}% (${d.value})`));
        }))));

  // ── Search row ─────────────────────────────────────────────────────────
  const searchRow = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, width: '100%', flexWrap: 'wrap' as const },
  },
    React.createElement('button', {
      type: 'button', onClick: () => setFiltroOpen(true), 'data-testid': 'motoristas-open-page-filter',
      style: { display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 16px', borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font },
    }, filterIconSvg, 'Filtros'));

  // ── Filtro modal ───────────────────────────────────────────────────────
  const filtroModal = filtroOpen ? React.createElement('div', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'motoristas-filtro-titulo',
    style: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,0.4)' },
    onClick: () => setFiltroOpen(false),
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: 20, padding: 24, width: 420, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 20, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { id: 'motoristas-filtro-titulo', style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Filtros'),
        React.createElement('button', {
          type: 'button', onClick: () => setFiltroOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, closeSvg)),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Período'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
          React.createElement('label', { style: { fontSize: 13, color: '#767676', ...font } }, 'Data inicial'),
          React.createElement('input', {
            type: 'date', value: filtroDateInicio,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroDateInicio(e.target.value),
            style: { height: 40, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 12px', fontSize: 14, color: '#0d0d0d', outline: 'none', ...font },
          }),
          React.createElement('label', { style: { fontSize: 13, color: '#767676', ...font } }, 'Data final'),
          React.createElement('input', {
            type: 'date', value: filtroDateFim,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroDateFim(e.target.value),
            style: { height: 40, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 12px', fontSize: 14, color: '#0d0d0d', outline: 'none', ...font },
          }))),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Status da viagem'),
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
          fChip('Todos', filtroStatus === 'todos', () => setFiltroStatus('todos')),
          fChip('Em andamento', filtroStatus === 'em_andamento', () => setFiltroStatus('em_andamento')),
          fChip('Agendadas', filtroStatus === 'agendadas', () => setFiltroStatus('agendadas')),
          fChip('Concluídas', filtroStatus === 'concluidas', () => setFiltroStatus('concluidas')),
          fChip('Canceladas', filtroStatus === 'canceladas', () => setFiltroStatus('canceladas')))),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Categoria'),
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
          fChip('Todos', filtroCategoria === 'todos', () => setFiltroCategoria('todos')),
          fChip('Take Me', filtroCategoria === 'take_me', () => setFiltroCategoria('take_me')),
          fChip('Parceiro', filtroCategoria === 'parceiro', () => setFiltroCategoria('parceiro')))),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', {
          type: 'button', onClick: () => setFiltroOpen(false),
          style: { flex: 1, height: 44, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Aplicar'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { setFiltroStatus('todos'); setFiltroCategoria('todos'); setFiltroDateInicio(''); setFiltroDateFim(''); setFiltroOpen(false); },
          style: { flex: 1, height: 44, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 15, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Resetar')))) : null;

  const cadastroFiltroModal = cadastroFiltroOpen ? React.createElement('div', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'motoristas-filtro-cadastro-titulo',
    style: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,0.4)' },
    onClick: () => setCadastroFiltroOpen(false),
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: 20, padding: 24, width: 420, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 20, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { id: 'motoristas-filtro-cadastro-titulo', style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Filtro da lista'),
        React.createElement('button', {
          type: 'button', onClick: () => setCadastroFiltroOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, closeSvg)),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
        React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Buscar por nome ou telefone'),
        React.createElement('input', {
          type: 'text', value: cadastrosSearch, placeholder: 'Ex: João ou 11999...',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCadastrosSearch(e.target.value),
          style: { height: 40, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 12px', fontSize: 14, color: '#0d0d0d', outline: 'none', ...font },
        })),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Status do cadastro'),
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
          fChip('Todos', approvalFilter === 'todos', () => setApprovalFilter('todos')),
          fChip('Pendentes', approvalFilter === 'pending', () => setApprovalFilter('pending')),
          fChip('Aprovados', approvalFilter === 'approved', () => setApprovalFilter('approved')),
          fChip('Rejeitados', approvalFilter === 'rejected', () => setApprovalFilter('rejected')),
          fChip('Suspensos', approvalFilter === 'suspended', () => setApprovalFilter('suspended')))),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', {
          type: 'button', onClick: () => setCadastroFiltroOpen(false),
          style: { flex: 1, height: 44, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Aplicar'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { setCadastrosSearch(''); setApprovalFilter('todos'); setCadastroFiltroOpen(false); },
          style: { flex: 1, height: 44, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 15, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Resetar')))) : null;

  // ── Trocar motorista slide panel ──────────────────────────────────────
  const tmDrivers = tableData.length > 0
    ? [...new Map(tableData.map((t) => [t.driverId, t])).values()].map((t) => ({
        nome: t.nome, rota: `${t.origem} → ${t.destino}`, data: t.data,
        valorTotal: 'R$ 150,00', valorUnitario: 'R$ 75,00', pessoasRestantes: '2', ocupacao: '80%',
      }))
    : [{ nome: 'Motorista', rota: '—', data: '—', valorTotal: '—', valorUnitario: '—', pessoasRestantes: '—', ocupacao: '—' }];

  const radioSvg = (selected: boolean) => React.createElement('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
    React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#0d0d0d', strokeWidth: 2, fill: 'none' }),
    selected ? React.createElement('circle', { cx: 12, cy: 12, r: 5, fill: '#0d0d0d' }) : null);

  const tmField = (label: string, val: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font } }, label),
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, val));

  const trocarMotoristaPanel = trocarOpen ? React.createElement('div', {
    style: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 },
    onClick: () => setTrocarOpen(false),
  },
    React.createElement('div', {
      style: { position: 'fixed' as const, top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 480, background: '#fff', borderRadius: '16px 0 0 16px', padding: '28px 24px', display: 'flex', flexDirection: 'column' as const, gap: 20, overflowY: 'auto' as const, maxHeight: '100vh' },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' } },
        React.createElement('div', null,
          React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Trocar motorista'),
          React.createElement('p', { style: { fontSize: 13, color: '#767676', margin: '4px 0 0', ...font } }, 'Selecione outro motorista disponível para continuar.')),
        React.createElement('button', {
          type: 'button', onClick: () => setTrocarOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, closeSvg)),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Data da atividade'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Data'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px' } },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
            React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
            React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' })),
          React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, trocarDate))),
      React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Viagem atual'),
      ...tmDrivers.slice(0, 1).map((d, i) =>
        React.createElement('button', {
          key: `current-${i}`, type: 'button', onClick: () => setTrocarSelected(i),
          style: { display: 'flex', gap: 12, alignItems: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' as const },
        },
          radioSvg(trocarSelected === i),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
            React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, d.nome),
            tmField('Origem - Destino', d.rota),
            tmField('Data', d.data),
            tmField('Valor total', d.valorTotal),
            tmField('Valor unitário', d.valorUnitario),
            tmField('Pessoas restantes', d.pessoasRestantes),
            tmField('Ocupação do bagageiro', d.ocupacao)))),
      tmDrivers.length > 1 ? React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Outras viagens disponíveis') : null,
      ...tmDrivers.slice(1).map((d, i) =>
        React.createElement('button', {
          key: `other-${i}`, type: 'button', onClick: () => setTrocarSelected(i + 1),
          style: { display: 'flex', gap: 12, alignItems: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' as const },
        },
          radioSvg(trocarSelected === i + 1),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
            React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, d.nome),
            tmField('Origem - Destino', d.rota),
            tmField('Data', d.data),
            tmField('Valor total', d.valorTotal),
            tmField('Valor unitário', d.valorUnitario),
            tmField('Pessoas restantes', d.pessoasRestantes),
            tmField('Ocupação do bagageiro', d.ocupacao)))),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Motivo da troca'),
        React.createElement('textarea', {
          value: trocarMotivo, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setTrocarMotivo(e.target.value),
          placeholder: 'Descreva o motivo da troca...',
          style: { width: '100%', minHeight: 80, borderRadius: 8, border: '1px solid #e2e2e2', padding: 12, fontSize: 14, color: '#0d0d0d', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const, ...font },
        })),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginTop: 8 } },
        React.createElement('button', {
          type: 'button', onClick: () => setTrocarOpen(false),
          style: { height: 48, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Confirmar troca'),
        React.createElement('button', {
          type: 'button', onClick: () => setTrocarOpen(false),
          style: { height: 48, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#0d0d0d', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Cancelar')))) : null;

  const cellBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    fontSize: 14,
    color: '#0d0d0d',
    ...font,
    padding: '0 8px',
    boxSizing: 'border-box' as const,
    minWidth: 0,
  };

  // ── Approval status styles ─────────────────────────────────────────────
  const approvalStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
    pending:   { bg: '#fef3c7', color: '#92400e', label: 'Pendente' },
    approved:  { bg: '#b0e8d1', color: '#174f38', label: 'Aprovado' },
    rejected:  { bg: '#eeafaa', color: '#551611', label: 'Rejeitado' },
    suspended: { bg: '#e5e7eb', color: '#374151', label: 'Suspenso' },
  };

  // ── Lista de motoristas (cadastros) ──
  const approvalCols = [
    { label: 'Motorista' },
    { label: 'Tipo' },
    { label: 'Telefone' },
    { label: 'Avaliação' },
    { label: 'Cadastro' },
    { label: 'Status' },
    { label: 'Ações' },
  ];

  const cadastrosTableRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: cadastrosGridTemplate,
    columnGap: 4,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box' as const,
    alignItems: 'center',
  };

  const cadastroActionBtn: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: 999,
    border: 'none',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    ...font,
  };

  const fmtBRLDebt = (cents: number) =>
    `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const platformFeeDebtsSection = platformFeeDebts.length === 0
    ? null
    : React.createElement('div', { style: { width: '100%', marginBottom: 24 } },
        React.createElement('div', {
          style: {
            background: '#fff8f1',
            borderRadius: 16,
            padding: '20px 24px',
            border: '1px solid #fed7aa',
            boxSizing: 'border-box' as const,
          },
        },
          React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '0 0 8px', ...font } }, 'Saldo devido à plataforma (taxa em viagens a dinheiro)'),
          React.createElement('p', { style: { fontSize: 13, color: '#78716c', margin: '0 0 16px', lineHeight: 1.45, ...font } },
            'Listagem de motoristas com saldo de taxa maior que zero. Use “Ver detalhe” para o ledger e quitação manual.'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10 } },
            ...platformFeeDebts.map((d) =>
              React.createElement('div', {
                key: d.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap' as const,
                  padding: '10px 12px',
                  background: '#fff',
                  borderRadius: 10,
                  border: '1px solid #fde68a',
                },
              },
                React.createElement('span', { style: { fontWeight: 500, fontSize: 14, ...font, flex: '1 1 120px', minWidth: 0 } }, d.nome),
                React.createElement('span', { style: { fontWeight: 700, fontSize: 14, color: '#b45309', ...font } }, fmtBRLDebt(d.platformFeeOwedCents)),
                React.createElement('button', {
                  type: 'button',
                  onClick: () => navigate(`/motoristas/${d.id}/editar`),
                  style: {
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#0d0d0d',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    ...font,
                  },
                }, 'Ver detalhe'))))));

  const cadastroTitleRight = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, justifyContent: 'flex-end' } },
    pendingCount > 0
      ? React.createElement('span', { style: { background: '#fef3c7', color: '#92400e', borderRadius: 999, fontSize: 12, fontWeight: 700, padding: '4px 10px', ...font } }, `${pendingCount} pendente${pendingCount === 1 ? '' : 's'}`)
      : null,
    React.createElement('button', {
      type: 'button', onClick: () => setCadastroFiltroOpen(true), 'data-testid': 'motoristas-open-cadastro-filter',
      style: { display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '8px 24px', background: '#fff', border: 'none', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font },
    }, filterIconSvg, 'Filtro'));

  const motoristasCadastradosSection = profilesLoading
    ? React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', ...font } }, 'Carregando cadastros...')
    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' } },
        React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 80, padding: '20px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0' },
          },
            React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.5, ...font } },
              `Lista de motoristas (${filteredProfiles.length})`),
            cadastroTitleRight),
          React.createElement('div', { style: { width: '100%', minWidth: 0, overflowX: 'auto' as const } },
            React.createElement('div', {
              style: {
                ...cadastrosTableRowStyle,
                height: 53,
                background: '#e2e2e2',
                borderBottom: '1px solid #d9d9d9',
                padding: '0 16px',
              },
            },
              ...approvalCols.map((c, i) => {
                const last = i === approvalCols.length - 1;
                return React.createElement('div', {
                  key: c.label,
                  style: {
                    fontSize: 12,
                    fontWeight: 400,
                    color: '#0d0d0d',
                    ...font,
                    padding: '0 8px',
                    display: 'flex',
                    alignItems: 'center',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' as const,
                    justifyContent: last ? 'flex-end' : 'flex-start',
                    boxSizing: 'border-box' as const,
                  },
                }, c.label);
              })),
            filteredProfiles.length === 0
              ? React.createElement('div', { style: { padding: '32px 24px', color: '#767676', ...font, textAlign: 'center' as const } }, 'Nenhum motorista neste filtro.')
              : React.createElement(React.Fragment, null,
                  ...filteredProfiles.map((p) => {
                    const st = approvalStatusStyle[p.approvalStatus] ?? approvalStatusStyle.pending;
                    const isLoading = actionLoading === p.id;
                    const fmtDate = (iso: string) => {
                      try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; }
                    };
                    const openVisualizar = () => navigate(`/motoristas/${p.id}`);
                    const openEditar = () => navigate(`/motoristas/${p.id}/editar`);
                    return React.createElement('div', {
                      key: p.id,
                      'data-testid': 'motorista-cadastro-row',
                      style: {
                        ...cadastrosTableRowStyle,
                        height: 64,
                        padding: '0 16px',
                        borderBottom: '1px solid #d9d9d9',
                        background: '#f6f6f6',
                      },
                    },
                      React.createElement('div', { style: { ...cellBase, gap: 8, overflow: 'hidden' } },
                        renderAvatar(p.nome, p.avatarUrl ? resolvedAvatars[p.avatarUrl] : null),
                        React.createElement('span', { style: { fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 } }, p.nome),
                        (() => {
                          const c = p.connect;
                          if (!c?.accountId) {
                            return React.createElement('span', { title: 'Sem Stripe Connect', style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' as const, ...font } }, 'sem Connect');
                          }
                          if (c.chargesEnabled && c.payoutsEnabled) {
                            return React.createElement('span', { title: 'Stripe Connect ativo', style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#dcfce7', color: '#166534', whiteSpace: 'nowrap' as const, ...font } }, 'Connect OK');
                          }
                          return React.createElement('span', { title: `charges=${c.chargesEnabled} payouts=${c.payoutsEnabled} details=${c.detailsSubmitted}`, style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' as const, ...font } }, 'Connect pendente');
                        })()),
                      React.createElement('div', { style: { ...cellBase, overflow: 'hidden' } },
                        React.createElement('span', { style: { fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: p.subtype === 'take_me' ? '#dbeafe' : '#f3e8ff', color: p.subtype === 'take_me' ? '#1e40af' : '#6b21a8', whiteSpace: 'nowrap' as const, ...font } },
                          p.subtype === 'take_me' ? 'Take Me' : 'Parceiro')),
                      React.createElement('div', { style: { ...cellBase, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, p.phone ?? '—'),
                      React.createElement('div', { style: { ...cellBase, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } },
                        p.rating != null ? `★ ${p.rating.toFixed(1)}` : '—'),
                      React.createElement('div', { style: { ...cellBase, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, fmtDate(p.createdAt)),
                      React.createElement('div', { style: { ...cellBase, overflow: 'hidden' } },
                        React.createElement('span', {
                          style: { display: 'inline-block', maxWidth: '100%', padding: '4px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', background: st.bg, color: st.color, ...font },
                        }, st.label)),
                      React.createElement('div', { style: { ...cellBase, justifyContent: 'flex-end', gap: 4, flexWrap: 'nowrap' as const, alignItems: 'center' } },
                        React.createElement('button', {
                          type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Visualizar motorista',
                          onClick: openVisualizar,
                        }, eyeActionSvg),
                        React.createElement('button', {
                          type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Editar motorista',
                          onClick: openEditar,
                        }, pencilActionSvg),
                        p.approvalStatus === 'pending' || p.approvalStatus === 'rejected'
                          ? React.createElement('button', {
                              type: 'button', disabled: isLoading,
                              onClick: () => handleApprove(p.id),
                              style: { ...cadastroActionBtn, background: '#0d8344', color: '#fff', cursor: 'pointer', opacity: isLoading ? 0.5 : 1 },
                            }, isLoading ? '...' : 'Aprovar')
                          : null,
                        p.approvalStatus === 'pending'
                          ? React.createElement('button', {
                              type: 'button', disabled: isLoading,
                              onClick: () => handleReject(p.id),
                              style: { ...cadastroActionBtn, background: '#d64545', color: '#fff', cursor: 'pointer', opacity: isLoading ? 0.5 : 1 },
                            }, isLoading ? '...' : 'Rejeitar')
                          : null,
                        p.approvalStatus === 'suspended'
                          ? React.createElement('button', {
                              type: 'button', disabled: isLoading,
                              onClick: () => handleApprove(p.id),
                              style: { ...cadastroActionBtn, background: '#0d8344', color: '#fff', cursor: 'pointer', opacity: isLoading ? 0.5 : 1 },
                            }, isLoading ? '...' : 'Reativar')
                          : null));
                  })))));

  // ── Toast ──────────────────────────────────────────────────────────────
  const toastEl = toastMsg ? React.createElement('div', {
    style: { position: 'fixed' as const, bottom: 32, right: 32, zIndex: 9999, background: '#0d0d0d', color: '#fff', padding: '14px 24px', borderRadius: 12, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', ...font },
  }, toastMsg) : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return React.createElement(React.Fragment, null,
    React.createElement('h1', { style: webStyles.homeTitle }, 'Motoristas'),
    searchRow,
    metricCards,
    secondRow,
    chartSection,
    platformFeeDebtsSection,
    motoristasCadastradosSection,
    trocarMotoristaPanel,
    filtroModal,
    cadastroFiltroModal,
    toastEl);
}
