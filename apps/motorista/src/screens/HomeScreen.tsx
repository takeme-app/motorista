import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Platform,
  Modal,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { syncMotoristaProfileFcmToken } from '../lib/motoristaFcm';
import { hasSeenHomeNoTripGuide, markHomeNoTripGuideSeen } from '../lib/homeNoTripGuide';
import { useNotificationPreference } from '../hooks/useNotificationPreference';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import {
  GoogleMapsMap,
  MapMarker,
  MapPolyline,
  MapZoomControls,
  regionFromLatLngPoints,
  isValidGlobeCoordinate,
  latLngFromDbColumns,
  MY_LOCATION_NAV_DELTA,
} from '../components/googleMaps';
import type { LatLng, GoogleMapsMapRef } from '../components/googleMaps';

let LocationMod: typeof import('expo-location') | null = null;
try {
  LocationMod = require('expo-location');
} catch {
  /* native rebuild */
}

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

type ActiveTrip = {
  id: string;
  origin_address: string;
  destination_address: string;
  departure_at: string;
  passengerCount: number;
  /** Malas informadas na reserva (`bookings.bags_count`), não é envio de encomenda. */
  bagsCount: number;
  /** Envios (`shipments`) vinculados a esta viagem agendada. */
  shipmentCount: number;
  trunkPct: number;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  bookingPickups: Array<{ lat: number; lng: number }>;
};

