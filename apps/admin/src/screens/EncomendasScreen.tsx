/**
 * EncomendasScreen — Lista de encomendas conforme Figma 849-37135 (31 Encomendas entregas).
 * Layout: busca + UF + filtros; grade 3×3 de KPIs com ícone arrow_outward; três colunas de barras
 * (tipo de encomenda, top 10 destinos, top 10 origens); tabela Figma 849-37274.
 * Uses React.createElement() (not JSX). Métricas derivadas de filteredEncomendasData.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  webStyles,
  searchIconSvg,
  filterIconSvg,
} from '../styles/webStyles';
import {
  fetchEncomendas,
} from '../data/queries';
import type { EncomendaListItem } from '../data/types';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

// ── SVG icons ──────────────────────────────────────────────────────────────
const eyeActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const pencilActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const mapTripActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', {
    d: 'M12 21s7-4.35 7-10a7 7 0 10-14 0c0 5.65 7 10 7 10z',
    stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  }),
  React.createElement('circle', { cx: 12, cy: 11, r: 2.5, stroke: '#0d0d0d', strokeWidth: 2 }));

const chevronDownSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const closeSmSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

/** Ícone arrow_outward — cards KPI (Figma 849-37135) */
const arrowOutwardSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M7 17L17 7M17 7h-6M17 7v6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// ── Types ──────────────────────────────────────────────────────────────────
type EncomendaRow = {
  id: string;
  destino: string;
  origem: string;
  remetente: string;
  data: string;
  embarque: string;
  chegada: string;
  status: 'Cancelado' | 'Concluído' | 'Agendado' | 'Em andamento';
  rawStatus: string;
  paymentStatus: 'paid' | 'pending' | 'held' | null;
};

type TableCol = {
  label: string;
  flex: string;
  minWidth: number;
  headAlign: 'flex-start' | 'center';
  cellAlign: 'flex-start' | 'center';
};

// ── Constants — colunas conforme Figma 849-37274 (Todas as receitas / lista) ─
const tableCols: TableCol[] = [
  { label: 'Destino', flex: '1 1 14%', minWidth: 120, headAlign: 'flex-start', cellAlign: 'flex-start' },
  { label: 'Origem', flex: '1 1 14%', minWidth: 120, headAlign: 'flex-start', cellAlign: 'flex-start' },
  { label: 'Remetente', flex: '1 1 12%', minWidth: 100, headAlign: 'flex-start', cellAlign: 'flex-start' },
  { label: 'Data', flex: '0 0 96px', minWidth: 96, headAlign: 'flex-start', cellAlign: 'flex-start' },
  { label: 'Embarque', flex: '0 0 80px', minWidth: 80, headAlign: 'flex-start', cellAlign: 'flex-start' },
  { label: 'Chegada', flex: '0 0 80px', minWidth: 80, headAlign: 'flex-start', cellAlign: 'flex-start' },
  { label: 'Status', flex: '0 0 128px', minWidth: 128, headAlign: 'center', cellAlign: 'center' },
  { label: 'Visualizar/Editar', flex: '0 0 188px', minWidth: 188, headAlign: 'center', cellAlign: 'center' },
];

const statusStyles: Record<string, { bg: string; color: string }> = {
  'Cancelado': { bg: '#eeafaa', color: '#551611' },
  'Concluído': { bg: '#b0e8d1', color: '#174f38' },
  'Agendado': { bg: '#a8c6ef', color: '#102d57' },
  'Em andamento': { bg: '#fee59a', color: '#654c01' },
  'Pendente revisão': { bg: '#e8e0f5', color: '#3d2a5c' },
};

/** Texto do chip: `pending_review` não é viagem agendada, mas `mapEncomendaStatus` usa "Agendado". */
function encomendaStatusBadgeLabel(row: EncomendaRow): string {
  if (row.rawStatus === 'pending_review') return 'Pendente revisão';
  return row.status;
}

const UF_NOMES = ['Todos os estados', 'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'];

// ── Helpers ────────────────────────────────────────────────────────────────
const pkgLabel = (ps?: string) => {
  const p = (ps || '').toLowerCase();
  if (p === 'small' || p.includes('pequ')) return 'Pequeno';
  if (p === 'medium' || p.includes('medio') || p.includes('médio')) return 'Médio';
  if (p === 'large' || p === 'xl' || p.includes('grand')) return 'Grande';
  return ps || '—';
};

