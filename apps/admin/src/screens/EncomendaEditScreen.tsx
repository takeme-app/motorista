/**
 * EncomendaEditScreen — Editar encomenda conforme Figma 849-37300.
 * Secção motoristas: Figma 1283-34111.
 * Mapa e dados alinhados ao detalhe da viagem (roteiro, coords reais, perfis).
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchApprovedDriversForEncomendaUI,
  fetchEncomendaEditDetail,
  fetchShipmentsForScheduledTrip,
  formatCurrencyBRL,
  updateDependentShipmentFields,
  updateScheduledTripFields,
  updateShipmentFields,
} from '../data/queries';
import type { EncomendaEditDetail, TripShipmentListItem } from '../data/types';
import MapView from '../components/MapView';
import { ShipmentHandoffPinsBlock } from '../components/ShipmentHandoffPinsBlock';
import PlacesAddressInput from '../components/PlacesAddressInput';
import { DETAIL_TRIP_MAP_HEIGHT, webStyles } from '../styles/webStyles';
import { useTripStops } from '../hooks/useTripStops';
import { useEncomendaMapCoords } from '../hooks/useEncomendaMapCoords';
import { geocodeAddress } from '../lib/googleGeocoding';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };
const encomendaPlacesInputStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  background: '#f1f1f1',
  border: 'none',
  borderRadius: 8,
  paddingLeft: 16,
  fontSize: 14,
  color: '#0d0d0d',
  outline: 'none',
  boxSizing: 'border-box',
  ...font,
};
const encomendaFieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' };
const encomendaLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font };

const driverWaitingAsset = require('../../assets/driver-waiting.png');
const logoTakeMeBadge = require('../../assets/motoristas/logo-takeme.png');

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pendente de análise',
  confirmed: 'Confirmada',
  in_progress: 'Em andamento',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
};

function shipmentStatusLabel(status: string): string {
  return SHIPMENT_STATUS_LABEL[status] || status || '—';
}

function packageSizeLabel(ps: string): string {
  if (ps === 'pequeno') return 'Pequeno';
  if (ps === 'medio') return 'Médio';
  if (ps === 'grande') return 'Grande';
  return ps || '—';
}

type MotoristaBadge = 'takeme' | 'parceiro';

type MotoristaDisponivel = {
  id: string;
  nome: string;
  nota: number;
  viagensTexto: string;
  badge: MotoristaBadge;
  avatarUrl: string | null;
  rota: string;
  data: string;
  horaSaida: string;
  valorTotal: string;
  valorUnitario: string;
  pessoasRestantes: string;
  bagageiro: string;
};

const arrowBackSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const xSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round' }));
const checkSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const infoSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#cba04b', strokeWidth: 2 }),
  React.createElement('path', { d: 'M12 16v-4M12 8h.01', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round' }));
const headphoneSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M3 18v-6a9 9 0 0118 0v6', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const calendarSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const calendarSvgLg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
const starSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: '#cba04b', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }));
const motoristaLinha = (rotulo: string, valor: string) =>
  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, width: '100%', minWidth: 0 } },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', flexShrink: 0, lineHeight: 1.5, ...font } }, rotulo),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', textAlign: 'right' as const, lineHeight: 1.5, minWidth: 0, wordBreak: 'break-word' as const, ...font } }, valor));

const radioMotorista = (selecionado: boolean, onClick: () => void) =>
  React.createElement('button', {
    type: 'button',
    onClick,
    'aria-pressed': selecionado,
    'aria-label': selecionado ? 'Motorista selecionado' : 'Selecionar motorista',
    style: {
      width: 40,
      height: 40,
      padding: 0,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
    React.createElement('span', {
      style: {
        width: 22,
        height: 22,
        borderRadius: '50%',
        border: `2px solid ${selecionado ? '#0d0d0d' : '#9a9a9a'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box' as const,
      },
    }, selecionado ? React.createElement('span', { style: { width: 12, height: 12, borderRadius: '50%', background: '#0d0d0d' } }) : null));

const badgeMotorista = (tipo: MotoristaBadge) => {
  if (tipo === 'parceiro') {
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', background: '#fff', padding: '4px 8px', borderRadius: 90 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, whiteSpace: 'nowrap' as const, ...font } }, 'Motorista Parceiro'));
  }
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, background: '#fff', padding: '4px 8px', borderRadius: 90 } },
    React.createElement('img', { src: logoTakeMeBadge, alt: '', style: { width: 16, height: 16, objectFit: 'cover', flexShrink: 0 } }),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, whiteSpace: 'nowrap' as const, ...font } }, 'Motorista TakeMe'));
};

const cartaoMotorista = (m: MotoristaDisponivel, selecionado: boolean, onSelect: () => void) => {
  const w = 56;
  const h = 56;
  const inicial = (m.nome || '?').trim().charAt(0).toUpperCase() || '?';
  const avatarBlock = m.avatarUrl
    ? React.createElement('img', {
      src: m.avatarUrl,
      alt: '',
      style: { width: w, height: h, borderRadius: 9999, objectFit: 'cover', display: 'block' },
    })
    : React.createElement('div', {
      style: {
        width: w,
        height: h,
        borderRadius: 9999,
        background: '#e2e2e2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        fontWeight: 700,
        color: '#545454',
        ...font,
      },
    }, inicial);
  const blocoNota = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: '4px 8px', alignItems: 'center' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
      starSvg,
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', ...font } }, String(m.nota))),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 400, color: '#767676', ...font } }, m.viagensTexto));
  const colunaTexto = React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' } },
      badgeMotorista(m.badge),
      radioMotorista(selecionado, onSelect)),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, m.nome),
      blocoNota));
  const cabecalho = React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 12, width: '100%' } },
    React.createElement('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-start', width: '100%', minWidth: 0 } },
      React.createElement('div', { style: { flexShrink: 0 } }, avatarBlock),
      colunaTexto));
  const detalhes = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%' } },
    motoristaLinha('Origem - Destino', m.rota),
    motoristaLinha('Data', m.data),
    motoristaLinha('Hora de saída', m.horaSaida),
    motoristaLinha('Valor total', m.valorTotal),
    motoristaLinha('Valor unitário', m.valorUnitario),
    motoristaLinha('Pessoas restantes', m.pessoasRestantes),
    motoristaLinha('Ocupação do bagageiro', m.bagageiro));
  return React.createElement('div', {
    key: m.id,
    style: {
      flex: '1 1 calc(50% - 8px)',
      minWidth: 280,
      boxSizing: 'border-box' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 12,
      padding: '24px 16px',
      borderRadius: 12,
      background: '#f6f6f6',
      border: selecionado ? '2px solid #0d0d0d' : '2px solid transparent',
    },
  }, cabecalho, detalhes);
};

const readField = (label: string, value: string) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
    React.createElement('div', { style: { height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font } }, value));

const editField = (label: string, value: string, onChange: (v: string) => void) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
    React.createElement('input', {
      type: 'text',
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      style: {
        height: 44, borderRadius: 8, background: '#f1f1f1', border: 'none', padding: '0 16px', fontSize: 14, color: '#0d0d0d',
        width: '100%', boxSizing: 'border-box' as const, ...font,
      },
    }));

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const encomendaCard = (lead: React.ReactNode, tamanho: string, valor: string, remetente: string, destinatario: string, recolha: string, entrega: string, obs: string) =>
  React.createElement('div', {
    style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, padding: 20, border: '1px solid #e2e2e2', borderRadius: 16, background: '#fff', alignItems: 'flex-start' },
  },
    React.createElement('div', { style: { flexShrink: 0 } }, lead),
    React.createElement('div', { style: { flex: 1, minWidth: 200, display: 'flex', flexWrap: 'wrap' as const, gap: '12px 24px' } },
      React.createElement('div', null,
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Tamanho:'),
        React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, tamanho)),
      React.createElement('div', null,
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Valor:'),
        React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, valor)),
      React.createElement('div', null,
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Remetente:'),
        React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, remetente)),
      React.createElement('div', null,
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Destinatário:'),
        React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, destinatario)),
      React.createElement('div', { style: { width: '100%', display: 'flex', gap: 24, flexWrap: 'wrap' as const } },
        React.createElement('div', null,
          React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Recolha:'),
          React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, recolha)),
        React.createElement('div', null,
          React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Entrega'),
          React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, entrega)),
        React.createElement('div', null,
          React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Observações:'),
          React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, obs)))),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#faf5eb' } }, headphoneSvg));

export default function EncomendaEditScreen() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<EncomendaEditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [originCoord, setOriginCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [destinationCoord, setDestinationCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [lastResolvedOrigin, setLastResolvedOrigin] = useState('');
  const [lastResolvedDestination, setLastResolvedDestination] = useState('');
  const [instructions, setInstructions] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [packageSize, setPackageSize] = useState('');
  const [whenOption, setWhenOption] = useState('');
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [bagsCount, setBagsCount] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');

  const [motoristas, setMotoristas] = useState<MotoristaDisponivel[]>([]);
  const [motoristaSelecionado, setMotoristaSelecionado] = useState('');
  const motoristaTripSyncKeyRef = useRef<string>('');

  const scheduledTripId = detail?.kind === 'shipment' ? detail.scheduledTripId : null;
  const { waypoints: tripWaypoints, stops: tripStops, regenerate: regenerateStops } = useTripStops(scheduledTripId);

  // Encomendas da mesma viagem (PINs por envio) — espelha a seção "Encomendas" da ViagemDetalhe.
  const [linkedShipments, setLinkedShipments] = useState<TripShipmentListItem[]>([]);
  useEffect(() => {
    if (!scheduledTripId) {
      setLinkedShipments([]);
      return;
    }
    let cancelled = false;
    void fetchShipmentsForScheduledTrip(scheduledTripId).then((list) => {
      if (!cancelled) setLinkedShipments(list);
    });
    return () => { cancelled = true; };
  }, [scheduledTripId]);

  const coordsMatchSavedAddresses =
    !!detail
    && origem === detail.originAddress
    && destino === detail.destinationAddress;

  const mapCoordsInput = useMemo(() => {
    if (!detail) return null;
    const oLat = originCoord?.lat ?? (coordsMatchSavedAddresses ? detail.originLat : null);
    const oLng = originCoord?.lng ?? (coordsMatchSavedAddresses ? detail.originLng : null);
    const dLat = destinationCoord?.lat ?? (coordsMatchSavedAddresses ? detail.destinationLat : null);
    const dLng = destinationCoord?.lng ?? (coordsMatchSavedAddresses ? detail.destinationLng : null);
    return {
      scheduledTripId: detail.kind === 'shipment' ? detail.scheduledTripId : null,
      originLat: oLat,
      originLng: oLng,
      destinationLat: dLat,
      destinationLng: dLng,
      originAddress: origem,
      destinationAddress: destino,
    };
  }, [detail, coordsMatchSavedAddresses, origem, destino, originCoord, destinationCoord]);

  const encomendaMapCoords = useEncomendaMapCoords(mapCoordsInput);

  const driverStartCoord = useMemo(() => {
    const d = tripStops.find((s) => s.stop_type === 'driver_origin' && s.lat != null && s.lng != null);
    if (d) return { lat: d.lat!, lng: d.lng! };
    if (encomendaMapCoords.vehicleOrigin) return encomendaMapCoords.vehicleOrigin;
    return undefined;
  }, [tripStops, encomendaMapCoords.vehicleOrigin]);

  const tripPainelEncerrado =
    !!detail
    && (detail.status === 'delivered' || detail.status === 'cancelled');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!routeId) {
      setLoading(false);
      setLoadErr('ID inválido.');
      return;
    }
    setLoading(true);
    setLoadErr(null);
    motoristaTripSyncKeyRef.current = '';
    fetchEncomendaEditDetail(routeId).then((d) => {
      if (!d) {
        setDetail(null);
        setLoadErr('Encomenda não encontrada.');
        setLoading(false);
        return;
      }
      setDetail(d);
      setOrigem(d.originAddress);
      setDestino(d.destinationAddress);
      setLastResolvedOrigin(d.originAddress);
      setLastResolvedDestination(d.destinationAddress);
      setOriginCoord(
        d.originLat != null && d.originLng != null ? { lat: d.originLat, lng: d.originLng } : null,
      );
      setDestinationCoord(
        d.destinationLat != null && d.destinationLng != null
          ? { lat: d.destinationLat, lng: d.destinationLng }
          : null,
      );
      setInstructions(d.instructions ?? '');
      setWhenOption(d.whenOption);
      setScheduledLocal(toDatetimeLocalValue(d.scheduledAt));
      if (d.kind === 'shipment') {
        setRecipientName(d.recipientName);
        setRecipientPhone(d.recipientPhone);
        setRecipientEmail(d.recipientEmail);
        setPackageSize(d.packageSize);
      } else {
        setFullName(d.fullName);
        setContactPhone(d.contactPhone);
        setReceiverName(d.receiverName ?? '');
        setBagsCount(String(d.bagsCount ?? 0));
      }
      setLoading(false);
    });
  }, [routeId]);

  useEffect(() => {
    fetchApprovedDriversForEncomendaUI().then((list) => {
      const ui: MotoristaDisponivel[] = list.map((d) => ({
        id: d.id,
        nome: d.nome,
        nota: Number(d.rating ?? 0),
        viagensTexto: `(${d.totalViagens} viagens)`,
        badge: d.isPartner ? 'parceiro' : 'takeme',
        avatarUrl: d.avatarUrl,
        rota: '—',
        data: '—',
        horaSaida: '—',
        valorTotal: '—',
        valorUnitario: '—',
        pessoasRestantes: '—',
        bagageiro: '—',
      }));
      setMotoristas(ui);
    });
  }, []);

  useEffect(() => {
    if (motoristas.length === 0) {
      setMotoristaSelecionado('');
      return;
    }
    if (!detail) return;
    const tripKey =
      detail.kind === 'shipment'
        ? `${detail.id}:${detail.tripDriverId ?? ''}:${detail.scheduledTripId ?? ''}`
        : `${detail.id}:dependent`;
    const tripDriverChanged = motoristaTripSyncKeyRef.current !== tripKey;
    motoristaTripSyncKeyRef.current = tripKey;

    if (
      tripDriverChanged
      && detail.kind === 'shipment'
      && detail.tripDriverId
      && motoristas.some((m) => m.id === detail.tripDriverId)
    ) {
      setMotoristaSelecionado(detail.tripDriverId);
      return;
    }
    if (tripDriverChanged) {
      setMotoristaSelecionado((prev) => (
        prev && motoristas.some((m) => m.id === prev) ? prev : (motoristas[0]?.id ?? '')
      ));
    }
  }, [detail, motoristas]);

  const save = useCallback(async () => {
    if (!detail) return;
    if (tripPainelEncerrado) {
      setToast('Encomenda encerrada — não é possível alterar.');
      return;
    }
    const schedIso = scheduledLocal ? new Date(scheduledLocal).toISOString() : null;

    let oLat = originCoord?.lat ?? null;
    let oLng = originCoord?.lng ?? null;
    let dLat = destinationCoord?.lat ?? null;
    let dLng = destinationCoord?.lng ?? null;
    if ((oLat == null || oLng == null) && origem.trim() === detail.originAddress.trim()) {
      oLat = detail.originLat;
      oLng = detail.originLng;
    }
    if ((dLat == null || dLng == null) && destino.trim() === detail.destinationAddress.trim()) {
      dLat = detail.destinationLat;
      dLng = detail.destinationLng;
    }
    if (oLat == null || oLng == null) {
      const g = await geocodeAddress(origem);
      if (g) {
        oLat = g.lat;
        oLng = g.lng;
      }
    }
    if (dLat == null || dLng == null) {
      const g = await geocodeAddress(destino);
      if (g) {
        dLat = g.lat;
        dLng = g.lng;
      }
    }
    if (oLat == null || oLng == null || dLat == null || dLng == null) {
      setToast(
        'Não foi possível obter coordenadas de origem e destino. Escolha um endereço nas sugestões do Google ou configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.',
      );
      return;
    }

    setSaving(true);
    let res: { error: string | null };
    if (detail.kind === 'shipment') {
      res = await updateShipmentFields(detail.id, {
        origin_address: origem,
        origin_lat: oLat,
        origin_lng: oLng,
        destination_address: destino,
        destination_lat: dLat,
        destination_lng: dLng,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        recipient_email: recipientEmail,
        package_size: packageSize,
        when_option: whenOption,
        instructions: instructions || null,
        scheduled_at: schedIso,
      });
    } else {
      res = await updateDependentShipmentFields(detail.id, {
        origin_address: origem,
        origin_lat: oLat,
        origin_lng: oLng,
        destination_address: destino,
        destination_lat: dLat,
        destination_lng: dLng,
        full_name: fullName,
        contact_phone: contactPhone,
        receiver_name: receiverName || null,
        when_option: whenOption,
        instructions: instructions || null,
        bags_count: Number(bagsCount) || 0,
        scheduled_at: schedIso,
      });
    }
    if (res.error) {
      setSaving(false);
      setToast(res.error);
      return;
    }

    const tripId = detail.kind === 'shipment' ? detail.scheduledTripId : null;
    let tripErr: string | null = null;
    if (tripId && motoristaSelecionado) {
      const t = await updateScheduledTripFields(tripId, { driver_id: motoristaSelecionado });
      tripErr = t.error;
    }
    if (tripErr) {
      setSaving(false);
      setToast(tripErr);
      return;
    }

    let recalcFailed = false;
    if (tripId) {
      try {
        await regenerateStops();
      } catch (e) {
        console.error(e);
        recalcFailed = true;
      }
    }

    const d2 = await fetchEncomendaEditDetail(detail.id);
    if (d2) {
      setDetail(d2);
      setLastResolvedOrigin(d2.originAddress);
      setLastResolvedDestination(d2.destinationAddress);
      setOriginCoord(
        d2.originLat != null && d2.originLng != null ? { lat: d2.originLat, lng: d2.originLng } : null,
      );
      setDestinationCoord(
        d2.destinationLat != null && d2.destinationLng != null
          ? { lat: d2.destinationLat, lng: d2.destinationLng }
          : null,
      );
    }
    setSaving(false);
    if (recalcFailed) {
      setToast('Alterações guardadas, mas falha ao recalcular a rota. Tente salvar de novo.');
    } else if (tripId) {
      setToast('Alterações guardadas. Rota recalculada.');
    } else {
      setToast('Alterações guardadas.');
    }
  }, [
    detail,
    origem,
    destino,
    originCoord,
    destinationCoord,
    instructions,
    recipientName,
    recipientPhone,
    recipientEmail,
    packageSize,
    whenOption,
    scheduledLocal,
    fullName,
    contactPhone,
    receiverName,
    bagsCount,
    motoristaSelecionado,
    regenerateStops,
    tripPainelEncerrado,
  ]);

  if (loading) {
    return React.createElement('div', { style: { padding: 40, ...font } }, 'Carregando…');
  }

  if (loadErr || !detail) {
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 24, ...font } },
      React.createElement('p', null, loadErr || 'Sem dados.'),
      React.createElement('button', { type: 'button', onClick: () => navigate(-1), style: { alignSelf: 'flex-start', cursor: 'pointer' } }, 'Voltar'));
  }

  const dataLinha =
    detail.kind === 'shipment' && detail.tripDepartureAt
      ? new Date(detail.tripDepartureAt).toLocaleDateString('pt-BR')
      : scheduledLocal
        ? new Date(scheduledLocal).toLocaleDateString('pt-BR')
        : new Date(detail.createdAt).toLocaleDateString('pt-BR');
  const horaLinha =
    detail.kind === 'shipment' && detail.tripDepartureAt
      ? new Date(detail.tripDepartureAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : scheduledLocal
        ? new Date(scheduledLocal).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '—';
  const motoristasComRota = motoristas.map((m) => ({
    ...m,
    rota: `${origem.slice(0, 40)} → ${destino.slice(0, 40)}`,
    data: dataLinha,
    horaSaida: horaLinha,
  }));

  const resumoId = `#${detail.id.slice(0, 8)}`;
  const statusLabel = shipmentStatusLabel(detail.status || '');
  const leadShipment = detail.kind === 'shipment' && detail.photoUrl
    ? React.createElement('img', {
      src: detail.photoUrl,
      alt: '',
      style: { width: 56, height: 56, borderRadius: 12, objectFit: 'cover' as const, display: 'block' },
    })
    : React.createElement('div', {
      style: {
        width: 56,
        height: 56,
        borderRadius: 12,
        background: '#e2e2e2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        lineHeight: 1,
      },
    }, '\u{1F4E6}');
  const leadDependent = React.createElement('div', {
    style: {
      width: 56,
      height: 56,
      borderRadius: 12,
      background: '#e2e2e2',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 22,
      lineHeight: 1,
    },
  }, '\u{1F9F3}');
  const encomendaPreview = detail.kind === 'shipment'
    ? encomendaCard(
        leadShipment,
        packageSizeLabel(packageSize),
        formatCurrencyBRL(detail.amountCents),
        detail.senderName || '—',
        recipientName || '—',
        origem,
        destino,
        instructions || '—',
      )
    : encomendaCard(
        leadDependent,
        `${bagsCount || '0'} mala(s)`,
        formatCurrencyBRL(detail.amountCents),
        fullName || '—',
        receiverName || fullName || '—',
        origem,
        destino,
        instructions || '—',
      );

  const motoristaNoteCopy =
    detail.kind === 'shipment' && detail.scheduledTripId
      ? 'Motorista, endereços e horário são aplicados ao clicar em Salvar alteração no topo; a rota da viagem vinculada é recalculada automaticamente.'
      : detail.kind === 'shipment'
        ? 'Sem viagem agendada vinculada: ao salvar, só os dados da encomenda são gravados.'
        : 'Motoristas aprovados são referência; envio dependente sem viagem agendada neste ecrã. Use Salvar alteração no topo para gravar.';
  const motoristaNote = React.createElement('p', {
    style: { fontSize: 12, color: '#767676', margin: '0 0 8px', ...font },
  }, motoristaNoteCopy);

  // --- Seção "Encomendas nesta viagem" (PINs por envio) ---
  // Fallback (sem viagem agendada): monta um TripShipmentListItem a partir do detail enriquecido.
  const currentAsListItem: TripShipmentListItem | null =
    detail.kind === 'shipment'
      ? {
          id: detail.id,
          packageSize: detail.packageSize ?? null,
          amountCents: detail.amountCents,
          recipientName: detail.recipientName,
          recipientPhone: detail.recipientPhone ?? null,
          senderName: detail.senderName,
          originAddress: detail.originAddress,
          destinationAddress: detail.destinationAddress,
          originLat: detail.originLat,
          originLng: detail.originLng,
          destinationLat: detail.destinationLat,
          destinationLng: detail.destinationLng,
          instructions: detail.instructions ?? null,
          photoUrl: detail.photoUrl ?? null,
          status: detail.status,
          supportConversationId: null,
          baseId: detail.baseId,
          pickupCode: detail.pickupCode,
          passengerToPreparerCode: detail.passengerToPreparerCode,
          preparerToBaseCode: detail.preparerToBaseCode,
          baseToDriverCode: detail.baseToDriverCode,
          deliveryCode: detail.deliveryCode,
          pickedUpByPreparerAt: detail.pickedUpByPreparerAt,
          deliveredToBaseAt: detail.deliveredToBaseAt,
          pickedUpByDriverFromBaseAt: detail.pickedUpByDriverFromBaseAt,
          baseToDriverConfirmedAt: detail.baseToDriverConfirmedAt,
          pickedUpAt: detail.pickedUpAt,
          deliveredAt: detail.deliveredAt,
        }
      : null;
  // Lista final: irmãs da viagem (atual em primeiro) ou só a atual quando não há viagem.
  const shipmentsToShow: TripShipmentListItem[] = (() => {
    if (detail.kind !== 'shipment') return [];
    if (linkedShipments.length > 0) {
      const current = linkedShipments.filter((it) => it.id === detail.id);
      const others = linkedShipments.filter((it) => it.id !== detail.id);
      const ordered = [...current, ...others];
      // Se a atual não voltou na query (RLS/filtro), prepende o fallback.
      return current.length === 0 && currentAsListItem ? [currentAsListItem, ...ordered] : ordered;
    }
    return currentAsListItem ? [currentAsListItem] : [];
  })();
  const pinsSection =
    detail.kind === 'shipment' && shipmentsToShow.length > 0
      ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, paddingBottom: 32, borderBottom: '1px solid #e2e2e2' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } },
          shipmentsToShow.length > 1 ? `Encomendas nesta viagem (${shipmentsToShow.length})` : 'PINs desta encomenda'),
        shipmentsToShow.length > 1
          ? React.createElement('p', { style: { fontSize: 12, color: '#767676', margin: 0, ...font } },
            'Este passageiro tem mais de uma encomenda na mesma viagem. A encomenda aberta está destacada.')
          : null,
        ...shipmentsToShow.map((s) => {
          const isCurrent = s.id === detail.id;
          return React.createElement('div', {
            key: s.id,
            style: {
              display: 'flex', flexDirection: 'column' as const, gap: 4,
              border: isCurrent ? '2px solid #102d57' : '1px solid #e2e2e2',
              borderRadius: 12, padding: 16, background: isCurrent ? '#f5f8ff' : '#fff',
            },
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', fontFamily: 'ui-monospace, Menlo, monospace' } }, `#${s.id.slice(0, 8)}`),
              isCurrent
                ? React.createElement('span', { style: { padding: '2px 10px', borderRadius: 999, background: '#102d57', color: '#fff', fontSize: 11, fontWeight: 700, ...font } }, 'Aberta')
                : null,
              React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, `Para ${s.recipientName || '—'}`)),
            React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, `Coleta: ${s.originAddress || '—'} · Entrega: ${s.destinationAddress || '—'}`),
            ShipmentHandoffPinsBlock({ shipment: s }));
        }))
      : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%', maxWidth: 1044, margin: '0 auto', boxSizing: 'border-box' as const } },
    // Breadcrumb
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#767676', ...font } },
      React.createElement('span', null, 'Encomendas'),
      React.createElement('span', { style: { margin: '0 4px' } }, '›'),
      React.createElement('span', { style: { color: '#0d0d0d' } }, 'Editar encomenda')),
    // Toolbar
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 } },
      React.createElement('button', { type: 'button', onClick: () => navigate(-1), style: { display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', padding: 0, ...font } }, arrowBackSvg, 'Voltar'),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { type: 'button', onClick: () => navigate(-1), style: { display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px', borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font } }, xSvg, 'Cancelar'),
        React.createElement('button', {
          type: 'button',
          disabled: saving || tripPainelEncerrado,
          title: tripPainelEncerrado ? 'Encomenda encerrada — somente visualização' : undefined,
          onClick: () => { void save(); },
          style: {
            display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px', borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: (saving || tripPainelEncerrado) ? 'not-allowed' : 'pointer', opacity: (saving || tripPainelEncerrado) ? 0.7 : 1, ...font,
          },
        }, checkSvg, saving ? 'A guardar…' : 'Salvar alteração'))),
    // Warning banner
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: '#f6f6f6', borderRadius: 12, width: '100%', boxSizing: 'border-box' as const } },
      infoSvg,
      React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Você está editando esta encomenda')),
    // Mapa (igual detalhe da viagem) + resumo
    React.createElement('div', { style: webStyles.detailMapTimelineRow },
      React.createElement('div', { style: { ...webStyles.detailMapWrap, position: 'relative' as const } },
        React.createElement(MapView, {
          origin: encomendaMapCoords.origin,
          destination: encomendaMapCoords.destination,
          driverStart: driverStartCoord,
          waypoints: tripWaypoints.length > 0 ? tripWaypoints : undefined,
          height: DETAIL_TRIP_MAP_HEIGHT,
          staticMode: false,
          connectPoints: true,
          showFigmaMapChrome: false,
          tripCompleted: tripPainelEncerrado,
          style: { borderRadius: 0 },
        })),
      React.createElement('div', { style: { flex: '0 1 308px', display: 'flex', flexDirection: 'column' as const, gap: 12, minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#767676', ...font } }, 'Resumo da viagem •'),
          React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', ...font } }, resumoId)),
        React.createElement('span', { style: { display: 'inline-block', padding: '4px 14px', borderRadius: 999, background: '#a8c6ef', color: '#102d57', fontSize: 13, fontWeight: 700, alignSelf: 'flex-start', ...font } }, statusLabel),
        detail.kind === 'shipment' && detail.scheduledTripId
          ? React.createElement('button', {
            type: 'button',
            onClick: () => navigate(`/encomendas/${detail.id}/viagem/${detail.scheduledTripId}`),
            style: {
              alignSelf: 'flex-start',
              border: 'none',
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#102d57',
              textDecoration: 'underline',
              ...font,
            },
          }, 'Abrir detalhes da viagem agendada')
          : null,
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Rota'),
        React.createElement('div', {
          style: {
            minHeight: 44,
            borderRadius: 8,
            background: '#f1f1f1',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            fontSize: 14,
            color: '#0d0d0d',
            ...font,
            lineHeight: 1.4,
            wordBreak: 'break-word' as const,
          },
        }, `${origem} → ${destino}`))),
    // Trajeto
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#767676', ...font } }, 'Trajeto de origem e destino'),
      React.createElement('div', { style: encomendaFieldWrap },
        React.createElement('label', { style: encomendaLabelStyle }, 'Origem'),
        React.createElement(PlacesAddressInput, {
          value: origem,
          onChange: (v: string) => {
            setOrigem(v);
            if (v.trim() !== lastResolvedOrigin.trim()) setOriginCoord(null);
          },
          onPlaceResolved: (p) => {
            setOrigem(p.formattedAddress);
            setOriginCoord({ lat: p.lat, lng: p.lng });
            setLastResolvedOrigin(p.formattedAddress);
          },
          inputStyle: encomendaPlacesInputStyle,
          placeholder: 'Buscar endereço de origem…',
          readOnly: tripPainelEncerrado,
        })),
      React.createElement('div', { style: encomendaFieldWrap },
        React.createElement('label', { style: encomendaLabelStyle }, 'Destino'),
        React.createElement(PlacesAddressInput, {
          value: destino,
          onChange: (v: string) => {
            setDestino(v);
            if (v.trim() !== lastResolvedDestination.trim()) setDestinationCoord(null);
          },
          onPlaceResolved: (p) => {
            setDestino(p.formattedAddress);
            setDestinationCoord({ lat: p.lat, lng: p.lng });
            setLastResolvedDestination(p.formattedAddress);
          },
          inputStyle: encomendaPlacesInputStyle,
          placeholder: 'Buscar endereço de destino…',
          readOnly: tripPainelEncerrado,
        })),
      detail.kind === 'shipment'
        ? React.createElement(React.Fragment, null,
          editField('Destinatário', recipientName, setRecipientName),
          editField('Telefone destinatário', recipientPhone, setRecipientPhone),
          editField('Email destinatário', recipientEmail, setRecipientEmail),
          editField('Tamanho (package_size)', packageSize, setPackageSize),
          editField('Quando (when_option)', whenOption, setWhenOption))
        : React.createElement(React.Fragment, null,
          editField('Nome completo (remetente)', fullName, setFullName),
          editField('Telefone de contacto', contactPhone, setContactPhone),
          editField('Nome do receptor', receiverName, setReceiverName),
          editField('Número de malas', bagsCount, setBagsCount),
          editField('Quando (when_option)', whenOption, setWhenOption)),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Observações / instruções'),
        React.createElement('textarea', {
          value: instructions,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setInstructions(e.target.value),
          rows: 3,
          style: {
            borderRadius: 8, background: '#f1f1f1', border: 'none', padding: 12, fontSize: 14, color: '#0d0d0d', width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const, ...font,
          },
        }))),
    // Horário agendado
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Horário agendado (scheduled_at)'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px' } },
        calendarSvg,
        React.createElement('input', {
          type: 'datetime-local',
          value: scheduledLocal,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScheduledLocal(e.target.value),
          style: { flex: 1, border: 'none', background: 'transparent', fontSize: 14, color: '#0d0d0d', ...font },
        })),
      React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Alterar o horário de início atualizará automaticamente o tempo estimado de chegada.')),
    // PINs por encomenda (atual + irmãs na mesma viagem)
    pinsSection,
    // Motoristas disponíveis (Figma 1283-34111)
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, paddingBottom: 32, borderBottom: '1px solid #e2e2e2' } },
      motoristasComRota.length === 0
        ? React.createElement(React.Fragment, null,
          React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } },
            'Motoristas disponíveis ',
            React.createElement('span', { style: { fontWeight: 400, color: '#767676' } }, '(Aguardando motorista)')),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: '32px 16px' } },
            React.createElement('div', { style: { width: '100%', maxWidth: 280, minHeight: 160, background: '#f1f1f1', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const } },
              React.createElement('img', {
                src: driverWaitingAsset,
                alt: '',
                style: { width: '100%', maxWidth: 200, height: 'auto', maxHeight: 200, objectFit: 'contain' as const },
              }))))
        : React.createElement(React.Fragment, null,
          React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.3, ...font } }, 'Motoristas disponíveis'),
          motoristaNote,
          React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 12, padding: 24, width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
                React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', minHeight: 40, display: 'flex', alignItems: 'center', ...font } }, 'Data de referência'),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 0, height: 44, borderRadius: 8, background: '#f1f1f1', paddingLeft: 16, overflow: 'hidden' } },
                  calendarSvgLg,
                  React.createElement('span', { style: { fontSize: 16, fontWeight: 400, color: '#3a3a3a', paddingLeft: 16, paddingRight: 16, flex: 1, lineHeight: 1.5, ...font } }, dataLinha))),
              React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' } },
                motoristasComRota.slice(0, 2).map((m) => cartaoMotorista(m, motoristaSelecionado === m.id, () => setMotoristaSelecionado(m.id)))),
              React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' } },
                motoristasComRota.slice(2, 4).map((m) => cartaoMotorista(m, motoristaSelecionado === m.id, () => setMotoristaSelecionado(m.id)))))))),
    // Encomendas
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Encomendas'),
      encomendaPreview)),
    toast
      ? React.createElement('div', {
        style: {
          position: 'fixed' as const, bottom: 32, left: '50%', transform: 'translateX(-50%)',
          background: '#0d0d0d', color: '#fff', padding: '12px 20px', borderRadius: 12, fontSize: 14, zIndex: 9999, ...font,
        },
      }, toast)
      : null,
  );
}
