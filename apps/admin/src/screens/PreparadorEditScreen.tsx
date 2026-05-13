/**
 * PreparadorEditScreen — Editar preparador conforme Figma 898-28486.
 * Dados: excursion_requests, profiles, worker_profiles, vehicles, status_history.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  fetchPreparadorEditDetail,
  fetchPreparadorCandidates,
  fetchExcursionStatusHistory,
  savePreparadorExcursionFields,
  saveProfileFields,
  saveWorkerProfileFields,
  saveVehicleFields,
  formatCurrencyBRL,
  updateExcursionStatus,
  runChargeExcursionRequest,
} from '../data/queries';
import type { PreparadorEditDetail, PreparadorCandidate, ExcursionStatusHistoryRow, PreparadorEncomendaDetail, WorkerConnectStatus } from '../data/types';
import { supabase } from '../lib/supabase';
import { resolveStorageDisplayUrl as resolveAvatar } from '../lib/storageDisplayUrl';
import StripeConnectCard from '../components/StripeConnectCard';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const logoTakeMeBadge = require('../../assets/motoristas/logo-takeme.png');

type TabContext = 'encomendas' | 'excursoes';

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDatetimeLocalValue(s: string): string | null {
  if (!s.trim()) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fmtHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const chevronBreadcrumbSvg = React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M9 18l6-6-6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const arrowBackSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const xSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round' }));
const checkSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const toastAlertSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M12 9v3.5M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const calendarSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const starSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: '#cba04b', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }));
const checkOutlineSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const editKmSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const timelineIconSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M12 8v4l3 3', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));

const statusHistoricoStyles: Record<string, { bg: string; color: string }> = {
  'Concluído': { bg: '#b0e8d1', color: '#174f38' },
  'Agendado': { bg: '#a8c6ef', color: '#102d57' },
  'Em andamento': { bg: '#fee59a', color: '#654c01' },
  'Cancelado': { bg: '#eeafaa', color: '#551611' },
};

const inputBase: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  borderRadius: 8,
  border: 'none',
  background: '#f1f1f1',
  padding: '0 16px',
  fontSize: 16,
  fontWeight: 400,
  color: '#0d0d0d',
  outline: 'none',
  boxSizing: 'border-box' as const,
  ...font,
};

const editableField = (
  label: string,
  value: string,
  onChange: (v: string) => void,
  placeholder?: string,
) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, label),
    React.createElement('input', {
      type: 'text',
      value,
      placeholder: placeholder ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      style: inputBase,
    }));

const readOnlyBox = (label: string, value: string) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
    React.createElement('div', { style: { minHeight: 44, borderRadius: 8, background: '#f1f1f1', padding: '10px 16px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', boxSizing: 'border-box' as const, ...font } }, value));

const badgePreparador = (tipo: 'takeme' | 'parceiro') => {
  if (tipo === 'parceiro') {
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', background: '#fff', padding: '4px 8px', borderRadius: 90 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, whiteSpace: 'nowrap' as const, ...font } }, 'Preparador Parceiro'));
  }
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, background: '#fff', padding: '4px 8px', borderRadius: 90 } },
    React.createElement('img', { src: logoTakeMeBadge, alt: '', style: { width: 16, height: 16, objectFit: 'cover', flexShrink: 0 } }),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, whiteSpace: 'nowrap' as const, ...font } }, 'Preparador TakeMe'));
};

const radioPreparador = (selecionado: boolean, onClick: () => void) =>
  React.createElement('button', {
    type: 'button',
    onClick,
    'aria-pressed': selecionado,
    'aria-label': selecionado ? 'Preparador selecionado' : 'Selecionar preparador',
    style: {
      width: 40, height: 40, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  },
    React.createElement('span', {
      style: {
        width: 22, height: 22, borderRadius: '50%', border: `2px solid ${selecionado ? '#0d0d0d' : '#9a9a9a'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' as const,
      },
    }, selecionado ? React.createElement('span', { style: { width: 12, height: 12, borderRadius: '50%', background: '#0d0d0d' } }) : null));

const linhaValor = (rotulo: string, valor: string) =>
  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' } },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, rotulo),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, valor));

const avatarBlock = (nome: string, url: string | null, size = 56) => {
  const initial = (nome.trim().charAt(0) || '?').toUpperCase();
  if (url) {
    return React.createElement('img', {
      src: url,
      alt: '',
      style: { width: size, height: size, borderRadius: 9999, objectFit: 'cover', display: 'block' },
    });
  }
  return React.createElement('div', {
    style: {
      width: size, height: size, borderRadius: 9999, background: '#c5d4e3', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 20, fontWeight: 700, color: '#0d0d0d', ...font,
    },
  }, initial);
};

const cartaoPreparador = (p: PreparadorCandidate, selecionado: boolean, onSelect: () => void) => {
  const nota = p.rating != null ? String(p.rating) : '—';
  const blocoNota = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: '4px 8px', alignItems: 'center' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
      starSvg,
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', ...font } }, nota)),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#767676', ...font } }, `(${p.subtype})`));
  const colunaTexto = React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' } },
      badgePreparador(p.badge),
      radioPreparador(selecionado, onSelect)),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, p.nome),
      blocoNota));
  const cabecalho = React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 12, width: '100%' } },
    React.createElement('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-start', width: '100%', minWidth: 0 } },
      React.createElement('div', { style: { flexShrink: 0 } }, avatarBlock(p.nome, p.avatarUrl)),
      colunaTexto));
  const detalhes = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%', paddingTop: 4 } },
    linhaValor('Valor por KM', p.valorKm),
    linhaValor('Valor fixo', p.valorFixo));
  return React.createElement('div', {
    key: p.id,
    style: {
      flex: '1 1 calc(50% - 8px)',
      minWidth: 280,
      boxSizing: 'border-box' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 12,
      padding: '24px 16px',
      borderRadius: 12,
      background: '#f6f6f6',
      border: selecionado ? '2px solid #0d0d0d' : '2px solid transparent',
    },
  }, cabecalho, detalhes);
};

const statusBadgeStyle: Record<string, { bg: string; color: string }> = {
  'Em andamento': { bg: '#fee59a', color: '#654c01' },
  'Agendado': { bg: '#a8c6ef', color: '#102d57' },
  'Cancelado': { bg: '#eeafaa', color: '#551611' },
  'Concluído': { bg: '#b0e8d1', color: '#174f38' },
};

type LocationState = { tab?: TabContext };

export default function PreparadorEditScreen() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const tabContext: TabContext = state.tab === 'excursoes' ? 'excursoes' : 'encomendas';
  const isEncEditMode = /\/preparadores\/[^/]+\/editar$/.test(location.pathname);
  const breadcrumbParent = tabContext === 'excursoes' ? 'Preparador de excursões' : 'Preparador de encomendas';
  const dadosSectionTitle = tabContext === 'excursoes' ? 'Dados do preparador de excursões' : 'Dados do preparador de encomendas';

  const [detail, setDetail] = useState<PreparadorEditDetail | null>(null);
  const [encDetail, setEncDetail] = useState<PreparadorEncomendaDetail | null>(null);
  // Edit states for encomenda preparador
  const [encNome, setEncNome] = useState('');
  const [encCpf, setEncCpf] = useState('');
  const [encIdade, setEncIdade] = useState('');
  const [encCidade, setEncCidade] = useState('');
  const [encExperiencia, setEncExperiencia] = useState('');
  const [encBanco, setEncBanco] = useState('');
  const [encAgencia, setEncAgencia] = useState('');
  const [encConta, setEncConta] = useState('');
  const [encPix, setEncPix] = useState('');
  const [encSaving, setEncSaving] = useState(false);
  const [candidates, setCandidates] = useState<PreparadorCandidate[]>([]);
  const [history, setHistory] = useState<ExcursionStatusHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sortByAge, setSortByAge] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [destination, setDestination] = useState('');
  const [origem, setOrigem] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [observations, setObservations] = useState('');
  const [fleetType, setFleetType] = useState('carro');
  const [bagagemPct, setBagagemPct] = useState(75);
  const [kmLabel, setKmLabel] = useState('15km');
  const [draftPreparerId, setDraftPreparerId] = useState<string | null>(null);
  const [filtroPrep, setFiltroPrep] = useState('');

  const [nomePrep, setNomePrep] = useState('');
  const [cpfPrep, setCpfPrep] = useState('');
  const [idadePrep, setIdadePrep] = useState('');
  const [generoPrep, setGeneroPrep] = useState('');
  const [expPrep, setExpPrep] = useState('');
  const [bancoPrep, setBancoPrep] = useState('');
  const [agenciaPrep, setAgenciaPrep] = useState('');
  const [contaPrep, setContaPrep] = useState('');
  const [pixPrep, setPixPrep] = useState('');
  const [veiculoTipo, setVeiculoTipo] = useState<'moto' | 'carro'>('carro');
  const [anoVeic, setAnoVeic] = useState('');
  const [modeloVeic, setModeloVeic] = useState('');
  const [placaVeic, setPlacaVeic] = useState('');
  const [valorPercStr, setValorPercStr] = useState('');
  const [valorFixoStr, setValorFixoStr] = useState('');

  const reload = useCallback(async () => {
    if (!id) return;
    if (tabContext === 'encomendas' || tabContext === 'excursoes') {
      // Worker-focused view — fetch full worker profile data (like motorista)
      const isShipments = tabContext === 'encomendas';
      const [{ data: pp }, { data: wp }, { data: vehicles }, { data: shipments }, { data: ratings }, { data: excursions }] = await Promise.all([
        (supabase as any).from('profiles').select('full_name, phone, avatar_url, cpf, city').eq('id', id).maybeSingle(),
        (supabase as any).from('worker_profiles').select('status, subtype, cpf, age, experience_years, bank_code, bank_agency, bank_account, pix_key, cnh_document_url, cnh_document_back_url, background_check_url, city, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_notified_approved_at').eq('id', id).maybeSingle(),
        isShipments
          ? (supabase as any).from('vehicles').select('id, year, model, plate, passenger_capacity, vehicle_document_url, status').eq('worker_id', id).order('created_at', { ascending: false }).limit(5)
          : Promise.resolve({ data: [] }),
        isShipments
          ? (supabase as any).from('shipments').select('id, origin_address, destination_address, status, amount_cents, created_at').eq('driver_id', id).order('created_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
        (supabase as any).from('worker_ratings').select('id, rating, comment, created_at, rated_by').eq('worker_id', id).order('created_at', { ascending: false }).limit(20),
        !isShipments
          ? (supabase as any).from('excursion_requests').select('id, destination, excursion_date, status, scheduled_departure_at, created_at').eq('preparer_id', id).order('created_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
      ]);
      const avatarResolved = pp?.avatar_url ? await resolveAvatar(supabase as any, pp.avatar_url) : null;
      // Populate edit states
      setEncNome(pp?.full_name || '');
      setEncCpf(wp?.cpf || pp?.cpf || '');
      setEncIdade(wp?.age ? String(wp.age) : '');
      setEncCidade(wp?.city || pp?.city || '');
      setEncExperiencia(wp?.experience_years ? String(wp.experience_years) : '');
      setEncBanco(wp?.bank_code || '');
      setEncAgencia(wp?.bank_agency || '');
      setEncConta(wp?.bank_account || '');
      setEncPix(wp?.pix_key || '');

      setEncDetail({
        id, kind: 'shipment', originAddress: '—', destinationAddress: '—',
        status: wp?.status || 'pending', statusLabel: wp?.status === 'approved' ? 'Ativo' : 'Pendente',
        amountCents: 0, packageSize: null, photoUrl: null,
        recipientName: null, recipientPhone: null, recipientEmail: null,
        senderName: null, instructions: null, createdAt: '',
        preparerProfile: {
          id, fullName: pp?.full_name || null, phone: pp?.phone || null,
          avatarUrl: avatarResolved, status: wp?.status || null, subtype: wp?.subtype || null,
        },
        _workerData: wp || {},
        _profileData: pp || {},
        _vehicles: vehicles || [],
        _shipments: shipments || [],
        _ratings: ratings || [],
        _excursions: excursions || [],
      } as any);
      setLoading(false);
      return;
    }
    const [d, c, h] = await Promise.all([
      fetchPreparadorEditDetail(id),
      fetchPreparadorCandidates(),
      fetchExcursionStatusHistory(id),
    ]);
    setDetail(d);
    setCandidates(c);
    setHistory(h);
    if (d) {
      setDestination(d.destination);
      const o = typeof d.assignmentNotes.admin_origin_address === 'string'
        ? d.assignmentNotes.admin_origin_address
        : [d.clientCity, d.clientState].filter(Boolean).join(', ') || '—';
      setOrigem(o);
      setScheduledLocal(toDatetimeLocalValue(d.scheduledDepartureAt));
      setObservations(d.observations ?? '');
      setFleetType(d.fleetType);
      const bp = d.assignmentNotes.admin_baggage_pct;
      setBagagemPct(typeof bp === 'number' ? Math.min(100, Math.max(0, bp)) : 75);
      setKmLabel(typeof d.assignmentNotes.admin_km_label === 'string' ? d.assignmentNotes.admin_km_label : '15km');
      setDraftPreparerId(d.preparerId);
      const vd0 = d.vehicleDetails ?? {};
      const vc = (vd0 as { vehicle_ui_class?: string }).vehicle_ui_class;
      setVeiculoTipo(vc === 'moto' ? 'moto' : 'carro');
      setValorPercStr(typeof d.assignmentNotes.admin_valor_percent_str === 'string' ? d.assignmentNotes.admin_valor_percent_str : '');
      setValorFixoStr(typeof d.assignmentNotes.admin_valor_fixed_str === 'string' ? d.assignmentNotes.admin_valor_fixed_str : formatCurrencyBRL(d.totalAmountCents));
      const pr = d.preparerProfile;
      const wk = d.preparerWorker;
      const v0 = d.vehicles[0];
      setNomePrep(pr?.fullName ?? '');
      setCpfPrep(wk?.cpf ?? pr?.cpf ?? '');
      setIdadePrep(wk?.age != null ? String(wk.age) : '');
      setGeneroPrep(typeof d.assignmentNotes.admin_gender === 'string' ? d.assignmentNotes.admin_gender : '');
      setExpPrep(wk?.experienceYears != null ? String(wk.experienceYears) : '');
      setBancoPrep(wk?.bankCode ?? '');
      setAgenciaPrep(wk?.bankAgency ?? '');
      setContaPrep(wk?.bankAccount ?? '');
      setPixPrep(wk?.pixKey ?? '');
      setAnoVeic(v0?.year != null ? String(v0.year) : '');
      setModeloVeic(v0?.model ?? String((vd0 as { model?: string }).model ?? ''));
      setPlacaVeic(v0?.plate ?? String((vd0 as { license_plate?: string }).license_plate ?? ''));
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, reload]);

  const idFmt = useMemo(() => (id ? `#${id.slice(0, 8)}` : '—'), [id]);

  const rotaResumo = useMemo(() => {
    const o = origem.trim() || '—';
    const short = (s: string) => (s.length > 24 ? `${s.slice(0, 22)}…` : s);
    return `${short(o)} → ${short(destination.trim() || '—')}`;
  }, [origem, destination]);

  const horarioResumo = useMemo(() => {
    const iso = fromDatetimeLocalValue(scheduledLocal);
    if (iso) {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    }
    return detail?.excursionDate
      ? new Date(detail.excursionDate).toLocaleDateString('pt-BR')
      : '—';
  }, [scheduledLocal, detail?.excursionDate]);

  const receitasRows = useMemo(() => {
    if (!detail) return [];
    const lines = detail.budgetLines;
    if (Array.isArray(lines) && lines.length > 0) {
      return lines.map((l: any, i: number) => ({
        key: `b${i}`,
        c1: String(l?.label ?? 'Item'),
        c2: formatCurrencyBRL(l?.amount_cents),
        c3: detail.statusLabel,
      }));
    }
    return [{
      key: 'total',
      c1: 'Total estimado',
      c2: formatCurrencyBRL(detail.totalAmountCents),
      c3: detail.statusLabel,
    }];
  }, [detail]);

  const candidatesFiltered = useMemo(() => {
    const q = filtroPrep.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.nome.toLowerCase().includes(q));
  }, [candidates, filtroPrep]);

  const saveAll = useCallback(async () => {
    if (!id || !detail) return;
    setSaving(true);
    setBanner(null);
    const assignment_notes = {
      ...detail.assignmentNotes,
      admin_origin_address: origem,
      admin_baggage_pct: bagagemPct,
      admin_km_label: kmLabel,
      admin_valor_percent_str: valorPercStr,
      admin_valor_fixed_str: valorFixoStr,
      admin_gender: generoPrep,
    };
    const vdBase = (detail.vehicleDetails && typeof detail.vehicleDetails === 'object' ? detail.vehicleDetails : {}) as Record<string, unknown>;
    const vehicle_details = {
      ...vdBase,
      vehicle_ui_class: veiculoTipo,
      model: modeloVeic || vdBase.model,
      license_plate: placaVeic || vdBase.license_plate,
    };
    const scheduledIso = fromDatetimeLocalValue(scheduledLocal);
    const { error: e1 } = await savePreparadorExcursionFields(id, {
      destination,
      scheduled_departure_at: scheduledIso,
      observations: observations || null,
      fleet_type: fleetType,
      preparer_id: draftPreparerId,
      vehicle_details,
      assignment_notes,
    });
    if (e1) {
      setSaving(false);
      setBanner({ type: 'err', text: e1 });
      return;
    }
    const pid = draftPreparerId;
    if (pid) {
      const { error: e2 } = await saveProfileFields(pid, { full_name: nomePrep, cpf: cpfPrep || null });
      if (e2) {
        setSaving(false);
        setBanner({ type: 'err', text: e2 });
        return;
      }
      const ageNum = parseInt(idadePrep, 10);
      const expNum = parseInt(expPrep, 10);
      const { error: e3 } = await saveWorkerProfileFields(pid, {
        cpf: cpfPrep || null,
        age: Number.isNaN(ageNum) ? null : ageNum,
        experience_years: Number.isNaN(expNum) ? null : expNum,
        bank_code: bancoPrep || null,
        bank_agency: agenciaPrep || null,
        bank_account: contaPrep || null,
        pix_key: pixPrep || null,
      });
      if (e3) {
        setSaving(false);
        setBanner({ type: 'err', text: e3 });
        return;
      }
      const vid = detail.vehicles[0]?.id;
      if (vid) {
        const y = parseInt(anoVeic, 10);
        const { error: e4 } = await saveVehicleFields(vid, {
          year: Number.isNaN(y) ? null : y,
          model: modeloVeic || null,
          plate: placaVeic || null,
        });
        if (e4) {
          setSaving(false);
          setBanner({ type: 'err', text: e4 });
          return;
        }
      }
    }
    setSaving(false);
    setBanner({ type: 'ok', text: 'Alterações guardadas com sucesso.' });
    await reload();
  }, [id, detail, origem, bagagemPct, kmLabel, valorPercStr, valorFixoStr, generoPrep, veiculoTipo, modeloVeic, placaVeic, destination, scheduledLocal, observations, fleetType, draftPreparerId, nomePrep, cpfPrep, idadePrep, expPrep, bancoPrep, agenciaPrep, contaPrep, pixPrep, anoVeic, reload]);

  const confirmarSubstituicao = useCallback(async () => {
    if (!id || !draftPreparerId) {
      setBanner({ type: 'err', text: 'Selecione um preparador.' });
      return;
    }
    setSaving(true);
    setBanner(null);
    const { error } = await savePreparadorExcursionFields(id, { preparer_id: draftPreparerId });
    setSaving(false);
    if (error) setBanner({ type: 'err', text: error });
    else {
      setBanner({ type: 'ok', text: 'Preparador da excursão atualizado.' });
      await reload();
    }
  }, [id, draftPreparerId, reload]);

  if (loading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64, ...font } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676' } }, 'Carregando…'));
  }

  // ── Worker-focused preparador detail (similar to MotoristaEditScreen) ──
  if (tabContext === 'encomendas' || tabContext === 'excursoes') {
    const isShipmentsTab = tabContext === 'encomendas';
    if (!encDetail) {
      return React.createElement('div', { style: { padding: 24, ...font } },
        React.createElement('p', { style: { color: '#b53838' } }, 'Não foi possível carregar os dados deste preparador.'),
        React.createElement('button', { type: 'button', onClick: () => navigate('/preparadores'), style: { marginTop: 16, cursor: 'pointer' } }, 'Voltar à lista'));
    }
    const prep = encDetail.preparerProfile;
    const workerStatusStyle = {
      approved: { bg: '#b0e8d1', color: '#174f38', label: 'Aprovado' },
      pending: { bg: '#fee59a', color: '#654c01', label: 'Pendente' },
      inactive: { bg: '#e2e2e2', color: '#545454', label: 'Inativo' },
      rejected: { bg: '#eeafaa', color: '#551611', label: 'Rejeitado' },
      suspended: { bg: '#eeafaa', color: '#551611', label: 'Suspenso' },
    } as Record<string, { bg: string; color: string; label: string }>;
    const stInfo = workerStatusStyle[prep?.status || ''] || workerStatusStyle.pending;
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%', maxWidth: 1044, boxSizing: 'border-box' as const } },
      // Breadcrumb
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, ...font } },
        React.createElement('span', { style: { color: '#767676', cursor: 'pointer' }, onClick: () => navigate('/preparadores') }, breadcrumbParent),
        chevronBreadcrumbSvg,
        React.createElement('span', { style: { color: '#0d0d0d' } }, 'Visualização')),
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 } },
        React.createElement('button', { type: 'button', onClick: () => navigate(-1), style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', padding: 0, ...font } }, arrowBackSvg, 'Voltar'),
        isEncEditMode
          ? React.createElement('button', {
              type: 'button',
              disabled: encSaving,
              onClick: async () => {
                setEncSaving(true);
                try {
                  await saveProfileFields(id!, { full_name: encNome });
                  await saveWorkerProfileFields(id!, {
                    cpf: encCpf, age: encIdade ? Number(encIdade) : null,
                    experience_years: encExperiencia ? Number(encExperiencia) : null,
                    city: encCidade, bank_code: encBanco, bank_agency: encAgencia,
                    bank_account: encConta, pix_key: encPix,
                  });
                  setToast('Alterações salvas');
                  await reload();
                } catch { setToast('Erro ao salvar'); }
                setEncSaving(false);
              },
              style: { display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: encSaving ? 'wait' : 'pointer', opacity: encSaving ? 0.7 : 1, ...font },
            }, checkSvg, encSaving ? 'Salvando…' : 'Salvar alterações')
          : React.createElement('button', {
              type: 'button',
              onClick: () => navigate(`/preparadores/${id}/editar`, { state: { tab: tabContext } }),
              style: { display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font },
            }, 'Editar dados')),
      // Info banner
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: '#fff8e6', border: '0.5px solid #cba04b', borderRadius: 8, width: '100%', boxSizing: 'border-box' as const } },
        toastAlertSvg,
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } },
          isEncEditMode
            ? `Você está editando os dados do ${isShipmentsTab ? 'preparador de encomendas' : 'preparador de excursões'}`
            : `Você está visualizando os dados do ${isShipmentsTab ? 'preparador de encomendas' : 'preparador de excursões'}`)),
      // Status bar
      prep ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: '#fff', borderRadius: 12, border: '1px solid #e2e2e2' } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Status do preparador:'),
        React.createElement('span', { style: { padding: '4px 12px', borderRadius: 8, background: stInfo.bg, color: stInfo.color, fontSize: 13, fontWeight: 600, ...font } }, stInfo.label)) : null,
      // Dados do preparador
      React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, dadosSectionTitle),
      prep ? (() => {
        const wd = (encDetail as any)._workerData || {};
        const pd = (encDetail as any)._profileData || {};
        const vehs = ((encDetail as any)._vehicles || []) as any[];
        const ships = ((encDetail as any)._shipments || []) as any[];
        const fmtBRL = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
        const shipStatusMap: Record<string, string> = { pending_review: 'Aguardando', confirmed: 'Confirmada', in_progress: 'Em andamento', delivered: 'Entregue', cancelled: 'Cancelada' };

        return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24 } },
          // Main card: dados básicos + bancários + documentos
          React.createElement('div', { style: { background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 20 } },
            // Avatar + Nome
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottom: '1px solid #e2e2e2' } },
              avatarBlock(prep.fullName || '?', prep.avatarUrl, 64),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
                React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', ...font } }, prep.fullName || '—'),
                React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, prep.phone || '—'))),
            // Dados básicos
            React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#cba04b', margin: 0, ...font } }, 'Dados básicos'),
            isEncEditMode ? editableField('Nome completo', encNome, setEncNome) : readOnlyBox('Nome completo', prep.fullName || '—'),
            React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
              isEncEditMode ? editableField('CPF', encCpf, setEncCpf) : readOnlyBox('CPF', wd.cpf || pd.cpf || '—'),
              isEncEditMode ? editableField('Idade', encIdade, setEncIdade) : readOnlyBox('Idade', wd.age ? `${wd.age} anos` : '—')),
            React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
              isEncEditMode ? editableField('Cidade', encCidade, setEncCidade) : readOnlyBox('Cidade', wd.city || pd.city || '—'),
              isEncEditMode ? editableField('Anos de experiência', encExperiencia, setEncExperiencia) : readOnlyBox('Anos de experiência', wd.experience_years ? `${wd.experience_years} anos` : '—')),
            // Dados bancários
            React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#cba04b', margin: 0, ...font } }, 'Dados bancários'),
            React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
              isEncEditMode ? editableField('Banco', encBanco, setEncBanco) : readOnlyBox('Banco', wd.bank_code || '—'),
              isEncEditMode ? editableField('Agência', encAgencia, setEncAgencia) : readOnlyBox('Agência', wd.bank_agency || '—')),
            React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
              isEncEditMode ? editableField('Conta', encConta, setEncConta) : readOnlyBox('Conta', wd.bank_account || '—'),
              isEncEditMode ? editableField('Chave Pix', encPix, setEncPix) : readOnlyBox('Chave Pix', wd.pix_key || '—')),
            // Documentos
            React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#cba04b', margin: 0, ...font } }, 'Documentos'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
              ...[
                { label: 'CNH (frente)', url: wd.cnh_document_url },
                { label: 'CNH (verso)', url: wd.cnh_document_back_url },
                { label: 'Antecedentes criminais', url: wd.background_check_url },
              ].map((doc) =>
                React.createElement('div', { key: doc.label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f1f1' } },
                  React.createElement('span', { style: { fontSize: 14, ...font } }, doc.label),
                  doc.url
                    ? React.createElement('a', { href: doc.url, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 13, color: '#3b82f6', ...font } }, 'Ver documento')
                    : React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Não enviado'))))),

          // Stripe Connect — split automatico por stripe.transfers.create.
          (() => {
            const connect: WorkerConnectStatus = {
              accountId: (wd as any).stripe_connect_account_id ?? null,
              chargesEnabled: Boolean((wd as any).stripe_connect_charges_enabled),
              payoutsEnabled: Boolean((wd as any).stripe_connect_payouts_enabled),
              detailsSubmitted: Boolean((wd as any).stripe_connect_details_submitted),
              notifiedApprovedAt: (wd as any).stripe_connect_notified_approved_at ?? null,
            };
            return id
              ? React.createElement(StripeConnectCard, {
                  workerId: id,
                  connect,
                  onSynced: () => { void reload(); },
                })
              : null;
          })(),

          // Veículos (apenas para preparador de encomendas)
          isShipmentsTab ? React.createElement('div', { style: { background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
            React.createElement('h3', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Veículos'),
            vehs.length === 0 ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Nenhum veículo cadastrado.') : null,
            ...vehs.map((v: any) => {
              const vSt = v.status === 'approved' ? { bg: '#b0e8d1', color: '#174f38', label: 'Aprovado' } : v.status === 'pending' ? { bg: '#fee59a', color: '#654c01', label: 'Pendente' } : { bg: '#eeafaa', color: '#551611', label: v.status || '—' };
              return React.createElement('div', { key: v.id, style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const, padding: '12px 0', borderBottom: '1px solid #f1f1f1', alignItems: 'flex-end' } },
                readOnlyBox('Modelo', v.model || '—'),
                readOnlyBox('Ano', v.year ? String(v.year) : '—'),
                readOnlyBox('Placa', v.plate || '—'),
                readOnlyBox('Capacidade', v.passenger_capacity ? `${v.passenger_capacity} lugares` : '—'),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8, background: vSt.bg, color: vSt.color, alignSelf: 'center', ...font } }, vSt.label));
            }))
          : null,

          // Avaliações
          (() => {
            const rats = ((encDetail as any)._ratings || []) as any[];
            const avgRating = rats.length > 0
              ? (rats.reduce((s: number, r: any) => s + (r.rating || 0), 0) / rats.length).toFixed(1)
              : '—';
            return React.createElement('div', { style: { background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                React.createElement('h3', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, `Avaliações (${rats.length})`),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  starSvg,
                  React.createElement('span', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', ...font } }, avgRating))),
              rats.length === 0
                ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Nenhuma avaliação recebida.')
                : null,
              ...rats.map((r: any) =>
                React.createElement('div', { key: r.id, style: { padding: 12, background: '#f6f6f6', borderRadius: 12, display: 'flex', flexDirection: 'column' as const, gap: 6 } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                      ...Array.from({ length: 5 }, (_, i) =>
                        React.createElement('span', { key: i, style: { color: i < (r.rating || 0) ? '#F59E0B' : '#e2e2e2', fontSize: 16 } }, '\u2605'))),
                    React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } },
                      r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '—')),
                  r.comment ? React.createElement('p', { style: { fontSize: 14, color: '#0d0d0d', margin: 0, lineHeight: 1.5, ...font } }, r.comment) : null)));
          })(),

          // Histórico de atividades
          isShipmentsTab
            ? React.createElement('div', { style: { background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
                React.createElement('h3', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, `Histórico de encomendas (${ships.length})`),
                ships.length === 0 ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Nenhuma encomenda registrada.') : null,
                ...ships.map((s: any) =>
                  React.createElement('div', { key: s.id, style: { display: 'flex', alignItems: 'center', gap: 16, padding: 12, background: '#f6f6f6', borderRadius: 12 } },
                    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                      React.createElement('p', { style: { margin: 0, fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } },
                        `${s.origin_address?.split(',')[0] || '—'} → ${s.destination_address?.split(',')[0] || '—'}`),
                      React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#767676', ...font } },
                        s.created_at ? new Date(s.created_at).toLocaleDateString('pt-BR') : '—')),
                    React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font } }, fmtBRL(s.amount_cents || 0)),
                    React.createElement('span', { style: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: s.status === 'delivered' ? '#b0e8d1' : s.status === 'cancelled' ? '#eeafaa' : '#fee59a', color: s.status === 'delivered' ? '#174f38' : s.status === 'cancelled' ? '#551611' : '#654c01', ...font } },
                      shipStatusMap[s.status] || s.status))))
            : (() => {
                const excs = ((encDetail as any)._excursions || []) as any[];
                const excStatusMap: Record<string, string> = { pending: 'Pendente', approved: 'Aprovada', in_progress: 'Em andamento', completed: 'Concluída', cancelled: 'Cancelada' };
                return React.createElement('div', { style: { background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
                  React.createElement('h3', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, `Histórico de excursões (${excs.length})`),
                  excs.length === 0 ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Nenhuma excursão registrada.') : null,
                  ...excs.map((e: any) =>
                    React.createElement('div', { key: e.id, style: { display: 'flex', alignItems: 'center', gap: 16, padding: 12, background: '#f6f6f6', borderRadius: 12 } },
                      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                        React.createElement('p', { style: { margin: 0, fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, e.destination || '—'),
                        React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#767676', ...font } },
                          (e.scheduled_departure_at || e.excursion_date) ? new Date(e.scheduled_departure_at || e.excursion_date).toLocaleDateString('pt-BR') : '—')),
                      React.createElement('span', { style: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: e.status === 'completed' ? '#b0e8d1' : e.status === 'cancelled' ? '#eeafaa' : '#fee59a', color: e.status === 'completed' ? '#174f38' : e.status === 'cancelled' ? '#551611' : '#654c01', ...font } },
                        excStatusMap[e.status] || e.status))));
              })());
      })()
      : React.createElement('p', { style: { fontSize: 14, color: '#767676', ...font } }, 'Nenhum preparador encontrado.'));
  }

  if (!id || !detail) {
    return React.createElement('div', { style: { padding: 24, ...font } },
      React.createElement('p', { style: { color: '#b53838' } }, 'Não foi possível carregar este registo.'),
      React.createElement('button', { type: 'button', onClick: () => navigate('/preparadores'), style: { marginTop: 16, cursor: 'pointer' } }, 'Voltar à lista'));
  }

  const st = statusBadgeStyle[detail.statusLabel] ?? { bg: '#e2e2e2', color: '#0d0d0d' };

  const secTitle = (t: string, sub?: string) =>
    React.createElement('div', { style: { marginBottom: sub ? 8 : 16 } },
      React.createElement('h2', { style: { fontSize: sub ? 24 : 18, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.3, ...font } }, t),
      sub ? React.createElement('p', { style: { fontSize: 14, fontWeight: 400, color: '#767676', margin: '8px 0 0 0', ...font } }, sub) : null);

  const radioVeiculo = (valor: 'moto' | 'carro', label: string) =>
    React.createElement('button', {
      type: 'button',
      onClick: () => setVeiculoTipo(valor),
      style: {
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 40, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left' as const,
      },
    },
      React.createElement('span', {
        style: {
          width: 22, height: 22, borderRadius: '50%', border: `2px solid ${veiculoTipo === valor ? '#0d0d0d' : '#9a9a9a'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' as const,
        },
      }, veiculoTipo === valor ? React.createElement('span', { style: { width: 12, height: 12, borderRadius: '50%', background: '#0d0d0d' } }) : null),
      React.createElement('span', { style: { fontSize: 16, fontWeight: 500, color: '#0d0d0d', ...font } }, label));

  const topBanner = banner
    ? React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 16, minHeight: 48, padding: '12px 16px',
        background: banner.type === 'ok' ? '#e8f5e9' : '#ffebee',
        border: `0.5px solid ${banner.type === 'ok' ? '#4caf50' : '#b53838'}`,
        borderRadius: 8,
        width: '100%', boxSizing: 'border-box' as const,
      },
    },
      React.createElement('span', { style: { flex: 1, fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, banner.text))
    : null;

  const half = candidatesFiltered.length ? Math.ceil(candidatesFiltered.length / 2) : 0;
  const row1 = candidatesFiltered.slice(0, half);
  const row2 = candidatesFiltered.slice(half);

  const toastEl = toast ? React.createElement('div', {
    style: {
      position: 'fixed' as const, bottom: 32, left: '50%', transform: 'translateX(-50%)',
      background: '#0d0d0d', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 9999, ...font,
    },
  }, toast) : null;

  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 24,
      width: '100%',
      maxWidth: 1044,
      margin: '0 auto',
      paddingBottom: 48,
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#767676', ...font } }, breadcrumbParent),
      chevronBreadcrumbSvg,
      React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Editar preparador')),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 } },
      React.createElement('button', {
        type: 'button',
        onClick: () => navigate(-1),
        disabled: saving,
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', borderRadius: 999, border: 'none',
          background: 'transparent', cursor: saving ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font,
        },
      }, arrowBackSvg, 'Voltar'),
      React.createElement('div', { style: { display: 'flex', gap: 16, alignItems: 'center' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => navigate(-1),
          disabled: saving,
          style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', borderRadius: 999, border: 'none',
            background: '#f1f1f1', cursor: saving ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, color: '#b53838', ...font,
          },
        }, xSvg, 'Cancelar'),
        React.createElement('button', {
          type: 'button',
          onClick: () => saveAll(),
          disabled: saving,
          style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', borderRadius: 999, border: 'none',
            background: '#0d0d0d', cursor: saving ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, color: '#fff', opacity: saving ? 0.7 : 1, ...font,
          },
        }, checkSvg, saving ? 'A guardar…' : 'Salvar alteração'))),
    topBanner,
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 16, minHeight: 48, padding: '12px 16px',
        background: '#fff8e6', border: '0.5px solid #cba04b', borderRadius: 8,
        boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.04)', width: '100%', boxSizing: 'border-box' as const,
      },
    },
      toastAlertSvg,
      React.createElement('span', { style: { flex: 1, fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, 'Você está editando este preparador')),
    React.createElement('div', { style: { display: 'flex', gap: 24, flexWrap: 'wrap' as const, alignItems: 'flex-start' } },
      React.createElement('div', {
        style: {
          flex: '1 1 340px', maxWidth: '100%', height: 255, borderRadius: 16, background: 'linear-gradient(145deg, #dfe8f0 0%, #c5d4e3 45%, #a8b8c9 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' as const,
        },
      },
        React.createElement('div', {
          style: {
            position: 'absolute', width: 88, height: 88, borderRadius: '50%', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(13,13,13,0.25)',
          },
        },
          React.createElement('svg', { width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
            React.createElement('path', { d: 'M12 22s8-6.5 8-12a8 8 0 10-16 0c0 5.5 8 12 8 12z', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
            React.createElement('circle', { cx: 12, cy: 10, r: 2.5, fill: '#fff' })))),
      React.createElement('div', { style: { flex: '0 1 308px', display: 'flex', flexDirection: 'column' as const, gap: 12, minWidth: 260 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#767676', ...font } }, 'Resumo da viagem •'),
          React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', ...font } }, idFmt)),
        React.createElement('span', {
          style: {
            display: 'inline-block', padding: '4px 14px', borderRadius: 999, background: st.bg, color: st.color,
            fontSize: 13, fontWeight: 700, alignSelf: 'flex-start', ...font,
          },
        }, detail.statusLabel),
        // Status advancement buttons
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginTop: 4 } },
          ...((): React.ReactElement[] => {
            const statusFlow: Record<string, { next: string; label: string }> = {
              'pending': { next: 'in_analysis', label: 'Iniciar análise' },
              'in_analysis': { next: 'quoted', label: 'Enviar orçamento' },
              'quoted': { next: 'approved', label: 'Aprovar' },
              'approved': { next: 'scheduled', label: 'Agendar' },
              'scheduled': { next: 'in_progress', label: 'Iniciar viagem' },
              'in_progress': { next: 'completed', label: 'Concluir' },
            };
            const current = detail.statusRaw;
            const flow = statusFlow[current];
            const btns: React.ReactElement[] = [];
            if (flow) {
              btns.push(React.createElement('button', {
                key: 'advance', type: 'button',
                onClick: async () => {
                  await updateExcursionStatus(detail.id, flow.next);
                  navigate(0);
                },
                style: { display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font },
              }, flow.label));
            }
            if (current !== 'cancelled' && current !== 'completed') {
              btns.push(React.createElement('button', {
                key: 'cancel', type: 'button',
                onClick: async () => {
                  if (confirm('Cancelar esta excursão?')) {
                    await updateExcursionStatus(detail.id, 'cancelled');
                    navigate(0);
                  }
                },
                style: { display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font },
              }, 'Cancelar'));
            }
            return btns;
          })()),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Rota'),
        React.createElement('div', { style: { minHeight: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font } }, rotaResumo),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Horário de saída'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px' } },
          calendarSvg,
          React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, horarioResumo.split(',')[0]?.trim() ?? horarioResumo)),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Ocupação de bagagem'),
        React.createElement('div', { style: { width: '100%', paddingTop: 4 } },
          React.createElement('input', {
            type: 'range',
            min: 0,
            max: 100,
            value: bagagemPct,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBagagemPct(Number(e.target.value)),
            style: { width: '100%', height: 24, accentColor: '#0d0d0d', cursor: 'pointer' },
          }),
          React.createElement('div', { style: { textAlign: 'right' as const, fontSize: 12, color: '#767676', marginTop: 4, ...font } }, `${bagagemPct}%`)))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Trajeto de origem e destino'),
      editableField('Origem (ponto de partida / recolha)', origem, setOrigem, 'Ex.: São Paulo, SP'),
      editableField('Destino da excursão', destination, setDestination, 'Ex.: Rio de Janeiro, RJ')),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Horário agendado para início'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        calendarSvg,
        React.createElement('input', {
          type: 'datetime-local',
          value: scheduledLocal,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScheduledLocal(e.target.value),
          style: { ...inputBase, flex: 1 },
        })),
      React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Alterar o horário de início atualizará automaticamente o tempo estimado de chegada.')),
    editableField('Observações da excursão', observations, setObservations, 'Notas internas'),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Tipo de frota (excursão)'),
      React.createElement('select', {
        value: fleetType,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setFleetType(e.target.value),
        style: { ...inputBase, cursor: 'pointer' },
      },
        React.createElement('option', { value: 'carro' }, 'Carro'),
        React.createElement('option', { value: 'van' }, 'Van'),
        React.createElement('option', { value: 'micro_onibus' }, 'Micro-ônibus'),
        React.createElement('option', { value: 'onibus' }, 'Ônibus'))),
    React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 16, padding: 24, background: '#fff', width: '100%', boxSizing: 'border-box' as const } },
      secTitle(dadosSectionTitle),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, marginTop: 8 } },
        React.createElement('div', null,
          React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '0 0 12px 0', ...font } }, 'Dados básicos'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
            editableField('Nome completo', nomePrep, setNomePrep, 'Nome do preparador'),
            editableField('CPF', cpfPrep, setCpfPrep, '000.000.000-00'),
            editableField('Idade', idadePrep, setIdadePrep, 'Ex.: 25'),
            editableField('Gênero', generoPrep, setGeneroPrep, 'Ex.: Feminino'),
            editableField('Tempo de experiência (anos)', expPrep, setExpPrep, 'Ex.: 5'))),
        React.createElement('div', null,
          React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '0 0 12px 0', ...font } }, 'Dados bancários'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
            editableField('Banco (código)', bancoPrep, setBancoPrep, 'Ex.: 341'),
            editableField('Agência', agenciaPrep, setAgenciaPrep, ''),
            editableField('Conta', contaPrep, setContaPrep, ''),
            editableField('Chave PIX', pixPrep, setPixPrep, ''))),
        React.createElement('div', null,
          React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '0 0 12px 0', ...font } }, 'Veículo de transporte'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, marginBottom: 16 } },
            radioVeiculo('moto', 'Moto'),
            radioVeiculo('carro', 'Carro')),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
            editableField('Ano fabricação', anoVeic, setAnoVeic, '2018'),
            editableField('Modelo', modeloVeic, setModeloVeic, ''),
            editableField('Placa', placaVeic, setPlacaVeic, ''))),
        React.createElement('div', null,
          React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '0 0 12px 0', ...font } }, 'Valores e precificação'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
            editableField('Valor porcentagem (%) — texto livre', valorPercStr, setValorPercStr, 'Ex.: 15% ou R$ 15,00'),
            editableField('Valor fixo (R$) — texto livre', valorFixoStr, setValorFixoStr, 'Ex.: R$ 5,00'))),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 8 } },
          React.createElement('button', {
            type: 'button',
            onClick: () => saveAll(),
            disabled: saving,
            style: {
              height: 44, padding: '0 24px', borderRadius: 999, border: '1px solid #0d0d0d', background: '#fff',
              fontSize: 14, fontWeight: 600, color: '#0d0d0d', cursor: saving ? 'wait' : 'pointer', ...font,
            },
          }, 'Salvar dados')))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      secTitle('Preparadores disponíveis'),
      React.createElement('p', { style: { fontSize: 13, color: '#767676', margin: 0, ...font } }, 'Lista de workers com subtipo excursões ou encomendas (ativos). Selecione e confirme para associar à excursão.'),
      React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 12, padding: 24, width: '100%', boxSizing: 'border-box' as const } },
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, marginBottom: 20 } },
          React.createElement('div', { style: { flex: '1 1 200px', minWidth: 180 } },
            React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', display: 'block', marginBottom: 8, ...font } }, 'Filtrar por nome'),
            React.createElement('input', {
              type: 'search',
              value: filtroPrep,
              placeholder: 'Buscar preparador…',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFiltroPrep(e.target.value),
              style: inputBase,
            }))),
        candidatesFiltered.length === 0
          ? React.createElement('p', { style: { fontSize: 14, color: '#767676', ...font } }, 'Nenhum preparador encontrado. Verifique permissões admin em worker_profiles ou cadastre workers.')
          : React.createElement(React.Fragment, null,
            row1.length > 0 ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16 } },
              ...row1.map((p) => cartaoPreparador(p, draftPreparerId === p.id, () => setDraftPreparerId(p.id)))) : null,
            row2.length > 0 ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, marginTop: 16 } },
              ...row2.map((p) => cartaoPreparador(p, draftPreparerId === p.id, () => setDraftPreparerId(p.id)))) : null),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 20 } },
          React.createElement('button', {
            type: 'button',
            onClick: () => confirmarSubstituicao(),
            disabled: saving,
            style: {
              display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', borderRadius: 999, border: '1px solid #0d0d0d',
              background: '#fff', cursor: saving ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font,
            },
          }, checkOutlineSvg, 'Confirmar substituição')))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 8 } },
        secTitle('Passageiros da excursão'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { setSortByAge((prev) => !prev); },
          style: { height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid #e2e2e2', background: sortByAge ? '#0d0d0d' : '#fff', color: sortByAge ? '#fff' : '#0d0d0d', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font },
        }, sortByAge ? 'Ordenar por nome' : 'Ordenar por idade')),
      // ── Boarding KPIs ─────────────────────────────────────────────────
      detail.passengers.length > 0 ? React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' as const } },
        ...[
          { label: 'Total', value: detail.passengers.length, bg: '#f6f6f6', color: '#0d0d0d' },
          { label: '✅ Embarcados', value: detail.passengers.filter((p) => p.statusDeparture === 'embarked').length, bg: '#b0e8d1', color: '#174f38' },
          { label: '⏳ Aguardando', value: detail.passengers.filter((p) => !p.statusDeparture || p.statusDeparture === 'not_started').length, bg: '#e5e7eb', color: '#374151' },
          { label: '❌ Ausentes', value: detail.passengers.filter((p) => p.statusDeparture === 'absent').length, bg: '#eeafaa', color: '#551611' },
          { label: '📋 Just. ausência', value: detail.passengers.filter((p) => p.absenceJustified).length, bg: '#fef3c7', color: '#92400e' },
        ].map((k) => React.createElement('div', {
          key: k.label,
          style: { flex: '1 1 0', minWidth: 100, background: k.bg, borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: 6, boxSizing: 'border-box' as const },
        },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, k.label),
          React.createElement('span', { style: { fontSize: 24, fontWeight: 700, color: k.color, ...font } }, String(k.value))))) : null,
      detail.passengers.length === 0
        ? React.createElement('p', { style: { fontSize: 14, color: '#767676', ...font } }, 'Sem passageiros registados nesta solicitação.')
        : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16 } },
          ...[...detail.passengers].sort((a, b) => {
            if (!sortByAge) return 0;
            const ageA = a.age ?? 0;
            const ageB = b.age ?? 0;
            return ageA - ageB;
          }).map((pass) => {
            // Boarding status badge
            const depStatus = pass.statusDeparture;
            const depBadge = depStatus === 'embarked'
              ? { label: 'Embarcado', bg: '#b0e8d1', color: '#174f38' }
              : depStatus === 'absent'
              ? { label: pass.absenceJustified ? 'Ausente (justif.)' : 'Ausente', bg: pass.absenceJustified ? '#fef3c7' : '#eeafaa', color: pass.absenceJustified ? '#92400e' : '#551611' }
              : { label: 'Aguardando', bg: '#e5e7eb', color: '#374151' };

            return React.createElement('div', {
              key: pass.id,
              style: { flex: '1 1 calc(50% - 8px)', minWidth: 280, border: '1px solid #e2e2e2', borderRadius: 16, background: '#fff', padding: 20, boxSizing: 'border-box' as const },
            },
              // Header: name + status badge
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap' as const, gap: 8 } },
                React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: '#0d0d0d', ...font } }, pass.fullName || 'Passageiro'),
                React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: depBadge.bg, color: depBadge.color, ...font } }, depBadge.label)),
              pass.age != null ? React.createElement('p', { style: { fontSize: 12, color: '#767676', margin: '0 0 10px', ...font } }, `${pass.age} anos`) : null,
              readOnlyBox('CPF', pass.cpf ?? '—'),
              React.createElement('div', { style: { height: 8 } }),
              readOnlyBox('Telefone', pass.phone ?? '—'),
              React.createElement('div', { style: { height: 8 } }),
              readOnlyBox('Observações', pass.observations ?? '—'),
              // Check-in / Check-out / Marcar ausente buttons
              React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' as const } },
                React.createElement('button', {
                  type: 'button',
                  onClick: async () => {
                    await (await import('../lib/supabase')).supabase.from('excursion_passengers')
                      .update({ status_departure: 'embarked' }).eq('id', pass.id);
                    setToast(`${pass.fullName} embarcado(a) ✅`);
                    setDetail((prev) => prev ? { ...prev, passengers: prev.passengers.map((p) => p.id === pass.id ? { ...p, statusDeparture: 'embarked' } : p) } : prev);
                  },
                  style: { flex: 1, height: 36, borderRadius: 8, border: 'none', background: depStatus === 'embarked' ? '#0d8344' : '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', ...font },
                }, depStatus === 'embarked' ? '✅ Embarcado' : 'Check-in'),
                React.createElement('button', {
                  type: 'button',
                  onClick: async () => {
                    await (await import('../lib/supabase')).supabase.from('excursion_passengers')
                      .update({ status_departure: 'absent' }).eq('id', pass.id);
                    setToast(`${pass.fullName} marcado(a) como ausente`);
                    setDetail((prev) => prev ? { ...prev, passengers: prev.passengers.map((p) => p.id === pass.id ? { ...p, statusDeparture: 'absent' } : p) } : prev);
                  },
                  style: { flex: 1, height: 36, borderRadius: 8, border: '1px solid #e2e2e2', background: depStatus === 'absent' ? '#d64545' : '#fff', color: depStatus === 'absent' ? '#fff' : '#0d0d0d', fontSize: 12, fontWeight: 600, cursor: 'pointer', ...font },
                }, depStatus === 'absent' ? '❌ Ausente' : 'Ausente')));
          }))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      secTitle('Métricas e histórico'),
      React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 16, padding: '24px 24px 32px', background: '#fff' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 } },
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, 'KM percorridos'),
          React.createElement('button', { type: 'button', 'aria-label': 'Editar', style: { width: 44, height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, editKmSvg)),
        React.createElement('input', {
          type: 'text',
          value: kmLabel,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setKmLabel(e.target.value),
          style: { ...inputBase, fontSize: 48, fontWeight: 700, minHeight: 56 },
        }))),
    (() => {
      if (!detail) return null;
      const amountRow = (label: string, cents: number | null | undefined, opts: { bold?: boolean; muted?: boolean } = {}) =>
        React.createElement('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f1f1', fontSize: 14, color: opts.muted ? '#767676' : '#0d0d0d', fontWeight: opts.bold ? 700 : 500, ...font } },
          React.createElement('span', null, label),
          React.createElement('span', null, formatCurrencyBRL(cents ?? 0)));
      const piUrl = detail.stripePaymentIntentId
        ? `https://dashboard.stripe.com/payments/${detail.stripePaymentIntentId}`
        : null;
      const canCharge = !detail.stripePaymentIntentId && (detail.statusRaw === 'quoted' || detail.statusRaw === 'approved');
      const handleCharge = async (method: 'pix' | 'card') => {
        if (!detail?.id) return;
        setBanner(null);
        const res = await runChargeExcursionRequest(detail.id, method);
        if (res.error || (res.data && (res.data as any).error)) {
          setBanner({ type: 'err', text: res.error || (res.data as any)?.error || 'Falha ao iniciar cobranca' });
          return;
        }
        const data = res.data as any;
        const payIntent = data?.payment_intent_id || data?.paymentIntentId;
        const qr = data?.next_action?.pix_display_qr_code || data?.pix_qr_code;
        setBanner({ type: 'ok', text: `Cobranca iniciada${payIntent ? ` (PI: ${payIntent})` : ''}${qr ? ' — QR PIX gerado' : ''}` });
        await reload();
      };
      return React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 16, padding: '24px', background: '#fff', display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Orçamento e pagamento'),
        amountRow('Total cobrado do cliente', detail.totalAmountCents, { bold: true }),
        amountRow('Pagamento ao preparador', detail.preparerPayoutCents),
        amountRow('Pagamento ao motorista', detail.driverPayoutCents),
        amountRow('Worker payout (preparador + motorista)', detail.workerPayoutCents, { muted: true }),
        amountRow('Taxa da plataforma', detail.platformFeeCents),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 12, marginTop: 8, fontSize: 13, color: '#0d0d0d', ...font } },
          React.createElement('div', null,
            React.createElement('span', { style: { color: '#767676' } }, 'Preparador: '),
            React.createElement('span', { style: { fontWeight: 600 } }, detail.preparerId ? `#${detail.preparerId.slice(0, 8)}` : '—')),
          React.createElement('div', null,
            React.createElement('span', { style: { color: '#767676' } }, 'Motorista: '),
            React.createElement('span', { style: { fontWeight: 600 } }, detail.driverId ? `#${detail.driverId.slice(0, 8)}` : '—')),
          React.createElement('div', null,
            React.createElement('span', { style: { color: '#767676' } }, 'Status: '),
            React.createElement('span', { style: { fontWeight: 600 } }, detail.statusLabel))),
        piUrl
          ? React.createElement('div', { style: { fontSize: 13, color: '#0d0d0d', ...font } },
              React.createElement('span', { style: { color: '#767676' } }, 'Stripe PaymentIntent: '),
              React.createElement('a', { href: piUrl, target: '_blank', rel: 'noopener noreferrer', style: { color: '#3b82f6', fontWeight: 600 } }, detail.stripePaymentIntentId))
          : React.createElement('div', { style: { fontSize: 13, color: '#767676', ...font } }, 'Ainda sem cobranca registrada.'),
        canCharge
          ? React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
              React.createElement('button', {
                type: 'button', onClick: () => handleCharge('pix'),
                style: { height: 40, padding: '0 16px', borderRadius: 8, border: 'none', background: '#0d8344', color: '#fff', fontWeight: 600, cursor: 'pointer', ...font },
              }, 'Cobrar cliente via PIX'),
              React.createElement('button', {
                type: 'button', onClick: () => handleCharge('card'),
                style: { height: 40, padding: '0 16px', borderRadius: 8, border: '1px solid #d9d9d9', background: '#fff', color: '#0d0d0d', fontWeight: 600, cursor: 'pointer', ...font },
              }, 'Cobrar cliente via cartão'))
          : null);
    })(),
    React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 16, overflow: 'hidden', background: '#fff' } },
      React.createElement('div', { style: { padding: '28px 28px 16px' } },
        React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Orçamento / receitas')),
      React.createElement('div', { style: { overflowX: 'auto' as const } },
        React.createElement('div', {
          style: {
            display: 'flex', minWidth: 640, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '12px 16px', fontSize: 11, fontWeight: 400, color: '#0d0d0d', ...font,
          },
        },
          React.createElement('div', { style: { flex: 2, padding: '4px 6px' } }, 'Descrição'),
          React.createElement('div', { style: { flex: 1, padding: '4px 6px' } }, 'Valor'),
          React.createElement('div', { style: { flex: 1, padding: '4px 6px' } }, 'Estado')),
        ...receitasRows.map((row) => {
          const rs = statusHistoricoStyles[row.c3] ?? { bg: '#f1f1f1', color: '#0d0d0d' };
          return React.createElement('div', {
            key: row.key,
            style: {
              display: 'flex', minWidth: 640, alignItems: 'center', background: '#f6f6f6', borderBottom: '1px solid #d9d9d9', padding: '14px 16px', fontSize: 13, ...font,
            },
          },
            React.createElement('div', { style: { flex: 2, fontWeight: 500 } }, row.c1),
            React.createElement('div', { style: { flex: 1, fontWeight: 600 } }, row.c2),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('span', {
                style: {
                  display: 'inline-block', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: rs.bg, color: rs.color,
                },
              }, row.c3)));
        }))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      secTitle('Histórico de alterações (status)'),
      history.length === 0
        ? React.createElement('p', { style: { fontSize: 14, color: '#767676', ...font } }, 'Sem registos em status_history para esta excursão.')
        : React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 12, overflow: 'hidden', background: '#fff' } },
          ...history.map((ev, idx) =>
            React.createElement('div', {
              key: `${ev.changedAt}-${idx}`,
              style: {
                display: 'flex', gap: 16, alignItems: 'flex-start', padding: '16px',
                borderBottom: idx < history.length - 1 ? '1px solid #e2e2e2' : 'none',
              },
            },
              React.createElement('div', { style: { width: 40, height: 40, borderRadius: 8, background: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, timelineIconSvg),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('p', { style: { fontSize: 15, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.4, ...font } }, `Status: ${ev.status}`),
                React.createElement('p', { style: { fontSize: 14, fontWeight: 400, color: '#767676', margin: '6px 0 0 0', ...font } }, fmtHistoryDate(ev.changedAt))))))));
}
