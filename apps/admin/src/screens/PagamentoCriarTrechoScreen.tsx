/**
 * PagamentoCriarTrechoScreen — Criar trecho.
 * Motorista: Figma 1009-17008.
 * Preparador de excursões: Figma 1009-42495.
 * Preparador de encomendas: Figma 1009-42847.
 * Toast sucesso ao salvar: Figma 1009-39523 (≈3s).
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createPricingRoute, fetchSurchargeCatalog } from '../data/queries';
import type { SurchargeCatalogRow } from '../data/types';
import PlacesAddressInput from '../components/PlacesAddressInput';
import type { PlaceResolved } from '../components/PlacesAddressInput';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

type TabTrecho = 'motorista' | 'prep_exc' | 'prep_enc';

type TrechoFormSlice = {
  origem: string;
  destino: string;
  diaria: string;
  /** Só aba encomendas: por KM vs valor fixo */
  encTipoValor: 'por_km' | 'fixo';
  encValorKm: string;
  encValorFixo: string;
  ida: string;
  retorno: string;
  pctWorker: string;
  pctAdmin: string;
  manualExtra: boolean;
  adicionalId: string;
};

function parseBRLToCents(s: string): number {
  const t = s.trim().replace(/R\$\s?/gi, '').replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const PLACEHOLDERS: Record<TabTrecho, { origem: string; destino: string; diaria: string }> = {
  motorista: {
    origem: 'Ex: Curitiba - PR',
    destino: 'Ex: São Paulo - SP',
    diaria: 'Ex: R$ 95,00',
  },
  prep_exc: {
    origem: 'Ex: Recife - PE',
    destino: 'Ex: João Pessoa - PB',
    diaria: 'Ex: R$ 320,00',
  },
  prep_enc: {
    origem: 'Ex: Brasília - DF',
    destino: 'Ex: São Paulo - SP',
    diaria: '',
  },
};

function initialForms(): Record<TabTrecho, TrechoFormSlice> {
  return {
    motorista: {
      origem: '',
      destino: '',
      diaria: '',
      encTipoValor: 'por_km',
      encValorKm: '',
      encValorFixo: '',
      ida: '2025-09-05T15:30',
      retorno: '2025-09-15T16:30',
      pctWorker: '',
      pctAdmin: '',
      manualExtra: true,
      adicionalId: '',
    },
    prep_exc: {
      origem: '',
      destino: '',
      diaria: '',
      encTipoValor: 'por_km',
      encValorKm: '',
      encValorFixo: '',
      ida: '2025-10-06T10:30',
      retorno: '2025-10-12T14:30',
      pctWorker: '',
      pctAdmin: '',
      manualExtra: false,
      adicionalId: '',
    },
    prep_enc: {
      origem: '',
      destino: '',
      diaria: '',
      encTipoValor: 'por_km',
      encValorKm: '',
      encValorFixo: '',
      ida: '2025-11-11T11:40',
      retorno: '2025-10-19T15:40',
      pctWorker: '',
      pctAdmin: '',
      manualExtra: true,
      adicionalId: '',
    },
  };
}

const arrowLeftSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const checkWhiteSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
/** Ícone do toast sucesso: círculo branco + check preto (Figma 1009-39523) */
const toastCheckCircleSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('circle', { cx: 12, cy: 12, r: 11, fill: '#fff' }),
  React.createElement('path', { d: 'M9 12l2 2 4-4', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const calendarSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const chevronDownSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const infoSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#cba04b', strokeWidth: 2 }),
  React.createElement('path', { d: 'M12 16v-5M12 8h.01', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

const labelField: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font };
const inputGray: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 8, border: 'none', outline: 'none',
  background: '#f1f1f1', fontSize: 16, color: '#0d0d0d', padding: '0 16px', boxSizing: 'border-box', ...font,
};
const card: React.CSSProperties = {
  border: '1px solid #e2e2e2',
  borderRadius: 12,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  width: '100%',
  boxSizing: 'border-box',
};
const tituloCard: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font };

function toggleSwitch(selected: boolean, onClick: () => void) {
  return React.createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': selected,
    onClick,
    style: {
      width: 48,
      height: 28,
      borderRadius: 100,
      padding: 0,
      cursor: 'pointer',
      flexShrink: 0,
      position: 'relative' as const,
      background: selected ? '#0d0d0d' : '#f3f4f6',
      border: selected ? 'none' : '2px solid #737373',
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('span', {
      style: {
        position: 'absolute',
        top: 2,
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        left: selected ? 24 : 2,
        transition: 'left 0.15s ease',
      },
    }));
}

const TOAST_MS = 3000;

/** Aba inicial a partir de `?tab=` na URL (ex.: detalhe preparador encomendas → criar trecho). */
function tabFromSearchParams(sp: URLSearchParams): TabTrecho {
  const t = (sp.get('tab') || '').trim().toLowerCase();
  if (t === 'prep_enc' || t === 'preparador-encomendas' || t === 'encomendas') return 'prep_enc';
  if (t === 'prep_exc' || t === 'preparador-excursoes' || t === 'excursao' || t === 'excursões') return 'prep_exc';
  if (t === 'motorista') return 'motorista';
  return 'motorista';
}

export default function PagamentoCriarTrechoScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabTrecho>(() =>
    tabFromSearchParams(new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')),
  );

  useEffect(() => {
    setTab(tabFromSearchParams(searchParams));
  }, [searchParams]);
  const [forms, setForms] = useState<Record<TabTrecho, TrechoFormSlice>>(initialForms);
  const [toastSalvoOpen, setToastSalvoOpen] = useState(false);
  const [surcharges, setSurcharges] = useState<SurchargeCatalogRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // Coordenadas resolvidas pelo Google Places
  const [originCoord, setOriginCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoord, setDestCoord] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    fetchSurchargeCatalog().then(setSurcharges);
  }, []);

  const f = forms[tab];
  const ph = PLACEHOLDERS[tab];

  const patch = useCallback((p: Partial<TrechoFormSlice>) => {
    setForms((prev) => ({ ...prev, [tab]: { ...prev[tab], ...p } }));
  }, [tab]);

  const voltar = useCallback(() => navigate('/pagamentos/gestao'), [navigate]);
  const salvar = useCallback(async () => {
    if (saving || toastSalvoOpen) return;
    setSaveErr(null);
    const dest = f.destino.trim();
    if (!dest) {
      setSaveErr('Indique o destino do trecho.');
      return;
    }
    let role_type: string;
    let pricing_mode: string;
    let price_cents: number;
    if (tab === 'motorista') {
      role_type = 'driver';
      pricing_mode = 'daily_rate';
      price_cents = parseBRLToCents(f.diaria);
    } else if (tab === 'prep_exc') {
      role_type = 'preparer_excursions';
      pricing_mode = 'daily_rate';
      price_cents = parseBRLToCents(f.diaria);
    } else {
      role_type = 'preparer_shipments';
      pricing_mode = f.encTipoValor === 'por_km' ? 'per_km' : 'fixed';
      price_cents = f.encTipoValor === 'por_km' ? parseBRLToCents(f.encValorKm) : parseBRLToCents(f.encValorFixo);
    }
    if (price_cents <= 0) {
      setSaveErr('Indique um valor válido (preço / diária).');
      return;
    }

    const dw = Number.parseFloat(f.pctWorker.replace(',', '.'));
    const da = Number.parseFloat(f.pctAdmin.replace(',', '.'));
    const surcharges = f.manualExtra && f.adicionalId
      ? [{ surcharge_id: f.adicionalId }]
      : undefined;

    setSaving(true);
    const { error } = await createPricingRoute({
      role_type,
      title: `${f.origem.trim() || 'Origem'} → ${dest}`.slice(0, 120),
      origin_address: f.origem.trim() || undefined,
      destination_address: dest,
      pricing_mode,
      price_cents,
      ...(Number.isFinite(dw) ? { driver_pct: dw } : {}),
      ...(Number.isFinite(da) ? { admin_pct: da } : {}),
      surcharges,
      ...(originCoord ? { origin_lat: originCoord.lat, origin_lng: originCoord.lng } : {}),
      ...(destCoord ? { destination_lat: destCoord.lat, destination_lng: destCoord.lng } : {}),
    });
    setSaving(false);
    if (error) {
      setSaveErr(error);
      return;
    }
    setToastSalvoOpen(true);
  }, [saving, toastSalvoOpen, f, tab]);

  useEffect(() => {
    if (!toastSalvoOpen) return;
    const t = window.setTimeout(() => {
      setToastSalvoOpen(false);
      navigate('/pagamentos/gestao');
    }, TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toastSalvoOpen, navigate]);

  const pctWorkerLabel = tab === 'motorista' ? '% ganho do motorista' : '% ganho do preparador';
  const showPercentuais = tab === 'motorista';

  const breadcrumbPiece = (text: string, muted: boolean, onClick?: () => void) =>
    React.createElement(onClick ? 'button' : 'span', {
      type: onClick ? 'button' : undefined,
      onClick,
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: muted ? '#767676' : '#0d0d0d',
        background: 'none',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        padding: 0,
        ...font,
      },
    }, text);

  const chevronBc = React.createElement('span', { style: { color: '#767676', fontSize: 12, margin: '0 2px' } }, '>');

  const breadcrumb = React.createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 4 } },
    breadcrumbPiece('Pagamentos', true, () => navigate('/pagamentos')),
    chevronBc,
    breadcrumbPiece('Percificação e porcentagem', true, () => navigate('/pagamentos/gestao')),
    chevronBc,
    breadcrumbPiece('Criar trecho', false));

  const tabBtn = (key: TabTrecho, label: string) => {
    const active = tab === key;
    return React.createElement('button', {
      key,
      type: 'button',
      onClick: () => setTab(key),
      style: {
        flex: '1 1 0',
        minWidth: 0,
        height: 48,
        padding: '14px 16px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        position: 'relative' as const,
        fontSize: 16,
        fontWeight: active ? 600 : 400,
        color: active ? '#0d0d0d' : '#767676',
        ...font,
      },
    },
      label,
      active ? React.createElement('div', {
        style: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: '#0d0d0d',
          borderRadius: 100,
        },
      }) : null);
  };

  const tabsRow = React.createElement('div', { style: { width: '100%' } },
    React.createElement('div', { style: { display: 'flex', width: '100%' } },
      tabBtn('motorista', 'Motorista'),
      tabBtn('prep_exc', 'Preparador de excursões'),
      tabBtn('prep_enc', 'Preparador de encomendas')),
    React.createElement('div', { style: { height: 1, background: '#e2e2e2', width: '100%' } }));

  const fieldText = (rotulo: string, value: string, onChange: (v: string) => void, placeholder: string, fullRow?: boolean) =>
    React.createElement('div', {
      style: {
        flex: fullRow ? 'none' : '1 1 200px',
        width: fullRow ? '100%' : undefined,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 0,
      },
    },
      React.createElement('span', { style: labelField }, rotulo),
      React.createElement('input', {
        type: 'text',
        value,
        placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
        style: { ...inputGray, color: value ? '#0d0d0d' : '#767676' },
      }));

  const fieldPlaces = (rotulo: string, value: string, onChange: (v: string) => void, onResolved: (p: PlaceResolved) => void, placeholder: string) =>
    React.createElement('div', {
      style: { flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 0 },
    },
      React.createElement('span', { style: labelField }, rotulo),
      React.createElement(PlacesAddressInput, {
        value,
        onChange,
        onPlaceResolved: onResolved,
        inputStyle: { ...inputGray, color: value ? '#0d0d0d' : '#767676' },
        placeholder,
      }));

  const fieldDateTime = (rotulo: string, value: string, onChange: (v: string) => void) =>
    React.createElement('div', { style: { flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 0 } },
      React.createElement('span', { style: labelField }, rotulo),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 44, borderRadius: 8, background: '#f1f1f1', paddingLeft: 16, gap: 8, boxSizing: 'border-box' as const } },
        calendarSvg,
        React.createElement('input', {
          type: 'datetime-local',
          value,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          style: {
            flex: 1,
            minWidth: 0,
            height: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 16,
            color: '#0d0d0d',
            ...font,
          },
        })));

  const salvarBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 44,
    padding: '0 24px',
    background: '#0d0d0d',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    ...font,
  };
  const salvarBtnStyleBusy: React.CSSProperties = saving ? { ...salvarBtnStyle, opacity: 0.65, cursor: 'not-allowed' } : salvarBtnStyle;
  const btnSalvarTop = React.createElement('button', {
    type: 'button',
    disabled: saving,
    onClick: () => { void salvar(); },
    style: salvarBtnStyleBusy,
  }, checkWhiteSvg, saving ? 'A guardar…' : 'Salvar trecho');
  const btnSalvarFooter = React.createElement('button', {
    type: 'button',
    disabled: saving,
    onClick: () => { void salvar(); },
    style: salvarBtnStyleBusy,
  }, checkWhiteSvg, saving ? 'A guardar…' : 'Salvar trecho');
  const saveErrEl = saveErr
    ? React.createElement('p', { style: { margin: 0, fontSize: 14, color: '#b53838', ...font } }, saveErr)
    : null;

  const radioValorEncRow = (
    tipo: 'por_km' | 'fixo',
    label: string,
    inputVal: string,
    setInput: (v: string) => void,
    placeholder: string,
  ) => {
    const selected = f.encTipoValor === tipo;
    return React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', width: '100%', gap: 8 },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => patch({ encTipoValor: tipo }),
        style: {
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          borderRadius: 6,
        },
      },
        React.createElement('span', {
          style: {
            width: 20,
            height: 20,
            margin: '0 10px 0 0',
            borderRadius: '50%',
            border: '2px solid #0d0d0d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxSizing: 'border-box' as const,
          },
        }, selected ? React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
        React.createElement('span', {
          style: {
            width: 125,
            fontSize: 14,
            fontWeight: 500,
            color: '#0d0d0d',
            textAlign: 'left' as const,
            ...font,
          },
        }, label)),
      React.createElement('input', {
        type: 'text',
        value: inputVal,
        placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value),
        style: {
          ...inputGray,
          flex: 1,
          minWidth: 0,
          color: inputVal ? '#0d0d0d' : '#767676',
        },
      }));
  };

  const phEnc = PLACEHOLDERS.prep_enc;

  const cardDadosStd = React.createElement('div', { style: card },
    React.createElement('h2', { style: tituloCard }, 'Dados do trecho'),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' } },
        fieldPlaces('Origem', f.origem, (v) => patch({ origem: v }), (p) => { patch({ origem: p.formattedAddress }); setOriginCoord({ lat: p.lat, lng: p.lng }); }, ph.origem),
        fieldPlaces('Destino', f.destino, (v) => patch({ destino: v }), (p) => { patch({ destino: p.formattedAddress }); setDestCoord({ lat: p.lat, lng: p.lng }); }, ph.destino)),
      fieldText('Valor da diária (R$)', f.diaria, (v) => patch({ diaria: v }), ph.diaria, true)));

  const cardDadosEnc = React.createElement('div', { style: card },
    React.createElement('h2', { style: tituloCard }, 'Dados do trecho'),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' } },
        fieldPlaces('Origem', f.origem, (v) => patch({ origem: v }), (p) => { patch({ origem: p.formattedAddress }); setOriginCoord({ lat: p.lat, lng: p.lng }); }, phEnc.origem),
        fieldPlaces('Destino', f.destino, (v) => patch({ destino: v }), (p) => { patch({ destino: p.formattedAddress }); setDestCoord({ lat: p.lat, lng: p.lng }); }, phEnc.destino)),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', lineHeight: 1.4, ...font } }, 'Tipo de valor'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%' } },
          radioValorEncRow('por_km', 'Valor por KM', f.encValorKm, (v) => patch({ encValorKm: v }), 'Ex: R$ 1,80'),
          radioValorEncRow('fixo', 'Valor fixo', f.encValorFixo, (v) => patch({ encValorFixo: v }), 'Ex: R$ 180,00')))));

  const cardDados = tab === 'prep_enc' ? cardDadosEnc : cardDadosStd;

  const cardHorarios = React.createElement('div', { style: card },
    React.createElement('h2', { style: tituloCard }, 'Horários'),
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' } },
      fieldDateTime('Data / hora de ida', f.ida, (v) => patch({ ida: v })),
      fieldDateTime('Data / hora de retorno', f.retorno, (v) => patch({ retorno: v }))));

  const cardPct = React.createElement('div', { style: card },
    React.createElement('h2', { style: tituloCard }, 'Percentuais de ganho'),
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' } },
      fieldText(pctWorkerLabel, f.pctWorker, (v) => patch({ pctWorker: v }), 'Ex: 15%'),
      fieldText('% ganho do admin', f.pctAdmin, (v) => patch({ pctAdmin: v }), 'Ex: 5%')));

  const bannerInfo = React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '12px 16px',
      background: '#fff8e6',
      border: '0.5px solid #cba04b',
      borderRadius: 8,
      boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.04)',
    },
  },
    infoSvg,
    React.createElement('p', {
      style: { margin: 0, fontSize: 14, fontWeight: 500, color: '#0d0d0d', lineHeight: 1.5, flex: 1, ...font },
    }, 'Inclusão de custo adicional automático? Esta configuração é feita na tela de Adicionais quando o tipo for automático.'));

  const custoRowLabelToggle = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 },
  },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Adicionar custo adicional manual?'),
    toggleSwitch(f.manualExtra, () => patch({ manualExtra: !f.manualExtra })));

  const custoManualSelect = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
    React.createElement('span', { style: labelField }, 'Selecione o adicional (manual)'),
    React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
      React.createElement('select', {
        value: f.adicionalId,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => patch({ adicionalId: e.target.value }),
        style: {
          ...inputGray,
          paddingRight: 44,
          appearance: 'none' as const,
          cursor: 'pointer',
          color: f.adicionalId ? '#0d0d0d' : '#767676',
        },
      },
        React.createElement('option', { value: '' }, 'Selecione adicional'),
        ...surcharges.filter((s) => s.is_active && s.surcharge_mode === 'manual').map((s) =>
          React.createElement('option', { key: s.id, value: s.id }, s.name))),
      React.createElement('div', { style: { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const } }, chevronDownSvg)));

  const custoManualBlock = React.createElement('div', {
    style: {
      border: '1px solid #e2e2e2',
      borderRadius: 12,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 16,
      width: '100%',
      boxSizing: 'border-box' as const,
    },
  },
    custoRowLabelToggle,
    f.manualExtra ? custoManualSelect : null);

  const cardCustos = React.createElement('div', { style: card },
    React.createElement('h2', { style: tituloCard }, 'Custos adicionais'),
    bannerInfo,
    custoManualBlock);

  const headerActions = React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' as const, gap: 12 } },
    React.createElement('button', {
      type: 'button',
      onClick: voltar,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 44,
        padding: '0 24px',
        background: 'none',
        border: 'none',
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 600,
        color: '#0d0d0d',
        cursor: 'pointer',
        ...font,
      },
    }, arrowLeftSvg, 'Voltar'),
    btnSalvarTop);

  const footerSalvar = React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginTop: 8 } }, btnSalvarFooter);

  const formStack = [
    cardDados,
    cardHorarios,
    ...(showPercentuais ? [cardPct] : []),
    cardCustos,
  ];

  const toastSalvoTrecho = toastSalvoOpen
    ? React.createElement('div', {
      role: 'status',
      'aria-live': 'polite',
      style: {
        position: 'fixed' as const,
        bottom: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#0d0d0d',
        borderRadius: 12,
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 10000,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box' as const,
      },
    },
      toastCheckCircleSvg,
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.5, ...font } }, 'Trecho salvo com sucesso.'))
    : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', {
      style: {
        width: '100%',
        maxWidth: 1044,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 32,
        paddingBottom: 64,
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } },
        breadcrumb,
        headerActions,
        saveErrEl),
      tabsRow,
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } }, ...formStack),
      footerSalvar),
    toastSalvoTrecho);
}
