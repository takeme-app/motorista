/**
 * ViagemDetalheScreen — Detalhe da viagem (dados Supabase por :id ou state).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  webStyles,
  DETAIL_TRIP_MAP_HEIGHT,
  arrowBackSvg,
  calendarIconSvg,
  receiptSvg,
  timeSvg,
  inventorySvgLight,
  chartLineSvg,
  logoArrowSmallSvg,
  starSvg,
  peopleOutlineSvg,
  locationOnOutlineSvg,
  accessTimeOutlineSvg,
  inventoryOutlineSvg,
  detailTimelineIcons,
  statusStyles,
  statusLabels,
  statusPill,
  liveFollowMyLocationSvg,
  type ViagemRow,
  type DetailTimelineItem,
} from '../styles/webStyles';
import {
  adminOpenSupportTicketForEntity,
  fetchBookingDetailForAdmin,
  fetchMotoristas,
  fetchShipmentsForScheduledTrip,
  fetchSpedyInvoicePdfAsBlob,
  lookupSpedyInvoiceByStripePi,
} from '../data/queries';
import type { SpedyInvoiceLookupItem } from '../data/types';
import { supabase } from '../lib/supabase';
import { resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import type { BookingDetailForAdmin, TripShipmentListItem } from '../data/types';
import type { MotoristaListItem } from '../data/types';
import MapView from '../components/MapView';
import { useTripStops } from '../hooks/useTripStops';
import { useTripMapCoords } from '../hooks/useTripMapCoords';
import { useScheduledTripLiveLocation } from '../hooks/useScheduledTripLiveLocation';

function rowFromDetail(d: BookingDetailForAdmin): ViagemRow {
  const v = d.listItem;
  return {
    passageiro: v.passageiro,
    origem: v.origem,
    destino: v.destino,
    data: v.data,
    embarque: v.embarque,
    chegada: v.chegada,
    status: v.status,
  };
}

function fmtBRL(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function spedyStatusLabelPt(status: string): string {
  const s: Record<string, string> = {
    authorized: 'Autorizada',
    rejected: 'Rejeitada',
    canceled: 'Cancelada',
    enqueued: 'Na fila',
    created: 'Criada',
    received: 'Recebida',
    inContingent: 'Contingência',
    denied: 'Denegada',
    removed: 'Removida',
    disabled: 'Inutilizada',
  };
  return s[status] || status || '—';
}

/** Prioriza nota autorizada; senão a mais recente da lista Spedy. */
function pickBestSpedyInvoice(invoices: SpedyInvoiceLookupItem[]): SpedyInvoiceLookupItem | null {
  if (!invoices.length) return null;
  const auth = invoices.find((i) => i.status === 'authorized');
  return auth ?? invoices[0];
}

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

function tripDurationMin(depIso: string, arrIso: string): string {
  const a = new Date(depIso).getTime();
  const b = new Date(arrIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '—';
  const m = Math.round((b - a) / 60000);
  return `${m} minutos`;
}

function fmtHandoffValidated(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** Quatro células para exibir PIN de 4 dígitos no painel (suporte / auditoria). */
function pinCharsForDisplay(code: string | null | undefined): string[] {
  const s = (code ?? '').trim();
  if (!s) return ['—', '—', '—', '—'];
  const chars = s.split('');
  const out: string[] = [];
  for (let i = 0; i < 4; i += 1) out.push(chars[i] ?? '—');
  return out;
}

function adminPinChipRow(
  label: string,
  code: string | null | undefined,
  validatedAt: string | null | undefined,
  footnote?: string | null,
): React.ReactElement {
  const validated = fmtHandoffValidated(validatedAt ?? null);
  return React.createElement(
    'div',
    { key: label, style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
    React.createElement(
      'div',
      { style: { fontSize: 12, color: '#767676', fontFamily: 'Inter, sans-serif', lineHeight: 1.4 } },
      label,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const } },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 6 } },
        ...pinCharsForDisplay(code).map((ch, i) =>
          React.createElement(
            'div',
            {
              key: `adm-pin-${label}-${i}`,
              style: {
                minWidth: 36,
                height: 44,
                borderRadius: 8,
                border: '1px solid #d4d4d4',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 700,
                fontFamily: 'ui-monospace, Menlo, monospace',
                color: '#0d0d0d',
              },
            },
            ch,
          ),
        ),
      ),
      validated
        ? React.createElement(
            'span',
            { style: { fontSize: 12, color: '#15803d', fontWeight: 600, fontFamily: 'Inter, sans-serif' } },
            `Validado ${validated}`,
          )
        : null,
    ),
    footnote
      ? React.createElement(
          'div',
          { style: { fontSize: 11, color: '#a3a3a3', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' as const } },
          footnote,
        )
      : null,
  );
}

/** Variante compacta do PIN dentro de cada card (vários passageiros, mesmo código da reserva). */
function adminPinChipRowCompact(
  label: string,
  code: string | null | undefined,
  footnote?: string | null,
): React.ReactElement {
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
    React.createElement(
      'div',
      { style: { fontSize: 11, color: '#767676', fontFamily: 'Inter, sans-serif', lineHeight: 1.35 } },
      label,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 4 } },
      ...pinCharsForDisplay(code).map((ch, i) =>
        React.createElement(
          'div',
          {
            key: `adm-pc-${label}-${i}`,
            style: {
              minWidth: 28,
              height: 36,
              borderRadius: 6,
              border: '1px solid #d4d4d4',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: '#0d0d0d',
            },
          },
          ch,
        ),
      ),
    ),
    footnote
      ? React.createElement(
          'div',
          { style: { fontSize: 10, color: '#a3a3a3', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' as const, lineHeight: 1.35 } },
          footnote,
        )
      : null,
  );
}

