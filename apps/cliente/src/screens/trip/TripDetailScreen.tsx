import { useState, useEffect, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Platform,
  Modal,
  TextInput,
  Alert,
  Clipboard,
  Share,
} from 'react-native';
import { Text } from '../../components/Text';
import { useRootNavigation } from '../../navigation/RootNavigationContext';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SupportSheet } from '../../components/SupportSheet';
import {
  MapboxMap,
  MapboxMarker,
  MapboxPolyline,
  isValidTripCoordinate,
  sanitizeMapRegion,
} from '../../components/mapbox';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import { supabase } from '../../lib/supabase';
import { tryOpenSupportTicket } from '../../lib/supportTickets';
import { getRouteWithDuration, formatDuration, type RoutePoint } from '../../lib/route';
import { LiveDriverMapMarker } from '../../components/LiveDriverMapMarker';
import { useScheduledTripLiveLocation } from '../../lib/useScheduledTripLiveLocation';
import { StatusBadge, clientViagemStatusBadge } from '../../components/StatusBadge';
import type { TripLiveDriverDisplay } from '../../navigation/types';
import { parsePassengerData } from '../../lib/clientBookingTripLive';
import { formatVehicleDescription, formatTripFareBrl } from '../../lib/tripDriverDisplay';
import { onlyDigits } from '../../utils/formatCpf';
import { TipModal } from '../../components/TipModal';
import { formatTripCode } from '@take-me/shared';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'TripDetail'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  accent: '#EAB308',
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatCpfDisplay(digits: string): string {
  const d = onlyDigits(digits);
  if (d.length !== 11) return digits;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatDetailDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  const month = months[d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} • ${hours}:${minutes}`;
}

/** Um dígito por chip (PIN no BD, normalmente 4 dígitos) — mesmo padrão de `ShipmentDetailScreen`. */
function pinCharsForDisplay(code: string | null | undefined): string[] {
  const s = (code ?? '').trim();
  if (!s) return ['—', '—', '—', '—'];
  const chars = s.split('');
  const out: string[] = [];
  for (let i = 0; i < 4; i += 1) out.push(chars[i] ?? '—');
  return out;
}

type BookingDetail = {
  id: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  amount_cents: number;
  status: string;
  created_at: string;
  departure_time: string;
  arrival_time: string;
  driver_name: string;
  driver_avatar_url: string | null;
  driver_id: string | null;
  /** `scheduled_trips.status` — active | completed | cancelled */
  trip_status: string | null;
  driver_journey_started_at: string | null;
  cancellation_reason: string | null;
  scheduled_trip_id: string | null;
  /** ISO da partida, para cálculo da janela de reembolso. */
  departure_at: string | null;
  passenger_count: number;
  bags_count: number;
  passenger_data: unknown;
  driver_rating: number;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  pickup_code: string | null;
  delivery_code: string | null;
  tip_cents: number | null;
  tip_status: string | null;
  tip_paid_at: string | null;
};

type TripShipmentRow = {
  id: string;
  package_size: string;
  status: string;
  recipient_name: string;
};

type TripDependentShipmentRow = {
  id: string;
  full_name: string;
  pickup_code: string | null;
  delivery_code: string | null;
  status: string;
};

type PassengerBookingRating = { rating: number; comment: string | null };

function shipmentPackageLabelPt(size: string): string {
  if (size === 'pequeno') return 'Pequeno';
  if (size === 'grande') return 'Grande';
  return 'Médio';
}

export function TripDetailScreen({ navigation, route }: Props) {
  const { navigateToTripStack } = useRootNavigation();
  const bookingId = route.params?.bookingId ?? '';
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [tripShipments, setTripShipments] = useState<TripShipmentRow[]>([]);
  const [tripDependentShipments, setTripDependentShipments] = useState<TripDependentShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [routeCoords, setRouteCoords] = useState<RoutePoint[] | null>(null);
  const [routeDuration, setRouteDuration] = useState<string | null>(null);
  const [showCancelTripModal, setShowCancelTripModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showRescheduleConsentModal, setShowRescheduleConsentModal] = useState(false);
  /** Janela de reembolso integral (horas) lida em `platform_settings`. */
  const [freeWindowHours, setFreeWindowHours] = useState<number>(2);
  const [supportSheetVisible, setSupportSheetVisible] = useState(false);
  const [tipModalVisible, setTipModalVisible] = useState(false);
  /** `undefined` = ainda a carregar; `null` = sem linha em `booking_ratings`. */
  const [passengerBookingRating, setPassengerBookingRating] = useState<
    PassengerBookingRating | null | undefined
  >(undefined);
  const insets = useSafeAreaInsets();

  async function performBookingCancellation(): Promise<{
    ok: boolean;
    refunded: boolean;
    refundAmountCents: number;
    error?: string;
  }> {
    setCancelLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-booking', {
        body: { booking_id: bookingId },
      });
      if (error) {
        return { ok: false, refunded: false, refundAmountCents: 0, error: error.message };
      }
      const payload = (data ?? {}) as {
        cancelled?: boolean;
        refunded?: boolean;
        refund_amount_cents?: number;
        error?: string;
      };
      if (payload.error) {
        return { ok: false, refunded: false, refundAmountCents: 0, error: payload.error };
      }
      const refunded = Boolean(payload.refunded);
      const refundAmountCents = Math.max(0, Math.floor(Number(payload.refund_amount_cents ?? 0)));
      return { ok: Boolean(payload.cancelled), refunded, refundAmountCents };
    } catch (e) {
      return {
        ok: false,
        refunded: false,
        refundAmountCents: 0,
        error: e instanceof Error ? e.message : 'Erro desconhecido',
      };
    } finally {
      setCancelLoading(false);
    }
  }

  async function handleCancelTrip() {
    const result = await performBookingCancellation();
    if (result.ok) {
      setShowCancelTripModal(false);
      if (result.refunded) {
        Alert.alert(
          'Viagem cancelada',
          `Seu reembolso integral foi iniciado e retornará ao cartão em 5 a 10 dias.${
            result.refundAmountCents > 0
              ? `\n\nValor: R$ ${(result.refundAmountCents / 100).toFixed(2).replace('.', ',')}`
              : ''
          }`,
        );
      } else {
        Alert.alert(
          'Viagem cancelada',
          'A viagem foi cancelada. Como o prazo para reembolso integral já passou, não há estorno automático. Se desejar solicitar uma análise, abra um chamado no suporte.',
        );
        void tryOpenSupportTicket('reembolso', { booking_id: bookingId });
      }
      navigation.goBack();
    } else {
      Alert.alert('Erro', result.error ?? 'Não foi possível cancelar a viagem. Tente novamente.');
    }
  }

  async function handleRescheduleConfirm() {
    if (!detail) return;
    const origin = {
      address: detail.origin_address,
      latitude: detail.origin_lat,
      longitude: detail.origin_lng,
    };
    const destination = {
      address: detail.destination_address,
      latitude: detail.destination_lat,
      longitude: detail.destination_lng,
    };
    const result = await performBookingCancellation();
    if (!result.ok) {
      Alert.alert(
        'Erro',
        result.error ?? 'Não foi possível cancelar a viagem para reagendar. Tente novamente.',
      );
      return;
    }
    setShowRescheduleConsentModal(false);
    navigateToTripStack('PlanRide', { origin, destination });
    navigation.goBack();
  }

  useEffect(() => {
    if (!bookingId) {
      setTripShipments([]);
      setTripDependentShipments([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setPassengerBookingRating(undefined);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPassengerBookingRating(null);
        setLoading(false);
        return;
      }
      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .select(
          'id, origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng, amount_cents, status, created_at, scheduled_trip_id, passenger_count, bags_count, passenger_data, pickup_code, delivery_code, cancellation_reason, tip_cents, tip_status, tip_paid_at'
        )
        .eq('id', bookingId)
        .eq('user_id', user.id)
        .single();
      if (cancelled || bookErr || !booking) {
        if (!cancelled) setTripShipments([]);
        if (!cancelled) setTripDependentShipments([]);
        if (!cancelled) setPassengerBookingRating(null);
        setLoading(false);
        return;
      }
      const { data: tripRaw } = await supabase
        .from('scheduled_trips')
        .select('departure_at, arrival_at, driver_id, status, driver_journey_started_at')
        .eq('id', booking.scheduled_trip_id)
        .single();
      const trip = tripRaw as {
        departure_at: string | null;
        arrival_at: string | null;
        driver_id: string | null;
        status: string | null;
        driver_journey_started_at: string | null;
      } | null;
      let driverName = 'Motorista';
      let driverAvatarUrl: string | null = null;
      let driverRating = 0;
      let vehicleModel: string | null = null;
      let vehicleYear: number | null = null;
      let vehiclePlate: string | null = null;
      if (trip?.driver_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, rating')
          .eq('id', trip.driver_id)
          .single();
        driverName = profile?.full_name ?? driverName;
        driverAvatarUrl = profile?.avatar_url ?? null;
        driverRating = Number(profile?.rating ?? 0);
        const sb = supabase as { from: (table: string) => any };
        const { data: vehicleRow } = await sb
          .from('vehicles')
          .select('model, year, plate')
          .eq('worker_id', trip.driver_id)
          .eq('is_active', true)
          .eq('status', 'approved')
          .limit(1)
          .maybeSingle();
        const v = vehicleRow as { model?: string | null; year?: number | null; plate?: string | null } | null;
        vehicleModel = v?.model?.trim() ? v.model : null;
        vehicleYear = v?.year != null ? Number(v.year) : null;
        vehiclePlate = v?.plate?.trim() ? v.plate : null;
      }
      const depTime = trip?.departure_at ? new Date(trip.departure_at).toTimeString().slice(0, 5) : '—';
      const arrTime = trip?.arrival_at ? new Date(trip.arrival_at).toTimeString().slice(0, 5) : '—';
      const b = booking as {
        passenger_count?: number;
        bags_count?: number;
        passenger_data?: unknown;
        scheduled_trip_id?: string | null;
      };
      setDetail({
        id: booking.id,
        origin_address: booking.origin_address,
        origin_lat: booking.origin_lat,
        origin_lng: booking.origin_lng,
        destination_address: booking.destination_address,
        destination_lat: booking.destination_lat,
        destination_lng: booking.destination_lng,
        amount_cents: booking.amount_cents,
        status: booking.status,
        created_at: booking.created_at,
        departure_time: depTime,
        arrival_time: arrTime,
        driver_name: driverName,
        driver_avatar_url: driverAvatarUrl,
        driver_id: trip?.driver_id ?? null,
        trip_status: trip?.status ?? null,
        driver_journey_started_at: trip?.driver_journey_started_at ?? null,
        cancellation_reason: (booking as { cancellation_reason?: string | null }).cancellation_reason ?? null,
        scheduled_trip_id: b.scheduled_trip_id ?? null,
        departure_at: (trip as { departure_at?: string | null } | null)?.departure_at ?? null,
        passenger_count: Number(b.passenger_count ?? 0),
        bags_count: Number(b.bags_count ?? 0),
        passenger_data: b.passenger_data ?? [],
        driver_rating: driverRating,
        vehicle_model: vehicleModel,
        vehicle_year: vehicleYear,
        vehicle_plate: vehiclePlate,
        pickup_code: (booking as { pickup_code?: string | null }).pickup_code ?? null,
        delivery_code: (booking as { delivery_code?: string | null }).delivery_code ?? null,
        tip_cents: (booking as { tip_cents?: number | null }).tip_cents ?? null,
        tip_status: (booking as { tip_status?: string | null }).tip_status ?? null,
        tip_paid_at: (booking as { tip_paid_at?: string | null }).tip_paid_at ?? null,
      });
      const tripId = b.scheduled_trip_id ?? null;
      if (tripId && !cancelled) {
        const { data: shipRows } = await supabase
          .from('shipments')
          .select('id, package_size, status, recipient_name')
          .eq('scheduled_trip_id', tripId)
          .eq('user_id', user.id);
        if (!cancelled) {
          setTripShipments((shipRows ?? []) as TripShipmentRow[]);
        }
        const { data: depRows } = await supabase
          .from('dependent_shipments')
          .select('id, full_name, pickup_code, delivery_code, status')
          .eq('scheduled_trip_id', tripId)
          .eq('user_id', user.id);
        if (!cancelled) {
          setTripDependentShipments((depRows ?? []) as TripDependentShipmentRow[]);
        }
      } else if (!cancelled) {
        setTripShipments([]);
        setTripDependentShipments([]);
      }
      if (!cancelled && booking.id) {
        const { data: br } = await supabase
          .from('booking_ratings')
          .select('rating, comment')
          .eq('booking_id', booking.id)
          .maybeSingle();
        if (!cancelled) {
          setPassengerBookingRating(
            br ? { rating: Number(br.rating), comment: br.comment ?? null } : null
          );
        }
      } else if (!cancelled) {
        setPassengerBookingRating(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'booking_cancellation_free_window_hours')
          .maybeSingle();
        if (cancelled) return;
        const raw = (data as { value?: unknown } | null)?.value;
        const val =
          raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
            ? Number((raw as { value: unknown }).value)
            : Number(raw);
        if (Number.isFinite(val) && val >= 0) setFreeWindowHours(val);
      } catch {
        // mantém fallback
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (
      !detail ||
      !isValidTripCoordinate(detail.origin_lat, detail.origin_lng) ||
      !isValidTripCoordinate(detail.destination_lat, detail.destination_lng)
    ) {
      return;
    }
    let cancelled = false;
    getRouteWithDuration(
      { latitude: detail.origin_lat, longitude: detail.origin_lng },
      { latitude: detail.destination_lat, longitude: detail.destination_lng },
    ).then((result) => {
      if (!cancelled && result) {
        setRouteCoords(result.coordinates);
        if (result.durationSeconds > 0) setRouteDuration(formatDuration(result.durationSeconds));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detail?.origin_lat, detail?.origin_lng, detail?.destination_lat, detail?.destination_lng]);

  const b = (detail?.status ?? '').toLowerCase();
  const t = (detail?.trip_status ?? '').toLowerCase();
  const isBookingCancelled = b === 'cancelled' || b === 'canceled';
  const isTripCancelled = t === 'cancelled' || t === 'canceled';
  const isTripCompleted = t === 'completed';
  const allowsClientTripActions =
    !isBookingCancelled &&
    !isTripCancelled &&
    !isTripCompleted &&
    ['pending', 'paid', 'confirmed'].includes(b);
  const isInProgress = Boolean(detail && allowsClientTripActions);
  const isCompleted = Boolean(detail && isTripCompleted && !isBookingCancelled);
  /**
   * Cancelamento/reagendamento pelo passageiro só fazem sentido antes do motorista iniciar.
   * Com `scheduled_trips.status === 'active'` (embarque em curso) estes fluxos passam a pertencer
   * ao motorista (cancelar embarque); esconder aqui evita duplicar ação e dar refund indevido.
   */
  const canPassengerCancelOrReschedule = isInProgress && t !== 'active';

  useEffect(() => {
    if (!canPassengerCancelOrReschedule) {
      setShowCancelTripModal(false);
      setShowRescheduleConsentModal(false);
    }
  }, [canPassengerCancelOrReschedule]);
  const driverOnWay = useMemo(() => {
    if (!detail) return false;
    const bs = (detail.status ?? '').toLowerCase();
    const ts = (detail.trip_status ?? '').toLowerCase();
    if (bs === 'cancelled' || bs === 'canceled') return false;
    if (ts === 'cancelled' || ts === 'canceled' || ts === 'completed') return false;
    return ts === 'active' && ['confirmed', 'in_progress'].includes(bs);
  }, [detail]);

  const { coords: liveDriver } = useScheduledTripLiveLocation(
    driverOnWay && detail?.scheduled_trip_id ? detail.scheduled_trip_id : null,
  );

  const [driverToPickupCoords, setDriverToPickupCoords] = useState<RoutePoint[] | null>(null);
  const [driverPickupEtaLabel, setDriverPickupEtaLabel] = useState<string | null>(null);

  useEffect(() => {
    if (
      !driverOnWay ||
      !detail ||
      !liveDriver ||
      !isValidTripCoordinate(detail.origin_lat, detail.origin_lng) ||
      !isValidTripCoordinate(liveDriver.latitude, liveDriver.longitude)
    ) {
      setDriverToPickupCoords(null);
      setDriverPickupEtaLabel(null);
      return;
    }
    let cancelled = false;
    void getRouteWithDuration(
      { latitude: liveDriver.latitude, longitude: liveDriver.longitude },
      { latitude: detail.origin_lat, longitude: detail.origin_lng },
    ).then((rt) => {
      if (cancelled) return;
      if (rt?.coordinates?.length) {
        setDriverToPickupCoords(rt.coordinates);
        setDriverPickupEtaLabel(rt.durationSeconds > 0 ? formatDuration(rt.durationSeconds) : null);
      } else {
        setDriverToPickupCoords(null);
        setDriverPickupEtaLabel(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [driverOnWay, detail, liveDriver?.latitude, liveDriver?.longitude]);

  const mapRegion = useMemo(() => {
    if (!detail) return null;
    if (
      !isValidTripCoordinate(detail.origin_lat, detail.origin_lng) ||
      !isValidTripCoordinate(detail.destination_lat, detail.destination_lng)
    ) {
      return null;
    }
    const pts: { latitude: number; longitude: number }[] = [
      { latitude: detail.origin_lat, longitude: detail.origin_lng },
      { latitude: detail.destination_lat, longitude: detail.destination_lng },
    ];
    if (driverOnWay && liveDriver && isValidTripCoordinate(liveDriver.latitude, liveDriver.longitude)) {
      pts.push({ latitude: liveDriver.latitude, longitude: liveDriver.longitude });
    }
    const latMin = Math.min(...pts.map((p) => p.latitude));
    const latMax = Math.max(...pts.map((p) => p.latitude));
    const lngMin = Math.min(...pts.map((p) => p.longitude));
    const lngMax = Math.max(...pts.map((p) => p.longitude));
    const pad = 0.012;
    return sanitizeMapRegion({
      latitude: (latMin + latMax) / 2,
      longitude: (lngMin + lngMax) / 2,
      latitudeDelta: Math.max(0.04, latMax - latMin + pad * 2),
      longitudeDelta: Math.max(0.04, lngMax - lngMin + pad * 2),
    });
  }, [detail, driverOnWay, liveDriver?.latitude, liveDriver?.longitude]);

  const hasValidMapCoords = mapRegion != null;

  const tripLiveParams = useMemo((): TripLiveDriverDisplay | null => {
    if (!detail) return null;
    return {
      driverName: detail.driver_name,
      rating: detail.driver_rating,
      vehicleLabel: formatVehicleDescription(detail.vehicle_model, detail.vehicle_year, detail.vehicle_plate),
      amountCents: detail.amount_cents,
      bookingId: detail.id,
      scheduledTripId: detail.scheduled_trip_id ?? undefined,
      origin: isValidTripCoordinate(detail.origin_lat, detail.origin_lng)
        ? { latitude: detail.origin_lat, longitude: detail.origin_lng, address: detail.origin_address }
        : undefined,
      destination: isValidTripCoordinate(detail.destination_lat, detail.destination_lng)
        ? { latitude: detail.destination_lat, longitude: detail.destination_lng, address: detail.destination_address }
        : undefined,
      mapFocused: true,
    };
  }, [detail]);

  const canOpenTripLive =
    Boolean(tripLiveParams) &&
    Boolean(detail?.driver_id) &&
    hasValidMapCoords &&
    !isBookingCancelled &&
    !isTripCancelled &&
    !isTripCompleted;

  const copyPin = (label: string, code: string | null | undefined) => {
    const t = (code ?? '').trim();
    if (!t) {
      Alert.alert(label, 'PIN ainda não disponível.');
      return;
    }
    Clipboard.setString(t);
    Alert.alert('Copiado', `${label}: ${t}`);
  };

  const sharePin = async (label: string, code: string | null | undefined) => {
    const t = (code ?? '').trim();
    if (!t) {
      Alert.alert(label, 'PIN ainda não disponível para compartilhar.');
      return;
    }
    try {
      await Share.share({
        message: `${label} (Take Me): ${t}`,
      });
    } catch {
      Alert.alert('Compartilhar', 'Não foi possível abrir o compartilhamento.');
    }
  };

  const passengerRows = useMemo(() => {
    if (!detail) return [];
    const parsed = parsePassengerData(detail.passenger_data);
    if (parsed.length > 0) {
      return parsed.map((p, i) => {
        const name = (p.name ?? '').trim() || `Passageiro ${i + 1}`;
        const cpf = onlyDigits(p.cpf ?? '');
        const cpfPart = cpf.length >= 11 ? ` · CPF: ${formatCpfDisplay(cpf)}` : '';
        return { key: `p-${i}`, label: `${name}${cpfPart}` };
      });
    }
    const n = detail.passenger_count;
    if (n >= 1) return [{ key: 'count', label: `${n} passageiro${n === 1 ? '' : 'es'}` }];
    return [];
  }, [detail]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes da Viagem</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes da Viagem</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.placeholder}>Viagem não encontrada.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const avatarUri = detail.driver_avatar_url
    ? (detail.driver_avatar_url.startsWith('http')
        ? detail.driver_avatar_url
        : `${supabaseUrl}/storage/v1/object/public/avatars/${detail.driver_avatar_url}`)
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalhes da Viagem</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.mapWrap}>
          {!hasValidMapCoords ? (
            <View style={styles.mapClip}>
              <View style={styles.mapLoading}>
                <ActivityIndicator size="large" color={COLORS.black} />
                <Text style={styles.mapLoadingText}>Carregando mapa…</Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.mapClip}>
                <MapboxMap
                  style={styles.map}
                  initialRegion={mapRegion!}
                  scrollEnabled={false}
                  showControls
                  zoomOnly
                >
                  {routeCoords && routeCoords.length > 0 && (
                    <MapboxPolyline coordinates={routeCoords} strokeWidth={4} />
                  )}
                  {driverOnWay && driverToPickupCoords && driverToPickupCoords.length >= 2 ? (
                    <MapboxPolyline coordinates={driverToPickupCoords} strokeColor="#C9A227" strokeWidth={4} />
                  ) : null}
                  <MapboxMarker
                    id="origin"
                    coordinate={{ latitude: detail.origin_lat, longitude: detail.origin_lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    icon={require('../../../assets/icons/icon-partida.png')}
                    iconSize={17}
                  />
                  <MapboxMarker
                    id="destination"
                    coordinate={{ latitude: detail.destination_lat, longitude: detail.destination_lng }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    icon={require('../../../assets/icons/icon-destino.png')}
                    iconSize={14}
                  />
                  {driverOnWay &&
                  liveDriver &&
                  isValidTripCoordinate(liveDriver.latitude, liveDriver.longitude) ? (
                    <MapboxMarker
                      id="driver-live"
                      coordinate={{ latitude: liveDriver.latitude, longitude: liveDriver.longitude }}
                      title="Motorista"
                      anchor={{ x: 0.5, y: 0.5 }}
                    >
                      <LiveDriverMapMarker eta={driverPickupEtaLabel ?? undefined} />
                    </MapboxMarker>
                  ) : null}
                </MapboxMap>
              </View>
              <TouchableOpacity
                style={[styles.trackButton, !canOpenTripLive && styles.trackButtonDisabled]}
                activeOpacity={0.8}
                disabled={!canOpenTripLive}
                onPress={() => {
                  if (tripLiveParams && canOpenTripLive) {
                    navigation.navigate('TripInProgress', tripLiveParams);
                  }
                }}
              >
                <MaterialIcons name="explore" size={20} color={COLORS.neutral700} />
                <Text style={styles.trackButtonText}>Acompanhar em tempo real</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardStatusRow}>
            <StatusBadge variant={clientViagemStatusBadge(detail.status, detail.trip_status, detail.cancellation_reason, detail.driver_journey_started_at)} />
          </View>
          <Text style={styles.tripId}>Minha reserva: {formatTripCode(detail.id)}</Text>
          {detail.scheduled_trip_id ? (
            <Text style={styles.tripIdMeta}>ID da Viagem: {formatTripCode(detail.scheduled_trip_id)}</Text>
          ) : null}
          <Text style={styles.cardDate}>{formatDetailDate(detail.created_at)}</Text>
          <Text style={styles.cardSummary}>
            {detail.passenger_count} {detail.passenger_count === 1 ? 'passageiro' : 'passageiros'} ·{' '}
            {tripShipments.length}{' '}
            {tripShipments.length === 1 ? 'encomenda' : 'encomendas'}
          </Text>
          <Text style={styles.cardSummary}>
            Ocupação do bagageiro:{' '}
            {detail.bags_count > 0
              ? `${detail.bags_count} ${detail.bags_count === 1 ? 'mala' : 'malas'}`
              : '—'}
          </Text>
          <View style={styles.cardTitleRow}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>Corrida TakeMe</Text>
              <Text style={styles.cardSubtitle}>com {detail.driver_name}</Text>
            </View>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.driverAvatar} />
            ) : (
              <View style={[styles.driverAvatar, styles.driverAvatarFallback]}>
                <Text style={styles.driverAvatarInitials}>{getInitials(detail.driver_name)}</Text>
              </View>
            )}
          </View>
          <View style={styles.cardStatusRow}>
            <View>
              <Text style={styles.cardPriceCaption}>Total pago na reserva</Text>
              <Text style={styles.cardPrice}>{formatTripFareBrl(detail.amount_cents)}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.receiptButton} activeOpacity={0.8}>
            <MaterialIcons name="receipt" size={20} color={COLORS.neutral700} />
            <Text style={styles.receiptButtonText}>Recibo</Text>
          </TouchableOpacity>
        </View>

        {isCompleted && passengerBookingRating !== undefined && passengerBookingRating === null && (
          <View style={styles.ratingPromptCard}>
            <MaterialIcons name="star" size={22} color="#CA8A04" style={styles.ratingPromptIcon} />
            <Text style={styles.ratingPromptTitle}>Como foi com {detail.driver_name}?</Text>
            <Text style={styles.ratingPromptSubtitle}>
              Toque nas estrelas para abrir a avaliação (leva poucos segundos). Sua nota ajuda o motorista e outros
              passageiros.
            </Text>
            <View style={styles.ratingPromptStars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => navigation.navigate('RateTrip', { bookingId: detail.id, initialRating: n })}
                  style={styles.ratingPromptStarHit}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name="star-border" size={36} color="#CA8A04" />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.ratingPromptCta}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('RateTrip', { bookingId: detail.id })}
            >
              <Text style={styles.ratingPromptCtaText}>Avaliar com comentário</Text>
              <MaterialIcons name="chevron-right" size={22} color={COLORS.black} />
            </TouchableOpacity>
          </View>
        )}

        {isCompleted && passengerBookingRating != null && (
          <View style={styles.ratingDoneBanner}>
            <MaterialIcons name="check-circle" size={22} color="#16a34a" />
            <View style={styles.ratingDoneBody}>
              <Text style={styles.ratingDoneTitle}>Obrigado pela avaliação</Text>
              <Text style={styles.ratingDoneStars}>
                {'★'.repeat(passengerBookingRating.rating)}
                {'☆'.repeat(5 - passengerBookingRating.rating)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate('RateTrip', { bookingId: detail.id })}
              activeOpacity={0.8}
            >
              <Text style={styles.ratingDoneEdit}>Alterar</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.routeSection}>
          <View style={styles.routeRow}>
            <View style={styles.routeIconCircle} />
            <Text style={styles.routeAddress} numberOfLines={2}>{detail.origin_address}</Text>
            <Text style={styles.routeTime}>{detail.departure_time}</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.routeIconSquare} />
            <Text style={styles.routeAddress} numberOfLines={2}>{detail.destination_address}</Text>
            <Text style={styles.routeTime}>{detail.arrival_time}</Text>
          </View>
        </View>

        <View style={styles.pinSection}>
          <Text style={styles.pinLabel}>PIN de embarque</Text>
          <Text style={styles.pinHint}>Informe ao motorista ao entrar no veículo.</Text>
          <View style={styles.pinRow}>
            <View style={styles.pinChipsWrap}>
              {pinCharsForDisplay(detail.pickup_code).map((ch, i) => (
                <View key={`trip-pc-${i}`} style={styles.pinChip}>
                  <Text style={styles.pinChipText}>{ch}</Text>
                </View>
              ))}
            </View>
            <View style={styles.pinIconButtons}>
              <TouchableOpacity
                style={styles.pinIconBtn}
                activeOpacity={0.8}
                onPress={() => copyPin('PIN de embarque', detail.pickup_code)}
              >
                <MaterialIcons name="content-copy" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pinIconBtn}
                activeOpacity={0.8}
                onPress={() => void sharePin('PIN de embarque', detail.pickup_code)}
              >
                <MaterialIcons name="share" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {tripDependentShipments.length > 0 ? (
          <>
            <Text style={[styles.sectionHeading, styles.dependentSectionHeading]}>Envio de dependente na viagem</Text>
            {tripDependentShipments.map((dep) => (
              <View key={dep.id} style={styles.dependentPinBlock}>
                <Text style={styles.dependentPinName}>{dep.full_name}</Text>
                <Text style={styles.dependentPinStatus}>Status: {dep.status}</Text>
                <View style={[styles.pinSection, styles.pinSectionNested]}>
                  <Text style={styles.pinLabel}>PIN de embarque (dependente)</Text>
                  <Text style={styles.pinHint}>Informe ao motorista no embarque do dependente.</Text>
                  <View style={styles.pinRow}>
                    <View style={styles.pinChipsWrap}>
                      {pinCharsForDisplay(dep.pickup_code).map((ch, i) => (
                        <View key={`td-${dep.id}-pc-${i}`} style={styles.pinChip}>
                          <Text style={styles.pinChipText}>{ch}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.pinIconButtons}>
                      <TouchableOpacity
                        style={styles.pinIconBtn}
                        activeOpacity={0.8}
                        onPress={() => copyPin('PIN de embarque (dependente)', dep.pickup_code)}
                      >
                        <MaterialIcons name="content-copy" size={20} color={COLORS.neutral700} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.pinIconBtn}
                        activeOpacity={0.8}
                        onPress={() => void sharePin('PIN de embarque do dependente', dep.pickup_code)}
                      >
                        <MaterialIcons name="share" size={20} color={COLORS.neutral700} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}

        <Text style={styles.sectionHeading}>Passageiros</Text>
        <View style={styles.placeholderSection}>
          {passengerRows.length === 0 ? (
            <Text style={styles.placeholderSectionText}>Nenhum passageiro listado</Text>
          ) : (
            passengerRows.map((row) => (
              <View key={row.key} style={styles.passengerRow}>
                <MaterialIcons name="person-outline" size={20} color={COLORS.neutral700} />
                <Text style={styles.passengerRowText}>{row.label}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionHeading}>Encomenda</Text>
        <View style={styles.placeholderSection}>
          {tripShipments.length === 0 ? (
            <Text style={styles.placeholderSectionText}>
              Nenhuma encomenda sua vinculada a esta viagem. Envios pelo fluxo Envios aparecem aqui quando usam o
              mesmo motorista/viagem.
            </Text>
          ) : (
            tripShipments.map((s) => (
              <View key={s.id} style={styles.shipmentRow}>
                <MaterialIcons name="inventory-2" size={20} color={COLORS.neutral700} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.passengerRowText}>
                    {shipmentPackageLabelPt(s.package_size)} · {s.recipient_name}
                  </Text>
                  <Text style={styles.shipmentMeta}>Status: {s.status}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {isCompleted && (
          <View style={styles.resumoSection}>
            <Text style={styles.sectionHeading}>Resumo final</Text>
            <View style={styles.resumoCard}>
              <Text style={styles.resumoLabel}>Total pago pelo passageiro</Text>
              <Text style={styles.resumoValue}>{formatTripFareBrl(detail.amount_cents)}</Text>
            </View>
            <Text style={styles.resumoMeta}>Duração: —</Text>
            <Text style={styles.resumoMeta}>Distância: —</Text>
          </View>
        )}

        <View style={styles.actionsSection}>
          {isCompleted && (
            (detail.tip_status === 'succeeded' && detail.tip_cents && detail.tip_cents > 0) ? (
              <View style={styles.actionRow}>
                <MaterialIcons name="card-giftcard" size={20} color={COLORS.neutral700} />
                <Text style={styles.actionLabel}>
                  Gorjeta enviada: {formatTripFareBrl(detail.tip_cents)}
                </Text>
              </View>
            ) : (
              <View style={styles.actionRow}>
                <MaterialIcons name="card-giftcard" size={20} color={COLORS.neutral700} />
                <Text style={styles.actionLabel}>Nenhuma gorjeta enviada</Text>
                <TouchableOpacity
                  style={styles.actionButton}
                  activeOpacity={0.8}
                  onPress={() => setTipModalVisible(true)}
                >
                  <Text style={styles.actionButtonText}>Gorjeta</Text>
                </TouchableOpacity>
              </View>
            )
          )}
          {isCompleted && passengerBookingRating !== undefined && (
            <View style={styles.actionRow}>
              <MaterialIcons name="star-outline" size={20} color={COLORS.neutral700} />
              <Text style={styles.actionLabel} numberOfLines={2}>
                {passengerBookingRating
                  ? `${'★'.repeat(passengerBookingRating.rating)}${'☆'.repeat(5 - passengerBookingRating.rating)} · avaliado`
                  : 'Ainda sem a sua avaliação'}
              </Text>
              <TouchableOpacity
                style={styles.actionButton}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('RateTrip', { bookingId: detail.id })}
              >
                <Text style={styles.actionButtonText}>{passengerBookingRating ? 'Alterar' : 'Avaliar'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {canPassengerCancelOrReschedule && (
          <>
            <TouchableOpacity style={styles.secondaryActionButton} activeOpacity={0.8} onPress={() => setShowRescheduleConsentModal(true)}>
              <Text style={styles.secondaryActionButtonText}>Reagendar viagem</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} activeOpacity={0.8} onPress={() => setShowCancelTripModal(true)}>
              <Text style={styles.cancelButtonText}>Cancelar viagem</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={showCancelTripModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalBox}>
            {(() => {
              const departureMs = detail?.departure_at ? Date.parse(detail.departure_at) : NaN;
              const hoursUntil = Number.isFinite(departureMs)
                ? (departureMs - Date.now()) / (1000 * 60 * 60)
                : null;
              const insideWindow = hoursUntil !== null && hoursUntil >= freeWindowHours;
              const amountBrl = `R$ ${((detail?.amount_cents ?? 0) / 100)
                .toFixed(2)
                .replace('.', ',')}`;
              const hoursLabel = Number.isInteger(freeWindowHours)
                ? `${freeWindowHours}h`
                : `${freeWindowHours.toFixed(1)}h`;
              return (
                <>
                  <Text style={styles.confirmModalTitle}>Cancelar viagem?</Text>
                  {insideWindow ? (
                    <Text style={styles.confirmModalSubtitle}>
                      Faltam mais de {hoursLabel} para a partida. Você receberá reembolso integral de {amountBrl} no cartão em 5 a 10 dias.
                    </Text>
                  ) : (
                    <Text style={styles.confirmModalSubtitle}>
                      A partida está a menos de {hoursLabel}. O cancelamento será gratuito, mas não haverá reembolso automático. Se desejar, abra um chamado no suporte após cancelar.
                    </Text>
                  )}
                </>
              );
            })()}
            <TouchableOpacity style={styles.confirmModalPrimary} activeOpacity={0.8} onPress={() => setShowCancelTripModal(false)} disabled={cancelLoading}>
              <Text style={styles.confirmModalPrimaryText}>Manter viagem</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmModalSecondary} activeOpacity={0.8} onPress={handleCancelTrip} disabled={cancelLoading}>
              {cancelLoading ? (
                <ActivityIndicator size="small" color="#dc2626" />
              ) : (
                <Text style={styles.confirmModalSecondaryText}>Sim, cancelar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showRescheduleConsentModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalBox}>
            <Text style={styles.confirmModalTitle}>Reagendar viagem</Text>
            <Text style={styles.confirmModalSubtitle}>
              Para agendar uma nova corrida, a viagem atual será cancelada. O motorista será notificado e o reembolso seguirá a política do app. Deseja continuar?
            </Text>
            <TouchableOpacity
              style={styles.confirmModalPrimary}
              activeOpacity={0.8}
              onPress={() => void handleRescheduleConfirm()}
              disabled={cancelLoading}
            >
              {cancelLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmModalPrimaryText}>Sim, cancelar e agendar nova viagem</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmModalSecondary}
              activeOpacity={0.8}
              onPress={() => setShowRescheduleConsentModal(false)}
              disabled={cancelLoading}
            >
              <Text style={styles.confirmModalSecondaryText}>Voltar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity style={[styles.fab, { bottom: Math.max(24, insets.bottom + 16) }]} onPress={() => setSupportSheetVisible(true)} activeOpacity={0.8}>
        <Image source={require('../../../assets/icons/icon-chat.png')} style={styles.fabIcon} />
      </TouchableOpacity>

      <SupportSheet
        visible={supportSheetVisible}
        onClose={() => setSupportSheetVisible(false)}
        showDriverChat={detail?.status != null && !['completed', 'cancelled'].includes(detail.status)}
        onOpenDriverChat={() => {
          if (detail?.driver_id) {
            navigation.navigate('Chat', {
              contactName: detail.driver_name,
              driverId: detail.driver_id,
              bookingId: detail.id,
              participantAvatarKey: detail.driver_avatar_url,
            });
            return;
          }
          navigation.navigate('Chat', { contactName: detail?.driver_name ?? 'Motorista' });
        }}
        onOpenSupportChat={() =>
          navigation.navigate('Chat', { contactName: 'Suporte Take Me', supportBackoffice: true })}
      />

      {detail && (
        <TipModal
          visible={tipModalVisible}
          onClose={() => setTipModalVisible(false)}
          onSuccess={({ tipCents }) => {
            setTipModalVisible(false);
            setDetail((prev) =>
              prev
                ? {
                    ...prev,
                    tip_cents: tipCents,
                    tip_status: 'succeeded',
                    tip_paid_at: new Date().toISOString(),
                  }
                : prev,
            );
          }}
          entityType="booking"
          entityId={detail.id}
          driverName={detail.driver_name}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabIcon: { width: 28, height: 28 },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  closeButton: { padding: 4, width: 32 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholder: { fontSize: 15, color: COLORS.neutral700 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  mapWrap: { paddingHorizontal: 24, paddingTop: 16 },
  mapClip: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.neutral300,
  },
  map: { flex: 1, width: '100%' },
  mapLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapLoadingText: { fontSize: 13, color: COLORS.neutral700 },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  trackButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.neutral700 },
  trackButtonDisabled: { opacity: 0.45 },
  passengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  passengerRowText: { flex: 1, fontSize: 14, color: COLORS.black },
  card: {
    marginHorizontal: 24,
    marginTop: 20,
    padding: 16,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  cardSubtitle: { fontSize: 16, fontWeight: '500', color: COLORS.black, marginTop: 2 },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FBBF24',
    overflow: 'hidden',
  },
  driverAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  driverAvatarInitials: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  cardDate: { fontSize: 14, color: COLORS.neutral700, marginTop: 12 },
  cardStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  cardPriceCaption: { fontSize: 12, fontWeight: '500', color: COLORS.neutral700, marginBottom: 2 },
  cardPrice: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  cardStatus: { fontSize: 14, fontWeight: '600' },
  cardStatusCompleted: { color: '#16a34a' },
  cardStatusProgress: { color: '#A37E38' },
  receiptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
  },
  receiptButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.neutral700 },
  tripId: { fontSize: 22, fontWeight: '700', color: COLORS.black, marginTop: 8 },
  tripIdMeta: { fontSize: 12, color: COLORS.neutral700, marginTop: 2 },
  cardSummary: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  sectionHeading: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginHorizontal: 24, marginTop: 20, marginBottom: 8 },
  dependentSectionHeading: { marginTop: 28 },
  dependentPinBlock: {
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 14,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  dependentPinName: { fontSize: 15, fontWeight: '700', color: COLORS.black, marginBottom: 4 },
  dependentPinStatus: { fontSize: 12, color: COLORS.neutral700, marginBottom: 4 },
  pinSectionNested: { marginHorizontal: 0, marginTop: 8 },
  placeholderSection: { marginHorizontal: 24, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: COLORS.neutral300, borderRadius: 10 },
  placeholderSectionText: { fontSize: 14, color: COLORS.neutral700 },
  shipmentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  shipmentMeta: { fontSize: 12, color: COLORS.neutral700, marginTop: 2 },
  resumoSection: { marginHorizontal: 24, marginTop: 20 },
  resumoCard: { backgroundColor: COLORS.neutral300, padding: 16, borderRadius: 12, marginBottom: 8 },
  resumoLabel: { fontSize: 14, color: COLORS.neutral700 },
  resumoValue: { fontSize: 24, fontWeight: '700', color: COLORS.black, marginTop: 4 },
  resumoMeta: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  routeSection: { marginHorizontal: 24, marginTop: 24, gap: 16 },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  routeIconCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.neutral700,
  },
  routeIconSquare: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: COLORS.neutral700,
  },
  routeAddress: { flex: 1, fontSize: 14, color: COLORS.black },
  routeTime: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  pinSection: { marginHorizontal: 24, marginTop: 20 },
  pinLabel: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginBottom: 6 },
  pinHint: { fontSize: 12, color: COLORS.neutral700, marginBottom: 10 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  pinChipsWrap: { flexDirection: 'row', gap: 10 },
  pinChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinChipText: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  pinIconButtons: { flexDirection: 'row', gap: 12 },
  pinIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsSection: { marginHorizontal: 24, marginTop: 24, gap: 12 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionLabel: { flex: 1, fontSize: 14, color: COLORS.neutral700 },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: COLORS.neutral300,
    borderRadius: 8,
  },
  actionButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.black },
  secondaryActionButton: {
    marginHorizontal: 24,
    marginTop: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryActionButtonText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  cancelButton: {
    marginHorizontal: 24,
    marginTop: 8,
    paddingVertical: 16,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmModalBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 24,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmModalSubtitle: {
    fontSize: 14,
    color: COLORS.neutral700,
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmModalPrimary: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: COLORS.black,
    alignItems: 'center',
  },
  confirmModalPrimaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  confirmModalSecondary: {
    marginTop: 12,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  confirmModalSecondaryText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },
  rescheduleSheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 24,
    marginTop: 'auto',
  },
  sheetClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  rescheduleTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, marginBottom: 8 },
  rescheduleSubtitle: { fontSize: 14, color: COLORS.neutral700, marginBottom: 4 },
  rescheduleWarning: { fontSize: 13, color: COLORS.neutral700, fontStyle: 'italic', marginBottom: 16 },
  rescheduleSlotsContent: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  rescheduleSlotChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.neutral300,
  },
  rescheduleSlotChipSelected: { backgroundColor: '#FBBF24' },
  rescheduleSlotText: { fontSize: 14, fontWeight: '500', color: COLORS.black },
  rescheduleSlotTextSelected: { color: COLORS.black },
  ratingPromptCard: {
    marginHorizontal: 24,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  ratingPromptIcon: { alignSelf: 'center', marginBottom: 8 },
  ratingPromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
    marginBottom: 8,
  },
  ratingPromptSubtitle: {
    fontSize: 14,
    color: COLORS.neutral700,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 14,
  },
  ratingPromptStars: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  ratingPromptStarHit: { padding: 4 },
  ratingPromptCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    backgroundColor: '#FBBF24',
    borderRadius: 10,
  },
  ratingPromptCtaText: { fontSize: 15, fontWeight: '700', color: COLORS.black },
  ratingDoneBanner: {
    marginHorizontal: 24,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  ratingDoneBody: { flex: 1 },
  ratingDoneTitle: { fontSize: 15, fontWeight: '700', color: COLORS.black },
  ratingDoneStars: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  ratingDoneEdit: { fontSize: 14, fontWeight: '600', color: COLORS.black, textDecorationLine: 'underline' },
});
