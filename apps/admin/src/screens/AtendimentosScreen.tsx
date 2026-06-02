/**
 * AtendimentosScreen — Atendimentos conforme Figma 1044-38472.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { webStyles } from '../styles/webStyles';
import { fetchViagemCounts, fetchEncomendaCounts, fetchMotoristas } from '../data/queries';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import { useAuth } from '../contexts/AuthContext';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

// ── Status colors ───────────────────────────────────────────────────────
const statusMap: Record<string, { dot: string; bg: string; color: string; label: string }> = {
  nao_atendida: { dot: '#b53838', bg: '#eeafaa', color: '#551611', label: 'Não atendida' },
  em_atendimento: { dot: '#cba04b', bg: '#fee59a', color: '#654c01', label: 'Em atendimento' },
  atrasada: { dot: '#b53838', bg: '#eeafaa', color: '#551611', label: 'Atrasada' },
  ouvidoria: { dot: '#4A90D9', bg: '#a8c6ef', color: '#102d57', label: 'Ouvidoria' },
  denuncia: { dot: '#b53838', bg: '#eeafaa', color: '#551611', label: 'Denúncia' },
  finalizada: { dot: '#22c55e', bg: '#b0e8d1', color: '#174f38', label: 'Finalizada' },
};

/** Figma 1054:45062 — ordem e rótulos dos filtros por categoria (Meu atendimento). */
const MEU_ATENDIMENTO_CATEGORIAS_CONFIG = [
  { label: 'Todos', matches: null as readonly string[] | null },
  { label: 'Excursão', matches: ['Excursão'] as const },
  { label: 'Encomendas', matches: ['Encomendas'] as const },
  { label: 'Reembolso', matches: ['Reembolso'] as const },
  { label: 'Cadastro de transporte', matches: ['Cadastro de transporte'] as const },
  { label: 'Autorizar menores', matches: ['Autorizar menores'] as const },
  { label: 'Outros', matches: ['Outros'] as const },
] as const;

// ── Ticket data (first section — "Meu atendimento") ────────────────────
type Ticket = {
  id: string;
  nome: string;
  avatar: string;
  avatarUrl: string | null;
  categoria: string;
  descricao: string;
  tempo: string;
  status: string;
  adminId: string | null;
  /** Categoria bruta da API (excursao, reembolso, …) */
  rawCategory: string;
};

/** Figma 1062:26998 — segunda lista: ordem e rótulos; Ouvidoria/Denúncia filtram por `categoria`, resto por estado derivado. */
const TODOS_ATENDIMENTOS_CHIPS_CONFIG: {
  label: string;
  match: ((t: Ticket) => boolean) | null;
}[] = [
  { label: 'Todos', match: null },
  { label: 'Atrasadas', match: (t) => t.status === 'atrasada' },
  { label: 'Não atendidas', match: (t) => t.status === 'nao_atendida' },
  { label: 'Em atendimento', match: (t) => t.status === 'em_atendimento' },
  { label: 'Ouvidoria', match: (t) => t.categoria === 'Ouvidoria' },
  { label: 'Denúncia', match: (t) => t.categoria === 'Denúncia' },
  { label: 'Finalizadas', match: (t) => t.status === 'finalizada' },
];

// ── Avatar colors ───────────────────────────────────────────────────────
const avatarColors: Record<string, string> = {
  M: '#E8725C', J: '#7B61FF', A: '#F5A623', P: '#4A90D9', C: '#50C878',
};

// ── Metrics (loaded from Supabase inside component) ─────────────────────

// ── Clock SVG ───────────────────────────────────────────────────────────
const clockSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M12 6v6l4 2', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));

// ── Chevron down SVG ────────────────────────────────────────────────────
const chevronDownSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

