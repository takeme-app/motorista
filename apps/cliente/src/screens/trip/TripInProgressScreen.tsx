import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapboxMap,
  type MapboxMapRef,
  MapboxMarker,
  MapboxPolyline,
  sanitizeMapRegion,
  isValidTripCoordinate,
} from '../../components/mapbox';
import { requestLocationPermission, getCurrentOrLastKnownCoords } from '../../lib/location';
import { LiveDriverMapMarker } from '../../components/LiveDriverMapMarker';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TripFollowStackParamList, TripLiveDriverDisplay } from '../../navigation/types';
import { formatDriverRatingLabel } from '../../lib/tripDriverDisplay';
import { ConfirmModal } from '../../components/ConfirmModal';
import { CodeConfirmModal } from '../../components/CodeConfirmModal';
import { AnimatedBottomSheet } from '../../components/AnimatedBottomSheet';
import {
  loadBookingTripLiveContext,
  parsePassengerData,
  type BookingTripLiveBooking,
} from '../../lib/clientBookingTripLive';
import { getRouteWithDuration, formatDuration, formatDistanceKmLabel } from '../../lib/route';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { onlyDigits } from '../../utils/formatCpf';
import { getMainTabBarStyleFromInsets } from '../../navigation/mainTabBarStyle';
import { useScheduledTripLiveLocation } from '../../lib/useScheduledTripLiveLocation';

type Props = NativeStackScreenProps<TripFollowStackParamList, 'TripInProgress'>;

type NavLike = {
  getParent?: () => NavLike | undefined;
  getState?: () => { type?: string };
  setOptions?: (o: { tabBarStyle?: object }) => void;
};

function isMainTabState(state: { type?: string; routeNames?: string[] } | undefined): boolean {
  if (!state?.routeNames?.length) return false;
  if (state.type === 'tab') return true;
  return state.routeNames.includes('Activities') && state.routeNames.includes('Home');
}

function findTabNavigator(nav: NavLike | undefined): NavLike | undefined {
  let p = nav?.getParent?.();
  for (let i = 0; i < 8 && p; i++) {
    const st = p.getState?.() as { type?: string; routeNames?: string[] } | undefined;
    if (p.setOptions && isMainTabState(st)) return p;
    p = p.getParent?.();
  }
  return undefined;
}

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  orange: '#EA580C',
  green: '#16a34a',
  amber: '#FBBF24',
};

type StepType = 'coleta' | 'entrega';

type Step = {
  id: string;
  type: StepType;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  observations?: string;
  completed: boolean;
};

function buildStepsFromBooking(booking: BookingTripLiveBooking): Step[] {
  const passengers = parsePassengerData(booking.passenger_data);
  const firstName = (passengers[0]?.name ?? '').trim();
  const coletaLabel = firstName || 'Embarque';
  return [
    {
      id: 'coleta',
      type: 'coleta',
      name: coletaLabel,
      address: booking.origin_address,
      latitude: booking.origin_lat,
      longitude: booking.origin_lng,
      observations: undefined,
      completed: false,
    },
    {
      id: 'entrega',
      type: 'entrega',
      name: 'Destino',
      address: booking.destination_address,
      latitude: booking.destination_lat,
      longitude: booking.destination_lng,
      observations: undefined,
      completed: false,
    },
  ];
}

function buildStepsFromLiveParams(live: TripLiveDriverDisplay): Step[] | null {
  const o = live.origin;
  const d = live.destination;
  if (
    !o ||
    !d ||
    !isValidTripCoordinate(o.latitude, o.longitude) ||
    !isValidTripCoordinate(d.latitude, d.longitude)
  ) {
    return null;
  }
  return [
    {
      id: 'coleta',
      type: 'coleta',
      name: 'Embarque',
      address: o.address?.trim() || 'Origem',
      latitude: o.latitude,
      longitude: o.longitude,
      completed: false,
    },
    {
      id: 'entrega',
      type: 'entrega',
      name: 'Destino',
      address: d.address?.trim() || 'Destino',
      latitude: d.latitude,
      longitude: d.longitude,
      completed: false,
    },
  ];
}