export default function ViagemDetalheScreen() {
  const { id, eid } = useParams<{ id: string; eid?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const stateObj = location.state as { trip?: ViagemRow; from?: string; motoristaNome?: string } | null;
  const [detail, setDetail] = useState<BookingDetailForAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [availDrivers, setAvailDrivers] = useState<MotoristaListItem[]>([]);
  const [selectedDriver, setSelectedDriver] = useState(0);
  const [imageZoomOpen, setImageZoomOpen] = useState(false);
  const [acompanharTempoReal, setAcompanharTempoReal] = useState(false);
  const [linkedShipments, setLinkedShipments] = useState<TripShipmentListItem[]>([]);
  const [supportCreateBusyKey, setSupportCreateBusyKey] = useState<string | null>(null);
  const [tripCoords] = useTripMapCoords(detail);

  /**
   * Só em `/encomendas/…/viagem/:id` (e mesmo padrão em preparadores) o `:id` é `scheduled_trips.id`.
   * Em `/passageiros/…/viagem/:id`, `/motoristas/…/viagem/:id` e `/viagens/:id` é id da **reserva** (booking).
   */
  const routeParamIsScheduledTripId = useMemo(
    () =>
      /\/encomendas\/[^/]+\/viagem\/[^/]+$/.test(location.pathname)
      || /\/preparadores\/[^/]+\/viagem\/[^/]+$/.test(location.pathname),
    [location.pathname],
  );
  const preferShipmentIdForTripDetail = useMemo(() => {
    if (!/\/encomendas\/[^/]+\/viagem\/[^/]+$/.test(location.pathname)) return undefined;
    const s = eid?.trim();
    return s || undefined;
  }, [location.pathname, eid]);
  const resolvedScheduledTripId = useMemo(() => {
    if (routeParamIsScheduledTripId && id && !id.startsWith('act-')) return id;
    return detail?.listItem?.tripId ?? null;
  }, [routeParamIsScheduledTripId, id, detail?.listItem?.tripId]);

  const t: ViagemRow | null = useMemo(() => {
    if (detail) return rowFromDetail(detail);
    return stateObj?.trip ?? null;
  }, [detail, stateObj]);

  const tripPainelConcluido = t?.status === 'concluído';

  const [driverStats, setDriverStats] = useState<{ rating: number | null; totalTrips: number; avatarUrl: string | null }>({ rating: null, totalTrips: 0, avatarUrl: null });
  const [driverAvatarSrc, setDriverAvatarSrc] = useState<string | null>(null);
  const [passengerAvatarSrc, setPassengerAvatarSrc] = useState<string | null>(null);
  const [docActionToast, setDocActionToast] = useState<string | null>(null);
  const [spedyNf, setSpedyNf] = useState<{
    loading: boolean;
    error: string | null;
    invoices: SpedyInvoiceLookupItem[];
  }>({ loading: false, error: null, invoices: [] });
  const [nfPdfBusy, setNfPdfBusy] = useState(false);

  const refetchSpedyNf = useCallback(async () => {
    const pi = detail?.stripePaymentIntentId?.trim();
    if (!pi) {
      setSpedyNf({ loading: false, error: null, invoices: [] });
      return;
    }
    setSpedyNf((prev) => ({ ...prev, loading: true, error: null }));
    const res = await lookupSpedyInvoiceByStripePi(pi);
    if (res.error) {
      setSpedyNf({ loading: false, error: res.error, invoices: [] });
      return;
    }
    setSpedyNf({ loading: false, error: null, invoices: res.data?.invoices ?? [] });
  }, [detail?.stripePaymentIntentId]);

  useEffect(() => {
    setSpedyNf({ loading: false, error: null, invoices: [] });
  }, [id]);

  useEffect(() => {
    if (loading) return;
    void refetchSpedyNf();
  }, [loading, id, refetchSpedyNf]);

  const handleSpedyNfPdf = useCallback(async () => {
    const best = pickBestSpedyInvoice(spedyNf.invoices);
    if (!best) {
      setDocActionToast('Nenhuma nota encontrada na Spedy para este pagamento.');
      return;
    }
    setNfPdfBusy(true);
    const { blob, error } = await fetchSpedyInvoicePdfAsBlob(best.id, best.model);
    setNfPdfBusy(false);
    if (error || !blob) {
      setDocActionToast(error ?? 'Não foi possível obter o PDF. Se a nota ainda não estiver autorizada, aguarde ou abra a Spedy.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nf-${best.id}.pdf`;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [spedyNf.invoices]);

  useEffect(() => {
    if (!docActionToast) return;
    const t = setTimeout(() => setDocActionToast(null), 3500);
    return () => clearTimeout(t);
  }, [docActionToast]);

  useEffect(() => {
    const raw = detail?.listItem?.passageiroAvatarUrl;
    if (!raw) { setPassengerAvatarSrc(null); return; }
    let c = false;
    void resolveStorageDisplayUrl(supabase as any, raw).then((url) => { if (!c && url) setPassengerAvatarSrc(url); });
    return () => { c = true; };
  }, [detail?.listItem?.passageiroAvatarUrl]);

  useEffect(() => {
    if (!driverStats.avatarUrl) { setDriverAvatarSrc(null); return; }
    let c = false;
    void resolveStorageDisplayUrl(supabase as any, driverStats.avatarUrl).then((url) => { if (!c && url) setDriverAvatarSrc(url); });
    return () => { c = true; };
  }, [driverStats.avatarUrl]);

  // Multi-ponto: buscar paradas da viagem (trip id do URL ou da reserva carregada)
  const tripIdForStops = resolvedScheduledTripId;
  const { coords: liveDriverCoords } = useScheduledTripLiveLocation(tripIdForStops);
  const { waypoints: tripWaypoints, stops: tripStops } = useTripStops(tripIdForStops);

  const driverStartCoord = useMemo(() => {
    const d = tripStops.find((s) => s.stop_type === 'driver_origin' && s.lat != null && s.lng != null);
    if (d) return { lat: d.lat!, lng: d.lng! };
    if (tripCoords.vehicleOrigin) return tripCoords.vehicleOrigin;
    return undefined;
  }, [tripStops, tripCoords.vehicleOrigin]);

  /**
   * Alvo do modo “Acompanhar”: prioriza `scheduled_trip_live_locations` (motorista na ActiveTripScreen);
   * enquanto não houver linha GPS, usa partida registada (`driver_origin` / origem da viagem).
   */
  const followTargetCoord = useMemo(() => {
    const live =
      liveDriverCoords &&
      Number.isFinite(liveDriverCoords.latitude) &&
      Number.isFinite(liveDriverCoords.longitude)
        ? { lat: liveDriverCoords.latitude, lng: liveDriverCoords.longitude }
        : null;
    if (live) return live;
    return driverStartCoord ?? tripCoords.origin;
  }, [liveDriverCoords, driverStartCoord, tripCoords.origin]);

  /** Pin extra (triângulo) só com GPS ao vivo e viagem “Em andamento” no painel. */
  const liveVehicleMapPosition = useMemo(() => {
    if (t?.status !== 'em_andamento' || !liveDriverCoords) return undefined;
    if (
      !Number.isFinite(liveDriverCoords.latitude) ||
      !Number.isFinite(liveDriverCoords.longitude)
    ) {
      return undefined;
    }
    return { lat: liveDriverCoords.latitude, lng: liveDriverCoords.longitude };
  }, [t?.status, liveDriverCoords]);

  const onFollowVehicleInterrupted = useCallback(() => setAcompanharTempoReal(false), []);

  const handleBookingSupportClick = useCallback(async () => {
    const d = detail;
    if (!d?.listItem?.bookingId) {
      setDocActionToast('Dados da reserva indisponíveis.');
      return;
    }
    const existing = d.supportConversationId?.trim();
    if (existing) {
      navigate(`/atendimentos/${existing}`, { state: { from: 'viagem-detalhe' } });
      return;
    }
    const tripHint = resolvedScheduledTripId ?? d.listItem.tripId ?? '';
    setSupportCreateBusyKey('booking');
    try {
      const { conversationId, error } = await adminOpenSupportTicketForEntity({
        bookingId: d.listItem.bookingId,
        category: 'outros',
        context: {
          source_screen: 'viagem_detalhe_passageiro',
          ...(tripHint ? { scheduled_trip_id: String(tripHint) } : {}),
        },
      });
      if (error || !conversationId) {
        setDocActionToast(error ?? 'Não foi possível criar o ticket.');
        return;
      }
      navigate(`/atendimentos/${conversationId}`, { state: { from: 'viagem-detalhe', createdTicket: true } });
    } finally {
      setSupportCreateBusyKey(null);
    }
  }, [detail, navigate, resolvedScheduledTripId]);

  const handleShipmentSupportClick = useCallback(async (s: TripShipmentListItem) => {
    const existing = s.supportConversationId?.trim();
    if (existing) {
      navigate(`/atendimentos/${existing}`, { state: { from: 'viagem-detalhe' } });
      return;
    }
    const tripHint = resolvedScheduledTripId ?? detail?.listItem?.tripId ?? '';
    setSupportCreateBusyKey(`ship:${s.id}`);
    try {
      const { conversationId, error } = await adminOpenSupportTicketForEntity({
        shipmentId: s.id,
        category: 'encomendas',
        context: {
          source_screen: 'viagem_detalhe_encomenda',
          ...(tripHint ? { scheduled_trip_id: String(tripHint) } : {}),
        },
      });
      if (error || !conversationId) {
        setDocActionToast(error ?? 'Não foi possível criar o ticket.');
        return;
      }
      navigate(`/atendimentos/${conversationId}`, { state: { from: 'viagem-detalhe', createdTicket: true } });
    } finally {
      setSupportCreateBusyKey(null);
    }
  }, [detail?.listItem?.tripId, navigate, resolvedScheduledTripId]);

  useEffect(() => {
    if (t?.status !== 'em_andamento') setAcompanharTempoReal(false);
  }, [t?.status]);

  const isMotoristas = location.pathname.startsWith('/motoristas');
  const isPassageiros = location.pathname.startsWith('/passageiros');
  const fromLabel = isMotoristas ? 'Motoristas'
    : isPassageiros ? 'Passageiros'
    : location.pathname.startsWith('/encomendas') ? 'Encomendas'
    : location.pathname.startsWith('/preparadores') ? 'Preparadores'
    : stateObj?.from || 'Viagens';

  useEffect(() => {
    let cancel = false;
    if (!id) {
      setLoading(false);
      return () => { cancel = true; };
    }
    // Histórico mock (PassageiroDetalhe) usa ids tipo act-1 — não consultar Supabase
    if (id.startsWith('act-')) {
      setDetail(null);
      setLoading(false);
      return () => { cancel = true; };
    }
    setLoading(true);
    fetchBookingDetailForAdmin(id, { preferShipmentId: preferShipmentIdForTripDetail }).then((d) => {
      if (!cancel) {
        setDetail(d);
        setLoading(false);
      }
    });
    return () => { cancel = true; };
  }, [id, preferShipmentIdForTripDetail]);

  useEffect(() => {
    if (!isMotoristas) return;
    fetchMotoristas().then((m) => setAvailDrivers(m.slice(0, 12)));
  }, [isMotoristas]);

  useEffect(() => {
    const driverId = detail?.listItem?.driverId;
    if (!driverId) return;
    let cancel = false;
    Promise.all([
      (supabase as any).from('worker_ratings').select('rating').eq('worker_id', driverId),
      (supabase as any).from('scheduled_trips').select('id').eq('driver_id', driverId),
      supabase.from('profiles').select('avatar_url').eq('id', driverId).single(),
    ]).then(([ratingsRes, tripsRes, profileRes]: any[]) => {
      if (cancel) return;
      const ratings = ratingsRes.data || [];
      const avgRating = ratings.length > 0 ? Math.round(ratings.reduce((s: number, r: any) => s + r.rating, 0) / ratings.length * 10) / 10 : null;
      setDriverStats({
        rating: avgRating,
        totalTrips: tripsRes.data?.length || 0,
        avatarUrl: profileRes.data?.avatar_url || null,
      });
    });
    return () => { cancel = true; };
  }, [detail?.listItem?.driverId]);

  useEffect(() => {
    if (!resolvedScheduledTripId) {
      setLinkedShipments([]);
      return;
    }
    let cancel = false;
    fetchShipmentsForScheduledTrip(resolvedScheduledTripId).then((rows) => {
      if (!cancel) setLinkedShipments(rows);
    });
    return () => { cancel = true; };
  }, [resolvedScheduledTripId]);

  /** Sem `bookings.id` real mas com envios no trip (detalhe sintético): não listar remetente como passageiro. */
  const isShipmentOnlyTrip = useMemo(
    () => Boolean(detail && !String(detail.listItem?.bookingId ?? '').trim() && linkedShipments.length > 0),
    [detail, linkedShipments],
  );

  const moneyResumo = useMemo(() => {
    if (!detail) {
      return { displayTotal: 0, displayUnit: 0, resumoUnitLabel: 'Valor unitário' as const };
    }
    const shipSum = linkedShipments.reduce((s, sh) => s + Number(sh.amountCents ?? 0), 0);
    const book = Number(detail.amountCents ?? 0);
    const displayTotal = book + shipSum;
    const hasBk = Boolean(String(detail.listItem?.bookingId ?? '').trim());
    const shipOnly = !hasBk && linkedShipments.length > 0;
    const pc = Math.max(1, Number(detail.passengerCount ?? 1));
    let displayUnit = displayTotal;
    if (shipOnly && linkedShipments.length > 0) {
      displayUnit = Math.round(displayTotal / linkedShipments.length);
    } else if (hasBk && pc > 0) {
      displayUnit = Math.round(displayTotal / pc);
    }
    const resumoUnitLabel = shipOnly && linkedShipments.length > 0 ? 'Valor médio por encomenda' : 'Valor unitário';
    return { displayTotal, displayUnit, resumoUnitLabel };
  }, [detail, linkedShipments]);

  /** Alinhado a `bookings.passenger_count`: titular + extras em `passenger_data`, sem duplicar nome do titular. */
  const passengerDisplayRows = useMemo(() => {
    type Row = { name: string; pData?: { name?: string; cpf?: string; bags?: number } };
    if (!detail) {
      return t ? [{ name: t.passageiro }] as Row[] : [];
    }
    if (isShipmentOnlyTrip) return [];
    const count = Math.max(1, Number(detail.passengerCount) || 1);
    const primary = (detail.listItem.passageiro || 'Sem nome').trim();
    const primaryKey = primary.toLowerCase();
    const primaryPData = detail.passengerData.find(
      (p) => (p.name || '').trim().toLowerCase() === primaryKey,
    );
    const rows: Row[] = [{ name: primary || 'Sem nome', pData: primaryPData }];
    const seen = new Set<string>([primaryKey]);
    for (const p of detail.passengerData) {
      if (rows.length >= count) break;
      const nm = (p.name || '').trim();
      if (!nm) continue;
      const k = nm.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ name: nm, pData: p });
    }
    return rows;
  }, [detail, t, isShipmentOnlyTrip]);

  const bestSpedyInvoice = useMemo(() => pickBestSpedyInvoice(spedyNf.invoices), [spedyNf.invoices]);

  if (loading) {
    return React.createElement('div', { style: webStyles.detailPage },
      React.createElement('p', { style: { padding: 32, fontFamily: 'Inter, sans-serif' } }, 'Carregando…'));
  }

  if (!t) {
    return React.createElement('div', { style: webStyles.detailPage },
      React.createElement('div', { style: webStyles.detailSection },
        React.createElement('p', null, id ? 'Viagem não encontrada.' : 'Nenhuma viagem selecionada.'),
        React.createElement('button', { type: 'button', style: webStyles.detailBackBtn, onClick: () => navigate(-1) }, arrowBackSvg, 'Voltar à lista')));
  }

  const v = detail?.listItem;
  const isMockTrip = !detail && !!t;
  const bagPct = detail?.trunkOccupancyPct != null
    ? `${detail.trunkOccupancyPct}%`
    : (detail ? `${Math.min(100, (detail.bagsCount ?? 1) * 15)}%` : '80%');
  const seatsHint = v?.driverId ? 'Ver viagem' : '—';

  const getDetailTimelineItems = (row: ViagemRow): DetailTimelineItem[] => [
    { id: 'inicio', icon: 'clock', label: 'Início', value: row.embarque },
    { id: 'origem', icon: 'origin', label: 'Origem', value: detail?.originFull || row.origem, showConnectorAfter: true },
    { id: 'destino', icon: 'destination', label: 'Destino', value: detail?.destinationFull || row.destino },
    { id: 'ocupacao', icon: 'inventory', label: 'Ocupação bagageiro', value: bagPct },
    { id: 'chegada', icon: 'clock', label: 'Horário de chegada', value: row.chegada },
  ];
  const timelineItems = getDetailTimelineItems(t);
  const detailSectionBorder = { borderBottom: '1px solid #e2e2e2', paddingBottom: 32 };

  const motoristaNome = detail
    ? (v?.motoristaNome ?? '—')
    : (stateObj?.motoristaNome ?? '—');
  const motoristaBadge = !detail
    ? 'Motorista TakeMe'
    : (v?.motoristaCategoria === 'motorista' ? 'Motorista Parceiro' : 'Motorista TakeMe');
  const motoristaTrips = driverStats.totalTrips > 0 ? String(driverStats.totalTrips) : '—';
  const motoristaTripsLabel = `(${motoristaTrips} viagens)`;
  const motoristaRating = driverStats.rating != null ? String(driverStats.rating) : '—';

  const starFilledSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', fill: '#F59E0B', stroke: '#F59E0B', strokeWidth: 1 }));

  const motoristaInfo = (label: string, value: string, icon: React.ReactNode) =>
    React.createElement('div', { style: webStyles.detailMotoristaInfoBlock },
      React.createElement('div', { style: webStyles.detailMotoristaInfoIconWrap }, icon),
      React.createElement('div', { style: webStyles.detailMotoristaInfoText },
        React.createElement('div', { style: webStyles.detailResumoLabel }, label),
        React.createElement('div', { style: webStyles.detailResumoValue }, value)));

  const motoristaDriverBlock = React.createElement('div', { style: webStyles.detailMotoristaDriverBlock },
    driverAvatarSrc
      ? React.createElement('img', { src: driverAvatarSrc, alt: motoristaNome, style: { ...webStyles.detailMotoristaAvatar, objectFit: 'cover' as const } })
      : React.createElement('div', { style: webStyles.detailMotoristaAvatar },
          React.createElement('span', { style: { color: '#767676', fontSize: 20, fontWeight: 600, fontFamily: 'Inter, sans-serif' } }, motoristaNome.charAt(0))),
    React.createElement('div', { style: webStyles.detailMotoristaDriverInfo },
      React.createElement('div', { style: webStyles.detailMotoristaBadge },
        (detail ? v?.motoristaCategoria !== 'motorista' : true) ? logoArrowSmallSvg : null,
        motoristaBadge),
      React.createElement('span', { style: webStyles.detailMotoristaName }, motoristaNome),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        driverStats.rating != null ? starFilledSvg : starSvg,
        React.createElement('span', { style: webStyles.detailMotoristaRating }, motoristaRating),
        React.createElement('span', { style: webStyles.detailMotoristaRatingMuted }, motoristaTripsLabel))));
  const motoristaRow1 = React.createElement('div', { style: webStyles.detailMotoristaRow },
    motoristaDriverBlock,
    React.createElement('div', { style: webStyles.detailMotoristaInfoGroup },
      motoristaInfo(detail ? 'Lugares / info' : 'Lugares restantes', detail ? seatsHint : '1 vaga', peopleOutlineSvg),
      motoristaInfo('Chegada prevista', t.chegada, locationOnOutlineSvg)));
  const motoristaRow2 = React.createElement('div', { style: webStyles.detailMotoristaRow },
    React.createElement('div', { style: webStyles.detailMotoristaSpacer }),
    React.createElement('div', { style: webStyles.detailMotoristaInfoGroup },
      motoristaInfo('Saída', t.embarque, accessTimeOutlineSvg),
      motoristaInfo('Bagageiro', detail ? bagPct : 'Grande', inventoryOutlineSvg)));
  const motoristaCard = React.createElement('div', { style: webStyles.detailMotoristaCard },
    React.createElement('div', { style: webStyles.detailMotoristaCardInner },
      motoristaRow1,
      motoristaRow2));
  const motoristaSection = React.createElement('div', { style: webStyles.detailPassageirosSection },
    React.createElement('h2', { style: webStyles.detailSectionTitle }, 'Motorista'),
    motoristaCard);

  const atendimentoIconSvg = React.createElement(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', {
      d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
      stroke: '#6366f1',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );

  const pickupCodeTrimmed = detail?.pickupCode?.trim() ?? '';
  const nPassengersListed = passengerDisplayRows.length;

  const passageiroCard = (row: { name: string; pData?: { name?: string; cpf?: string; bags?: number } }, idx: number) => {
    const name = row.name;
    const pData = row.pData;
    const bags =
      pData?.bags != null && Number.isFinite(Number(pData.bags))
        ? Number(pData.bags)
        : detail && detail.passengerCount <= 1
          ? Math.max(1, detail.bagsCount ?? 1)
          : 1;
    const bagLabel = bags <= 1 ? 'Pequena' : bags <= 2 ? 'Média' : 'Grande';
    const unitPrice = detail && detail.passengerCount > 0
      ? fmtBRL(Math.round(moneyResumo.displayTotal / detail.passengerCount))
      : 'R$ 150,00';
    const cpfLabel = pData?.cpf ? `CPF: ${pData.cpf}` : '';

    const pickupInlineBlock = pickupCodeTrimmed
      ? nPassengersListed <= 1
        ? React.createElement(
            'div',
            { style: { paddingTop: 12, width: '100%', boxSizing: 'border-box' as const } },
            adminPinChipRow(
              'Código de embarque da reserva — informar ao motorista',
              pickupCodeTrimmed,
              null,
              'Todos os passageiros desta reserva partilham este PIN. Encomendas na mesma viagem: ver PINs na secção «Encomendas».',
            ),
          )
        : React.createElement(
            'div',
            { style: { paddingTop: 12, width: '100%', boxSizing: 'border-box' as const } },
            adminPinChipRowCompact(
              'Embarque — código da reserva (igual para todos)',
              pickupCodeTrimmed,
              'Mesmo código indicado acima nesta secção.',
            ),
          )
      : null;

    return React.createElement('div', { key: `pax-${idx}-${name}`, style: { background: '#f6f6f6', borderRadius: 12, padding: 16, minWidth: 280, maxWidth: 330, flex: '1 1 280px', display: 'flex', flexDirection: 'column' as const, gap: 0 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 12, borderBottom: '1px solid #e2e2e2', width: '100%', boxSizing: 'border-box' as const } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 } },
          idx === 0 && passengerAvatarSrc
            ? React.createElement('img', { src: passengerAvatarSrc, alt: name, style: { width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' as const, flexShrink: 0 } })
            : React.createElement('div', { style: { width: 48, height: 48, borderRadius: '50%', background: '#e2e2e2', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, color: '#767676', fontFamily: 'Inter, sans-serif' } },
                name.charAt(0).toUpperCase()),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' } }, name),
            cpfLabel ? React.createElement('div', { style: { fontSize: 12, color: '#767676', fontFamily: 'Inter, sans-serif', marginTop: 2 } }, cpfLabel) : null,
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 } },
              starFilledSvg,
              React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', fontFamily: 'Inter, sans-serif' } }, '—')))),
        idx === 0 && detail
          ? React.createElement('button', {
            type: 'button',
            disabled: supportCreateBusyKey === 'booking',
            'aria-busy': supportCreateBusyKey === 'booking' ? true : undefined,
            style: {
              ...webStyles.viagensActionBtn,
              ...(supportCreateBusyKey === 'booking' ? { opacity: 0.55 } : {}),
              cursor: supportCreateBusyKey === 'booking' ? 'wait' : 'pointer',
            },
            'aria-label': detail.supportConversationId?.trim()
              ? 'Abrir atendimento da reserva (passageiro)'
              : 'Criar ou abrir atendimento da reserva (passageiro)',
            title: detail.supportConversationId?.trim()
              ? 'Abrir o ticket de suporte já ligado a esta reserva.'
              : 'Cria um novo ticket para o cliente desta reserva (ou abre o ativo existente).',
            onClick: () => { void handleBookingSupportClick(); },
          }, atendimentoIconSvg)
          : null),
      pickupInlineBlock,
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, paddingTop: 12, borderTop: pickupInlineBlock ? '1px solid #e2e2e2' : 'none', width: '100%', boxSizing: 'border-box' as const } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('span', { style: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif' } }, 'Mala'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' } }, bagLabel)),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('span', { style: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif' } }, 'Valor unitário:'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' } }, unitPrice))));
  };

  const passageirosChevronBtn = React.createElement('button', {
    type: 'button',
    style: {
      width: 29, height: 29, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, flexShrink: 0,
    },
    'aria-label': 'Ver mais passageiros',
  },
    React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
      React.createElement('path', { d: 'M9 18l6-6-6-6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })));
  /** PIN `bookings.pickup_code` — único por reserva; acima dos cards só quando há 2+ passageiros (1 pax: PIN só dentro do card). */
  const bookingPickupPinBlock =
    pickupCodeTrimmed && nPassengersListed > 1
      ? React.createElement(
          'div',
          { style: { width: '100%', marginBottom: 20 } },
          adminPinChipRow(
            'Código de embarque da reserva — informar ao motorista',
            pickupCodeTrimmed,
            null,
          ),
          React.createElement(
            'p',
            {
              style: {
                fontSize: 13,
                color: '#767676',
                fontFamily: 'Inter, sans-serif',
                marginTop: 10,
                marginBottom: 0,
                lineHeight: 1.5,
                maxWidth: 720,
              },
            },
            'Um único PIN para todos os passageiros desta reserva (não há código distinto por pessoa). Encomendas na mesma viagem têm PINs próprios na secção «Encomendas».',
          ),
        )
      : null;

  const passageirosSection = !isShipmentOnlyTrip
    ? React.createElement('div', { style: webStyles.detailPassageirosSection },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 16 } },
        React.createElement('h2', { style: { ...webStyles.detailSectionTitle, margin: 0 } }, 'Passageiros'),
        passageirosChevronBtn),
      bookingPickupPinBlock,
      React.createElement('div', { style: { display: 'flex', gap: 24, overflowX: 'auto' as const } },
        ...passengerDisplayRows.map((row, i) => passageiroCard(row, i))))
    : null;

  const podeAcompanharTempoReal = t.status === 'em_andamento';

  const acompanharTempoRealBtn = podeAcompanharTempoReal && followTargetCoord
    ? React.createElement('button', {
      type: 'button',
      style: {
        ...webStyles.detailLiveFollowBtn,
        ...(acompanharTempoReal ? { boxShadow: 'inset 0 0 0 2px #C9A227' } : {}),
      },
      'aria-pressed': acompanharTempoReal,
      title: acompanharTempoReal
        ? 'Clique novamente ou arraste o mapa para sair do modo acompanhar'
        : liveDriverCoords
          ? 'Centrar o mapa na posição GPS do motorista (atualiza cerca de 2 em 2 segundos).'
          : 'Centrar na última posição conhecida. O GPS em tempo real aparece quando o motorista está na viagem ativa no app.',
      onClick: () => setAcompanharTempoReal((v) => !v),
    },
      liveFollowMyLocationSvg,
      'Acompanhar em tempo real')
    : null;

  const firstSection = React.createElement('div', { style: { ...webStyles.detailSection, ...detailSectionBorder } },
    React.createElement('div', { style: webStyles.detailBreadcrumb },
      React.createElement('span', null, fromLabel),
      React.createElement('span', { style: { margin: '0 4px' } }, '›'),
      React.createElement('span', { style: webStyles.detailBreadcrumbCurrent }, 'Detalhes da viagem')),
    React.createElement('div', { style: webStyles.detailToolbar },
      React.createElement('button', { type: 'button', style: webStyles.detailBackBtn, onClick: () => navigate(-1) }, arrowBackSvg, 'Voltar'),
      React.createElement('div', { style: { ...webStyles.detailDocBtns, gap: 16 } },
        acompanharTempoRealBtn,
        (() => {
          const nfHintTitle =
            'PDF fornecido pela Spedy. O envio da nota ao cliente fica na Spedy (integração Stripe), não neste painel.';
          const pi = detail?.stripePaymentIntentId?.trim();
          if (!pi) {
            return React.createElement(
              'div',
              { key: 'nf-spedy', style: { display: 'flex', flexDirection: 'column' as const, gap: 4, maxWidth: 360 } },
              React.createElement(
                'span',
                { style: { fontSize: 12, color: '#737373', fontFamily: 'Inter, sans-serif' } },
                'Nota fiscal: sem cobrança Stripe nesta reserva.',
              ),
              React.createElement(
                'span',
                { style: { fontSize: 11, color: '#a3a3a3', fontFamily: 'Inter, sans-serif' }, title: nfHintTitle },
                'Envio ao pagador: configure na Spedy.',
              ),
            );
          }
          if (spedyNf.loading) {
            return React.createElement(
              'span',
              { key: 'nf-spedy', style: { fontSize: 12, color: '#737373', fontFamily: 'Inter, sans-serif' } },
              'Nota fiscal: consultando Spedy…',
            );
          }
          if (spedyNf.error) {
            return React.createElement(
              'div',
              { key: 'nf-spedy', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const } },
              React.createElement(
                'span',
                { style: { fontSize: 12, color: '#b91c1c', fontFamily: 'Inter, sans-serif', maxWidth: 280 } },
                spedyNf.error,
              ),
              React.createElement(
                'button',
                { type: 'button', style: webStyles.detailDocBtn, onClick: () => void refetchSpedyNf() },
                'Tentar novamente',
              ),
            );
          }
          if (!bestSpedyInvoice) {
            return React.createElement(
              'div',
              { key: 'nf-spedy', style: { display: 'flex', flexDirection: 'column' as const, gap: 6, maxWidth: 420 } },
              React.createElement(
                'span',
                { style: { fontSize: 12, color: '#737373', fontFamily: 'Inter, sans-serif' } },
                'Nenhuma nota encontrada na Spedy para este pagamento.',
              ),
              React.createElement(
                'span',
                { style: { fontSize: 11, color: '#a3a3a3', fontFamily: 'Inter, sans-serif' }, title: nfHintTitle },
                'Envio ao pagador: configure na Spedy.',
              ),
              React.createElement(
                'button',
                { type: 'button', style: webStyles.detailDocBtn, onClick: () => void refetchSpedyNf() },
                'Atualizar',
              ),
            );
          }
          return React.createElement(
            'div',
            { key: 'nf-spedy', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const } },
            React.createElement(
              'span',
              {
                style: { fontSize: 12, color: '#404040', fontWeight: 600, fontFamily: 'Inter, sans-serif' },
                title: nfHintTitle,
              },
              `NF: ${spedyStatusLabelPt(bestSpedyInvoice.status)}`,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                style: webStyles.detailDocBtn,
                title: nfHintTitle,
                disabled: nfPdfBusy,
                onClick: () => void handleSpedyNfPdf(),
              },
              nfPdfBusy
                ? 'Abrindo…'
                : React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(
                    'svg',
                    { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'inline', verticalAlign: 'middle', marginRight: 6 } },
                    React.createElement('path', { d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z', stroke: '#0d0d0d', strokeWidth: 2 }),
                    React.createElement('path', { d: 'M14 2v6h6', stroke: '#0d0d0d', strokeWidth: 2 }),
                  ),
                  'Baixar PDF',
                ),
            ),
            React.createElement(
              'button',
              { type: 'button', style: webStyles.detailDocBtn, onClick: () => void refetchSpedyNf() },
              'Atualizar',
            ),
          );
        })(),
        React.createElement('button', {
          type: 'button',
          style: webStyles.detailDocBtn,
          title: 'Em desenvolvimento — download de recibo ainda não disponível.',
          onClick: () => setDocActionToast('Download de recibo ainda não está disponível neste painel.'),
        },
          receiptSvg,
          'Recibo'),
        isMotoristas ? React.createElement('button', {
          type: 'button',
          onClick: () => navigate(`${location.pathname}/historico`, { state: location.state }),
          style: webStyles.detailDocBtn,
        },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
            React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#0d0d0d', strokeWidth: 2 }),
            React.createElement('path', { d: 'M12 6v6l4 2', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })),
          'Histórico') : null)),
    React.createElement('div', { style: webStyles.detailMapTimelineRow },
      React.createElement('div', { style: { ...webStyles.detailMapWrap, position: 'relative' as const, overflow: 'hidden' } },
        React.createElement(MapView, {
          origin: tripCoords.origin,
          destination: tripCoords.destination,
          driverStart: driverStartCoord,
          currentPosition: liveVehicleMapPosition,
          waypoints: tripWaypoints.length > 0 ? tripWaypoints : undefined,
          height: DETAIL_TRIP_MAP_HEIGHT,
          staticMode: false,
          connectPoints: true,
          followVehicle: acompanharTempoReal,
          followTarget: acompanharTempoReal && followTargetCoord ? followTargetCoord : undefined,
          onFollowVehicleInterrupted: onFollowVehicleInterrupted,
          tripCompleted: tripPainelConcluido,
          style: { borderRadius: 0 },
        }),
        React.createElement('button', {
          type: 'button',
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); setImageZoomOpen(true); },
          style: {
            position: 'absolute' as const,
            top: 10,
            right: 10,
            zIndex: 2,
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
            fontSize: 13,
            fontWeight: 600,
            color: '#0d0d0d',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          },
        }, 'Ampliar mapa')),
      React.createElement('div', { style: webStyles.detailTimeline },
        React.createElement('div', { style: webStyles.detailTimelineBadgeWrap }, statusPill(statusLabels[t.status], statusStyles[t.status].bg, statusStyles[t.status].color)),
        React.createElement('div', { style: webStyles.detailTimelineRows },
          ...timelineItems.map((item) =>
            React.createElement('div', { key: item.id, style: webStyles.detailTimelineItem },
              item.showConnectorAfter
                ? React.createElement('div', { style: webStyles.detailTimelineIconCol },
                    React.createElement('div', { style: webStyles.detailTimelineIcon }, detailTimelineIcons[item.icon]),
                    React.createElement('div', { style: webStyles.detailTimelineConnector }))
                : React.createElement('div', { style: webStyles.detailTimelineIcon }, detailTimelineIcons[item.icon]),
              React.createElement('div', { style: webStyles.detailTimelineTextBlock },
                React.createElement('p', { style: webStyles.detailTimelineLabel }, item.label),
                React.createElement('p', { style: webStyles.detailTimelineValue }, item.value))))))));

  // ── Resumo conforme Figma (3 colunas space-between, icones transparentes) ──
  const resumoIcon = (svg: React.ReactNode) =>
    React.createElement('div', {
      style: { width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    }, svg);

  const resumoCell = (icon: React.ReactNode, label: string, value: string, hidden?: boolean) =>
    React.createElement('div', {
      style: { display: 'flex', gap: 16, alignItems: 'center', flex: '1 1 0', minWidth: 0, opacity: hidden ? 0 : 1 },
    },
      resumoIcon(icon),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, lineHeight: 1.5 } }, label),
        React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, lineHeight: 1.5 } }, value)));

  const resumoRow = (...cells: React.ReactNode[]) =>
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' },
    }, ...cells);

  // SVG icons (stroke #0d0d0d, no fill background)
  const iconId = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z', stroke: '#0d0d0d', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const iconMoney = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('rect', { x: 2, y: 6, width: 20, height: 12, rx: 2, stroke: '#0d0d0d', strokeWidth: 1.5 }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 1.5 }));
  const iconCalendar = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, stroke: '#0d0d0d', strokeWidth: 1.5 }),
    React.createElement('path', { d: 'M16 2v4M8 2v4M3 10h18', stroke: '#0d0d0d', strokeWidth: 1.5, strokeLinecap: 'round' }));
  const iconClock = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#0d0d0d', strokeWidth: 1.5 }),
    React.createElement('path', { d: 'M12 6v6l4 2', stroke: '#0d0d0d', strokeWidth: 1.5, strokeLinecap: 'round' }));
  const iconBag = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z', stroke: '#0d0d0d', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const iconPeople = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', stroke: '#0d0d0d', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const iconChart = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M3 17l6-6 4 4 8-8', stroke: '#0d0d0d', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  const bookingIdLabel = v?.bookingId ? `#${String(v.bookingId).slice(0, 8)}` : (isMockTrip ? '#123456' : (id ? `#${String(id).slice(0, 8)}` : '—'));
  const totalCents = isMockTrip ? 15430 : (detail ? moneyResumo.displayTotal : 0);
  const unitCents = isMockTrip ? 8000 : (detail ? moneyResumo.displayUnit : 0);
  const resumoUnitLabel = isMockTrip ? 'Valor unitário' : moneyResumo.resumoUnitLabel;
  const dur = detail?.tripDepartureAtIso && detail?.tripArrivalAtIso
    ? tripDurationMin(detail.tripDepartureAtIso, detail.tripArrivalAtIso)
    : v
      ? tripDurationMin(
        v.departureAtIso,
        new Date(new Date(v.departureAtIso).getTime() + 3600000).toISOString(),
      )
      : (isMockTrip ? '50 minutos' : '—');
  const distKmLabel = isMockTrip ? '18,4 km' : '—';

  const resumoSection = React.createElement('div', {
    style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 32, display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' },
  },
    React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', margin: 0 } }, 'Resumo da Viagem'),
    resumoRow(
      resumoCell(iconId, 'ID da viagem', bookingIdLabel),
      resumoCell(iconMoney, 'Preço total', fmtBRL(totalCents)),
      resumoCell(iconCalendar, 'Data', t.data)),
    resumoRow(
      resumoCell(iconClock, 'Duração', dur),
      resumoCell(iconBag, resumoUnitLabel, fmtBRL(unitCents)),
      resumoCell(iconPeople, 'Total de passageiros', `${isShipmentOnlyTrip ? 0 : (detail?.passengerCount ?? 1)} pessoa(s)`)),
    resumoRow(
      resumoCell(iconBag, 'Despesas', '—'),
      resumoCell(iconChart, 'Km da viagem', distKmLabel),
      resumoCell(iconPeople, '', '', true)),
    detail && String(detail.listItem?.bookingId ?? '').trim()
      ? resumoRow(
        resumoCell(
          iconMoney,
          'Método de pagamento',
          detail.paymentMethod === 'cash' ? 'Dinheiro' : detail.paymentMethod === 'pix' ? 'Pix' : 'Cartão',
        ),
        resumoCell(
          iconChart,
          'Abate extra (Connect)',
          detail.platformFeeExtraDebitCents > 0 ? fmtBRL(detail.platformFeeExtraDebitCents) : '—',
        ),
        resumoCell(
          iconMoney,
          'Taxa admin (snapshot)',
          detail.adminEarningCents > 0 ? fmtBRL(detail.adminEarningCents) : '—',
        ),
      )
      : null);

  const ocupacaoSection = React.createElement('div', { style: webStyles.detailSection },
    React.createElement('h2', { style: webStyles.detailSectionTitle }, 'Ocupação e desempenho'),
    React.createElement('div', { style: webStyles.detailPerfCards },
      React.createElement('div', { style: webStyles.detailPerfCard },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('span', { style: { ...webStyles.detailPerfCardTitle, whiteSpace: 'pre-line' as const } }, 'Ocupação \nmédia do bagageiro'),
          React.createElement('div', { style: { width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, inventorySvgLight)),
        React.createElement('span', { style: webStyles.detailPerfCardValue }, bagPct)),
      React.createElement('div', { style: webStyles.detailPerfCard },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('span', { style: webStyles.detailPerfCardTitle }, 'Tempo total de viagem'),
          React.createElement('div', { style: { width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none' },
              React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#0d0d0d', strokeWidth: 2 }),
              React.createElement('path', { d: 'M12 6v6l4 2', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
        React.createElement('span', { style: webStyles.detailPerfCardValue }, isMockTrip ? '50 min' : dur)),
      React.createElement('div', { style: webStyles.detailPerfCard },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('span', { style: webStyles.detailPerfCardTitle }, 'Distância percorrida'),
          React.createElement('div', { style: { width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, chartLineSvg)),
        React.createElement('span', { style: webStyles.detailPerfCardValue }, distKmLabel))));

  // ── Encomendas conforme Figma: linhas horizontais ──────────────────
  const encField = (label: string, value: string, multiline?: boolean, valueTitle?: string) =>
    React.createElement('div', { style: { flex: '1 1 0', minWidth: 0 } },
      React.createElement('div', { style: { fontSize: 12, color: '#767676', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 } }, label),
      React.createElement('div', {
        style: {
          fontSize: 14, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', lineHeight: 1.5,
          ...(multiline
            ? { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const }
            : { overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }),
        },
        ...(valueTitle ? { title: valueTitle } : {}),
      }, value));

  const shipmentRow = (s: TripShipmentListItem) => {
    const ps = s.packageSize;
    const sizeLabel = ps === 'pequeno' ? 'Pequeno' : ps === 'medio' ? 'Médio' : ps === 'grande' ? 'Grande' : ps || '—';
    const handoffPinsBlock = React.createElement(
      'div',
      {
        style: {
          borderTop: '1px solid #e2e2e2',
          paddingTop: 16,
          marginTop: 4,
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 14,
        },
      },
      React.createElement(
        'div',
        { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' } },
        s.baseId ? 'PINs de handoff (encomenda com base)' : 'PINs de handoff (sem base)',
      ),
      s.baseId
        ? React.createElement(
            React.Fragment,
            null,
            adminPinChipRow('PIN A — Passageiro → preparador', s.passengerToPreparerCode, s.pickedUpByPreparerAt),
            adminPinChipRow('PIN B — Preparador → base', s.preparerToBaseCode, s.deliveredToBaseAt),
            adminPinChipRow('PIN C — Base → motorista', s.baseToDriverCode, s.pickedUpByDriverFromBaseAt),
            adminPinChipRow('PIN D — Motorista → destinatário', s.deliveryCode, s.deliveredAt),
            s.pickupCode?.trim()
              ? adminPinChipRow(
                  'PIN coleta direta (gerado no registro)',
                  s.pickupCode,
                  null,
                  'Com base, a cadeia validada é A→B→C→D; este código existe por compatibilidade técnica.',
                )
              : null,
          )
        : React.createElement(
            React.Fragment,
            null,
            adminPinChipRow('PIN — Coleta no remetente (motorista)', s.pickupCode, s.pickedUpAt),
            adminPinChipRow('PIN — Entrega ao destinatário', s.deliveryCode, s.deliveredAt),
          ),
    );
    return React.createElement('div', {
      key: s.id,
      style: { background: '#f6f6f6', borderRadius: 16, padding: '20px 24px', display: 'flex', flexDirection: 'column' as const, gap: 16 },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const } },
        s.photoUrl
          ? React.createElement('img', { src: s.photoUrl, alt: '', style: { width: 44, height: 44, borderRadius: 8, objectFit: 'cover' as const, flexShrink: 0 } })
          : React.createElement('div', { style: { width: 44, height: 44, borderRadius: 8, background: '#e2e2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 } }, '\u{1F4E6}'),
        encField('ID:', `#${String(s.id).slice(0, 8)}`, false, s.id),
        encField('Tamanho:', sizeLabel),
        encField('Valor:', fmtBRL(s.amountCents)),
        encField('Remetente:', s.senderName),
        encField('Destinatário:', s.recipientName),
        encField('Status:', shipmentStatusLabel(s.status))),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        encField('Recolha:', s.originAddress || '—', true),
        encField('Entrega:', s.destinationAddress || '—', true),
        s.instructions
          ? encField('Observações:', s.instructions, true)
          : React.createElement('div', { style: { flex: '1 1 0', minWidth: 0 } })),
      handoffPinsBlock,
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' } },
        (() => {
          const busyShip = supportCreateBusyKey === `ship:${s.id}`;
          const hasShip = !!s.supportConversationId?.trim();
          return React.createElement('button', {
            type: 'button',
            disabled: busyShip,
            'aria-busy': busyShip ? true : undefined,
            style: {
              ...webStyles.viagensActionBtn,
              ...(busyShip ? { opacity: 0.55 } : {}),
              cursor: busyShip ? 'wait' : 'pointer',
            },
            'aria-label': hasShip ? 'Abrir atendimento desta encomenda' : 'Criar ou abrir atendimento desta encomenda',
            title: hasShip
              ? 'Abrir o ticket de suporte já ligado a este envio.'
              : 'Cria um novo ticket para o cliente remetente (ou abre o ativo existente).',
            onClick: () => { void handleShipmentSupportClick(s); },
          }, atendimentoIconSvg);
        })()));
  };

  const encomendasSection = React.createElement('div', { style: { ...webStyles.detailPassageirosSection, borderBottom: 'none' } },
    React.createElement('h2', { style: webStyles.detailSectionTitle }, 'Encomendas'),
    linkedShipments.length === 0
      ? React.createElement('p', { style: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif', maxWidth: 560, lineHeight: 1.5 } },
          'Não há encomendas associadas a esta viagem agendada. Envios aparecem aqui quando estão atribuídos à mesma viagem do motorista.')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
          ...linkedShipments.map(shipmentRow)));

  const imageZoomModal = imageZoomOpen
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' as const,
          alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 9999,
          padding: 32,
        },
        onClick: () => setImageZoomOpen(false),
      },
        React.createElement('div', {
          style: {
            width: '100%', maxWidth: 900, height: 675, borderRadius: 14,
            overflow: 'hidden' as const, background: '#e8e8e8',
            display: 'flex', alignItems: 'stretch', justifyContent: 'stretch', flexShrink: 0,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement(MapView, {
            origin: tripCoords.origin,
            destination: tripCoords.destination,
            driverStart: driverStartCoord,
            currentPosition: liveVehicleMapPosition,
            waypoints: tripWaypoints.length > 0 ? tripWaypoints : undefined,
            height: 675,
            staticMode: false,
            connectPoints: true,
            followVehicle: acompanharTempoReal,
            followTarget: acompanharTempoReal && followTargetCoord ? followTargetCoord : undefined,
            onFollowVehicleInterrupted: onFollowVehicleInterrupted,
            tripCompleted: tripPainelConcluido,
            style: { borderRadius: 0, width: '100%', height: '100%' },
          })),
        React.createElement('button', {
          type: 'button',
          onClick: () => setImageZoomOpen(false),
          style: {
            width: '100%', maxWidth: 514, height: 48, background: 'rgba(255,255,255,0.95)',
            border: '1px solid #0d0d0d', borderRadius: 8, cursor: 'pointer',
            fontSize: 16, fontWeight: 500, color: '#0d0d0d', fontFamily: 'Inter, sans-serif',
          },
        }, 'Fechar'))
    : null;

  const driverField = (label: string, val: string) =>
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, fontFamily: 'Inter, sans-serif' } },
      React.createElement('span', { style: { color: '#767676', fontWeight: 500 } }, label),
      React.createElement('span', { style: { color: '#0d0d0d', fontWeight: 600 } }, val));

  type DriverCard = { nome: string; badge: string; rating: number; viagens: number; rota: string; data: string; horaSaida: string; valorTotal: string; valorUnitario: string; pessoasRestantes: string; ocupacao: string };

  const driverList: DriverCard[] = availDrivers.map((m) => ({
    nome: m.nome,
    badge: 'Motorista',
    rating: Number(m.rating ?? 0),
    viagens: m.totalViagens,
    rota: `${t.origem} → ${t.destino}`,
    data: t.data,
    horaSaida: t.embarque,
    valorTotal: '—',
    valorUnitario: '—',
    pessoasRestantes: '—',
    ocupacao: '—',
  }));

  const driverCard = (d: DriverCard, idx: number) =>
    React.createElement('button', {
      key: d.nome + idx, type: 'button',
      onClick: () => setSelectedDriver(idx),
      style: {
        flex: '1 1 calc(50% - 12px)', minWidth: 280, padding: 20, borderRadius: 16,
        border: selectedDriver === idx ? '2px solid #0d0d0d' : '1px solid #e2e2e2',
        background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, gap: 8, textAlign: 'left' as const,
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        React.createElement('div', { style: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          selectedDriver === idx ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
        React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: '#cba04b', fontFamily: 'Inter, sans-serif' } }, d.badge)),
      React.createElement('span', { style: { fontSize: 15, fontWeight: 700, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' } }, d.nome),
      React.createElement('span', { style: { fontSize: 12, color: '#767676', fontFamily: 'Inter, sans-serif' } }, `★ ${d.rating}  (${d.viagens} viagens)`),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginTop: 4 } },
        driverField('Origem - Destino', d.rota.length > 40 ? `${d.rota.slice(0, 40)}…` : d.rota),
        driverField('Data', d.data),
        driverField('Hora de saída', d.horaSaida),
        driverField('Valor total', d.valorTotal),
        driverField('Valor unitário', d.valorUnitario),
        driverField('Pessoas restantes', d.pessoasRestantes),
        driverField('Ocupação do bagageiro', d.ocupacao)));

  const motoristasDispSection = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' } },
    React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, fontFamily: 'Inter, sans-serif' } }, 'Motoristas disponíveis'),
    driverList.length === 0
      ? React.createElement('p', { style: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif' } }, 'Nenhum motorista listado.')
      : React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        ...driverList.map((d, i) => driverCard(d, i))),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
      React.createElement('button', {
        type: 'button',
        style: {
          height: 44, padding: '0 28px', borderRadius: 999, border: '1px solid #e2e2e2',
          background: '#fff', fontSize: 14, fontWeight: 600, color: '#0d0d0d', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
        },
      }, 'Confirmar substituição')));

  const contextSections = (isMotoristas
    ? [motoristasDispSection, passageirosSection, encomendasSection]
    : isPassageiros
      ? [passageirosSection, motoristaSection, encomendasSection]
      : [motoristaSection, passageirosSection, encomendasSection]
  ).filter(Boolean) as React.ReactElement[];

  const docToastEl = docActionToast
    ? React.createElement('div', {
      role: 'status',
      style: {
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 420,
        padding: '12px 20px',
        borderRadius: 12,
        backgroundColor: '#111827',
        color: '#fff',
        fontSize: 14,
        fontWeight: 500,
        fontFamily: 'Inter, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        zIndex: 9999,
        textAlign: 'center',
      },
    }, docActionToast)
    : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: webStyles.detailPage },
      firstSection,
      resumoSection,
      ocupacaoSection,
      ...contextSections),
    imageZoomModal,
    docToastEl);
}
