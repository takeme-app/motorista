/**
 * Configurações > Perfil (Figma 1435-22732). Conteúdo abaixo do Layout; dados do usuário logado.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { webStyles } from '../styles/webStyles';
import { useAuth } from '../contexts/AuthContext';
import { fetchAdminUsers, createAdminUser, deleteAdminUser, invokeEdgeFunction } from '../data/queries';
import type { AdminUserListItem } from '../data/types';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  formatBRLCents,
  formatPercent,
  MAX_GLOBAL_PLATFORM_FEE_PCT,
  normalizeServiceFeeInputs,
  parsePercentInput,
  PLATFORM_FEE_SERVICE_LABELS,
  PLATFORM_FEE_SIMULATION_BASE_CENTS,
  serviceFeeInputsToPayload,
  simulateGlobalPlatformFee,
  validateGlobalPlatformFeePct,
} from '../utils/platformFeeSimulation';
import type { PlatformFeeServiceType } from '@take-me/shared';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const defaultServiceFeeInputs: Record<PlatformFeeServiceType, string> = {
  booking: '15',
  dependent_shipment: '15',
  shipment_driver: '15',
  shipment_preparer: '15',
  excursion: '15',
};

const editPencilWhiteSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

function mapNivelAcesso(role: string | undefined): string {
  if (role === 'admin') return 'Administrador';
  if (role === 'suporte') return 'Suporte';
  if (role === 'financeiro') return 'Financeiro';
  if (!role) return '—';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function requiredRow(label: string) {
  return React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, width: '100%' },
  },
    React.createElement('span', { style: { color: '#cba04b', fontSize: 10, lineHeight: 1, width: 10, textAlign: 'center' as const } }, '*'),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label));
}

function readOnlyField(label: string, value: string) {
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'stretch', width: '100%' } },
    requiredRow(label),
    React.createElement('div', {
      style: {
        background: '#f1f1f1', borderRadius: 8, height: 44, display: 'flex', alignItems: 'center',
        paddingLeft: 16, paddingRight: 4, boxSizing: 'border-box' as const, width: '100%',
      },
    },
      React.createElement('span', {
        style: {
          fontSize: 16, fontWeight: 400, color: '#3a3a3a', ...font,
          overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, lineHeight: 1.5,
        },
      }, value)));
}

export default function ConfiguracoesScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [aba, setAba] = useState<'perfil' | 'usuarios' | 'plataforma' | 'pagamentos'>('perfil');
  const [novoUsuarioOpen, setNovoUsuarioOpen] = useState(false);
  const [nuNome, setNuNome] = useState('');
  const [nuEmail, setNuEmail] = useState('');
  const [nuBackofficeTipo, setNuBackofficeTipo] = useState<'admin' | 'suporte' | 'financeiro'>('admin');
  const [nuPermissoes, setNuPermissoes] = useState<Record<string, boolean>>({ 'Início': true, 'Viagens': true });
  const [adminUsers, setAdminUsers] = useState<AdminUserListItem[]>([]);
  const [adminLoading, setAdminLoading] = useState(true);
  const [meuSubtype, setMeuSubtype] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminUsers().then((items) => { if (!cancelled) { setAdminUsers(items); setAdminLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user?.id) return;
    let cancelled = false;
    (supabase as any).from('worker_profiles').select('subtype').eq('id', session.user.id).maybeSingle()
      .then(({ data }: { data: { subtype?: string } | null }) => {
        if (!cancelled) setMeuSubtype(data?.subtype ?? null);
      });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const nome = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || '—';
  const email = session?.user?.email || '—';
  const avatarLetter = (nome === '—' ? '?' : nome).charAt(0).toUpperCase();
  const nivel = mapNivelAcesso((meuSubtype || session?.user?.app_metadata?.role) as string | undefined);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: '1 1 0',
    minWidth: 0,
    height: 48,
    padding: '14px 16px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    position: 'relative' as const,
    fontSize: 16,
    lineHeight: 1.5,
    ...font,
    fontWeight: active ? 600 : 400,
    color: active ? '#0d0d0d' : '#767676',
  });

  const tabsRow = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'stretch', width: '100%' } },
      React.createElement('button', {
        type: 'button',
        style: tabStyle(aba === 'perfil'),
        onClick: () => setAba('perfil'),
      },
        'Perfil',
        aba === 'perfil' ? React.createElement('span', {
          style: {
            position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: 2,
            background: '#0d0d0d', borderRadius: 100,
          },
        }) : null),
      React.createElement('button', {
        type: 'button',
        style: tabStyle(aba === 'usuarios'),
        onClick: () => setAba('usuarios'),
      }, 'Usuários e Permissões',
        aba === 'usuarios' ? React.createElement('span', {
          style: {
            position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: 2,
            background: '#0d0d0d', borderRadius: 100,
          },
        }) : null),
      React.createElement('button', {
        type: 'button',
        style: tabStyle(aba === 'plataforma'),
        onClick: () => setAba('plataforma'),
      }, 'Plataforma',
        aba === 'plataforma' ? React.createElement('span', {
          style: {
            position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: 2,
            background: '#0d0d0d', borderRadius: 100,
          },
        }) : null),
      React.createElement('button', {
        type: 'button',
        style: tabStyle(aba === 'pagamentos'),
        onClick: () => setAba('pagamentos'),
      }, 'Pagamentos',
        aba === 'pagamentos' ? React.createElement('span', {
          style: {
            position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: 2,
            background: '#0d0d0d', borderRadius: 100,
          },
        }) : null)),
    React.createElement('div', { style: { height: 1, width: '100%', background: '#e2e2e2', marginTop: 0 } }));

  const alterarSenhaBtn = React.createElement('button', {
    type: 'button',
    onClick: () => navigate('/forgot-password'),
    style: {
      height: 44, minWidth: 104, width: 180, padding: '8px 24px', borderRadius: 999,
      border: 'none', cursor: 'pointer', background: '#f1f1f1', ...font,
      fontSize: 14, fontWeight: 500, color: '#0d0d0d', flexShrink: 0,
    },
  }, 'Alterar senha');

  const avatarBlock = React.createElement('div', {
    style: { position: 'relative' as const, width: 120, height: 120, flexShrink: 0 },
  },
    React.createElement('div', {
      style: {
        width: 120, height: 120, borderRadius: '50%', backgroundColor: '#e2e2e2',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' as const,
      },
    },
      React.createElement('span', { style: { fontSize: 48, fontWeight: 600, color: '#0d0d0d', ...font } }, avatarLetter)),
    React.createElement('button', {
      type: 'button',
      'aria-label': 'Editar foto de perfil',
      onClick: () => {},
      style: {
        position: 'absolute' as const, right: 0, bottom: 0, width: 40, height: 40, borderRadius: '50%',
        background: '#050505', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12, boxSizing: 'border-box' as const,
      },
    }, editPencilWhiteSvg));

  const perfilContent = React.createElement('div', {
    style: { display: 'flex', gap: 24, alignItems: 'flex-start', width: '100%', flexWrap: 'wrap' as const },
  },
    avatarBlock,
    React.createElement('div', {
      style: {
        flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 16, alignItems: 'stretch',
      },
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%', flexWrap: 'wrap' as const },
      },
        React.createElement('h2', {
          style: {
            margin: 0, fontSize: 24, fontWeight: 600, color: '#0d0d0d', ...font, lineHeight: 'normal' as const, whiteSpace: 'nowrap' as const,
          },
        }, nome),
        alterarSenhaBtn),
      readOnlyField('E-mail', email),
      readOnlyField('Senha', '*********'),
      readOnlyField('Nível de acesso', nivel)));

  // ── Usuários e Permissões ───────────────────────────────────────────────
  const userRows = adminUsers.map((u) => ({
    nome: u.nome,
    email: u.email || '—',
    permissao: u.nivel,
    data: u.dataCriacao,
    status: u.status,
  }));
  const userCols = [
    { label: 'Usuário', flex: '1 1 20%', minWidth: 160 },
    { label: 'E-mail', flex: '1 1 22%', minWidth: 180 },
    { label: 'Permissão', flex: '0 0 130px', minWidth: 130 },
    { label: 'Data de criação', flex: '0 0 120px', minWidth: 120 },
    { label: 'Status', flex: '0 0 90px', minWidth: 90 },
    { label: 'Visualizar/Editar', flex: '0 0 110px', minWidth: 110 },
  ];
  const avatarColors: Record<string, string> = { C: '#4A90D9', J: '#7B61FF', D: '#9B59B6' };
  const eyeSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const pencilSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font, padding: '0 6px' };

  const userToolbar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, padding: '16px 28px', background: '#f6f6f6', borderRadius: '16px 16px 0 0' },
  },
    React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Lista de administradores'),
    React.createElement('button', {
      type: 'button',
      onClick: () => { setNuBackofficeTipo('admin'); setNovoUsuarioOpen(true); },
      style: {
        display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px',
        background: '#0d0d0d', color: '#fff', border: 'none', borderRadius: 999,
        fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
      },
    },
      React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
        React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      'Novo usuário'));

  const userHeader = React.createElement('div', {
    style: { display: 'flex', height: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', alignItems: 'center' },
  }, ...userCols.map((c) => React.createElement('div', {
    key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 400, color: '#0d0d0d', ...font, padding: '0 6px', display: 'flex', alignItems: 'center', height: '100%' },
  }, c.label)));

  const userRowEls = userRows.map((row, idx) => {
    const initial = row.nome.charAt(0);
    const bg = avatarColors[initial] || '#999';
    const stBg = row.status === 'Ativo' ? '#b0e8d1' : '#eeafaa';
    const stColor = row.status === 'Ativo' ? '#174f38' : '#551611';
    return React.createElement('div', {
      key: idx, style: { display: 'flex', minHeight: 64, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6' },
    },
      React.createElement('div', { style: { ...cellBase, flex: userCols[0].flex, minWidth: userCols[0].minWidth, gap: 10 } },
        React.createElement('div', { style: { width: 36, height: 36, borderRadius: '50%', background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          React.createElement('span', { style: { color: '#fff', fontSize: 14, fontWeight: 600, ...font } }, initial)),
        React.createElement('span', { style: { fontWeight: 500 } }, row.nome)),
      React.createElement('div', { style: { ...cellBase, flex: userCols[1].flex, minWidth: userCols[1].minWidth } }, row.email),
      React.createElement('div', { style: { ...cellBase, flex: userCols[2].flex, minWidth: userCols[2].minWidth } }, row.permissao),
      React.createElement('div', { style: { ...cellBase, flex: userCols[3].flex, minWidth: userCols[3].minWidth } }, row.data),
      React.createElement('div', { style: { ...cellBase, flex: userCols[4].flex, minWidth: userCols[4].minWidth } },
        React.createElement('span', { style: { display: 'inline-block', padding: '4px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: stBg, color: stColor, ...font } }, row.status)),
      React.createElement('div', { style: { flex: userCols[5].flex, minWidth: userCols[5].minWidth, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 } },
        React.createElement('button', { type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Visualizar' }, eyeSvg),
        React.createElement('button', { type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Editar' }, pencilSvg),
        React.createElement('button', {
          type: 'button', style: webStyles.viagensActionBtn, 'aria-label': 'Remover',
          onClick: async () => {
            const u = adminUsers[idx];
            if (u && confirm(`Remover admin ${u.nome}?`)) {
              await deleteAdminUser(u.id);
              const items = await fetchAdminUsers();
              setAdminUsers(items);
            }
          },
        }, React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))));
  });

  const usuariosContent = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 0, width: '100%' },
  }, React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%' } },
    userToolbar,
    React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, userHeader, ...userRowEls)));

  // ── Novo Usuário Modal ──────────────────────────────────────────────────
  // ── Plataforma (Platform Settings) ──────────────────────────────────
  const { settings: platSettings, updateSetting, loading: platLoading } = usePlatformSettings();
  const [gasPrice, setGasPrice] = useState('');
  const [kmPrice, setKmPrice] = useState('');
  // Valor fixo por tamanho do pacote (somado à base por km nas encomendas).
  const [sizePequeno, setSizePequeno] = useState('');
  const [sizeMedio, setSizeMedio] = useState('');
  const [sizeGrande, setSizeGrande] = useState('');
  const [globalAdminPct, setGlobalAdminPct] = useState('');
  const [globalAdminPctError, setGlobalAdminPctError] = useState<string | null>(null);
  const [serviceFeeInputs, setServiceFeeInputs] = useState<Record<PlatformFeeServiceType, string>>(defaultServiceFeeInputs);
  const [serviceFeeError, setServiceFeeError] = useState<string | null>(null);
  const [cancelFreeWindowHours, setCancelFreeWindowHours] = useState('');
  const [driverPenaltyPct, setDriverPenaltyPct] = useState('');
  const [driverPenaltyEnabled, setDriverPenaltyEnabled] = useState(true);
  const [platSaved, setPlatSaved] = useState(false);

  useEffect(() => {
    if (!platLoading) {
      setGasPrice(String((platSettings.gas_price_cents ?? 599) / 100));
      setKmPrice(String((platSettings.km_price_cents ?? 150) / 100));
      const sizePrices = (platSettings.shipment_package_size_prices_cents ?? {}) as Record<string, number>;
      setSizePequeno(String((Number(sizePrices.pequeno) || 0) / 100));
      setSizeMedio(String((Number(sizePrices.medio) || 0) / 100));
      setSizeGrande(String((Number(sizePrices.grande) || 0) / 100));
      setGlobalAdminPct(String(platSettings.default_admin_pct ?? 15));
      setGlobalAdminPctError(null);
      setServiceFeeInputs(
        normalizeServiceFeeInputs(
          platSettings.platform_fee_pct_by_service,
          Number(platSettings.default_admin_pct ?? 15),
        ),
      );
      setServiceFeeError(null);
      setCancelFreeWindowHours(
        String(platSettings.booking_cancellation_free_window_hours ?? 2),
      );
      setDriverPenaltyPct(String(platSettings.driver_cancellation_penalty_pct ?? 10));
      setDriverPenaltyEnabled(
        platSettings.driver_cancellation_penalty_enabled !== false,
      );
    }
  }, [platLoading, platSettings]);

  const savePlatformSettings = useCallback(async () => {
    const gasCents = Math.round(parseFloat(gasPrice || '0') * 100);
    const kmCents = Math.round(parseFloat(kmPrice || '0') * 100);
    const sizePricesCents = {
      pequeno: Math.max(0, Math.round(parseFloat(sizePequeno || '0') * 100)),
      medio: Math.max(0, Math.round(parseFloat(sizeMedio || '0') * 100)),
      grande: Math.max(0, Math.round(parseFloat(sizeGrande || '0') * 100)),
    };
    const parsedAdminPct = parsePercentInput(globalAdminPct);
    const adminPctValidation = validateGlobalPlatformFeePct(parsedAdminPct);
    if (adminPctValidation) {
      setGlobalAdminPctError(adminPctValidation);
      return;
    }
    const servicePayload = serviceFeeInputsToPayload(serviceFeeInputs);
    if (servicePayload.error || !servicePayload.value) {
      setServiceFeeError(servicePayload.error ?? 'Revise as taxas por serviço.');
      return;
    }
    const normalizedAdminPct = Math.round((parsedAdminPct ?? 0) * 100) / 100;
    const currentAdminPct = Number(platSettings.default_admin_pct ?? 15);
    const currentServicePayload = serviceFeeInputsToPayload(
      normalizeServiceFeeInputs(platSettings.platform_fee_pct_by_service, currentAdminPct),
    );
    const hasServicePctChange =
      currentServicePayload.value != null &&
      JSON.stringify(servicePayload.value) !== JSON.stringify(currentServicePayload.value);
    if (
      Number.isFinite(currentAdminPct) &&
      (normalizedAdminPct !== currentAdminPct || hasServicePctChange) &&
      !window.confirm(
        `Salvar taxas da plataforma?\n\nGlobal: ${formatPercent(currentAdminPct)} -> ${formatPercent(normalizedAdminPct)}.\n` +
          'A mudança vale somente para novos pedidos/cotações. Pedidos já criados continuam com o snapshot financeiro original.',
      )
    ) {
      return;
    }
    const cancelHours = Math.max(0, parseFloat(cancelFreeWindowHours || '0'));
    const penaltyPct = Math.max(0, parseFloat(driverPenaltyPct || '0'));
    await Promise.all([
      updateSetting('default_admin_pct', normalizedAdminPct),
      updateSetting('platform_fee_pct_by_service', servicePayload.value),
      updateSetting('gas_price_cents', gasCents),
      updateSetting('km_price_cents', kmCents),
      updateSetting('shipment_package_size_prices_cents', sizePricesCents),
      updateSetting('booking_cancellation_free_window_hours', cancelHours),
      updateSetting('driver_cancellation_penalty_pct', penaltyPct),
      updateSetting('driver_cancellation_penalty_enabled', driverPenaltyEnabled),
    ]);
    setServiceFeeError(null);
    setPlatSaved(true);
    setTimeout(() => setPlatSaved(false), 2000);
  }, [
    gasPrice,
    kmPrice,
    sizePequeno,
    sizeMedio,
    sizeGrande,
    globalAdminPct,
    serviceFeeInputs,
    cancelFreeWindowHours,
    driverPenaltyPct,
    driverPenaltyEnabled,
    platSettings.default_admin_pct,
    platSettings.platform_fee_pct_by_service,
    updateSetting,
  ]);

  const platInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    helperText?: string,
  ) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, flex: '1 1 200px' } },
      React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'R$'),
        React.createElement('input', {
          type: 'number', step: '0.01', min: '0', value, placeholder,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', ...font, flex: 1 },
        })),
      helperText
        ? React.createElement(
            'span',
            { style: { fontSize: 12, color: '#767676', lineHeight: '16px', ...font } },
            helperText,
          )
        : null,
    );

  const plainInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    suffix?: string,
    helperText?: string,
  ) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, flex: '1 1 200px' } },
      React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        React.createElement('input', {
          type: 'number', step: '0.1', min: '0', value, placeholder,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', ...font, flex: 1 },
        }),
        suffix ? React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, suffix) : null),
      helperText
        ? React.createElement(
            'span',
            { style: { fontSize: 12, color: '#767676', lineHeight: '16px', ...font } },
            helperText,
          )
        : null,
    );

  const toggleRow = (
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    helperText?: string,
  ) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, flex: '1 1 200px' } },
      React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
      React.createElement('button', {
        type: 'button',
        onClick: () => onChange(!value),
        style: {
          width: 52, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: value ? '#22c55e' : '#d9d9d9', position: 'relative' as const,
          transition: 'background 0.2s',
        },
      },
        React.createElement('span', {
          style: {
            width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block',
            position: 'absolute' as const, top: 3, left: value ? 27 : 3, transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          },
        })),
      helperText
        ? React.createElement('span', { style: { fontSize: 12, color: '#767676', lineHeight: '16px', ...font } }, helperText)
        : null,
    );

  const parsedGlobalAdminPct = parsePercentInput(globalAdminPct);
  const globalAdminPctValidation = validateGlobalPlatformFeePct(parsedGlobalAdminPct);
  const globalAdminSimulation =
    globalAdminPctValidation == null && parsedGlobalAdminPct != null
      ? simulateGlobalPlatformFee(parsedGlobalAdminPct)
      : null;
  const simulationResult = globalAdminSimulation?.ok ? globalAdminSimulation.result : null;
  const simulationError = globalAdminSimulation && !globalAdminSimulation.ok ? globalAdminSimulation.error : null;
  const feeInfoLine = (label: string, value: string, helper?: string) =>
    React.createElement('div', {
      style: {
        flex: '1 1 160px',
        minWidth: 150,
        background: '#fff',
        border: '1px solid #e2e2e2',
        borderRadius: 12,
        padding: '12px 14px',
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#767676', ...font } }, label),
      React.createElement('p', { style: { margin: '4px 0 0', fontSize: 18, fontWeight: 700, color: '#0d0d0d', ...font } }, value),
      helper ? React.createElement('p', { style: { margin: '4px 0 0', fontSize: 11, color: '#767676', lineHeight: 1.4, ...font } }, helper) : null);

  const serviceFeeRows = PLATFORM_FEE_SERVICE_LABELS.map((service) => {
    const inputValue = serviceFeeInputs[service.type] ?? '';
    const parsed = parsePercentInput(inputValue);
    const validation = validateGlobalPlatformFeePct(parsed);
    const simulation =
      validation == null && parsed != null
        ? simulateGlobalPlatformFee(parsed)
        : null;
    const result = simulation?.ok ? simulation.result : null;
    const error = simulation && !simulation.ok ? simulation.error : validation;
    return React.createElement('div', {
      key: service.type,
      style: {
        background: '#fff',
        border: '1px solid #e2e2e2',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 10,
        flex: '1 1 240px',
        minWidth: 220,
      },
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 3, flex: 1 } },
          React.createElement('p', { style: { margin: 0, fontSize: 14, fontWeight: 700, color: '#0d0d0d', ...font } }, service.label),
          React.createElement('p', { style: { margin: 0, fontSize: 11, color: '#767676', lineHeight: 1.4, ...font } }, service.description)),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
          React.createElement('input', {
            type: 'number',
            step: '0.1',
            min: '0',
            max: String(MAX_GLOBAL_PLATFORM_FEE_PCT),
            value: inputValue,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              setServiceFeeInputs((prev) => ({ ...prev, [service.type]: e.target.value }));
              setServiceFeeError(null);
            },
            style: {
              height: 38,
              width: 84,
              borderRadius: 8,
              border: `1px solid ${error ? '#b53838' : '#d9d9d9'}`,
              padding: '0 10px',
              fontSize: 14,
              color: '#0d0d0d',
              outline: 'none',
              background: '#fff',
              ...font,
            },
          }),
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, '%'))),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
        feeInfoLine('Cliente paga', result ? formatBRLCents(result.totalCents) : '—'),
        feeInfoLine('Plataforma', result ? formatBRLCents(result.adminEarningCents) : '—')),
      error ? React.createElement('p', { style: { margin: 0, color: '#b53838', fontSize: 11, ...font } }, error) : null);
  });

  const globalPlatformFeeCard = React.createElement('div', {
    style: {
      background: '#f6f6f6',
      border: '1px solid #e2e2e2',
      borderRadius: 16,
      padding: 20,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 16,
      width: '100%',
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: '1 1 280px' } },
        React.createElement('h3', { style: { fontSize: 16, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Taxas da plataforma'),
        React.createElement('p', { style: { fontSize: 13, color: '#555', lineHeight: 1.5, margin: 0, ...font } },
          'Configure a taxa global de fallback e percentuais específicos por serviço. Não altera pedidos já criados.')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 150 } },
        React.createElement('input', {
          type: 'number',
          step: '0.1',
          min: '0',
          max: String(MAX_GLOBAL_PLATFORM_FEE_PCT),
          value: globalAdminPct,
          placeholder: '15',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setGlobalAdminPct(e.target.value);
            setGlobalAdminPctError(null);
          },
          style: {
            height: 44,
            width: 110,
            borderRadius: 8,
            border: `1px solid ${globalAdminPctError || globalAdminPctValidation ? '#b53838' : '#d9d9d9'}`,
            padding: '0 14px',
            fontSize: 16,
            color: '#0d0d0d',
            outline: 'none',
            background: '#fff',
            ...font,
          },
        }),
        React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, '%'))),
    globalAdminPctError || globalAdminPctValidation
      ? React.createElement('p', { style: { margin: 0, color: '#b53838', fontSize: 12, ...font } }, globalAdminPctError ?? globalAdminPctValidation)
      : React.createElement('p', { style: { margin: 0, color: '#767676', fontSize: 12, ...font } },
          `Limite operacional nesta tela: 0% a ${MAX_GLOBAL_PLATFORM_FEE_PCT}%.`),
    React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' as const } },
      feeInfoLine('Base simulada', formatBRLCents(PLATFORM_FEE_SIMULATION_BASE_CENTS)),
      feeInfoLine(
        'Cliente paga',
        simulationResult ? formatBRLCents(simulationResult.totalCents) : '—',
        'Valor total do PaymentIntent.',
      ),
      feeInfoLine(
        'Worker recebe',
        simulationResult ? formatBRLCents(simulationResult.workerEarningCents) : '—',
        'Motorista/preparador conforme snapshot.',
      ),
      feeInfoLine(
        'Plataforma retém',
        simulationResult ? formatBRLCents(simulationResult.adminEarningCents) : '—',
        'application_fee_amount quando houver Connect.',
      )),
    simulationError
      ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#b53838', ...font } }, simulationError)
      : null,
    React.createElement('div', { style: { height: 1, width: '100%', background: '#e2e2e2' } }),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('h4', { style: { margin: 0, fontSize: 14, fontWeight: 700, color: '#0d0d0d', ...font } }, 'Taxas por serviço'),
      React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#555', lineHeight: 1.5, ...font } },
        'Cada percentual usa a mesma fórmula de gross-up. Se uma chave faltar ou vier inválida, os checkouts usam a taxa global como fallback.')),
    serviceFeeError
      ? React.createElement('p', { style: { margin: 0, color: '#b53838', fontSize: 12, ...font } }, serviceFeeError)
      : null,
    React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' as const } }, ...serviceFeeRows),
    React.createElement('div', {
      style: {
        background: '#fff8e6',
        border: '1px solid #cba04b',
        borderRadius: 8,
        padding: '10px 12px',
      },
    },
      React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#5f4510', lineHeight: 1.5, ...font } },
        'Mudanças de taxa passam a valer apenas para novos pedidos e cotações. Snapshots financeiros e payouts existentes permanecem como estão.')));

  const plataformaContent = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%', maxWidth: 600 },
  },
    React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Configurações da Plataforma'),
    globalPlatformFeeCard,
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      platInput('Preço da gasolina (litro)', gasPrice, setGasPrice, '5.99'),
      platInput(
        'Preço do KM rodado',
        kmPrice,
        setKmPrice,
        '1.50',
        'Usado como padrão em encomendas. Preparadores podem sobrescrever no próprio cadastro.',
      )),
    React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0 0', ...font } }, 'Valor fixo por tamanho do pacote'),
    React.createElement('p', { style: { fontSize: 12, color: '#767676', margin: 0, ...font } },
      'Valor somado ao preço por km da encomenda, conforme o tamanho do pacote escolhido pelo cliente.'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      platInput('Pacote pequeno (R$)', sizePequeno, setSizePequeno, '0,00'),
      platInput('Pacote médio (R$)', sizeMedio, setSizeMedio, '5,00'),
      platInput('Pacote grande (R$)', sizeGrande, setSizeGrande, '10,00')),
    React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0 0', ...font } }, 'Política de cancelamento'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      plainInput(
        'Janela de reembolso integral',
        cancelFreeWindowHours,
        setCancelFreeWindowHours,
        '2',
        'horas antes da partida',
        'Dentro dessa janela, o cancelamento do passageiro dispara reembolso 100% no cartão. Fora dela, cancela sem estorno.',
      ),
      plainInput(
        'Multa ao motorista que cancela',
        driverPenaltyPct,
        setDriverPenaltyPct,
        '10',
        '% sobre total',
        'Percentual aplicado sobre o total de cada reserva paga, somado à taxa da plataforma, descontado do próximo payout.',
      ),
      toggleRow(
        'Cobrar multa automaticamente',
        driverPenaltyEnabled,
        setDriverPenaltyEnabled,
        'Quando desligado, o motorista é cancelado sem multa mesmo com passageiros pagos.',
      )),
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      React.createElement('button', {
        type: 'button',
        onClick: () => navigate('/pagamentos/multas'),
        style: {
          height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid #0d0d0d',
          background: '#fff', color: '#0d0d0d', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font,
        },
      }, 'Gerenciar multas de motoristas')),
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      React.createElement('button', {
        type: 'button',
        onClick: savePlatformSettings,
        style: {
          height: 44, padding: '0 28px', borderRadius: 999, border: 'none',
          background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
        },
      }, 'Salvar'),
      platSaved ? React.createElement('span', { style: { color: '#22c55e', fontSize: 14, fontWeight: 500, ...font } }, 'Salvo com sucesso!') : null));

  // ── Pagamentos Automáticos ──────────────────────────────────────────────
  const [payAutoEnabled, setPayAutoEnabled] = useState(false);
  const [payScheduleType, setPayScheduleType] = useState<'monthly' | 'weekly'>('monthly');
  const [payScheduleDay, setPayScheduleDay] = useState('5');
  const [payMinThreshold, setPayMinThreshold] = useState('50');
  const [paySaved, setPaySaved] = useState(false);

  useEffect(() => {
    if (!platLoading) {
      setPayAutoEnabled(platSettings.payout_auto_enabled === true);
      setPayScheduleType(platSettings.payout_schedule_type || 'monthly');
      setPayScheduleDay(String(platSettings.payout_schedule_day ?? 5));
      setPayMinThreshold(String((platSettings.payout_min_threshold_cents ?? 5000) / 100));
    }
  }, [platLoading, platSettings]);

  const savePayoutSettings = useCallback(async () => {
    const threshCents = Math.round(parseFloat(payMinThreshold || '0') * 100);
    await Promise.all([
      updateSetting('payout_auto_enabled', payAutoEnabled),
      updateSetting('payout_schedule_type', payScheduleType),
      updateSetting('payout_schedule_day', parseInt(payScheduleDay, 10) || 5),
      updateSetting('payout_min_threshold_cents', threshCents),
    ]);
    setPaySaved(true);
    setTimeout(() => setPaySaved(false), 2500);
  }, [payAutoEnabled, payScheduleType, payScheduleDay, payMinThreshold, updateSetting]);

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    width: 52, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
    background: active ? '#22c55e' : '#d9d9d9', position: 'relative' as const,
    transition: 'background 0.2s',
  });
  const toggleKnob = (active: boolean): React.CSSProperties => ({
    width: 22, height: 22, borderRadius: '50%', background: '#fff',
    position: 'absolute' as const, top: 3,
    left: active ? 27 : 3, transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  });

  const chipStyle = (active: boolean): React.CSSProperties => ({
    height: 36, padding: '0 16px', borderRadius: 999, border: active ? '2px solid #0d0d0d' : '1px solid #d9d9d9',
    background: active ? '#0d0d0d' : '#fff', color: active ? '#fff' : '#3a3a3a',
    fontSize: 13, fontWeight: 500, cursor: 'pointer', ...font,
  });

  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const pagamentosContent = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 28, width: '100%', maxWidth: 600 },
  },
    // Título
    React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Pagamento Automático'),

    // Toggle ON/OFF
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
      React.createElement('button', {
        type: 'button',
        style: toggleStyle(payAutoEnabled),
        onClick: () => setPayAutoEnabled((v) => !v),
      },
        React.createElement('span', { style: toggleKnob(payAutoEnabled) })),
      React.createElement('span', { style: { fontSize: 15, fontWeight: 500, color: '#0d0d0d', ...font } },
        payAutoEnabled ? 'Habilitado' : 'Desabilitado')),

    // Tipo de agendamento
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Frequência'),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { type: 'button', style: chipStyle(payScheduleType === 'monthly'), onClick: () => setPayScheduleType('monthly') }, 'Mensal'),
        React.createElement('button', { type: 'button', style: chipStyle(payScheduleType === 'weekly'), onClick: () => setPayScheduleType('weekly') }, 'Semanal'))),

    // Dia
    payScheduleType === 'monthly'
      ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
          React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Dia do mês'),
          React.createElement('input', {
            type: 'number', min: '1', max: '28', value: payScheduleDay,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPayScheduleDay(e.target.value),
            style: { width: 80, height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', ...font },
          }))
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
          React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Dia da semana'),
          React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' as const } },
            ...weekDays.map((d, i) =>
              React.createElement('button', {
                key: d, type: 'button',
                style: chipStyle(String(i) === payScheduleDay),
                onClick: () => setPayScheduleDay(String(i)),
              }, d)))),

    // Valor mínimo
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, maxWidth: 260 } },
      React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Valor mínimo para liberar'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'R$'),
        React.createElement('input', {
          type: 'number', step: '0.01', min: '0', value: payMinThreshold, placeholder: '50,00',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPayMinThreshold(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', flex: 1, ...font },
        }))),

    // Nota informativa
    React.createElement('div', {
      style: {
        background: '#f8f9fa', borderRadius: 8, padding: '12px 16px', borderLeft: '3px solid #6366f1',
      },
    },
      React.createElement('p', { style: { fontSize: 13, color: '#555', margin: 0, lineHeight: 1.5, ...font } },
        'Para motoristas/preparadores com Stripe Connect, os valores já são transferidos automaticamente no momento da cobrança ao cliente. ',
        'Esta configuração controla quando os registros são marcados como pagos e quando o relatório de pagamento manual é gerado para profissionais sem Stripe Connect.')),

    // Botão Salvar
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      React.createElement('button', {
        type: 'button',
        onClick: savePayoutSettings,
        style: {
          height: 44, padding: '0 28px', borderRadius: 999, border: 'none',
          background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
        },
      }, 'Salvar'),
      paySaved ? React.createElement('span', { style: { color: '#22c55e', fontSize: 14, fontWeight: 500, ...font } }, 'Salvo com sucesso!') : null));

  // ── Novo Usuário Modal ──────────────────────────────────────────────────
  const permModulos = ['Início', 'Viagens', 'Passageiros', 'Motoristas', 'Destinos', 'Encomendas', 'Preparadores', 'Promoções', 'Pagamentos', 'Atendimento'];
  const togglePerm = (mod: string) => setNuPermissoes((prev) => ({ ...prev, [mod]: !prev[mod] }));

  const checkboxSvg = (checked: boolean) => React.createElement('div', {
    style: {
      width: 22, height: 22, borderRadius: 4, border: checked ? 'none' : '2px solid #d9d9d9',
      background: checked ? '#0d0d0d' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, boxSizing: 'border-box' as const,
    },
  }, checked ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
    React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' })) : null);

  const novoUsuarioModal = novoUsuarioOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setNovoUsuarioOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 24, boxShadow: '0 20px 60px rgba(0,0,0,.15)',
        maxHeight: '90vh', overflowY: 'auto' as const,
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Novo usuário'),
        React.createElement('button', {
          type: 'button', onClick: () => setNovoUsuarioOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      // Separator
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Dados básicos
      React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#cba04b', margin: 0, ...font } }, 'Dados básicos'),
      // Nome
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
        React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Nome do usuário'),
        React.createElement('input', {
          type: 'text', value: nuNome, placeholder: 'Insira o nome do usuário',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNuNome(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', ...font },
        })),
      // Email
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
        React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'E-mail do usuário'),
        React.createElement('input', {
          type: 'email', value: nuEmail, placeholder: 'Insira o e-mail do usuário',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNuEmail(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none', ...font },
        })),
      React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Tipo de acesso'),
      React.createElement('p', { style: { fontSize: 12, color: '#767676', margin: 0, ...font } }, 'Suporte entra na fila automática de atendimentos; financeiro atua em reembolsos; administrador tem visão ampla.'),
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } },
        ...(['admin', 'suporte', 'financeiro'] as const).map((t) =>
          React.createElement('button', {
            key: t,
            type: 'button',
            onClick: () => setNuBackofficeTipo(t),
            style: {
              height: 40, padding: '0 18px', borderRadius: 999,
              border: nuBackofficeTipo === t ? 'none' : '1px solid #e2e2e2',
              background: nuBackofficeTipo === t ? '#0d0d0d' : '#fff',
              color: nuBackofficeTipo === t ? '#fff' : '#0d0d0d',
              fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
            },
          }, t === 'admin' ? 'Administrador' : t === 'suporte' ? 'Suporte' : 'Financeiro'))),
      // Permissões
      React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Permissões por módulo'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' } },
        ...permModulos.map((mod) =>
          React.createElement('button', {
            key: mod, type: 'button',
            onClick: () => togglePerm(mod),
            style: { display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
          },
            checkboxSvg(!!nuPermissoes[mod]),
            React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, mod)))),
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 16, marginTop: 8 } },
        React.createElement('button', {
          type: 'button', onClick: () => setNovoUsuarioOpen(false),
          style: { flex: 1, height: 48, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', fontSize: 16, fontWeight: 600, color: '#0d0d0d', cursor: 'pointer', ...font },
        }, 'Cancelar'),
        React.createElement('button', {
          type: 'button',
          onClick: async () => {
            if (!nuNome.trim() || !nuEmail.trim()) return;
            try {
              // Gerar senha aleatória
              const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
              const tempPassword = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('') + 'Aa1!';
              const { data, error } = await createAdminUser({
                full_name: nuNome.trim(),
                email: nuEmail.trim(),
                password: tempPassword,
                permissions: nuPermissoes,
                backoffice_subtype: nuBackofficeTipo,
              });
              if (error) {
                const detail = (data as any)?.details || '';
                alert(`Erro ao criar usuário: ${error}${detail ? '\n\nDetalhe: ' + detail : ''}`);
                return;
              }
              // Enviar credenciais por email
              try {
                await invokeEdgeFunction('send-admin-credentials', 'POST', undefined, {
                  email: nuEmail.trim(), name: nuNome.trim(), password: tempPassword,
                });
              } catch (e) { console.warn('Falha ao enviar email de credenciais:', e); }
              const items = await fetchAdminUsers();
              setAdminUsers(items);
              setNovoUsuarioOpen(false);
              setNuNome(''); setNuEmail('');
            } catch (e) {
              alert(`Erro: ${(e as any)?.message || 'Falha ao criar usuário'}`);
            }
          },
          style: { flex: 1, height: 48, borderRadius: 999, border: 'none', background: '#0d0d0d', fontSize: 16, fontWeight: 600, color: '#fff', cursor: 'pointer', ...font },
        }, 'Salvar')))) : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 40, width: '100%', maxWidth: 1044, alignSelf: 'stretch' } },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } },
        React.createElement('h1', { style: { ...webStyles.homeTitle, margin: 0, width: '100%' } }, 'Configurações'),
        tabsRow),
      aba === 'perfil' ? perfilContent : aba === 'usuarios' ? usuariosContent : aba === 'plataforma' ? plataformaContent : pagamentosContent),
    novoUsuarioModal);
}
