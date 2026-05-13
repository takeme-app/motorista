/**
 * PromocaoCreateScreen — Criar promoção conforme Figma 891-43439.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPromotion, invokeEdgeFunction } from '../data/queries';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

type RouteOption = {
  id: string;
  kind: 'worker_route' | 'pricing_route';
  label: string;
  origin: string | null;
  destination: string;
};

function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(15, 30, 0, 0);
  return toDatetimeLocalValue(d);
}

function defaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  d.setHours(23, 59, 0, 0);
  return toDatetimeLocalValue(d);
}

function buildTargetAudiences(a: {
  motoristas: boolean;
  preparadores: boolean;
  passageiros: boolean;
  encomendas: boolean;
}): string[] {
  const set = new Set<string>();
  if (a.motoristas) set.add('drivers');
  if (a.preparadores) {
    set.add('preparers_shipments');
    set.add('preparers_excursions');
  }
  if (a.passageiros) set.add('passengers');
  if (a.encomendas) set.add('preparers_shipments');
  return [...set];
}

function buildAppliesTo(a: {
  motoristas: boolean;
  preparadores: boolean;
  passageiros: boolean;
  encomendas: boolean;
}): string[] {
  const set = new Set<string>();
  if (a.motoristas || a.passageiros) set.add('bookings');
  if (a.preparadores || a.encomendas) {
    set.add('shipments');
    set.add('dependent_shipments');
  }
  if (a.preparadores) set.add('excursions');
  return [...set];
}

const arrowLeftSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const checkSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const closeSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round' }));
const calendarSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const searchSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('circle', { cx: 11, cy: 11, r: 7, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M20 20l-4-4', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const chevronDownSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const labelMd: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font };
const labelSmMuted: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#767676', ...font };
const inputGray: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 8, border: 'none', outline: 'none',
  background: '#f1f1f1', fontSize: 16, color: '#0d0d0d', padding: '0 16px', boxSizing: 'border-box', ...font,
};
const textAreaGray: React.CSSProperties = {
  width: '100%', minHeight: 140, borderRadius: 8, border: 'none', outline: 'none',
  background: '#f1f1f1', fontSize: 16, color: '#0d0d0d', padding: 16, resize: 'vertical' as const, boxSizing: 'border-box', ...font,
};

type AccKey = 'motoristas' | 'preparadores' | 'passageiros' | 'encomendas';

export default function PromocaoCreateScreen() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id?: string }>();
  const isEditMode = Boolean(editId);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startLocal, setStartLocal] = useState(defaultStartDate);
  const [endLocal, setEndLocal] = useState(defaultEndDate);
  const [motoristas, setMotoristas] = useState(true);
  const [preparadores, setPreparadores] = useState(false);
  const [passageiros, setPassageiros] = useState(false);
  const [encomendas, setEncomendas] = useState(false);
  const [promoActive, setPromoActive] = useState(true);
  const [discountPctToPassenger, setDiscountPctToPassenger] = useState(15);
  const [gainPctWorker, setGainPctWorker] = useState(0);
  const [routeSearch, setRouteSearch] = useState('');
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [obsMotoristas, setObsMotoristas] = useState('');
  const [expanded, setExpanded] = useState<Record<AccKey, boolean>>({
    motoristas: true,
    preparadores: false,
    passageiros: false,
    encomendas: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditMode || !editId || !isSupabaseConfigured) { setLoadingEdit(false); return; }
    void (async () => {
      const { data } = await (supabase as any).from('promotions').select('*').eq('id', editId).maybeSingle();
      if (data) {
        setTitle(data.title || '');
        setDescription(data.description || '');
        if (data.start_at) setStartLocal(toDatetimeLocalValue(new Date(data.start_at)));
        if (data.end_at) setEndLocal(toDatetimeLocalValue(new Date(data.end_at)));
        const ta = data.target_audiences || [];
        setMotoristas(ta.includes('drivers'));
        setPreparadores(ta.includes('preparers_shipments') || ta.includes('preparers_excursions'));
        setPassageiros(ta.includes('passengers'));
        setEncomendas(ta.includes('preparers_shipments'));
        setPromoActive(data.is_active !== false);
        const fallbackDiscount = data.discount_type === 'percentage' ? Number(data.discount_value) || 0 : 0;
        setDiscountPctToPassenger(Number(data.discount_pct_to_passenger ?? fallbackDiscount) || 0);
        setGainPctWorker(Number(data.gain_pct_to_worker) || 0);
        if (data.worker_route_id) setSelectedRouteId(`wr:${data.worker_route_id}`);
        else if (data.pricing_route_id) setSelectedRouteId(`pr:${data.pricing_route_id}`);
      }
      setLoadingEdit(false);
    })();
  }, [editId, isEditMode]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    setLoadingRoutes(true);
    void (async () => {
      const opts: RouteOption[] = [];
      const [{ data: pr }, { data: wr }] = await Promise.all([
        (supabase as any)
          .from('pricing_routes')
          .select('id, title, origin_address, destination_address, role_type')
          .eq('is_active', true)
          .order('destination_address'),
        (supabase as any)
          .from('worker_routes')
          .select('id, origin_address, destination_address, worker_id')
          .eq('is_active', true)
          .order('destination_address'),
      ]);
      for (const r of pr ?? []) {
        const origin = (r.origin_address as string | null) || null;
        const label = `${r.title || r.role_type || 'Rota'} · ${origin ? origin + ' → ' : ''}${r.destination_address}`;
        opts.push({ id: `pr:${r.id}`, kind: 'pricing_route', label, origin, destination: r.destination_address });
      }
      for (const r of wr ?? []) {
        const origin = (r.origin_address as string | null) || null;
        const label = `Motorista · ${origin ? origin + ' → ' : ''}${r.destination_address}`;
        opts.push({ id: `wr:${r.id}`, kind: 'worker_route', label, origin, destination: r.destination_address });
      }
      if (!cancelled) {
        setRouteOptions(opts);
        setLoadingRoutes(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const audiences = useMemo(() => ({ motoristas, preparadores, passageiros, encomendas }), [motoristas, preparadores, passageiros, encomendas]);

  const toggleAcc = useCallback((key: AccKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setAudience = useCallback((key: 'motoristas' | 'preparadores' | 'passageiros' | 'encomendas', v: boolean) => {
    if (key === 'motoristas') setMotoristas(v);
    if (key === 'preparadores') setPreparadores(v);
    if (key === 'passageiros') setPassageiros(v);
    if (key === 'encomendas') setEncomendas(v);
    if (v) setExpanded((e) => ({ ...e, [key]: true }));
  }, []);

  const filteredRoutes = useMemo(() => {
    const q = routeSearch.trim().toLowerCase();
    if (!q) return routeOptions;
    return routeOptions.filter((r) => r.label.toLowerCase().includes(q));
  }, [routeSearch, routeOptions]);

  const clearRoute = useCallback(() => {
    setSelectedRouteId(null);
  }, []);

  const cancel = useCallback(() => navigate('/promocoes'), [navigate]);

  const salvar = useCallback(async () => {
    setError(null);
    const ta = buildTargetAudiences(audiences);
    const ap = buildAppliesTo(audiences);
    if (!title.trim()) {
      setError('Informe o título da promoção.');
      return;
    }
    if (ta.length === 0) {
      setError('Selecione ao menos um tipo de público-alvo.');
      return;
    }
    if (ap.length === 0) {
      setError('Combinação de público inválida para aplicar a promoção.');
      return;
    }
    const dv = Math.max(0, Math.min(100, Number(discountPctToPassenger) || 0));
    const gv = Math.max(0, Math.min(100, Number(gainPctWorker) || 0));
    if (dv <= 0 && gv <= 0) {
      setError('Informe desconto ao passageiro ou ganho ao motorista/preparador (% > 0).');
      return;
    }
    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError('Datas inválidas.');
      return;
    }
    if (end <= start) {
      setError('A data de término deve ser posterior à de início.');
      return;
    }

    setSaving(true);
    const descParts = [description.trim()];
    if (obsMotoristas.trim()) descParts.push(`[Motoristas] ${obsMotoristas.trim()}`);
    const fullDesc = descParts.filter(Boolean).join('\n\n') || undefined;

    const selected = selectedRouteId ? routeOptions.find((r) => r.id === selectedRouteId) : null;
    const worker_route_id = selected?.kind === 'worker_route' ? selected.id.slice(3) : null;
    const pricing_route_id = selected?.kind === 'pricing_route' ? selected.id.slice(3) : null;

    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: fullDesc,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      target_audiences: ta,
      discount_type: 'percentage',
      discount_value: dv,
      discount_pct_to_passenger: dv,
      gain_pct_to_worker: gv,
      applies_to: ap,
      is_active: promoActive,
      worker_route_id,
      pricing_route_id,
      origin_city: selected?.origin ?? null,
    };
    let err: string | null = null;
    if (isEditMode && editId) {
      const res = await invokeEdgeFunction('manage-promotions', 'PUT', { id: editId }, payload);
      err = res.error;
    } else {
      const res = await createPromotion(payload as Parameters<typeof createPromotion>[0]);
      err = res.error;
    }
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    navigate('/promocoes');
  }, [title, description, startLocal, endLocal, audiences, discountPctToPassenger, gainPctWorker, promoActive, obsMotoristas, navigate, isEditMode, editId, selectedRouteId, routeOptions]);

  const audienceCheckbox = (
    key: 'motoristas' | 'preparadores' | 'passageiros' | 'encomendas',
    label: string,
    checked: boolean,
  ) =>
    React.createElement('label', {
      key,
      style: { display: 'flex', alignItems: 'center', cursor: 'pointer', paddingRight: 12, flex: '0 0 auto' },
    },
      React.createElement('input', {
        type: 'checkbox',
        checked,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAudience(key, e.target.checked),
        style: { width: 20, height: 20, margin: '10px 8px 10px 0', accentColor: '#0d0d0d', cursor: 'pointer', flexShrink: 0 },
      }),
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label));

  const toggleSwitch = () =>
    React.createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': promoActive,
      onClick: () => setPromoActive(!promoActive),
      style: {
        width: 48, height: 28, borderRadius: 100, border: 'none', padding: 0, cursor: 'pointer',
        background: promoActive ? '#0d0d0d' : '#c4c4c4', position: 'relative', flexShrink: 0,
      },
    },
      React.createElement('span', {
        style: {
          position: 'absolute', top: -4, width: 36, height: 36, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          left: promoActive ? 15 : 2, transition: 'left 0.15s ease',
        },
      }));

  const actionButtons = (compact: boolean) =>
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: compact ? 'wrap' as const : 'nowrap', alignItems: 'center' } },
      React.createElement('button', {
        type: 'button', onClick: cancel, disabled: saving,
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px',
          borderRadius: 999, border: 'none', background: '#f1f1f1', cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 14, fontWeight: 600, color: '#b53838', ...font,
        },
      }, closeSvg, 'Cancelar promoção'),
      React.createElement('button', {
        type: 'button', onClick: salvar, disabled: saving,
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px',
          borderRadius: 999, border: 'none', background: '#0d0d0d', cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 14, fontWeight: 600, color: '#fff', ...font, opacity: saving ? 0.7 : 1,
        },
      }, checkSvg, saving ? 'Salvando…' : isEditMode ? 'Salvar alteração' : 'Salvar promoção'));

  const dateRow = (label: string, value: string, onChange: (v: string) => void) =>
    React.createElement('div', { style: { flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { ...labelMd, minHeight: 40, display: 'flex', alignItems: 'center' } }, label),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, background: '#f1f1f1', borderRadius: 8, paddingLeft: 16, height: 44, boxSizing: 'border-box' } },
        calendarSvg,
        React.createElement('input', {
          type: 'datetime-local',
          value,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          style: { flex: 1, minWidth: 0, height: 44, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, color: '#0d0d0d', ...font },
        })));

  const accordionShell = (
    key: AccKey,
    titleText: string,
    activeBorder: boolean,
    inner: React.ReactNode | null,
  ) => {
    const isOpen = expanded[key];
    return React.createElement('div', {
      key,
      style: {
        width: '100%', border: `${activeBorder ? 1.5 : 1}px solid ${activeBorder ? '#0d0d0d' : '#e2e2e2'}`,
        borderRadius: 12, padding: 24, boxSizing: 'border-box' as const,
      },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => toggleAcc(key),
        style: {
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' as const,
        },
      },
        React.createElement('span', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', ...font } }, titleText),
        React.createElement('span', { style: { transform: isOpen ? 'none' : 'rotate(180deg)', display: 'flex', transition: 'transform 0.15s ease' } }, chevronDownSvg)),
      isOpen && inner ? React.createElement('div', { style: { marginTop: 16 } }, inner) : null);
  };

  const selectedRoute = selectedRouteId ? routeOptions.find((r) => r.id === selectedRouteId) ?? null : null;

  const motoristasInner = motoristas
    ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' } },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: labelMd }, 'Desconto para o passageiro (%)'),
        React.createElement('input', {
          type: 'number',
          min: 0,
          max: 100,
          step: 0.5,
          value: discountPctToPassenger,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDiscountPctToPassenger(Math.max(0, Math.min(100, Number(e.target.value)))),
          style: inputGray,
        })),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: labelMd }, 'Rota alvo da promoção'),
        React.createElement('span', { style: labelSmMuted }, 'A promoção aplica-se exclusivamente a esta rota (origem + destino). Deixe em branco para todas as rotas.'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, background: '#f1f1f1', borderRadius: 8, paddingLeft: 16, height: 44 } },
          searchSvg,
          React.createElement('input', {
            type: 'text',
            value: routeSearch,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRouteSearch(e.target.value),
            placeholder: loadingRoutes ? 'Carregando rotas…' : 'Busque por origem, destino ou título',
            style: { flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, color: routeSearch ? '#0d0d0d' : '#767676', ...font },
          }))),
      React.createElement('div', {
        style: {
          maxHeight: 260, overflowY: 'auto' as const, borderRadius: 8,
          border: '1px solid #e2e2e2', padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 4,
        },
      },
        filteredRoutes.length === 0
          ? React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font, padding: 8 } }, loadingRoutes ? 'Carregando…' : 'Nenhuma rota encontrada.')
          : filteredRoutes.map((r) =>
            React.createElement('label', {
              key: r.id,
              style: { display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: selectedRouteId === r.id ? '#f1f1f1' : 'transparent' },
            },
              React.createElement('input', {
                type: 'radio',
                name: 'promotion-route',
                checked: selectedRouteId === r.id,
                onChange: () => setSelectedRouteId(r.id),
                style: { width: 18, height: 18, margin: '0 8px 0 0', accentColor: '#0d0d0d' },
              }),
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, r.label)))),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, maxWidth: 510 } },
        React.createElement('button', {
          type: 'button',
          onClick: clearRoute,
          style: {
            flex: '1 1 160px', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1',
            fontSize: 14, fontWeight: 600, color: '#b53838', cursor: 'pointer', ...font,
          },
        }, 'Limpar rota (aplicar a todas)')),
      selectedRoute
        ? React.createElement('div', {
          style: { padding: 12, borderRadius: 8, background: '#f6f6f6', display: 'flex', flexDirection: 'column' as const, gap: 4 },
        },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#767676', ...font } }, selectedRoute.kind === 'worker_route' ? 'Rota do motorista' : 'Rota catalogada'),
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, selectedRoute.label))
        : null,
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          React.createElement('span', { style: labelMd }, 'Observações'),
          React.createElement('span', { style: labelSmMuted }, 'Opcional')),
        React.createElement('textarea', {
          value: obsMotoristas,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setObsMotoristas(e.target.value),
          placeholder: 'Notas internas sobre esta promoção',
          style: textAreaGray,
        })))
    : React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Marque «Motoristas» em Tipo de público-alvo para configurar esta seção.');

  const simpleAccPlaceholder = (label: string) =>
    React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } },
      `Opções específicas para ${label} usam o mesmo percentual global acima. Ajuste o valor em «Porcentagem de ganho adicional» na secção Motoristas ou pelo controlo deslizante.`);

  const breadcrumb = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const } },
    React.createElement('button', {
      type: 'button',
      onClick: () => navigate('/promocoes'),
      style: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#767676', ...font },
    }, 'Promoções'),
    React.createElement('span', { style: { fontSize: 12, color: '#767676' } }, '›'),
    React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font } }, isEditMode ? 'Editar promoção' : 'Criar promoção'));

  const topRow = React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const, width: '100%' } },
    React.createElement('button', {
      type: 'button',
      onClick: cancel,
      style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font },
    }, arrowLeftSvg, 'Voltar'),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, actionButtons(true)));

  const mainCard = React.createElement('div', {
    style: {
      width: '100%', maxWidth: 1044, border: '1px solid #e2e2e2', borderRadius: 12, padding: 24,
      boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 16,
    },
  },
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('h1', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, isEditMode ? 'Editar promoção' : 'Criar nova promoção'),
      React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font } },
        'Preencha os dados da nova promoção. Após salvar, ela ficará disponível imediatamente se estiver marcada como ativa. ' +
        'Quando «Passageiros» ou «Motoristas» estiver marcado, o desconto incide sobre corridas (`bookings`): o app do passageiro passa a mostrar na lista o mesmo valor líquido cobrado no cartão (tarifa da rota menos o desconto, enquanto a promoção estiver vigente).')),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { ...labelMd, minHeight: 40, display: 'flex', alignItems: 'center' } }, 'Título da promoção'),
      React.createElement('input', {
        type: 'text',
        value: title,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value),
        placeholder: 'Digite o nome da promoção',
        style: inputGray,
      })),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
        React.createElement('span', { style: { ...labelMd, minHeight: 40, display: 'flex', alignItems: 'center' } }, 'Observações'),
        React.createElement('span', { style: labelSmMuted }, 'Opcional')),
      React.createElement('textarea', {
        value: description,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value),
        placeholder: 'Explique brevemente o objetivo desta promoção',
        style: textAreaGray,
      })),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const, width: '100%' } },
      dateRow('Data e hora de início', startLocal, setStartLocal),
      dateRow('Data e hora de término', endLocal, setEndLocal)),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { ...labelMd, minHeight: 32 } }, 'Tipo de público-alvo'),
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, alignItems: 'center' } },
        audienceCheckbox('motoristas', 'Motoristas', motoristas),
        audienceCheckbox('preparadores', 'Preparadores', preparadores),
        audienceCheckbox('passageiros', 'Passageiros', passageiros),
        audienceCheckbox('encomendas', 'Encomendas', encomendas))),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 8, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: '1 1 200px', minWidth: 0 } },
        React.createElement('div', { style: { ...labelMd, marginBottom: 4 } }, 'Status da promoção'),
        React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font } },
          'Ao ativar, a promoção ficará disponível imediatamente')),
      toggleSwitch()));

  const gainPctSection = React.createElement('div', {
    style: { width: '100%', maxWidth: 1044, background: '#fff', border: '1px solid #e2e2e2', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16, boxSizing: 'border-box' as const },
  },
    React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Ganhos e descontos'),
    React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font } },
      'Defina separadamente o ganho extra para o motorista/preparador e o desconto ao passageiro. Ambos são percentuais aplicados sobre o total final (fórmula gross-up).'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, flex: 1, minWidth: 200 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Ganho extra ao motorista/preparador (%)'),
        React.createElement('input', {
          type: 'number', min: 0, max: 50, step: 0.5, value: gainPctWorker,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setGainPctWorker(Math.min(50, Math.max(0, Number(e.target.value)))),
          style: { height: 44, borderRadius: 8, background: '#f1f1f1', border: 'none', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', width: '100%', boxSizing: 'border-box' as const, ...font },
        })),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, flex: 1, minWidth: 200 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Desconto ao passageiro (%)'),
        React.createElement('input', {
          type: 'number', min: 0, max: 100, step: 0.5, value: discountPctToPassenger,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDiscountPctToPassenger(Math.min(100, Math.max(0, Number(e.target.value)))),
          style: { height: 44, borderRadius: 8, background: '#f1f1f1', border: 'none', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', width: '100%', boxSizing: 'border-box' as const, ...font },
        }))),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, padding: 16, background: '#f6f6f6', borderRadius: 12 } },
      React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, `Motorista/Preparador recebe extra: +${gainPctWorker}%`),
      React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, `Passageiro paga menos: -${discountPctToPassenger}%`),
      React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'A plataforma absorve as duas partes no total gross-up.')));

  const accordions = React.createElement('div', { style: { width: '100%', maxWidth: 1044, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
    accordionShell('motoristas', 'Motoristas', expanded.motoristas, motoristasInner),
    accordionShell('preparadores', 'Preparadores', expanded.preparadores, preparadores ? simpleAccPlaceholder('preparadores') : React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Marque «Preparadores» para ver as opções.')),
    accordionShell('passageiros', 'Passageiros', expanded.passageiros, passageiros ? simpleAccPlaceholder('passageiros') : React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Marque «Passageiros» para ver as opções.')),
    accordionShell('encomendas', 'Encomendas', expanded.encomendas, encomendas ? simpleAccPlaceholder('encomendas') : React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Marque «Encomendas» para ver as opções.')));

  const errEl = error
    ? React.createElement('div', {
      role: 'alert',
      style: {
        width: '100%', maxWidth: 1044, padding: 12, borderRadius: 8, background: '#fde8e6',
        color: '#551611', fontSize: 14, ...font, boxSizing: 'border-box' as const,
      },
    }, error)
    : null;

  const footerActions = React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', maxWidth: 1044 } }, actionButtons(false));

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'stretch', gap: 24, width: '100%', paddingBottom: 64 } },
    breadcrumb,
    topRow,
    errEl,
    mainCard,
    gainPctSection,
    accordions,
    footerActions);
}
