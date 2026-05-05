import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  TextInput,
  Pressable,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Image,
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
import { supabase } from '../../lib/supabase';
import { getRouteWithDuration, formatDuration, type RoutePoint } from '../../lib/route';
import { DriverEtaMarkerIcon } from '../../components/DriverEtaMarkerIcon';
import { StatusBadge, shipmentStatusToBadge } from '../../components/StatusBadge';
import { SupportSheet } from '../../components/SupportSheet';
import { storageUrl } from '../../utils/storageUrl';
import { TipModal } from '../../components/TipModal';
import { CodeConfirmModal } from '../../components/CodeConfirmModal';
import { formatShipmentCode } from '@take-me/shared';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ShipmentDetail'>;

const SHEET_SLIDE_DISTANCE = 400;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  accent: '#EAB308',
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

function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shipmentStatusMessage(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'confirmed':
      return 'Tudo certo com seu envio!';
    case 'pending_review':
      return 'Pendente de revisão';
    case 'awaiting_driver':
      return 'Aguardando aceite do motorista';
    case 'delivered':
      return 'Entregue';
    case 'cancelled':
      return 'Envio cancelado';
    default:
      return 'Pendente de revisão';
  }
}

type ShipmentDetail = {
  id: string;
  origin_address: string;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_address: string;
  destination_lat: number | null;
  destination_lng: number | null;
  amount_cents: number;
  status: string;
  created_at: string;
  recipient_name: string;
  recipient_phone: string;
  instructions: string | null;
  tip_cents: number | null;
  tip_status: string | null;
  tip_paid_at: string | null;
  driver_id: string | null;
  pickup_code: string | null;
  delivery_code: string | null;
  cancellation_reason: string | null;
  base_id: string | null;
  picked_up_at: string | null;
  picked_up_by_preparer_at: string | null;
};

type DriverProfileRow = { full_name: string | null; avatar_url: string | null };

/** Um dígito/caracter por chip (PIN gravado no BD, normalmente 4 dígitos). */
function pinCharsForDisplay(code: string | null | undefined): string[] {
  const s = (code ?? '').trim();
  if (!s) return ['—', '—', '—', '—'];
  const chars = s.split('');
  const out: string[] = [];
  for (let i = 0; i < 4; i += 1) out.push(chars[i] ?? '—');
  return out;
}

type ShipmentRatingRow = { rating: number; comment: string | null } | null;

