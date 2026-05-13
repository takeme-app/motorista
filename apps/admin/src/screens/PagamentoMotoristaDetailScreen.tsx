/**
 * Detalhe do motorista (trechos, métricas) — Figma 950-31018.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchMotoristas,
  findMotoristaIdByPaymentSlug,
  fetchMotoristaPaymentHeader,
  fetchPricingRoutes,
} from '../data/queries';
import type { MotoristaPaymentHeader } from '../data/queries';
import type { PricingRouteRow } from '../data/types';
import { webStyles } from '../styles/webStyles';
import { PAGAMENTOS_GESTAO_PREPARADORES_HREF } from '../constants/pagamentosGestaoNav';
import EditarTabelaTrechoModal, { TrechoData } from '../components/EditarTabelaTrechoModal';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

type TrechoMotRow = {
  pricingRouteId: string;
  idTrecho: string;
  origem: string;
  destino: string;
  valor: string;
  idaLinha1: string;
  idaLinha2: string;
  retLinha1: string;
  retLinha2: string;
  pctMotorista: string;
  pctAdmin: string;
};

type MotDetail = {
  nome: string;
  rating: number;
  pixChave: string;
  numRotas: number;
  mediaAval: string;
  ganhoMes: string;
  ganhoAno: string;
  totalMensal: string;
  lucroMedio: string;
  trechos: TrechoMotRow[];
};

function pricingToTrechoMotRow(r: PricingRouteRow): TrechoMotRow {
  const fmtMoney = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const created = r.created_at ? new Date(r.created_at) : null;
  const idaLinha1 = created ? `${created.toLocaleDateString('pt-BR')}, ` : '—, ';
  const idaLinha2 = created ? created.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  return {
    pricingRouteId: r.id,
    idTrecho: `#${r.id.slice(0, 6)}`,
    origem: (r.origin_address || '—').slice(0, 80),
    destino: (r.destination_address || '—').slice(0, 80),
    valor: fmtMoney(r.price_cents),
    idaLinha1,
    idaLinha2,
    retLinha1: '—',
    retLinha2: '—',
    pctMotorista: `${r.driver_pct ?? 0}%`,
    pctAdmin: `${r.admin_pct ?? 0}%`,
  };
}

const avatarColors: Record<string, string> = { C: '#50C878', J: '#7B61FF', E: '#4A90D9', M: '#F5A623', D: '#F5A623' };

// SVGs
const arrowLeftSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const plusSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const starSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: '#cba04b', style: { display: 'block' } },
  React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }));
const pixSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M14.8962 14.6368C14.5585 14.6376 14.2241 14.5715 13.9122 14.4423C13.6002 14.3132 13.317 14.1235 13.0787 13.8843L10.4537 11.2593C10.3607 11.1711 10.2375 11.1218 10.1093 11.1218C9.98112 11.1218 9.85785 11.1711 9.76492 11.2593L7.12992 13.8943C6.89172 14.1336 6.60846 14.3233 6.29649 14.4525C5.98453 14.5817 5.65006 14.6477 5.31242 14.6468H4.79492L8.11992 17.9718C9.15742 19.0093 10.8412 19.0093 11.8787 17.9718L15.2124 14.6368H14.8962ZM5.31242 5.35183C5.99992 5.35183 6.64492 5.61933 7.12992 6.10433L9.76492 8.73934C9.8102 8.78469 9.86398 8.82067 9.92318 8.84522C9.98238 8.86977 10.0458 8.88241 10.1099 8.88241C10.174 8.88241 10.2375 8.86977 10.2967 8.84522C10.3559 8.82067 10.4096 8.78469 10.4549 8.73934L13.0799 6.11434C13.318 5.87519 13.601 5.68556 13.9128 5.5564C14.2245 5.42724 14.5587 5.36112 14.8962 5.36183H15.2124L11.8787 2.02808C11.3801 1.52987 10.7041 1.25 9.9993 1.25C9.29447 1.25 8.61848 1.52987 8.11992 2.02808L4.79492 5.35308L5.31242 5.35183Z', fill: '#767676' }),
  React.createElement('path', { d: 'M17.9716 8.12141L15.9566 6.10641C15.9114 6.12498 15.863 6.13474 15.8141 6.13516H14.8979C14.4241 6.13516 13.9604 6.32766 13.6266 6.66266L11.0016 9.28766C10.8849 9.40501 10.7461 9.49813 10.5932 9.56168C10.4404 9.62522 10.2765 9.65793 10.111 9.65793C9.94545 9.65793 9.78156 9.62522 9.62871 9.56168C9.47587 9.49813 9.33709 9.40501 9.22035 9.28766L6.58535 6.65141C6.24729 6.31473 5.78996 6.12515 5.31285 6.12391H4.18785C4.14121 6.12354 4.09504 6.11464 4.0516 6.09766L2.0291 8.12141C0.991602 9.15891 0.991602 10.8427 2.0291 11.8814L4.0516 13.9039C4.09456 13.8866 4.14031 13.8773 4.1866 13.8764H5.31285C5.78785 13.8764 6.25035 13.6852 6.58535 13.3502L9.2191 10.7139C9.45942 10.4851 9.77853 10.3575 10.1104 10.3575C10.4422 10.3575 10.7613 10.4851 11.0016 10.7139L13.6266 13.3389C13.9604 13.6739 14.4241 13.8652 14.8979 13.8652H15.8141C15.8641 13.8652 15.9129 13.8777 15.9566 13.8952L17.9716 11.8802C19.0091 10.8427 19.0091 9.15891 17.9716 8.12141Z', fill: '#767676' }));
const locationSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('circle', { cx: 12, cy: 10, r: 3, stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const dollarSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#0d0d0d', strokeWidth: 2 }),
  React.createElement('path', { d: 'M12 6v12M9 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M9 14.5a2.5 2.5 0 005 0', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const breadcrumbChevronSvg = React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M9 18l6-6-6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const pencilRowSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const trashRowSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const TABLE_COMPACT_MAX_PX = 919;
const TABLE_FRAME_MIN_WIDTH = 900;

const colTrecho = [
  { label: 'ID do Trecho', w: 80, key: 'id' as const },
  { label: 'Origem', w: 100, key: 'o' as const },
  { label: 'Destino', w: 100, key: 'd' as const },
  { label: 'Valor', w: 72, key: 'v' as const, bold: true },
  { label: 'Data/\nHora Ida', w: 82, key: 'i' as const, multiline: true },
  { label: 'Data/\nHora Retorno', w: 82, key: 'r' as const, multiline: true },
  { label: '%\nMotorista', w: 56, key: 'm' as const, bold: true, multiline: true },
  { label: '%\nAdmin', w: 56, key: 'p' as const, bold: true, multiline: true },
  { label: 'Editar/Excluir', w: 96, key: 'a' as const, actions: true },
];

export default function PagamentoMotoristaDetailScreen() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [header, setHeader] = useState<MotoristaPaymentHeader | null>(null);
  const [trechos, setTrechos] = useState<TrechoMotRow[]>([]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      const list = await fetchMotoristas();
      if (cancel) return;
      const id = slug ? findMotoristaIdByPaymentSlug(slug, list) : null;
      if (!id) {
        setNotFound(true);
        setHeader(null);
        setTrechos([]);
        setLoading(false);
        return;
      }
      const [h, routes] = await Promise.all([
        fetchMotoristaPaymentHeader(id),
        fetchPricingRoutes('driver'),
      ]);
      if (cancel) return;
      setHeader(h);
      setTrechos(routes.map(pricingToTrechoMotRow));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [slug]);

  const detail: MotDetail = useMemo(() => ({
    nome: header?.nome ?? (slug ? slug.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Motorista'),
    rating: header?.rating ?? 0,
    pixChave: header?.pixChave ?? '—',
    numRotas: header?.numRotas ?? 0,
    mediaAval: header?.mediaAval ?? '—',
    ganhoMes: header?.ganhoMes ?? '—',
    ganhoAno: header?.ganhoAno ?? '—',
    totalMensal: header?.totalMensal ?? '—',
    lucroMedio: header?.lucroMedio ?? '—',
    trechos,
  }), [header, trechos, slug]);

  const initial = detail.nome.charAt(0);
  const avatarBg = avatarColors[initial] || '#999';

  const [editTrechoOpen, setEditTrechoOpen] = useState(false);
  const [editTrechoData, setEditTrechoData] = useState<TrechoData | null>(null);
  const fecharEditTrecho = useCallback(() => setEditTrechoOpen(false), []);
  const abrirEditTrecho = useCallback((row: TrechoMotRow) => {
    setEditTrechoData({
      origem: row.origem, destino: row.destino, valor: row.valor,
      dataHoraIda: `${row.idaLinha1}${row.idaLinha2}`.replace(/, $/, ' - ').replace(', ', ' - '),
      dataHoraRetorno: `${row.retLinha1}${row.retLinha2}`.replace(/, $/, ' - ').replace(', ', ' - '),
      pctMotorista: row.pctMotorista, pctAdmin: row.pctAdmin,
    });
    setEditTrechoOpen(true);
  }, []);

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const fecharConfirmRemove = useCallback(() => setConfirmRemoveOpen(false), []);
  const abrirConfirmRemove = useCallback(() => setConfirmRemoveOpen(true), []);
  const confirmarRemove = useCallback(() => setConfirmRemoveOpen(false), []);

  const [isCompactTable, setIsCompactTable] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${TABLE_COMPACT_MAX_PX}px)`).matches);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${TABLE_COMPACT_MAX_PX}px)`);
    const sync = () => setIsCompactTable(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  if (loading) {
    return React.createElement('div', { style: { padding: 40, ...font } }, 'Carregando…');
  }
  if (notFound) {
    return React.createElement('div', { style: { padding: 40, display: 'flex', flexDirection: 'column' as const, gap: 16, ...font } },
      React.createElement('p', { style: { margin: 0 } }, 'Motorista não encontrado para este URL.'),
      React.createElement('button', {
        type: 'button',
        onClick: () => navigate('/pagamentos/gestao?tab=Motorista'),
        style: { alignSelf: 'flex-start', cursor: 'pointer', padding: '8px 16px' },
      }, 'Voltar à gestão'));
  }

  // --- Breadcrumb ---
  const bcLink = (label: string, onClick: () => void) =>
    React.createElement('button', {
      type: 'button', onClick,
      style: { fontSize: 12, fontWeight: 600, color: '#767676', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', minHeight: 40, display: 'inline-flex', alignItems: 'center', textAlign: 'left' as const, ...font },
    }, label);

  const breadcrumb = React.createElement('nav', {
    'aria-label': 'Trilha de navegação',
    style: { ...webStyles.detailBreadcrumb, flexWrap: 'wrap' as const, rowGap: 8, columnGap: 4, width: '100%', alignItems: 'center' },
  },
    bcLink('Pagamentos', () => navigate('/pagamentos')),
    React.createElement('span', { style: { display: 'flex', alignItems: 'center', flexShrink: 0 } }, breadcrumbChevronSvg),
    bcLink('Percificação e porcentagem', () => navigate('/pagamentos/gestao')),
    React.createElement('span', { style: { display: 'flex', alignItems: 'center', flexShrink: 0 } }, breadcrumbChevronSvg),
    bcLink('Motorista', () => navigate('/pagamentos/gestao?tab=Motorista')),
    React.createElement('span', { style: { display: 'flex', alignItems: 'center', flexShrink: 0 } }, breadcrumbChevronSvg),
    React.createElement('span', { style: { ...webStyles.detailBreadcrumbCurrent, fontSize: 12, fontWeight: 600, ...font } }, 'Trechos'));

  // --- Actions bar ---
  const actionsRow = React.createElement('div', { style: { ...webStyles.detailToolbar, gap: 12 } },
    React.createElement('button', {
      type: 'button', onClick: () => navigate('/pagamentos/gestao?tab=Motorista'),
      style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, minWidth: 104, padding: '8px 24px', background: 'none', border: 'none', borderRadius: 999, fontSize: 14, fontWeight: 600, color: '#0d0d0d', cursor: 'pointer', ...font },
    }, arrowLeftSvg, 'Voltar'),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
      React.createElement('button', {
        type: 'button',
        onClick: () => navigate('/pagamentos/gestao/criar-trecho'),
        style: { display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px', background: '#0d0d0d', color: '#fff', border: 'none', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font },
      }, plusSvg, 'Criar novo trecho')));

  // --- Profile card ---
  const profileCard = React.createElement('div', {
    style: { background: '#f6f6f6', borderRadius: 12, padding: '24px 16px', width: '100%', boxSizing: 'border-box' as const },
  },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%', flexWrap: 'wrap' as const, rowGap: 20 },
    },
      // Left: avatar + name + badge
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, minWidth: 0 } },
        React.createElement('div', {
          style: { width: 80, height: 80, borderRadius: '50%', background: avatarBg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' as const },
        }, React.createElement('span', { style: { color: '#fff', fontSize: 28, fontWeight: 600, lineHeight: 1, userSelect: 'none' as const, ...font } }, initial)),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#cba04b', lineHeight: 1.5, ...font } }, 'Motorista TakeMe'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, detail.nome),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            starSvg,
            React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', ...font } }, detail.rating.toFixed(1))))),
      // Center: PIX
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, minWidth: 0 } },
        React.createElement('div', { style: { width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10, boxSizing: 'border-box' as const } }, pixSvg),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#767676', lineHeight: 1.5, ...font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, 'Chave PIX'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, detail.pixChave))),
      // Right: Número de Trechos
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, minWidth: 0 } },
        React.createElement('div', { style: { width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10, boxSizing: 'border-box' as const } }, locationSvg),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#767676', lineHeight: 1.5, ...font } }, 'Número de Trechos'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, `${detail.numRotas} rotas`)))));

  // --- Metric cards ---
  const metricCard = (title: string, value: string, suffix?: string) =>
    React.createElement('div', {
      style: { flex: '1 1 280px', minWidth: 0, border: '1px solid #e2e2e2', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column' as const, gap: 8, background: '#fff', boxSizing: 'border-box' as const },
    },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#0d0d0d', lineHeight: 1.5, ...font } }, title),
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
        React.createElement('span', { style: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', lineHeight: 1.2, ...font } }, value),
        suffix ? React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#767676', ...font } }, suffix) : null));

  const metricsRow = React.createElement('div', {
    style: { display: 'flex', gap: 16, width: '100%', flexWrap: 'wrap' as const },
  },
    metricCard('Média de avaliações', detail.mediaAval),
    metricCard('Média de ganho por mês', detail.ganhoMes),
    metricCard('Média de ganho por ano', detail.ganhoAno));

  // --- Total mensal bar ---
  const totalBar = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 12, background: '#f6f6f6', borderRadius: 12, padding: '16px 20px', width: '100%', boxSizing: 'border-box' as const },
  },
    React.createElement('div', { style: { width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, dollarSvg),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, 'Total mensal estimado:'),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#cba04b', lineHeight: 1.5, ...font } }, detail.totalMensal)),
      React.createElement('span', { style: { fontSize: 12, fontWeight: 400, color: '#767676', lineHeight: 1.5, ...font } }, `Lucro médio: ${detail.lucroMedio}`)));

  // --- Table ---
  const headerCell = (text: string, w: number, opts?: { multiline?: boolean; alignEnd?: boolean }) =>
    React.createElement('div', {
      key: text + w,
      style: { width: w, minWidth: w, flex: '0 0 auto', fontSize: 12, fontWeight: 400, color: '#0d0d0d', padding: opts?.alignEnd ? '0 0 0 8px' : '0 8px', lineHeight: 1.5, display: 'flex', alignItems: 'center', justifyContent: opts?.alignEnd ? 'flex-end' : 'flex-start', height: '100%', whiteSpace: opts?.multiline ? 'pre-line' as const : 'nowrap' as const, boxSizing: 'border-box' as const, ...font },
    }, text);

  const tableHeader = React.createElement('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', height: 53, minHeight: 53, maxHeight: 53, background: '#e2e2e2', borderBottom: '1px solid #d9d9d9', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const },
  }, ...colTrecho.map(c => headerCell(c.label, c.w, { multiline: c.multiline, alignEnd: !!c.actions })));

  const cellEl = (children: React.ReactNode, w: number, opts?: { bold?: boolean; medium?: boolean; multiline?: boolean }) =>
    React.createElement('div', {
      style: { width: w, minWidth: w, flex: '0 0 auto', fontSize: 14, fontWeight: opts?.bold || opts?.medium ? 500 : 400, color: '#0d0d0d', padding: '0 8px', display: 'flex', alignItems: 'center', lineHeight: 1.5, whiteSpace: opts?.multiline ? 'pre-line' as const : 'nowrap' as const, boxSizing: 'border-box' as const, ...font },
    }, children);

  const rowEl = (row: TrechoMotRow, idx: number) =>
    React.createElement('div', {
      key: idx,
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 88, minHeight: 88, padding: '0 16px', borderBottom: '1px solid #d9d9d9', background: '#f6f6f6', width: '100%', boxSizing: 'border-box' as const },
    },
      cellEl(row.idTrecho, 80),
      cellEl(row.origem, 100),
      cellEl(row.destino, 100),
      cellEl(row.valor, 72, { bold: true }),
      cellEl(React.createElement(React.Fragment, null, row.idaLinha1, React.createElement('br'), row.idaLinha2), 82, { multiline: true }),
      cellEl(React.createElement(React.Fragment, null, row.retLinha1, React.createElement('br'), row.retLinha2), 82, { multiline: true }),
      cellEl(row.pctMotorista, 56, { bold: true }),
      cellEl(row.pctAdmin, 56, { bold: true }),
      React.createElement('div', {
        style: { width: 96, minWidth: 96, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: 0, boxSizing: 'border-box' as const },
      },
        React.createElement('button', { type: 'button', onClick: () => abrirEditTrecho(row), style: webStyles.viagensActionBtn, 'aria-label': 'Editar' }, pencilRowSvg),
        React.createElement('button', { type: 'button', onClick: () => abrirConfirmRemove(), style: webStyles.viagensActionBtn, 'aria-label': 'Excluir' }, trashRowSvg)));

  // Compact card for mobile
  const compactField = (label: string, value: React.ReactNode) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, minWidth: 0 } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 400, color: '#767676', lineHeight: 1.5, ...font } }, label),
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', lineHeight: 1.5, wordBreak: 'break-word' as const, ...font } }, value));

  const compactTrechoCard = (row: TrechoMotRow, idx: number) =>
    React.createElement('div', {
      key: `compact-${idx}`,
      style: { borderRadius: 12, padding: 16, background: '#f6f6f6', border: '1px solid #d9d9d9', display: 'flex', flexDirection: 'column' as const, gap: 14, width: '100%', boxSizing: 'border-box' as const },
    },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px 16px', width: '100%' } },
        compactField('ID do Trecho', row.idTrecho),
        compactField('Origem', row.origem),
        compactField('Destino', row.destino),
        compactField('Valor', row.valor),
        compactField('Data/Hora Ida', React.createElement(React.Fragment, null, row.idaLinha1, React.createElement('br'), row.idaLinha2)),
        compactField('Data/Hora Retorno', React.createElement(React.Fragment, null, row.retLinha1, React.createElement('br'), row.retLinha2)),
        compactField('% Motorista', row.pctMotorista),
        compactField('% Admin', row.pctAdmin)),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid #d9d9d9' } },
        React.createElement('button', { type: 'button', onClick: () => abrirEditTrecho(row), style: webStyles.viagensActionBtn, 'aria-label': 'Editar' }, pencilRowSvg),
        React.createElement('button', { type: 'button', onClick: () => abrirConfirmRemove(), style: webStyles.viagensActionBtn, 'aria-label': 'Excluir' }, trashRowSvg)));

  const tableSectionInner = isCompactTable
    ? React.createElement('div', { role: 'region', 'aria-label': 'Lista de trechos', style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%', padding: 16, boxSizing: 'border-box' as const } }, ...detail.trechos.map((r, i) => compactTrechoCard(r, i)))
    : React.createElement('div', { role: 'region', 'aria-label': 'Lista de trechos', style: { width: '100%', overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const } },
        React.createElement('div', { style: { minWidth: TABLE_FRAME_MIN_WIDTH, width: '100%', boxSizing: 'border-box' as const } },
          tableHeader,
          ...detail.trechos.map((r, i) => rowEl(r, i))));

  const tableSection = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, width: '100%', minWidth: 0 } },
    React.createElement('div', { style: { background: '#fff', borderRadius: 16, width: '100%', overflow: 'hidden', boxSizing: 'border-box' as const } },
      tableSectionInner));

  // --- Page top ---
  const pageTop = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%', minWidth: 0, paddingBottom: 8, borderBottom: '1px solid #e2e2e2', marginBottom: 0 },
  }, breadcrumb, actionsRow);

  // --- Confirm remove modal ---
  const confirmRemoveModal = confirmRemoveOpen
    ? React.createElement('div', {
        role: 'dialog', 'aria-modal': true,
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const },
        onClick: fecharConfirmRemove,
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column' as const, gap: 24, padding: '24px 0', boxSizing: 'border-box' as const },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
              React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, maxWidth: 316, ...font } }, 'Tem certeza que deseja remover esta tabela?'),
              React.createElement('button', {
                type: 'button', onClick: fecharConfirmRemove, 'aria-label': 'Fechar',
                style: { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }))))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('button', { type: 'button', onClick: confirmarRemove, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838', fontSize: 16, fontWeight: 600, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Remover'),
            React.createElement('button', { type: 'button', onClick: fecharConfirmRemove, style: { width: '100%', height: 48, borderRadius: 8, border: 'none', background: 'none', color: '#0d0d0d', fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font } }, 'Voltar'))))
    : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: { ...webStyles.detailPage, width: '100%', minWidth: 0 } },
      pageTop,
      profileCard,
      metricsRow,
      totalBar,
      tableSection),
    React.createElement(EditarTabelaTrechoModal, { open: editTrechoOpen, onClose: fecharEditTrecho, trecho: editTrechoData }),
    confirmRemoveModal);
}
