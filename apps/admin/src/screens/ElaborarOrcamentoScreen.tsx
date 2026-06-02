/**
 * ElaborarOrcamentoScreen — Elaborar orçamento de excursão (dados reais).
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  submitExcursionBudget,
  fetchPreparadorEditDetail,
  fetchPreparadorCandidates,
  fetchApprovedDriversForEncomendaUI,
  formatCurrencyBRL,
} from '../data/queries';
import type { ApprovedDriverCandidate } from '../data/queries';
import type { PreparadorEditDetail, PreparadorCandidate } from '../data/types';
import { supabase } from '../lib/supabase';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const arrowLeftSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const checkSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const closeSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round' }));
const plusSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const trashSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const inputStyle: React.CSSProperties = {
  height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px',
  fontSize: 14, color: '#0d0d0d', background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box', ...font,
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#767676', marginBottom: 4, ...font };
const sectionCard: React.CSSProperties = {
  border: '1px solid #e2e2e2', borderRadius: 16, padding: 24,
  display: 'flex', flexDirection: 'column', gap: 16, width: '100%', boxSizing: 'border-box',
};
const addBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
  cursor: 'pointer', padding: 0, fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font,
};

type BudgetTeamLine = {
  worker_id?: string | null;
  name?: string;
  role: 'driver' | 'preparer';
  value_cents: number;
};

type BudgetItemLine = {
  label: string;
  qty: number;
  value_cents: number;
};

type BudgetPayloadLine = {
  kind: 'team' | 'basic' | 'additional' | 'recreation';
  label: string;
  qty: number;
  value_cents: number;
  amount_cents: number;
  worker_id?: string | null;
  role?: 'driver' | 'preparer';
};

function parseBRLInputToCents(text: string): number {
  const digits = text.replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10);
}

function formatCentsBRL(cents: number): string {
  return formatCurrencyBRL(cents);
}

function sanitizeBudgetRows(rows: BudgetItemLine[]): BudgetItemLine[] {
  return rows
    .map((row) => ({
      label: row.label.trim(),
      qty: Math.max(1, Math.floor(Number(row.qty) || 1)),
      value_cents: Math.max(0, Math.floor(Number(row.value_cents) || 0)),
    }))
    .filter((row) => row.label || row.value_cents > 0);
}

export default function ElaborarOrcamentoScreen() {
  const navigate = useNavigate();
  const { id: excursionId } = useParams<{ id: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PreparadorEditDetail | null>(null);
  const [preparerCandidates, setPreparerCandidates] = useState<PreparadorCandidate[]>([]);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form state
  const [driverName, setDriverName] = useState<string>('');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [approvedDrivers, setApprovedDrivers] = useState<ApprovedDriverCandidate[]>([]);
  const [selectedPreparerId, setSelectedPreparerId] = useState<string>('');
  const [driverValueCents, setDriverValueCents] = useState<number>(0);
  const [preparerValueCents, setPreparerValueCents] = useState<number>(0);
  const [preparerDailyRateCents, setPreparerDailyRateCents] = useState<number | null>(null);
  const [basicItems, setBasicItems] = useState<BudgetItemLine[]>([]);
  const [additionalServices, setAdditionalServices] = useState<BudgetItemLine[]>([]);
  const [recreationItems, setRecreationItems] = useState<BudgetItemLine[]>([]);
  const [packageCatalog, setPackageCatalog] = useState<Array<{ id: string; name: string; default_value_cents: number; description: string | null }>>([]);
  const [recreationCatalog, setRecreationCatalog] = useState<Array<{ id: string; name: string; default_value_cents: number; description: string | null }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!excursionId) { setLoading(false); return; }
      setLoading(true);
      const [d, preps, drivers] = await Promise.all([
        fetchPreparadorEditDetail(excursionId),
        fetchPreparadorCandidates(),
        fetchApprovedDriversForEncomendaUI(),
      ]);
      if (cancelled) return;
      setDetail(d);
      setPreparerCandidates(preps);
      setApprovedDrivers(drivers);

      void (async () => {
        const [{ data: pkgs }, { data: recs }] = await Promise.all([
          (supabase as any)
            .from('excursion_package_catalog')
            .select('id, name, default_value_cents, description')
            .eq('is_active', true)
            .order('name'),
          (supabase as any)
            .from('excursion_recreation_items')
            .select('id, name, default_value_cents, description')
            .eq('is_active', true)
            .order('name'),
        ]);
        if (cancelled) return;
        setPackageCatalog((pkgs as any[]) || []);
        setRecreationCatalog((recs as any[]) || []);
      })();
      if (cancelled) return;
      if (d) {
        const teamLines = Array.isArray(d.budgetLines) ? d.budgetLines : [];
        const driverLine = teamLines.find((raw) => {
          const l = raw as any;
          return l && String(l.kind ?? '') === 'team' && String(l.role ?? '').toLowerCase().includes('driver');
        }) as any;
        const driverLabel = driverLine ? String(driverLine.name ?? driverLine.label ?? '').trim() : '';
        setDriverName(driverLabel && driverLabel !== 'Motorista' ? driverLabel : '');
        const driverLineWorkerId = driverLine ? String(driverLine.worker_id ?? '').trim() : '';
        setSelectedDriverId(d.driverId ?? driverLineWorkerId ?? '');
        setSelectedPreparerId(d.preparerId ?? '');
        setDriverValueCents(d.driverPayoutCents ?? 0);
        setPreparerValueCents(d.preparerPayoutCents ?? 0);
        // hidratar budgetLines caso ja exista
        const lines = Array.isArray(d.budgetLines) ? d.budgetLines : [];
        const basic: BudgetItemLine[] = [];
        const additional: BudgetItemLine[] = [];
        const recreation: BudgetItemLine[] = [];
        for (const raw of lines) {
          const l = raw as any;
          if (!l) continue;
          const item: BudgetItemLine = {
            label: String(l.label ?? l.item ?? 'Item'),
            qty: Number(l.qty ?? l.quantity ?? 1) || 1,
            value_cents: Number(l.value_cents ?? l.amount_cents ?? 0) || 0,
          };
          const kind = String(l.kind ?? l.category ?? 'basic');
          if (kind === 'additional' || kind === 'additional_service') additional.push(item);
          else if (kind === 'recreation') recreation.push(item);
          else if (kind === 'team') {
            // Equipe é hidratada pelos campos de payout; evita duplicar como item básico.
          }
          else basic.push(item);
        }
        setBasicItems(basic);
        setAdditionalServices(additional);
        setRecreationItems(recreation);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [excursionId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedPreparerId) {
      setPreparerDailyRateCents(null);
      return;
    }
    (async () => {
      const { data } = await (supabase as any)
        .from('worker_profiles')
        .select('daily_rate_cents')
        .eq('id', selectedPreparerId)
        .maybeSingle();
      if (cancelled) return;
      const cents = typeof data?.daily_rate_cents === 'number' ? data.daily_rate_cents : null;
      setPreparerDailyRateCents(cents);
    })();
    return () => { cancelled = true; };
  }, [selectedPreparerId]);

  const excursionDaysCount = useMemo(() => {
    const start = detail?.scheduledDepartureAt || detail?.excursionDate || null;
    const end = detail?.scheduledReturnAt || null;
    if (!start) return null;
    try {
      const s = new Date(start);
      const e = end ? new Date(end) : s;
      const ms = e.getTime() - s.getTime();
      if (!Number.isFinite(ms)) return null;
      const days = Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)) || 1);
      return days;
    } catch {
      return null;
    }
  }, [detail?.scheduledDepartureAt, detail?.excursionDate, detail?.scheduledReturnAt]);

  const canAutoCalcPreparer = typeof preparerDailyRateCents === 'number' && preparerDailyRateCents > 0 && (excursionDaysCount ?? 0) > 0;

  const orcamentoEditavel = useMemo(() => {
    const status = detail?.statusRaw ?? '';
    return ['pending', 'contacted', 'quoted', 'in_analysis'].includes(status);
  }, [detail?.statusRaw]);

  const excursaoAprovada = useMemo(() => {
    const status = detail?.statusRaw ?? '';
    return ['approved', 'scheduled', 'in_progress', 'completed'].includes(status);
  }, [detail?.statusRaw]);

  const handleAutoCalcPreparer = useCallback(() => {
    if (!canAutoCalcPreparer || typeof preparerDailyRateCents !== 'number' || !excursionDaysCount) return;
    setPreparerValueCents(preparerDailyRateCents * excursionDaysCount);
  }, [canAutoCalcPreparer, preparerDailyRateCents, excursionDaysCount]);

  const itemsSum = (rows: BudgetItemLine[]) => rows.reduce((s, r) => s + (r.qty * r.value_cents), 0);

  const totalCents = useMemo(() => {
    return driverValueCents + preparerValueCents
      + itemsSum(basicItems) + itemsSum(additionalServices) + itemsSum(recreationItems);
  }, [driverValueCents, preparerValueCents, basicItems, additionalServices, recreationItems]);

  const handleFinalizar = useCallback(async (finalize: boolean) => {
    if (!excursionId || !orcamentoEditavel) return;
    setBanner(null);
    if (totalCents <= 0) {
      setBanner({ type: 'err', text: 'Total deve ser maior que zero.' });
      return;
    }
    const trimmedDriverName = driverName.trim();
    if (finalize && !trimmedDriverName && !selectedPreparerId) {
      setBanner({ type: 'err', text: 'Informe o motorista ou vincule um preparador.' });
      return;
    }
    const team: BudgetTeamLine[] = [];
    if (trimmedDriverName || driverValueCents > 0 || selectedDriverId) {
      team.push({ worker_id: selectedDriverId || null, name: trimmedDriverName, role: 'driver', value_cents: driverValueCents });
    }
    if (selectedPreparerId) team.push({ worker_id: selectedPreparerId, role: 'preparer', value_cents: preparerValueCents });
    const cleanBasicItems = sanitizeBudgetRows(basicItems);
    const cleanAdditionalServices = sanitizeBudgetRows(additionalServices);
    const cleanRecreationItems = sanitizeBudgetRows(recreationItems);
    const displayLines: BudgetPayloadLine[] = [
      ...team.map((row) => ({
        kind: 'team' as const,
        label: row.role === 'driver'
          ? (row.name?.trim() || 'Motorista')
          : 'Preparador de excursões',
        qty: 1,
        value_cents: Math.max(0, row.value_cents),
        amount_cents: Math.max(0, row.value_cents),
        worker_id: row.worker_id ?? null,
        role: row.role,
      })),
      ...cleanBasicItems.map((row) => ({
        kind: 'basic' as const,
        label: row.label,
        qty: row.qty,
        value_cents: row.value_cents,
        amount_cents: row.qty * row.value_cents,
      })),
      ...cleanAdditionalServices.map((row) => ({
        kind: 'additional' as const,
        label: row.label,
        qty: row.qty,
        value_cents: row.value_cents,
        amount_cents: row.qty * row.value_cents,
      })),
      ...cleanRecreationItems.map((row) => ({
        kind: 'recreation' as const,
        label: row.label,
        qty: row.qty,
        value_cents: row.value_cents,
        amount_cents: row.qty * row.value_cents,
      })),
    ];
    setSubmitting(true);
    try {
      const res = await submitExcursionBudget(excursionId, {
        team,
        basic_items: cleanBasicItems,
        additional_services: cleanAdditionalServices,
        recreation_items: cleanRecreationItems,
        display_lines: displayLines,
        total_cents: totalCents,
      }, finalize, {
        driver_id: selectedDriverId || null,
        preparer_id: selectedPreparerId || null,
        preparer_payout_cents: preparerValueCents,
      });
      if (res.error || (res.data && (res.data as any).error)) {
        setBanner({ type: 'err', text: res.error || (res.data as any)?.error || 'Falha ao salvar orcamento' });
        return;
      }
      setBanner({ type: 'ok', text: finalize ? 'Orcamento finalizado e enviado ao cliente.' : 'Rascunho salvo.' });
      if (finalize) navigate(-1);
    } finally {
      setSubmitting(false);
    }
  }, [excursionId, orcamentoEditavel, totalCents, driverName, selectedDriverId, selectedPreparerId, driverValueCents, preparerValueCents, basicItems, additionalServices, recreationItems, navigate]);

  const handleSelectDriver = useCallback((driverId: string) => {
    setSelectedDriverId(driverId);
    if (driverId) {
      const drv = approvedDrivers.find((d) => d.id === driverId);
      if (drv?.nome) setDriverName(drv.nome);
    }
  }, [approvedDrivers]);

  // ── UI blocks ─────────────────────────────────────────────────────────
  const breadcrumb = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#767676', ...font } },
    React.createElement('span', null, 'Atendimentos'),
    React.createElement('span', null, '›'),
    React.createElement('span', null, 'Detalhes do atendimento'),
    React.createElement('span', null, '›'),
    React.createElement('span', { style: { color: '#0d0d0d', fontWeight: 500 } }, 'Elaborar orçamento'));

  const header = React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 } },
    React.createElement('button', {
      type: 'button', onClick: () => navigate(-1),
      style: { display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font },
    }, arrowLeftSvg, 'Voltar'),
    React.createElement('div', { style: { display: 'flex', gap: 8 } },
      React.createElement('button', {
        type: 'button', onClick: () => navigate(-1),
        style: { display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px', borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', fontSize: 14, fontWeight: 600, color: '#b53838', cursor: 'pointer', ...font },
      }, closeSvg, 'Cancelar'),
      orcamentoEditavel
        ? React.createElement(React.Fragment, null,
            React.createElement('button', {
              type: 'button', onClick: () => handleFinalizar(false), disabled: submitting,
              style: { display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px', borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', fontSize: 14, fontWeight: 600, color: '#0d0d0d', cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.6 : 1, ...font },
            }, 'Salvar rascunho'),
            React.createElement('button', {
              type: 'button', onClick: () => handleFinalizar(true), disabled: submitting,
              style: { display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px', borderRadius: 999, border: 'none', background: '#0d0d0d', fontSize: 14, fontWeight: 600, color: '#fff', cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.6 : 1, ...font },
            }, checkSvg, submitting ? 'Finalizando...' : 'Finalizar orçamento'))
        : null));

  const title = React.createElement('h1', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Orçamento de Excursão');

  const bannerEl = banner
    ? React.createElement('div', {
        style: {
          padding: '10px 14px', borderRadius: 8,
          background: banner.type === 'err' ? '#fee2e2' : '#dcfce7',
          color: banner.type === 'err' ? '#991b1b' : '#166534',
          fontSize: 13, fontWeight: 600, ...font,
        },
      }, banner.text)
    : excursaoAprovada
      ? React.createElement('div', {
          style: {
            padding: '10px 14px', borderRadius: 8,
            background: '#dcfce7', color: '#166534',
            fontSize: 13, fontWeight: 600, ...font,
          },
        }, 'Orçamento aprovado pelo cliente — somente leitura.')
      : null;

  const fmtLocalDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; }
  };

  const detalhesSection = React.createElement('div', { style: sectionCard },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#767676', ...font } }, 'Detalhes da excursão'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Destino'),
        React.createElement('input', { type: 'text', readOnly: true, value: detail?.destination ?? '', style: inputStyle })),
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Data'),
        React.createElement('input', { type: 'text', readOnly: true, value: fmtLocalDate(detail?.scheduledDepartureAt || detail?.excursionDate), style: inputStyle }))),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Quantidade de pessoas'),
        React.createElement('input', { type: 'text', readOnly: true, value: String(detail?.peopleCount ?? 0), style: inputStyle })),
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Tipo de frota'),
        React.createElement('input', { type: 'text', readOnly: true, value: detail?.fleetType ?? '', style: inputStyle }))));

  const equipeSection = React.createElement('div', { style: sectionCard },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#767676', ...font } }, 'Equipe vinculada'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: '2 1 0', minWidth: 160, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Motorista cadastrado (opcional)'),
        React.createElement('select', {
          value: selectedDriverId,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleSelectDriver(e.target.value),
          disabled: !orcamentoEditavel,
          style: { ...inputStyle, ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
        },
          React.createElement('option', { value: '' }, '— Externo / não cadastrado —'),
          ...approvedDrivers.map((d) => React.createElement('option', { key: d.id, value: d.id }, d.isPartner ? `${d.nome} (parceiro)` : d.nome))),
        React.createElement('span', { style: { marginTop: 4, fontSize: 11, color: '#767676', ...font } },
          selectedDriverId ? 'Repasse via Stripe Connect será gerado para este motorista.' : 'Sem motorista cadastrado: pagamento resolvido fora da plataforma.')),
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Valor motorista'),
        React.createElement('input', {
          type: 'text', value: formatCentsBRL(driverValueCents),
          readOnly: !orcamentoEditavel,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDriverValueCents(parseBRLInputToCents(e.target.value)),
          style: { ...inputStyle, ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
        }))),
    !selectedDriverId
      ? React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          React.createElement('div', { style: { flex: '1 1 0', minWidth: 160, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
            React.createElement('span', { style: labelStyle }, 'Nome do motorista (exibição)'),
            React.createElement('input', {
              type: 'text',
              value: driverName,
              placeholder: 'Nome do motorista (van/ônibus)',
              readOnly: !orcamentoEditavel,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDriverName(e.target.value),
              style: { ...inputStyle, ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
            })))
      : null,
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: '2 1 0', minWidth: 160, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Preparador de excursões'),
        React.createElement('select', {
          value: selectedPreparerId,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedPreparerId(e.target.value),
          disabled: !orcamentoEditavel,
          style: { ...inputStyle, ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
        },
          React.createElement('option', { value: '' }, '— Selecione —'),
          ...preparerCandidates.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.nome)))),
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 140, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: labelStyle }, 'Valor preparador'),
        React.createElement('input', {
          type: 'text', value: formatCentsBRL(preparerValueCents),
          readOnly: !orcamentoEditavel,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPreparerValueCents(parseBRLInputToCents(e.target.value)),
          style: { ...inputStyle, ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
        }),
        orcamentoEditavel && canAutoCalcPreparer
          ? React.createElement('button', {
              type: 'button',
              onClick: handleAutoCalcPreparer,
              style: {
                marginTop: 4, alignSelf: 'flex-start', background: 'none', border: 'none',
                padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 500, color: '#0d0d0d',
                textDecoration: 'underline', ...font,
              },
              title: `Diária ${formatCentsBRL(preparerDailyRateCents ?? 0)} × ${excursionDaysCount ?? 0} dia(s)`,
            }, `Calcular diária × ${excursionDaysCount ?? 0} dia(s)`)
          : typeof preparerDailyRateCents === 'number' && preparerDailyRateCents > 0 && !excursionDaysCount
            ? React.createElement('span', {
                style: { marginTop: 4, fontSize: 11, color: '#767676', ...font },
              }, 'Cadastre a data de retorno para calcular a diária.')
            : null)));

  const catalogPicker = (
    catalog: Array<{ id: string; name: string; default_value_cents: number; description: string | null }>,
    setRows: React.Dispatch<React.SetStateAction<BudgetItemLine[]>>,
  ) => {
    if (catalog.length === 0 || !orcamentoEditavel) return null;
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Importar do catálogo:'),
      React.createElement('select', {
        value: '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          const id = e.target.value;
          if (!id) return;
          const item = catalog.find((c) => c.id === id);
          if (!item) return;
          setRows((prev) => [...prev, { label: item.name, qty: 1, value_cents: item.default_value_cents }]);
          e.target.value = '';
        },
        style: { ...inputStyle, height: 36, padding: '0 12px', fontSize: 13, width: 'auto', flex: '0 0 auto' },
      },
        React.createElement('option', { value: '' }, '— selecione —'),
        ...catalog.map((c) => React.createElement('option', { key: c.id, value: c.id }, `${c.name} · ${formatCentsBRL(c.default_value_cents)}`))));
  };

  const renderItemsBlock = (
    blockLabel: string,
    rows: BudgetItemLine[],
    setRows: React.Dispatch<React.SetStateAction<BudgetItemLine[]>>,
    ctaLabel: string,
    catalog: Array<{ id: string; name: string; default_value_cents: number; description: string | null }> | null = null,
  ) =>
    React.createElement('div', { style: sectionCard },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#767676', ...font } }, blockLabel),
        catalog ? catalogPicker(catalog, setRows) : null),
      React.createElement('div', { style: { display: 'flex', gap: 16 } },
        React.createElement('span', { style: { flex: '2 1 0', ...labelStyle } }, 'Item'),
        React.createElement('span', { style: { flex: '0 0 80px', ...labelStyle } }, 'Qtd.'),
        React.createElement('span', { style: { flex: '1 1 0', ...labelStyle } }, 'Valor unitário'),
        React.createElement('span', { style: { flex: '0 0 40px' } })),
      ...rows.map((row, idx) =>
        React.createElement('div', { key: idx, style: { display: 'flex', gap: 16, alignItems: 'center' } },
          React.createElement('input', {
            type: 'text', value: row.label, placeholder: 'Descrição',
            readOnly: !orcamentoEditavel,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              setRows((prev) => prev.map((r, i) => i === idx ? { ...r, label: e.target.value } : r)),
            style: { ...inputStyle, flex: '2 1 0', ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
          }),
          React.createElement('input', {
            type: 'number', value: row.qty, min: 0,
            readOnly: !orcamentoEditavel,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              setRows((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.max(0, parseInt(e.target.value || '0', 10) || 0) } : r)),
            style: { ...inputStyle, flex: '0 0 80px', ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
          }),
          React.createElement('input', {
            type: 'text', value: formatCentsBRL(row.value_cents),
            readOnly: !orcamentoEditavel,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              setRows((prev) => prev.map((r, i) => i === idx ? { ...r, value_cents: parseBRLInputToCents(e.target.value) } : r)),
            style: { ...inputStyle, flex: '1 1 0', ...(orcamentoEditavel ? {} : { background: '#f6f6f6', color: '#767676' }) },
          }),
          orcamentoEditavel
            ? React.createElement('button', {
                type: 'button',
                onClick: () => setRows((prev) => prev.filter((_, i) => i !== idx)),
                style: { flex: '0 0 40px', height: 40, borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
                'aria-label': 'Remover item',
              }, trashSvg)
            : React.createElement('span', { style: { flex: '0 0 40px' } }))),
      orcamentoEditavel
        ? React.createElement('button', {
            type: 'button', style: addBtn,
            onClick: () => setRows((prev) => [...prev, { label: '', qty: 1, value_cents: 0 }]),
          }, plusSvg, ctaLabel)
        : null);

  const itensSection = renderItemsBlock('Itens básicos', basicItems, setBasicItems, 'Adicionar novo item', packageCatalog);
  const servicosSection = renderItemsBlock('Serviços adicionais', additionalServices, setAdditionalServices, 'Adicionar novo serviço', packageCatalog);
  const recreacaoSection = renderItemsBlock('Adicionais de recreação', recreationItems, setRecreationItems, 'Adicionar novo item', recreationCatalog);

  const totalRow = React.createElement('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderTop: '1px solid #e2e2e2' },
  },
    React.createElement('span', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', ...font } }, 'Total'),
    React.createElement('span', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', ...font } }, formatCentsBRL(totalCents)));

  if (loading) {
    return React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', ...font } }, 'Carregando orçamento...');
  }

  if (!excursionId || !detail) {
    return React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#b53838', ...font } }, 'Excursão não encontrada.');
  }

  return React.createElement(React.Fragment, null,
    breadcrumb, header, title, bannerEl,
    detalhesSection, equipeSection, itensSection, servicosSection, recreacaoSection,
    totalRow);
}
