import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  Animated,
  Pressable,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Alert,
  Clipboard,
  Share,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapboxMap,
  MapboxMarker,
  MapboxPolyline,
  isValidTripCoordinate,
  sanitizeMapRegion,
  regionFromOriginDestination,
} from '../../components/mapbox';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import type { TripLiveDriverDisplay } from '../../navigation/types';
import { formatVehicleDescription } from '../../lib/tripDriverDisplay';
import { supabase } from '../../lib/supabase';
import { getRouteWithDuration, formatDuration, type RoutePoint } from '../../lib/route';
import { DriverEtaMarkerIcon } from '../../components/DriverEtaMarkerIcon';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { SupportSheet } from '../../components/SupportSheet';
import { AnimatedBottomSheet } from '../../components/AnimatedBottomSheet';
import { TipModal } from '../../components/TipModal';
import { formatDependentShipmentCode } from '@take-me/shared';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SHEET_SLIDE_DISTANCE = 500;

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'DependentShipmentDetail'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  accent: '#EAB308',
  green: '#16a34a',
};

function formatDetailDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  const month = months[d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} • ${hours}:${minutes}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'confirmed':
      return 'Tudo certo com seu envio!';
    case 'delivered':
      return 'Concluído';
    case 'cancelled':
      return 'Cancelado';
    default:
      return 'Pendente de revisão';
  }
}

type DetailRow = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  full_name: string;
  contact_phone: string;
  bags_count: number;
  instructions: string | null;
  origin_address: string;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_address: string;
  destination_lat: number | null;
  destination_lng: number | null;
  amount_cents: number;
  status: string;
  created_at: string;
  tip_cents: number | null;
  tip_status: string | null;
  tip_paid_at: string | null;
  rating: number | null;
  receiver_name: string | null;
  pickup_code: string | null;
  delivery_code: string | null;
  scheduled_trip_id: string | null;
};

type DependentTripFollowMeta = {
  tripStatus: string;
  driverId: string | null;
  driverName: string;
  driverRating: number;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehiclePlate: string | null;
};

/** Um dígito por chip (PIN no BD, em geral 4 dígitos). */
function pinCharsForDisplay(code: string | null | undefined): string[] {
  const s = (code ?? '').trim();
  if (!s) return ['—', '—', '—', '—'];
  const chars = s.split('');
  const out: string[] = [];
  for (let i = 0; i < 4; i += 1) out.push(chars[i] ?? '—');
  return out;
}

