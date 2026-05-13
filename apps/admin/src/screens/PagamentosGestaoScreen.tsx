/**
 * PagamentosGestaoScreen — Gestão de pagamentos conforme Figma 905-22168.
 * Modal filtro da tabela: Figma 905-22659.
 * Modal editar forma de pagamento: Figma 905-23064.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  webStyles,
  filterIconSvg,
} from '../styles/webStyles';
import { preparadorEncomendaSlug } from '../utils/preparadorSlug';
import {
  fetchPricingRoutes,
  fetchSurchargeCatalog,
  fetchWorkerRatings,
  fetchMotoristas,
  fetchBases,
  createBase,
  deletePricingRoute,
  updatePricingRoute,
  fetchPreparadores,
  fetchWorkerSubtypesForGestao,
  motoristasToGestaoRows,
  slugifyMotoristaNome,
} from '../data/queries';
import type { PricingRouteRow, SurchargeCatalogRow, MotoristaListItem, PreparadorListItem } from '../data/types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { RatingListItem, BaseListItem } from '../data/queries';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const calendarSvgLg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const closeModalSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

type GestPeriodoFiltro = 'semana' | 'mes' | 'ano';
type GestPrimarioFiltro = 'todos' | 'takeme' | 'parceiros';
type GestSecundarioFiltro = 'todos' | 'viagem' | 'excursao';

type GestAppliedFiltro = {
  periodo: GestPeriodoFiltro;
  primario: GestPrimarioFiltro;
  secundario: GestSecundarioFiltro;
  dataIni?: string;
  dataFim?: string;
};

function getPeriodRangeGest(t: GestPeriodoFiltro): { start: Date; end: Date } {
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

function parseDateBR(dataInicio: string): Date | null {
  const m = dataInicio.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function motoristaDataInPeriod(dataInicio: string, rangeStart: Date, rangeEnd: Date): boolean {
  const dt = parseDateBR(dataInicio);
  if (!dt) return true;
  const t = dt.getTime();
  return t >= rangeStart.getTime() && t <= rangeEnd.getTime();
}

const chipFiltroGest = (label: string, selecionado: boolean, onClick: () => void) =>
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

// SVG icons
const eyeActionSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const starSvg = React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: '#cba04b', style: { display: 'block' } },
  React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }));

const tabs = ['Motorista', 'Encomenda', 'Trecho', 'Preparadores', 'Adicionais', 'Avaliações', 'Bases'] as const;

function tabFromQueryParam(v: string | null): typeof tabs[number] | null {
  if (v == null || !v.trim()) return null;
  const lower = v.trim().toLowerCase();
  return tabs.find((t) => t.toLowerCase() === lower) ?? null;
}

const avatarColors: Record<string, string> = {
  C: '#4A90D9', J: '#7B61FF', E: '#50C878', M: '#F5A623', D: '#9B59B6',
};

type MotoristaRow = {
  nome: string;
  rating: number;
  numTrechos: string;
  horario: string;
  dataInicio: string;
  primaryTipo: 'takeme' | 'parceiros';
  secondaryTipo: 'viagem' | 'excursao';
  driverId: string;
};

const tableCols = [
  { label: 'Motorista', flex: '1 1 25%', minWidth: 180 },
  { label: 'Número de Trechos', flex: '0 0 140px', minWidth: 140 },
  { label: 'Horário de\nfuncionamento', flex: '0 0 140px', minWidth: 140 },
  { label: 'Data de início\nna plataforma', flex: '0 0 130px', minWidth: 130 },
  { label: 'Visualizar/Editar', flex: '0 0 100px', minWidth: 100 },
];

type EncomendaTrechoRow = {
  id?: string;
  codigo: string;
  origem: string;
  destino: string;
  tipo: string;
  valor: string;
};

const encomendaCols = [
  { label: 'Código (ID)', flex: '0 0 110px', minWidth: 110 },
  { label: 'Origem', flex: '1 1 20%', minWidth: 140 },
  { label: 'Destino', flex: '1 1 20%', minWidth: 140 },
  { label: 'Tipo', flex: '0 0 100px', minWidth: 100 },
  { label: 'Valor', flex: '0 0 110px', minWidth: 110 },
  { label: 'Editar/Remover', flex: '0 0 110px', minWidth: 110 },
];

type PreparadorGestaoRow = {
  nome: string;
  rating: number;
  origem: string;
  destino: string;
  numCidades: number;
  horario: string;
};

const preparadorGestaoCols = [
  { label: 'Preparador', flex: '1 1 22%', minWidth: 170 },
  { label: 'Origem', flex: '1 1 16%', minWidth: 130 },
  { label: 'Destino', flex: '1 1 16%', minWidth: 130 },
  { label: 'Número de cidades', flex: '0 0 130px', minWidth: 130 },
  { label: 'Horário de\nfuncionamento', flex: '0 0 130px', minWidth: 130 },
  { label: 'Visualizar', flex: '0 0 80px', minWidth: 80 },
];

// Special card for Adicionais: "Adicionais automáticos vs. manuais" and "Total de adicionais ativos"
// These are rendered inline in the tab content, not via the generic metrics renderer.

type AdicionalRow = {
  id?: string;
  codigo: string;
  nome: string;
  tipo: string;
  unidade: string;
  valor: string;
  inclusao: string;
};

const adicionalCols = [
  { label: 'Código trecho', flex: '0 0 110px', minWidth: 110 },
  { label: 'Nome', flex: '1 1 20%', minWidth: 160 },
  { label: 'Tipo', flex: '0 0 100px', minWidth: 100 },
  { label: 'Unidade', flex: '0 0 80px', minWidth: 80 },
  { label: 'Valor', flex: '0 0 100px', minWidth: 100 },
  { label: 'Inclusão', flex: '0 0 110px', minWidth: 110 },
  { label: 'Editar/Remover', flex: '0 0 110px', minWidth: 110 },
];

type AvaliacaoItem = {
  nome: string;
  data: string;
  stars: number;
  comentario: string;
  tipo: string;
};

// Placeholder — será substituído por dados reais via state
const avaliacoesFallback: AvaliacaoItem[] = [];

const s = {
  tabsRow: { display: 'flex', gap: 0, borderBottom: '1px solid #e2e2e2', marginBottom: 24 } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '12px 24px', fontSize: 16, fontWeight: active ? 600 : 400,
    color: active ? '#0d0d0d' : '#767676',
    borderBottom: active ? '2px solid #0d0d0d' : '2px solid transparent', marginBottom: -1,
    background: 'none', border: 'none', cursor: 'pointer', ...font,
  } as React.CSSProperties),
  metricCard: {
    flex: '1 1 0', minWidth: 220, background: '#f6f6f6', borderRadius: 16,
    padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 8,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
};

export default function PagamentosGestaoScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<typeof tabs[number]>(() =>
    tabFromQueryParam(searchParams.get('tab')) ?? 'Motorista',
  );

  useEffect(() => {
    const t = tabFromQueryParam(searchParams.get('tab'));
    if (t) setActiveTab(t);
    else setActiveTab('Motorista');
  }, [searchParams]);

  // ── Editar encomenda modal state ────────────────────────────────────
  const [editEncOpen, setEditEncOpen] = useState(false);
  const [editEncRow, setEditEncRow] = useState<EncomendaTrechoRow | null>(null);
  const [editEncTipo, setEditEncTipo] = useState('');
  const [editEncValor, setEditEncValor] = useState('');
  const abrirEditEnc = useCallback((row: EncomendaTrechoRow) => {
    setEditEncRow(row);
    setEditEncTipo(row.tipo);
    setEditEncValor(row.valor);
    setEditEncOpen(true);
  }, []);
  const fecharEditEnc = useCallback(() => setEditEncOpen(false), []);
  const salvarEditEnc = useCallback(async () => {
    if (editEncRow?.id) {
      const modeMap: Record<string, string> = { 'Pequena': 'fixed', 'Média': 'fixed', 'Grande': 'fixed', 'Por KM': 'per_km', 'Fixo': 'fixed', 'Diária': 'daily_rate' };
      const valNum = parseFloat(editEncValor.replace('R$', '').replace('.', '').replace(',', '.').trim()) * 100;
      await updatePricingRoute(editEncRow.id, { price_cents: Math.round(valNum) });
      // Refresh data
      const updated = await fetchPricingRoutes('preparer_shipments');
      setPricingEncRoutes(updated);
    }
    setEditEncOpen(false);
  }, [editEncRow, editEncTipo, editEncValor]);
  const confirmarRemoveEnc = useCallback(async () => {
    if (editEncRow?.id) {
      await deletePricingRoute(editEncRow.id);
      const updated = await fetchPricingRoutes('preparer_shipments');
      setPricingEncRoutes(updated);
    }
    setRemoveEncOpen(false);
  }, [editEncRow]);

  // ── Editar adicional modal state ────────────────────────────────────
  const [editAdicOpen, setEditAdicOpen] = useState(false);
  const [editAdicRow, setEditAdicRow] = useState<AdicionalRow | null>(null);
  const [editAdicNome, setEditAdicNome] = useState('');
  const [editAdicTipo, setEditAdicTipo] = useState('');
  const [editAdicUnidade, setEditAdicUnidade] = useState('');
  const [editAdicValor, setEditAdicValor] = useState('');
  const [editAdicInclusao, setEditAdicInclusao] = useState('');
  const abrirEditAdic = useCallback((row: AdicionalRow) => {
    setEditAdicRow(row); setEditAdicNome(row.nome); setEditAdicTipo(row.tipo);
    setEditAdicUnidade(row.unidade); setEditAdicValor(row.valor); setEditAdicInclusao(row.inclusao);
    setEditAdicOpen(true);
  }, []);
  const fecharEditAdic = useCallback(() => setEditAdicOpen(false), []);

  // ── Filtro avaliações modal state ───────────────────────────────────
  const [filtroAvalOpen, setFiltroAvalOpen] = useState(false);
  const [filtroAvalPeriodo, setFiltroAvalPeriodo] = useState('Este mês');
  const [filtroAvalTipo, setFiltroAvalTipo] = useState('Preparadores de excursões');
  const [filtroAvalNota, setFiltroAvalNota] = useState('3+');
  const [filtroAvalOrdem, setFiltroAvalOrdem] = useState('Antigos');
  const [filtroAvalBusca, setFiltroAvalBusca] = useState('');
  const abrirFiltroAval = useCallback(() => setFiltroAvalOpen(true), []);
  const fecharFiltroAval = useCallback(() => setFiltroAvalOpen(false), []);

  // ── Filtro encomenda modal state ────────────────────────────────────
  const [filtroEncOpen, setFiltroEncOpen] = useState(false);
  const [filtroEncDataIni, setFiltroEncDataIni] = useState('05 de setembro');
  const [filtroEncDataFim, setFiltroEncDataFim] = useState('30 de setembro');
  const [filtroEncCategoria, setFiltroEncCategoria] = useState('Take Me');
  const abrirFiltroEnc = useCallback(() => setFiltroEncOpen(true), []);
  const fecharFiltroEnc = useCallback(() => setFiltroEncOpen(false), []);

  // ── Filtro trecho modal state ───────────────────────────────────────
  const [filtroTrechoOpen, setFiltroTrechoOpen] = useState(false);
  const [filtroTrechoPrimario, setFiltroTrechoPrimario] = useState('Take Me');
  const [filtroTrechoSecundario, setFiltroTrechoSecundario] = useState('Excursão');
  const abrirFiltroTrecho = useCallback(() => setFiltroTrechoOpen(true), []);
  const fecharFiltroTrecho = useCallback(() => setFiltroTrechoOpen(false), []);

  // ── Filtro adicionais modal state ───────────────────────────────────
  const [filtroAdicOpen, setFiltroAdicOpen] = useState(false);
  const [filtroAdicOrigem, setFiltroAdicOrigem] = useState('');
  const [filtroAdicDestino, setFiltroAdicDestino] = useState('');
  const abrirFiltroAdic = useCallback(() => setFiltroAdicOpen(true), []);
  const fecharFiltroAdic = useCallback(() => setFiltroAdicOpen(false), []);

  // ── Criar adicional modal state ─────────────────────────────────────
  const [criarAdicOpen, setCriarAdicOpen] = useState(false);
  const [criarAdicNome, setCriarAdicNome] = useState('');
  const [criarAdicTipo, setCriarAdicTipo] = useState('');
  const [criarAdicUnidade, setCriarAdicUnidade] = useState('');
  const [criarAdicValor, setCriarAdicValor] = useState('');
  const [criarAdicVincular, setCriarAdicVincular] = useState('');
  const [criarAdicInclusao, setCriarAdicInclusao] = useState('Manual');
  const abrirCriarAdic = useCallback(() => {
    setCriarAdicNome(''); setCriarAdicTipo(''); setCriarAdicUnidade('');
    setCriarAdicValor(''); setCriarAdicVincular(''); setCriarAdicInclusao('Manual');
    setCriarAdicOpen(true);
  }, []);
  const fecharCriarAdic = useCallback(() => setCriarAdicOpen(false), []);

  // ── Remover adicional modal state ──────────────────────────────────
  const [removeAdicOpen, setRemoveAdicOpen] = useState(false);
  const abrirRemoveAdic = useCallback(() => setRemoveAdicOpen(true), []);
  const fecharRemoveAdic = useCallback(() => setRemoveAdicOpen(false), []);

  // ── Bases modal states ─────────────────────────────────────────────
  const [criarBaseOpen, setCriarBaseOpen] = useState(false);
  const [criarBaseNome, setCriarBaseNome] = useState('');
  const [criarBaseEndereco, setCriarBaseEndereco] = useState('');
  const [criarBaseCidade, setCriarBaseCidade] = useState('');
  const [criarBaseEstado, setCriarBaseEstado] = useState('');
  const [criarBaseLat, setCriarBaseLat] = useState('');
  const [criarBaseLng, setCriarBaseLng] = useState('');
  const abrirCriarBase = useCallback(() => {
    setCriarBaseNome(''); setCriarBaseEndereco(''); setCriarBaseCidade('');
    setCriarBaseEstado(''); setCriarBaseLat(''); setCriarBaseLng('');
    setCriarBaseOpen(true);
  }, []);
  const fecharCriarBase = useCallback(() => setCriarBaseOpen(false), []);
  const salvarCriarBase = useCallback(async () => {
    const result = await createBase({
      name: criarBaseNome, address: criarBaseEndereco, city: criarBaseCidade,
      state: criarBaseEstado, lat: criarBaseLat ? parseFloat(criarBaseLat) : undefined,
      lng: criarBaseLng ? parseFloat(criarBaseLng) : undefined,
    });
    if (result) setBasesData(prev => [result, ...prev]);
    setCriarBaseOpen(false);
  }, [criarBaseNome, criarBaseEndereco, criarBaseCidade, criarBaseEstado, criarBaseLat, criarBaseLng]);

  const [editBaseOpen, setEditBaseOpen] = useState(false);
  const [editBaseRow, setEditBaseRow] = useState<BaseListItem | null>(null);
  const [editBaseNome, setEditBaseNome] = useState('');
  const [editBaseEndereco, setEditBaseEndereco] = useState('');
  const [editBaseCidade, setEditBaseCidade] = useState('');
  const [editBaseEstado, setEditBaseEstado] = useState('');
  const [editBaseLat, setEditBaseLat] = useState('');
  const [editBaseLng, setEditBaseLng] = useState('');
  const abrirEditBase = useCallback((row: BaseListItem) => {
    setEditBaseRow(row); setEditBaseNome(row.name); setEditBaseEndereco(row.address);
    setEditBaseCidade(row.city); setEditBaseEstado(row.state);
    setEditBaseLat(row.lat != null ? String(row.lat) : '');
    setEditBaseLng(row.lng != null ? String(row.lng) : '');
    setEditBaseOpen(true);
  }, []);
  const fecharEditBase = useCallback(() => setEditBaseOpen(false), []);

  const [removeBaseOpen, setRemoveBaseOpen] = useState(false);
  const abrirRemoveBase = useCallback(() => setRemoveBaseOpen(true), []);
  const fecharRemoveBase = useCallback(() => setRemoveBaseOpen(false), []);

  const [filtroBaseOpen, setFiltroBaseOpen] = useState(false);
  const [filtroBaseCidade, setFiltroBaseCidade] = useState('');
  const [filtroBaseEstado, setFiltroBaseEstado] = useState('');
  const abrirFiltroBase = useCallback(() => setFiltroBaseOpen(true), []);
  const fecharFiltroBase = useCallback(() => setFiltroBaseOpen(false), []);

  // ── Remover encomenda modal state ──────────────────────────────────
  const [removeEncOpen, setRemoveEncOpen] = useState(false);
  const abrirRemoveEnc = useCallback((row?: EncomendaTrechoRow) => {
    if (row) setEditEncRow(row);
    setRemoveEncOpen(true);
  }, []);
  const fecharRemoveEnc = useCallback(() => setRemoveEncOpen(false), []);

  // ── Real data from Supabase ─────────────────────────────────────────
  const [motoristasData, setMotoristasData] = useState<MotoristaListItem[]>([]);
  const [preparadoresList, setPreparadoresList] = useState<PreparadorListItem[]>([]);
  const [workerSubs, setWorkerSubs] = useState<{ id: string; subtype?: string }[]>([]);
  const [pricingDriverRoutes, setPricingDriverRoutes] = useState<PricingRouteRow[]>([]);
  const [pricingEncRoutes, setPricingEncRoutes] = useState<PricingRouteRow[]>([]);
  const [pricingExcRoutes, setPricingExcRoutes] = useState<PricingRouteRow[]>([]);
  const [surcharges, setSurcharges] = useState<SurchargeCatalogRow[]>([]);
  const [basesData, setBasesData] = useState<BaseListItem[]>([]);
  const [ratings, setRatings] = useState<RatingListItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMotoristas(),
      fetchPreparadores(),
      fetchWorkerSubtypesForGestao(),
      fetchPricingRoutes('driver'),
      fetchPricingRoutes('preparer_shipments'),
      fetchPricingRoutes('preparer_excursions'),
      fetchSurchargeCatalog(),
      fetchWorkerRatings(),
      fetchBases(),
    ]).then(([mots, preps, wsub, dRoutes, eRoutes, xRoutes, surcs, rats, bases]) => {
      if (!cancelled) {
        setMotoristasData(mots);
        setPreparadoresList(preps);
        setWorkerSubs(wsub);
        setPricingDriverRoutes(dRoutes);
        setPricingEncRoutes(eRoutes);
        setPricingExcRoutes(xRoutes);
        setSurcharges(surcs);
        setRatings(rats);
        setBasesData(bases);
        setDataLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // ── Computed rows from real Supabase data ─────────────────────────────
  const fmtCents = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const realEncRows: EncomendaTrechoRow[] = useMemo(() =>
    pricingEncRoutes.map(r => ({
      id: r.id,
      codigo: `#${r.id.slice(0, 5)}`,
      origem: r.origin_address || '—',
      destino: r.destination_address,
      tipo: r.pricing_mode === 'per_km' ? 'Por KM' : r.pricing_mode === 'fixed' ? 'Fixo' : 'Diária',
      valor: fmtCents(r.price_cents),
    })), [pricingEncRoutes]);

  const realTrechoRows: EncomendaTrechoRow[] = useMemo(() =>
    pricingDriverRoutes.map(r => ({
      id: r.id,
      codigo: `#${r.id.slice(0, 5)}`,
      origem: r.origin_address || '—',
      destino: r.destination_address,
      tipo: r.pricing_mode === 'per_km' ? 'Por KM' : r.pricing_mode === 'fixed' ? 'Fixo' : 'Viagem',
      valor: fmtCents(r.price_cents),
    })), [pricingDriverRoutes]);

  const realAdicRows: AdicionalRow[] = useMemo(() =>
    surcharges.map(s => ({
      id: s.id,
      codigo: `#${s.id.slice(0, 5)}`,
      nome: s.name,
      tipo: s.description || '—',
      unidade: '—',
      valor: fmtCents(s.default_value_cents),
      inclusao: s.surcharge_mode === 'automatic' ? 'Automática' : 'Manual',
    })), [surcharges]);

  const activeEncRows = realEncRows;
  const activeTrechoRows = realTrechoRows;
  const activeAdicRows = realAdicRows;

  const motoristaRowsFromApi: MotoristaRow[] = useMemo(
    () => motoristasToGestaoRows(motoristasData, workerSubs),
    [motoristasData, workerSubs],
  );

  const preparadorGestaoRows: PreparadorGestaoRow[] = useMemo(
    () =>
      preparadoresList.map((p) => ({
        nome: p.nome,
        rating: Number(p.avaliacao ?? 0),
        origem: p.origem || '—',
        destino: p.destino || '—',
        numCidades: 0,
        horario: '—',
      })),
    [preparadoresList],
  );

  const [filtroGestaoOpen, setFiltroGestaoOpen] = useState(false);
  const [filtroGestaoAtivo, setFiltroGestaoAtivo] = useState(false);
  const [appliedGestaoFiltro, setAppliedGestaoFiltro] = useState<GestAppliedFiltro>({
    periodo: 'mes',
    primario: 'takeme',
    secundario: 'excursao',
  });
  const [draftPeriodoGest, setDraftPeriodoGest] = useState<GestPeriodoFiltro>('mes');
  const [draftPrimarioGest, setDraftPrimarioGest] = useState<GestPrimarioFiltro>('takeme');
  const [draftSecundarioGest, setDraftSecundarioGest] = useState<GestSecundarioFiltro>('excursao');
  const [draftDataIniGest, setDraftDataIniGest] = useState('');
  const [draftDataFimGest, setDraftDataFimGest] = useState('');

  const abrirFiltroGestao = useCallback(() => {
    if (filtroGestaoAtivo) {
      setDraftPeriodoGest(appliedGestaoFiltro.periodo);
      setDraftPrimarioGest(appliedGestaoFiltro.primario);
      setDraftSecundarioGest(appliedGestaoFiltro.secundario);
      setDraftDataIniGest(appliedGestaoFiltro.dataIni ?? '');
      setDraftDataFimGest(appliedGestaoFiltro.dataFim ?? '');
    } else {
      setDraftPeriodoGest('mes');
      setDraftPrimarioGest('takeme');
      setDraftSecundarioGest('excursao');
      setDraftDataIniGest('');
      setDraftDataFimGest('');
    }
    setFiltroGestaoOpen(true);
  }, [filtroGestaoAtivo, appliedGestaoFiltro]);

  const fecharFiltroGestao = useCallback(() => setFiltroGestaoOpen(false), []);

  const aplicarFiltroGestao = useCallback(() => {
    setAppliedGestaoFiltro({
      periodo: draftPeriodoGest,
      primario: draftPrimarioGest,
      secundario: draftSecundarioGest,
      dataIni: draftDataIniGest.trim() || undefined,
      dataFim: draftDataFimGest.trim() || undefined,
    });
    setFiltroGestaoAtivo(true);
    setFiltroGestaoOpen(false);
  }, [draftPeriodoGest, draftPrimarioGest, draftSecundarioGest, draftDataIniGest, draftDataFimGest]);

  useEffect(() => {
    if (!filtroGestaoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharFiltroGestao();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtroGestaoOpen, fecharFiltroGestao]);

  const filteredMotoristaRows = useMemo(() => {
    if (!filtroGestaoAtivo) return motoristaRowsFromApi;
    const { start, end } = getPeriodRangeGest(appliedGestaoFiltro.periodo);
    return motoristaRowsFromApi.filter((row) => {
      if (appliedGestaoFiltro.primario !== 'todos' && row.primaryTipo !== appliedGestaoFiltro.primario) return false;
      if (appliedGestaoFiltro.secundario !== 'todos' && row.secondaryTipo !== appliedGestaoFiltro.secundario) return false;
      if (!motoristaDataInPeriod(row.dataInicio, start, end)) return false;
      if (appliedGestaoFiltro.dataIni) {
        const q = appliedGestaoFiltro.dataIni.toLowerCase();
        if (!row.dataInicio.toLowerCase().includes(q)) return false;
      }
      if (appliedGestaoFiltro.dataFim) {
        const q = appliedGestaoFiltro.dataFim.toLowerCase();
        if (!row.dataInicio.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [filtroGestaoAtivo, appliedGestaoFiltro, motoristaRowsFromApi]);

  const labelTipoMotorista: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font };
  const inputGestStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
    fontSize: 16, fontWeight: 400, color: '#0d0d0d', padding: '0 16px', height: '100%', ...font,
  };
  const tituloSecaoGest18: React.CSSProperties = { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font };

  const campoDataGest = (rotulo: string, valor: string, onChange: (v: string) => void, placeholder: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%', gap: 0 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, rotulo),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, borderRadius: 8, background: '#f1f1f1', paddingLeft: 16, overflow: 'hidden', width: '100%', boxSizing: 'border-box' as const } },
        calendarSvgLg,
        React.createElement('input', {
          type: 'text',
          value: valor,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          placeholder,
          style: { ...inputGestStyle, color: valor ? '#0d0d0d' : '#767676' },
        })));

  const overlayGestStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    boxSizing: 'border-box',
  };

  const filtroGestaoModal = filtroGestaoOpen
    ? React.createElement('div', {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'filtro-tabela-gestao-pagamentos-titulo',
      style: overlayGestStyle,
      onClick: fecharFiltroGestao,
    },
      React.createElement('div', {
        style: {
          background: '#fff',
          borderRadius: 16,
          boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
          width: '100%',
          maxWidth: 520,
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
            React.createElement('h2', { id: 'filtro-tabela-gestao-pagamentos-titulo', style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Filtro da tabela'),
            React.createElement('button', {
              type: 'button',
              onClick: fecharFiltroGestao,
              'aria-label': 'Fechar',
              style: {
                width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, marginTop: -2,
              },
            }, closeModalSvg))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('span', { style: tituloSecaoGest18 }, 'Data da atividade'),
          campoDataGest('Data inicial', draftDataIniGest, setDraftDataIniGest, '05 de setembro'),
          campoDataGest('Data final', draftDataFimGest, setDraftDataFimGest, '30 de setembro')),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('span', { style: tituloSecaoGest18 }, 'Tipo de motorista'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
            React.createElement('span', { style: labelTipoMotorista }, 'Primário'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, alignItems: 'center' } },
              chipFiltroGest('Todos', draftPrimarioGest === 'todos', () => setDraftPrimarioGest('todos')),
              chipFiltroGest('Take Me', draftPrimarioGest === 'takeme', () => setDraftPrimarioGest('takeme')),
              chipFiltroGest('Parceiros', draftPrimarioGest === 'parceiros', () => setDraftPrimarioGest('parceiros')))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
            React.createElement('span', { style: labelTipoMotorista }, 'Secundário'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, alignItems: 'center' } },
              chipFiltroGest('Todos', draftSecundarioGest === 'todos', () => setDraftSecundarioGest('todos')),
              chipFiltroGest('Viagem', draftSecundarioGest === 'viagem', () => setDraftSecundarioGest('viagem')),
              chipFiltroGest('Excursão', draftSecundarioGest === 'excursao', () => setDraftSecundarioGest('excursao'))))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('span', { style: tituloSecaoGest18 }, 'Período'),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, alignItems: 'center' } },
            chipFiltroGest('Esta semana', draftPeriodoGest === 'semana', () => setDraftPeriodoGest('semana')),
            chipFiltroGest('Este mês', draftPeriodoGest === 'mes', () => setDraftPeriodoGest('mes')),
            chipFiltroGest('Este ano', draftPeriodoGest === 'ano', () => setDraftPeriodoGest('ano')))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('button', {
            type: 'button',
            onClick: aplicarFiltroGestao,
            style: {
              width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff',
              fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font,
            },
          }, 'Aplicar filtro'),
          React.createElement('button', {
            type: 'button',
            onClick: fecharFiltroGestao,
            style: {
              width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'transparent', color: '#0d0d0d',
              fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font,
            },
          }, 'Voltar'))))
    : null;

  // ── Breadcrumb ────────────────────────────────────────────────────────
  const breadcrumb = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#767676', ...font },
  },
    React.createElement('span', null, 'Pagamentos'),
    React.createElement('span', null, '>'),
    React.createElement('span', null, 'Percificação e porcentagem'),
    React.createElement('span', null, '>'),
    React.createElement('span', { style: { fontWeight: 600, color: '#0d0d0d' } }, activeTab));

  // ── Header row ────────────────────────────────────────────────────────
  const headerRow = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' as const, gap: 12 },
  },
    React.createElement('button', {
      type: 'button', onClick: () => navigate('/pagamentos'),
      style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 600, color: '#0d0d0d', padding: 0, ...font },
    },
      React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
        React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      'Voltar'),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      React.createElement('button', {
        type: 'button',
        onClick: activeTab === 'Avaliações' ? abrirFiltroAval : activeTab === 'Adicionais' ? abrirFiltroAdic : (activeTab === 'Encomenda' || activeTab === 'Trecho') ? abrirFiltroEnc : activeTab === 'Bases' ? abrirFiltroBase : abrirFiltroGestao,
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px',
          background: '#f1f1f1', border: 'none', borderRadius: 999,
          fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font,
        },
      }, filterIconSvg, 'Filtro'),
      null,
      (activeTab === 'Trecho' || activeTab === 'Adicionais' || activeTab === 'Bases')
        ? React.createElement('button', {
            type: 'button',
            onClick: () => activeTab === 'Adicionais' ? abrirCriarAdic() : activeTab === 'Bases' ? abrirCriarBase() : navigate('/pagamentos/gestao/criar-trecho'),
            style: {
              display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px',
              background: '#0d0d0d', color: '#fff', border: 'none', borderRadius: 999,
              fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
            },
          },
            React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
              React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
            activeTab === 'Adicionais' ? 'Criar adicional' : activeTab === 'Bases' ? 'Criar base' : 'Criar novo trecho')
        : null));

  // ── Tabs ───────────────────────────────────────────────────────────────
  const tabsEl = React.createElement('div', { style: s.tabsRow },
    ...tabs.map((t) => React.createElement('button', {
      key: t, type: 'button', onClick: () => setActiveTab(t), style: s.tab(activeTab === t),
    }, t)));

  // KPIs do Motorista — calculados dos dados filtrados
  const [motoristaKpiData, setMotoristaKpiData] = useState<{ avgGanhoPct: number; avgGanhoFixo: number; avgAdminPct: number }>({ avgGanhoPct: 0, avgGanhoFixo: 0, avgAdminPct: 0 });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void (async () => {
      const [{ data: routes }, { data: settings }] = await Promise.all([
        (supabase as any).from('worker_routes').select('price_per_person_cents').eq('is_active', true),
        (supabase as any).from('platform_settings').select('value').eq('key', 'default_admin_pct').maybeSingle(),
      ]);
      const prices = (routes || []).map((r: any) => r.price_per_person_cents || 0);
      const avgFixed = prices.length > 0 ? Math.round(prices.reduce((s: number, v: number) => s + v, 0) / prices.length) : 0;
      const adminPct = settings?.value?.percentage || 15;
      const workerPct = 100 - adminPct;
      setMotoristaKpiData({ avgGanhoPct: workerPct, avgGanhoFixo: avgFixed, avgAdminPct: adminPct });
    })();
  }, []);

  const motoristaKpiCards = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const, marginBottom: 16 },
  },
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Média de ganho por trecho'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#22c55e', ...font } }, '+12.5%')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `${motoristaKpiData.avgGanhoPct}%`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'de lucro'))),
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Média de ganho fixo por trecho'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#22c55e', ...font } }, '+8.2%')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `R$ ${(motoristaKpiData.avgGanhoFixo / 100).toFixed(2).replace('.', ',')}`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'por rota'))),
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Média de ganho por trecho pelo administrador'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#b53838', ...font } }, '-3.1%')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `${motoristaKpiData.avgAdminPct}%`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'de lucro'))));

  // KPIs Encomenda — média de valor por tamanho
  // Avaliações reais
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoItem[]>(avaliacoesFallback);
  const [avalAvg, setAvalAvg] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void (async () => {
      // Buscar de TODAS as tabelas de avaliação
      const [{ data: workerRatings }, { data: tripRatings }, { data: bookingRatings }, { data: shipmentRatings }] = await Promise.all([
        (supabase as any).from('worker_ratings').select('id, rating, comment, created_at, worker_id').order('created_at', { ascending: false }).limit(50),
        (supabase as any).from('trip_ratings').select('id, rating, comment, created_at, driver_id').order('created_at', { ascending: false }).limit(50),
        (supabase as any).from('booking_ratings').select('id, rating, comment, created_at, booking_id').order('created_at', { ascending: false }).limit(50),
        (supabase as any).from('shipment_ratings').select('id, rating, comment, created_at, shipment_id').order('created_at', { ascending: false }).limit(50),
      ]);

      // Para booking_ratings, buscar o nome do passageiro
      const bookingIds = (bookingRatings || []).map((r: any) => r.booking_id).filter(Boolean);
      let bookingUserMap = new Map<string, { userId: string; driverId: string }>();
      if (bookingIds.length > 0) {
        const { data: bookings } = await (supabase as any).from('bookings').select('id, user_id, scheduled_trip_id').in('id', bookingIds);
        (bookings || []).forEach((b: any) => bookingUserMap.set(b.id, { userId: b.user_id, driverId: '' }));
      }

      // Unificar todas as avaliações
      const allRatings = [
        ...(workerRatings || []).map((r: any) => ({ ...r, workerId: r.worker_id, source: 'worker', reviewerName: '' })),
        ...(tripRatings || []).map((r: any) => ({ ...r, workerId: r.driver_id, source: 'trip', reviewerName: '' })),
        ...(bookingRatings || []).map((r: any) => {
          const bk = bookingUserMap.get(r.booking_id);
          return { ...r, workerId: bk?.userId || '', source: 'booking', reviewerName: '' };
        }),
        ...(shipmentRatings || []).map((r: any) => ({ ...r, workerId: '', source: 'shipment', reviewerName: '' })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 50);
      if (allRatings.length === 0) return;

      // Buscar nomes e tipos
      const allUserIds = [...new Set(allRatings.map((r: any) => r.workerId).filter(Boolean))];
      const [{ data: profiles }, { data: workers }] = await Promise.all([
        allUserIds.length > 0 ? (supabase as any).from('profiles').select('id, full_name').in('id', allUserIds) : Promise.resolve({ data: [] }),
        allUserIds.length > 0 ? (supabase as any).from('worker_profiles').select('id, subtype').in('id', allUserIds) : Promise.resolve({ data: [] }),
      ]);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || 'Sem nome']));
      const subtypeMap = new Map((workers || []).map((w: any) => [w.id, w.subtype]));
      const tipoLabel = (sub: string | undefined, src: string) => {
        if (src === 'booking') return 'Passageiro → Motorista';
        if (src === 'shipment') return 'Cliente → Preparador';
        if (sub === 'takeme' || sub === 'partner') return 'Passageiro → Motorista';
        if (sub === 'shipments') return 'Cliente → Preparador de encomendas';
        if (sub === 'excursions') return 'Cliente → Preparador de excursões';
        return 'Avaliação de viagem';
      };
      const items: AvaliacaoItem[] = allRatings.map((r: any) => ({
        nome: String(nameMap.get(r.workerId) ?? 'Avaliação'),
        data: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '—',
        stars: Math.round(r.rating || 0),
        comentario: r.comment || 'Sem comentário',
        tipo: tipoLabel(subtypeMap.get(r.workerId) as string | undefined, r.source),
      }));
      setAvaliacoes(items);
      const avg = allRatings.reduce((s: number, r: any) => s + (r.rating || 0), 0) / allRatings.length;
      setAvalAvg(Math.round(avg * 10) / 10);
    })();
  }, []);

  const [encKpi, setEncKpi] = useState<{ pequena: number; media: number; grande: number }>({ pequena: 0, media: 0, grande: 0 });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void (async () => {
      const { data } = await (supabase as any).from('shipments').select('package_size, amount_cents').not('amount_cents', 'is', null);
      if (!data) return;
      const bySize: Record<string, number[]> = { pequeno: [], medio: [], grande: [] };
      for (const s of data) {
        const sz = (s.package_size || '').toLowerCase();
        if (sz in bySize) bySize[sz].push(s.amount_cents || 0);
      }
      const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
      setEncKpi({ pequena: avg(bySize.pequeno), media: avg(bySize.medio), grande: avg(bySize.grande) });
    })();
  }, []);

  const encomendaKpiCards = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const, marginBottom: 16 },
  },
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: '0 0 8px', lineHeight: 1.4, ...font } }, 'Média de valor\nde encomenda pequena'),
      React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `R$ ${(encKpi.pequena / 100).toFixed(2).replace('.', ',')}`)),
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: '0 0 8px', lineHeight: 1.4, ...font } }, 'Média de valor\nde encomenda média'),
      React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `R$ ${(encKpi.media / 100).toFixed(2).replace('.', ',')}`)),
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: '0 0 8px', lineHeight: 1.4, ...font } }, 'Média de valor\nde encomenda grande'),
      React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `R$ ${(encKpi.grande / 100).toFixed(2).replace('.', ',')}`)));

  // KPI Trecho — média de valor por trecho (pricing_routes)
  const [trechoAvgCents, setTrechoAvgCents] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void (async () => {
      const { data } = await (supabase as any).from('pricing_routes').select('price_cents').eq('is_active', true);
      if (!data || data.length === 0) return;
      const prices = data.map((r: any) => r.price_cents || 0);
      setTrechoAvgCents(Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length));
    })();
  }, []);

  const trechoKpiCard = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const, marginBottom: 16 },
  },
    React.createElement('div', { style: { ...s.metricCard, flex: '1 1 100%' } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: '0 0 8px', ...font } }, 'Média de valor por trecho'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#22c55e', ...font } }, '+4.3%'),
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'vs semana anterior')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `R$ ${(trechoAvgCents / 100).toFixed(2).replace('.', ',')}`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'por trajeto'))));

  // KPIs Preparadores — mesmo padrão de motorista mas para shipments/excursions workers
  const [prepKpi, setPrepKpi] = useState<{ avgGanhoPct: number; avgGanhoFixo: number; avgAdminPct: number }>({ avgGanhoPct: 0, avgGanhoFixo: 0, avgAdminPct: 0 });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void (async () => {
      const [{ data: routes }, { data: settings }] = await Promise.all([
        (supabase as any).from('worker_routes').select('price_per_person_cents, worker_id').eq('is_active', true),
        (supabase as any).from('platform_settings').select('value').eq('key', 'default_admin_pct').maybeSingle(),
      ]);
      // Filter to only preparadores (workers with subtype shipments/excursions)
      const { data: prepWorkers } = await (supabase as any).from('worker_profiles').select('id').in('subtype', ['shipments', 'excursions']);
      const prepIds = new Set((prepWorkers || []).map((w: any) => w.id));
      const prepRoutes = (routes || []).filter((r: any) => prepIds.has(r.worker_id));
      const prices = prepRoutes.map((r: any) => r.price_per_person_cents || 0);
      const avgFixed = prices.length > 0 ? Math.round(prices.reduce((s: number, v: number) => s + v, 0) / prices.length) : 0;
      const adminPct = settings?.value?.percentage || 15;
      setPrepKpi({ avgGanhoPct: Math.max(0, 100 - adminPct), avgGanhoFixo: avgFixed, avgAdminPct: adminPct });
    })();
  }, []);

  const preparadoresKpiCards = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const, marginBottom: 16 },
  },
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Média de ganho por trecho'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#22c55e', ...font } }, '+8.5%')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `${prepKpi.avgGanhoPct}%`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'de lucro'))),
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Média de ganho fixo por trecho'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#22c55e', ...font } }, '+7.5%')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `R$ ${(prepKpi.avgGanhoFixo / 100).toFixed(2).replace('.', ',')}`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'por rota'))),
    React.createElement('div', { style: s.metricCard },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Média de ganho por trecho pelo administrador'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#b53838', ...font } }, '-2.9%')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4 } },
        React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, `${prepKpi.avgAdminPct}%`),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'de lucro'))));

  const gestaoKpiPlaceholder = React.createElement('p', {
    style: { fontSize: 14, color: '#767676', margin: '0 0 16px', maxWidth: 640, lineHeight: 1.5, ...font },
  }, 'Indicadores agregados desta aba. As tabelas abaixo refletem dados reais do Supabase.');

  // ── Table ─────────────────────────────────────────────────────────────
  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font, padding: '0 6px' };

  const tableToolbar = React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 64, padding: '16px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0',
    },
  },
    React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Lista de motoristas'));

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

  const tableRowEls = filteredMotoristaRows.map((row, idx) => {
    const initial = row.nome.charAt(0);
    const avatarBg = avatarColors[initial] || '#999';
    return React.createElement('div', {
      key: idx,
      style: {
        display: 'flex', minHeight: 64, alignItems: 'center', padding: '8px 16px',
        borderBottom: '1px solid #d9d9d9', background: '#f6f6f6',
      },
    },
      // Motorista (avatar + name + rating)
      React.createElement('div', { style: { ...cellBase, flex: tableCols[0].flex, minWidth: tableCols[0].minWidth, gap: 10 } },
        React.createElement('div', {
          style: {
            width: 40, height: 40, borderRadius: '50%', background: avatarBg, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        }, React.createElement('span', { style: { color: '#fff', fontSize: 16, fontWeight: 600, ...font } }, initial)),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
          React.createElement('span', { style: { fontWeight: 500, fontSize: 14, ...font } }, row.nome),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            starSvg,
            React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, row.rating.toFixed(1))))),
      // Número de Trechos
      React.createElement('div', { style: { ...cellBase, flex: tableCols[1].flex, minWidth: tableCols[1].minWidth } }, row.numTrechos),
      // Horário
      React.createElement('div', { style: { ...cellBase, flex: tableCols[2].flex, minWidth: tableCols[2].minWidth } }, row.horario),
      // Data início
      React.createElement('div', { style: { ...cellBase, flex: tableCols[3].flex, minWidth: tableCols[3].minWidth } }, row.dataInicio),
      // Visualizar → edição do motorista quando existe na API; senão lista de motoristas
      React.createElement('div', {
        style: { flex: tableCols[4].flex, minWidth: tableCols[4].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      },
        React.createElement('button', {
          type: 'button',
          style: webStyles.viagensActionBtn,
          'aria-label': 'Visualizar motorista',
          onClick: () => {
            const slug = slugifyMotoristaNome(row.nome);
            navigate(`/pagamentos/gestao/motorista/${slug}`);
          },
        }, eyeActionSvg)));
  });

  const tableSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  },
    React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
      tableToolbar,
      React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } },
        tableHeader,
        ...tableRowEls)));

  // ── Encomenda table ────────────────────────────────────────────────────
  const pencilSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const trashSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  const encTableToolbar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, padding: '16px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0' },
  }, React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Lista de trechos de encomendas'));

  const encTableHeader = React.createElement('div', {
    style: { display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', alignItems: 'center' },
  }, ...encomendaCols.map((c) => React.createElement('div', {
    key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%' },
  }, c.label)));

  const encTableRowEls = activeEncRows.map((row, idx) =>
    React.createElement('div', {
      key: idx, style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6' },
    },
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[0].flex, minWidth: encomendaCols[0].minWidth, fontWeight: 500 } }, row.codigo),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[1].flex, minWidth: encomendaCols[1].minWidth } }, row.origem),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[2].flex, minWidth: encomendaCols[2].minWidth } }, row.destino),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[3].flex, minWidth: encomendaCols[3].minWidth, fontWeight: 500 } }, row.tipo),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[4].flex, minWidth: encomendaCols[4].minWidth, fontWeight: 600 } }, row.valor),
      React.createElement('div', { style: { flex: encomendaCols[5].flex, minWidth: encomendaCols[5].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 } },
        React.createElement('button', { type: 'button', onClick: () => abrirEditEnc(row), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Editar' }, pencilSvg),
        React.createElement('button', { type: 'button', onClick: () => abrirRemoveEnc(row), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Remover' }, trashSvg))));

  const encTableSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  }, React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
    encTableToolbar,
    React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, encTableHeader, ...encTableRowEls)));

  // ── Trecho table (reuses encomenda cols but with trechoRows) ────────
  const trechoTableToolbar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, padding: '16px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0' },
  }, React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Lista de trechos de encomendas'));

  const trechoTableRowEls = activeTrechoRows.map((row, idx) =>
    React.createElement('div', {
      key: idx, style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6' },
    },
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[0].flex, minWidth: encomendaCols[0].minWidth, fontWeight: 500 } }, row.codigo),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[1].flex, minWidth: encomendaCols[1].minWidth } }, row.origem),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[2].flex, minWidth: encomendaCols[2].minWidth } }, row.destino),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[3].flex, minWidth: encomendaCols[3].minWidth, fontWeight: 500 } }, row.tipo),
      React.createElement('div', { style: { ...cellBase, flex: encomendaCols[4].flex, minWidth: encomendaCols[4].minWidth, fontWeight: 600 } }, row.valor),
      React.createElement('div', { style: { flex: encomendaCols[5].flex, minWidth: encomendaCols[5].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 } },
        React.createElement('button', { type: 'button', onClick: () => abrirEditEnc(row), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Editar' }, pencilSvg),
        React.createElement('button', { type: 'button', onClick: () => abrirRemoveEnc(row), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Remover' }, trashSvg))));

  const trechoTableSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  }, React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
    trechoTableToolbar,
    React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, encTableHeader, ...trechoTableRowEls)));

  // ── Preparadores table ─────────────────────────────────────────────────
  const prepGestaoToolbar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, padding: '16px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0' },
  }, React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Lista de preparadores'));

  const prepGestaoHeader = React.createElement('div', {
    style: { display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', alignItems: 'center' },
  }, ...preparadorGestaoCols.map((c) => React.createElement('div', {
    key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%', whiteSpace: 'pre-line' as const },
  }, c.label)));

  const prepGestaoRowEls = preparadorGestaoRows.map((row, idx) => {
    const initial = row.nome.charAt(0);
    const avatarBg = avatarColors[initial] || '#999';
    return React.createElement('div', {
      key: idx, style: { display: 'flex', minHeight: 64, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6' },
    },
      React.createElement('div', { style: { ...cellBase, flex: preparadorGestaoCols[0].flex, minWidth: preparadorGestaoCols[0].minWidth, gap: 10 } },
        React.createElement('div', { style: { width: 40, height: 40, borderRadius: '50%', background: avatarBg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          React.createElement('span', { style: { color: '#fff', fontSize: 16, fontWeight: 600, ...font } }, initial)),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
          React.createElement('span', { style: { fontWeight: 500, fontSize: 14, ...font } }, row.nome),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } }, starSvg,
            React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, row.rating.toFixed(1))))),
      React.createElement('div', { style: { ...cellBase, flex: preparadorGestaoCols[1].flex, minWidth: preparadorGestaoCols[1].minWidth } }, row.origem),
      React.createElement('div', { style: { ...cellBase, flex: preparadorGestaoCols[2].flex, minWidth: preparadorGestaoCols[2].minWidth } }, row.destino),
      React.createElement('div', { style: { ...cellBase, flex: preparadorGestaoCols[3].flex, minWidth: preparadorGestaoCols[3].minWidth } }, String(row.numCidades)),
      React.createElement('div', { style: { ...cellBase, flex: preparadorGestaoCols[4].flex, minWidth: preparadorGestaoCols[4].minWidth } }, row.horario),
      React.createElement('div', { style: { flex: preparadorGestaoCols[5].flex, minWidth: preparadorGestaoCols[5].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        React.createElement('button', {
          type: 'button',
          style: webStyles.viagensActionBtn,
          'aria-label': 'Visualizar preparador de encomendas',
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            const slug = preparadorEncomendaSlug(row.nome);
            if (!slug) return;
            navigate(`/pagamentos/gestao/preparador-encomendas/${slug}`);
          },
        }, eyeActionSvg)));
  });

  const prepGestaoSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  }, React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
    prepGestaoToolbar, React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, prepGestaoHeader, ...prepGestaoRowEls)));

  // ── Adicionais content ─────────────────────────────────────────────────
  const adicAuto = surcharges.filter((s) => s.surcharge_mode === 'automatic').length;
  const adicManual = surcharges.filter((s) => s.surcharge_mode !== 'automatic').length;
  const adicTotalMode = adicAuto + adicManual;
  const adicAutoPct = adicTotalMode ? Math.round((adicAuto / adicTotalMode) * 100) : 0;
  const adicManualPct = adicTotalMode ? 100 - adicAutoPct : 0;
  const adicAvgCents = surcharges.length
    ? Math.round(surcharges.reduce((s, x) => s + (x.default_value_cents || 0), 0) / surcharges.length)
    : 0;

  const adicionaisMetricRow = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const },
  },
    React.createElement('div', { style: { ...s.metricCard } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Média de valor de adicionais'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 16 } },
        React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, surcharges.length ? fmtCents(adicAvgCents) : '—'),
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, ' (catálogo ativo)'))),
    React.createElement('div', { style: { ...s.metricCard } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Adicionais automáticos vs. manuais'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginTop: 16 } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Automáticos'),
          React.createElement('span', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', ...font } }, adicTotalMode ? `${adicAutoPct}%` : '—')),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Manuais'),
          React.createElement('span', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', ...font } }, adicTotalMode ? `${adicManualPct}%` : '—')))),
    React.createElement('div', { style: { ...s.metricCard } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Total de adicionais ativos'),
      React.createElement('p', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', margin: 0, marginTop: 16, ...font } }, String(surcharges.length))));

  const adicToolbar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, padding: '16px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0' },
  }, React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Custos adicionais'));

  const adicHeader = React.createElement('div', {
    style: { display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', alignItems: 'center' },
  }, ...adicionalCols.map((c) => React.createElement('div', {
    key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%' },
  }, c.label)));

  const adicRowEls = activeAdicRows.map((row, idx) =>
    React.createElement('div', {
      key: idx, style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6' },
    },
      React.createElement('div', { style: { ...cellBase, flex: adicionalCols[0].flex, minWidth: adicionalCols[0].minWidth, fontWeight: 500 } }, row.codigo),
      React.createElement('div', { style: { ...cellBase, flex: adicionalCols[1].flex, minWidth: adicionalCols[1].minWidth } }, row.nome),
      React.createElement('div', { style: { ...cellBase, flex: adicionalCols[2].flex, minWidth: adicionalCols[2].minWidth } }, row.tipo),
      React.createElement('div', { style: { ...cellBase, flex: adicionalCols[3].flex, minWidth: adicionalCols[3].minWidth } }, row.unidade),
      React.createElement('div', { style: { ...cellBase, flex: adicionalCols[4].flex, minWidth: adicionalCols[4].minWidth, fontWeight: 600 } }, row.valor),
      React.createElement('div', { style: { ...cellBase, flex: adicionalCols[5].flex, minWidth: adicionalCols[5].minWidth } }, row.inclusao),
      React.createElement('div', { style: { flex: adicionalCols[6].flex, minWidth: adicionalCols[6].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 } },
        React.createElement('button', { type: 'button', onClick: () => abrirEditAdic(row), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Editar' }, pencilSvg),
        React.createElement('button', { type: 'button', onClick: () => abrirRemoveAdic(), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Remover' }, trashSvg))));

  const adicSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  }, React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
    adicToolbar, React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, adicHeader, ...adicRowEls)));

  // ── Bases content ───────────────────────────────────────────────────
  const basesAtivas = basesData.filter(b => b.isActive);
  const basesEstados = basesData.reduce<Record<string, number>>((acc, b) => { acc[b.state] = (acc[b.state] || 0) + 1; return acc; }, {});
  const topEstado = Object.entries(basesEstados).sort((a, b) => b[1] - a[1])[0];
  const ultimaBase = basesData[0];

  const basesMetrics = React.createElement('div', {
    style: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const },
  },
    React.createElement('div', { key: 'bm1', style: { ...s.metricCard } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Total de bases ativas'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, String(basesAtivas.length)))),
    React.createElement('div', { key: 'bm2', style: { ...s.metricCard } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Principal estado'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, topEstado ? topEstado[0] : '—'),
        topEstado ? React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, `${topEstado[1]} bases`) : null)),
    React.createElement('div', { key: 'bm3', style: { ...s.metricCard } },
      React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, 'Última base cadastrada'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', ...font } }, ultimaBase ? ultimaBase.name : '—'),
        ultimaBase ? React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, ultimaBase.createdAt) : null)));

  const basesCols = [
    { label: 'Nome', flex: '1 1 20%', minWidth: 160 },
    { label: 'Endereço', flex: '1 1 25%', minWidth: 180 },
    { label: 'Cidade', flex: '0 0 120px', minWidth: 120 },
    { label: 'Estado', flex: '0 0 80px', minWidth: 80 },
    { label: 'Status', flex: '0 0 100px', minWidth: 100 },
    { label: 'Editar/Remover', flex: '0 0 110px', minWidth: 110 },
  ];

  const basesToolbar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', width: '100%', boxSizing: 'border-box' as const },
  }, React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Lista de bases'));

  const basesHeader = React.createElement('div', {
    style: { display: 'flex', minHeight: 48, alignItems: 'center', padding: '0 16px', background: '#e2e2e2', borderBottom: '1px solid #d9d9d9' },
  }, ...basesCols.map((c) => React.createElement('div', {
    key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%' },
  }, c.label)));

  const filteredBases = useMemo(() => {
    let filtered = basesData;
    if (filtroBaseCidade) filtered = filtered.filter(b => b.city.toLowerCase().includes(filtroBaseCidade.toLowerCase()));
    if (filtroBaseEstado) filtered = filtered.filter(b => b.state.toLowerCase().includes(filtroBaseEstado.toLowerCase()));
    return filtered;
  }, [basesData, filtroBaseCidade, filtroBaseEstado]);

  const basesRowEls = filteredBases.map((row, idx) =>
    React.createElement('div', {
      key: idx, style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6' },
    },
      React.createElement('div', { style: { ...cellBase, flex: basesCols[0].flex, minWidth: basesCols[0].minWidth, fontWeight: 500 } }, row.name),
      React.createElement('div', { style: { ...cellBase, flex: basesCols[1].flex, minWidth: basesCols[1].minWidth } }, row.address),
      React.createElement('div', { style: { ...cellBase, flex: basesCols[2].flex, minWidth: basesCols[2].minWidth } }, row.city),
      React.createElement('div', { style: { ...cellBase, flex: basesCols[3].flex, minWidth: basesCols[3].minWidth } }, row.state),
      React.createElement('div', { style: { ...cellBase, flex: basesCols[4].flex, minWidth: basesCols[4].minWidth } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: row.isActive ? '#e8f5e9' : '#fce4ec', color: row.isActive ? '#2e7d32' : '#b53838', ...font } }, row.isActive ? 'Ativo' : 'Inativo')),
      React.createElement('div', { style: { flex: basesCols[5].flex, minWidth: basesCols[5].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 } },
        React.createElement('button', { type: 'button', onClick: () => abrirEditBase(row), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Editar' }, pencilSvg),
        React.createElement('button', { type: 'button', onClick: () => abrirRemoveBase(), style: { ...webStyles.viagensActionBtn }, 'aria-label': 'Remover' }, trashSvg))));

  const basesSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  }, React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
    basesToolbar, React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, basesHeader, ...basesRowEls)));

  // ── Conditional content ───────────────────────────────────────────────
  let tabContent: React.ReactElement[];
  if (activeTab === 'Encomenda') tabContent = [encomendaKpiCards, encTableSection];
  else if (activeTab === 'Trecho') tabContent = [trechoKpiCard, trechoTableSection];
  else if (activeTab === 'Preparadores') tabContent = [preparadoresKpiCards, prepGestaoSection];
  else if (activeTab === 'Adicionais') tabContent = [adicionaisMetricRow, adicSection];
  else if (activeTab === 'Avaliações') {
    const starIcon = (filled: boolean) => React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: filled ? '#cba04b' : 'none', style: { display: 'block' } },
      React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', stroke: '#cba04b', strokeWidth: 1.5, fill: filled ? '#cba04b' : 'none' }));
    const renderStars = (count: number) => React.createElement('div', { style: { display: 'flex', gap: 2 } },
      ...[1, 2, 3, 4, 5].map((i) => React.createElement('span', { key: i }, starIcon(i <= count))));

    const avgCard = React.createElement('div', {
      style: { width: '100%', background: '#f6f6f6', borderRadius: 16, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', boxSizing: 'border-box' as const },
    },
      React.createElement('div', null,
        React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Média geral de avaliação'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16 } },
          React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, String(avalAvg || '—')),
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#22c55e', ...font } }, avaliacoes.length > 0 ? `${avaliacoes.length} avaliações` : 'sem dados'))),
      React.createElement('div', {
        style: { width: 48, height: 48, borderRadius: '50%', background: '#cba04b', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: '#fff' },
        React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }))));

    const reviewList = React.createElement('div', {
      style: { width: '100%', background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', padding: '24px 28px', display: 'flex', flexDirection: 'column' as const, gap: 0, boxSizing: 'border-box' as const },
    },
      React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, marginBottom: 16, ...font } }, 'Todas as avaliações'),
      ...avaliacoes.map((a, idx) =>
        React.createElement('div', {
          key: idx,
          style: { padding: '16px 0', borderTop: idx > 0 ? '1px solid #e2e2e2' : 'none', display: 'flex', flexDirection: 'column' as const, gap: 12 },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
              React.createElement('div', {
                style: { width: 40, height: 40, borderRadius: '50%', background: avatarColors[a.nome.charAt(0)] || '#999', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
              }, React.createElement('span', { style: { color: '#fff', fontSize: 16, fontWeight: 600, ...font } }, a.nome.charAt(0))),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
                React.createElement('span', { style: { fontWeight: 600, fontSize: 14, color: '#0d0d0d', ...font } }, a.nome),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, a.data),
                  renderStars(a.stars)))),
            React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { cursor: 'pointer' } },
              React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('p', { style: { fontSize: 14, color: '#0d0d0d', margin: 0, ...font } }, a.comentario),
            React.createElement('span', { style: { fontSize: 13, color: '#767676', whiteSpace: 'nowrap' as const, ...font } }, a.tipo)))));

    tabContent = [avgCard, reviewList];
  }
  else if (activeTab === 'Bases') tabContent = [basesMetrics, basesSection];
  else tabContent = [motoristaKpiCards, tableSection];

  // ── Editar encomenda modal ───────────────────────────────────────────
  const editEncModal = editEncOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharEditEnc,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
                React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Editar valor de encomenda'),
                React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font } }, `Atualize o tipo e o valor da encomenda ${editEncRow?.codigo ?? ''}`)),
              React.createElement('button', {
                type: 'button', onClick: fecharEditEnc, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Form
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            // Tipo
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Tipo'),
              React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                React.createElement('select', {
                  value: editEncTipo,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setEditEncTipo(e.target.value),
                  style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font },
                },
                  React.createElement('option', { value: 'Pequena' }, 'Pequena'),
                  React.createElement('option', { value: 'Média' }, 'Média'),
                  React.createElement('option', { value: 'Grande' }, 'Grande')),
                React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
                  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            // Valor
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Valor'),
              React.createElement('input', {
                type: 'text', value: editEncValor,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditEncValor(e.target.value),
                placeholder: 'R$ 75,00',
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: editEncValor ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              }))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', {
              type: 'button', onClick: salvarEditEnc,
              style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font },
            }, 'Salvar alterações'),
            React.createElement('button', {
              type: 'button', onClick: fecharEditEnc,
              style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font },
            }, 'Cancelar'))))
    : null;

  // ── Remover encomenda modal ─────────────────────────────────────────
  const removeEncModal = removeEncOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharRemoveEnc,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, maxWidth: 316, ...font } }, 'Tem certeza que deseja remover esta encomenda?'),
              React.createElement('button', {
                type: 'button', onClick: fecharRemoveEnc, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: confirmarRemoveEnc, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 600, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Remover'),
            React.createElement('button', { type: 'button', onClick: fecharRemoveEnc, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  // ── Editar adicional modal ───────────────────────────────────────────
  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 36, padding: '0 16px',
    borderRadius: 999, border: active ? '2px solid #0d0d0d' : '1px solid #d9d9d9', background: active ? '#0d0d0d' : '#fff',
    color: active ? '#fff' : '#0d0d0d', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
  });

  const editAdicModal = editAdicOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharEditAdic,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Editar tabela'),
              React.createElement('button', {
                type: 'button', onClick: fecharEditAdic, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Form
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            // Nome
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Nome'),
              React.createElement('input', {
                type: 'text', value: editAdicNome,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditAdicNome(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', boxSizing: 'border-box' as const, ...font },
              })),
            // Tipo
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Tipo'),
              React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                React.createElement('select', {
                  value: editAdicTipo,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setEditAdicTipo(e.target.value),
                  style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font },
                },
                  React.createElement('option', { value: 'Viagem' }, 'Viagem'),
                  React.createElement('option', { value: 'Encomenda' }, 'Encomenda'),
                  React.createElement('option', { value: 'Excursão' }, 'Excursão')),
                React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
                  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            // Unidade
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Unidade'),
              React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                React.createElement('select', {
                  value: editAdicUnidade,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setEditAdicUnidade(e.target.value),
                  style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: editAdicUnidade ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font },
                },
                  React.createElement('option', { value: '' }, 'Selecione a unidade'),
                  React.createElement('option', { value: 'KM' }, 'KM'),
                  React.createElement('option', { value: 'Ida' }, 'Ida'),
                  React.createElement('option', { value: 'Hora' }, 'Hora')),
                React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
                  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            // Valor
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Valor'),
              React.createElement('input', {
                type: 'text', value: editAdicValor,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditAdicValor(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', boxSizing: 'border-box' as const, ...font },
              })),
            // Inclusão chips
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%', marginTop: 8 } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Inclusão'),
              React.createElement('div', { style: { display: 'flex', gap: 8 } },
                React.createElement('button', { type: 'button', onClick: () => setEditAdicInclusao('Automática'), style: chipStyle(editAdicInclusao === 'Automática') }, 'Automática'),
                React.createElement('button', { type: 'button', onClick: () => setEditAdicInclusao('Manual'), style: chipStyle(editAdicInclusao === 'Manual') }, 'Manual')))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharEditAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Salvar alterações'),
            React.createElement('button', { type: 'button', onClick: fecharEditAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Cancelar'))))
    : null;

  // ── Remover adicional modal ─────────────────────────────────────────
  const removeAdicModal = removeAdicOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharRemoveAdic,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, maxWidth: 316, ...font } }, 'Tem certeza que deseja remover este adicional?'),
              React.createElement('button', {
                type: 'button', onClick: fecharRemoveAdic, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharRemoveAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 600, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Remover'),
            React.createElement('button', { type: 'button', onClick: fecharRemoveAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  // ── Criar adicional modal ────────────────────────────────────────────
  const criarAdicModal = criarAdicOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharCriarAdic,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Criar adicional'),
              React.createElement('button', {
                type: 'button', onClick: fecharCriarAdic, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Form
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            // Nome
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Nome'),
              React.createElement('input', {
                type: 'text', value: criarAdicNome, placeholder: 'Ex: Pedágio SP - Campinas',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCriarAdicNome(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: criarAdicNome ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              })),
            // Tipo
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Tipo'),
              React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                React.createElement('select', {
                  value: criarAdicTipo,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setCriarAdicTipo(e.target.value),
                  style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: criarAdicTipo ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font },
                },
                  React.createElement('option', { value: '', disabled: true }, 'Selecione o tipo'),
                  React.createElement('option', { value: 'Viagem' }, 'Viagem'),
                  React.createElement('option', { value: 'Encomenda' }, 'Encomenda'),
                  React.createElement('option', { value: 'Excursão' }, 'Excursão')),
                React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
                  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            // Unidade
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Unidade'),
              React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                React.createElement('select', {
                  value: criarAdicUnidade,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setCriarAdicUnidade(e.target.value),
                  style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: criarAdicUnidade ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font },
                },
                  React.createElement('option', { value: '', disabled: true }, 'Selecione a unidade'),
                  React.createElement('option', { value: 'KM' }, 'KM'),
                  React.createElement('option', { value: 'Ida' }, 'Ida'),
                  React.createElement('option', { value: 'Hora' }, 'Hora')),
                React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
                  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            // Valor
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Valor'),
              React.createElement('input', {
                type: 'text', value: criarAdicValor, placeholder: 'Ex: R$ 25,00',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCriarAdicValor(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: criarAdicValor ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              })),
            // Vincular trecho
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Vincular trecho'),
              React.createElement('input', {
                type: 'text', value: criarAdicVincular, placeholder: 'Ex: (21) 98888-7777',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCriarAdicVincular(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: criarAdicVincular ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              })),
            // Inclusão chips
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%', marginTop: 8 } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Inclusão'),
              React.createElement('div', { style: { display: 'flex', gap: 8 } },
                React.createElement('button', { type: 'button', onClick: () => setCriarAdicInclusao('Automática'), style: chipStyle(criarAdicInclusao === 'Automática') }, 'Automática'),
                React.createElement('button', { type: 'button', onClick: () => setCriarAdicInclusao('Manual'), style: chipStyle(criarAdicInclusao === 'Manual') }, 'Manual')))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharCriarAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Salvar adicional'),
            React.createElement('button', { type: 'button', onClick: fecharCriarAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Cancelar'))))
    : null;

  // ── Shared chip helper ──────────────────────────────────────────────
  const avalChip = (label: string, selected: boolean, onClick: () => void): React.ReactElement =>
    React.createElement('button', {
      type: 'button', onClick,
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 36, padding: '0 16px',
        borderRadius: 999, border: selected ? '2px solid #0d0d0d' : '1px solid #d9d9d9',
        background: selected ? '#0d0d0d' : '#fff', color: selected ? '#fff' : '#0d0d0d',
        fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const, ...font,
      },
    }, label);

  // ── Filtro encomenda modal ───────────────────────────────────────────
  const filtroEncModal = filtroEncOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharFiltroEnc,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Filtro da tabela'),
              React.createElement('button', {
                type: 'button', onClick: fecharFiltroEnc, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Body
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            // Data da atividade
            React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, 'Data da atividade'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 32, display: 'flex', alignItems: 'center', ...font } }, 'Data inicial'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, borderRadius: 8, background: '#f1f1f1', paddingLeft: 16, overflow: 'hidden', width: '100%', boxSizing: 'border-box' as const } },
                calendarSvgLg,
                React.createElement('input', {
                  type: 'text', value: filtroEncDataIni, placeholder: '05 de setembro',
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroEncDataIni(e.target.value),
                  style: { ...inputGestStyle, color: filtroEncDataIni ? '#0d0d0d' : '#767676' },
                }))),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 32, display: 'flex', alignItems: 'center', ...font } }, 'Data final'),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, borderRadius: 8, background: '#f1f1f1', paddingLeft: 16, overflow: 'hidden', width: '100%', boxSizing: 'border-box' as const } },
                calendarSvgLg,
                React.createElement('input', {
                  type: 'text', value: filtroEncDataFim, placeholder: '30 de setembro',
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroEncDataFim(e.target.value),
                  style: { ...inputGestStyle, color: filtroEncDataFim ? '#0d0d0d' : '#767676' },
                }))),
            // Categoria
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, 'Categoria'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Todos', filtroEncCategoria === 'Todos', () => setFiltroEncCategoria('Todos')),
                avalChip('Take Me', filtroEncCategoria === 'Take Me', () => setFiltroEncCategoria('Take Me')),
                avalChip('Motorista parceiro', filtroEncCategoria === 'Motorista parceiro', () => setFiltroEncCategoria('Motorista parceiro'))))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharFiltroEnc, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Aplicar filtro'),
            React.createElement('button', { type: 'button', onClick: fecharFiltroEnc, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  // ── Filtro trecho modal ─────────────────────────────────────────────
  const filtroTrechoModal = filtroTrechoOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharFiltroTrecho,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Filtro da tabela'),
              React.createElement('button', {
                type: 'button', onClick: fecharFiltroTrecho, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Body
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, 'Tipo de motorista'),
            // Primário
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Primário'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Todos', filtroTrechoPrimario === 'Todos', () => setFiltroTrechoPrimario('Todos')),
                avalChip('Take Me', filtroTrechoPrimario === 'Take Me', () => setFiltroTrechoPrimario('Take Me')),
                avalChip('Parceiros', filtroTrechoPrimario === 'Parceiros', () => setFiltroTrechoPrimario('Parceiros')))),
            // Secundário
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Secundário'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Todos', filtroTrechoSecundario === 'Todos', () => setFiltroTrechoSecundario('Todos')),
                avalChip('Viagem', filtroTrechoSecundario === 'Viagem', () => setFiltroTrechoSecundario('Viagem')),
                avalChip('Excursão', filtroTrechoSecundario === 'Excursão', () => setFiltroTrechoSecundario('Excursão'))))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharFiltroTrecho, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Aplicar filtro'),
            React.createElement('button', { type: 'button', onClick: fecharFiltroTrecho, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  // ── Filtro adicionais modal ──────────────────────────────────────────
  const filtroAdicModal = filtroAdicOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharFiltroAdic,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Filtro'),
              React.createElement('button', {
                type: 'button', onClick: fecharFiltroAdic, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Body
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Data da atividade'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 32, display: 'flex', alignItems: 'center', ...font } }, 'Origem'),
              React.createElement('input', {
                type: 'text', value: filtroAdicOrigem, placeholder: 'Ex: São Paulo - SP',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroAdicOrigem(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: filtroAdicOrigem ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              })),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 32, display: 'flex', alignItems: 'center', ...font } }, 'Destino'),
              React.createElement('input', {
                type: 'text', value: filtroAdicDestino, placeholder: 'Ex: Brasilia - DF',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroAdicDestino(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: filtroAdicDestino ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              }))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharFiltroAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Aplicar filtro'),
            React.createElement('button', { type: 'button', onClick: fecharFiltroAdic, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  // ── Filtro avaliações modal ───────────────────────────────────────────
  const filtroAvalModal = filtroAvalOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharFiltroAval,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Filtro'),
              React.createElement('button', {
                type: 'button', onClick: fecharFiltroAval, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          // Body
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            // Período
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Período'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Esta semana', filtroAvalPeriodo === 'Esta semana', () => setFiltroAvalPeriodo('Esta semana')),
                avalChip('Este mês', filtroAvalPeriodo === 'Este mês', () => setFiltroAvalPeriodo('Este mês')),
                avalChip('Este ano', filtroAvalPeriodo === 'Este ano', () => setFiltroAvalPeriodo('Este ano')))),
            // Tipo de avaliação
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Tipo de avaliação'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Todos', filtroAvalTipo === 'Todos', () => setFiltroAvalTipo('Todos')),
                avalChip('Preparadores de excursões', filtroAvalTipo === 'Preparadores de excursões', () => setFiltroAvalTipo('Preparadores de excursões')),
                avalChip('Preparadores de encomendas', filtroAvalTipo === 'Preparadores de encomendas', () => setFiltroAvalTipo('Preparadores de encomendas')))),
            // Nota mínima
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Nota mínima'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Qualquer', filtroAvalNota === 'Qualquer', () => setFiltroAvalNota('Qualquer')),
                avalChip('3+', filtroAvalNota === '3+', () => setFiltroAvalNota('3+')),
                avalChip('4+', filtroAvalNota === '4+', () => setFiltroAvalNota('4+')),
                avalChip('4.5+', filtroAvalNota === '4.5+', () => setFiltroAvalNota('4.5+')))),
            // Ordenar por
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
              React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Ordenar por'),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
                avalChip('Recentes', filtroAvalOrdem === 'Recentes', () => setFiltroAvalOrdem('Recentes')),
                avalChip('Antigos', filtroAvalOrdem === 'Antigos', () => setFiltroAvalOrdem('Antigos')),
                avalChip('Maior nota', filtroAvalOrdem === 'Maior nota', () => setFiltroAvalOrdem('Maior nota')),
                avalChip('Menor nota', filtroAvalOrdem === 'Menor nota', () => setFiltroAvalOrdem('Menor nota')))),
            // Buscar
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Buscar por nome / documento'),
              React.createElement('input', {
                type: 'text', value: filtroAvalBusca, placeholder: 'Ex: Maria, 123.456.789-00',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroAvalBusca(e.target.value),
                style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: filtroAvalBusca ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font },
              }))),
          // CTA
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharFiltroAval, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Aplicar filtro'),
            React.createElement('button', { type: 'button', onClick: fecharFiltroAval, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  // ── Bases modals ─────────────────────────────────────────────────────
  const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

  const baseFormFields = (
    nome: string, setNome: (v: string) => void,
    endereco: string, setEndereco: (v: string) => void,
    cidade: string, setCidade: (v: string) => void,
    estado: string, setEstado: (v: string) => void,
    lat?: string, setLat?: (v: string) => void,
    lng?: string, setLng?: (v: string) => void,
  ) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
      // Nome
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Nome'),
        React.createElement('input', { type: 'text', value: nome, placeholder: 'Ex: Base São Paulo Centro', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: nome ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font } })),
      // Endereço
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Endereço'),
        React.createElement('input', { type: 'text', value: endereco, placeholder: 'Ex: Rua Augusta, 100', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEndereco(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: endereco ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font } })),
      // Cidade + Estado
      React.createElement('div', { style: { display: 'flex', gap: 12, width: '100%' } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Cidade'),
          React.createElement('input', { type: 'text', value: cidade, placeholder: 'Ex: São Paulo', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCidade(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: cidade ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font } })),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Estado'),
          React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
            React.createElement('select', { value: estado, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setEstado(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: estado ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font } },
              React.createElement('option', { value: '' }, 'Selecione'),
              ...UFS.map(uf => React.createElement('option', { key: uf, value: uf }, uf))),
            React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
              React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))))),
      // Lat + Lng (only for create)
      setLat && setLng ? React.createElement('div', { style: { display: 'flex', gap: 12, width: '100%' } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Latitude'),
          React.createElement('input', { type: 'text', value: lat, placeholder: 'Ex: -23.5505', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLat(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: lat ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font } })),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Longitude'),
          React.createElement('input', { type: 'text', value: lng, placeholder: 'Ex: -46.6333', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLng(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: lng ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font } })))
      : null);

  const criarBaseModal = criarBaseOpen
    ? React.createElement('div', { role: 'dialog', 'aria-modal': true, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const }, onClick: fecharCriarBase },
        React.createElement('div', { style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Criar base'),
              React.createElement('button', { type: 'button', onClick: fecharCriarBase, 'aria-label': 'Fechar', style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 } }, closeModalSvg))),
          baseFormFields(criarBaseNome, setCriarBaseNome, criarBaseEndereco, setCriarBaseEndereco, criarBaseCidade, setCriarBaseCidade, criarBaseEstado, setCriarBaseEstado, criarBaseLat, setCriarBaseLat, criarBaseLng, setCriarBaseLng),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: salvarCriarBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Salvar base'),
            React.createElement('button', { type: 'button', onClick: fecharCriarBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Cancelar'))))
    : null;

  const editBaseModal = editBaseOpen
    ? React.createElement('div', { role: 'dialog', 'aria-modal': true, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const }, onClick: fecharEditBase },
        React.createElement('div', { style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Editar base'),
              React.createElement('button', { type: 'button', onClick: fecharEditBase, 'aria-label': 'Fechar', style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 } }, closeModalSvg))),
          baseFormFields(editBaseNome, setEditBaseNome, editBaseEndereco, setEditBaseEndereco, editBaseCidade, setEditBaseCidade, editBaseEstado, setEditBaseEstado, editBaseLat, setEditBaseLat, editBaseLng, setEditBaseLng),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharEditBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Salvar alterações'),
            React.createElement('button', { type: 'button', onClick: fecharEditBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Cancelar'))))
    : null;

  const removeBaseModal = removeBaseOpen
    ? React.createElement('div', { role: 'dialog', 'aria-modal': true, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const }, onClick: fecharRemoveBase },
        React.createElement('div', { style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, maxWidth: 316, ...font } }, 'Tem certeza que deseja remover esta base?'),
              React.createElement('button', { type: 'button', onClick: fecharRemoveBase, 'aria-label': 'Fechar', style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 } }, closeModalSvg))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharRemoveBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 600, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Remover'),
            React.createElement('button', { type: 'button', onClick: fecharRemoveBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  const filtroBaseModal = filtroBaseOpen
    ? React.createElement('div', { role: 'dialog', 'aria-modal': true, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const }, onClick: fecharFiltroBase },
        React.createElement('div', { style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Filtro'),
              React.createElement('button', { type: 'button', onClick: fecharFiltroBase, 'aria-label': 'Fechar', style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 } }, closeModalSvg))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 32, display: 'flex', alignItems: 'center', ...font } }, 'Cidade'),
              React.createElement('input', { type: 'text', value: filtroBaseCidade, placeholder: 'Ex: São Paulo', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroBaseCidade(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: filtroBaseCidade ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, ...font } })),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 32, display: 'flex', alignItems: 'center', ...font } }, 'Estado'),
              React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
                React.createElement('select', { value: filtroBaseEstado, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setFiltroBaseEstado(e.target.value), style: { width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16, color: filtroBaseEstado ? '#0d0d0d' : '#767676', outline: 'none', boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const, cursor: 'pointer', ...font } },
                  React.createElement('option', { value: '' }, 'Todos'),
                  ...UFS.map(uf => React.createElement('option', { key: uf, value: uf }, uf))),
                React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } },
                  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: fecharFiltroBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Aplicar filtro'),
            React.createElement('button', { type: 'button', onClick: fecharFiltroBase, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  return React.createElement(React.Fragment, null,
    breadcrumb, headerRow, tabsEl, ...tabContent, filtroGestaoModal,
    editEncModal, removeEncModal, editAdicModal, removeAdicModal, criarAdicModal, filtroEncModal, filtroTrechoModal, filtroAdicModal, filtroAvalModal,
    criarBaseModal, editBaseModal, removeBaseModal, filtroBaseModal);
}