type PkgBucket = 'pequeno' | 'medio' | 'grande' | 'outro';
function pkgBucket(ps?: string): PkgBucket {
  const p = (ps || '').toLowerCase();
  if (p === 'small' || p.includes('pequ')) return 'pequeno';
  if (p === 'medium' || p.includes('medio') || p.includes('médio')) return 'medio';
  if (p === 'large' || p === 'xl' || p.includes('grand')) return 'grande';
  return 'outro';
}

const fmtBRL = (cents: number) =>
  cents > 0 ? `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

function toEncomendaRow(e: EncomendaListItem): EncomendaRow {
  return {
    id: e.id,
    destino: e.destino,
    origem: e.origem,
    remetente: e.remetente,
    data: e.data,
    embarque: e.embarque,
    chegada: e.chegada,
    status: e.status,
    rawStatus: e.rawStatus,
    paymentStatus: e.paymentStatus ?? null,
  };
}

function paymentBadgeEl(status: EncomendaRow['paymentStatus']): React.ReactNode {
  const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };
  if (status === 'held') {
    return React.createElement('span', { title: 'Payout com erro (retido)', style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' as const, ...font } }, 'retido');
  }
  if (status === 'paid') {
    return React.createElement('span', { title: 'Payouts liquidados', style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#dcfce7', color: '#166534', whiteSpace: 'nowrap' as const, ...font } }, 'pago');
  }
  if (status === 'pending') {
    return React.createElement('span', { title: 'Cobrado — aguardando liquidacao do payout', style: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' as const, ...font } }, 'pendente');
  }
  return null;
}

function isoDatePartLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Local styles (Figma 849-37135 — cards 332×205, colunas de barras) ─────
const enc = {
  kpiGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 24, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  kpiCell: {
    flex: '1 1 calc((100% - 48px) / 3)', minWidth: 280, maxWidth: '100%', boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  kpiCard: {
    background: '#f6f6f6', borderRadius: 16, padding: '0 24px 24px', minHeight: 205, boxSizing: 'border-box' as const,
    display: 'flex', flexDirection: 'column' as const, alignItems: 'stretch', width: '100%',
  } as React.CSSProperties,
  kpiHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minHeight: 60, paddingTop: 16 } as React.CSSProperties,
  kpiTitle: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.5, ...font } as React.CSSProperties,
  kpiArrowBtn: {
    width: 44, height: 44, borderRadius: '50%', background: '#fff', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
  } as React.CSSProperties,
  kpiSub: { fontSize: 14, fontWeight: 600, color: '#0b6d39', margin: '0 0 8px', minHeight: 21, ...font } as React.CSSProperties,
  kpiSubMuted: { fontSize: 14, fontWeight: 400, color: '#767676', margin: '0 0 8px', minHeight: 21, ...font } as React.CSSProperties,
  kpiValue: { fontSize: 40, fontWeight: 700, color: '#0d0d0d', margin: 0, lineHeight: 1.1, ...font } as React.CSSProperties,
  kpiValueRow: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'baseline', gap: 8 } as React.CSSProperties,
  kpiValueHint: { fontSize: 14, fontWeight: 400, color: '#767676', maxWidth: 140, lineHeight: 1.2, ...font } as React.CSSProperties,
  analyticsRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 24, width: '100%', alignItems: 'stretch' as const, boxSizing: 'border-box' as const } as React.CSSProperties,
  analyticsCol: {
    flex: '1 1 calc((100% - 48px) / 3)', minWidth: 280, maxWidth: '100%', background: '#f6f6f6', borderRadius: 16,
    padding: '32px 24px 24px', boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  analyticsTitle: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '0 0 24px', ...font } as React.CSSProperties,
  barBlock: { marginBottom: 24 } as React.CSSProperties,
  barLabelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 } as React.CSSProperties,
  barLabel: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } as React.CSSProperties,
  barCount: { fontSize: 14, fontWeight: 400, color: '#767676', whiteSpace: 'nowrap' as const, ...font } as React.CSSProperties,
  barTrack: { width: '100%', height: 8, background: '#e2e2e2', borderRadius: 4, overflow: 'hidden' as const } as React.CSSProperties,
  barPct: { fontSize: 12, fontWeight: 600, color: '#0d0d0d', marginTop: 6, textAlign: 'right' as const, ...font } as React.CSSProperties,
};

// ── Component ──────────────────────────────────────────────────────────────
export default function EncomendasScreen() {
  const navigate = useNavigate();

  const [toastMsg, setToastMsg] = useState('');
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }, []);

  // ── Raw data ─────────────────────────────────────────────────────────────
  const [allEncomendasData, setAllEncomendasData] = useState<EncomendaListItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ── Estado do dropdown de estados ────────────────────────────────────────
  const [estadosOpen, setEstadosOpen] = useState(false);
  const [estadoSel, setEstadoSel] = useState('Todos os estados');

  // ── Filtro modal página ───────────────────────────────────────────────────
  const [filtroOpen, setFiltroOpen] = useState(false);
  const [filtroDataIni, setFiltroDataIni] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'Em andamento' | 'Agendado' | 'Concluído' | 'Cancelado'>('todos');
  const [filtroCategoria, setFiltroCategoria] = useState<'todos' | 'shipment' | 'dependent_shipment'>('todos');

  // ── Filtro modal tabela ───────────────────────────────────────────────────
  const [tblFiltroOpen, setTblFiltroOpen] = useState(false);
  const [tblOrigem, setTblOrigem] = useState('');
  const [tblDestino, setTblDestino] = useState('');
  const [tblRemetente, setTblRemetente] = useState('');
  const [tblDestinatario, setTblDestinatario] = useState('');
  const [tblCodigo, setTblCodigo] = useState('');
  const [tblDataInicial, setTblDataInicial] = useState('');
  const [tblStatusEncomenda, setTblStatusEncomenda] = useState<'todos' | 'Em andamento' | 'Agendado' | 'Concluído' | 'Cancelado'>('todos');
  const [tblTipoEncomenda, setTblTipoEncomenda] = useState('Todos');

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchEncomendas().then((items) => {
      if (!cancelled) { setAllEncomendasData(items); setDataLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  // ── Filtered data (página) → base para KPIs e gráfico ───────────────────
  const filteredEncomendasData = useMemo(() => {
    return allEncomendasData.filter((e) => {
      if (filtroStatus !== 'todos' && e.status !== filtroStatus) return false;
      if (filtroCategoria !== 'todos' && e.tipo !== filtroCategoria) return false;
      if (filtroDataIni && e.createdAtIso) {
        const day = isoDatePartLocal(e.createdAtIso);
        if (day && day < filtroDataIni) return false;
      }
      if (filtroDataFim && e.createdAtIso) {
        const day = isoDatePartLocal(e.createdAtIso);
        if (day && day > filtroDataFim) return false;
      }
      if (estadoSel !== 'Todos os estados') {
        const n = estadoSel.toLowerCase();
        const o = e.origem.toLowerCase();
        const d = e.destino.toLowerCase();
        if (!o.includes(n) && !d.includes(n)) return false;
      }
      return true;
    });
  }, [allEncomendasData, filtroStatus, filtroCategoria, filtroDataIni, filtroDataFim, estadoSel]);

  // ── Counts (derivados de filteredEncomendasData) ─────────────────────────
  const counts = useMemo(() => ({
    total: filteredEncomendasData.length,
    emAndamento: filteredEncomendasData.filter((e) => e.status === 'Em andamento').length,
    agendadas: filteredEncomendasData.filter((e) => e.status === 'Agendado').length,
    concluidas: filteredEncomendasData.filter((e) => e.status === 'Concluído').length,
    canceladas: filteredEncomendasData.filter((e) => e.status === 'Cancelado').length,
  }), [filteredEncomendasData]);

  // ── Table rows (filtros de tabela sobre filteredEncomendasData) ───────────
  const tableRows = useMemo((): EncomendaRow[] => {
    return filteredEncomendasData.filter((e) => {
      // busca global
      const q = search.trim().toLowerCase();
      if (q && !`${e.origem} ${e.destino} ${e.remetente}`.toLowerCase().includes(q)) return false;
      // filtros tabela
      if (tblOrigem && !e.origem.toLowerCase().includes(tblOrigem.toLowerCase())) return false;
      if (tblDestino && !e.destino.toLowerCase().includes(tblDestino.toLowerCase())) return false;
      if (tblRemetente && !e.remetente.toLowerCase().includes(tblRemetente.toLowerCase())) return false;
      if (tblStatusEncomenda !== 'todos' && e.status !== tblStatusEncomenda) return false;
      if (tblTipoEncomenda !== 'Todos') {
        const pkg = (e.packageSize || '').toLowerCase();
        if (tblTipoEncomenda === 'Pequeno' && !['small', 'pequeño', 'pequ', 'pequen', 'pequena'].some((v) => pkg.includes(v))) return false;
        if (tblTipoEncomenda === 'Medio' && !['medium', 'medio', 'médio'].some((v) => pkg.includes(v))) return false;
        if (tblTipoEncomenda === 'Grande' && !['large', 'xl', 'grand'].some((v) => pkg.includes(v))) return false;
      }
      if (tblCodigo) {
        const cod = tblCodigo.replace(/^#/, '').trim().toLowerCase();
        if (!e.id.toLowerCase().includes(cod)) return false;
      }
      if (tblDestinatario && !e.remetente.toLowerCase().includes(tblDestinatario.toLowerCase())) return false;
      if (tblDataInicial && e.createdAtIso) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(tblDataInicial)) {
          const day = isoDatePartLocal(e.createdAtIso);
          if (day && day < tblDataInicial) return false;
        }
      }
      return true;
    }).map((e) => toEncomendaRow(e));
  }, [filteredEncomendasData, search, tblOrigem, tblDestino, tblRemetente, tblStatusEncomenda, tblTipoEncomenda, tblCodigo, tblDestinatario, tblDataInicial]);

  // ── Top destinos/origens (sobre filteredEncomendasData) ──────────────────
  const { topDestinos, topOrigens } = useMemo(() => {
    const destMap = new Map<string, number>();
    const origMap = new Map<string, number>();
    for (const e of filteredEncomendasData) {
      destMap.set(e.destino, (destMap.get(e.destino) ?? 0) + 1);
      origMap.set(e.origem, (origMap.get(e.origem) ?? 0) + 1);
    }
    const total = filteredEncomendasData.length || 1;
    const td = Array.from(destMap.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([label, count]) => ({ label, pct: Math.round((count / total) * 100), entregasLabel: `${count} entregas` }));
    const to = Array.from(origMap.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([label, count]) => ({ label, pct: Math.round((count / total) * 100), entregasLabel: `${count} entregas` }));
    return { topDestinos: td, topOrigens: to };
  }, [filteredEncomendasData]);

  const filtroPaginaAtivo = useMemo(() =>
    filtroStatus !== 'todos' || filtroCategoria !== 'todos' || Boolean(filtroDataIni) || Boolean(filtroDataFim),
  [filtroStatus, filtroCategoria, filtroDataIni, filtroDataFim]);

  const kpiContextSub = filtroPaginaAtivo ? 'Conjunto filtrado' : 'Base completa';

  const tipoEncomendaBars = useMemo(() => {
    let peq = 0; let med = 0; let gra = 0; let out = 0;
    for (const e of filteredEncomendasData) {
      const b = pkgBucket(e.packageSize);
      if (b === 'pequeno') peq++;
      else if (b === 'medio') med++;
      else if (b === 'grande') gra++;
      else out++;
    }
    const total = filteredEncomendasData.length || 1;
    const row = (label: string, count: number) => ({
      label,
      count,
      entregasLabel: `${count} entregas`,
      pct: Math.round((count / total) * 100),
    });
    const rows = [row('Pequena', peq), row('Média', med), row('Grande', gra)];
    if (out > 0) rows.push(row('Sem tamanho / bagagem', out));
    return rows;
  }, [filteredEncomendasData]);

  const avgPrecoPorTamanho = useMemo(() => {
    type Acc = { sum: number; n: number };
    const acc: Record<'pequeno' | 'medio' | 'grande', Acc> = {
      pequeno: { sum: 0, n: 0 }, medio: { sum: 0, n: 0 }, grande: { sum: 0, n: 0 },
    };
    for (const e of filteredEncomendasData) {
      if (e.amountCents <= 0) continue;
      const b = pkgBucket(e.packageSize);
      if (b === 'pequeno' || b === 'medio' || b === 'grande') {
        acc[b].sum += e.amountCents;
        acc[b].n += 1;
      }
    }
    const one = (a: Acc) => (a.n === 0 ? '—' : fmtBRL(Math.round(a.sum / a.n)));
    return { pequena: one(acc.pequeno), media: one(acc.medio), grande: one(acc.grande) };
  }, [filteredEncomendasData]);

  const mediaEntregasDia = useMemo(() => {
    const list = filteredEncomendasData.filter((e) => e.createdAtIso);
    if (list.length === 0) return { text: '—', sub: '' as string };
    const ts = list
      .map((e) => new Date(e.createdAtIso).getTime())
      .filter((t) => !Number.isNaN(t));
    if (ts.length === 0) return { text: '—', sub: '' };
    const minT = Math.min(...ts);
    const maxT = Math.max(...ts);
    const dayMs = 86400000;
    const spanDays = Math.max(1, Math.floor((maxT - minT) / dayMs) + 1);
    const v = list.length / spanDays;
    return {
      text: v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      sub: 'Até o momento',
    };
  }, [filteredEncomendasData]);

  // ── Refetch after action ──────────────────────────────────────────────────
  const refetch = async () => {
    const items = await fetchEncomendas();
    setAllEncomendasData(items);
  };

  // ── Chip helpers ──────────────────────────────────────────────────────────
  const fChip = (label: string, active: boolean, onClick: () => void) =>
    React.createElement('button', {
      type: 'button', key: label, onClick,
      style: {
        padding: '6px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 600, ...font,
        background: active ? '#0d0d0d' : '#f1f1f1',
        color: active ? '#fff' : '#0d0d0d',
      },
    }, label);

  const tblField = (label: string, placeholder: string, value: string, onChange: (v: string) => void) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, label),
      React.createElement('input', {
        type: 'text', value, placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
        style: { height: 44, borderRadius: 8, background: '#f1f1f1', border: 'none', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', ...font },
      }));

  const tblDateInput = (label: string, value: string, onChange: (v: string) => void) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, label),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, background: '#f1f1f1', borderRadius: 8, padding: '0 12px 0 16px', gap: 8 } },
        React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
          React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' })),
        React.createElement('input', {
          type: 'date', value,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          'aria-label': label,
          style: { flex: 1, minWidth: 0, height: 40, border: 'none', background: 'transparent', fontSize: 14, color: value ? '#0d0d0d' : '#767676', outline: 'none', ...font },
        })));

  // ── Loading state ─────────────────────────────────────────────────────────
  if (dataLoading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', fontFamily: 'Inter, sans-serif' } }, 'Carregando encomendas...'));
  }

  const kpiCardEl = (
    title: string,
    value: React.ReactNode,
    sub?: React.ReactNode,
    subMuted?: boolean,
    valueRowExtra?: React.ReactNode,
  ) =>
    React.createElement('div', { key: title, style: enc.kpiCell },
      React.createElement('div', { style: enc.kpiCard },
        React.createElement('div', { style: enc.kpiHead },
          React.createElement('h2', { style: enc.kpiTitle }, title),
          React.createElement('button', { type: 'button', style: enc.kpiArrowBtn, 'aria-label': 'Detalhe do indicador' }, arrowOutwardSvg)),
        sub != null && sub !== ''
          ? React.createElement('p', { style: subMuted ? enc.kpiSubMuted : enc.kpiSub }, sub)
          : React.createElement('p', { style: enc.kpiSubMuted }, '\u00a0'),
        React.createElement('div', { style: enc.kpiValueRow },
          React.createElement('p', { style: enc.kpiValue }, value),
          valueRowExtra ?? null)));

  const kpiGrid = React.createElement('div', { style: enc.kpiGrid },
    kpiCardEl('Total de Entregas', String(counts.total), kpiContextSub, true),
    kpiCardEl('Entregas Concluídas', String(counts.concluidas), kpiContextSub, true),
    kpiCardEl('Em Andamento', String(counts.emAndamento), 'Ativas', true),
    kpiCardEl('Agendadas', String(counts.agendadas), kpiContextSub, true),
    kpiCardEl('Canceladas', String(counts.canceladas), kpiContextSub, true),
    kpiCardEl('Média de Entregas/Dia', mediaEntregasDia.text, '', true,
      mediaEntregasDia.sub
        ? React.createElement('span', { style: enc.kpiValueHint }, mediaEntregasDia.sub)
        : undefined),
    kpiCardEl('Média de preço - Pequena', avgPrecoPorTamanho.pequena, '', true,
      React.createElement('span', { style: enc.kpiValueHint }, 'Por entrega')),
    kpiCardEl('Média de preço - Médio', avgPrecoPorTamanho.media, '', true,
      React.createElement('span', { style: enc.kpiValueHint }, 'Por entrega')),
    kpiCardEl('Média de preço - Grande', avgPrecoPorTamanho.grande, '', true,
      React.createElement('span', { style: enc.kpiValueHint }, 'Por entrega')));

  const barRowEl = (item: { label: string; pct: number; entregasLabel: string }, fill: string) =>
    React.createElement('div', { key: item.label, style: enc.barBlock },
      React.createElement('div', { style: enc.barLabelRow },
        React.createElement('span', { style: enc.barLabel }, item.label),
        React.createElement('span', { style: enc.barCount }, item.entregasLabel)),
      React.createElement('div', { style: enc.barTrack },
        React.createElement('div', { style: { width: `${item.pct}%`, height: '100%', background: fill, borderRadius: 4, minWidth: item.pct > 0 ? 2 : 0 } })),
      React.createElement('div', { style: enc.barPct }, `${item.pct}%`));

  const analyticsCol = (title: string, rows: { label: string; pct: number; entregasLabel: string }[], fill: string) =>
    React.createElement('div', { style: enc.analyticsCol },
      React.createElement('h3', { style: enc.analyticsTitle }, title),
      ...rows.map((r) => barRowEl(r, fill)));

  const tipoCol = React.createElement('div', { style: enc.analyticsCol },
    React.createElement('h3', { style: enc.analyticsTitle }, 'Tipo de encomenda'),
    ...tipoEncomendaBars.map((r) => barRowEl(
      { label: r.label, pct: r.pct, entregasLabel: r.entregasLabel },
      '#0d0d0d',
    )));

  const destinosCol = analyticsCol('Principais destinos (top 10)', topDestinos, '#016df9');
  const origensCol = analyticsCol('Principais origens (top 10)', topOrigens, '#cba04b');

  const analyticsSection = React.createElement('div', { style: enc.analyticsRow }, tipoCol, destinosCol, origensCol);

  // ── Search row (campo à esquerda — Figma 849-37140) ───────────────────────
  const searchRow = React.createElement('div', { style: { ...webStyles.searchRow, alignItems: 'center' } },
    React.createElement('div', { style: { ...webStyles.filterGroup, flexShrink: 0, marginLeft: 'auto' } },
      React.createElement('div', { style: { width: 1, height: 16, background: '#e2e2e2', flexShrink: 0 } }),
      React.createElement('div', { style: { position: 'relative' as const } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setEstadosOpen(!estadosOpen),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px',
            background: '#f1f1f1', border: 'none', borderRadius: 999,
            fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font, whiteSpace: 'nowrap' as const,
          },
        }, estadoSel, chevronDownSvg),
        estadosOpen ? React.createElement('div', {
          style: {
            position: 'absolute' as const, top: 52, right: 0, background: '#fff', borderRadius: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)', minWidth: 240, maxHeight: 300,
            overflowY: 'auto' as const, zIndex: 50,
          },
        },
          ...UF_NOMES.map((uf, i, arr) =>
            React.createElement('button', {
              key: uf, type: 'button',
              onClick: () => { setEstadoSel(uf); setEstadosOpen(false); },
              style: {
                display: 'block', width: '100%', padding: '14px 20px', background: 'none',
                borderTop: 'none', borderRight: 'none', borderLeft: 'none',
                borderBottom: i < arr.length - 1 ? '1px solid #f1f1f1' : 'none',
                fontSize: 14, fontWeight: estadoSel === uf ? 600 : 400,
                color: estadoSel === uf ? '#0d0d0d' : '#767676', cursor: 'pointer', textAlign: 'left' as const, ...font,
              },
            }, uf))) : null),
      React.createElement('button', {
        type: 'button',
        onClick: () => setFiltroOpen(true),
        style: webStyles.filterBtn,
      }, filterIconSvg, 'Filtros')));

  // ── Table section (Figma 849-37274 — Lista de encomendas) ─────────────────
  const tableCellBase = (col: TableCol, extra: React.CSSProperties = {}): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: col.cellAlign,
    fontSize: 14,
    fontWeight: 500,
    color: '#0d0d0d',
    ...font,
    padding: '0 10px',
    flex: col.flex,
    minWidth: col.minWidth,
    boxSizing: 'border-box' as const,
    ...extra,
  });

  const tableToolbar = React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      minHeight: 80, padding: '20px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0',
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.5, ...font } }, 'Lista de encomendas'),
    React.createElement('button', {
      type: 'button',
      onClick: () => setTblFiltroOpen(true),
      'data-testid': 'encomendas-open-table-filter',
      style: {
        display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '8px 24px',
        background: '#fff', border: 'none', borderRadius: 999, cursor: 'pointer',
        fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font,
        boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.06)',
      },
    }, filterIconSvg, 'Filtro'));

  const tableHeader = React.createElement('div', {
    style: {
      display: 'flex', minHeight: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9',
      padding: '0 28px', alignItems: 'center', boxSizing: 'border-box' as const,
    },
  },
    ...tableCols.map((c) => React.createElement('div', {
      key: c.label,
      style: {
        flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font,
        padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: c.headAlign,
        minHeight: 53, boxSizing: 'border-box' as const,
      },
    }, c.label)));

  const tableRowEls = tableRows.map((row, rowIdx) => {
    const badgeLabel = encomendaStatusBadgeLabel(row);
    const st = statusStyles[badgeLabel] ?? statusStyles[row.status] ?? { bg: '#e2e2e2', color: '#555' };
    const item = allEncomendasData.find((x) => x.id === row.id);
    const rowBg = rowIdx % 2 === 1 ? '#fafafa' : '#ffffff';
    const cells: React.ReactNode[] = [
      React.createElement('div', { key: 'd', style: tableCellBase(tableCols[0]) }, row.destino),
      React.createElement('div', { key: 'o', style: tableCellBase(tableCols[1]) }, row.origem),
      React.createElement('div', { key: 'r', style: tableCellBase(tableCols[2]) }, row.remetente),
      React.createElement('div', { key: 'dt', style: tableCellBase(tableCols[3], { fontWeight: 400 }) }, row.data),
      React.createElement('div', { key: 'emb', style: tableCellBase(tableCols[4], { fontWeight: 400 }) }, row.embarque),
      React.createElement('div', { key: 'chg', style: tableCellBase(tableCols[5], { fontWeight: 400 }) }, row.chegada),
      React.createElement('div', { key: 'st', style: { ...tableCellBase(tableCols[6]), flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', {
          style: {
            display: 'inline-block', padding: '4px 12px', borderRadius: 999,
            fontSize: 13, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'nowrap' as const,
            background: st.bg, color: st.color, ...font,
          },
        }, badgeLabel),
        paymentBadgeEl(row.paymentStatus)),
      React.createElement('div', {
        key: 'act',
        style: {
          ...tableCellBase(tableCols[7]),
          gap: 4,
        },
      },
        React.createElement('button', {
          type: 'button',
          style: { ...webStyles.viagensActionBtn, cursor: 'pointer' },
          'aria-label': 'Ver detalhe da encomenda',
          title: 'Valores, remetente e dados do envio',
          onClick: () => { if (item) navigate(`/encomendas/${item.id}`); },
        }, eyeActionSvg),
        item?.scheduledTripId && item.tipo === 'shipment'
          ? React.createElement('button', {
            type: 'button',
            style: { ...webStyles.viagensActionBtn, cursor: 'pointer' },
            'aria-label': 'Ver viagem no mapa',
            title: 'Roteiro e painel da viagem agendada',
            onClick: () => {
              if (!item?.scheduledTripId) return;
              navigate(`/encomendas/${item.id}/viagem/${item.scheduledTripId}`);
            },
          }, mapTripActionSvg)
          : null,
        React.createElement('button', {
          type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Editar',
          onClick: () => { if (item) navigate(`/encomendas/${item.id}/editar`, { state: { from: 'encomendas' } }); },
        }, pencilActionSvg),
        row.rawStatus === 'pending_review' && item?.supportConversationId ? React.createElement('button', {
          type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Ver atendimento',
          title: 'Abrir atendimento vinculado',
          onClick: () => navigate(`/atendimentos/${item.supportConversationId}`),
        }, React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', stroke: '#6366f1', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))) : null),
    ];
    return React.createElement('div', {
      key: row.id,
      'data-testid': 'encomenda-table-row',
      style: {
        display: 'flex', minHeight: 64, alignItems: 'center', padding: '0 28px',
        borderBottom: '1px solid #e8e8e8', background: rowBg, boxSizing: 'border-box' as const,
      },
    }, ...cells);
  });

  const tableSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%',
        boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.04)', border: '1px solid #efefef', boxSizing: 'border-box' as const,
      },
    },
      tableToolbar,
      React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } },
        tableHeader,
        ...tableRowEls)));

  // ── Modal filtro página ───────────────────────────────────────────────────
  const filtroModal = filtroOpen ? React.createElement('div', {
    role: 'dialog', 'aria-modal': true,
    style: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 24, background: 'rgba(0,0,0,0.18)' },
    onClick: () => setFiltroOpen(false),
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: 20, padding: 24, width: 360, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 20, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Filtro'),
        React.createElement('button', {
          type: 'button', onClick: () => setFiltroOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, closeSmSvg)),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Data
      React.createElement('h3', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Data da atividade'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Data inicial'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, background: '#f1f1f1', borderRadius: 8, padding: '0 12px 0 16px', gap: 8 } },
            React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
              React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
              React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' })),
            React.createElement('input', {
              type: 'date', value: filtroDataIni,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroDataIni(e.target.value),
              'aria-label': 'Data inicial',
              style: { flex: 1, minWidth: 0, height: 40, border: 'none', background: 'transparent', fontSize: 14, color: filtroDataIni ? '#0d0d0d' : '#767676', outline: 'none', ...font },
            }))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Data final'),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, background: '#f1f1f1', borderRadius: 8, padding: '0 12px 0 16px', gap: 8 } },
            React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
              React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
              React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' })),
            React.createElement('input', {
              type: 'date', value: filtroDataFim,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroDataFim(e.target.value),
              'aria-label': 'Data final',
              style: { flex: 1, minWidth: 0, height: 40, border: 'none', background: 'transparent', fontSize: 14, color: filtroDataFim ? '#0d0d0d' : '#767676', outline: 'none', ...font },
            })))),
      // Status
      React.createElement('h3', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Status da encomenda'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
        ...(['todos', 'Em andamento', 'Agendado', 'Concluído', 'Cancelado'] as const).map((st) =>
          fChip(st === 'todos' ? 'Todos' : st, filtroStatus === st, () => setFiltroStatus(st)))),
      // Categoria
      React.createElement('h3', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Categoria'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
        fChip('Todos', filtroCategoria === 'todos', () => setFiltroCategoria('todos')),
        fChip('Entregas', filtroCategoria === 'shipment', () => setFiltroCategoria('shipment')),
        fChip('Bagagens', filtroCategoria === 'dependent_shipment', () => setFiltroCategoria('dependent_shipment'))),
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 12, marginTop: 4 } },
        React.createElement('button', {
          type: 'button', onClick: () => setFiltroOpen(false),
          style: { flex: 1, height: 44, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Aplicar filtro'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { setFiltroStatus('todos'); setFiltroCategoria('todos'); setFiltroDataIni(''); setFiltroDataFim(''); },
          style: { flex: 1, height: 44, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Resetar filtros')))) : null;

  // ── Modal filtro tabela ───────────────────────────────────────────────────
  const tblFiltroModal = tblFiltroOpen ? React.createElement('div', {
    role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'encomendas-filtro-tabela-titulo',
    style: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 24, background: 'rgba(0,0,0,0.18)' },
    onClick: () => setTblFiltroOpen(false),
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: 20, padding: 24, width: 400, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { id: 'encomendas-filtro-tabela-titulo', style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Filtro da tabela'),
        React.createElement('button', {
          type: 'button', onClick: () => setTblFiltroOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, closeSmSvg)),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Fields
      tblField('Origem', 'Ex: São Paulo, SP', tblOrigem, setTblOrigem),
      tblField('Destino', 'Ex: São Luís, MA', tblDestino, setTblDestino),
      tblDateInput('Data inicial', tblDataInicial, setTblDataInicial),
      tblField('Remetente', 'Ex: Nome do remetente', tblRemetente, setTblRemetente),
      tblField('Destinatário', 'Ex: Nome do destinatário', tblDestinatario, setTblDestinatario),
      tblField('Código da encomenda', 'Ex: #3421341342', tblCodigo, setTblCodigo),
      // Status
      React.createElement('h3', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Status da encomenda'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
        ...(['todos', 'Em andamento', 'Agendado', 'Concluído', 'Cancelado'] as const).map((st) =>
          fChip(st === 'todos' ? 'Todos' : st, tblStatusEncomenda === st, () => setTblStatusEncomenda(st)))),
      // Tipo de encomenda
      React.createElement('h3', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Tipo de encomenda'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
        ...['Todos', 'Pequeno', 'Medio', 'Grande'].map((t) =>
          fChip(t, tblTipoEncomenda === t, () => setTblTipoEncomenda(t)))),
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 12, marginTop: 4 } },
        React.createElement('button', {
          type: 'button', onClick: () => setTblFiltroOpen(false),
          style: { flex: 1, height: 44, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Aplicar filtro'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { setTblOrigem(''); setTblDestino(''); setTblRemetente(''); setTblDestinatario(''); setTblCodigo(''); setTblDataInicial(''); setTblStatusEncomenda('todos'); setTblTipoEncomenda('Todos'); },
          style: { flex: 1, height: 44, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Resetar filtros')))) : null;

  const toastEl = toastMsg
    ? React.createElement('div', {
      role: 'status',
      style: {
        position: 'fixed' as const, bottom: 24, right: 24, maxWidth: 360,
        background: '#0d0d0d', color: '#fff', padding: '12px 20px', borderRadius: 12,
        fontSize: 14, fontWeight: 500, zIndex: 2000, boxShadow: '0 8px 30px rgba(0,0,0,0.2)', ...font,
      },
    }, toastMsg)
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return React.createElement(React.Fragment, null,
    toastEl,
    React.createElement('h1', { style: webStyles.homeTitle }, 'Encomendas'),
    searchRow,
    kpiGrid,
    analyticsSection,
    tableSection,
    filtroModal,
    tblFiltroModal);
}
