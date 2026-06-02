/**
 * NotificacoesScreen — Gestão de notificações do admin.
 * Enviar notificações, ver histórico, broadcast.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { webStyles, searchIconSvg } from '../styles/webStyles';
import {
  fetchAllNotifications,
  createNotificationForUser,
  createNotificationBroadcast,
  deleteNotification,
} from '../data/queries';
import type { NotificationAdminRow } from '../data/queries';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

export default function NotificacoesScreen() {
  const [notifications, setNotifications] = useState<NotificationAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('todos');
  const [toastMsg, setToastMsg] = useState('');

  // Send form state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendType, setSendType] = useState<'individual' | 'broadcast'>('broadcast');
  const [sendTargetApp, setSendTargetApp] = useState<'cliente' | 'motorista'>('cliente');
  const [sendUserId, setSendUserId] = useState('');
  const [sendTitle, setSendTitle] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendCategory, setSendCategory] = useState('');
  const [sending, setSending] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }, []);

  useEffect(() => {
    fetchAllNotifications().then((data) => {
      setNotifications(data);
      setLoading(false);
    });
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(notifications.map((n) => n.category || 'sem categoria'));
    return ['todos', ...Array.from(cats)];
  }, [notifications]);

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (search) {
        const q = search.toLowerCase();
        if (!n.title.toLowerCase().includes(q) && !n.userName.toLowerCase().includes(q) && !(n.message || '').toLowerCase().includes(q)) return false;
      }
      if (filterCategory !== 'todos') {
        if ((n.category || 'sem categoria') !== filterCategory) return false;
      }
      return true;
    });
  }, [notifications, search, filterCategory]);

  const kpis = useMemo(() => {
    const total = notifications.length;
    const unread = notifications.filter((n) => !n.readAt).length;
    const read = total - unread;
    return { total, unread, read };
  }, [notifications]);

  const handleSend = useCallback(async () => {
    if (!sendTitle.trim() || !sendMessage.trim()) return;
    setSending(true);
    if (sendType === 'broadcast') {
      const { count, error } = await createNotificationBroadcast(sendTitle.trim(), sendMessage.trim(), sendCategory.trim() || undefined, sendTargetApp);
      if (error) { showToast('Erro: ' + error); }
      else { showToast(`Notificação enviada para ${count} ${sendTargetApp}s`); }
    } else {
      if (!sendUserId.trim()) { setSending(false); return; }
      const { error } = await createNotificationForUser(sendUserId.trim(), sendTitle.trim(), sendMessage.trim(), sendCategory.trim() || undefined, sendTargetApp);
      if (error) { showToast('Erro: ' + error); }
      else { showToast('Notificação enviada com sucesso'); }
    }
    setSending(false);
    setSendOpen(false);
    setSendTitle('');
    setSendMessage('');
    setSendCategory('');
    setSendUserId('');
    setSendTargetApp('cliente');
    // Reload
    fetchAllNotifications().then(setNotifications);
  }, [sendType, sendTargetApp, sendUserId, sendTitle, sendMessage, sendCategory, showToast]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Remover esta notificação?')) return;
    await deleteNotification(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    showToast('Notificação removida');
  }, [showToast]);

  // ── Styles ──────────────────────────────────────────────────────────
  const metricCard = (title: string, value: number, color: string) =>
    React.createElement('div', {
      key: title,
      style: { flex: '1 1 0', minWidth: 180, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 },
    },
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, title),
      React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color, ...font } }, String(value)));

  const inputStyle: React.CSSProperties = {
    height: 44, borderRadius: 8, background: '#f1f1f1', border: 'none', outline: 'none',
    padding: '0 16px', fontSize: 14, width: '100%', boxSizing: 'border-box' as const, ...font,
  };

  const chipFiltro = (label: string, selected: boolean, onClick: () => void) =>
    React.createElement('button', {
      type: 'button', onClick,
      style: {
        height: 36, padding: '0 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
        background: selected ? '#0d0d0d' : '#f1f1f1', color: selected ? '#fff' : '#0d0d0d',
        fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' as const, ...font,
      },
    }, label);

  if (loading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando notificações...'));
  }

  // ── Toast ──────────────────────────────────────────────────────────
  const toast = toastMsg ? React.createElement('div', {
    style: { position: 'fixed' as const, bottom: 24, right: 24, background: '#0d0d0d', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 500, zIndex: 2000, ...font },
  }, toastMsg) : null;

  // ── Send modal ──────────────────────────────────────────────────────
  const sendModal = sendOpen ? React.createElement('div', {
    role: 'dialog', 'aria-modal': true,
    style: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
    onClick: () => setSendOpen(false),
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column' as const, gap: 16, boxSizing: 'border-box' as const },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0d0d0d', ...font } }, 'Enviar notificação'),
      // Type selector
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        chipFiltro('Broadcast', sendType === 'broadcast', () => setSendType('broadcast')),
        chipFiltro('Individual', sendType === 'individual', () => setSendType('individual'))),
      // Target app selector
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'App destinatário'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          chipFiltro('Cliente', sendTargetApp === 'cliente', () => setSendTargetApp('cliente')),
          chipFiltro('Motorista', sendTargetApp === 'motorista', () => setSendTargetApp('motorista')))),
      // User ID (if individual)
      sendType === 'individual' ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'User ID'),
        React.createElement('input', { type: 'text', value: sendUserId, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSendUserId(e.target.value), placeholder: 'UUID do usuário', style: inputStyle })) : null,
      // Title
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Título'),
        React.createElement('input', { type: 'text', value: sendTitle, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSendTitle(e.target.value), placeholder: 'ex: Promoção especial', style: inputStyle })),
      // Message
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Mensagem'),
        React.createElement('textarea', {
          value: sendMessage, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setSendMessage(e.target.value),
          placeholder: 'Corpo da notificação...', rows: 3,
          style: { ...inputStyle, height: 'auto', padding: '12px 16px', resize: 'vertical' as const },
        })),
      // Category
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Categoria (opcional)'),
        React.createElement('input', { type: 'text', value: sendCategory, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSendCategory(e.target.value), placeholder: 'ex: promotions', style: inputStyle })),
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { type: 'button', onClick: () => setSendOpen(false), style: { flex: 1, height: 44, borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font } }, 'Cancelar'),
        React.createElement('button', {
          type: 'button', onClick: handleSend,
          disabled: sending || !sendTitle.trim() || !sendMessage.trim(),
          style: { flex: 1, height: 44, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: sending ? 'wait' : 'pointer', opacity: (sending || !sendTitle.trim() || !sendMessage.trim()) ? 0.5 : 1, ...font },
        }, sending ? 'Enviando...' : 'Enviar'))))
  : null;

  // ── Table ──────────────────────────────────────────────────────────
  const cols = [
    { label: 'Destinatário', flex: '1 1 18%', minWidth: 140 },
    { label: 'Título', flex: '1 1 20%', minWidth: 140 },
    { label: 'Mensagem', flex: '1 1 25%', minWidth: 160 },
    { label: 'Categoria', flex: '0 0 110px', minWidth: 110 },
    { label: 'Data', flex: '0 0 100px', minWidth: 100 },
    { label: 'Lida', flex: '0 0 70px', minWidth: 70 },
    { label: 'Ações', flex: '0 0 80px', minWidth: 80 },
  ];

  const cellBase: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 13, color: '#0d0d0d', ...font, padding: '0 6px', overflow: 'hidden' };

  const tableHeader = React.createElement('div', {
    style: { display: 'flex', height: 48, background: '#e2e2e2', padding: '0 16px', alignItems: 'center' },
  }, ...cols.map((c) => React.createElement('div', { key: c.label, style: { flex: c.flex, minWidth: c.minWidth, fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font, padding: '0 6px' } }, c.label)));

  const tableRows = filtered.map((n) =>
    React.createElement('div', {
      key: n.id,
      style: { display: 'flex', minHeight: 56, alignItems: 'center', padding: '4px 16px', borderBottom: '1px solid #e9e9e9', background: n.readAt ? '#fff' : '#fffbeb' },
    },
      React.createElement('div', { style: { ...cellBase, flex: cols[0].flex, minWidth: cols[0].minWidth, fontWeight: 500 } }, n.userName),
      React.createElement('div', { style: { ...cellBase, flex: cols[1].flex, minWidth: cols[1].minWidth, fontWeight: 600 } }, n.title),
      React.createElement('div', { style: { ...cellBase, flex: cols[2].flex, minWidth: cols[2].minWidth, color: '#555' } }, n.message || '—'),
      React.createElement('div', { style: { ...cellBase, flex: cols[3].flex, minWidth: cols[3].minWidth } },
        React.createElement('span', { style: { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f1f1', color: '#555', ...font } }, n.category || '—')),
      React.createElement('div', { style: { ...cellBase, flex: cols[4].flex, minWidth: cols[4].minWidth, fontSize: 12, color: '#767676' } }, n.createdAt),
      React.createElement('div', { style: { ...cellBase, flex: cols[5].flex, minWidth: cols[5].minWidth } },
        React.createElement('span', { style: { width: 8, height: 8, borderRadius: '50%', background: n.readAt ? '#22c55e' : '#fbbf24', display: 'inline-block' } })),
      React.createElement('div', { style: { ...cellBase, flex: cols[6].flex, minWidth: cols[6].minWidth } },
        React.createElement('button', {
          type: 'button', onClick: () => handleDelete(n.id),
          style: { width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', background: '#fee5e5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
        }, React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2.5, strokeLinecap: 'round' }))))));

  return React.createElement(React.Fragment, null,
    React.createElement('h1', { style: webStyles.homeTitle }, 'Notificações'),
    // KPIs
    React.createElement('div', { style: { display: 'flex', gap: 16, width: '100%', flexWrap: 'wrap' as const } },
      metricCard('Total enviadas', kpis.total, '#0d0d0d'),
      metricCard('Não lidas', kpis.unread, '#b53838'),
      metricCard('Lidas', kpis.read, '#22c55e')),
    // Search + actions
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#f1f1f1', borderRadius: 999, height: 44, paddingLeft: 16, paddingRight: 16, minWidth: 200 } },
        searchIconSvg,
        React.createElement('input', { type: 'text', value: search, placeholder: 'Buscar por título, mensagem ou usuário...', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value), style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: '#0d0d0d', ...font } })),
      React.createElement('button', {
        type: 'button', onClick: () => setSendOpen(true),
        style: { display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', background: '#0d0d0d', color: '#fff', border: 'none', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, ...font },
      }, 'Enviar notificação')),
    // Category filters
    React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
      ...categories.map((cat) => chipFiltro(cat === 'todos' ? 'Todas' : cat, filterCategory === cat, () => setFilterCategory(cat)))),
    // Table
    filtered.length === 0
      ? React.createElement('div', { style: { padding: 40, textAlign: 'center' as const, color: '#767676', ...font } }, 'Nenhuma notificação encontrada.')
      : React.createElement('div', { style: { background: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', border: '1px solid #e2e2e2' } },
          React.createElement('div', { style: { width: '100%', overflowX: 'auto' as const } }, tableHeader, ...tableRows)),
    sendModal,
    toast);
}