export function DependentShipmentDetailScreen({ navigation, route }: Props) {
  const dependentShipmentId = route.params?.dependentShipmentId ?? '';
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();
  const [detail, setDetail] = useState<DetailRow | null>(null);
  const [senderName, setSenderName] = useState<string | null>(null);
  const [senderAvatarUrl, setSenderAvatarUrl] = useState<string | null>(null);
  const [dependentAge, setDependentAge] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeCoords, setRouteCoords] = useState<RoutePoint[] | null>(null);
  const [routeDuration, setRouteDuration] = useState<string | null>(null);
  const [showCancelPolicySheet, setShowCancelPolicySheet] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showContactSheet, setShowContactSheet] = useState(false);
  const [showTipSheet, setShowTipSheet] = useState(false);
  const [showRatingSheet, setShowRatingSheet] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [tripFollowMeta, setTripFollowMeta] = useState<DependentTripFollowMeta | null>(null);
  const ratingOverlayOpacity = useRef(new Animated.Value(0)).current;
  const ratingSheetTranslateY = useRef(new Animated.Value(SHEET_SLIDE_DISTANCE)).current;

  useEffect(() => {
    if (!dependentShipmentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: row, error } = await supabase
        .from('dependent_shipments')
        .select(
          'id, user_id, dependent_id, full_name, contact_phone, bags_count, instructions, origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng, amount_cents, status, created_at, tip_cents, tip_status, tip_paid_at, rating, receiver_name, pickup_code, delivery_code, scheduled_trip_id',
        )
        .eq('id', dependentShipmentId)
        .eq('user_id', user.id)
        .single();
      if (cancelled || error || !row) {
        setLoading(false);
        return;
      }
      setDetail(row as DetailRow);
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', row.user_id)
        .single();
      if (!cancelled) {
        const p = profile as { full_name?: string; avatar_url?: string | null } | null;
        setSenderName(p?.full_name ?? null);
        setSenderAvatarUrl(p?.avatar_url ?? null);
      }
      const depId = (row as DetailRow).dependent_id;
      if (!cancelled && depId) {
        const { data: dep } = await supabase
          .from('dependents')
          .select('age')
          .eq('id', depId)
          .single();
        if (!cancelled && dep && (dep as { age?: string | null }).age)
          setDependentAge((dep as { age: string }).age);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [dependentShipmentId]);

  useEffect(() => {
    if (
      !detail ||
      !isValidTripCoordinate(detail.origin_lat, detail.origin_lng) ||
      !isValidTripCoordinate(detail.destination_lat, detail.destination_lng)
    )
      return;
    let cancelled = false;
    getRouteWithDuration(
      { latitude: detail.origin_lat, longitude: detail.origin_lng },
      { latitude: detail.destination_lat, longitude: detail.destination_lng }
    ).then((result) => {
      if (!cancelled && result) {
        setRouteCoords(result.coordinates);
        if (result.durationSeconds > 0) setRouteDuration(formatDuration(result.durationSeconds));
      }
    });
    return () => { cancelled = true; };
  }, [detail?.origin_lat, detail?.origin_lng, detail?.destination_lat, detail?.destination_lng]);

  useEffect(() => {
    const tripId = detail?.scheduled_trip_id;
    if (!tripId) {
      setTripFollowMeta(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: trip, error: tripErr } = await supabase
        .from('scheduled_trips')
        .select('driver_id, status')
        .eq('id', tripId)
        .maybeSingle();
      if (cancelled || tripErr || !trip) {
        if (!cancelled) setTripFollowMeta(null);
        return;
      }
      const driverId = (trip as { driver_id?: string | null }).driver_id ?? null;
      const tripStatus = String((trip as { status?: string }).status ?? '');
      let driverName = 'Motorista';
      let driverRating = 0;
      let vehicleModel: string | null = null;
      let vehicleYear: number | null = null;
      let vehiclePlate: string | null = null;
      if (driverId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, rating')
          .eq('id', driverId)
          .maybeSingle();
        if (cancelled) return;
        const p = profile as { full_name?: string | null; rating?: number | null } | null;
        if (p?.full_name?.trim()) driverName = p.full_name.trim();
        driverRating = Number(p?.rating ?? 0);
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('model, year, plate')
          .eq('worker_id', driverId)
          .maybeSingle();
        if (cancelled) return;
        const v = vehicle as { model?: string | null; year?: number | null; plate?: string | null } | null;
        vehicleModel = v?.model ?? null;
        vehicleYear = v?.year ?? null;
        vehiclePlate = v?.plate ?? null;
      }
      if (!cancelled) {
        setTripFollowMeta({
          tripStatus,
          driverId,
          driverName,
          driverRating,
          vehicleModel,
          vehicleYear,
          vehiclePlate,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail?.scheduled_trip_id, detail?.id]);

  const mapRegion = useMemo(() => {
    if (!detail) return null;
    if (
      !isValidTripCoordinate(detail.origin_lat, detail.origin_lng) ||
      !isValidTripCoordinate(detail.destination_lat, detail.destination_lng)
    )
      return null;
    const r = regionFromOriginDestination(
      detail.origin_lat,
      detail.origin_lng,
      detail.destination_lat,
      detail.destination_lng,
    );
    return r ? sanitizeMapRegion(r) : null;
  }, [detail]);

  const hasValidDependentShipmentMapCoords = mapRegion != null;

  const dependentTripLiveParams = useMemo((): TripLiveDriverDisplay | null => {
    if (!detail || !tripFollowMeta) return null;
    return {
      driverName: tripFollowMeta.driverName,
      rating: tripFollowMeta.driverRating,
      vehicleLabel: formatVehicleDescription(
        tripFollowMeta.vehicleModel,
        tripFollowMeta.vehicleYear,
        tripFollowMeta.vehiclePlate,
      ),
      amountCents: detail.amount_cents,
      scheduledTripId: detail.scheduled_trip_id ?? undefined,
      origin: isValidTripCoordinate(detail.origin_lat, detail.origin_lng)
        ? { latitude: detail.origin_lat!, longitude: detail.origin_lng!, address: detail.origin_address }
        : undefined,
      destination: isValidTripCoordinate(detail.destination_lat, detail.destination_lng)
        ? {
            latitude: detail.destination_lat!,
            longitude: detail.destination_lng!,
            address: detail.destination_address,
          }
        : undefined,
      mapFocused: true,
    };
  }, [detail, tripFollowMeta]);

  const canOpenDependentLive = useMemo(() => {
    if (!dependentTripLiveParams || !tripFollowMeta?.driverId) return false;
    if (!hasValidDependentShipmentMapCoords || !detail) return false;
    const ds = (detail.status ?? '').toLowerCase();
    const ts = (tripFollowMeta.tripStatus ?? '').toLowerCase();
    if (ds === 'cancelled' || ds === 'delivered') return false;
    if (ts === 'cancelled' || ts === 'canceled' || ts === 'completed') return false;
    return ts === 'active' && ['confirmed', 'in_progress'].includes(ds);
  }, [dependentTripLiveParams, tripFollowMeta, hasValidDependentShipmentMapCoords, detail]);

  const canCancel = detail?.status && ['pending_review', 'confirmed'].includes(detail.status);
  const driverOnWay = detail?.status && ['confirmed', 'in_progress'].includes(detail.status);

  const handleWantCancel = () => {
    setShowCancelPolicySheet(false);
    setTimeout(() => setShowCancelConfirmModal(true), 350);
  };

  const handleConfirmCancel = async () => {
    if (!detail?.id) return;
    setCancelling(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCancelling(false);
      setShowCancelConfirmModal(false);
      return;
    }
    const { error } = await supabase
      .from('dependent_shipments')
      .update({ status: 'cancelled' })
      .eq('id', detail.id)
      .eq('user_id', user.id);
    setCancelling(false);
    setShowCancelConfirmModal(false);
    if (error) {
      showAlert('Erro', 'Não foi possível cancelar o envio.');
      return;
    }
    setDetail((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
  };

  useEffect(() => {
    if (!showRatingSheet) return;
    ratingOverlayOpacity.setValue(0);
    ratingSheetTranslateY.setValue(SHEET_SLIDE_DISTANCE);
    Animated.sequence([
      Animated.timing(ratingOverlayOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(ratingSheetTranslateY, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [showRatingSheet]);

  const closeRatingSheet = () => {
    Keyboard.dismiss();
    ratingOverlayOpacity.setValue(0);
    ratingSheetTranslateY.setValue(SHEET_SLIDE_DISTANCE);
    setShowRatingSheet(false);
    setRatingStars(0);
    setRatingComment('');
  };


  const handleRatingSubmit = async () => {
    if (ratingStars < 1) {
      Alert.alert('Avaliação', 'Selecione de 1 a 5 estrelas.');
      return;
    }
    setRatingSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setRatingSubmitting(false);
      return;
    }
    const { error } = await supabase
      .from('dependent_shipments')
      .update({ rating: ratingStars })
      .eq('id', dependentShipmentId)
      .eq('user_id', user.id);
    setRatingSubmitting(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível enviar a avaliação. Tente novamente.');
      return;
    }
    setDetail((d) => (d ? { ...d, rating: ratingStars } : null));
    closeRatingSheet();
  };

  const chatAvailable = detail?.status && ['pending_review', 'confirmed', 'in_progress'].includes(detail.status);

  const openDriverChat = () => {
    navigation.navigate('Chat', { contactName: 'Motorista' });
  };

  const openSupportChat = () => {
    navigation.navigate('Chat', { contactName: 'Suporte Take Me', supportBackoffice: true });
  };

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

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
        <MaterialIcons name="close" size={24} color={COLORS.black} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Detalhes do envio do dependente</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        {renderHeader()}
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
        {renderHeader()}
        <View style={styles.centered}>
          <Text style={styles.placeholder}>Envio não encontrado.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isDelivered = detail.status === 'delivered';
  const senderAvatarUri = senderAvatarUrl
    ? (senderAvatarUrl.startsWith('http') ? senderAvatarUrl : `${supabaseUrl}/storage/v1/object/public/avatars/${senderAvatarUrl}`)
    : null;
  const priceFormatted = `R$ ${(detail.amount_cents / 100).toFixed(2).replace('.', ',')}`;
  const tipFormatted = detail.tip_cents ? `R$ ${(detail.tip_cents / 100).toFixed(2).replace('.', ',')}` : null;
  const displayId = formatDependentShipmentCode(detail.id);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      {renderHeader()}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, insets.bottom + 24) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Mapa */}
        <View style={styles.mapSection}>
          <View style={styles.mapContainer}>
            {!hasValidDependentShipmentMapCoords ? (
              <View style={styles.mapLoading}>
                <ActivityIndicator size="large" color={COLORS.black} />
                <Text style={styles.mapLoadingText}>Carregando mapa…</Text>
              </View>
            ) : (
              <MapboxMap style={styles.map} initialRegion={mapRegion!} scrollEnabled={false} showControls>
                {routeCoords && routeCoords.length > 0 && (
                  <MapboxPolyline coordinates={routeCoords} strokeWidth={4} />
                )}
                {driverOnWay ? (
                  <MapboxMarker id="origin" coordinate={{ latitude: detail.origin_lat!, longitude: detail.origin_lng! }} anchor={{ x: 0.5, y: 0.5 }}>
                    <DriverEtaMarkerIcon eta={routeDuration ?? undefined} />
                  </MapboxMarker>
                ) : (
                  <MapboxMarker id="origin" coordinate={{ latitude: detail.origin_lat!, longitude: detail.origin_lng! }} anchor={{ x: 0.5, y: 0.5 }} icon={require('../../../assets/icons/icon-partida.png')} iconSize={17} />
                )}
                <MapboxMarker id="destination" coordinate={{ latitude: detail.destination_lat!, longitude: detail.destination_lng! }} anchor={{ x: 0.5, y: 0.5 }} icon={require('../../../assets/icons/icon-destino.png')} iconSize={14} />
              </MapboxMap>
            )}
          </View>
          <TouchableOpacity
            style={[styles.trackButton, !canOpenDependentLive && styles.trackButtonDisabled]}
            activeOpacity={0.8}
            disabled={!canOpenDependentLive}
            onPress={() => {
              if (dependentTripLiveParams && canOpenDependentLive) {
                navigation.navigate('TripInProgress', dependentTripLiveParams);
              }
            }}
          >
            <MaterialIcons name="explore" size={20} color={COLORS.neutral700} />
            <Text style={styles.trackButtonText}>Acompanhar em tempo real</Text>
          </TouchableOpacity>
        </View>

        {/* PINs logo após o mapa — visíveis sem rolar a tela inteira.
            PDF "Sequência de Solicitação de Código" cenário 2: dois PINs.
            - Embarque: solicitante informa ao motorista na coleta (etapas 1-3).
            - Desembarque: solicitante repassa ao responsável no destino, que
              informa ao motorista na entrega (etapas 5-7). */}
        <View style={[styles.pinSection, styles.pinSectionAfterMap]}>
          <Text style={styles.pinLabel}>PIN de embarque do dependente</Text>
          <Text style={styles.pinHint}>Mostre ou informe este código ao motorista na coleta (embarque).</Text>
          <View style={styles.pinRow}>
            <View style={styles.pinChipsWrap}>
              {pinCharsForDisplay(detail.pickup_code).map((ch, i) => (
                <View key={`dep-pc-${i}`} style={styles.pinChip}>
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
                onPress={() => void sharePin('PIN de embarque do dependente', detail.pickup_code)}
              >
                <MaterialIcons name="share" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.pinSection}>
          <Text style={styles.pinLabel}>PIN de desembarque do dependente</Text>
          <Text style={styles.pinHint}>
            Compartilhe este código com o responsável que vai receber o dependente no destino.
            Ele deve informar ao motorista na entrega.
          </Text>
          <View style={styles.pinRow}>
            <View style={styles.pinChipsWrap}>
              {pinCharsForDisplay(detail.delivery_code).map((ch, i) => (
                <View key={`dep-dc-${i}`} style={styles.pinChip}>
                  <Text style={styles.pinChipText}>{ch}</Text>
                </View>
              ))}
            </View>
            <View style={styles.pinIconButtons}>
              <TouchableOpacity
                style={styles.pinIconBtn}
                activeOpacity={0.8}
                onPress={() => copyPin('PIN de desembarque', detail.delivery_code)}
              >
                <MaterialIcons name="content-copy" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pinIconBtn}
                activeOpacity={0.8}
                onPress={() =>
                  void sharePin(
                    'PIN de desembarque do dependente',
                    detail.delivery_code,
                  )
                }
              >
                <MaterialIcons name="share" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Título + Avatar */}
        <View style={styles.infoHeader}>
          <View style={styles.infoHeaderText}>
            <Text style={styles.infoTitle}>Envio TakeMe{'\n'}com {senderName ?? '—'}</Text>
            <Text style={styles.infoOrderId}>Pedido #{displayId}</Text>
          </View>
          <View style={styles.avatarWrap}>
            {senderAvatarUri ? (
              <Image source={{ uri: senderAvatarUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{(senderName ?? '?').charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Data */}
        <Text style={styles.dateText}>{formatDetailDate(detail.created_at)}</Text>

        {/* Preço + Status */}
        <Text style={styles.priceStatus}>
          {priceFormatted} • <Text style={isDelivered ? styles.statusGreen : undefined}>{statusLabel(detail.status)}</Text>
        </Text>

        {/* Recibo */}
        <TouchableOpacity style={styles.reciboChip} activeOpacity={0.8}>
          <Image source={require('../../../assets/icons/icon-recibo.png')} style={styles.sectionIcon} />
          <Text style={styles.reciboChipText}>Recibo</Text>
        </TouchableOpacity>

        {/* Rota */}
        <View style={styles.divider} />
        <View style={styles.section}>
          <View style={styles.routeRow}>
            <Image source={require('../../../assets/icons/icon-endereco-partida.png')} style={styles.routeIcon} />
            <Text style={styles.routeAddress} numberOfLines={2}>{detail.origin_address}</Text>
            <Text style={styles.routeTime}>{formatTime(detail.created_at)}</Text>
          </View>
          <View style={styles.routeRow}>
            <Image source={require('../../../assets/icons/icon-endereco-destino.png')} style={styles.routeIcon} />
            <Text style={styles.routeAddress} numberOfLines={2}>{detail.destination_address}</Text>
            <Text style={styles.routeTime}>{isDelivered ? formatTime(detail.created_at) : '—'}</Text>
          </View>
        </View>

        {/* Gorjeta — só aparece após entrega concluída (delivered). */}
        {isDelivered && (
          <>
            <View style={styles.divider} />
            <View style={styles.section}>
              <View style={styles.infoRow}>
                <Image source={require('../../../assets/icons/icon-sessao-gorjeta.png')} style={styles.sectionIcon} />
                <Text style={styles.infoRowText}>
                  {detail.tip_status === 'succeeded' && detail.tip_cents && detail.tip_cents > 0
                    ? tipFormatted
                    : 'Nenhuma gorjeta enviada'}
                </Text>
                {!(detail.tip_status === 'succeeded' && detail.tip_cents && detail.tip_cents > 0) && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    activeOpacity={0.8}
                    onPress={() => setShowTipSheet(true)}
                  >
                    <Text style={styles.actionButtonText}>Gorjeta</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        )}

        {/* Avaliação */}
        <View style={styles.divider} />
        <View style={styles.section}>
          <View style={styles.infoRow}>
            <Image source={require('../../../assets/icons/icon-sessao-avaliacao.png')} style={styles.sectionIcon} />
            <Text style={styles.infoRowText}>
              {detail.rating ? `${'★'.repeat(detail.rating)}${'☆'.repeat(5 - detail.rating)}` : 'Sem avaliação'}
            </Text>
            {!detail.rating && (
              <TouchableOpacity
                style={styles.actionButton}
                activeOpacity={0.8}
                onPress={() => setShowRatingSheet(true)}
              >
                <Text style={styles.actionButtonText}>Avaliar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Dependente */}
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Dependente</Text>
          <View style={styles.infoRow}>
            <MaterialIcons name="person-outline" size={22} color={COLORS.neutral700} />
            <Text style={styles.infoRowText}>
              {detail.full_name}{dependentAge ? ` • ${dependentAge} anos` : ''}
            </Text>
          </View>
          <View style={[styles.infoRow, { marginTop: 10 }]}>
            <MaterialIcons name="luggage" size={22} color={COLORS.neutral700} />
            <Text style={styles.infoRowText}>
              {detail.bags_count} {detail.bags_count === 1 ? 'mala' : 'malas'}
            </Text>
          </View>
        </View>

        {/* Recebedor */}
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Recebedor</Text>
          <View style={styles.infoRow}>
            <MaterialIcons name="person-outline" size={22} color={COLORS.neutral700} />
            <View>
              <Text style={styles.infoRowText}>{detail.receiver_name ?? '—'}</Text>
              <Text style={styles.infoRowSubtext}>Telefone: {formatPhoneDisplay(detail.contact_phone) || detail.contact_phone}</Text>
            </View>
          </View>

          {detail.instructions ? (
            <View style={[styles.infoRow, { marginTop: 14 }]}>
              <MaterialIcons name="description" size={22} color={COLORS.neutral700} />
              <View>
                <Text style={styles.infoRowLabel}>Instruções de entrega</Text>
                <Text style={styles.infoRowText}>{detail.instructions}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Cancelar */}
        {canCancel && (
          <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCancelPolicySheet(true)} activeOpacity={0.8}>
            <Text style={styles.cancelButtonText}>Cancelar envio</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {chatAvailable && (
        <TouchableOpacity style={[styles.fab, { bottom: Math.max(24, insets.bottom + 16) }]} onPress={() => setShowContactSheet(true)} activeOpacity={0.8}>
          <Image source={require('../../../assets/icons/icon-chat.png')} style={styles.fabIcon} />
        </TouchableOpacity>
      )}

      <SupportSheet
        visible={showContactSheet}
        onClose={() => setShowContactSheet(false)}
        showDriverChat={chatAvailable}
        onOpenDriverChat={openDriverChat}
        onOpenSupportChat={openSupportChat}
      />

      {/* Etapa 1: Política de cancelamento */}
      <AnimatedBottomSheet visible={showCancelPolicySheet} onClose={() => setShowCancelPolicySheet(false)}>
        <Text style={styles.policySheetTitle}>Política de cancelamento</Text>
        <ScrollView style={styles.policyScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.policyText}>
            O cancelamento é <Text style={styles.policyBold}>gratuito</Text> quando ocorrer antes do aceite de um motorista ou dentro de <Text style={styles.policyBold}>2 minutos</Text> após o aceite, desde que não tenha havido deslocamento iniciado.
          </Text>
          <Text style={styles.policyText}>
            Após esse período, poderá ser cobrada uma <Text style={styles.policyBold}>taxa proporcional</Text> ao deslocamento do motorista (R$ 2,00/min + R$ 1,20/km), com mínimo de R$ 80,00 e teto de R$ 250,00.
          </Text>
          <Text style={styles.policyText}>
            Em caso de tentativa frustrada (destinatário indisponível, endereço incorreto, etc.), a mesma taxa poderá ser aplicada.
          </Text>
          <Text style={styles.policyText}>
            Se não concordar com alguma cobrança, você pode solicitar revisão em até 7 dias pelo suporte.
          </Text>
        </ScrollView>
        <TouchableOpacity style={styles.policySheetCancelBtn} onPress={handleWantCancel} activeOpacity={0.8}>
          <Text style={styles.policySheetCancelBtnText}>Quero cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.policySheetKeepBtn} onPress={() => setShowCancelPolicySheet(false)} activeOpacity={0.8}>
          <Text style={styles.policySheetKeepBtnText}>Voltar</Text>
        </TouchableOpacity>
      </AnimatedBottomSheet>

      {/* Etapa 2: Confirmação final */}
      <Modal visible={showCancelConfirmModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalBox}>
            <Text style={styles.confirmModalTitle}>Tem certeza?</Text>
            <Text style={styles.confirmModalSubtitle}>
              Essa ação não pode ser desfeita. O envio do dependente será cancelado e o motorista será notificado.
            </Text>
            <TouchableOpacity style={styles.confirmModalPrimary} activeOpacity={0.8} onPress={() => setShowCancelConfirmModal(false)} disabled={cancelling}>
              <Text style={styles.confirmModalPrimaryText}>Manter envio</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmModalSecondary} activeOpacity={0.8} onPress={handleConfirmCancel} disabled={cancelling}>
              {cancelling ? <ActivityIndicator size="small" color="#dc2626" /> : <Text style={styles.confirmModalSecondaryText}>Sim, cancelar envio</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TipModal
        visible={showTipSheet}
        onClose={() => setShowTipSheet(false)}
        onSuccess={({ tipCents }) => {
          setShowTipSheet(false);
          setDetail((d) =>
            d
              ? {
                  ...d,
                  tip_cents: tipCents,
                  tip_status: 'succeeded',
                  tip_paid_at: new Date().toISOString(),
                }
              : d,
          );
        }}
        entityType="dependent_shipment"
        entityId={dependentShipmentId}
        driverName={tripFollowMeta?.driverName ?? null}
      />

      {/* Bottom sheet: Avaliação */}
      <Modal visible={showRatingSheet} transparent animationType="none" onRequestClose={closeRatingSheet} statusBarTranslucent>
        <View style={styles.sheetOverlayContainer} pointerEvents="box-none">
          <Animated.View style={[styles.sheetOverlayBg, { opacity: ratingOverlayOpacity }]} pointerEvents="none" />
          <Pressable style={styles.sheetOverlayTouchable} onPress={closeRatingSheet} />
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <Animated.View
              style={[styles.bottomSheet, { paddingBottom: insets.bottom + 24, transform: [{ translateY: ratingSheetTranslateY }] }]}
            >
              <View style={styles.sheetHandle} />
              <TouchableOpacity style={styles.sheetClose} onPress={closeRatingSheet} hitSlop={12}>
                <MaterialIcons name="close" size={24} color={COLORS.black} />
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>Avaliar envio</Text>
              <Text style={styles.ratingQuestion}>Como foi o envio?</Text>
              <Text style={styles.ratingHint}>(1 = muito insatisfeito, 5 = muito satisfeito)</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setRatingStars(n)}
                    style={styles.starButton}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={n <= ratingStars ? 'star' : 'star-border'}
                      size={40}
                      color={n <= ratingStars ? '#EAB308' : '#e2e2e2'}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.ratingCommentLabel}>Comentário <Text style={styles.ratingOptional}>(Opcional)</Text></Text>
              <Text style={styles.ratingKeyboardHint}>Toque fora do campo para fechar o teclado</Text>
              <TextInput
                style={styles.ratingCommentInput}
                placeholder="Descreva algum comentário sobre o envio..."
                placeholderTextColor="#767676"
                value={ratingComment}
                onChangeText={setRatingComment}
                multiline
                numberOfLines={3}
                blurOnSubmit
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.sheetPrimaryButton, (ratingStars < 1 || ratingSubmitting) && styles.sheetPrimaryButtonDisabled]}
                onPress={() => { Keyboard.dismiss(); handleRatingSubmit(); }}
                disabled={ratingStars < 1 || ratingSubmitting}
                activeOpacity={0.8}
              >
                {ratingSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.sheetPrimaryButtonText}>Enviar avaliação</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetSecondaryButton} onPress={closeRatingSheet} disabled={ratingSubmitting}>
                <Text style={styles.sheetSecondaryButtonText}>Agora não</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholder: { fontSize: 15, color: COLORS.neutral700 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  mapSection: { paddingHorizontal: 0 },
  mapContainer: { width: '100%', height: 200, backgroundColor: COLORS.neutral300 },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  mapLoadingText: { fontSize: 13, color: COLORS.neutral700 },
  map: { width: '100%', height: '100%' },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    marginHorizontal: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: COLORS.neutral300,
    borderRadius: 24,
  },
  trackButtonDisabled: { opacity: 0.45 },
  trackButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.neutral700 },

  infoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginTop: 20,
  },
  infoHeaderText: { flex: 1, marginRight: 16 },
  infoTitle: { fontSize: 22, fontWeight: '700', color: COLORS.black, lineHeight: 28 },
  infoOrderId: { marginTop: 6, fontSize: 13, fontWeight: '700', color: COLORS.neutral700 },
  avatarWrap: { flexShrink: 0 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.neutral400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 20, fontWeight: '700', color: COLORS.neutral700 },

  dateText: { fontSize: 14, color: COLORS.neutral700, paddingHorizontal: 24, marginTop: 8 },
  priceStatus: { fontSize: 14, color: COLORS.neutral700, paddingHorizontal: 24, marginTop: 2 },
  statusGreen: { color: COLORS.green, fontWeight: '600' },

  pinSection: { marginHorizontal: 24, marginTop: 20 },
  pinSectionAfterMap: { marginTop: 16 },
  pinLabel: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginBottom: 6 },
  pinHint: { fontSize: 12, color: COLORS.neutral700, marginBottom: 10, lineHeight: 17 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pinChipsWrap: { flexDirection: 'row', gap: 10, flexShrink: 1 },
  pinChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinChipText: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  pinIconButtons: { flexDirection: 'row', gap: 12, marginLeft: 8 },
  pinIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reciboChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    marginHorizontal: 24,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
  },
  reciboChipText: { fontSize: 14, fontWeight: '600', color: COLORS.black },

  divider: { height: 1, backgroundColor: COLORS.neutral300, marginHorizontal: 24, marginTop: 20 },

  section: { paddingHorizontal: 24, marginTop: 16 },
  sectionHeading: { fontSize: 18, fontWeight: '700', color: COLORS.black, marginBottom: 12 },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  routeIcon: { width: 16, height: 16, resizeMode: 'contain' },
  routeAddress: { flex: 1, fontSize: 14, color: COLORS.black },
  routeTime: { fontSize: 14, color: COLORS.neutral700, flexShrink: 0 },

  sectionIcon: { width: 20, height: 20, resizeMode: 'contain' },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoRowText: { fontSize: 15, color: COLORS.black, flex: 1 },
  infoRowSubtext: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  infoRowLabel: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 2 },

  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: COLORS.neutral300,
    borderRadius: 20,
  },
  actionButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.black },

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

  cancelButton: {
    marginHorizontal: 24,
    marginTop: 28,
    paddingVertical: 16,
    backgroundColor: '#dc2626',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: COLORS.background },

  policySheetTitle: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 16 },
  policyScroll: { maxHeight: 260, marginBottom: 20 },
  policyText: { fontSize: 14, color: COLORS.neutral700, lineHeight: 22, marginBottom: 12 },
  policyBold: { fontWeight: '700', color: COLORS.black },
  policySheetCancelBtn: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    alignItems: 'center',
  },
  policySheetCancelBtnText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  policySheetKeepBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  policySheetKeepBtnText: { fontSize: 16, fontWeight: '600', color: COLORS.neutral700 },

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
  confirmModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, textAlign: 'center', marginBottom: 8 },
  confirmModalSubtitle: { fontSize: 14, color: COLORS.neutral700, textAlign: 'center', marginBottom: 24 },
  confirmModalPrimary: { paddingVertical: 16, borderRadius: 12, backgroundColor: COLORS.black, alignItems: 'center' },
  confirmModalPrimaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  confirmModalSecondary: { marginTop: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: COLORS.neutral300, borderRadius: 12 },
  confirmModalSecondaryText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },

  sheetOverlayContainer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  sheetOverlayBg: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetOverlayTouchable: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  sheetKeyboardAvoid: { width: '100%' },
  bottomSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.neutral400,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetClose: { position: 'absolute', top: 16, right: 24, zIndex: 1 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 20 },
  tipValueLabel: { fontSize: 14, color: COLORS.neutral700, marginBottom: 8 },
  tipInput: {
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: COLORS.black,
    marginBottom: 24,
    backgroundColor: COLORS.background,
  },
  sheetPrimaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: COLORS.black,
    alignItems: 'center',
  },
  sheetPrimaryButtonDisabled: { opacity: 0.5 },
  sheetPrimaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  sheetSecondaryButton: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  sheetSecondaryButtonText: { fontSize: 16, fontWeight: '500', color: COLORS.neutral700 },
  ratingQuestion: { fontSize: 16, fontWeight: '600', color: COLORS.black, marginBottom: 4 },
  ratingHint: { fontSize: 14, color: COLORS.neutral700, marginBottom: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 },
  starButton: { padding: 4 },
  ratingCommentLabel: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 8 },
  ratingOptional: { fontWeight: '400', color: COLORS.neutral700 },
  ratingKeyboardHint: { fontSize: 12, color: COLORS.neutral700, marginBottom: 8 },
  ratingCommentInput: {
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
});