export default function AtendimentosScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const currentUserId = session?.user?.id || '';
  const [meuSubtype, setMeuSubtype] = useState<string | null>(null);
  const [ticketReloadKey, setTicketReloadKey] = useState(0);
  const [meuCatActive, setMeuCatActive] = useState('Todos');
  /** Filtro de status na visão "Meu atendimento" (modal Filtrar status) — não confundir com categoria. */
  const [meuStatusFilter, setMeuStatusFilter] = useState('Todos');
  const [todosStatusActive, setTodosStatusActive] = useState('Todos');
  const [onlineStatus, setOnlineStatus] = useState<'Online' | 'Ausente' | 'Offline'>('Online');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  // Horário automático: 09h00-18h00 — atualiza disponibilidade ao abrir e a cada minuto
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId) return;
    const dbToUi: Record<string, 'Online' | 'Ausente' | 'Offline'> = { online: 'Online', away: 'Ausente', offline: 'Offline' };
    const applyAutoSchedule = () => {
      const hour = new Date().getHours();
      const autoStatus = (hour >= 9 && hour < 18) ? 'online' : 'offline';
      void (supabase as any).from('worker_profiles').select('availability').eq('id', currentUserId).maybeSingle()
        .then(({ data }: any) => {
          const current = data?.availability || 'online';
          // Atualizar automaticamente se está fora do horário e marcado como online, ou dentro e marcado como offline
          if ((hour >= 9 && hour < 18 && current === 'offline') || (!(hour >= 9 && hour < 18) && current === 'online')) {
            setOnlineStatus(dbToUi[autoStatus] || 'Online');
            void (supabase as any).rpc('update_admin_availability', { p_status: autoStatus });
          } else {
            setOnlineStatus(dbToUi[current] || 'Online');
          }
        });
    };
    applyAutoSchedule();
    const interval = setInterval(applyAutoSchedule, 60_000);
    return () => clearInterval(interval);
  }, [currentUserId]);
  const [filtrarStatusOpen, setFiltrarStatusOpen] = useState(false);
  const [filtrarStatusSelected, setFiltrarStatusSelected] = useState('Todos');
  const [meuAtendimentoDropdown, setMeuAtendimentoDropdown] = useState(false);
  const [meuAtendimentoLabel, setMeuAtendimentoLabel] = useState('Meu atendimento');

  // ── Real metrics from Supabase ──────────────────────────────────────
  const [realMetrics, setRealMetrics] = useState({ viagens: 0, motoristas: 0, cancelamentos: 0, encomendas: 0 });
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchViagemCounts(), fetchEncomendaCounts(), fetchMotoristas()]).then(([vc, ec, mots]) => {
      if (!cancelled) {
        setRealMetrics({
          viagens: vc.emAndamento,
          motoristas: mots.length,
          cancelamentos: vc.canceladas,
          encomendas: ec.emAndamento,
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId) return;
    let cancelled = false;
    (supabase as any).from('worker_profiles').select('subtype').eq('id', currentUserId).maybeSingle()
      .then(({ data }: { data: { subtype?: string } | null }) => {
        if (!cancelled) setMeuSubtype(data?.subtype ?? null);
      });
    return () => { cancelled = true; };
  }, [currentUserId]);

  // ── Real conversations from Supabase as tickets ─────────────────────
  const [realTickets, setRealTickets] = useState<Ticket[]>([]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (supabase as any)
      .from('conversations')
      .select('id, driver_id, client_id, status, participant_name, last_message, last_message_at, created_at, category, sla_deadline_at, admin_id, conversation_kind, context')
      .eq('conversation_kind', 'support_backoffice')
      .order('last_message_at', { ascending: false })
      .limit(80)
      .then(({ data, error }: { data: any[] | null; error: Error | null }) => {
        if (cancelled) return;
        if (error) console.error('[AtendimentosScreen] conversations query error:', error);
        if (error || !data) {
          setRealTickets([]);
          return;
        }
        const now = Date.now();
        const categoryLabelMap: Record<string, string> = {
          excursao: 'Excursão',
          encomendas: 'Encomendas',
          reembolso: 'Reembolso',
          cadastro_transporte: 'Cadastro de transporte',
          autorizar_menores: 'Autorizar menores',
          denuncia: 'Denúncia',
          ouvidoria: 'Ouvidoria',
          outros: 'Outros',
        };
        const tickets: Ticket[] = data.map((c: any) => {
          const name = c.participant_name || 'Usuário';
          const lastAt = new Date(c.last_message_at || c.created_at).getTime();
          const createdAt = new Date(c.created_at).getTime();
          const diffLastMsgMin = Math.floor((now - lastAt) / 60000);
          const tempo = diffLastMsgMin < 60
            ? `há ${diffLastMsgMin} min`
            : diffLastMsgMin < 1440
              ? `há ${Math.floor(diffLastMsgMin / 60)}h`
              : `há ${Math.floor(diffLastMsgMin / 1440)} dias`;
          // SLA 1 dia (sla_deadline_at preenchido na criação; fallback 24h desde abertura)
          const isOverSLA = c.sla_deadline_at
            ? now > new Date(c.sla_deadline_at).getTime()
            : now - createdAt > 24 * 60 * 60000;
          let ticketStatus: string;
          if (c.status !== 'active') {
            ticketStatus = 'finalizada';
          } else if (!c.admin_id) {
            ticketStatus = 'nao_atendida';
          } else if (isOverSLA) {
            ticketStatus = 'atrasada';
          } else {
            ticketStatus = 'em_atendimento';
          }
          return {
            id: String(c.id),
            nome: name,
            avatar: name.charAt(0).toUpperCase(),
            avatarUrl: null as string | null,
            categoria: categoryLabelMap[c.category || ''] || c.category || 'Outros',
            descricao: c.last_message || 'Sem mensagens',
            tempo,
            status: ticketStatus,
            adminId: c.admin_id ? String(c.admin_id) : null,
            rawCategory: String(c.category || 'outros'),
            _clientId: String(c.client_id || ''),
          };
        });
        // Fetch avatar_urls for all clients
        const clientIds = [...new Set(data.map((c: any) => c.client_id).filter(Boolean))];
        if (clientIds.length > 0) {
          (supabase as any).from('profiles').select('id, avatar_url').in('id', clientIds)
            .then(async ({ data: profiles }: any) => {
              if (cancelled || !profiles) { setRealTickets(tickets); return; }
              const avatarMap: Record<string, string> = {};
              for (const p of profiles) {
                if (p.avatar_url) {
                  const resolved = await resolveStorageDisplayUrl(supabase as any, p.avatar_url);
                  if (resolved) avatarMap[p.id] = resolved;
                }
              }
              if (cancelled) return;
              setRealTickets(tickets.map((t: any) => ({ ...t, avatarUrl: avatarMap[t._clientId] || null })));
            });
        } else {
          setRealTickets(tickets);
        }
      })
      .catch(() => { if (!cancelled) setRealTickets([]); });
    return () => { cancelled = true; };
  }, [ticketReloadKey]);

  const ticketsEscopoMeu = useMemo(() => {
    if (meuAtendimentoLabel !== 'Meu atendimento' || !currentUserId) return realTickets;
    return realTickets.filter((t) => t.adminId === currentUserId);
  }, [realTickets, meuAtendimentoLabel, currentUserId]);

  const activeMeuTickets = ticketsEscopoMeu.filter((t) => t.status !== 'finalizada');
  const activeTodosTickets = realTickets;

  const meuCategorias = useMemo(() => {
    const total = activeMeuTickets.length;
    return MEU_ATENDIMENTO_CATEGORIAS_CONFIG.map((row) => {
      if (row.matches == null) return { label: row.label, count: total };
      const set = new Set(row.matches);
      const count = activeMeuTickets.filter((t) => set.has(t.categoria)).length;
      return { label: row.label, count };
    });
  }, [activeMeuTickets]);

  const statusLabelToKey: Record<string, string> = {
    'Não atendida': 'nao_atendida',
    'Em atendimento': 'em_atendimento',
    Atrasada: 'atrasada',
    Finalizadas: 'finalizada',
  };

  const meuTicketsFiltered = useMemo(() => {
    let list = activeMeuTickets;
    if (meuCatActive !== 'Todos') {
      const row = MEU_ATENDIMENTO_CATEGORIAS_CONFIG.find((r) => r.label === meuCatActive);
      const allowed = row?.matches;
      if (allowed?.length) {
        const set = new Set(allowed);
        list = list.filter((t) => set.has(t.categoria));
      }
    }
    if (meuStatusFilter !== 'Todos') {
      const key = statusLabelToKey[meuStatusFilter];
      if (key) list = list.filter((t) => t.status === key);
    }
    return list;
  }, [activeMeuTickets, meuCatActive, meuStatusFilter]);

  /** Figma 1062:26998 — chips fixos na ordem do desenho. */
  const todosStatusChips = useMemo(() => {
    const all = activeTodosTickets;
    return TODOS_ATENDIMENTOS_CHIPS_CONFIG.map((row) => ({
      label: row.label,
      count: row.match == null ? all.length : all.filter(row.match).length,
    }));
  }, [activeTodosTickets]);

  const todosTicketsFiltered = useMemo(() => {
    if (todosStatusActive === 'Todos') return activeTodosTickets;
    const row = TODOS_ATENDIMENTOS_CHIPS_CONFIG.find((r) => r.label === todosStatusActive);
    if (!row?.match) return activeTodosTickets;
    return activeTodosTickets.filter(row.match);
  }, [activeTodosTickets, todosStatusActive]);

  const metrics = [
    { title: 'Viagens no momento', value: String(realMetrics.viagens || 0) },
    { title: 'Motoristas ativos', value: String(realMetrics.motoristas || 0) },
    { title: 'Cancelamentos (hoje)', value: String(realMetrics.cancelamentos || 0) },
    { title: 'Encomendas no momento', value: String(realMetrics.encomendas || 0) },
  ];

  /** Chip de categoria — Figma 1054:45062 / 1062:26998: inactivo = fundo transparente + badge preto; activo = pill preta + badge branco. */
  const categoryChipFigma = (label: string, count: number, active: boolean, onClick: () => void) =>
    React.createElement('button', {
      type: 'button',
      onClick,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 40,
        padding: '0 16px',
        borderRadius: 999,
        border: 'none',
        background: active ? '#0d0d0d' : 'transparent',
        color: active ? '#fff' : '#0d0d0d',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap' as const,
        boxSizing: 'border-box' as const,
        ...font,
      },
    },
      React.createElement('span', { style: { lineHeight: 1.5 } }, label),
      React.createElement('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 34,
          padding: '0 8px',
          height: 'auto',
          minHeight: 24,
          borderRadius: 16,
          background: active ? '#fff' : '#0d0d0d',
          color: active ? '#0d0d0d' : '#fff',
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.5,
          ...font,
        },
      }, String(count)));

  const podeAssumirTicket = (t: Ticket) =>
    !t.adminId
    && t.status !== 'finalizada'
    && (meuSubtype === 'admin' || meuSubtype === 'suporte' || (meuSubtype === 'financeiro' && t.categoria === 'Reembolso'));

  const claimTicket = async (t: Ticket, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!isSupabaseConfigured) return;
    const { error } = await (supabase as any).rpc('claim_support_conversation', { p_conversation_id: t.id });
    if (!error) setTicketReloadKey((k) => k + 1);
  };

  // ── Helper: ticket card ───────────────────────────────────────────────
  const ticketCard = (t: Ticket, idx: number) => {
    const st = statusMap[t.status] || statusMap.nao_atendida;
    const avatarBg = avatarColors[t.avatar] || '#999';
    const showAssumir = podeAssumirTicket(t);
    return React.createElement('div', {
      key: t.id || `${t.nome}-${idx}`,
      'data-testid': 'atendimento-ticket-row',
      style: {
        display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '20px 0',
        borderBottom: '1px solid #e2e2e2',
      },
    },
      // Status badge
      React.createElement('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
          padding: '4px 12px', borderRadius: 999, background: st.bg, color: st.color,
          fontSize: 13, fontWeight: 600, ...font,
        },
      },
        React.createElement('span', { style: { width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 } }),
        st.label),
      // Content row
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 } },
        // Left side
        React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 } },
          // Avatar
          t.avatarUrl
            ? React.createElement('img', {
                src: t.avatarUrl, alt: t.nome,
                style: { width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' as const, flexShrink: 0 },
              })
            : React.createElement('div', {
                style: {
                  width: 44, height: 44, borderRadius: '50%', background: avatarBg, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                },
              }, React.createElement('span', { style: { color: '#fff', fontSize: 18, fontWeight: 600, ...font } }, t.avatar)),
          // Info
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, minWidth: 0, flex: 1 } },
            // Name + category
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
              React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, t.nome),
              React.createElement('span', {
                style: {
                  padding: '2px 10px', borderRadius: 999, background: '#f1f1f1',
                  fontSize: 12, fontWeight: 500, color: '#0d0d0d', whiteSpace: 'nowrap' as const, ...font,
                },
              }, t.categoria)),
            // Description
            React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, ...font } }, t.descricao),
            // Time
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
              clockSvg,
              React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, t.tempo)))),
        // Ações
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
          showAssumir
            ? React.createElement('button', {
              type: 'button',
              onClick: (e: React.MouseEvent) => { void claimTicket(t, e); },
              style: {
                height: 44, padding: '0 20px', borderRadius: 999, border: '1px solid #cba04b',
                background: '#fff9e6', fontSize: 14, fontWeight: 600, color: '#654c01',
                cursor: 'pointer', whiteSpace: 'nowrap' as const, ...font,
              },
            }, 'Assumir')
            : null,
          React.createElement('button', {
            type: 'button',
            onClick: () => navigate(`/atendimentos/${t.id}`, { state: { ticket: t } }),
            style: {
              height: 44, padding: '0 24px', borderRadius: 999, border: '1px solid #0d0d0d',
              background: '#fff', fontSize: 14, fontWeight: 600, color: '#0d0d0d',
              cursor: 'pointer', whiteSpace: 'nowrap' as const, ...font,
            },
          }, 'Atender'))));
  };

  // ── Visão geral + Online status dropdown ────────────────────────────────
  const statusColors: Record<string, string> = { Online: '#22c55e', Ausente: '#e87a2e', Offline: '#767676' };
  const currentDot = statusColors[onlineStatus];

  const statusDropdown = statusDropdownOpen ? React.createElement('div', {
    style: {
      position: 'absolute' as const, top: 48, right: 0, background: '#fff', borderRadius: 16,
      boxShadow: '0 8px 30px rgba(0,0,0,0.15)', padding: '12px 0', minWidth: 260, zIndex: 50,
    },
  },
    // Horário automático
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', marginBottom: 4 },
    },
      React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
        React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#767676', strokeWidth: 2 }),
        React.createElement('path', { d: 'M12 6v6l4 2', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' })),
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Horário automático: 09h00-18h00')),
    // Options
    ...(['Online', 'Ausente', 'Offline'] as const).map((opt) =>
      React.createElement('button', {
        key: opt, type: 'button',
        onClick: () => {
          setOnlineStatus(opt);
          setStatusDropdownOpen(false);
          const dbMap: Record<string, string> = { Online: 'online', Ausente: 'away', Offline: 'offline' };
          void (supabase as any).rpc('update_admin_availability', { p_status: dbMap[opt] });
        },
        style: {
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 20px',
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
          color: statusColors[opt], ...font,
        },
      },
        React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: statusColors[opt] } }),
        opt))) : null;

  const headerRow = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  },
    React.createElement('h1', { style: { fontSize: 24, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Visão geral'),
    React.createElement('div', {
      style: { position: 'relative' as const },
    },
      React.createElement('div', {
        onClick: () => setStatusDropdownOpen(!statusDropdownOpen),
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px',
          border: '1px solid #e2e2e2', borderRadius: 999, cursor: 'pointer',
        },
      },
        React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: currentDot } }),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: currentDot, ...font } }, onlineStatus),
        chevronDownSvg),
      statusDropdown));

  // ── Metric cards ──────────────────────────────────────────────────────
  const metricCards = React.createElement('div', {
    style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const, width: '100%' },
  },
    ...metrics.map((m) =>
      React.createElement('div', {
        key: m.title,
        style: {
          flex: '1 1 0', minWidth: 0, background: '#f6f6f6', borderRadius: 16,
          padding: '20px 24px', display: 'flex', flexDirection: 'column' as const, gap: 16,
          boxSizing: 'border-box' as const,
        },
      },
        React.createElement('p', { style: { fontSize: 14, fontWeight: 500, color: '#767676', margin: 0, ...font } }, m.title),
        React.createElement('p', { style: { fontSize: 36, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, m.value))));

  // ── Meu atendimento section ───────────────────────────────────────────
  const meuAtendimentoHeader = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 },
  },
    React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Atendimentos'),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement('button', {
        type: 'button',
        onClick: () => { setFiltrarStatusSelected(meuStatusFilter); setFiltrarStatusOpen(true); },
        style: {
          height: 40, padding: '0 20px', borderRadius: 999, border: '1px solid #e2e2e2',
          background: '#fff', fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font,
        },
      }, 'Filtrar status'),
      React.createElement('div', { style: { position: 'relative' as const } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setMeuAtendimentoDropdown(!meuAtendimentoDropdown),
          style: {
            display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 16px',
            borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff',
            fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font,
          },
        }, meuAtendimentoLabel, chevronDownSvg),
        meuAtendimentoDropdown ? React.createElement('div', {
          style: {
            position: 'absolute' as const, top: 48, right: 0, background: '#fff', borderRadius: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)', minWidth: 220, zIndex: 50, overflow: 'hidden',
          },
        },
          ...['Meu atendimento', 'Atendimento geral'].map((opt, i) =>
            React.createElement('button', {
              key: opt, type: 'button',
              onClick: () => { setMeuAtendimentoLabel(opt); setMeuAtendimentoDropdown(false); },
              style: {
                display: 'block', width: '100%', padding: '14px 20px', background: 'none', border: 'none',
                borderBottom: i === 0 ? '1px solid #e2e2e2' : 'none',
                fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', textAlign: 'left' as const, ...font,
              },
            }, opt))) : null)));

  const meuCatChips = React.createElement('div', {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap' as const,
      alignItems: 'center',
    },
  },
    ...meuCategorias.map((c) =>
      categoryChipFigma(c.label, c.count, meuCatActive === c.label, () => setMeuCatActive(c.label))));

  const meuTicketCards = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, background: '#f6f6f6', borderRadius: 16, padding: '0 24px' },
  },
    meuTicketsFiltered.length === 0
      ? [React.createElement('p', {
          key: 'empty',
          style: { padding: '24px 0', fontSize: 14, color: '#767676', margin: 0, ...font },
        }, meuAtendimentoLabel === 'Meu atendimento'
          ? 'Nenhum atendimento atribuído a você nesta visão. Tickets por assumir ou já finalizados aparecem em “Todos atendimentos”.'
          : 'Nenhum atendimento nesta visão.')]
      : meuTicketsFiltered.map((t, i) => ticketCard(t, i)));

  const meuSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' },
  }, meuAtendimentoHeader, meuCatChips, meuTicketCards);

  // ── Todos atendimentos section ────────────────────────────────────────
  const todosHeader = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  },
    React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Atendimentos'),
    React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, ...font } }, 'SLA de 1 dia para marcar como atrasada'));

  const todosChips = React.createElement('div', {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap' as const,
      alignItems: 'center',
    },
  },
    ...todosStatusChips.map((c) =>
      categoryChipFigma(c.label, c.count, todosStatusActive === c.label, () => setTodosStatusActive(c.label))));

  const todosCards = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, background: '#f6f6f6', borderRadius: 16, padding: '0 24px' },
  },
    todosTicketsFiltered.length === 0
      ? [React.createElement('p', { key: 'empty-todos', style: { padding: '24px 0', fontSize: 14, color: '#767676', margin: 0, ...font } }, 'Nenhuma conversa listada.')]
      : todosTicketsFiltered.map((t, i) => ticketCard(t, i)));

  const todosSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' },
  }, todosHeader, todosChips, todosCards);

  // ── Separator ─────────────────────────────────────────────────────────
  const sep = React.createElement('div', { style: { height: 1, background: '#e2e2e2', width: '100%' } });

  // ── Filtrar status modal ──────────────────────────────────────────────
  const filtrarStatusOptions = ['Todos', 'Não atendida', 'Em atendimento', 'Atrasada'];
  const filtrarStatusModal = filtrarStatusOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setFiltrarStatusOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Alterar status'),
        React.createElement('button', {
          type: 'button', onClick: () => setFiltrarStatusOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Status label + chips
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Status'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
        ...filtrarStatusOptions.map((opt) =>
          React.createElement('button', {
            key: opt, type: 'button',
            onClick: () => setFiltrarStatusSelected(opt),
            style: {
              height: 36, padding: '0 16px', borderRadius: 999,
              border: filtrarStatusSelected === opt ? 'none' : '1px solid #e2e2e2',
              background: filtrarStatusSelected === opt ? '#0d0d0d' : '#fff',
              color: filtrarStatusSelected === opt ? '#fff' : '#0d0d0d',
              fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
            },
          }, opt))),
      // Buttons
      React.createElement('button', {
        type: 'button',
        onClick: () => { setMeuStatusFilter(filtrarStatusSelected); setFiltrarStatusOpen(false); },
        style: { height: 48, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
      }, 'Salvar alterações'),
      React.createElement('button', {
        type: 'button', onClick: () => setFiltrarStatusOpen(false),
        style: { height: 48, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
      }, 'Cancelar'))) : null;

  return React.createElement(React.Fragment, null,
    headerRow,
    metricCards,
    sep,
    meuSection,
    sep,
    todosSection,
    filtrarStatusModal);
}
