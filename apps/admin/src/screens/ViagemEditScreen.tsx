/**
 * ViagemEditScreen — Edit trip page (Figma node 802:24098).
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  webStyles,
  DETAIL_TRIP_MAP_HEIGHT,
  arrowBackSvg,
  starSvg,
  logoArrowSmallSvg,
  calendarIconSvg,
  statusPill,
  statusStyles,
  statusLabels,
  type ViagemRow,
} from '../styles/webStyles';
import {
  fetchBookingDetailForAdmin,
  fetchMotoristas,
  fetchShipmentsForScheduledTrip,
  fetchTripPassengers,
  updateBookingFields,
  updateScheduledTripFields,
  updateShipmentFields,
  createBookingForTripAsAdmin,
} from '../data/queries';
import type { BookingDetailForAdmin, MotoristaListItem, TripShipmentListItem, TripPassengerRow } from '../data/types';
import MapView from '../components/MapView';
import { useTripStops } from '../hooks/useTripStops';
import PlacesAddressInput, { type PlaceResolved } from '../components/PlacesAddressInput';
import { supabase } from '../lib/supabase';
import { resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import { useTripMapCoords } from '../hooks/useTripMapCoords';
import { geocodeAddress } from '../lib/googleGeocoding';
import { validateShipmentStopsAlongTripRoute } from '../lib/mapCoordUtils';

// ── Inline SVG icons ────────────────────────────────────────────────────
const closeXSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const checkSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const headsetSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M3 18v-6a9 9 0 0118 0v6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const trashSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z', stroke: '#b53838', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const editPencilSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const peopleSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const inventorySvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M20 8H4V6h16v2zM4 20h16v-2H4v2zm0-6h16v-2H4v2z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const chartSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 20V10M12 20V4M6 20v-6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const warningSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const clockSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#767676', strokeWidth: 2 }),
  React.createElement('path', { d: 'M12 6v6l4 2', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const starFilledSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', fill: '#F59E0B', stroke: '#F59E0B', strokeWidth: 1 }));
const addPlusSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// ── Shared style constants ──────────────────────────────────────────────
const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };
const inputStyle: React.CSSProperties = {
  width: '100%', height: 44, background: '#f1f1f1', border: 'none', borderRadius: 8,
  paddingLeft: 16, fontSize: 16, color: '#3a3a3a', outline: 'none', boxSizing: 'border-box',
  ...font,
};
const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: '#0d0d0d', marginBottom: 4, ...font };
const sectionTitle: React.CSSProperties = { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font };
const grayText: React.CSSProperties = { fontSize: 14, color: '#767676', ...font };
const boldText: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font };
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' };
const pillBtn = (bg: string, color: string, extra?: React.CSSProperties): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '8px 24px',
  borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  background: bg, color, ...font, ...(extra || {}),
});

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Mesmo padrão visual de `fmtDate` em queries (dd/mm/aaaa). */
function fmtDateBrFromLocalInput(localOrIso: string): string {
  const d = new Date(localOrIso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

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

function bagLabel(bags?: number): string {
  if (bags == null || !Number.isFinite(bags)) return '—';
  if (bags <= 1) return 'Pequena';
  if (bags <= 2) return 'Média';
  return 'Grande';
}

function cpfDigitsKey(cpf: string | undefined): string {
  return (cpf || '').replace(/\D/g, '');
}

/** Avatar do passageiro: `profiles.avatar_url` ou placeholder cinza se ausente / erro ao carregar. */
function PassengerAvatarCircle({ avatarUrl, name, size = 48 }: { avatarUrl: string | null; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!avatarUrl?.trim()) { setResolvedUrl(null); return; }
    let c = false;
    void resolveStorageDisplayUrl(supabase as any, avatarUrl.trim()).then((u) => { if (!c) setResolvedUrl(u); });
    return () => { c = true; };
  }, [avatarUrl]);
  const showImg = Boolean(resolvedUrl) && !failed;
  const initial = (name || '?').charAt(0).toUpperCase();
  return React.createElement('div', {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      background: '#e2e2e2',
      flexShrink: 0,
      overflow: 'hidden' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
    showImg
      ? React.createElement('img', {
        src: resolvedUrl!,
        alt: name || '',
        onError: () => setFailed(true),
        style: { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
      })
      : React.createElement('span', {
        style: { color: '#767676', fontSize: 18, fontWeight: 600, fontFamily: 'Inter, sans-serif' },
      }, initial));
}

export default function ViagemEditScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const stateTrip = (location.state as { trip?: ViagemRow } | null)?.trip ?? null;

  const [detail, setDetail] = useState<BookingDetailForAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [driversList, setDriversList] = useState<MotoristaListItem[]>([]);

  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [departureLocal, setDepartureLocal] = useState('');
  const [ocupacao, setOcupacao] = useState(0);
  const [selectedMotorista, setSelectedMotorista] = useState(0);
  const [tripShipments, setTripShipments] = useState<TripShipmentListItem[]>([]);
  const [tripPassengers, setTripPassengers] = useState<TripPassengerRow[]>([]);
  const [removePassageiroIdx, setRemovePassageiroIdx] = useState<number | null>(null);
  const [editEncomendaIdx, setEditEncomendaIdx] = useState<number | null>(null);
  const [editEncomendaData, setEditEncomendaData] = useState({ nome: '', recolha: '', entrega: '', destinatario: '', telefone: '', observacoes: '' });
  const [addEncomendaOpen, setAddEncomendaOpen] = useState(false);
  const [addEncomendaData, setAddEncomendaData] = useState({ recolha: '', entrega: '', destinatario: '', contato: '', valor: '', observacoes: '' });
  const [remetenteSearch, setRemetenteSearch] = useState('');
  const [remetenteResults, setRemetenteResults] = useState<any[]>([]);
  const [remetenteSearching, setRemetenteSearching] = useState(false);
  const [addEncomendaRemetenteUserId, setAddEncomendaRemetenteUserId] = useState<string | null>(null);
  const [addEncomendaRemetenteLabel, setAddEncomendaRemetenteLabel] = useState('');
  const [addEncPlaceOrigin, setAddEncPlaceOrigin] = useState<PlaceResolved | null>(null);
  const [addEncPlaceDest, setAddEncPlaceDest] = useState<PlaceResolved | null>(null);
  const [editEncPlaceOrigin, setEditEncPlaceOrigin] = useState<PlaceResolved | null>(null);
  const [editEncPlaceDest, setEditEncPlaceDest] = useState<PlaceResolved | null>(null);
  const [editEncCoordsHint, setEditEncCoordsHint] = useState<string | null>(null);
  const [addPassageiroOpen, setAddPassageiroOpen] = useState(false);
  const [addPassageiroData, setAddPassageiroData] = useState({ id: '', nome: '', contato: '', mala: '', valor: '' });
  const [malaDropdownOpen, setMalaDropdownOpen] = useState(false);
  // Nova reserva (fluxo B): passageiro cadastrado selecionado + nº de pessoas/bagagens + pagamento.
  const [addPaxUserId, setAddPaxUserId] = useState('');
  const [addPaxBags, setAddPaxBags] = useState('0');
  const [addPaxPagamento, setAddPaxPagamento] = useState<'cash' | 'pix'>('cash');
  const [addPaxTripPriceCents, setAddPaxTripPriceCents] = useState<number>(0);
  const [addPaxSaving, setAddPaxSaving] = useState(false);

  // Busca de passageiro no banco
  // Multi-ponto
  const tripIdForStops = detail?.listItem?.tripId || null;
  const { stops: tripStops, waypoints: tripWaypoints, regenerate: regenerateStops } = useTripStops(tripIdForStops);

  const [passengerSearch, setPassengerSearch] = useState('');
  const [passengerResults, setPassengerResults] = useState<any[]>([]);
  const [passengerSearching, setPassengerSearching] = useState(false);
  const searchPassengers = useCallback(async (query: string) => {
    if (query.trim().length < 2) { setPassengerResults([]); return; }
    setPassengerSearching(true);
    const q = query.trim().toLowerCase();
    const { data } = await (supabase as any)
      .from('profiles')
      .select('id, full_name, cpf, phone')
      .or(`full_name.ilike.%${q}%,cpf.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setPassengerResults(data || []);
    setPassengerSearching(false);
  }, []);

  const searchRemetenteProfiles = useCallback(async (query: string) => {
    if (query.trim().length < 2) { setRemetenteResults([]); return; }
    setRemetenteSearching(true);
    const q = query.trim().toLowerCase();
    const { data } = await (supabase as any)
      .from('profiles')
      .select('id, full_name, cpf, phone')
      .or(`full_name.ilike.%${q}%,cpf.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setRemetenteResults(data || []);
    setRemetenteSearching(false);
  }, []);

  // ── Mapa e Veículo ───────────────────────────────────────────────────
  const [tripCoords, setTripCoords] = useTripMapCoords(detail);
  const driverStartCoord = useMemo(() => {
    const d = tripStops.find((s) => s.stop_type === 'driver_origin' && s.lat != null && s.lng != null);
    if (d) return { lat: d.lat!, lng: d.lng! };
    if (tripCoords.vehicleOrigin) return tripCoords.vehicleOrigin;
    return undefined;
  }, [tripStops, tripCoords.vehicleOrigin]);

  /** Extremos da rota principal A→B (paradas ou `scheduled_trips`) — alinhamento de encomendas. */
  const motoristaRotaEnds = useMemo(() => {
    const da = tripStops.find((s) => s.stop_type === 'driver_origin' && s.lat != null && s.lng != null);
    const db = tripStops.find((s) => s.stop_type === 'trip_destination' && s.lat != null && s.lng != null);
    const a =
      (da ? { lat: da.lat!, lng: da.lng! } : undefined) ??
      tripCoords.scheduledRouteOrigin ??
      tripCoords.vehicleOrigin;
    const b = (db ? { lat: db.lat!, lng: db.lng! } : undefined) ?? tripCoords.scheduledRouteDestination;
    return { a, b };
  }, [
    tripStops,
    tripCoords.scheduledRouteOrigin,
    tripCoords.scheduledRouteDestination,
    tripCoords.vehicleOrigin,
  ]);
  const [vehicleInfo, setVehicleInfo] = useState<{ model: string; plate: string; year: number | null } | null>(null);

  // ── Image zoom modal (Figma 1170-26615) ──────────────────────────────
  const [imageZoomOpen, setImageZoomOpen] = useState(false);

  // ── Toast state ───────────────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => { setToastMsg(msg); }, []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    const s = detail?.listItem?.status;
    if (s === 'concluído' || s === 'cancelado') {
      setAddPassageiroOpen(false);
      setMalaDropdownOpen(false);
      setAddEncomendaOpen(false);
      setEditEncomendaIdx(null);
      setRemovePassageiroIdx(null);
    }
  }, [detail?.listItem?.status]);

  useEffect(() => {
    let cancel = false;
    const id = routeId;
    if (!id) {
      setLoading(false);
      setLoadError('ID da viagem ausente na URL.');
      return () => { cancel = true; };
    }
    setLoading(true);
    setLoadError(null);
    fetchBookingDetailForAdmin(id).then((d) => {
      if (cancel) return;
      if (!d) {
        setDetail(null);
        setLoadError('Reserva não encontrada.');
        setLoading(false);
        return;
      }
      setDetail(d);
      setLoading(false);
    });
    return () => { cancel = true; };
  }, [routeId]);

  useEffect(() => {
    fetchMotoristas().then((m) => setDriversList(m));
  }, []);

  useEffect(() => {
    const tripId = detail?.listItem?.tripId;
    if (!tripId) {
      setTripShipments([]);
      return;
    }
    let cancel = false;
    fetchShipmentsForScheduledTrip(tripId).then((rows) => {
      if (!cancel) setTripShipments(rows);
    });
    fetchTripPassengers(tripId).then((rows) => {
      if (!cancel) setTripPassengers(rows);
    });
    return () => { cancel = true; };
  }, [detail?.listItem?.tripId, detail?.listItem?.bookingId]);

  // Realtime: mantém a lista de passageiros/encomendas em dia quando reservas mudam
  // noutro lugar (ex.: cliente cancela pelo app). Não recarrega o formulário para não
  // sobrescrever edições em andamento no topo da tela.
  useEffect(() => {
    const tripId = detail?.listItem?.tripId;
    if (!tripId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void fetchTripPassengers(tripId).then(setTripPassengers);
        void fetchShipmentsForScheduledTrip(tripId).then(setTripShipments);
      }, 450);
    };
    const channel = supabase
      .channel(`admin-viagem-edit-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, refetch)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [detail?.listItem?.tripId]);

  // Veículo do motorista (coordenadas do mapa vêm de useTripMapCoords)
  useEffect(() => {
    if (!detail?.listItem?.tripId) return;
    let cancel = false;
    const driverId = detail.listItem.driverId;
    if (driverId) {
      (supabase as any).from('vehicles')
        .select('model, plate, year')
        .eq('worker_id', driverId)
        .eq('is_active', true)
        .limit(1)
        .single()
        .then(({ data }: any) => {
          if (!cancel && data) setVehicleInfo(data);
        });
    } else {
      setVehicleInfo(null);
    }
    return () => { cancel = true; };
  }, [detail?.listItem?.tripId, detail?.listItem?.driverId]);

  useEffect(() => {
    if (!detail) return;
    setOrigem(detail.originFull || detail.listItem.origem);
    setDestino(detail.destinationFull || detail.listItem.destino);
    setDepartureLocal(toDatetimeLocalValue(detail.listItem.departureAtIso));
    const trunk = detail.trunkOccupancyPct;
    setOcupacao(Number.isFinite(trunk) ? Math.min(100, Math.max(0, Math.round(trunk))) : 0);
  }, [detail]);

  useEffect(() => {
    if (!detail || !driversList.length) return;
    const idx = driversList.findIndex((m) => m.id === detail.listItem.driverId);
    setSelectedMotorista(idx >= 0 ? idx : 0);
  }, [detail?.listItem.driverId, detail?.listItem.bookingId, driversList]);

  const trip: ViagemRow | null = useMemo(() => {
    if (detail) return rowFromDetail(detail);
    return stateTrip;
  }, [detail, stateTrip]);

  /**
   * Viagem concluída ou cancelada: sem alterações no painel (preserva histórico e evita dados incoerentes).
   * Mesmo critério para rota, horário, bagageiro, motorista, passageiros e encomendas.
   */
  const canEditTrip =
    trip != null && trip.status !== 'concluído' && trip.status !== 'cancelado';
  const canChangeDriver = canEditTrip;
  const canEditPassengers = canEditTrip;

  const rotaLinha = useMemo(() => `${origem} → ${destino}`, [origem, destino]);
  const dataViagemFmt = useMemo(() => fmtDateBrFromLocalInput(departureLocal), [departureLocal]);
  const horaSaidaLocalFmt = useMemo(() => {
    if (!departureLocal) return '';
    const d = new Date(departureLocal);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [departureLocal]);

  const saveTrip = useCallback(async () => {
    if (!detail?.listItem.bookingId) return;
    if (detail.listItem.status === 'concluído' || detail.listItem.status === 'cancelado') {
      showToast('Viagens concluídas ou canceladas não podem ser alteradas.');
      return;
    }
    const depIso = fromDatetimeLocalValue(departureLocal);
    if (!depIso) {
      showToast('Defina um horário de partida válido.');
      return;
    }
    let oLat = tripCoords.origin?.lat ?? detail.originLat ?? null;
    let oLng = tripCoords.origin?.lng ?? detail.originLng ?? null;
    let dLat = tripCoords.destination?.lat ?? detail.destinationLat ?? null;
    let dLng = tripCoords.destination?.lng ?? detail.destinationLng ?? null;
    if (oLat == null || oLng == null) {
      const g = await geocodeAddress(origem);
      if (g) {
        oLat = g.lat;
        oLng = g.lng;
        setTripCoords((c) => ({ ...c, origin: { lat: g.lat, lng: g.lng } }));
      }
    }
    if (dLat == null || dLng == null) {
      const g = await geocodeAddress(destino);
      if (g) {
        dLat = g.lat;
        dLng = g.lng;
        setTripCoords((c) => ({ ...c, destination: { lat: g.lat, lng: g.lng } }));
      }
    }
    if (oLat == null || oLng == null || dLat == null || dLng == null) {
      showToast('Não foi possível obter coordenadas de origem e destino. Use as sugestões do Google ou configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.');
      return;
    }

    setSaving(true);
    const bErr = await updateBookingFields(detail.listItem.bookingId, {
      origin_address: origem,
      destination_address: destino,
      origin_lat: oLat,
      origin_lng: oLng,
      destination_lat: dLat,
      destination_lng: dLng,
    });
    let tErr: { error: string | null } = { error: null };
    const tripIdBefore = detail.listItem.tripId;
    if (detail.listItem.tripId && depIso) {
      const newDriverId = driversList[selectedMotorista]?.id ?? detail.listItem.driverId;
      tErr = await updateScheduledTripFields(detail.listItem.tripId, {
        departure_at: depIso,
        trunk_occupancy_pct: ocupacao,
        ...(newDriverId ? { driver_id: newDriverId } : {}),
      });
    }
    const err = bErr.error || tErr.error;
    if (err) {
      setSaving(false);
      showToast(err);
      return;
    }

    let recalcFailed = false;
    if (tripIdBefore) {
      try {
        await regenerateStops();
      } catch (e) {
        console.error(e);
        recalcFailed = true;
      }
    }

    const d2 = await fetchBookingDetailForAdmin(detail.listItem.bookingId);
    if (d2) setDetail(d2);
    const tid = (d2 ?? detail).listItem.tripId;
    if (tid) {
      const rows = await fetchShipmentsForScheduledTrip(tid);
      setTripShipments(rows);
    }
    setSaving(false);
    if (recalcFailed) {
      showToast('Alterações salvas, mas falha ao recalcular a rota. Tente salvar de novo.');
    } else if (tripIdBefore) {
      showToast('Viagem atualizada. Rota recalculada.');
    } else {
      showToast('Viagem atualizada com sucesso');
    }
  }, [detail, departureLocal, origem, destino, ocupacao, driversList, selectedMotorista, showToast, tripCoords, regenerateStops]);

  if (loading) {
    return React.createElement('div', { style: { ...webStyles.detailPage, padding: 40, fontFamily: 'Inter, sans-serif' } }, 'Carregando…');
  }

  if (loadError || !detail || !trip) {
    return React.createElement('div', { style: webStyles.detailPage },
      React.createElement('div', { style: webStyles.detailSection },
        React.createElement('p', null, loadError || 'Nenhuma viagem selecionada.'),
        React.createElement('button', { type: 'button', style: webStyles.detailBackBtn, onClick: () => navigate(-1) }, arrowBackSvg, 'Voltar à lista')));
  }

  // ── 1. Header Section ────────────────────────────────────────────────
  const headerSection = React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 32, display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' } },
    // Breadcrumb
    React.createElement('div', { style: webStyles.detailBreadcrumb },
      React.createElement('span', null, location.pathname.startsWith('/motoristas') ? 'Motoristas' : location.pathname.startsWith('/passageiros') ? 'Passageiros' : location.pathname.startsWith('/encomendas') ? 'Encomendas' : location.pathname.startsWith('/preparadores') ? 'Preparadores' : 'Viagens'),
      React.createElement('span', { style: { margin: '0 4px' } }, '\u203A'),
      React.createElement('span', { style: webStyles.detailBreadcrumbCurrent }, canEditTrip ? 'Editar viagem' : 'Ver viagem')),
    // Toolbar
    React.createElement('div', { style: webStyles.detailToolbar },
      React.createElement('button', { type: 'button', style: { ...webStyles.detailBackBtn, borderRadius: 999 }, onClick: () => navigate(-1) },
        arrowBackSvg, 'Voltar'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        React.createElement('button', { type: 'button', onClick: () => navigate(-1), style: pillBtn('#f1f1f1', '#b53838') }, closeXSvg, 'Cancelar'),
        React.createElement('button', {
          type: 'button',
          disabled: saving || !canEditTrip,
          title: !canEditTrip ? 'Viagem encerrada — somente visualização' : undefined,
          onClick: () => { void saveTrip(); },
          style: pillBtn('#0d0d0d', '#ffffff', saving || !canEditTrip ? { opacity: 0.45, cursor: 'not-allowed' } : undefined),
        }, checkSvg, saving ? 'Salvando…' : 'Salvar alteração'))),
    // Aviso: edição ativa vs. somente leitura
    canEditTrip
      ? React.createElement('div', { style: {
        display: 'flex', alignItems: 'center', gap: 8, background: '#fff8e6',
        border: '0.5px solid #cba04b', borderRadius: 8, height: 48, padding: '12px 8px 12px 16px',
      } },
        warningSvg,
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Você está editando esta viagem'))
      : React.createElement('div', { style: {
        display: 'flex', alignItems: 'center', gap: 8, background: '#f6f6f6',
        border: '0.5px solid #e2e2e2', borderRadius: 8, minHeight: 48, padding: '12px 8px 12px 16px',
      } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', ...font } },
          'Somente visualização. Viagens concluídas ou canceladas não podem ser alteradas para manter o histórico correto.')));

  // ── 2. Main Edit Form (two columns) ──────────────────────────────────
  const inputWithIcon = (icon: React.ReactNode, value: string, onChange: (v: string) => void) =>
    React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
      React.createElement('div', { style: { position: 'absolute' as const, left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' as const } }, icon),
      React.createElement('input', { type: 'text', value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value), style: { ...inputStyle, paddingLeft: 40 } }));

  const leftColumn = React.createElement('div', { style: { flex: 1, maxWidth: 581, display: 'flex', flexDirection: 'column' as const, gap: 24 } },
    // Mapa Mapbox GL (origem verde, destino vermelho, linha do trajeto) + ampliar
    React.createElement('div', { style: { position: 'relative' as const, borderRadius: 12, overflow: 'hidden', minHeight: DETAIL_TRIP_MAP_HEIGHT, height: DETAIL_TRIP_MAP_HEIGHT } },
      React.createElement(MapView, {
        origin: tripCoords.origin,
        destination: tripCoords.destination,
        driverStart: driverStartCoord,
        waypoints: tripWaypoints.length > 0 ? tripWaypoints : undefined,
        height: DETAIL_TRIP_MAP_HEIGHT,
        staticMode: false,
        connectPoints: true,
        tripCompleted: detail?.listItem?.status === 'concluído',
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
          ...font,
        },
      }, 'Ampliar mapa')),
    // Section title
    React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#767676', ...font } }, 'Trajeto de origem e destino'),
    // Origem
    React.createElement('div', { style: fieldWrap },
      React.createElement('label', { style: labelStyle }, 'Origem'),
      React.createElement(PlacesAddressInput, {
        value: origem,
        onChange: setOrigem,
        onPlaceResolved: (p) => {
          setOrigem(p.formattedAddress);
          setTripCoords((c) => ({ ...c, origin: { lat: p.lat, lng: p.lng } }));
        },
        inputStyle,
        placeholder: 'Buscar endereço de origem…',
        readOnly: !canEditTrip,
      })),
    // Destino
    React.createElement('div', { style: fieldWrap },
      React.createElement('label', { style: labelStyle }, 'Destino'),
      React.createElement(PlacesAddressInput, {
        value: destino,
        onChange: setDestino,
        onPlaceResolved: (p) => {
          setDestino(p.formattedAddress);
          setTripCoords((c) => ({ ...c, destination: { lat: p.lat, lng: p.lng } }));
        },
        inputStyle,
        placeholder: 'Buscar endereço de destino…',
        readOnly: !canEditTrip,
      })),
    // Horário agendado
    React.createElement('div', { style: fieldWrap },
      React.createElement('label', { style: labelStyle }, 'Horário agendado para início'),
      React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
        React.createElement('div', { style: { position: 'absolute' as const, left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' as const } }, calendarIconSvg),
        React.createElement('input', {
          type: 'datetime-local',
          value: departureLocal,
          disabled: !canEditTrip,
          title: !canEditTrip ? 'Viagem encerrada — não editável' : undefined,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDepartureLocal(e.target.value),
          style: {
            ...inputStyle, paddingLeft: 40,
            ...(!canEditTrip ? { opacity: 0.92, cursor: 'not-allowed' } : {}),
          },
        }))),
    canEditTrip
      ? React.createElement('span', { style: grayText }, 'Alterar o horário de início atualizará automaticamente o tempo estimado de chegada.')
      : null);

  const rightColumn = React.createElement('div', { style: { width: 308, flexShrink: 0, position: 'sticky' as const, top: 0, alignSelf: 'flex-start' as const, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
    // Resumo title
    React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#767676', ...font } }, `Resumo da viagem \u2022 #${String(detail.listItem.bookingId).slice(0, 8)}`),
    // Status pill
    React.createElement('div', { style: { alignSelf: 'flex-start' } },
      statusPill(statusLabels[trip.status] || 'Agendado', statusStyles[trip.status]?.bg || '#a8c6ef', statusStyles[trip.status]?.color || '#102d57')),
    // Rota
    React.createElement('div', { style: fieldWrap },
      React.createElement('label', { style: labelStyle }, 'Rota'),
      React.createElement('input', {
        type: 'text',
        value: rotaLinha,
        readOnly: true,
        title: 'Derivada de origem e destino',
        style: { ...inputStyle, opacity: 0.92, cursor: 'default' },
      })),
    // Horário de saída (espelha partida agendada)
    React.createElement('div', { style: fieldWrap },
      React.createElement('label', { style: labelStyle }, 'Horario de saída'),
      React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
        React.createElement('div', { style: { position: 'absolute' as const, left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' as const } }, clockSvg),
        React.createElement('input', {
          type: 'datetime-local',
          value: departureLocal,
          disabled: !canEditTrip,
          title: !canEditTrip ? 'Viagem encerrada — não editável' : undefined,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDepartureLocal(e.target.value),
          style: {
            ...inputStyle, paddingLeft: 40,
            ...(!canEditTrip ? { opacity: 0.92, cursor: 'not-allowed' } : {}),
          },
        }))),
    // Ocupação do bagageiro
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('span', { style: labelStyle }, 'Ocupação do bagageiro:'),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, ocupacao + '%')),
      React.createElement('div', { style: { position: 'relative' as const, width: '100%', height: 16, display: 'flex', alignItems: 'center' } },
        React.createElement('div', { style: { position: 'absolute' as const, top: '50%', transform: 'translateY(-50%)', left: 0, right: 0, height: 4, background: '#e2e2e2', borderRadius: 2 } }),
        React.createElement('div', { style: { position: 'absolute' as const, top: '50%', transform: 'translateY(-50%)', left: 0, width: ocupacao + '%', height: 4, background: 'rgba(203,160,75,0.7)', borderRadius: 2 } }),
        React.createElement('input', {
          type: 'range', min: 0, max: 100, value: ocupacao,
          disabled: !canEditTrip,
          title: !canEditTrip ? 'Viagem encerrada — não editável' : undefined,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOcupacao(Number(e.target.value)),
          style: {
            width: '100%', height: 16, opacity: 0,
            cursor: !canEditTrip ? 'not-allowed' : 'pointer',
            position: 'absolute' as const, left: 0, top: 0, margin: 0, zIndex: 2,
          },
        }),
        React.createElement('div', { style: {
          position: 'absolute' as const, top: '50%', transform: 'translate(-50%, -50%)',
          left: ocupacao + '%', width: 16, height: 16, borderRadius: '50%', background: '#cba04b',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)', pointerEvents: 'none' as const, zIndex: 1,
        } }))));

  const mainForm = React.createElement('div', { style: { display: 'flex', gap: 32, width: '100%' } },
    leftColumn, rightColumn);

  // ── 3. Motoristas disponíveis ────────────────────────────────────────
  type MotoristaCardRow = {
    name: string;
    badge: string;
    rating: string;
    trips: number;
    origemDestino: string;
    data: string;
    horaSaida: string;
    valorTotal: string;
    valorUnitario: string;
    pessoasRestantes: string;
    ocupacaoBag: string;
    avatarUrl: string | null;
  };

  const unitPassageiroCents =
    detail.passengerCount > 0 ? Math.round(detail.amountCents / detail.passengerCount) : detail.amountCents;
  const lugaresLivres =
    detail.seatsAvailable != null && Number.isFinite(detail.seatsAvailable)
      ? String(Math.max(0, detail.seatsAvailable))
      : '—';

  const motoristaRows: MotoristaCardRow[] = driversList.map((m) => ({
    name: m.nome,
    badge: 'Motorista',
    rating: m.rating != null ? String(m.rating) : '—',
    trips: m.totalViagens,
    origemDestino: rotaLinha,
    data: dataViagemFmt || trip.data,
    horaSaida: horaSaidaLocalFmt || trip.embarque,
    valorTotal: fmtBRL(detail.amountCents),
    valorUnitario: fmtBRL(unitPassageiroCents),
    pessoasRestantes: lugaresLivres,
    ocupacaoBag: `${ocupacao}%`,
    avatarUrl: m.avatarUrl,
  }));

  const motoristaInfoRow = (label: string, value: string) =>
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' } },
      React.createElement('span', { style: grayText }, label),
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, value));

  const motoristaCard = (m: MotoristaCardRow, idx: number) => {
    const isSelected = selectedMotorista === idx;
    return React.createElement('div', {
      key: driversList[idx]?.id ?? `motorista-${idx}`,
      style: {
        border: isSelected ? '2px solid #0d0d0d' : '1px solid #e2e2e2', borderRadius: 12,
        padding: '16px 24px', display: 'flex', flexDirection: 'column' as const, gap: 12, cursor: 'pointer',
        boxSizing: 'border-box' as const,
      },
      onClick: () => setSelectedMotorista(idx),
    },
      // Top: Avatar + badge + radio
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        React.createElement(PassengerAvatarCircle, { avatarUrl: m.avatarUrl, name: m.name, size: 56 }),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: '#ffefc2', marginBottom: 4 } },
            logoArrowSmallSvg,
            React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: '#0d0d0d', ...font } }, m.badge)),
          React.createElement('div', { style: boldText }, m.name),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            starFilledSvg,
            React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', ...font } }, m.rating),
            React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, '(' + m.trips + ' viagens concluídas)'))),
        // Radio button
        React.createElement('div', { style: {
          width: 20, height: 20, borderRadius: '50%', border: '2px solid ' + (isSelected ? '#0d0d0d' : '#767676'),
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        } },
          isSelected ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null)),
      // Separator
      React.createElement('div', { style: { height: 1, background: '#e2e2e2', width: '100%' } }),
      // Info rows
      motoristaInfoRow('Origem-Destino', m.origemDestino),
      motoristaInfoRow('Data', m.data),
      motoristaInfoRow('Hora de saída', m.horaSaida),
      motoristaInfoRow('Valor total', m.valorTotal),
      motoristaInfoRow('Valor unitário', m.valorUnitario),
      motoristaInfoRow('Lugares livres (viagem)', m.pessoasRestantes),
      motoristaInfoRow('Ocupação do bagageiro', m.ocupacaoBag));
  };

  const assignedDriverName =
    driversList.find((m) => m.id === detail.listItem.driverId)?.nome ?? '—';

  const motoristasSectionReadonly = React.createElement('div', { style: { borderTop: '1px solid #e2e2e2', paddingTop: 32, display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } },
    React.createElement('h2', { style: sectionTitle }, 'Motorista da viagem'),
    React.createElement('div', { style: { background: '#ffffff', border: '1px solid #e2e2e2', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      React.createElement('p', { style: { ...grayText, margin: 0 } },
        'Viagens concluídas ou canceladas não permitem substituir o motorista.'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: grayText }, 'Motorista atribuído'),
        React.createElement('span', { style: boldText }, assignedDriverName))));

  const motoristasSectionEditable = React.createElement('div', { style: { borderTop: '1px solid #e2e2e2', paddingTop: 32, display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } },
    React.createElement('h2', { style: sectionTitle }, 'Motoristas disponíveis'),
    React.createElement('div', { style: { background: '#ffffff', border: '1px solid #e2e2e2', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 24 } },
      // Date select
      React.createElement('div', { style: fieldWrap },
        React.createElement('label', { style: grayText }, 'Data da viagem'),
        React.createElement('div', { style: { position: 'relative' as const, width: '100%' } },
          React.createElement('div', { style: { position: 'absolute' as const, left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' as const } }, calendarIconSvg),
          React.createElement('input', {
            type: 'text',
            readOnly: true,
            value: dataViagemFmt,
            title: 'Use o horário agendado à esquerda para alterar data e hora',
            style: { ...inputStyle, paddingLeft: 40, opacity: 0.92, cursor: 'default' },
          }))),
      // 2x2 grid
      motoristaRows.length === 0
        ? React.createElement('p', { style: { ...grayText, margin: 0 } }, 'Nenhum motorista cadastrado.')
        : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
          ...motoristaRows.map(motoristaCard)),
      React.createElement('p', {
        style: { ...grayText, margin: 0, fontSize: 13, lineHeight: 1.45 },
      }, 'Motorista, endereços e horário são aplicados ao clicar em Salvar alteração no topo; a rota é recalculada automaticamente.')));

  const motoristasSection = canChangeDriver ? motoristasSectionEditable : motoristasSectionReadonly;

  // ── 4. Passageiros & Encomendas (Passageiros — Figma 844:19312) ─────
  const unitCents =
    detail.passengerCount > 0 ? Math.round(detail.amountCents / detail.passengerCount) : detail.amountCents;
  type PassageiroRow = {
    /** Reserva (`bookings.id`) a que este passageiro pertence (ações por-reserva). */
    bookingId: string;
    name: string;
    rating: string;
    mala: string;
    valor: string;
    /** `profiles.avatar_url` quando disponível (titular ou CPF em `passenger_data`). */
    avatarUrl: string | null;
    /** Perfil para "Ver histórico de viagens" (titular da reserva). */
    historicoUserId: string | null;
    /** Índice em `passenger_data` para remoção; null = titular exibido a partir do cliente da reserva. */
    passengerDataIndex: number | null;
    /** Titular da reserva (1º passageiro). */
    isPrimary: boolean;
  };
  /**
   * A viagem pode ter VÁRIAS reservas (várias pessoas compraram assento na mesma rota).
   * `tripPassengers` agrega os passageiros de todas as reservas do `scheduled_trip`. Enquanto
   * carrega (ou viagem sem reservas), cai no fallback: só os passageiros da reserva aberta.
   */
  let passageiros: PassageiroRow[];
  if (tripPassengers.length) {
    passageiros = tripPassengers.map((tp) => ({
      bookingId: tp.bookingId,
      name: tp.name,
      rating: '—',
      mala: bagLabel(tp.bagsRaw ?? undefined),
      valor: fmtBRL(tp.unitCents),
      avatarUrl: tp.avatarUrl,
      historicoUserId: tp.historicoUserId,
      passengerDataIndex: tp.passengerDataIndex,
      isPrimary: tp.isPrimary,
    }));
  } else {
    const totalPassengers = Math.max(1, detail.passengerCount || 1);
    const maxExtrasFromPassengerData = Math.max(0, totalPassengers - 1);
    passageiros = [{
      bookingId: detail.listItem.bookingId,
      name: detail.listItem.passageiro,
      rating: '—',
      mala: bagLabel(detail.bagsCount),
      valor: fmtBRL(unitCents),
      avatarUrl: detail.clientAvatarUrl ?? null,
      historicoUserId: detail.userId || null,
      passengerDataIndex: null,
      isPrimary: true,
    }];
    const seen = new Set<string>([detail.listItem.passageiro.trim().toLowerCase()]);
    let extrasAdded = 0;
    detail.passengerData.forEach((p, i) => {
      if (extrasAdded >= maxExtrasFromPassengerData) return;
      const n = (p.name || '').trim();
      if (!n) return;
      const k = n.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      extrasAdded += 1;
      passageiros.push({
        bookingId: detail.listItem.bookingId,
        name: n,
        rating: '—',
        mala: bagLabel(p.bags),
        valor: fmtBRL(unitCents),
        avatarUrl: detail.avatarUrlByPassengerCpfDigits[cpfDigitsKey(p.cpf)] ?? null,
        historicoUserId: null,
        passengerDataIndex: i,
        isPrimary: false,
      });
    });
  }

  const valorMedium: React.CSSProperties = { fontSize: 16, fontWeight: 500, color: '#0d0d0d', ...font };

  const passageiroCard = (p: PassageiroRow, idx: number) =>
    React.createElement('div', {
      key: `${p.name}-${idx}`,
      style: {
        background: '#f6f6f6',
        borderRadius: 12,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 16,
        width: '100%',
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid #e2e2e2', paddingBottom: 12 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, minWidth: 0, flex: 1 } },
            React.createElement(PassengerAvatarCircle, { avatarUrl: p.avatarUrl, name: p.name }),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, minWidth: 0 } },
              React.createElement('div', { style: boldText }, p.name),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                starFilledSvg,
                React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#545454', ...font } }, p.rating)))),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 } },
            React.createElement('button', {
              type: 'button',
              title: 'Suporte',
              style: { width: 40, height: 40, borderRadius: '50%', background: '#ffefc2', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
            }, headsetSvg),
            canEditPassengers
              ? React.createElement('button', {
                type: 'button',
                title: 'Remover passageiro',
                onClick: async () => {
                  if (!canEditPassengers) return;
                  if (p.passengerDataIndex === null) {
                    showToast('Este é o titular da reserva. Para removê-lo, cancele a reserva dele.');
                    return;
                  }
                  // Acompanhantes só podem ser removidos a partir da reserva aberta (temos o passenger_data dela).
                  if (p.bookingId !== detail.listItem.bookingId) {
                    showToast('Abra a reserva deste passageiro para removê-lo.');
                    return;
                  }
                  const currentData = [...(detail.passengerData || [])];
                  const newData = currentData.filter((_, i) => i !== p.passengerDataIndex);
                  const { error } = await updateBookingFields(detail.listItem.bookingId, {
                    passenger_data: newData,
                    passenger_count: Math.max(1, (detail.passengerCount || 1) - 1),
                  } as any);
                  if (error) { showToast(error); } else {
                    showToast('Passageiro removido');
                    const d2 = await fetchBookingDetailForAdmin(detail.listItem.bookingId);
                    if (d2) setDetail(d2);
                    const tid = detail.listItem.tripId;
                    if (tid) setTripPassengers(await fetchTripPassengers(tid));
                  }
                },
                style: { width: 40, height: 40, borderRadius: '50%', background: '#f1f1f1', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
              }, trashSvg)
              : null)),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
            React.createElement('span', { style: { ...grayText, fontWeight: 400 } }, 'Mala:'),
            React.createElement('span', { style: { ...valorMedium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, p.mala)),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
            React.createElement('span', { style: { ...grayText, fontWeight: 400 } }, 'Valor:'),
            React.createElement('span', { style: { ...valorMedium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, p.valor)))),
      React.createElement('button', {
        type: 'button',
        onClick: () => {
          if (!p.historicoUserId || !p.bookingId) {
            showToast('Histórico disponível para o titular da reserva cadastrado no sistema.');
            return;
          }
          navigate(`/passageiros/${p.historicoUserId}/viagem/${p.bookingId}/historico`);
        },
        style: {
          width: '100%',
          height: 44,
          borderRadius: 8,
          border: '1px solid #0d0d0d',
          background: '#ffffff',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
          color: '#0d0d0d',
          ...font,
          boxSizing: 'border-box' as const,
        },
      }, 'Ver histórico de viagens'));

  const passageirosSection = React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 16, minWidth: 0 } },
    React.createElement('h2', { style: sectionTitle }, 'Passageiros'),
    React.createElement('div', { style: { border: '1px solid #e2e2e2', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%', boxSizing: 'border-box' as const } },
      ...passageiros.map(passageiroCard),
      canEditPassengers
        ? React.createElement('button', {
          type: 'button',
          onClick: async () => {
            // Fluxo B: cria NOVA reserva para outro passageiro na mesma viagem.
            setAddPassageiroData({ id: '', nome: '', contato: '', mala: '', valor: '' });
            setAddPaxUserId(''); setAddPaxBags('0'); setAddPaxPagamento('cash');
            setAddPaxTripPriceCents(0); setAddPaxSaving(false);
            setPassengerSearch(''); setPassengerResults([]);
            setAddPassageiroOpen(true);
            const tid = detail?.listItem?.tripId;
            if (tid) {
              const { data: t } = await (supabase as any).from('scheduled_trips').select('price_per_person_cents').eq('id', tid).maybeSingle();
              setAddPaxTripPriceCents(Number(t?.price_per_person_cents ?? 0));
            }
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 44,
            width: '100%',
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            cursor: 'pointer',
            padding: '8px 24px',
            ...font,
          },
        }, addPlusSvg, React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', textDecoration: 'underline' } }, 'Adicionar'))
        : React.createElement('p', {
          style: { ...grayText, margin: 0, fontSize: 13 },
        }, 'Viagens concluídas ou canceladas não permitem alterar a lista de passageiros.')));

  const encomendas: {
    name: string;
    senderName: string;
    recolha: string;
    entrega: string;
    destinatario: string;
    observacoes: string;
    valor: string;
    telefone: string;
  }[] = tripShipments.map((s) => ({
    name: s.recipientName,
    senderName: s.senderName,
    recolha: s.originAddress.trim() ? s.originAddress : '—',
    entrega: s.destinationAddress.trim() ? s.destinationAddress : '—',
    destinatario: s.recipientName,
    observacoes: s.instructions?.trim() ? s.instructions : '—',
    valor: fmtBRL(s.amountCents),
    telefone: s.recipientPhone?.trim() ? s.recipientPhone : '',
  }));

  // ── Encomendas — Figma 844:19391 ─────────────────────────────────────
  const encLabel: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 400,
    color: '#767676',
    ...font,
    flexShrink: 0,
  };
  const encValue: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 500,
    color: '#0d0d0d',
    ...font,
    textAlign: 'right' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  };
  const encIconBtn: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#f1f1f1',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  };

  const encomendaInfoRowFigma = (labelWithColon: string, value: string) =>
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 } },
      React.createElement('span', { style: encLabel }, labelWithColon),
      React.createElement('span', { style: encValue }, value));

  const encomendaCard = (enc: typeof encomendas[0], idx: number) => {
    const destinatarioLinha = [enc.destinatario, enc.telefone].filter(Boolean).join(' • ') || '—';
    return React.createElement('div', {
      key: tripShipments[idx]?.id ?? idx,
      style: {
        background: '#f6f6f6',
        borderRadius: 12,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 12,
        width: '100%',
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          width: '100%',
          borderBottom: '1px solid #e2e2e2',
          paddingBottom: 12,
          gap: 12,
        },
      },
        React.createElement('div', { style: { ...boldText, minWidth: 0, flex: 1 } }, enc.name),
        canEditTrip
          ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 } },
            React.createElement('button', {
              type: 'button',
              title: 'Editar encomenda',
              onClick: () => {
                const row = tripShipments[idx];
                if (!row) return;
                const missingO = row.originLat == null || row.originLng == null;
                const missingD = row.destinationLat == null || row.destinationLng == null;
                setEditEncomendaIdx(idx);
                setEditEncCoordsHint(
                  missingO || missingD
                    ? 'Esta encomenda não tinha coordenadas gravadas. Escolha recolha e entrega de novo na lista do Google.'
                    : null,
                );
                setEditEncomendaData({
                  nome: enc.senderName && enc.senderName !== '—' ? enc.senderName : '',
                  recolha: missingO ? '' : row.originAddress,
                  entrega: missingD ? '' : row.destinationAddress,
                  destinatario: enc.destinatario,
                  telefone: enc.telefone,
                  observacoes: enc.observacoes === '—' ? '' : enc.observacoes,
                });
                setEditEncPlaceOrigin(
                  !missingO
                    ? {
                      formattedAddress: row.originAddress,
                      lat: row.originLat as number,
                      lng: row.originLng as number,
                      placeId: '',
                    }
                    : null,
                );
                setEditEncPlaceDest(
                  !missingD
                    ? {
                      formattedAddress: row.destinationAddress,
                      lat: row.destinationLat as number,
                      lng: row.destinationLng as number,
                      placeId: '',
                    }
                    : null,
                );
              },
              style: encIconBtn,
            }, editPencilSvg),
            React.createElement('button', {
              type: 'button',
              title: 'Desvincular encomenda desta viagem',
              onClick: async () => {
                if (!canEditTrip) return;
                const row = tripShipments[idx];
                if (!row) return;
                const { error } = await updateShipmentFields(row.id, { scheduled_trip_id: null });
                if (error) showToast(error);
                else {
                  showToast('Encomenda desvinculada desta viagem');
                  setTripShipments((prev) => prev.filter((x) => x.id !== row.id));
                }
              },
              style: encIconBtn,
            }, trashSvg))
          : null),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
        encomendaInfoRowFigma('Recolha:', enc.recolha),
        encomendaInfoRowFigma('Entrega:', enc.entrega),
        encomendaInfoRowFigma('Destinatário:', destinatarioLinha),
        encomendaInfoRowFigma('Observações:', enc.observacoes),
        encomendaInfoRowFigma('Valor:', enc.valor)));
  };

  const encomendasEmptyCard = React.createElement('div', {
    style: {
      background: '#f6f6f6',
      borderRadius: 12,
      padding: '24px 16px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('p', { style: { ...grayText, margin: 0, fontSize: 14, lineHeight: 1.5, textAlign: 'center' as const } },
      'Não há encomendas vinculadas a esta reserva no sistema.'));

  const encomendasAddBtn = React.createElement('button', {
    type: 'button',
    onClick: () => {
      setAddEncomendaOpen(true);
      setAddEncomendaData({ recolha: '', entrega: '', destinatario: '', contato: '', valor: '', observacoes: '' });
      setAddEncPlaceOrigin(null);
      setAddEncPlaceDest(null);
      setAddEncomendaRemetenteUserId(null);
      setAddEncomendaRemetenteLabel('');
      setRemetenteSearch('');
      setRemetenteResults([]);
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 44,
      width: '100%',
      border: 'none',
      borderRadius: 8,
      background: 'transparent',
      cursor: 'pointer',
      padding: '8px 24px',
      ...font,
    },
  }, addPlusSvg, React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', textDecoration: 'underline' } }, 'Adicionar'));

  const encomendasSection = React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 16, minWidth: 0 } },
    React.createElement('h2', { style: sectionTitle }, 'Encomendas'),
    React.createElement('div', {
      style: {
        border: '1px solid #e2e2e2',
        borderRadius: 12,
        padding: 24,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 16,
        width: '100%',
        boxSizing: 'border-box' as const,
      },
    },
      encomendas.length === 0
        ? encomendasEmptyCard
        : React.createElement(React.Fragment, null, ...encomendas.map(encomendaCard)),
      canEditTrip ? encomendasAddBtn : null,
      !canEditTrip
        ? React.createElement('p', { style: { ...grayText, margin: 0, fontSize: 13, textAlign: 'center' as const } },
          'Viagens concluídas ou canceladas não permitem alterar encomendas vinculadas.')
        : null));

  const passageirosEncomendasRow = React.createElement('div', { style: { display: 'flex', gap: 24, width: '100%' } },
    passageirosSection, encomendasSection);

  // ── 5. Métricas e histórico ──────────────────────────────────────────
  const metricas = [
    { title: 'Ocupação do bagageiro', icon: inventorySvg, value: `${ocupacao}%` },
    { title: 'Passageiros (reserva)', icon: peopleSvg, value: String(detail.passengerCount) },
    { title: 'Encomendas vinculadas', icon: chartSvg, value: String(tripShipments.length) },
  ];

  const metricCard = (m: typeof metricas[0], idx: number) =>
    React.createElement('div', { key: idx, style: { flex: 1, background: '#f6f6f6', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, m.title),
        React.createElement('div', { style: { width: 44, height: 44, borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, m.icon)),
      React.createElement('span', { style: { fontSize: 40, fontWeight: 700, color: '#0d0d0d', ...font } }, m.value));

  const metricasSection = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' } },
    React.createElement('h2', { style: sectionTitle }, 'Métricas e histórico'),
    React.createElement('div', { style: { display: 'flex', gap: 16, width: '100%' } },
      ...metricas.map(metricCard)));

  // ── 6. Histórico de alterações (sem auditoria completa — ao menos criação da reserva)
  const historico: { icon: React.ReactNode; action: string; name: string; date: string }[] = [];
  if (detail.bookingCreatedAtIso) {
    const dt = new Date(detail.bookingCreatedAtIso);
    const dateStr = Number.isNaN(dt.getTime())
      ? detail.bookingCreatedAtIso
      : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    historico.push({
      icon: clockSvg,
      action: 'Reserva registrada',
      name: detail.listItem.passageiro,
      date: dateStr,
    });
  }

  const historicoItem = (h: (typeof historico)[0], idx: number) =>
    React.createElement('div', { key: idx, style: { display: 'flex', alignItems: 'center', gap: 12, background: '#f6f6f6', borderRadius: 12, padding: 16 } },
      React.createElement('div', { style: { width: 40, height: 40, borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } }, h.icon),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 14, color: '#0d0d0d', ...font } },
          React.createElement('span', { style: { fontWeight: 600 } }, h.action),
          ' \u2022 ',
          React.createElement('span', { style: { color: '#cba04b', fontWeight: 600 } }, h.name)),
        React.createElement('div', { style: { fontSize: 14, color: '#767676', marginTop: 2, ...font } }, h.date)));

  const historicoSection = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' } },
    React.createElement('h2', { style: sectionTitle }, 'Histórico de alterações'),
    historico.length === 0
      ? React.createElement('p', { style: { ...grayText, margin: 0 } }, 'Não há mais registros no painel (auditoria detalhada indisponível).')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        ...historico.map(historicoItem)));

  // ── Remove passageiro modal (Figma 814-24464) ──────────────────────
  const removeModal = removePassageiroIdx !== null
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        },
        onClick: () => setRemovePassageiroIdx(null),
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: 16, padding: '24px 0', width: '100%', maxWidth: 400,
            boxShadow: '6px 6px 12px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' as const, gap: 24,
            alignItems: 'center',
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, paddingLeft: 16, paddingRight: 16, width: '100%', boxSizing: 'border-box' as const } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' } },
              React.createElement('div', { style: { maxWidth: 316 } },
                React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 'normal', ...font } },
                  'Tem certeza que deseja remover', React.createElement('br'), 'este passageiro?')),
              React.createElement('button', {
                type: 'button', 'aria-label': 'Fechar',
                onClick: () => setRemovePassageiroIdx(null),
                style: {
                  width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                },
              }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
                React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))))),
          // CTA buttons
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%', padding: '0 16px', boxSizing: 'border-box' as const } },
            React.createElement('button', {
              type: 'button',
              onClick: () => { setRemovePassageiroIdx(null); showToast('Passageiro removido com sucesso'); },
              style: {
                width: '100%', height: 48, background: '#f1f1f1', border: 'none', borderRadius: 8,
                cursor: 'pointer', fontSize: 16, fontWeight: 600, color: '#b53838', ...font,
              },
            }, 'Remover'),
            React.createElement('button', {
              type: 'button',
              onClick: () => setRemovePassageiroIdx(null),
              style: {
                width: '100%', height: 48, background: 'transparent', border: 'none', borderRadius: 8,
                cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#0d0d0d', ...font,
              },
            }, 'Voltar'))))
    : null;

  // ── Edit encomenda slide panel (Figma 814-26519) ────────────────────
  const editEncField = (label: string, key: keyof typeof editEncomendaData) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
      React.createElement('label', { style: labelStyle }, label),
      React.createElement('input', {
        type: 'text', value: editEncomendaData[key],
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditEncomendaData(prev => ({ ...prev, [key]: e.target.value })),
        style: inputStyle,
      }));

  const closeEditEncomendaPanel = () => {
    setEditEncomendaIdx(null);
    setEditEncCoordsHint(null);
    setEditEncPlaceOrigin(null);
    setEditEncPlaceDest(null);
  };

  const editEncomendaPanel = editEncomendaIdx !== null && canEditTrip
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 9999,
        },
        onClick: closeEditEncomendaPanel,
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: '16px 0 0 16px', width: '100%', maxWidth: 520,
            maxHeight: '100vh', boxShadow: '6px 6px 12px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column' as const, padding: '24px 32px 24px 32px',
            overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid #e2e2e2', marginBottom: 24, flexShrink: 0 } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Editar encomenda'),
            React.createElement('button', {
              type: 'button', 'aria-label': 'Fechar',
              onClick: closeEditEncomendaPanel,
              style: { width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
            }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
              React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
          // Fields
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, flex: 1 } },
            editEncCoordsHint
              ? React.createElement('p', { style: { ...grayText, margin: 0, fontSize: 12, lineHeight: 1.45 } }, editEncCoordsHint)
              : null,
            editEncField('Remetente (cliente)', 'nome'),
            React.createElement('div', { style: fieldWrap },
              React.createElement('label', { style: labelStyle }, 'Recolha'),
              React.createElement(PlacesAddressInput, {
                value: editEncomendaData.recolha,
                onChange: (v) => {
                  setEditEncomendaData((p) => ({ ...p, recolha: v }));
                  if (editEncPlaceOrigin && v !== editEncPlaceOrigin.formattedAddress) setEditEncPlaceOrigin(null);
                },
                onPlaceResolved: (p) => {
                  setEditEncPlaceOrigin(p);
                  setEditEncomendaData((prev) => ({ ...prev, recolha: p.formattedAddress }));
                },
                requireSelectionFromPlaces: true,
                committedFormattedAddress: editEncPlaceOrigin?.formattedAddress ?? '',
                inputStyle,
                placeholder: 'Buscar e toque em um endereço da lista',
              })),
            React.createElement('div', { style: fieldWrap },
              React.createElement('label', { style: labelStyle }, 'Entrega'),
              React.createElement(PlacesAddressInput, {
                value: editEncomendaData.entrega,
                onChange: (v) => {
                  setEditEncomendaData((p) => ({ ...p, entrega: v }));
                  if (editEncPlaceDest && v !== editEncPlaceDest.formattedAddress) setEditEncPlaceDest(null);
                },
                onPlaceResolved: (p) => {
                  setEditEncPlaceDest(p);
                  setEditEncomendaData((prev) => ({ ...prev, entrega: p.formattedAddress }));
                },
                requireSelectionFromPlaces: true,
                committedFormattedAddress: editEncPlaceDest?.formattedAddress ?? '',
                inputStyle,
                placeholder: 'Buscar e toque em um endereço da lista',
              })),
            editEncField('Destinatário', 'destinatario'),
            editEncField('Telefone do destinatário', 'telefone'),
            // Observações textarea
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                React.createElement('label', { style: labelStyle }, 'Observações'),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Opcional')),
              React.createElement('textarea', {
                value: editEncomendaData.observacoes,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setEditEncomendaData(prev => ({ ...prev, observacoes: e.target.value })),
                style: {
                  ...inputStyle, height: 100, paddingTop: 16, resize: 'vertical' as const,
                  lineHeight: 'normal', verticalAlign: 'top' as const,
                },
              }))),
          // Buttons
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 24, flexShrink: 0 } },
            React.createElement('button', {
              type: 'button',
              onClick: async () => {
                if (!canEditTrip) { showToast('Não é possível alterar encomendas nesta viagem.'); return; }
                if (editEncomendaIdx === null || !detail?.listItem?.tripId) return;
                const s = tripShipments[editEncomendaIdx];
                if (!s) {
                  closeEditEncomendaPanel();
                  return;
                }
                if (!editEncPlaceOrigin || !editEncPlaceDest) {
                  showToast('Selecione recolha e entrega na lista do Google.');
                  return;
                }
                const rotaCheckEdit = validateShipmentStopsAlongTripRoute(
                  motoristaRotaEnds.a,
                  motoristaRotaEnds.b,
                  { lat: editEncPlaceOrigin.lat, lng: editEncPlaceOrigin.lng },
                  { lat: editEncPlaceDest.lat, lng: editEncPlaceDest.lng },
                );
                if (!rotaCheckEdit.ok) {
                  showToast(rotaCheckEdit.message);
                  return;
                }
                const dest =
                  editEncomendaData.destinatario.trim() || editEncomendaData.nome.trim() || s.recipientName;
                let phone = editEncomendaData.telefone.trim();
                if (!phone) phone = s.recipientPhone?.trim() || '-';
                const { error } = await updateShipmentFields(s.id, {
                  origin_address: editEncPlaceOrigin.formattedAddress,
                  origin_lat: editEncPlaceOrigin.lat,
                  origin_lng: editEncPlaceOrigin.lng,
                  destination_address: editEncPlaceDest.formattedAddress,
                  destination_lat: editEncPlaceDest.lat,
                  destination_lng: editEncPlaceDest.lng,
                  recipient_name: dest,
                  recipient_phone: phone,
                  instructions: editEncomendaData.observacoes.trim() || null,
                });
                if (error) showToast(error);
                else {
                  showToast('Encomenda atualizada');
                  closeEditEncomendaPanel();
                  const rows = await fetchShipmentsForScheduledTrip(detail.listItem.tripId);
                  setTripShipments(rows);
                }
              },
              style: { width: '100%', height: 48, background: '#0d0d0d', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#fff', ...font },
            }, 'Salvar ajustes'),
            React.createElement('button', {
              type: 'button',
              onClick: closeEditEncomendaPanel,
              style: { width: '100%', height: 48, background: '#e2e2e2', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#b53838', ...font },
            }, 'Cancelar'))))
    : null;

  // ── Add encomenda slide panel (Figma 814-26848) ─────────────────────
  const addEncField = (label: string, key: keyof typeof addEncomendaData, placeholder: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
      React.createElement('label', { style: labelStyle }, label),
      React.createElement('input', {
        type: 'text', value: addEncomendaData[key], placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAddEncomendaData(prev => ({ ...prev, [key]: e.target.value })),
        style: { ...inputStyle, color: addEncomendaData[key] ? '#3a3a3a' : '#767676' },
      }));

  const addEncomendaPanel = addEncomendaOpen && canEditTrip
    ? React.createElement('div', {
        style: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 9999 },
        onClick: () => setAddEncomendaOpen(false),
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: '16px 0 0 16px', width: '100%', maxWidth: 520,
            maxHeight: '100vh', boxShadow: '6px 6px 12px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column' as const, padding: '24px 32px 24px 32px',
            overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid #e2e2e2', marginBottom: 24, flexShrink: 0 } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Adicionar encomenda'),
            React.createElement('button', {
              type: 'button', 'aria-label': 'Fechar',
              onClick: () => setAddEncomendaOpen(false),
              style: { width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
            }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
              React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
          // Fields
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, flex: 1 } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%', position: 'relative' as const } },
              React.createElement('label', { style: labelStyle }, 'Cliente remetente'),
              addEncomendaRemetenteUserId
                ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, ...inputStyle, paddingRight: 12 } },
                  React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, addEncomendaRemetenteLabel),
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => { setAddEncomendaRemetenteUserId(null); setAddEncomendaRemetenteLabel(''); setRemetenteSearch(''); setRemetenteResults([]); },
                    style: { flexShrink: 0, border: 'none', background: '#e2e2e2', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0d0d0d', ...font },
                  }, 'Trocar'))
                : React.createElement('input', {
                  type: 'text', value: remetenteSearch, placeholder: 'Nome, CPF ou telefone (mín. 2 caracteres)',
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    setRemetenteSearch(e.target.value);
                    searchRemetenteProfiles(e.target.value);
                  },
                  style: { ...inputStyle, color: remetenteSearch ? '#3a3a3a' : '#767676' },
                }),
              remetenteResults.length > 0 && !addEncomendaRemetenteUserId ? React.createElement('div', {
                style: {
                  position: 'absolute' as const, top: 76, left: 0, right: 0, background: '#fff',
                  borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 50,
                  maxHeight: 200, overflowY: 'auto' as const,
                },
              },
                ...remetenteResults.map((p: any) =>
                  React.createElement('button', {
                    key: p.id, type: 'button',
                    onClick: () => {
                      setAddEncomendaRemetenteUserId(p.id);
                      setAddEncomendaRemetenteLabel(p.full_name || 'Sem nome');
                      setRemetenteSearch('');
                      setRemetenteResults([]);
                    },
                    style: {
                      display: 'flex', flexDirection: 'column' as const, gap: 2, width: '100%',
                      padding: '10px 16px', background: 'none', border: 'none', borderBottom: '1px solid #e2e2e2',
                      cursor: 'pointer', textAlign: 'left' as const, ...font,
                    },
                  },
                    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d' } }, p.full_name || 'Sem nome'),
                    React.createElement('span', { style: { fontSize: 12, color: '#767676' } },
                      [p.cpf && `CPF: ${p.cpf}`, p.phone && `Tel: ${p.phone}`].filter(Boolean).join(' • '))))) : null,
              remetenteSearching ? React.createElement('span', { style: { fontSize: 12, color: '#767676', marginTop: 4, ...font } }, 'Buscando...') : null,
              !addEncomendaRemetenteUserId ? React.createElement('span', { style: { fontSize: 12, color: '#767676', marginTop: 2, ...font } },
                'Se não selecionar ninguém, a encomenda fica no cliente da reserva da viagem.') : null),
            React.createElement('p', {
              style: { ...grayText, margin: 0, fontSize: 12, lineHeight: 1.45 },
            }, 'Digite para buscar e escolha sempre um endereço da lista do Google — texto sem seleção não é aceite.'),
            motoristaRotaEnds.a && motoristaRotaEnds.b
              ? React.createElement('p', {
                style: { ...grayText, margin: 0, fontSize: 12, lineHeight: 1.45, color: '#5c5c5c' },
              }, `Recolha e entrega precisam acompanhar a rota principal desta viagem (${rotaLinha}). Endereços muito fora do percurso ou na ordem invertida não são aceitos.`)
              : null,
            React.createElement('div', { style: fieldWrap },
              React.createElement('label', { style: labelStyle }, 'Local de recolha'),
              React.createElement(PlacesAddressInput, {
                value: addEncomendaData.recolha,
                onChange: (v) => {
                  setAddEncomendaData((p) => ({ ...p, recolha: v }));
                  if (addEncPlaceOrigin && v !== addEncPlaceOrigin.formattedAddress) setAddEncPlaceOrigin(null);
                },
                onPlaceResolved: (p) => {
                  setAddEncPlaceOrigin(p);
                  setAddEncomendaData((prev) => ({ ...prev, recolha: p.formattedAddress }));
                },
                requireSelectionFromPlaces: true,
                committedFormattedAddress: addEncPlaceOrigin?.formattedAddress ?? '',
                inputStyle,
                placeholder: 'Buscar e toque em um endereço da lista',
              })),
            React.createElement('div', { style: fieldWrap },
              React.createElement('label', { style: labelStyle }, 'Local de entrega'),
              React.createElement(PlacesAddressInput, {
                value: addEncomendaData.entrega,
                onChange: (v) => {
                  setAddEncomendaData((p) => ({ ...p, entrega: v }));
                  if (addEncPlaceDest && v !== addEncPlaceDest.formattedAddress) setAddEncPlaceDest(null);
                },
                onPlaceResolved: (p) => {
                  setAddEncPlaceDest(p);
                  setAddEncomendaData((prev) => ({ ...prev, entrega: p.formattedAddress }));
                },
                requireSelectionFromPlaces: true,
                committedFormattedAddress: addEncPlaceDest?.formattedAddress ?? '',
                inputStyle,
                placeholder: 'Buscar e toque em um endereço da lista',
              })),
            addEncField('Nome do destinatário', 'destinatario', 'Ex: Roberto Santos'),
            addEncField('Contato destinatário', 'contato', 'Ex: (21) 98888-7777'),
            addEncField('Valor', 'valor', 'R$ 0,00'),
            // Observações textarea
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                React.createElement('label', { style: labelStyle }, 'Observações'),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Opcional')),
              React.createElement('textarea', {
                value: addEncomendaData.observacoes, placeholder: 'Informações adicionais',
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setAddEncomendaData(prev => ({ ...prev, observacoes: e.target.value })),
                style: { ...inputStyle, height: 80, paddingTop: 16, resize: 'vertical' as const, lineHeight: 'normal', verticalAlign: 'top' as const },
              }))),
          // Buttons
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 24, flexShrink: 0 } },
            React.createElement('button', {
              type: 'button', onClick: async () => {
                if (!canEditTrip) { showToast('Não é possível alterar encomendas nesta viagem.'); return; }
                if (!addEncomendaData.destinatario.trim()) { showToast('Preencha ao menos o destinatário.'); return; }
                const shipmentUserId = addEncomendaRemetenteUserId ?? detail?.userId ?? null;
                if (!shipmentUserId) {
                  showToast('Selecione o cliente remetente na busca ou use uma reserva com cliente vinculado.');
                  return;
                }
                const tripId = detail.listItem.tripId;
                if (!tripId) {
                  showToast('Viagem agendada ausente; não é possível vincular a encomenda.');
                  return;
                }
                if (!addEncPlaceOrigin || !addEncPlaceDest) {
                  showToast('Selecione local de recolha e local de entrega na lista do Google.');
                  return;
                }
                const rotaCheck = validateShipmentStopsAlongTripRoute(
                  motoristaRotaEnds.a,
                  motoristaRotaEnds.b,
                  { lat: addEncPlaceOrigin.lat, lng: addEncPlaceOrigin.lng },
                  { lat: addEncPlaceDest.lat, lng: addEncPlaceDest.lng },
                );
                if (!rotaCheck.ok) {
                  showToast(rotaCheck.message);
                  return;
                }
                const phone = addEncomendaData.contato.trim() || '-';
                const { error } = await (supabase as any).from('shipments').insert({
                  user_id: shipmentUserId,
                  scheduled_trip_id: tripId,
                  origin_address: addEncPlaceOrigin.formattedAddress,
                  origin_lat: addEncPlaceOrigin.lat,
                  origin_lng: addEncPlaceOrigin.lng,
                  destination_address: addEncPlaceDest.formattedAddress,
                  destination_lat: addEncPlaceDest.lat,
                  destination_lng: addEncPlaceDest.lng,
                  recipient_name: addEncomendaData.destinatario.trim(),
                  recipient_email: 'nao-informado@encomenda.placeholder',
                  recipient_phone: phone,
                  instructions: addEncomendaData.observacoes.trim() || null,
                  amount_cents: Math.round(parseFloat(addEncomendaData.valor.replace(/[^\d.,]/g, '').replace(',', '.') || '0') * 100),
                  package_size: 'medio',
                  status: 'confirmed',
                  when_option: 'now',
                  payment_method: 'pix',
                });
                if (error) { showToast(error.message || 'Erro ao criar encomenda'); } else {
                  showToast('Encomenda adicionada com sucesso');
                  const rows = await fetchShipmentsForScheduledTrip(tripId);
                  setTripShipments(rows);
                  setAddEncPlaceOrigin(null);
                  setAddEncPlaceDest(null);
                }
                setAddEncomendaOpen(false);
              },
              style: { width: '100%', height: 48, background: '#0d0d0d', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#fff', ...font },
            }, 'Adicionar encomenda'),
            React.createElement('button', {
              type: 'button', onClick: () => setAddEncomendaOpen(false),
              style: { width: '100%', height: 48, background: '#e2e2e2', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#b53838', ...font },
            }, 'Cancelar'))))
    : null;

  // ── Add passageiro slide panel (Figma 814-26985) ───────────────────
  const chevronDownSvgSmall = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  const malaOptions = ['Pequena', 'Média', 'Grande'];

  const addPassageiroField = (label: string, key: keyof typeof addPassageiroData, placeholder: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
      React.createElement('label', { style: labelStyle }, label),
      React.createElement('input', {
        type: 'text', value: addPassageiroData[key], placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAddPassageiroData(prev => ({ ...prev, [key]: e.target.value })),
        style: { ...inputStyle, color: addPassageiroData[key] ? '#3a3a3a' : '#767676' },
      }));

  const malaDropdown = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%', position: 'relative' as const } },
    React.createElement('label', { style: labelStyle }, 'Tamanho da mala'),
    React.createElement('button', {
      type: 'button',
      onClick: () => setMalaDropdownOpen(!malaDropdownOpen),
      style: {
        ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', textAlign: 'left' as const,
        color: addPassageiroData.mala ? '#3a3a3a' : '#767676',
      },
    },
      React.createElement('span', null, addPassageiroData.mala || 'Selecione o tamanho'),
      chevronDownSvgSmall),
    malaDropdownOpen
      ? React.createElement('div', {
          style: {
            position: 'absolute' as const, top: '100%', left: 0, right: 0, marginTop: 4,
            background: '#fff', borderRadius: 8, boxShadow: '6px 6px 12px rgba(0,0,0,0.15)',
            zIndex: 10, overflow: 'hidden' as const,
          },
        },
          ...malaOptions.map(opt =>
            React.createElement('button', {
              key: opt, type: 'button',
              onClick: () => { setAddPassageiroData(prev => ({ ...prev, mala: opt })); setMalaDropdownOpen(false); },
              style: {
                width: '100%', padding: '10px 16px', background: addPassageiroData.mala === opt ? '#f1f1f1' : '#fff',
                border: 'none', cursor: 'pointer', fontSize: 16, color: '#0d0d0d', textAlign: 'left' as const, ...font,
              },
            }, opt)))
      : null);

  const addPassageiroPanel = addPassageiroOpen && canEditTrip
    ? React.createElement('div', {
        style: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 9999 },
        onClick: () => { setAddPassageiroOpen(false); setMalaDropdownOpen(false); },
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: '16px 0 0 16px', width: '100%', maxWidth: 520,
            maxHeight: '100vh', boxShadow: '6px 6px 12px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column' as const, padding: '24px 32px',
            overflowY: 'auto' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          // Header
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid #e2e2e2', marginBottom: 24, flexShrink: 0 } },
            React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Adicionar passageiro'),
            React.createElement('button', {
              type: 'button', 'aria-label': 'Fechar',
              onClick: () => { setAddPassageiroOpen(false); setMalaDropdownOpen(false); },
              style: { width: 48, height: 48, borderRadius: '50%', background: '#f1f1f1', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
            }, React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
              React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
          // Fields
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, flex: 1 } },
            // Busca de passageiro existente
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%', position: 'relative' as const } },
              React.createElement('label', { style: labelStyle }, 'Buscar passageiro'),
              React.createElement('input', {
                type: 'text', value: passengerSearch, placeholder: 'CPF, nome ou telefone...',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  setPassengerSearch(e.target.value);
                  searchPassengers(e.target.value);
                },
                style: { ...inputStyle, color: passengerSearch ? '#3a3a3a' : '#767676' },
              }),
              passengerResults.length > 0 ? React.createElement('div', {
                style: {
                  position: 'absolute' as const, top: 76, left: 0, right: 0, background: '#fff',
                  borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 50,
                  maxHeight: 200, overflowY: 'auto' as const,
                },
              },
                ...passengerResults.map((p: any) =>
                  React.createElement('button', {
                    key: p.id, type: 'button',
                    onClick: () => {
                      setAddPassageiroData(prev => ({ ...prev, id: p.cpf || '', nome: p.full_name || '' }));
                      setAddPaxUserId(p.id);
                      setPassengerSearch('');
                      setPassengerResults([]);
                    },
                    style: {
                      display: 'flex', flexDirection: 'column' as const, gap: 2, width: '100%',
                      padding: '10px 16px', background: 'none', border: 'none', borderBottom: '1px solid #e2e2e2',
                      cursor: 'pointer', textAlign: 'left' as const, ...font,
                    },
                  },
                    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d' } }, p.full_name || 'Sem nome'),
                    React.createElement('span', { style: { fontSize: 12, color: '#767676' } },
                      [p.cpf && `CPF: ${p.cpf}`, p.phone && `Tel: ${p.phone}`].filter(Boolean).join(' • '))))) : null,
              passengerSearching ? React.createElement('span', { style: { fontSize: 12, color: '#767676', marginTop: 4, ...font } }, 'Buscando...') : null),
            // Passageiro selecionado (obrigatório — precisa de um cliente cadastrado p/ a reserva)
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
              React.createElement('label', { style: labelStyle }, 'Passageiro'),
              React.createElement('div', { style: { ...inputStyle, display: 'flex', alignItems: 'center', color: addPassageiroData.nome ? '#0d0d0d' : '#767676' } },
                addPassageiroData.nome ? `${addPassageiroData.nome}${addPassageiroData.id ? ` — ${addPassageiroData.id}` : ''}` : 'Busque e selecione um passageiro cadastrado')),
            // Nº de bagagens
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
              React.createElement('label', { style: labelStyle }, 'Nº de bagagens'),
              React.createElement('input', {
                type: 'number', min: 0, value: addPaxBags,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAddPaxBags(e.target.value.replace(/[^0-9]/g, '')),
                style: inputStyle,
              })),
            // Forma de pagamento
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, width: '100%' } },
              React.createElement('label', { style: labelStyle }, 'Forma de pagamento'),
              React.createElement('div', { style: { display: 'flex', gap: 8 } },
                ...([['cash', 'Dinheiro'], ['pix', 'Pix']] as const).map(([v, l]) =>
                  React.createElement('button', {
                    key: v, type: 'button', onClick: () => setAddPaxPagamento(v),
                    style: { height: 40, padding: '0 18px', borderRadius: 999, border: addPaxPagamento === v ? 'none' : '1px solid #e2e2e2', background: addPaxPagamento === v ? '#0d0d0d' : '#fff', color: addPaxPagamento === v ? '#fff' : '#0d0d0d', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font },
                  }, l)))),
            // Valor total (preview a partir do preço/pessoa da viagem)
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, width: '100%' } },
              React.createElement('label', { style: labelStyle }, 'Valor total'),
              React.createElement('div', { style: { ...inputStyle, display: 'flex', alignItems: 'center', color: '#0d0d0d' } },
                addPaxTripPriceCents > 0
                  ? `R$ ${(addPaxTripPriceCents / 100).toFixed(2).replace('.', ',')}`
                  : 'Viagem sem preço definido — será criada com R$ 0,00'))),
          // Buttons
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 24, flexShrink: 0 } },
            React.createElement('button', {
              type: 'button', disabled: addPaxSaving, onClick: async () => {
                if (!canEditTrip) { showToast('Não é possível adicionar passageiros nesta viagem.'); return; }
                const tid = detail?.listItem?.tripId;
                if (!tid) { showToast('Viagem não identificada.'); return; }
                if (!addPaxUserId || !addPassageiroData.nome.trim()) { showToast('Busque e selecione um passageiro cadastrado.'); return; }
                const pax = 1; // 1 passagem por passageiro selecionado
                const bags = Math.max(0, parseInt(addPaxBags || '0', 10) || 0);
                setAddPaxSaving(true);
                const res = await createBookingForTripAsAdmin({
                  scheduledTripId: tid,
                  userId: addPaxUserId,
                  passengerName: addPassageiroData.nome.trim(),
                  passengerCpf: addPassageiroData.id.trim(),
                  passengerCount: pax,
                  bagsCount: bags,
                  paymentMethod: addPaxPagamento,
                });
                setAddPaxSaving(false);
                if (res.error) { showToast(res.error); return; }
                showToast(`Reserva criada${typeof res.amountCents === 'number' ? ` — R$ ${(res.amountCents / 100).toFixed(2).replace('.', ',')}` : ''}`);
                setAddPassageiroOpen(false); setMalaDropdownOpen(false);
                // Atualiza a lista para o novo passageiro aparecer na hora.
                if (tid) setTripPassengers(await fetchTripPassengers(tid));
              },
              style: { width: '100%', height: 48, background: '#0d0d0d', border: 'none', borderRadius: 8, cursor: addPaxSaving ? 'wait' : 'pointer', opacity: addPaxSaving ? 0.6 : 1, fontSize: 16, fontWeight: 500, color: '#fff', ...font },
            }, addPaxSaving ? 'Criando...' : 'Adicionar passageiro'),
            React.createElement('button', {
              type: 'button', onClick: () => { setAddPassageiroOpen(false); setMalaDropdownOpen(false); },
              style: { width: '100%', height: 48, background: '#e2e2e2', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 500, color: '#b53838', ...font },
            }, 'Cancelar'))))
    : null;

  // ── Toast (Figma 814-24562) ─────────────────────────────────────────
  const checkCircleSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 12, cy: 12, r: 11, fill: '#fff' }),
    React.createElement('path', { d: 'M9 12l2 2 4-4', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  const toastEl = toastMsg
    ? React.createElement('div', {
        key: toastMsg,
        style: {
          position: 'fixed' as const, bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: '#0d0d0d', borderRadius: 12, padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: 12, zIndex: 10000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          whiteSpace: 'nowrap' as const,
          opacity: 1,
        },
      },
        checkCircleSvg,
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#fff', ...font } }, toastMsg))
    : null;

  // ── Image zoom modal (Figma 1170-26615) ──────────────────────────────
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
        // Enlarged image area
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
            waypoints: tripWaypoints.length > 0 ? tripWaypoints : undefined,
            height: 675,
            staticMode: false,
            connectPoints: true,
            tripCompleted: detail?.listItem?.status === 'concluído',
            style: { borderRadius: 0, width: '100%', height: '100%' },
          })),
        // Fechar button
        React.createElement('button', {
          type: 'button',
          onClick: () => setImageZoomOpen(false),
          style: {
            width: '100%', maxWidth: 514, height: 48, background: 'transparent',
            border: '1px solid #0d0d0d', borderRadius: 8, cursor: 'pointer',
            fontSize: 16, fontWeight: 500, color: '#0d0d0d', ...font,
            backgroundColor: 'rgba(255,255,255,0.95)',
          },
        }, 'Fechar'))
    : null;

  // Mapa do trajeto integrado no leftColumn (sem seção separada)

  // ── Info do veículo ─────────────────────────────────────────────────
  const vehicleSection = vehicleInfo ? React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 12, width: '100%', paddingBottom: 24, borderBottom: '1px solid #e2e2e2' },
  },
    React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Veículo'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      React.createElement('div', { style: { flex: '1 1 200px', background: '#f6f6f6', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Modelo'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, vehicleInfo.model || '—')),
      React.createElement('div', { style: { flex: '1 1 150px', background: '#f6f6f6', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Placa'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, vehicleInfo.plate || '—')),
      React.createElement('div', { style: { flex: '1 1 100px', background: '#f6f6f6', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Ano'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, vehicleInfo.year ? String(vehicleInfo.year) : '—')))) : null;

  // ── Final render ─────────────────────────────────────────────────────
  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: webStyles.detailPage },
      headerSection,
      mainForm,
      vehicleSection,
      motoristasSection,
      passageirosEncomendasRow,
      metricasSection,
      historicoSection,
      removeModal,
      editEncomendaPanel,
      addEncomendaPanel,
      addPassageiroPanel,
      imageZoomModal),
    toastEl);
}
