/**
 * PixConfigTab — conteúdo da 5ª aba (Pix) em Configurações.
 * 3 cards: provedor ativo, teste controlado (allowlist) e Pix paliativo,
 * + atalho para /pagamentos/pix.
 *
 * ⚠️ Escrita de pix_provider/pix_palliative é FLAT via pixQueries (nunca
 * usePlatformSettings.updateSetting, que embrulha em {value}).
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import FileUpload from './FileUpload';
import {
  fetchPixProviderSetting,
  updatePixProviderSetting,
  fetchPixPalliativeSetting,
  updatePixPalliativeSetting,
  findProfileByIdentifier,
  fetchProfileNames,
  fetchPixProviderHealth,
  DEFAULT_PIX_PROVIDER_SETTING,
  type PixProviderSetting,
  type PixProviderMode,
  type PixRealProvider,
  type PixProviderHealthResult,
} from '../data/pixQueries';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const MODE_LABELS: Record<PixProviderMode, string> = {
  palliative: 'Paliativo (QR estático, sem verificação)',
  asaas: 'Asaas',
  bradesco: 'Bradesco',
};

const cardStyle: React.CSSProperties = {
  background: '#f6f6f6',
  border: '1px solid #e2e2e2',
  borderRadius: 16,
  padding: 20,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 16,
  width: '100%',
  boxSizing: 'border-box' as const,
};

const cardTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font };
const cardSubStyle: React.CSSProperties = { fontSize: 13, color: '#555', lineHeight: 1.5, margin: 0, ...font };
const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font };
const helperStyle: React.CSSProperties = { fontSize: 12, color: '#767676', lineHeight: '16px', margin: 0, ...font };
const errorTextStyle: React.CSSProperties = { margin: 0, color: '#b53838', fontSize: 12, ...font };

const pillBtnStyle: React.CSSProperties = {
  height: 44, padding: '0 28px', borderRadius: 999, border: 'none',
  background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
};

const amberBoxStyle: React.CSSProperties = {
  background: '#fff8e6',
  border: '1px solid #cba04b',
  borderRadius: 8,
  padding: '10px 12px',
};
const amberTextStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: '#5f4510', lineHeight: 1.5, ...font };

const selectWrapStyle: React.CSSProperties = { position: 'relative' as const, width: '100%', maxWidth: 380 };
const selectStyle: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1',
  padding: '0 16px', fontSize: 16, color: '#0d0d0d', outline: 'none',
  boxSizing: 'border-box' as const, appearance: 'none' as const, WebkitAppearance: 'none' as const,
  cursor: 'pointer', ...font,
};
const selectChevron = React.createElement('svg', {
  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
  style: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' as const },
}, React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const textInputStyle: React.CSSProperties = {
  height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px',
  fontSize: 16, color: '#0d0d0d', outline: 'none', background: '#fff',
  boxSizing: 'border-box' as const, ...font,
};

function healthDot(color: string) {
  return React.createElement('span', {
    style: {
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: color, flexShrink: 0,
    },
  });
}

function formatDateTimeBR(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PixConfigTab() {
  const navigate = useNavigate();
  const { session } = useAuth();

  // ── Estado: provedor ────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [persisted, setPersisted] = useState<PixProviderSetting>({ ...DEFAULT_PIX_PROVIDER_SETTING });
  const [draftMode, setDraftMode] = useState<PixProviderMode>('palliative');
  const [draftTest, setDraftTest] = useState<PixRealProvider | ''>('');
  const [draftTtl, setDraftTtl] = useState('15');
  const [allowlistIds, setAllowlistIds] = useState<string[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [provSaving, setProvSaving] = useState(false);
  const [provSaved, setProvSaved] = useState(false);
  const [provError, setProvError] = useState<string | null>(null);

  // ── Estado: allowlist input ─────────────────────────────────────────
  const [allowInput, setAllowInput] = useState('');
  const [allowError, setAllowError] = useState<string | null>(null);
  const [allowSearching, setAllowSearching] = useState(false);

  // ── Estado: saúde ───────────────────────────────────────────────────
  const [health, setHealth] = useState<PixProviderHealthResult | null>(null);
  const [healthPinged, setHealthPinged] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);

  // ── Estado: paliativo ───────────────────────────────────────────────
  const [copiaECola, setCopiaECola] = useState('');
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [showQrUpload, setShowQrUpload] = useState(false);
  const [palSaving, setPalSaving] = useState(false);
  const [palSaved, setPalSaved] = useState(false);
  const [palError, setPalError] = useState<string | null>(null);

  const mergeNames = useCallback((extra: Record<string, string>) => {
    setProfileNames((prev) => ({ ...prev, ...extra }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [provider, palliative] = await Promise.all([
        fetchPixProviderSetting(),
        fetchPixPalliativeSetting(),
      ]);
      if (cancelled) return;
      setPersisted(provider);
      setDraftMode(provider.mode);
      setDraftTest(provider.test_provider ?? '');
      setDraftTtl(String(provider.charge_ttl_minutes));
      setAllowlistIds(provider.allowlist_user_ids);
      setCopiaECola(palliative.copia_e_cola);
      setQrImageUrl(palliative.qr_image_url);
      setLoading(false);
      const nameIds = [...provider.allowlist_user_ids];
      if (provider.updated_by) nameIds.push(provider.updated_by);
      if (nameIds.length > 0) {
        const names = await fetchProfileNames(nameIds);
        if (!cancelled) mergeNames(names);
      }
    })();
    // Saúde barata (presença de secrets) — a edge pode não existir ainda: degrada.
    void fetchPixProviderHealth().then((h) => { if (!cancelled) setHealth(h); });
    return () => { cancelled = true; };
  }, [mergeNames]);

  // ── Handlers ────────────────────────────────────────────────────────

  const saveProvider = useCallback(async () => {
    setProvError(null);
    if (draftMode !== persisted.mode) {
      const ok = window.confirm(
        `Trocar o provedor Pix ativo?\n\n${MODE_LABELS[persisted.mode]} -> ${MODE_LABELS[draftMode]}.\n\n` +
        'A troca vale SOMENTE para cobranças novas. Cobranças em andamento continuam sendo ' +
        'confirmadas pelos webhooks dos provedores originais. As chaves de API vivem em secrets ' +
        'do servidor — este seletor não as altera.',
      );
      if (!ok) return;
    }
    setProvSaving(true);
    const { error } = await updatePixProviderSetting({
      mode: draftMode,
      test_provider: draftTest === '' ? null : draftTest,
      allowlist_user_ids: allowlistIds,
      charge_ttl_minutes: parseInt(draftTtl, 10) || 15,
    });
    setProvSaving(false);
    if (error) { setProvError(error); return; }
    const fresh = await fetchPixProviderSetting();
    setPersisted(fresh);
    if (fresh.updated_by && !profileNames[fresh.updated_by]) {
      const names = await fetchProfileNames([fresh.updated_by]);
      mergeNames(names);
    }
    setProvSaved(true);
    setTimeout(() => setProvSaved(false), 2000);
  }, [draftMode, draftTest, draftTtl, allowlistIds, persisted.mode, profileNames, mergeNames]);

  const addToAllowlist = useCallback(async () => {
    const value = allowInput.trim();
    if (!value) return;
    setAllowError(null);
    setAllowSearching(true);
    const { profile, error } = await findProfileByIdentifier(value);
    setAllowSearching(false);
    if (!profile) { setAllowError(error || 'Nenhum perfil encontrado'); return; }
    setAllowlistIds((prev) => (prev.includes(profile.id) ? prev : [...prev, profile.id]));
    mergeNames({ [profile.id]: profile.full_name || 'Sem nome' });
    setAllowInput('');
  }, [allowInput, mergeNames]);

  const removeFromAllowlist = useCallback((id: string) => {
    setAllowlistIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const testConnection = useCallback(async () => {
    setHealthLoading(true);
    const h = await fetchPixProviderHealth(true);
    setHealth(h);
    setHealthPinged(true);
    setHealthLoading(false);
  }, []);

  const savePalliative = useCallback(async () => {
    setPalError(null);
    const copia = copiaECola.trim();
    if (copia && !copia.startsWith('000201')) {
      const ok = window.confirm(
        'O copia-e-cola informado não começa com "000201" (prefixo padrão EMV do Pix).\n\n' +
        'Salvar mesmo assim?',
      );
      if (!ok) return;
    }
    setPalSaving(true);
    const { error } = await updatePixPalliativeSetting({ copia_e_cola: copia, qr_image_url: qrImageUrl.trim() });
    setPalSaving(false);
    if (error) { setPalError(error); return; }
    setPalSaved(true);
    setTimeout(() => setPalSaved(false), 2000);
  }, [copiaECola, qrImageUrl]);

  const onQrUploaded = useCallback((path: string) => {
    const { data } = (supabase as any).storage.from('avatars').getPublicUrl(path);
    const url = data?.publicUrl as string | undefined;
    if (url) setQrImageUrl(url);
    setShowQrUpload(false);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 48 } },
      React.createElement('span', { style: { fontSize: 15, color: '#767676', ...font } }, 'Carregando configuração Pix...'));
  }

  // ── Card 1: Provedor Pix ativo ──────────────────────────────────────
  const updatedByName = persisted.updated_by ? (profileNames[persisted.updated_by] || persisted.updated_by.slice(0, 8)) : null;
  const statusLine = React.createElement('p', { style: { margin: 0, fontSize: 14, color: '#0d0d0d', ...font } },
    React.createElement('span', { style: { fontWeight: 700 } }, `Ativo: ${MODE_LABELS[persisted.mode]}`),
    persisted.updated_at
      ? React.createElement('span', { style: { color: '#767676' } },
          ` — desde ${formatDateTimeBR(persisted.updated_at)}${updatedByName ? `, por ${updatedByName}` : ''}`)
      : null);

  const healthEntry = (provider: PixRealProvider) => health?.providers?.[provider];
  const healthRow = (provider: PixRealProvider, label: string) => {
    const entry = healthEntry(provider);
    let color = '#d9d9d9';
    let detail = 'sem informação';
    if (health && health.error) {
      detail = 'health-check indisponível';
    } else if (entry) {
      if (!entry.configured) { color = '#d9d9d9'; detail = 'não configurado (secrets ausentes)'; }
      else if (healthPinged) {
        color = entry.ok ? '#22c55e' : '#b53838';
        detail = entry.ok ? (entry.detail || 'conexão OK') : (entry.detail || 'falha na conexão');
      } else { color = '#22c55e'; detail = 'configurado (secrets presentes)'; }
    }
    return React.createElement('div', { key: provider, style: { display: 'flex', alignItems: 'center', gap: 8 } },
      healthDot(color),
      React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#0d0d0d', width: 80, ...font } }, label),
      React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, detail));
  };

  const providerCard = React.createElement('div', { style: cardStyle },
    React.createElement('h3', { style: cardTitleStyle }, 'Provedor Pix ativo'),
    statusLine,
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('label', { style: labelStyle }, 'Provedor para NOVAS cobranças'),
      React.createElement('div', { style: selectWrapStyle },
        React.createElement('select', {
          value: draftMode,
          'data-testid': 'pix-provider-select',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setDraftMode(e.target.value as PixProviderMode),
          style: selectStyle,
        },
          React.createElement('option', { value: 'palliative' }, 'Paliativo (QR estático, sem verificação)'),
          React.createElement('option', { value: 'asaas' }, 'Asaas'),
          React.createElement('option', { value: 'bradesco', disabled: true }, 'Bradesco (em breve)')),
        selectChevron)),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, maxWidth: 260 } },
      React.createElement('label', { style: labelStyle }, 'Validade da cobrança (minutos)'),
      React.createElement('input', {
        type: 'number', min: '1', max: '120', value: draftTtl,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraftTtl(e.target.value),
        style: { ...textInputStyle, width: 110 },
      }),
      React.createElement('p', { style: helperStyle }, 'Tempo até a cobrança expirar e a vaga ser liberada.')),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('label', { style: labelStyle }, 'Saúde dos provedores'),
      healthRow('asaas', 'Asaas'),
      healthRow('bradesco', 'Bradesco'),
      health && health.error
        ? React.createElement('p', { style: helperStyle }, 'A função pix-provider-health ainda não está publicada neste ambiente.')
        : null,
      React.createElement('div', null,
        React.createElement('button', {
          type: 'button', onClick: testConnection, disabled: healthLoading,
          style: {
            height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid #0d0d0d',
            background: '#fff', color: '#0d0d0d', fontSize: 13, fontWeight: 600,
            cursor: healthLoading ? 'wait' : 'pointer', opacity: healthLoading ? 0.6 : 1, ...font,
          },
        }, healthLoading ? 'Testando...' : 'Testar conexão'))),
    React.createElement('div', { style: amberBoxStyle },
      React.createElement('p', { style: amberTextStyle },
        'A troca de provedor vale somente para cobranças NOVAS. Os webhooks de todos os provedores ' +
        'permanecem ativos para cobranças em andamento. As chaves de API vivem em secrets de servidor ' +
        '(nunca neste painel) — configure-as antes de ativar um provedor real.')),
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      React.createElement('button', {
        type: 'button', onClick: saveProvider, disabled: provSaving,
        style: { ...pillBtnStyle, cursor: provSaving ? 'wait' : 'pointer', opacity: provSaving ? 0.6 : 1 },
      }, provSaving ? 'Salvando...' : 'Salvar'),
      provSaved ? React.createElement('span', { style: { color: '#22c55e', fontSize: 14, fontWeight: 500, ...font } }, 'Salvo com sucesso!') : null,
      provError ? React.createElement('span', { style: errorTextStyle }, provError) : null));

  // ── Card 2: Teste controlado ────────────────────────────────────────
  const allowChips = allowlistIds.map((id) => {
    const nome = profileNames[id] || 'Perfil';
    return React.createElement('span', {
      key: id,
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 36,
        padding: '0 8px 0 14px', borderRadius: 999, background: '#fff',
        border: '1px solid #d9d9d9', fontSize: 13, color: '#0d0d0d', ...font,
      },
    },
      React.createElement('span', { style: { fontWeight: 600 } }, nome),
      React.createElement('span', { style: { color: '#767676', fontSize: 12 } }, id.slice(0, 8)),
      React.createElement('button', {
        type: 'button',
        'aria-label': `Remover ${nome} da allowlist`,
        onClick: () => removeFromAllowlist(id),
        style: {
          width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#f1f1f1',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        },
      },
        React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))));
  });

  const testCard = React.createElement('div', { style: cardStyle },
    React.createElement('h3', { style: cardTitleStyle }, 'Teste controlado'),
    React.createElement('p', { style: cardSubStyle },
      'Usuários da allowlist usam o provedor de teste em vez do provedor ativo. ' +
      'Permite validar um provedor real em produção com contas do time antes do go-live.'),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('label', { style: labelStyle }, 'Provedor de teste'),
      React.createElement('div', { style: selectWrapStyle },
        React.createElement('select', {
          value: draftTest,
          'data-testid': 'pix-test-provider-select',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setDraftTest(e.target.value as PixRealProvider | ''),
          style: selectStyle,
        },
          React.createElement('option', { value: '' }, 'Nenhum (teste desativado)'),
          React.createElement('option', { value: 'asaas' }, 'Asaas'),
          React.createElement('option', { value: 'bradesco', disabled: true }, 'Bradesco (em breve)')),
        selectChevron)),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('label', { style: labelStyle }, 'Allowlist de usuários'),
      allowChips.length > 0
        ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } }, ...allowChips)
        : React.createElement('p', { style: helperStyle }, 'Nenhum usuário na allowlist.'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' } },
        React.createElement('input', {
          type: 'text', value: allowInput, placeholder: 'UUID, CPF ou telefone',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setAllowInput(e.target.value); setAllowError(null); },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void addToAllowlist(); },
          style: { ...textInputStyle, flex: '1 1 220px', minWidth: 200 },
        }),
        React.createElement('button', {
          type: 'button', onClick: addToAllowlist, disabled: allowSearching,
          style: {
            height: 44, padding: '0 20px', borderRadius: 999, border: '1px solid #0d0d0d',
            background: '#fff', color: '#0d0d0d', fontSize: 13, fontWeight: 600,
            cursor: allowSearching ? 'wait' : 'pointer', opacity: allowSearching ? 0.6 : 1, ...font,
          },
        }, allowSearching ? 'Buscando...' : 'Adicionar')),
      allowError ? React.createElement('p', { style: errorTextStyle }, allowError) : null,
      React.createElement('p', { style: helperStyle },
        'A allowlist fica publicamente legível em platform_settings — use apenas contas internas.')),
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      React.createElement('button', {
        type: 'button', onClick: saveProvider, disabled: provSaving,
        style: { ...pillBtnStyle, cursor: provSaving ? 'wait' : 'pointer', opacity: provSaving ? 0.6 : 1 },
      }, provSaving ? 'Salvando...' : 'Salvar'),
      provSaved ? React.createElement('span', { style: { color: '#22c55e', fontSize: 14, fontWeight: 500, ...font } }, 'Salvo com sucesso!') : null));

  // ── Card 3: Pix paliativo ───────────────────────────────────────────
  const copiaInvalida = copiaECola.trim().length > 0 && !copiaECola.trim().startsWith('000201');
  const palliativeCard = React.createElement('div', { style: cardStyle },
    React.createElement('h3', { style: cardTitleStyle }, 'Pix paliativo'),
    React.createElement('p', { style: cardSubStyle },
      'QR estático exibido no app quando o modo Paliativo está ativo. O cliente confirma o pagamento ' +
      'sem verificação — mantenha estes dados corretos enquanto o modo estiver em uso.'),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('label', { style: labelStyle }, 'Copia-e-cola (chave EMV)'),
      React.createElement('textarea', {
        value: copiaECola,
        placeholder: '00020126...',
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setCopiaECola(e.target.value),
        rows: 4,
        style: {
          borderRadius: 8, border: `1px solid ${copiaInvalida ? '#cba04b' : '#e2e2e2'}`,
          padding: '12px 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', background: '#fff',
          resize: 'vertical' as const, boxSizing: 'border-box' as const, width: '100%',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        },
      }),
      copiaInvalida
        ? React.createElement('p', { style: { margin: 0, fontSize: 12, color: '#5f4510', ...font } },
            'Atenção: códigos Pix copia-e-cola costumam começar com "000201".')
        : null),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
      React.createElement('label', { style: labelStyle }, 'Imagem do QR (URL)'),
      React.createElement('input', {
        type: 'text', value: qrImageUrl,
        placeholder: 'https://... ou data:image/png;base64,...',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQrImageUrl(e.target.value),
        style: { ...textInputStyle, width: '100%' },
      }),
      React.createElement('div', null,
        React.createElement('button', {
          type: 'button', onClick: () => setShowQrUpload((v) => !v),
          style: {
            height: 36, padding: '0 16px', borderRadius: 999, border: '1px solid #d9d9d9',
            background: '#fff', color: '#0d0d0d', fontSize: 12, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, showQrUpload ? 'Fechar upload' : 'Enviar imagem do QR')),
      showQrUpload && session?.user?.id
        ? React.createElement(FileUpload, {
            bucket: 'avatars',
            pathPrefix: session.user.id,
            accept: '.png,.jpg,.jpeg,.webp',
            onUploaded: onQrUploaded,
            onCancel: () => setShowQrUpload(false),
          })
        : null,
      qrImageUrl.trim()
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
            React.createElement('span', { style: helperStyle }, 'Pré-visualização:'),
            React.createElement('img', {
              src: qrImageUrl.trim(),
              alt: 'Pré-visualização do QR paliativo',
              style: { width: 160, height: 160, objectFit: 'contain' as const, borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff' },
            }))
        : React.createElement('p', { style: helperStyle }, 'Vazio = o app usa a imagem padrão embarcada.')),
    React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      React.createElement('button', {
        type: 'button', onClick: savePalliative, disabled: palSaving,
        style: { ...pillBtnStyle, cursor: palSaving ? 'wait' : 'pointer', opacity: palSaving ? 0.6 : 1 },
      }, palSaving ? 'Salvando...' : 'Salvar'),
      palSaved ? React.createElement('span', { style: { color: '#22c55e', fontSize: 14, fontWeight: 500, ...font } }, 'Salvo com sucesso!') : null,
      palError ? React.createElement('span', { style: errorTextStyle }, palError) : null));

  // ── Atalho ──────────────────────────────────────────────────────────
  const shortcut = React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
    React.createElement('button', {
      type: 'button',
      onClick: () => navigate('/pagamentos/pix'),
      style: {
        height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid #0d0d0d',
        background: '#fff', color: '#0d0d0d', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font,
      },
    }, 'Ver cobranças e devoluções Pix'));

  return React.createElement('div', {
    'data-testid': 'pix-config-tab',
    style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%', maxWidth: 600 },
  },
    React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Provedores Pix'),
    providerCard,
    testCard,
    palliativeCard,
    shortcut);
}