export function TripInProgressScreen({ navigation, route }: Props) {
  const live = route.params;
  const mapFocused = Boolean(live?.mapFocused);
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();

  useFocusEffect(
    useCallback(() => {
      if (!mapFocused) return undefined;
      const tabNav = findTabNavigator(navigation as unknown as NavLike);
      const setOpts = tabNav?.setOptions;
      if (!setOpts) return undefined;
      setOpts({ tabBarStyle: { display: 'none' } });
      return () => {
        setOpts({ tabBarStyle: getMainTabBarStyleFromInsets(insets) });
      };
    }, [navigation, mapFocused, insets]),
  );
  const driverName = live?.driverName ?? 'Motorista';
  const ratingLabel = formatDriverRatingLabel(live?.rating ?? 0);
  const vehicleLabel = live?.vehicleLabel ?? 'Veículo a confirmar';
  const fareFormatted =
    live?.amountCents != null ? `R$ ${(live.amountCents / 100).toFixed(2).replace('.', ',')}` : 'R$ —';

  const [steps, setSteps] = useState<Step[]>([]);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [etaText, setEtaText] = useState<string>('—');
  const [durationLabel, setDurationLabel] = useState<string>('—');
  const [distanceLabel, setDistanceLabel] = useState<string>('—');
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const [bagsNote, setBagsNote] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showColetaSheet, setShowColetaSheet] = useState(false);
  const [showEntregaSheet, setShowEntregaSheet] = useState(false);
  const [showFinalizarSheet, setShowFinalizarSheet] = useState(false);
  const [showCancelColetaModal, setShowCancelColetaModal] = useState(false);
  const [showCodeColetaModal, setShowCodeColetaModal] = useState(false);
  const [liveDriverRouteCoords, setLiveDriverRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [liveDriverEta, setLiveDriverEta] = useState<string | undefined>(undefined);

  /** Garante o id da viagem agendada para o live location mesmo se os params da rota não trouxerem. */
  const [resolvedScheduledTripId, setResolvedScheduledTripId] = useState<string | null>(
    () => live?.scheduledTripId ?? null,
  );

  useEffect(() => {
    if (live?.scheduledTripId) setResolvedScheduledTripId(live.scheduledTripId);
  }, [live?.scheduledTripId]);

  const { coords: liveDriver } = useScheduledTripLiveLocation(resolvedScheduledTripId);

  const mapRef = useRef<MapboxMapRef>(null);

  const handleRecenterOnMe = useCallback(async () => {
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        showAlert({
          title: 'Permissão necessária',
          message: 'Permita o acesso à localização para centralizar o mapa em você.',
        });
        return;
      }
      const coords = await getCurrentOrLastKnownCoords();
      if (!coords) {
        showAlert({
          title: 'Localização indisponível',
          message: 'Não foi possível obter sua localização agora. Tente novamente em instantes.',
        });
        return;
      }
      mapRef.current?.animateToRegion(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    } catch {
      /* ignore */
    }
  }, [showAlert]);

  const currentStep = steps[currentStepIndex];
  const totalSteps = steps.length;
  const isLastStep = currentStepIndex === totalSteps - 1;
  const allCompleted = steps.length > 0 && steps.every((s) => s.completed);

  /** Inclui o motorista na área visível (mesma ideia que DriverOnTheWayScreen). Sem isso o pin atualiza mas pode ficar fora do enquadramento. */
  const mapRegion = useMemo(() => {
    const pts: { latitude: number; longitude: number }[] = [];
    for (const s of steps) {
      if (isValidTripCoordinate(s.latitude, s.longitude)) {
        pts.push({ latitude: s.latitude, longitude: s.longitude });
      }
    }
    if (liveDriver && isValidTripCoordinate(liveDriver.latitude, liveDriver.longitude)) {
      pts.push({ latitude: liveDriver.latitude, longitude: liveDriver.longitude });
    }
    if (pts.length >= 2) {
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
    }
    if (pts.length === 1) {
      return sanitizeMapRegion({
        latitude: pts[0].latitude,
        longitude: pts[0].longitude,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      });
    }
    return sanitizeMapRegion({
      latitude: -7.3289,
      longitude: -35.3328,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    });
  }, [steps, liveDriver?.latitude, liveDriver?.longitude]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const bid = live?.bookingId;
      if (bid) {
        const { data, error } = await loadBookingTripLiveContext(bid);
        if (cancelled) return;
        if (error || !data) {
          const fallback = live ? buildStepsFromLiveParams(live) : null;
          setSteps(fallback ?? []);
          setPickupCode(null);
          setBagsNote(null);
          return;
        }
        const { booking } = data;
        if (booking.scheduled_trip_id) {
          setResolvedScheduledTripId(booking.scheduled_trip_id);
        }
        setSteps(buildStepsFromBooking(booking));
        setPickupCode(booking.pickup_code?.trim() || null);
        setBagsNote(
          booking.bags_count != null
            ? `${booking.bags_count} ${booking.bags_count === 1 ? 'mala' : 'malas'}`
            : null
        );
        const o = { latitude: booking.origin_lat, longitude: booking.origin_lng };
        const d = { latitude: booking.destination_lat, longitude: booking.destination_lng };
        const rt = await getRouteWithDuration(o, d);
        if (cancelled) return;
        if (rt) {
          setRouteCoords(rt.coordinates.length ? rt.coordinates : null);
          if (rt.durationSeconds > 0) {
            const label = formatDuration(rt.durationSeconds);
            setEtaText(label);
            setDurationLabel(label);
          }
          setDistanceLabel(formatDistanceKmLabel(rt.distanceMeters));
        }
        return;
      }
      const fallback = live ? buildStepsFromLiveParams(live) : null;
      if (cancelled) return;
      setSteps(fallback ?? []);
      setPickupCode(null);
      setBagsNote(null);
      if (fallback && fallback.length >= 2) {
        const o = { latitude: fallback[0].latitude, longitude: fallback[0].longitude };
        const d = { latitude: fallback[1].latitude, longitude: fallback[1].longitude };
        const rt = await getRouteWithDuration(o, d);
        if (cancelled) return;
        if (rt) {
          setRouteCoords(rt.coordinates.length ? rt.coordinates : null);
          if (rt.durationSeconds > 0) {
            const label = formatDuration(rt.durationSeconds);
            setEtaText(label);
            setDurationLabel(label);
          }
          setDistanceLabel(formatDistanceKmLabel(rt.distanceMeters));
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [live]);

  /**
   * Ponto-alvo para traçar o percurso e o ETA do motorista em tempo real.
   * - Acompanhamento externo (mapFocused, ex.: envio de dependente): sempre o destino final.
   *   O cliente não tem UI para marcar etapas, então mostrar motorista → destino dá a visão
   *   única e correta de "quando a entrega termina".
   * - Viagem do próprio passageiro: segue o step atual (coleta → entrega).
   */
  const liveDriverTargetPoint = useMemo<
    { latitude: number; longitude: number } | null
  >(() => {
    if (mapFocused) {
      const d = live?.destination;
      if (d && isValidTripCoordinate(d.latitude, d.longitude)) {
        return { latitude: d.latitude, longitude: d.longitude };
      }
    }
    if (currentStep && isValidTripCoordinate(currentStep.latitude, currentStep.longitude)) {
      return { latitude: currentStep.latitude, longitude: currentStep.longitude };
    }
    return null;
  }, [
    mapFocused,
    live?.destination?.latitude,
    live?.destination?.longitude,
    currentStep?.latitude,
    currentStep?.longitude,
  ]);

  useEffect(() => {
    if (!liveDriver || !liveDriverTargetPoint) {
      setLiveDriverRouteCoords([]);
      setLiveDriverEta(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      const rt = await getRouteWithDuration(
        { latitude: liveDriver.latitude, longitude: liveDriver.longitude },
        liveDriverTargetPoint,
      );
      if (cancelled) return;
      setLiveDriverRouteCoords(rt?.coordinates?.length ? rt.coordinates : []);
      if (rt?.durationSeconds && rt.durationSeconds > 0) {
        setLiveDriverEta(formatDuration(rt.durationSeconds));
      } else {
        setLiveDriverEta(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    liveDriver?.latitude,
    liveDriver?.longitude,
    liveDriverTargetPoint?.latitude,
    liveDriverTargetPoint?.longitude,
  ]);

  const openCurrentSheet = () => {
    if (!currentStep) return;
    if (allCompleted) {
      setShowFinalizarSheet(true);
      return;
    }
    if (currentStep.type === 'coleta') setShowColetaSheet(true);
    else setShowEntregaSheet(true);
  };

  const handleStartColeta = () => {
    setShowColetaSheet(false);
    setShowCodeColetaModal(true);
  };

  const handleConfirmColetaCode = (code: string) => {
    const expected = pickupCode?.trim();
    if (expected && onlyDigits(code) !== onlyDigits(expected)) {
      showAlert('Código', 'Código de coleta incorreto. Verifique com o motorista.');
      return false;
    }
    setSteps((prev) =>
      prev.map((s, i) => (i === currentStepIndex ? { ...s, completed: true } : s))
    );
    setCurrentStepIndex((i) => {
      const maxIdx = Math.max(steps.length - 1, 0);
      return Math.min(i + 1, maxIdx);
    });
  };

  const handleCancelColeta = () => setShowCancelColetaModal(true);
  const handleNaoSeguirColeta = () => setShowCancelColetaModal(false);
  const handleSimCancelarColeta = () => {
    setShowCancelColetaModal(false);
    setShowColetaSheet(false);
  };

  // PDF "Sequência de Solicitação de Código" cenário 1: viagem comum tem só PIN no
  // embarque (coleta). Desembarque/entrega é confirmação simples, sem código.
  const handleConfirmEntrega = () => {
    setShowEntregaSheet(false);
    setSteps((prev) =>
      prev.map((s, i) => (i === currentStepIndex ? { ...s, completed: true } : s))
    );
    if (isLastStep) setShowFinalizarSheet(true);
    else setCurrentStepIndex((i) => i + 1);
  };

  const handleFinalizarViagem = () => {
    setShowFinalizarSheet(false);
    navigation.navigate('RateTrip', { bookingId: live?.bookingId });
  };

  const polylineCoords = useMemo(() => {
    if (routeCoords?.length) return routeCoords;
    if (steps.length >= 2) {
      return [
        { latitude: steps[0].latitude, longitude: steps[0].longitude },
        { latitude: steps[1].latitude, longitude: steps[1].longitude },
      ];
    }
    return [];
  }, [routeCoords, steps]);

  const mapBlock = (
    <View style={[styles.mapWrap, mapFocused && styles.mapWrapFocused]}>
      <MapboxMap
        ref={mapRef}
        style={styles.map}
        initialRegion={mapRegion}
        scrollEnabled
        showControls={mapFocused}
        controlsTopInset={mapFocused ? insets.top + 56 : undefined}
        controlsRightInset={mapFocused ? Math.max(insets.right, 12) + 4 : undefined}
        onUserLocationPress={mapFocused ? handleRecenterOnMe : undefined}
      >
        {/* Em modo de acompanhamento (dependente), priorizamos o percurso do motorista.
            A rota estática origem→destino só aparece se ainda não houver trajetória dinâmica. */}
        {polylineCoords.length >= 2 && (!mapFocused || liveDriverRouteCoords.length < 2) ? (
          <MapboxPolyline coordinates={polylineCoords} strokeWidth={4} />
        ) : null}
        {liveDriverRouteCoords.length >= 2 ? (
          <MapboxPolyline coordinates={liveDriverRouteCoords} strokeColor="#C9A227" strokeWidth={4} />
        ) : null}
        {liveDriver && isValidTripCoordinate(liveDriver.latitude, liveDriver.longitude) ? (
          <MapboxMarker
            id="driver-live"
            coordinate={{ latitude: liveDriver.latitude, longitude: liveDriver.longitude }}
            title="Motorista"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <LiveDriverMapMarker eta={liveDriverEta} />
          </MapboxMarker>
        ) : null}
        {steps.map((step, i) => (
          <MapboxMarker
            key={step.id}
            id={`step-${step.id}`}
            coordinate={{ latitude: step.latitude, longitude: step.longitude }}
            title={step.name}
            description={step.address}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.tripStopMarkerWrap}>
              {step.completed ? (
                <View style={[styles.tripStopMarker, styles.tripStopMarkerDone]}>
                  <MaterialIcons name="check" size={20} color="#fff" />
                </View>
              ) : mapFocused || i === currentStepIndex ? (
                <View
                  style={[
                    styles.tripStopMarker,
                    step.type === 'coleta' ? styles.tripStopMarkerPickup : styles.tripStopMarkerDropoff,
                  ]}
                >
                  <MaterialIcons
                    name={step.type === 'coleta' ? 'person' : 'place'}
                    size={20}
                    color="#fff"
                  />
                </View>
              ) : (
                <View style={[styles.tripStopMarker, styles.tripStopMarkerPending]}>
                  <MaterialIcons
                    name={step.type === 'coleta' ? 'person' : 'place'}
                    size={18}
                    color="#6B7280"
                  />
                </View>
              )}
            </View>
          </MapboxMarker>
        ))}
      </MapboxMap>
      <View
        style={[
          styles.timeBadge,
          mapFocused ? { top: insets.top + 56, left: 16 } : styles.timeBadgeDefaultPos,
        ]}
      >
        <Text style={styles.timeBadgeText}>
          {mapFocused ? (liveDriverEta ?? etaText) : etaText}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.backButton, mapFocused && { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      {!mapFocused ? (
        <View style={styles.stepsSidebar}>
          {steps.map((step, i) => (
            <View key={step.id} style={styles.stepIconWrap}>
              {step.completed ? (
                <MaterialIcons name="check-circle" size={24} color={COLORS.green} />
              ) : (
                <View style={[styles.stepIconCircle, i === currentStepIndex && styles.stepIconCircleActive]}>
                  <MaterialIcons
                    name={step.type === 'coleta' ? 'person' : 'inventory-2'}
                    size={18}
                    color={i === currentStepIndex ? COLORS.background : COLORS.neutral700}
                  />
                </View>
              )}
              {i < steps.length - 1 && <View style={styles.stepLine} />}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  const stepCardEl = (
    <TouchableOpacity style={styles.currentStepCard} onPress={openCurrentSheet} activeOpacity={0.9}>
      <View style={styles.currentStepHeader}>
        <View style={[styles.stepBadge, currentStep?.type === 'entrega' && styles.stepBadgeEntrega]}>
          <Text style={styles.stepBadgeText}>
            {!currentStep ? '…' : currentStep.type === 'coleta' ? 'Coleta' : 'Entrega'}
          </Text>
        </View>
        <Text style={styles.progressText}>
          {totalSteps === 0 ? '—' : `${currentStepIndex + 1}/${totalSteps}`}
        </Text>
      </View>
      {currentStep && (
        <>
          <Text style={styles.currentStepName}>{currentStep.name}</Text>
          <Text style={styles.currentStepAddress} numberOfLines={2}>{currentStep.address}</Text>
          <View style={styles.etaRow}>
            <MaterialIcons name="schedule" size={16} color={COLORS.neutral700} />
            <Text style={styles.etaText}>{etaText}</Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${
                    totalSteps > 0
                      ? ((currentStepIndex + (currentStep.completed ? 1 : 0)) / totalSteps) * 100
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
        </>
      )}
    </TouchableOpacity>
  );

  const sheetTitleText =
    etaText !== '—' ? `Chegada prevista em ${etaText}` : 'Acompanhe as etapas da viagem';

  const sheetTitleEl = <Text style={styles.sheetTitle}>{sheetTitleText}</Text>;

  const driverAndActionsEl = (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Motorista</Text>
        <View style={styles.driverRow}>
          <View style={styles.driverAvatar} />
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>{driverName}</Text>
            <Text style={styles.driverRating}>★ {ratingLabel}</Text>
            <Text style={styles.carText}>{vehicleLabel}</Text>
          </View>
          <Text style={styles.fare}>{fareFormatted}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.primaryButton} onPress={openCurrentSheet} activeOpacity={0.8}>
        <Text style={styles.primaryButtonText}>
          {allCompleted ? 'Finalizar viagem' : currentStep?.type === 'coleta' ? 'Detalhes da coleta' : 'Detalhes da entrega'}
        </Text>
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={mapFocused ? ['bottom'] : ['top']}>
      <StatusBar style="dark" />

      {mapFocused ? (
        <View style={styles.mapFocusedRoot}>{mapBlock}</View>
      ) : (
        <>
          {mapBlock}
          {stepCardEl}
          <View style={styles.sheet}>
            {sheetTitleEl}
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {driverAndActionsEl}
            </ScrollView>
          </View>
        </>
      )}

      {/* Sheets/modais de confirmação só existem no fluxo da viagem do passageiro.
          No modo de acompanhamento (mapFocused, ex.: envio de dependente) nada é montado. */}
      {mapFocused ? null : (
        <>
      {/* Sheet: Detalhes da coleta */}
      <AnimatedBottomSheet visible={showColetaSheet} onClose={() => setShowColetaSheet(false)}>
        <View style={styles.detailSheetHeader}>
          <Text style={styles.detailSheetTitle}>Detalhes da coleta</Text>
          <TouchableOpacity><MaterialIcons name="phone" size={24} color={COLORS.black} /></TouchableOpacity>
        </View>
        {currentStep && (
          <>
            <View style={styles.detailUserRow}>
              <View style={styles.detailAvatar} />
              <View style={styles.detailUserInfo}>
                <Text style={styles.detailUserName}>{currentStep.name}</Text>
                <Text style={styles.detailRating}>★ {ratingLabel}</Text>
                {bagsNote ? <Text style={styles.detailBag}>{bagsNote}</Text> : null}
              </View>
            </View>
            <Text style={styles.detailLabel}>Endereço da coleta</Text>
            <Text style={styles.detailAddress}>{currentStep.address}</Text>
            {currentStep.observations && (
              <>
                <Text style={styles.detailLabel}>Observações</Text>
                <Text style={styles.detailObservations}>{currentStep.observations}</Text>
              </>
            )}
            <TouchableOpacity style={styles.detailPrimaryButton} onPress={handleStartColeta} activeOpacity={0.8}>
              <Text style={styles.detailPrimaryButtonText}>Iniciar coleta</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.detailSecondaryButton} onPress={handleCancelColeta} activeOpacity={0.8}>
              <Text style={styles.detailSecondaryButtonText}>Cancelar coleta</Text>
            </TouchableOpacity>
          </>
        )}
      </AnimatedBottomSheet>

      {/* Sheet: Entrega para [nome] */}
      <AnimatedBottomSheet visible={showEntregaSheet} onClose={() => setShowEntregaSheet(false)}>
        <Text style={styles.detailSheetTitle}>Entrega para {currentStep?.name}</Text>
        {currentStep && (
          <>
            <View style={styles.entregaTypeRow}>
              <MaterialIcons name="inventory-2" size={24} color={COLORS.neutral700} />
              <Text style={styles.entregaTypeText}>Pacote</Text>
            </View>
            <Text style={styles.detailLabel}>Local de entrega</Text>
            <Text style={styles.detailAddress}>{currentStep.address}</Text>
            {currentStep.observations && (
              <>
                <Text style={styles.detailLabel}>Observações</Text>
                <Text style={styles.detailObservations}>{currentStep.observations}</Text>
              </>
            )}
            <TouchableOpacity style={styles.detailPrimaryButton} onPress={handleConfirmEntrega} activeOpacity={0.8}>
              <Text style={styles.detailPrimaryButtonText}>Confirmar entrega</Text>
            </TouchableOpacity>
          </>
        )}
      </AnimatedBottomSheet>

      {/* Sheet: Finalizar viagem */}
      <AnimatedBottomSheet visible={showFinalizarSheet} onClose={() => setShowFinalizarSheet(false)}>
        <Text style={styles.detailSheetTitle}>Finalizar viagem</Text>
        <View style={styles.finalizarRow}>
          <Text style={styles.finalizarLabel}>Tempo total</Text>
          <Text style={styles.finalizarValue}>{durationLabel}</Text>
        </View>
        <View style={styles.finalizarRow}>
          <Text style={styles.finalizarLabel}>Distância</Text>
          <Text style={styles.finalizarValue}>{distanceLabel}</Text>
        </View>
        <View style={styles.statusConcluidoWrap}>
          <MaterialIcons name="check-circle" size={24} color={COLORS.green} />
          <Text style={styles.statusConcluidoText}>Concluído</Text>
        </View>
        <TouchableOpacity style={styles.detailPrimaryButton} onPress={handleFinalizarViagem} activeOpacity={0.8}>
          <Text style={styles.detailPrimaryButtonText}>Finalizar viagem</Text>
        </TouchableOpacity>
      </AnimatedBottomSheet>

      <ConfirmModal
        visible={showCancelColetaModal}
        onClose={() => setShowCancelColetaModal(false)}
        title="Tem certeza que deseja cancelar esta coleta?"
        subtitle="O passageiro será notificado imediatamente."
        primaryLabel="Não, seguir com a viagem"
        onPrimary={handleNaoSeguirColeta}
        secondaryLabel="Sim, cancelar"
        onSecondary={handleSimCancelarColeta}
      />

      <CodeConfirmModal
        visible={showCodeColetaModal}
        onClose={() => setShowCodeColetaModal(false)}
        title="Confirmar coleta"
        instruction="Insira o código informado pelo passageiro para confirmar a coleta."
        inputPlaceholder="Ex: 1234"
        submitLabel="Confirmar coleta"
        onSubmit={handleConfirmColetaCode}
        backLabel="Voltar"
      />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  mapFocusedRoot: { flex: 1, minHeight: 0 },
  mapWrap: { height: 280, width: '100%' },
  mapWrapFocused: { flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' },
  map: { width: '100%', height: '100%' },
  tripStopMarkerWrap: { alignItems: 'center', justifyContent: 'center' },
  tripStopMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  tripStopMarkerPickup: { backgroundColor: '#10B981' },
  tripStopMarkerDropoff: { backgroundColor: '#3B82F6' },
  tripStopMarkerDone: { backgroundColor: '#374151' },
  tripStopMarkerPending: { backgroundColor: '#E5E7EB', borderColor: '#fff' },
  timeBadge: {
    position: 'absolute',
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  timeBadgeDefaultPos: { bottom: 12, left: 24 },
  timeBadgeText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 48,
    left: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  backArrow: { fontSize: 22, color: COLORS.black, fontWeight: '600' },
  stepsSidebar: {
    position: 'absolute',
    left: 16,
    top: 100,
    alignItems: 'center',
  },
  stepIconWrap: { alignItems: 'center' },
  stepIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconCircleActive: { backgroundColor: COLORS.amber },
  stepLine: { width: 2, height: 24, backgroundColor: COLORS.neutral400, marginVertical: 2 },
  currentStepCard: {
    marginHorizontal: 24,
    marginTop: -12,
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.neutral300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  currentStepHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  stepBadge: { backgroundColor: COLORS.amber, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  stepBadgeEntrega: { backgroundColor: COLORS.neutral400 },
  stepBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  progressText: { fontSize: 12, fontWeight: '600', color: COLORS.neutral700 },
  currentStepName: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  currentStepAddress: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  etaText: { fontSize: 14, color: COLORS.neutral700 },
  progressBar: { height: 4, backgroundColor: COLORS.neutral300, borderRadius: 2, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.amber, borderRadius: 2 },
  sheet: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: 12,
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 20, textAlign: 'center' },
  scrollContent: { paddingBottom: 32 },
  card: {
    borderWidth: 1,
    borderColor: COLORS.neutral300,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginBottom: 12 },
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  driverAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.neutral300, marginRight: 12 },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  driverRating: { fontSize: 14, color: COLORS.neutral700 },
  carText: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  fare: { fontSize: 18, fontWeight: '700', color: COLORS.orange },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  detailSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  sheetClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  detailSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  detailSheetTitle: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 16 },
  detailUserRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  detailAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.neutral300, marginRight: 12 },
  detailUserInfo: { flex: 1 },
  detailUserName: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  detailRating: { fontSize: 14, color: COLORS.neutral700 },
  detailBag: { fontSize: 14, color: COLORS.neutral700 },
  detailLabel: { fontSize: 14, fontWeight: '600', color: COLORS.neutral700, marginTop: 12, marginBottom: 4 },
  detailAddress: { fontSize: 14, color: COLORS.black },
  detailObservations: { fontSize: 14, color: COLORS.neutral700 },
  detailPrimaryButton: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: COLORS.black,
    alignItems: 'center',
  },
  detailPrimaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  detailSecondaryButton: { marginTop: 12, paddingVertical: 14, alignItems: 'center' },
  detailSecondaryButtonText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },
  entregaTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  entregaTypeText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  finalizarRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  finalizarLabel: { fontSize: 14, color: COLORS.neutral700 },
  finalizarValue: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  statusConcluidoWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
  statusConcluidoText: { fontSize: 16, fontWeight: '700', color: COLORS.green },
});