export function ShipmentDetailScreen({ navigation, route }: Props) {
  const shipmentId = route.params?.shipmentId ?? '';
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfileRow | null>(null);
  const [ratingRow, setRatingRow] = useState<ShipmentRatingRow>(null);
  const [loading, setLoading] = useState(true);
  const [routeCoords, setRouteCoords] = useState<RoutePoint[] | null>(null);
  const [routeDuration, setRouteDuration] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [supportSheetVisible, setSupportSheetVisible] = useState(false);
  const [showTipSheet, setShowTipSheet] = useState(false);
  const [showRatingSheet, setShowRatingSheet] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [showPreparerPinModal, setShowPreparerPinModal] = useState(false);
  const [preparerPinSubmitting, setPreparerPinSubmitting] = useState(false);
  const insets = useSafeAreaInsets();
  const ratingOverlayOpacity = useRef(new Animated.Value(0)).current;
  const ratingSheetTranslateY = useRef(new Animated.Value(SHEET_SLIDE_DISTANCE)).current;

  useEffect(() => {
    if (!shipmentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: shipment, error: shipErr } = await supabase
        .from('shipments')
        .select(
          'id, origin_address, origin_lat, origin_lng, destination_address, destination_lat, destination_lng, amount_cents, status, created_at, recipient_name, recipient_phone, instructions, tip_cents, tip_status, tip_paid_at, driver_id, pickup_code, delivery_code, cancellation_reason, base_id, picked_up_at, picked_up_by_preparer_at'
        )
        .eq('id', shipmentId)
        .eq('user_id', user.id)
        .single();
      if (cancelled || shipErr || !shipment) {
        setLoading(false);
        return;
      }
      const row = shipment as {
        id: string;
        origin_address: string;
        origin_lat: number | null;
        origin_lng: number | null;
        destination_address: string;
        destination_lat: number | null;
        destination_lng: number | null;
        amount_cents: number;
        status: string;
        created_at: string;
        recipient_name: string;
        recipient_phone: string;
        instructions: string | null;
        tip_cents: number | null;
        tip_status: string | null;
        tip_paid_at: string | null;
        driver_id: string | null;
        pickup_code: string | null;
        delivery_code: string | null;
        cancellation_reason: string | null;
        base_id: string | null;
        picked_up_at: string | null;
        picked_up_by_preparer_at: string | null;
      };
      setDetail({
        id: row.id,
        origin_address: row.origin_address,
        origin_lat: row.origin_lat,
        origin_lng: row.origin_lng,
        destination_address: row.destination_address,
        destination_lat: row.destination_lat,
        destination_lng: row.destination_lng,
        amount_cents: row.amount_cents,
        status: row.status,
        created_at: row.created_at,
        recipient_name: row.recipient_name,
        recipient_phone: row.recipient_phone,
        instructions: row.instructions ?? null,
        tip_cents: row.tip_cents ?? null,
        tip_status: row.tip_status ?? null,
        tip_paid_at: row.tip_paid_at ?? null,
        driver_id: row.driver_id ?? null,
        pickup_code: row.pickup_code ?? null,
        delivery_code: row.delivery_code ?? null,
        cancellation_reason: row.cancellation_reason ?? null,
        base_id: row.base_id ?? null,
        picked_up_at: row.picked_up_at ?? null,
        picked_up_by_preparer_at: row.picked_up_by_preparer_at ?? null,
      });
      if (row.driver_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', row.driver_id)
          .maybeSingle();
        if (!cancelled) {
          if (prof) {
            const p = prof as DriverProfileRow;
            setDriverProfile({ full_name: p.full_name, avatar_url: p.avatar_url });
          } else {
            setDriverProfile(null);
          }
        }
      } else if (!cancelled) {
        setDriverProfile(null);
      }
      const { data: rating } = await supabase
        .from('shipment_ratings')
        .select('rating, comment')
        .eq('shipment_id', shipmentId)
        .maybeSingle();
      if (!cancelled) setRatingRow(rating ? { rating: rating.rating, comment: rating.comment } : null);
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`shipment-detail-${shipmentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shipments', filter: `id=eq.${shipmentId}` },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [shipmentId]);

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

  const hasValidShipmentMapCoords = mapRegion != null;

  const canCancel = detail?.status && ['pending_review', 'awaiting_driver', 'confirmed', 'in_progress'].includes(detail.status);
  const hasAssignedDriver = Boolean(detail?.driver_id);
  const driverOnWay =
    hasAssignedDriver && detail?.status && ['confirmed', 'in_progress'].includes(detail.status);

  const awaitingDriverMessage = (() => {
    if (!detail || hasAssignedDriver) return null;
    if (detail.status === 'cancelled' && detail.cancellation_reason === 'no_driver_accepted') {
      return 'Nenhum motorista aceitou este envio no prazo. O pedido foi cancelado.';
    }
    if (detail.status === 'cancelled') return null;
    if (detail.status === 'delivered') return null;
    return 'Ainda não há motorista atribuído. Assim que um motorista aceitar, os dados dele aparecerão aqui e você poderá acompanhar o envio.';
  })();

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
  };

  const handleRatingSubmit = async () => {
    if (ratingStars < 1) {
      Alert.alert('Avaliação', 'Selecione de 1 a 5 estrelas.');
      return;
    }
    setRatingSubmitting(true);
    const { error } = await supabase.from('shipment_ratings').upsert(
      { shipment_id: shipmentId, rating: ratingStars, comment: ratingComment.trim() || null },
      { onConflict: 'shipment_id' }
    );
    setRatingSubmitting(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível enviar a avaliação. Tente novamente.');
      return;
    }
    setRatingRow({ rating: ratingStars, comment: ratingComment.trim() || null });
    closeRatingSheet();
    setRatingStars(0);
    setRatingComment('');
  };

  // Coleta: quem está retirando (preparador com base ou motorista sem base)
  // informa o PIN; o cliente valida no próprio app.
  const handleSubmitPickupPin = async (code: string): Promise<boolean> => {
    if (!shipmentId || preparerPinSubmitting) return false;
    setPreparerPinSubmitting(true);
    try {
      const hasBase = Boolean(detail?.base_id);
      const { data, error } = await supabase.rpc(
        (hasBase ? 'complete_shipment_passenger_to_preparer' : 'complete_shipment_client_pickup') as never,
        { p_shipment_id: shipmentId, p_confirmation_code: code } as never,
      );
      if (error) {
        Alert.alert('Erro', 'Não foi possível validar agora. Tente novamente.');
        return false;
      }
      const payload = data as { ok?: boolean; error?: string } | null;
      if (!payload || payload.ok !== true) {
        const err = String(payload?.error ?? '');
        if (err === 'invalid_code' || err === 'code_length' || err === 'missing_code') {
          Alert.alert('Código inválido', `Verifique o código informado pelo ${hasBase ? 'preparador' : 'motorista'}.`);
        } else if (err === 'forbidden') {
          Alert.alert('Acesso negado', 'Esta encomenda não está vinculada à sua conta.');
        } else if (err === 'driver_not_assigned') {
          Alert.alert('Motorista pendente', 'Aguarde um motorista aceitar este envio antes de confirmar a coleta.');
        } else if (err === 'has_base') {
          Alert.alert('Fluxo com base', 'Esta encomenda deve ser confirmada pelo fluxo do preparador.');
        } else if (err === 'invalid_status') {
          Alert.alert('Envio indisponível', 'Esta encomenda não pode mais ter a coleta confirmada.');
        } else {
          Alert.alert('Erro', 'Não foi possível validar. Tente novamente.');
        }
        return false;
      }
      setDetail((d) =>
        d
          ? hasBase
            ? { ...d, picked_up_by_preparer_at: new Date().toISOString() }
            : { ...d, picked_up_at: new Date().toISOString(), status: 'in_progress' }
          : d,
      );
      setShowPreparerPinModal(false);
      Alert.alert('Coleta confirmada', 'Código validado com sucesso. Boa viagem!');
      return true;
    } finally {
      setPreparerPinSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!shipmentId || !detail) return;
    setCancelling(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCancelling(false);
      setShowCancelModal(false);
      return;
    }
    const { error } = await supabase
      .from('shipments')
      .update({ status: 'cancelled' })
      .eq('id', shipmentId)
      .eq('user_id', user.id);
    setCancelling(false);
    setShowCancelModal(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível cancelar o envio. Tente novamente.');
      return;
    }
    setDetail((d) => (d ? { ...d, status: 'cancelled' } : null));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes do envio</Text>
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
          <Text style={styles.headerTitle}>Detalhes do envio</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.placeholder}>Envio não encontrado.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayId = formatShipmentCode(detail.id);
  const driverAvatarUri = storageUrl('avatars', driverProfile?.avatar_url ?? null);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalhes do envio</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, insets.bottom + 24) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Mapa em bloco separado com altura fixa; botão abaixo do mapa, sem sobreposição */}
        <View style={styles.mapSection}>
          <View style={styles.mapContainer}>
            {!hasValidShipmentMapCoords ? (
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
          <TouchableOpacity style={styles.trackButton} activeOpacity={0.8}>
            <MaterialIcons name="visibility" size={20} color={COLORS.neutral700} />
            <Text style={styles.trackButtonText}>Acompanhar em tempo real</Text>
          </TouchableOpacity>
        </View>

        {(awaitingDriverMessage || hasAssignedDriver) && (
          <View style={styles.driverSection}>
            {awaitingDriverMessage ? (
              <View style={styles.driverPendingCard}>
                <MaterialIcons name="schedule" size={22} color="#92400e" style={styles.driverPendingIcon} />
                <Text style={styles.driverPendingText}>{awaitingDriverMessage}</Text>
              </View>
            ) : (
              <View style={styles.driverAssignedCard}>
                {driverAvatarUri ? (
                  <Image source={{ uri: driverAvatarUri }} style={styles.driverAvatarImg} />
                ) : (
                  <View style={styles.driverAvatarPlaceholder}>
                    <MaterialIcons name="person" size={28} color={COLORS.neutral700} />
                  </View>
                )}
                <View style={styles.driverAssignedTextWrap}>
                  <Text style={styles.driverAssignedLabel}>Motorista</Text>
                  <Text style={styles.driverAssignedName}>{driverProfile?.full_name?.trim() || 'Motorista'}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* PIN de Coleta — quem retira informa o código; o cliente valida no app.
            Sem base: motorista informa o PIN. Com base: preparador informa o PIN A. */}
        {detail.base_id ? (
          <View style={styles.pinSection}>
            <Text style={styles.pinLabel}>Coleta pelo preparador</Text>
            {detail.picked_up_by_preparer_at ? (
              <View style={styles.preparerStatusRow}>
                <MaterialIcons name="check-circle" size={20} color="#16a34a" />
                <Text style={styles.preparerStatusText}>
                  Coleta confirmada com o preparador.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.preparerHint}>
                  Quando o preparador chegar para retirar a encomenda, ele informará
                  um código de 4 dígitos. Toque abaixo para confirmar.
                </Text>
                <TouchableOpacity
                  style={styles.preparerValidateButton}
                  activeOpacity={0.8}
                  onPress={() => setShowPreparerPinModal(true)}
                >
                  <MaterialIcons name="vpn-key" size={18} color={COLORS.background} />
                  <Text style={styles.preparerValidateButtonText}>
                    Validar código do preparador
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <View style={styles.pinSection}>
            <Text style={styles.pinLabel}>Coleta pelo motorista</Text>
            {detail.picked_up_at ? (
              <View style={styles.preparerStatusRow}>
                <MaterialIcons name="check-circle" size={20} color="#16a34a" />
                <Text style={styles.preparerStatusText}>
                  Coleta confirmada com o motorista.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.preparerHint}>
                  Quando o motorista chegar para retirar a encomenda, ele informará
                  um código de 4 dígitos. Digite esse código para confirmar a coleta.
                </Text>
                <TouchableOpacity
                  style={styles.preparerValidateButton}
                  activeOpacity={0.8}
                  onPress={() => setShowPreparerPinModal(true)}
                >
                  <MaterialIcons name="vpn-key" size={18} color={COLORS.background} />
                  <Text style={styles.preparerValidateButtonText}>
                    Validar código do motorista
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        <View style={styles.pinSection}>
          <Text style={styles.pinLabel}>PIN de entrega</Text>
          <View style={styles.pinRow}>
            <View style={styles.pinChipsWrap}>
              {pinCharsForDisplay(detail.delivery_code).map((ch, i) => (
                <View key={`dc-${i}`} style={styles.pinChip}>
                  <Text style={styles.pinChipText}>{ch}</Text>
                </View>
              ))}
            </View>
            <View style={styles.pinIconButtons}>
              <TouchableOpacity
                style={styles.pinIconBtn}
                activeOpacity={0.8}
                onPress={() => copyPin('PIN de entrega', detail.delivery_code)}
              >
                <MaterialIcons name="content-copy" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pinIconBtn}
                activeOpacity={0.8}
                onPress={() => void sharePin('PIN de entrega', detail.delivery_code)}
              >
                <MaterialIcons name="share" size={20} color={COLORS.neutral700} />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={styles.pinReenviarButton} activeOpacity={0.8}>
            <Text style={styles.pinReenviarText}>Reenviar para o destinatário</Text>
          </TouchableOpacity>
        </View>

        {/* Card Envio TakeMe: título + ícone pacote à direita, depois motorista, data, preço • status, Recibo */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitleFull}>Envio TakeMe - Pedido #{displayId}</Text>
            <View style={styles.cardPackageIcon}>
              <MaterialIcons name="inventory-2" size={28} color="#92400e" />
            </View>
          </View>
          <Text style={styles.cardDate}>{formatDetailDate(detail.created_at)}</Text>
          <Text style={styles.cardPrice}>R$ {(detail.amount_cents / 100).toFixed(2)} • {shipmentStatusMessage(detail.status)}</Text>
          <TouchableOpacity style={styles.receiptButton} activeOpacity={0.8}>
            <MaterialIcons name="receipt" size={20} color={COLORS.neutral700} />
            <Text style={styles.receiptButtonText}>Recibo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.routeSection}>
          <View style={styles.routeRow}>
            <View style={styles.routeIconCircle} />
            <Text style={styles.routeAddress} numberOfLines={2}>{detail.origin_address}</Text>
            <Text style={styles.routeTime}>—</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.routeIconSquare} />
            <Text style={styles.routeAddress} numberOfLines={2}>{detail.destination_address}</Text>
            <Text style={styles.routeTime}>—</Text>
          </View>
        </View>

        <View style={styles.actionsSection}>
          {detail.status === 'delivered' && (
            detail.tip_status === 'succeeded' && detail.tip_cents && detail.tip_cents > 0 ? (
              <View style={styles.actionRow}>
                <MaterialIcons name="card-giftcard" size={20} color={COLORS.neutral700} />
                <Text style={styles.actionLabel}>
                  Gorjeta enviada: R$ {(detail.tip_cents / 100).toFixed(2).replace('.', ',')}
                </Text>
              </View>
            ) : (
              <View style={styles.actionRow}>
                <MaterialIcons name="card-giftcard" size={20} color={COLORS.neutral700} />
                <Text style={styles.actionLabel}>Nenhuma gorjeta enviada</Text>
                <TouchableOpacity
                  style={styles.actionButton}
                  activeOpacity={0.8}
                  onPress={() => setShowTipSheet(true)}
                >
                  <Text style={styles.actionButtonText}>Gorjeta</Text>
                </TouchableOpacity>
              </View>
            )
          )}
          <View style={styles.actionRow}>
            <MaterialIcons name="star-outline" size={20} color={COLORS.neutral700} />
            <Text style={styles.actionLabel}>
              {ratingRow
                ? `${'★'.repeat(ratingRow.rating)}${'☆'.repeat(5 - ratingRow.rating)}${ratingRow.comment ? ` • ${ratingRow.comment}` : ''}`
                : 'Sem avaliação'}
            </Text>
            <TouchableOpacity
              style={styles.actionButton}
              activeOpacity={0.8}
              onPress={() => setShowRatingSheet(true)}
            >
              <Text style={styles.actionButtonText}>Avaliar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.sectionHeading}>Destinatário</Text>
          <View style={styles.recipientRow}>
            <MaterialIcons name="person-outline" size={20} color={COLORS.neutral700} style={styles.recipientIcon} />
            <View>
              <Text style={styles.infoText}>{detail.recipient_name}</Text>
              <Text style={styles.infoText}>Telefone: {detail.recipient_phone}</Text>
            </View>
          </View>
        </View>

        {detail.instructions ? (
          <View style={styles.infoSection}>
            <View style={styles.instrucoesRow}>
              <View style={styles.instrucoesContent}>
                <MaterialIcons name="description" size={20} color={COLORS.neutral700} style={styles.instrucoesIcon} />
                <View style={styles.instrucoesTextWrap}>
                  <Text style={styles.sectionHeadingSmall}>Instruções de entrega</Text>
                  <Text style={styles.infoText}>{detail.instructions}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {canCancel && (
          <TouchableOpacity style={styles.cancelButton} activeOpacity={0.8} onPress={() => setShowCancelModal(true)}>
            <Text style={styles.cancelButtonText}>Cancelar envio</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <TouchableOpacity style={[styles.fab, { bottom: Math.max(24, insets.bottom + 16) }]} onPress={() => setSupportSheetVisible(true)} activeOpacity={0.8}>
        <Image source={require('../../../assets/icons/icon-chat.png')} style={styles.fabIcon} />
      </TouchableOpacity>

      <SupportSheet
        visible={supportSheetVisible}
        onClose={() => setSupportSheetVisible(false)}
        showDriverChat={Boolean(canCancel && hasAssignedDriver)}
        onOpenDriverChat={() =>
          navigation.navigate('Chat', {
            contactName: driverProfile?.full_name?.trim() || 'Motorista',
          })
        }
        onOpenSupportChat={() =>
          navigation.navigate('Chat', { contactName: 'Suporte Take Me', supportBackoffice: true })}
      />

      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalBox}>
            <Text style={styles.confirmModalTitle}>Tem certeza que deseja cancelar este envio?</Text>
            <Text style={styles.confirmModalSubtitle}>O motorista será notificado imediatamente.</Text>
            <TouchableOpacity
              style={styles.confirmModalPrimary}
              activeOpacity={0.8}
              onPress={() => setShowCancelModal(false)}
              disabled={cancelling}
            >
              <Text style={styles.confirmModalPrimaryText}>Continuar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmModalSecondary}
              activeOpacity={0.8}
              onPress={handleConfirmCancel}
              disabled={cancelling}
            >
              <Text style={styles.confirmModalSecondaryText}>Cancelar envio</Text>
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
        entityType="shipment"
        entityId={shipmentId}
        driverName={driverProfile?.full_name ?? null}
      />

      {/* Bottom sheet: Avaliação — mesma animação do sheet "Para quando" do Início */}
      <Modal visible={showRatingSheet} transparent animationType="none" onRequestClose={closeRatingSheet} statusBarTranslucent>
        <View style={styles.sheetOverlayContainer} pointerEvents="box-none">
          <Animated.View style={[styles.sheetOverlayBg, { opacity: ratingOverlayOpacity }]} pointerEvents="none" />
          <Pressable style={styles.sheetOverlayTouchable} onPress={closeRatingSheet} />
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <Animated.View
              style={[styles.bottomSheet, { paddingBottom: insets.bottom + 24, transform: [{ translateY: ratingSheetTranslateY }] }]}
              pointerEvents="box-none"
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

      <CodeConfirmModal
        visible={showPreparerPinModal}
        onClose={() => {
          if (!preparerPinSubmitting) setShowPreparerPinModal(false);
        }}
        title="Confirmar coleta"
        instruction={`Digite o código de 4 dígitos informado pelo ${detail.base_id ? 'preparador' : 'motorista'} para confirmar a coleta.`}
        inputPlaceholder="Ex: 1234"
        submitLabel={preparerPinSubmitting ? 'Validando…' : 'Confirmar coleta'}
        onSubmit={(code) => {
          void handleSubmitPickupPin(code);
          return false;
        }}
        backLabel="Voltar"
      />
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
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholder: { fontSize: 15, color: COLORS.neutral700 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  driverSection: { paddingHorizontal: 24, marginTop: 16 },
  driverPendingCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    backgroundColor: '#FEF9C3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  driverPendingIcon: { marginTop: 2 },
  driverPendingText: { flex: 1, fontSize: 14, color: '#713F12', lineHeight: 20 },
  driverAssignedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  driverAvatarImg: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.neutral400 },
  driverAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.neutral400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAssignedTextWrap: { flex: 1 },
  driverAssignedLabel: { fontSize: 12, fontWeight: '600', color: COLORS.neutral700, textTransform: 'uppercase' },
  driverAssignedName: { fontSize: 17, fontWeight: '700', color: COLORS.black, marginTop: 2 },
  mapSection: { paddingHorizontal: 24, paddingTop: 16 },
  mapContainer: { width: '100%', height: 200, borderRadius: 12, overflow: 'hidden', backgroundColor: COLORS.neutral300 },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  mapLoadingText: { fontSize: 13, color: COLORS.neutral700 },
  map: { width: '100%', height: '100%', borderRadius: 12 },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: COLORS.neutral300,
    borderRadius: 24,
  },
  trackButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.neutral700 },
  pinSection: { marginHorizontal: 24, marginTop: 24 },
  pinLabel: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginBottom: 10 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
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
  pinReenviarButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: COLORS.neutral300,
    borderRadius: 24,
  },
  pinReenviarText: { fontSize: 14, fontWeight: '500', color: COLORS.neutral700 },
  preparerHint: {
    fontSize: 13,
    color: COLORS.neutral700,
    marginBottom: 12,
    lineHeight: 18,
  },
  preparerValidateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.black,
    paddingVertical: 14,
    borderRadius: 10,
  },
  preparerValidateButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.background,
  },
  preparerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  preparerStatusText: { fontSize: 14, fontWeight: '500', color: '#15803d' },
  card: {
    marginHorizontal: 24,
    marginTop: 24,
    padding: 16,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitleFull: { fontSize: 16, fontWeight: '700', color: COLORS.black, flex: 1 },
  cardPackageIcon: { marginLeft: 8 },
  cardMeta: { fontSize: 14, color: COLORS.neutral700, marginTop: 10 },
  cardDate: { fontSize: 14, color: COLORS.neutral700, marginTop: 2 },
  cardPrice: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginTop: 2 },
  receiptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
  },
  receiptButtonText: { fontSize: 14, fontWeight: '500', color: COLORS.neutral700 },
  routeSection: { marginHorizontal: 24, marginTop: 24, gap: 16 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
  infoSection: { marginHorizontal: 24, marginTop: 24 },
  sectionHeading: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginBottom: 10 },
  sectionHeadingSmall: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 4 },
  infoText: { fontSize: 14, color: COLORS.black, marginTop: 2 },
  recipientRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  recipientIcon: { marginTop: 2 },
  instrucoesRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  instrucoesContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 },
  instrucoesTextWrap: { flex: 1, minWidth: 0 },
  instrucoesIcon: { marginTop: 2 },
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
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  confirmModalSecondaryText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },
  sheetOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  sheetOverlayBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetOverlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    width: 40,
    height: 4,
    borderRadius: 2,
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
