/**
 * RetiradaMotoristaScreen — Base confirma a retirada da encomenda pelo motorista.
 * Fluxo: motorista mostra PIN de 4 dígitos no app dele; atendente da base
 * digita aqui e confirma. Chama RPC base_confirm_driver_pickup, que valida
 * contra shipments.base_to_driver_code e seta base_to_driver_confirmed_at.
 * Uses React.createElement() calls (NOT JSX), seguindo padrão do app admin.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { webStyles } from '../styles/webStyles';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

type PendingShipment = {
  id: string;
  recipient_name: string | null;
  delivered_to_base_at: string | null;
  base_id: string | null;
  bases?: { name: string | null; city: string | null; state: string | null } | null;
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export default function RetiradaMotoristaScreen() {
  const [items, setItems] = useState<PendingShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [openShipmentId, setOpenShipmentId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successFor, setSuccessFor] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: qErr } = await (supabase as any)
      .from('shipments')
      .select('id, recipient_name, delivered_to_base_at, base_id, bases:base_id ( name, city, state )')
      .not('base_id', 'is', null)
      .not('delivered_to_base_at', 'is', null)
      .is('picked_up_by_driver_from_base_at', null)
      .is('base_to_driver_confirmed_at', null)
      .order('delivered_to_base_at', { ascending: false })
      .limit(50);
    if (qErr) {
      console.error('[RetiradaMotorista] fetch err', qErr);
      setItems([]);
    } else {
      setItems((data ?? []) as PendingShipment[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchPending(); }, [fetchPending, refreshTick]);

  const openFor = useCallback((id: string) => {
    setOpenShipmentId(id);
    setPin('');
    setError('');
    setSuccessFor(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!openShipmentId) return;
    const digits = pin.replace(/\D/g, '');
    if (digits.length !== 4) {
      setError('O código deve ter 4 dígitos.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { data, error: rpcErr } = await (supabase as any).rpc(
        'base_confirm_driver_pickup',
        { p_shipment_id: openShipmentId, p_code: digits },
      );
      if (rpcErr) {
        setError(rpcErr.message ?? 'Falha ao confirmar.');
        return;
      }
      const payload = data as { ok?: boolean; error?: string; already_completed?: boolean } | null;
      if (payload && payload.ok === false) {
        const e = String(payload.error ?? '');
        const msg =
          e === 'invalid_code' ? 'Código incorreto. Confira com o motorista.' :
          e === 'shipment_not_found' ? 'Encomenda não encontrada.' :
          e === 'no_base_handoff' ? 'Esta encomenda não passa por base.' :
          e === 'not_delivered_to_base' ? 'O preparador ainda não entregou a encomenda na base.' :
          e === 'not_authenticated' ? 'Faça login novamente.' :
          'Não foi possível confirmar.';
        setError(msg);
        return;
      }
      setSuccessFor(openShipmentId);
      setOpenShipmentId(null);
      setPin('');
      setRefreshTick((t) => t + 1);
      window.setTimeout(() => setSuccessFor(null), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message ?? 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  }, [openShipmentId, pin]);

  const list = useMemo(() => items, [items]);

  return React.createElement('div', { style: { padding: 24, maxWidth: 960, margin: '0 auto', ...font } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 } },
      React.createElement('div', null,
        React.createElement('h1', { style: webStyles.homeTitle }, 'Retirada Motorista'),
        React.createElement('p', { style: { color: '#767676', fontSize: 14, marginTop: 8, lineHeight: 1.5 } },
          'O motorista chegou à base para retirar a encomenda? Localize a entrega abaixo, peça para ele mostrar o PIN de 4 dígitos no app e digite aqui para confirmar.'),
      ),
      React.createElement('button', {
        onClick: () => setRefreshTick((t) => t + 1),
        style: { backgroundColor: '#fff', color: '#0d0d0d', padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer', fontWeight: 500, fontSize: 14, ...font },
      }, 'Atualizar'),
    ),

    successFor ? React.createElement('div', {
      style: { background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14 },
    }, `Retirada confirmada para a encomenda ${shortId(successFor)}.`) : null,

    loading ? React.createElement('div', { style: { color: '#767676', padding: 24, textAlign: 'center' as const } }, 'Carregando…')
    : list.length === 0 ? React.createElement('div', {
        style: { background: '#f9fafb', border: '1px dashed #e5e7eb', borderRadius: 12, padding: 32, textAlign: 'center' as const, color: '#767676', fontSize: 14 },
      }, 'Nenhuma encomenda aguardando retirada de motorista no momento.')
    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        ...list.map((it) => {
          const isOpen = openShipmentId === it.id;
          const baseName = it.bases?.name ? it.bases.name + (it.bases?.state ? ' / ' + it.bases.state : '') : '—';
          return React.createElement('div', {
            key: it.id,
            style: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff', display: 'flex', flexDirection: 'column' as const, gap: 12 },
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' as const } },
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
                React.createElement('div', { style: { fontSize: 12, color: '#767676', letterSpacing: 0.4, textTransform: 'uppercase' as const } }, 'Encomenda ' + shortId(it.id)),
                React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d' } }, it.recipient_name ?? 'Destinatário não informado'),
                React.createElement('div', { style: { fontSize: 13, color: '#767676' } }, 'Base: ' + baseName),
                React.createElement('div', { style: { fontSize: 12, color: '#767676' } }, 'Entregue na base em ' + fmtDateTime(it.delivered_to_base_at)),
              ),
              isOpen ? null : React.createElement('button', {
                onClick: () => openFor(it.id),
                style: { backgroundColor: '#0d0d0d', color: '#fff', padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, ...font },
              }, 'Confirmar retirada'),
            ),
            isOpen ? React.createElement('div', { style: { borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', flexDirection: 'column' as const, gap: 10 } },
              React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#0d0d0d' } }, 'PIN exibido no app do motorista'),
              React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const } },
                React.createElement('input', {
                  type: 'text',
                  inputMode: 'numeric' as const,
                  pattern: '[0-9]*',
                  maxLength: 4,
                  placeholder: 'Ex: 1234',
                  value: pin,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPin(v);
                    if (error) setError('');
                  },
                  autoFocus: true,
                  disabled: submitting,
                  style: { width: 140, height: 44, borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', padding: '0 16px', fontSize: 22, letterSpacing: 6, textAlign: 'center' as const, fontFamily: 'Inter, sans-serif', color: '#0d0d0d' },
                }),
                React.createElement('button', {
                  onClick: () => void handleConfirm(),
                  disabled: submitting || pin.length !== 4,
                  style: { backgroundColor: pin.length === 4 ? '#0d0d0d' : '#9ca3af', color: '#fff', padding: '12px 20px', borderRadius: 8, border: 'none', cursor: pin.length === 4 && !submitting ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 14, ...font },
                }, submitting ? 'Confirmando…' : 'Validar PIN'),
                React.createElement('button', {
                  onClick: () => { setOpenShipmentId(null); setPin(''); setError(''); },
                  disabled: submitting,
                  style: { backgroundColor: 'transparent', color: '#b53838', padding: '12px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: 14, ...font },
                }, 'Cancelar'),
              ),
              error ? React.createElement('div', { style: { color: '#b53838', fontSize: 13 } }, error) : null,
            ) : null,
          );
        }),
      ),
  );
}
