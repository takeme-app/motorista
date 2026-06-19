/**
 * FeriadosScreen — CRUD da tabela `holidays`.
 * As datas cadastradas (ativas) fazem o cálculo de preço da viagem aplicar
 * worker_routes.holiday_surcharge_pct (via resolve_trip_time_surcharge_pct).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string | null;
  is_active: boolean;
};

function formatDateBr(iso: string): string {
  // iso = 'YYYY-MM-DD' → 'DD/MM/YYYY' sem timezone shift.
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function FeriadosScreen() {
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from('holidays')
      .select('id, holiday_date, name, is_active')
      .order('holiday_date', { ascending: true });
    setRows((data as HolidayRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(async () => {
    setError(null);
    if (!date) { setError('Informe a data do feriado.'); return; }
    setSaving(true);
    const { error: insErr } = await (supabase as any)
      .from('holidays')
      .insert({ holiday_date: date, name: name.trim() || null, is_active: true });
    setSaving(false);
    if (insErr) { setError(insErr.message); return; }
    setDate('');
    setName('');
    await refresh();
  }, [date, name, refresh]);

  const toggleActive = useCallback(async (r: HolidayRow) => {
    await (supabase as any).from('holidays').update({ is_active: !r.is_active }).eq('id', r.id);
    void refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Remover este feriado?')) return;
    await (supabase as any).from('holidays').delete().eq('id', id);
    void refresh();
  }, [refresh]);

  return React.createElement('div', { style: { width: '100%', paddingBottom: 64, display: 'flex', flexDirection: 'column' as const, gap: 24, ...font } },
    React.createElement('div', null,
      React.createElement('h1', { style: { fontSize: 24, fontWeight: 700, margin: 0, color: '#0d0d0d' } }, 'Feriados'),
      React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: '4px 0 0' } },
        'Datas em que o adicional de feriado da rota (holiday_surcharge_pct) é aplicado ao preço da viagem.')),

    React.createElement('div', {
      style: {
        width: '100%', maxWidth: 900, border: '1px solid #e2e2e2', borderRadius: 12, padding: 24, boxSizing: 'border-box' as const,
        display: 'flex', flexDirection: 'column' as const, gap: 16,
      },
    },
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, margin: 0 } }, 'Adicionar feriado'),
      error ? React.createElement('div', {
        role: 'alert',
        style: { padding: 12, borderRadius: 8, background: '#fde8e6', color: '#551611', fontSize: 14 },
      }, error) : null,
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } },
        React.createElement('label', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500 } }, 'Data'),
          React.createElement('input', {
            type: 'date', value: date,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value),
            style: { height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16 },
          })),
        React.createElement('label', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500 } }, 'Nome (opcional)'),
          React.createElement('input', {
            type: 'text', value: name,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
            placeholder: 'Ex: Independência',
            style: { height: 44, borderRadius: 8, border: 'none', background: '#f1f1f1', padding: '0 16px', fontSize: 16 },
          }))),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', {
          type: 'button', onClick: add, disabled: saving,
          style: {
            height: 44, padding: '0 24px', borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
          },
        }, saving ? 'Salvando…' : 'Adicionar'))),

    React.createElement('div', {
      style: { width: '100%', maxWidth: 900, border: '1px solid #e2e2e2', borderRadius: 12, overflow: 'hidden' },
    },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' as const } },
        React.createElement('thead', { style: { background: '#f6f6f6' } },
          React.createElement('tr', null,
            ...['Data', 'Nome', 'Ativo', 'Ações'].map((h) =>
              React.createElement('th', { key: h, style: { textAlign: 'left' as const, padding: 12, fontSize: 12, fontWeight: 600, color: '#767676' } }, h)))),
        React.createElement('tbody', null,
          loading
            ? React.createElement('tr', null, React.createElement('td', { colSpan: 4, style: { padding: 16, fontSize: 14 } }, 'Carregando…'))
            : rows.length === 0
              ? React.createElement('tr', null, React.createElement('td', { colSpan: 4, style: { padding: 16, fontSize: 14, color: '#767676' } }, 'Nenhum feriado cadastrado.'))
              : rows.map((r) =>
                React.createElement('tr', { key: r.id, style: { borderTop: '1px solid #e2e2e2' } },
                  React.createElement('td', { style: { padding: 12, fontSize: 14 } }, formatDateBr(r.holiday_date)),
                  React.createElement('td', { style: { padding: 12, fontSize: 13, color: '#767676' } }, r.name || '—'),
                  React.createElement('td', { style: { padding: 12, fontSize: 13, color: r.is_active ? '#1f7a3a' : '#767676' } }, r.is_active ? 'Sim' : 'Não'),
                  React.createElement('td', { style: { padding: 12, display: 'flex', gap: 8 } },
                    React.createElement('button', {
                      type: 'button', onClick: () => toggleActive(r),
                      style: { height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #0d0d0d', background: '#fff', color: '#0d0d0d', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
                    }, r.is_active ? 'Desativar' : 'Ativar'),
                    React.createElement('button', {
                      type: 'button', onClick: () => remove(r.id),
                      style: { height: 32, padding: '0 12px', borderRadius: 8, border: 'none', background: '#fde8e6', color: '#b53838', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
                    }, 'Remover')))))))
  );
}
