/**
 * EncomendaDetalheScreen — Detalhe só leitura da encomenda (valores, remetente, rota).
 * A viagem agendada no mapa fica em link separado para ViagemDetalheScreen.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { webStyles } from '../styles/webStyles';
import { fetchEncomendaEditDetail, formatCurrencyBRL } from '../data/queries';
import type { EncomendaEditDetail } from '../data/types';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pendente de análise',
  confirmed: 'Confirmada',
  in_progress: 'Em andamento',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
};

function statusLabel(status: string): string {
  return SHIPMENT_STATUS_LABEL[status] || status || '—';
}

function packageSizeLabel(ps: string): string {
  const p = (ps || '').toLowerCase();
  if (p === 'pequeno' || p === 'small') return 'Pequeno';
  if (p === 'medio' || p === 'medium' || p === 'médio') return 'Médio';
  if (p === 'grande' || p === 'large' || p === 'xl') return 'Grande';
  return ps || '—';
}

const readRow = (label: string, value: string) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, label),
    React.createElement('div', {
      style: {
        minHeight: 44, borderRadius: 8, background: '#f6f6f6', padding: '0 16px', display: 'flex', alignItems: 'center',
        fontSize: 14, color: '#0d0d0d', ...font,
      },
    }, value));

const mapPinSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', {
    d: 'M12 21s7-4.35 7-10a7 7 0 10-14 0c0 5.65 7 10 7 10z',
    stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  }),
  React.createElement('circle', { cx: 12, cy: 11, r: 2.5, stroke: '#0d0d0d', strokeWidth: 2 }));

export default function EncomendaDetalheScreen() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<EncomendaEditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) {
      setLoading(false);
      setLoadErr('ID inválido.');
      return;
    }
    let cancel = false;
    setLoading(true);
    setLoadErr(null);
    fetchEncomendaEditDetail(routeId).then((d) => {
      if (cancel) return;
      if (!d) {
        setDetail(null);
        setLoadErr('Encomenda não encontrada.');
        setLoading(false);
        return;
      }
      setDetail(d);
      setLoading(false);
    });
    return () => { cancel = true; };
  }, [routeId]);

  const breadcrumb = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#767676', ...font },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => navigate('/encomendas'),
      style: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: '#767676' },
    }, 'Encomendas'),
    React.createElement('span', null, '›'),
    React.createElement('span', { style: { color: '#0d0d0d' } }, 'Detalhe da encomenda'));

  const backBtn = React.createElement('button', {
    type: 'button',
    onClick: () => navigate(-1),
    style: {
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 104, height: 44, padding: '8px 24px',
      background: 'transparent', border: 'none', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font, alignSelf: 'flex-start',
    },
  },
    React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
      React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
    'Voltar');

  if (loading) {
    return React.createElement('div', { style: { ...webStyles.detailPage, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      breadcrumb, backBtn,
      React.createElement('p', { style: { ...font, color: '#767676' } }, 'Carregando…'));
  }

  if (loadErr || !detail) {
    return React.createElement('div', { style: { ...webStyles.detailPage, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      breadcrumb, backBtn,
      React.createElement('p', { style: { ...font, color: '#b53838' } }, loadErr ?? 'Encomenda não encontrada.'));
  }

  const tripId = detail.kind === 'shipment' ? detail.scheduledTripId : null;
  const tripBtn = tripId
    ? React.createElement('button', {
      type: 'button',
      onClick: () => navigate(`/encomendas/${detail.id}/viagem/${tripId}`),
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 20px',
        borderRadius: 999, border: '1px solid #0d0d0d', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font,
      },
    }, mapPinSvg, 'Ver viagem no mapa')
    : null;

  const editBtn = React.createElement('button', {
    type: 'button',
    onClick: () => navigate(`/encomendas/${detail.id}/editar`, { state: { from: 'encomendas' } }),
    style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 44, padding: '0 24px',
      borderRadius: 999, border: 'none', background: '#0d0d0d', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#fff', ...font,
    },
  }, 'Editar');

  const actions = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 12, alignItems: 'center' } },
    editBtn,
    tripBtn);

  const mainCard = detail.kind === 'shipment'
    ? React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 24, borderRadius: 16,
        border: '1px solid #efefef', background: '#fff', boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.04)', maxWidth: 720,
      },
    },
      React.createElement('h1', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Resumo da encomenda'),
      readRow('Status', statusLabel(detail.status)),
      readRow('Valor', formatCurrencyBRL(detail.amountCents)),
      readRow('Tamanho do pacote', packageSizeLabel(detail.packageSize)),
      readRow('Remetente (cliente)', detail.senderName),
      readRow('Destinatário', detail.recipientName || '—'),
      readRow('Telefone destinatário', detail.recipientPhone || '—'),
      readRow('E-mail destinatário', detail.recipientEmail || '—'),
      readRow('Origem', detail.originAddress || '—'),
      readRow('Destino', detail.destinationAddress || '—'),
      readRow('Quando', detail.whenOption || '—'),
      readRow('Instruções', (detail.instructions && detail.instructions.trim()) ? detail.instructions : '—'),
      detail.tripDepartureAt || detail.tripArrivalAt
        ? readRow(
          'Horários da viagem vinculada',
          `${detail.tripDepartureAt ? new Date(detail.tripDepartureAt).toLocaleString('pt-BR') : '—'} → ${detail.tripArrivalAt ? new Date(detail.tripArrivalAt).toLocaleString('pt-BR') : '—'}`,
        )
        : null)
    : React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 24, borderRadius: 16,
        border: '1px solid #efefef', background: '#fff', boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.04)', maxWidth: 720,
      },
    },
      React.createElement('h1', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Envio de dependente'),
      readRow('Status', statusLabel(detail.status)),
      readRow('Valor', formatCurrencyBRL(detail.amountCents)),
      readRow('Nome completo', detail.fullName),
      readRow('Telefone', detail.contactPhone || '—'),
      readRow('Recebedor', detail.receiverName || '—'),
      readRow('Origem', detail.originAddress || '—'),
      readRow('Destino', detail.destinationAddress || '—'),
      readRow('Quando', detail.whenOption || '—'),
      readRow('Instruções', (detail.instructions && detail.instructions.trim()) ? detail.instructions : '—'));

  return React.createElement('div', {
    style: { ...webStyles.detailPage, display: 'flex', flexDirection: 'column' as const, gap: 20 },
  },
    breadcrumb,
    backBtn,
    actions,
    mainCard);
}