/** Região inicial do mapa a partir de origem/destino (fallback PB). */
function mapRegionForTrip(t: ActiveTrip): MapRegion {
  const oLat = t.origin_lat;
  const oLng = t.origin_lng;
  const dLat = t.destination_lat;
  const dLng = t.destination_lng;
  const oOk = oLat != null && oLng != null && Number.isFinite(oLat) && Number.isFinite(oLng);
  const dOk = dLat != null && dLng != null && Number.isFinite(dLat) && Number.isFinite(dLng);
  if (oOk && dOk) {
    const minLat = Math.min(oLat!, dLat!);
    const maxLat = Math.max(oLat!, dLat!);
    const minLng = Math.min(oLng!, dLng!);
    const maxLng = Math.max(oLng!, dLng!);
    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;
    const pad = 1.4;
    const latSpan = Math.max(0.008, (maxLat - minLat) * pad);
    const lngSpan = Math.max(0.008, (maxLng - minLng) * pad);
    return {
      latitude: midLat,
      longitude: midLng,
      latitudeDelta: Math.max(latSpan, 0.04),
      longitudeDelta: Math.max(lngSpan, 0.04),
    };
  }
  if (oOk) {
    return { latitude: oLat!, longitude: oLng!, latitudeDelta: 0.06, longitudeDelta: 0.06 };
  }
  if (dOk) {
    return { latitude: dLat!, longitude: dLng!, latitudeDelta: 0.06, longitudeDelta: 0.06 };
  }
  return { latitude: -7.23, longitude: -35.88, latitudeDelta: 0.12, longitudeDelta: 0.12 };
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function shortAddr(addr: string): string {
  const parts = addr.split(',');
  return parts[0]?.trim() ?? addr;
}

export function HomeScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [cnhOk, setCnhOk] = useState(false);
  const [cnhBackOk, setCnhBackOk] = useState(false);
  /** Veículo com dados obrigatórios preenchidos mas sem CRLV/documento anexado. */
  const [missingVehicleDocument, setMissingVehicleDocument] = useState(false);
  const [available, setAvailable] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [mapUserLL, setMapUserLL] = useState<LatLng | null>(null);
  const homeMapRef = useRef<GoogleMapsMapRef>(null);
  const [promoModal, setPromoModal] = useState<{ id: string; title: string; gainPct: number; endAt: string } | null>(null);
  /**
   * Guia quando não há corrida ativa. Aparece apenas uma vez por
   * usuário (persistido em AsyncStorage): depois que o motorista toca em
   * "Entendi" não reabrimos mais automaticamente em cada foco da Home,
   * evitando a sensação de lentidão ao abrir o app.
   *
   * Estados:
   *  - `null`  → ainda não sabemos (carregando de AsyncStorage).
   *  - `true`  → já dispensado (não mostrar).
   *  - `false` → primeira vez deste usuário; pode mostrar.
   */
  const [noTripGuideSeen, setNoTripGuideSeen] = useState<boolean | null>(null);
  /**
   * Preferência do usuário em "Configurar notificações" para o grupo
   * "Notificações de primeiros passos": controla a exibição tanto do card
   * "Próximo passo" quanto do modal "Como receber corridas".
   */
  const firstStepsHintsEnabled = useNotificationPreference('first_steps_hints', true);
  /** Viagem agendada vinculada a uma rota com horário (`route_id` + `departure_at`). */
  const [hasScheduledRouteWithTime, setHasScheduledRouteWithTime] = useState(false);

  useEffect(() => {
    if (!LocationMod) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await LocationMod.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await LocationMod.getCurrentPositionAsync({
          accuracy: LocationMod.Accuracy?.Balanced ?? LocationMod.Accuracy.Balanced,
        });
        if (!cancelled && pos?.coords) {
          setMapUserLL({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      } catch {
        /* GPS off / timeout */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const homeTripMapRegion = useMemo(() => {
    // Prioridade: GPS do motorista → origem da viagem → destino.
    // Usa zoom de rua (0.04°) para não ficar parecendo oceano em cidades costeiras.
    if (mapUserLL && isValidGlobeCoordinate(mapUserLL.latitude, mapUserLL.longitude)) {
      return {
        latitude: mapUserLL.latitude,
        longitude: mapUserLL.longitude,
        latitudeDelta: MY_LOCATION_NAV_DELTA,
        longitudeDelta: MY_LOCATION_NAV_DELTA,
      };
    }
    if (activeTrip) {
      const originLL = latLngFromDbColumns(activeTrip.origin_lat, activeTrip.origin_lng);
      if (originLL) return { latitude: originLL.latitude, longitude: originLL.longitude, latitudeDelta: 0.04, longitudeDelta: 0.04 };
      const destLL = latLngFromDbColumns(activeTrip.destination_lat, activeTrip.destination_lng);
      if (destLL) return { latitude: destLL.latitude, longitude: destLL.longitude, latitudeDelta: 0.04, longitudeDelta: 0.04 };
    }
    return regionFromLatLngPoints([]);
  }, [
    mapUserLL,
    activeTrip?.origin_lat,
    activeTrip?.origin_lng,
    activeTrip?.destination_lat,
    activeTrip?.destination_lng,
  ]);

  /** Sem GPS e sem nenhuma coordenada válida da viagem → não montar MapView (evita 0,0 / oceano). */
  const homeMapReady = useMemo(() => {
    if (!activeTrip) return true;
    if (mapUserLL && isValidGlobeCoordinate(mapUserLL.latitude, mapUserLL.longitude)) return true;
    const oOk = latLngFromDbColumns(activeTrip.origin_lat, activeTrip.origin_lng) !== null;
    const dOk = latLngFromDbColumns(activeTrip.destination_lat, activeTrip.destination_lng) !== null;
    return oOk || dOk;
  }, [activeTrip, mapUserLL]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) { setUserId(null); setLoading(false); return; }
    const uid = user.id;
    setUserId(uid);

    try {
      // Fase 1: tudo independente após auth em paralelo (evita ~4 round-trips em série).
      const [
        wrRes,
        vehiclesRes,
        tripDataRes,
        tripIdsRowsRes,
      ] = await Promise.all([
        supabase
          .from('worker_profiles')
          .select('cnh_document_url, cnh_document_back_url, is_available_for_requests')
          .eq('id', uid)
          .maybeSingle(),
        supabase
          .from('vehicles')
          .select('model, plate, year, passenger_capacity, vehicle_document_url')
          .eq('worker_id', uid)
          .eq('is_active', true),
        supabase
          .from('scheduled_trips')
          .select(
            'id, origin_address, destination_address, departure_at, trunk_occupancy_pct, origin_lat, origin_lng, destination_lat, destination_lng, route_id, is_active, driver_journey_started_at',
          )
          .eq('driver_id', uid)
          .eq('status', 'active')
          .not('driver_journey_started_at', 'is', null)
          .order('departure_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('scheduled_trips')
          .select('id')
          .eq('driver_id', uid)
          .in('status', ['scheduled', 'active']),
      ]);

      const wr = wrRes.data;
      const w = wr as {
        cnh_document_url?: string | null;
        cnh_document_back_url?: string | null;
        is_available_for_requests?: boolean | null;
      } | null;
      setCnhOk(Boolean(w?.cnh_document_url?.trim()));
      setCnhBackOk(Boolean(w?.cnh_document_back_url?.trim()));
      setAvailable(w?.is_available_for_requests ?? false);

      const vehicles = vehiclesRes.data;
      const vRows = (vehicles ?? []) as {
        model?: string | null;
        plate?: string | null;
        year?: number | null;
        passenger_capacity?: number | null;
        vehicle_document_url?: string | null;
      }[];
      let missingVDoc = false;
      for (const v of vRows) {
        const structOk =
          Boolean(v.model?.trim()) &&
          Boolean(v.plate?.trim()) &&
          Boolean(v.year) &&
          Boolean(v.passenger_capacity);
        if (structOk && !v.vehicle_document_url?.trim()) {
          missingVDoc = true;
          break;
        }
      }
      setMissingVehicleDocument(missingVDoc);

      const tripData = tripDataRes.data;
      const tripIdsRows = tripIdsRowsRes.data;
      const myTripIds = (tripIdsRows ?? []).map((r) => (r as { id: string }).id);
      const tripIdSet = new Set(myTripIds);

      const fillActiveTrip = async () => {
        if (!tripData) {
          setActiveTrip(null);
          return;
        }
        const t = tripData as {
          id: string;
          origin_address: string;
          destination_address: string;
          departure_at: string;
          trunk_occupancy_pct: number | null;
          origin_lat?: number | null;
          origin_lng?: number | null;
          destination_lat?: number | null;
          destination_lng?: number | null;
          route_id?: string | null;
          is_active?: boolean | null;
        };
        if (t.route_id != null && t.is_active === false) {
          setActiveTrip(null);
          return;
        }
        const [{ data: bkgs }, { count: shipCount }] = await Promise.all([
          supabase
            .from('bookings')
            .select('passenger_count, bags_count, origin_lat, origin_lng')
            .eq('scheduled_trip_id', t.id)
            .eq('status', 'confirmed'),
          supabase
            .from('shipments')
            .select('id', { count: 'exact', head: true })
            .eq('scheduled_trip_id' as never, t.id as never)
            .eq('driver_id', uid)
            .in('status', ['confirmed', 'in_progress'] as never),
        ]);
        const bkgRows = (bkgs ?? []) as {
          passenger_count?: number;
          bags_count?: number;
          origin_lat?: number | null;
          origin_lng?: number | null;
        }[];
        const passengerCount = bkgRows.reduce((s, b) => s + (b.passenger_count ?? 0), 0);
        const bagsCount = bkgRows.reduce((s, b) => s + (b.bags_count ?? 0), 0);
        const bookingPickups = bkgRows
          .filter((b) => b.origin_lat != null && b.origin_lng != null)
          .map((b) => ({ lat: b.origin_lat!, lng: b.origin_lng! }));
        setActiveTrip({
          id: t.id,
          origin_address: t.origin_address,
          destination_address: t.destination_address,
          departure_at: t.departure_at,
          passengerCount,
          bagsCount,
          shipmentCount: shipCount ?? 0,
          trunkPct: t.trunk_occupancy_pct ?? 0,
          origin_lat: t.origin_lat ?? null,
          origin_lng: t.origin_lng ?? null,
          destination_lat: t.destination_lat ?? null,
          destination_lng: t.destination_lng ?? null,
          bookingPickups,
        });
      };

      const fillPendingAndRoute = async () => {
        const pendingCountsPromise =
          myTripIds.length === 0
            ? Promise.resolve({ bCount: 0, sPending: 0, dPending: 0 })
            : Promise.all([
                supabase
                  .from('bookings')
                  .select('id', { count: 'exact', head: true })
                  .in('status', ['pending', 'paid'])
                  // Reserva de Pix real não liquidada não conta como pendente.
                  .or('pix_charge_id.is.null,pix_paid_at.not.is.null')
                  .in('scheduled_trip_id', myTripIds),
                supabase
                  .from('shipments')
                  .select('id', { count: 'exact', head: true })
                  .in('scheduled_trip_id', myTripIds)
                  .is('driver_id', null)
                  .in('status', ['pending_review', 'confirmed'])
                  // Encomenda grande não aprovada pelo admin ainda não conta como solicitação.
                  .or('package_size.neq.grande,admin_approved_at.not.is.null'),
                supabase
                  .from('dependent_shipments')
                  .select('id', { count: 'exact', head: true })
                  .in('scheduled_trip_id', myTripIds)
                  .eq('status', 'pending_review'),
              ]).then(([bRes, sRes, dRes]) => ({
                bCount: bRes.count ?? 0,
                sPending: sRes.count ?? 0,
                dPending: dRes.count ?? 0,
              }));

        const [
          { bCount, sPending, dPending },
          { data: offerCountRows },
          { data: prefCountRows },
          { count: scheduledRouteCount },
        ] = await Promise.all([
          pendingCountsPromise,
          supabase
            .from('shipments')
            .select('id, scheduled_trip_id')
            .eq('current_offer_driver_id', uid)
            .is('driver_id', null)
            .in('status', ['pending_review', 'confirmed']),
          supabase
            .from('shipments')
            .select('id, scheduled_trip_id')
            .eq('client_preferred_driver_id', uid)
            .is('current_offer_driver_id', null)
            .is('driver_id', null)
            .in('status', ['pending_review', 'confirmed'])
            // Encomenda grande só conta após aprovação do admin.
            .or('package_size.neq.grande,admin_approved_at.not.is.null'),
          supabase
            .from('scheduled_trips')
            .select('id', { count: 'exact', head: true })
            .eq('driver_id', uid)
            .not('route_id', 'is', null)
            .not('departure_at', 'is', null)
            .in('status', ['scheduled', 'active']),
        ]);

        const shipmentOfferCount = (offerCountRows ?? []).filter((r) => {
          const tid = (r as { scheduled_trip_id?: string | null }).scheduled_trip_id;
          if (tid == null || tid === '') return true;
          return tripIdSet.has(tid);
        }).length;

        const shipmentPreferredWaitCount = (prefCountRows ?? []).filter((r) => {
          const tid = (r as { scheduled_trip_id?: string | null }).scheduled_trip_id;
          if (tid == null || tid === '') return true;
          return tripIdSet.has(tid);
        }).length;

        setPendingCount(
          bCount +
            sPending +
            dPending +
            shipmentOfferCount +
            shipmentPreferredWaitCount,
        );
        setHasScheduledRouteWithTime((scheduledRouteCount ?? 0) > 0);
      };

      await Promise.all([fillActiveTrip(), fillPendingAndRoute()]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      void syncMotoristaProfileFcmToken();
    }, [load]),
  );

  // Check for active promotions targeting drivers
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    void (async () => {
      const { data: promos } = await (supabase as any)
        .from('promotions')
        .select('id, title, gain_pct_to_worker, end_at')
        .eq('is_active', true)
        .lte('start_at', new Date().toISOString())
        .gte('end_at', new Date().toISOString())
        .contains('target_audiences', ['drivers'])
        .order('gain_pct_to_worker', { ascending: false })
        .limit(1);
      if (!promos || promos.length === 0) return;
      const promo = promos[0];
      // Check if already adhered
      const { data: existing } = await (supabase as any)
        .from('promotion_adhesions')
        .select('id')
        .eq('promotion_id', promo.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (existing) return; // Already adhered
      setPromoModal({ id: promo.id, title: promo.title, gainPct: promo.gain_pct_to_worker || 0, endAt: promo.end_at });
    })();
  }, [userId]));

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const seen = await hasSeenHomeNoTripGuide(userId);
      if (!cancelled) setNoTripGuideSeen(seen);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const acceptPromotion = async () => {
    if (!promoModal || !userId) return;
    await (supabase as any).from('promotion_adhesions').insert({
      promotion_id: promoModal.id,
      user_id: userId,
      user_type: 'motorista',
    });
    setPromoModal(null);
  };

  const onToggleAvailable = async (value: boolean) => {
    if (!userId || toggleLoading) return;
    setToggleLoading(true);
    setAvailable(value);
    const { error } = await supabase
      .from('worker_profiles')
      .update({ is_available_for_requests: value, updated_at: new Date().toISOString() } as never)
      .eq('id', userId);
    if (error) setAvailable(!value);
    setToggleLoading(false);
  };

  const updateTrunk = async (delta: number) => {
    if (!activeTrip || !userId) return;
    const newPct = Math.max(0, Math.min(100, activeTrip.trunkPct + delta));
    setActiveTrip((prev) => prev ? { ...prev, trunkPct: newPct } : prev);
    await supabase
      .from('scheduled_trips')
      .update({ trunk_occupancy_pct: newPct } as never)
      .eq('id', activeTrip.id);
  };

  const goRoutes = () => navigation.navigate('Profile', { screen: 'WorkerRoutes', params: { fromHome: true } });
  const goSchedule = () => navigation.navigate('Profile', { screen: 'TripSchedule', params: { fromHome: true } });
  const goPending = () => navigation.navigate('PendingRequests');
  const goActivities = () => navigation.navigate('Activities');

  const dismissNoTripGuide = useCallback(() => {
    setNoTripGuideSeen(true);
    if (userId) void markHomeNoTripGuideSeen(userId);
  }, [userId]);

  const goRoutesFromGuide = () => {
    dismissNoTripGuide();
    goRoutes();
  };

  const goScheduleFromGuide = () => {
    dismissNoTripGuide();
    goSchedule();
  };

  const goPendingFromGuide = () => {
    dismissNoTripGuide();
    goPending();
  };

  const goActivitiesFromGuide = () => {
    dismissNoTripGuide();
    goActivities();
  };

  const showNoTripGuideModal =
    !activeTrip && noTripGuideSeen === false && !promoModal && firstStepsHintsEnabled;

  const goDocumentsBanner = () => {
    if (!cnhOk || !cnhBackOk) {
      navigation.navigate('Profile', { screen: 'PersonalInfo' });
      return;
    }
    if (missingVehicleDocument) {
      navigation.navigate('Profile', { screen: 'WorkerVehicles' });
    }
  };

  /** Só documentação pendente (CNH frente/verso ou CRLV do veículo); não PIX nem rotas. */
  const showDocumentsBanner = !cnhOk || !cnhBackOk || missingVehicleDocument;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.center}><ActivityIndicator size="large" color="#111827" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {showDocumentsBanner && (
          <TouchableOpacity style={styles.banner} onPress={goDocumentsBanner} activeOpacity={0.85}>
            <Text style={styles.bannerText}>
              {!cnhOk
                ? 'Adicione a foto da CNH (frente) para concluir seus documentos.'
                : !cnhBackOk
                  ? 'Adicione a foto da CNH (verso) para concluir seus documentos.'
                  : 'Anexe o documento do veículo (CRLV) para concluir o cadastro.'}
            </Text>
            <View style={styles.bannerArrow}>
              <MaterialIcons name="arrow-forward" size={20} color="#5C3D2E" />
            </View>
          </TouchableOpacity>
        )}

        {/* Card da viagem ativa */}
        {activeTrip && (
          <View style={styles.tripCard}>
            <View style={styles.ongoingStrip} accessibilityLabel="Corrida em andamento">
              <MaterialIcons name="directions-car" size={20} color="#166534" />
              <Text style={styles.ongoingStripText}>Corrida em andamento</Text>
            </View>
            {/* Linha de rota */}
            <View style={styles.routeLine}>
              <View style={styles.routeStop}>
                <View style={styles.dotOrigin} />
                <View style={styles.routeConnector} />
                <View style={styles.dotDest} />
              </View>
              <View style={styles.routeAddresses}>
                <View style={styles.routeAddressGroup}>
                  <Text style={styles.routeAddressLabel}>Origem</Text>
                  <Text style={styles.routeAddressValue}>{shortAddr(activeTrip.origin_address)}</Text>
                </View>
                <View style={styles.routeAddressGroup}>
                  <Text style={styles.routeAddressLabel}>Destino</Text>
                  <Text style={styles.routeAddressValue}>{shortAddr(activeTrip.destination_address)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.tripMeta}>
              <View style={styles.metaItem}>
                <MaterialIcons name="access-time" size={18} color="#6B7280" />
                <View>
                  <Text style={styles.metaLabel}>Horário</Text>
                  <Text style={styles.metaValue}>{formatTime(activeTrip.departure_at)}</Text>
                </View>
              </View>
              <View style={styles.metaItem}>
                <MaterialIcons name="people" size={18} color="#6B7280" />
                <View>
                  <Text style={styles.metaLabel}>Passageiros</Text>
                  <Text style={styles.metaValue}>{activeTrip.passengerCount}</Text>
                </View>
              </View>
              {activeTrip.bagsCount > 0 ? (
                <View style={styles.metaItem}>
                  <MaterialIcons name="card-travel" size={18} color="#6B7280" />
                  <View>
                    <Text style={styles.metaLabel}>Malas</Text>
                    <Text style={styles.metaValue}>{activeTrip.bagsCount}</Text>
                  </View>
                </View>
              ) : null}
              {activeTrip.shipmentCount > 0 ? (
                <View style={styles.metaItem}>
                  <MaterialIcons name="inventory-2" size={18} color="#6B7280" />
                  <View>
                    <Text style={styles.metaLabel}>Encomendas</Text>
                    <Text style={styles.metaValue}>{activeTrip.shipmentCount}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Bagageiro */}
            <View style={styles.trunkRow}>
              <View style={styles.trunkBarWrap}>
                <View style={styles.trunkBarBg}>
                  <View
                    style={[
                      styles.trunkBarFill,
                      {
                        width: `${activeTrip.trunkPct}%` as any,
                        backgroundColor:
                          activeTrip.trunkPct >= 80 ? '#EF4444'
                          : activeTrip.trunkPct >= 50 ? '#C9A227'
                          : '#22C55E',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.trunkLabel}>Bagageiro: {activeTrip.trunkPct}%</Text>
              </View>
              <View style={styles.trunkStepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => updateTrunk(-10)} activeOpacity={0.7}>
                  <MaterialIcons name="remove" size={16} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.stepBtn} onPress={() => updateTrunk(10)} activeOpacity={0.7}>
                  <MaterialIcons name="add" size={16} color="#374151" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Mapa da viagem ativa — largura total (evita w=0 com alignItems:center no ScrollView) */}
            <View style={styles.mapWrap}>
              <GoogleMapsMap
                ref={homeMapRef}
                key={`home-map-${activeTrip.id}`}
                style={styles.mapInner}
                initialRegion={mapRegionForTrip(activeTrip)}
                scrollEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
              >
                {activeTrip.origin_lat != null &&
                  activeTrip.origin_lng != null &&
                  activeTrip.destination_lat != null &&
                  activeTrip.destination_lng != null && (
                    <MapPolyline
                      id="home-preview"
                      coordinates={[
                        { latitude: activeTrip.origin_lat, longitude: activeTrip.origin_lng },
                        { latitude: activeTrip.destination_lat, longitude: activeTrip.destination_lng },
                      ]}
                      strokeColor="#C9A227"
                      strokeWidth={4}
                    />
                  )}
                {activeTrip.origin_lat != null && activeTrip.origin_lng != null && (
                  <MapMarker
                    id="origin"
                    coordinate={{ latitude: activeTrip.origin_lat, longitude: activeTrip.origin_lng }}
                    pinColor="#111827"
                  />
                )}
                {activeTrip.destination_lat != null && activeTrip.destination_lng != null && (
                  <MapMarker
                    id="dest"
                    coordinate={{ latitude: activeTrip.destination_lat, longitude: activeTrip.destination_lng }}
                    pinColor="#C9A227"
                  />
                )}
                {activeTrip.bookingPickups.map((p, i) => (
                  <MapMarker
                    key={`pickup-${i}`}
                    id={`pickup-${i}`}
                    coordinate={{ latitude: p.lat, longitude: p.lng }}
                    pinColor="#22C55E"
                  />
                ))}
              </GoogleMapsMap>
              <MapZoomControls mapRef={homeMapRef} style={styles.homeMapZoom} />
            </View>

            <TouchableOpacity style={styles.mapBtn} activeOpacity={0.85} onPress={() => activeTrip && navigation.navigate('ActiveTrip', { tripId: activeTrip.id })}>
              <Text style={styles.mapBtnText}>Continuar Viagem</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Acesso rápido */}
        <Text style={styles.sectionTitle}>Acesso rápido</Text>
        <View style={styles.quickGrid}>
          <TouchableOpacity style={styles.quickCard} onPress={goPending} activeOpacity={0.85}>
            <View style={styles.quickIconWrap}>
              <MaterialIcons name="description" size={28} color="#111827" />
              {pendingCount > 0 && <View style={styles.dot} />}
            </View>
            <Text style={styles.quickLabel}>Viagens{'\n'}pendentes</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickCard} onPress={goSchedule} activeOpacity={0.85}>
            <MaterialIcons name="calendar-today" size={28} color="#111827" />
            <Text style={styles.quickLabel}>Visualizar{'\n'}cronograma</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.quickWide} onPress={goRoutes} activeOpacity={0.85}>
          <MaterialIcons name="place" size={26} color="#111827" />
          <Text style={styles.quickWideLabel}>Rotas e valores</Text>
        </TouchableOpacity>

        {/* Toggle Em viagem */}
        <View style={styles.availRow}>
          <Text style={styles.availLabel}>Em viagem</Text>
          <Switch
            value={activeTrip ? true : available}
            onValueChange={onToggleAvailable}
            disabled={toggleLoading || Boolean(activeTrip)}
            trackColor={{ false: '#E5E7EB', true: '#111827' }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Sem viagem: próxima ação — rotas (sem slot agendado) ou Atividades (já há viagem com rota + horário) */}
        {!activeTrip && firstStepsHintsEnabled && (
          <TouchableOpacity
            style={styles.nextActionCard}
            onPress={hasScheduledRouteWithTime ? goActivities : goRoutes}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={
              hasScheduledRouteWithTime
                ? 'Próximo passo: abrir atividades para iniciar a viagem'
                : 'Próximo passo: abrir rotas e valores'
            }
          >
            <View style={styles.nextActionLeft}>
              <View style={styles.nextActionIconWrap}>
                <MaterialIcons
                  name={hasScheduledRouteWithTime ? 'directions-car' : 'route'}
                  size={26}
                  color="#111827"
                />
              </View>
              <View style={styles.nextActionTextCol}>
                <Text style={styles.nextActionKicker}>Próximo passo</Text>
                <Text style={styles.nextActionTitle}>
                  {hasScheduledRouteWithTime ? 'Iniciar a viagem' : 'Rotas e valores'}
                </Text>
                <Text style={styles.nextActionSub}>
                  {hasScheduledRouteWithTime
                    ? 'Toque para abrir Atividades: veja o cronograma e inicie a viagem quando for a hora.'
                    : 'Toque para cadastrar trechos, horários e preços — necessário para aparecer nas buscas.'}
                </Text>
              </View>
            </View>
            <MaterialIcons name="arrow-forward" size={22} color="#C9A227" />
          </TouchableOpacity>
        )}

        <View style={styles.divider} />
      </ScrollView>

      {/* Promotion opt-in modal */}
      <Modal visible={!!promoModal} transparent animationType="fade" onRequestClose={() => setPromoModal(null)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, gap: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#0d0d0d', textAlign: 'center' }}>
              {'\uD83C\uDF89'} Promoção Especial!
            </Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#0d0d0d', textAlign: 'center' }}>
              {promoModal?.title}
            </Text>
            <View style={{ backgroundColor: '#f0faf4', borderRadius: 12, padding: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 32, fontWeight: '700', color: '#0d8344' }}>
                +{promoModal?.gainPct || 0}%
              </Text>
              <Text style={{ fontSize: 14, color: '#174f38', textAlign: 'center', marginTop: 4 }}>
                de ganho extra por viagem
              </Text>
            </View>
            <Text style={{ fontSize: 13, color: '#767676', textAlign: 'center' }}>
              Válido até {promoModal?.endAt ? new Date(promoModal.endAt).toLocaleDateString('pt-BR') : '—'}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#0d0d0d', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
              onPress={acceptPromotion}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>Aceitar promoção</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPromoModal(null)} activeOpacity={0.7}>
              <Text style={{ fontSize: 14, color: '#767676', textAlign: 'center' }}>Depois</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Guia: sem corrida ativa — rotas, cronograma, disponibilidade */}
      <Modal
        visible={showNoTripGuideModal}
        transparent
        animationType="fade"
        onRequestClose={dismissNoTripGuide}
      >
        <View style={styles.guideOverlay}>
          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>Como receber corridas</Text>
            <Text style={styles.guideIntro}>
              {hasScheduledRouteWithTime
                ? 'Você já tem viagem com rota e horário. Abra Atividades para seguir o cronograma e iniciar quando for a hora.'
                : 'Defina suas rotas e valores, acompanhe o cronograma e fique disponível para novas solicitações.'}
            </Text>

            {hasScheduledRouteWithTime ? (
              <TouchableOpacity style={styles.guideRow} onPress={goActivitiesFromGuide} activeOpacity={0.75}>
                <View style={styles.guideRowIcon}>
                  <MaterialIcons name="directions-car" size={22} color="#111827" />
                </View>
                <View style={styles.guideRowText}>
                  <Text style={styles.guideRowTitle}>Atividades — iniciar viagem</Text>
                  <Text style={styles.guideRowSub}>Cronograma, detalhes da viagem e botão para iniciar.</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.guideRow} onPress={goRoutesFromGuide} activeOpacity={0.75}>
              <View style={styles.guideRowIcon}>
                <MaterialIcons name="alt-route" size={22} color="#111827" />
              </View>
              <View style={styles.guideRowText}>
                <Text style={styles.guideRowTitle}>Rotas e valores</Text>
                <Text style={styles.guideRowSub}>Cadastre trechos, horários e preços por pessoa.</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.guideRow} onPress={goScheduleFromGuide} activeOpacity={0.75}>
              <View style={styles.guideRowIcon}>
                <MaterialIcons name="calendar-today" size={22} color="#111827" />
              </View>
              <View style={styles.guideRowText}>
                <Text style={styles.guideRowTitle}>Cronograma</Text>
                <Text style={styles.guideRowSub}>Veja viagens agendadas e inicie quando for a hora.</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.guideRow} onPress={goPendingFromGuide} activeOpacity={0.75}>
              <View style={styles.guideRowIcon}>
                <MaterialIcons name="notifications-active" size={22} color="#111827" />
              </View>
              <View style={styles.guideRowText}>
                <Text style={styles.guideRowTitle}>Solicitações pendentes</Text>
                <Text style={styles.guideRowSub}>Aceite ou recuse pedidos de passageiros e envios.</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.guideHint}>
              <MaterialIcons name="toggle-on" size={20} color="#374151" />
              <Text style={styles.guideHintText}>
                Nesta tela, ative <Text style={styles.guideHintBold}>Em viagem</Text> para aparecer para novas corridas quando estiver pronto.
              </Text>
            </View>

            <TouchableOpacity style={styles.guideBtn} onPress={dismissNoTripGuide} activeOpacity={0.85}>
              <Text style={styles.guideBtnText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  nextActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderColor: '#C9A227',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    gap: 12,
  },
  nextActionLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 14 },
  nextActionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextActionTextCol: { flex: 1 },
  nextActionKicker: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  nextActionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 4 },
  nextActionSub: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  guideOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 24,
  },
  guideCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    gap: 4,
  },
  guideTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  guideIntro: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  guideRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideRowText: { flex: 1 },
  guideRowTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  guideRowSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  guideHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 4,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
  },
  guideHintText: { flex: 1, fontSize: 13, color: '#4B5563', lineHeight: 19 },
  guideHintBold: { fontWeight: '700', color: '#111827' },
  guideBtn: {
    marginTop: 16,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  guideBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 + SCREEN_TOP_EXTRA_PADDING },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF6EA',
    borderWidth: 1,
    borderColor: '#D4A84B',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 20,
    gap: 14,
  },
  bannerText: { flex: 1, fontSize: 14, color: '#5C3D2E', lineHeight: 20, fontWeight: '600' },
  bannerArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3D565',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Trip card
  tripCard: {
    borderWidth: 1.5, borderColor: '#111827', borderRadius: 16,
    padding: 20, marginBottom: 24,
  },
  ongoingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#DCFCE7',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  ongoingStripText: { fontSize: 15, fontWeight: '700', color: '#166534' },
  routeLine: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  routeStop: { alignItems: 'center', paddingTop: 4 },
  dotOrigin: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#111827',
  },
  routeConnector: { width: 2, flex: 1, backgroundColor: '#D1D5DB', marginVertical: 4 },
  dotDest: {
    width: 10, height: 10, borderRadius: 2, backgroundColor: '#111827',
  },
  routeAddresses: { flex: 1, justifyContent: 'space-between' },
  routeAddressGroup: { gap: 2, marginBottom: 8 },
  routeAddressLabel: { fontSize: 12, color: '#9CA3AF' },
  routeAddressValue: { fontSize: 16, fontWeight: '700', color: '#111827' },
  tripMeta: { gap: 14, marginBottom: 16 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaLabel: { fontSize: 12, color: '#9CA3AF' },
  metaValue: { fontSize: 16, fontWeight: '700', color: '#111827' },
  mapWrap: {
    height: 180,
    width: '100%',
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E5E7EB',
  },
  mapInner: { width: '100%', height: '100%' },
  homeMapZoom: { right: 8, bottom: 8 },
  mapPlaceholder: {
    height: 160,
    width: '100%',
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  mapPreviewInner: { width: '100%', height: '100%', borderRadius: 12 },
  mapPreviewLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#E5E7EB',
  },
  mapPreviewLoadingText: { fontSize: 13, color: '#6B7280' },
  mapBtn: {
    borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginBottom: 0,
  },
  mapBtnText: { fontSize: 15, fontWeight: '600', color: '#111827' },

  // Quick access
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 14 },
  quickGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  quickCard: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 14,
    paddingVertical: 20, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center', minHeight: 110,
  },
  quickIconWrap: { position: 'relative', marginBottom: 10 },
  dot: {
    position: 'absolute', top: -2, right: -4,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#22C55E', borderWidth: 2, borderColor: '#F3F4F6',
  },
  quickLabel: { fontSize: 13, fontWeight: '600', color: '#111827', textAlign: 'center' },
  quickWide: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F3F4F6', borderRadius: 14,
    paddingVertical: 18, paddingHorizontal: 16, marginBottom: 28,
  },
  quickWideLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },

  availRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8,
  },
  availLabel: { fontSize: 16, fontWeight: '600', color: '#111827' },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginTop: 12 },

  trunkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16, gap: 12,
  },
  trunkBarWrap: { flex: 1 },
  trunkBarBg: {
    height: 6, backgroundColor: '#E5E7EB', borderRadius: 3,
    marginBottom: 4, overflow: 'hidden',
  },
  trunkBarFill: { height: 6, borderRadius: 3 },
  trunkLabel: { fontSize: 12, color: '#6B7280' },
  trunkStepper: { flexDirection: 'row', gap: 6 },
  stepBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
});
