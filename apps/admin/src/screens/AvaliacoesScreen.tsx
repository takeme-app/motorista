/**
 * AvaliacoesScreen — Moderação de avaliações / reviews.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { webStyles, searchIconSvg } from '../styles/webStyles';
import { fetchAllRatingsEnhanced, deleteRating } from '../data/queries';
import type { RatingListItem } from '../data/queries';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

type EnhancedRating = RatingListItem & { table: string; ratingId: string };

export default function AvaliacoesScreen() {
  const [ratings, setRatings] = useState<EnhancedRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('todos');
  const [filterRating, setFilterRating] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }, []);

  useEffect(() => {
    fetchAllRatingsEnhanced().then((data) => { setRatings(data); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    return ratings.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.ratedByName.toLowerCase().includes(q) && !r.comment.toLowerCase().includes(q)) return false;
      }
      if (filterType !== 'todos' && r.entityType !== filterType) return false;
      if (filterRating !== null && r.rating !== filterRating) return false;
      return true;
    });
  }, [ratings, search, filterType, filterRating]);

  const kpis = useMemo(() => {
    const total = ratings.length;
    const avg = total > 0 ? (ratings.reduce((s, r) => s + r.rating, 0) / total) : 0;
    const viagens = ratings.filter((r) => r.entityType === 'Viagem').length;
    const encomendas = ratings.filter((r) => r.entityType === 'Encomenda').length;
    const distribution = [1, 2, 3, 4, 5].map((star) => ({ star, count: ratings.filter((r) => r.rating === star).length }));
    return { total, avg, viagens, encomendas, distribution };
  }, [ratings]);

  const handleDelete = useCallback(async (r: EnhancedRating) => {
    if (!confirm(`Remover esta avaliação de ${r.ratedByName}?`)) return;
    await deleteRating(r.table as 'booking_ratings' | 'shipment_ratings' | 'trip_ratings', r.ratingId);
    setRatings((prev) => prev.filter((x) => x.id !== r.id));
    showToast('Avaliação removida');
  }, [showToast]);

  const chipFiltro = (label: string, selected: boolean, onClick: () => void) =>
    React.createElement('button', {
      type: 'button', onClick,
      style: { height: 36, padding: '0 14px', borderRadius: 999, border: 'none', cursor: 'pointer', background: selected ? '#0d0d0d' : '#f1f1f1', color: selected ? '#fff' : '#0d0d0d', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' as const, ...font },
    }, label);

  const starEl = (n: number) => React.createElement('span', { style: { color: '#fbbf24', fontSize: 14 } }, '★'.repeat(n) + '☆'.repeat(5 - n));

  if (loading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando avaliações...'));
  }

  const toast = toastMsg ? React.createElement('div', {
    style: { position: 'fixed' as const, bottom: 24, right: 24, background: '#0d0d0d', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 500, zIndex: 2000, ...font },
  }, toastMsg) : null;

  // ── KPI Cards ────────────────────────────────────────────────────────
  const kpiCards = React.createElement('div', { style: { display: 'flex', gap: 16, width: '100%', flexWrap: 'wrap' as const } },
    React.createElement('div', { style: { flex: '1 1 0', minWidth: 160, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 } },
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Total de avaliações'),
      React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, String(kpis.total))),
    React.createElement('div', { style: { flex: '1 1 0', minWidth: 160, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 } },
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Média geral'),
      React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, kpis.avg.toFixed(1)),
      starEl(Math.round(kpis.avg))),
    React.createElement('div', { style: { flex: '1 1 0', minWidth: 160, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 } },
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Viagens'),
      React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, String(kpis.viagens))),
    React.createElement('div', { style: { flex: '1 1 0', minWidth: 160, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 } },
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Encomendas'),
      React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', ...font } }, String(kpis.encomendas))));

  // ── Distribution bar ─────────────────────────────────────────────────
  const distBar = React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'flex-end' } },
    ...kpis.distribution.map((d) =>
      React.createElement('div', { key: d.star, style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4 } },
        React.createElement('span', { style: { fontSize: 11, color: '#767676', ...font } }, String(d.count)),
        React.createElement('div', { style: { width: 40, height: Math.max(4, (d.count / Math.max(1, kpis.total)) * 80), background: '#fbbf24', borderRadius: 4 } }),
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, ...font } }, `${d.star}★`))));

  // ── Table ────────────────────────────────────────────────────────────
  const cols = [
    { label: 'Avaliador', flex: '1 1 18%', minWidth: 140 },
    { label: 'Tipo', flex: '0 0 100px', minWidth: 100 },
    { label: 'Nota', flex: '0 0 120px', minWidth: 120 },
    { label: 'Comentário', flex: '1 1 30%', minWidth: 180 },
    { label: 'Data', flex: '0 0 100px', minWidth: 100 },
    { label: 'Ações', flex: '0 0 80px', minWidth: 80 },
  ];

  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 13, color: '#0d0d0d', ...font, padding: '0 6px', overflow: 'hidden' };

  const tableHeader = React.createElement('div', {
    style: { display: 'flex', height: 48, background: '#e2e2e2', padding: '0 16px', alignItems: 'center' },
  }, ...cols.map((c) => React.createElement('div', { key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font, padding: '0 6px' } }, c.label)));

  const tableRows = filtered.map((r) =>
    React.createElement('div', {
      key: r.id,
      style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '4px 16px', borderBottom: '1px solid #e9e9e9', background: '#fff' },
    },
      React.createElement('div', { style: { ...cellBase, flex: cols[0].flex, minWidth: cols[0].minWidth, fontWeight: 500 } }, r.ratedByName),
      React.createElement('div', { style: { ...cellBase, flex: cols[1].flex, minWidth: cols[1].minWidth } },
        React.createElement('span', { style: { fontSize: 11, padding: '2px 10px', borderRadius: 999, background: r.entityType === 'Viagem' ? '#dbeafe' : '#f3e8ff', color: r.entityType === 'Viagem' ? '#1e40af' : '#6b21a8', fontWeight: 600, ...font } }, r.entityType)),
      React.createElement('div', { style: { ...cellBase, flex: cols[2].flex, minWidth: cols[2].minWidth } }, starEl(r.rating)),
      React.createElement('div', { style: { ...cellBase, flex: cols[3].flex, minWidth: cols[3].minWidth, color: '#555', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' } }, r.comment || '—'),
      React.createElement('div', { style: { ...cellBase, flex: cols[4].flex, minWidth: cols[4].minWidth, fontSize: 12, color: '#767676' } }, r.createdAt),
      React.createElement('div', { style: { ...cellBase, flex: cols[5].flex, minWidth: cols[5].minWidth } },
        React.createElement('button', {
          type: 'button', onClick: () => handleDelete(r),
          style: { width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#fee5e5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
        }, React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2.5, strokeLinecap: 'round' }))))));

  return React.createElement(React.Fragment, null,
    React.createElement('h1', { style: webStyles.homeTitle }, 'Avaliações'),
    kpiCards,
    distBar,
    // Search + filters
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, width: '100%' } },
      React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#f1f1f1', borderRadius: 999, height: 44, paddingLeft: 16, paddingRight: 16 } },
        searchIconSvg,
        React.createElement('input', { type: 'text', value: search, placeholder: 'Buscar por avaliador ou comentário...', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value), style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: '#0d0d0d', ...font } }))),
    React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
      chipFiltro('Todos', filterType === 'todos', () => setFilterType('todos')),
      chipFiltro('Viagens', filterType === 'Viagem', () => setFilterType('Viagem')),
      chipFiltro('Encomendas', filterType === 'Encomenda', () => setFilterType('Encomenda')),
      React.createElement('span', { style: { width: 1, height: 24, background: '#e2e2e2', margin: '0 4px' } }),
      ...[1, 2, 3, 4, 5].map((star) => chipFiltro(`${star}★`, filterRating === star, () => setFilterRating(filterRating === star ? null : star)))),
    // Table
    filtered.length === 0
      ? React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', ...font } }, 'Nenhuma avaliação encontrada.')
      : React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', border: '1px solid #e2e2e2' } },
          React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, tableHeader, ...tableRows)),
    toast);
}
