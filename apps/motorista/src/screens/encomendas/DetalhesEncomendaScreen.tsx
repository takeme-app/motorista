import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Linking,
  Dimensions,
} from 'react-native';
import { Text } from '../../components/Text';
import { DriverLocationFocusButton } from '../../components/DriverLocationFocusButton';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasEncomendasStackParamList } from '../../navigation/ColetasEncomendasStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import {
  GoogleMapsMap,
  MapMarker,
  MapPolyline,
  MapZoomControls,
  latLngFromDbColumns,
  regionFromLatLngPoints,
  isValidGlobeCoordinate,
  MY_LOCATION_NAV_DELTA,
  type GoogleMapsMapRef,
} from '../../components/googleMaps';
import type { LatLng, MapRegion } from '../../components/googleMaps';
import { getGoogleMapsApiKey, getMapboxAccessToken } from '../../lib/googleMapsConfig';
import { getRouteWithDuration } from '../../lib/route';
import { getCachedRoute, setCachedRoute, hashWaypoints } from '../../lib/routeCache';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useRouteOfflinePack } from '../../hooks/useRouteOfflinePack';
import { MapNetworkBadge } from '../../components/MapNetworkBadge';
import { formatShipmentCode } from '@take-me/shared';

let Location: any = null;
try {
  Location = require('expo-location');
} catch {
  /* native rebuild */
}

const { height: SCREEN_H } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_H * 0.36);
const GOLD = '#C9A227';

type Props = NativeStackScreenProps<ColetasEncomendasStackParamList, 'DetalhesEncomenda'>;

type ShipmentDetail = {
  id: string;
  orderCode: string;
  originAddress: string;
  /** Destino final do envio (após a base). */
  finalDestinationAddress: string;
  baseAddress: string;
  baseName: string;
  packageSize: string;
  amountCents: number;
  instructions: string | null;
  createdAt: string;
  scheduledAt: string | null;
  status: string;
  clientName: string;
  originCoord: LatLng | null;
  /** Ponto de devolução para o preparador. */
  baseCoord: LatLng | null;
  finalDestCoord: LatLng | null;
};

function shipmentOrderCode(id: string): string {
  return formatShipmentCode(id);
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
    }) + ', ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function packageSizeLabel(size: string): string {
  if (size === 'pequeno') return 'Pequeno';
  if (size === 'grande') return 'Grande';
  return 'Médio';
}

/** Câmera priorizando o ponto de coleta (origem), com zoom de rua. */
function regionFocusedOnPickup(origin: LatLng | null, dest: LatLng | null): MapRegion {
  if (origin && isValidGlobeCoordinate(origin.latitude, origin.longitude)) {
    return {
      latitude: origin.latitude,
      longitude: origin.longitude,
      latitudeDelta: 0.048,
      longitudeDelta: 0.048,
    };
  }
  if (dest && isValidGlobeCoordinate(dest.latitude, dest.longitude)) {
    return {
      latitude: dest.latitude,
      longitude: dest.longitude,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    };
  }
  return regionFromLatLngPoints([]);
}

const SUPPORT_PHONE = '+5500000000000';
const SUPPORT_WHATSAPP = '+5500000000000';

export function DetalhesEncomendaScreen({ navigation, route }: Props) {
  const { shipmentId } = route.params;
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [supportVisible, setSupportVisible] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [preparerPos, setPreparerPos] = useState<LatLng | null>(null);
  const [followMyLocation, setFollowMyLocation] = useState(false);
  const followFirstAnimDoneRef = useRef(false);
  const locationSubRef = useRef<{ remove: () => void } | null>(null);
  const mapRef = useRef<GoogleMapsMapRef>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRouteCoords([]);
    const { data } = await supabase
      .from('shipments')
      .select(
        'id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, package_size, amount_cents, instructions, created_at, scheduled_at, status, user_id, base_id',
      )
      .eq('id', shipmentId)
      .maybeSingle();

    if (!data) { setLoading(false); return; }
    const row = data as {
      id: string; origin_address: string; destination_address: string;
      origin_lat: number | null; origin_lng: number | null;
      destination_lat: number | null; destination_lng: number | null;
      package_size: string; amount_cents: number; instructions: string | null;
      created_at: string; scheduled_at: string | null; status: string; user_id: string;
      base_id: string | null;
    };

    const { data: prof } = await supabase
      .from('profiles').select('full_name').eq('id', row.user_id).maybeSingle();
    const p = prof as { full_name?: string | null } | null;

    const originCoord = latLngFromDbColumns(row.origin_lat, row.origin_lng);
    const finalDestCoord = latLngFromDbColumns(row.destination_lat, row.destination_lng);

    let baseCoord: LatLng | null = null;
    let baseAddress = '';
    let baseName = '';
    if (row.base_id) {
      const { data: b } = await supabase
        .from('bases')
        .select('name, address, city, lat, lng')
        .eq('id', row.base_id)
        .eq('is_active', true)
        .maybeSingle();
      if (b) {
        const br = b as { name: string; address: string; city: string; lat: number | null; lng: number | null };
        baseName = br.name;
        baseAddress = [br.name, br.address, br.city].filter(Boolean).join(' — ');
        baseCoord = latLngFromDbColumns(br.lat, br.lng);
      }
    }

    setDetail({
      id: row.id,
      orderCode: shipmentOrderCode(row.id),
      originAddress: row.origin_address,
      finalDestinationAddress: row.destination_address,
      baseAddress: baseAddress || '—',
      baseName,
      packageSize: packageSizeLabel(row.package_size),
      amountCents: row.amount_cents,
      instructions: row.instructions,
      createdAt: formatDateTime(row.created_at),
      scheduledAt: row.scheduled_at ? formatDateTime(row.scheduled_at) : null,
      status: row.status,
      clientName: p?.full_name ?? 'Cliente',
      originCoord,
      baseCoord,
      finalDestCoord,
    });
    setLoading(false);

    const routeEnd = baseCoord ?? finalDestCoord;
    if (
      originCoord &&
      routeEnd &&
      isValidGlobeCoordinate(originCoord.latitude, originCoord.longitude) &&
      isValidGlobeCoordinate(routeEnd.latitude, routeEnd.longitude)
    ) {
      // Hidrata do cache primeiro (instantâneo, funciona offline).
      const cached = await getCachedRoute(`shipment-${shipmentId}`);
      if (cached?.coordinates?.length) setRouteCoords(cached.coordinates);

      const routeOpts = { mapboxToken: getMapboxAccessToken(), googleMapsApiKey: getGoogleMapsApiKey() };
      const res = await getRouteWithDuration(originCoord, routeEnd, routeOpts);
      if (res?.coordinates?.length) {
        setRouteCoords(res.coordinates);
        const waypointsHash = await hashWaypoints([originCoord, routeEnd]);
        await setCachedRoute(`shipment-${shipmentId}`, {
          coordinates: res.coordinates,
          durationSeconds: res.durationSeconds,
          computedAt: Date.now(),
          waypointsHash,
        });
      }
    }
  }, [shipmentId]);

  const { online: isOnline } = useNetworkStatus();
  /** Pack de tiles offline cobrindo a rota da encomenda. */
  useRouteOfflinePack({
    packName: shipmentId ? `shipment-${shipmentId}` : null,
    coords: routeCoords,
    enabled: isOnline,
  });
  const networkBadgeState =
    isOnline ? 'online' : routeCoords.length >= 2 ? 'offline-cached' : 'offline-no-cache';

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!Location) return;
    let mounted = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !mounted) return;
      const pos = await Location.getCurrentPositionAsync({});
      if (mounted) {
        setPreparerPos({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      }
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy?.High ?? 5, distanceInterval: 15 },
        (p: { coords: { latitude: number; longitude: number } }) => {
          if (mounted) setPreparerPos({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        },
      );
    })();
    return () => {
      mounted = false;
      locationSubRef.current?.remove();
    };
  }, []);

  /** Após “minha localização”, câmera segue o GPS até gesto ou zoom pelos botões. */
  useEffect(() => {
    if (!followMyLocation) {
      followFirstAnimDoneRef.current = false;
      return;
    }
    if (!preparerPos || !isValidGlobeCoordinate(preparerPos.latitude, preparerPos.longitude)) return;
    const dur = followFirstAnimDoneRef.current ? 0 : 350;
    followFirstAnimDoneRef.current = true;
    mapRef.current?.animateToRegion(
      {
        latitude: preparerPos.latitude,
        longitude: preparerPos.longitude,
        latitudeDelta: MY_LOCATION_NAV_DELTA,
        longitudeDelta: MY_LOCATION_NAV_DELTA,
      },
      dur,
    );
  }, [preparerPos, followMyLocation]);

  const mapInitialRegion = useMemo(
    () => (detail ? regionFocusedOnPickup(detail.originCoord, detail.baseCoord ?? detail.finalDestCoord) : regionFromLatLngPoints([])),
    [
      detail?.originCoord?.latitude,
      detail?.originCoord?.longitude,
      detail?.baseCoord?.latitude,
      detail?.baseCoord?.longitude,
      detail?.finalDestCoord?.latitude,
      detail?.finalDestCoord?.longitude,
    ],
  );

  const mapReady = Boolean(
    detail?.originCoord &&
      isValidGlobeCoordinate(detail.originCoord.latitude, detail.originCoord.longitude),
  ) || Boolean(
    detail?.baseCoord &&
      isValidGlobeCoordinate(detail.baseCoord.latitude, detail.baseCoord.longitude),
  ) || Boolean(
    detail?.finalDestCoord &&
      isValidGlobeCoordinate(detail.finalDestCoord.latitude, detail.finalDestCoord.longitude),
  );

  const handleCall = () => {
    Linking.openURL(`tel:${SUPPORT_PHONE}`);
    setSupportVisible(false);
  };

  const handleWhatsApp = () => {
    Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP.replace('+', '')}`);
    setSupportVisible(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalhes do pedido</Text>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
          <MaterialIcons name="notifications-none" size={22} color="#111827" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#111827" style={{ marginTop: 48 }} />
      ) : !detail ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Pedido não encontrado</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <View style={styles.mapOuter}>
            {getMapboxAccessToken() && mapReady ? (
              <>
                <View style={styles.mapInnerWrap}>
                <GoogleMapsMap
                  ref={mapRef}
                  style={StyleSheet.absoluteFillObject}
                  initialRegion={mapInitialRegion}
                  scrollEnabled
                  showsUserLocation
                  onDidFinishLoadingMap={() => mapRef.current?.resetCamera()}
                  onDidFinishLoadingStyle={() => mapRef.current?.resetCamera()}
                  onUserAdjustedMap={() => setFollowMyLocation(false)}
                >
                  {routeCoords.length >= 2 ? (
                    <MapPolyline
                      id="shipment-detail-route"
                      coordinates={routeCoords}
                      strokeColor={GOLD}
                      strokeWidth={4}
                    />
                  ) : null}
                  {detail.originCoord &&
                    isValidGlobeCoordinate(detail.originCoord.latitude, detail.originCoord.longitude) && (
                    <MapMarker
                      id="pickup"
                      coordinate={detail.originCoord}
                      anchor={{ x: 0.5, y: 1 }}
                    >
                      <View style={styles.pickupPill}>
                        <MaterialIcons name="inventory-2" size={14} color="#FFF" />
                        <Text style={styles.pickupPillText} numberOfLines={1}>Coleta</Text>
                      </View>
                    </MapMarker>
                  )}
                  {detail.baseCoord &&
                    isValidGlobeCoordinate(detail.baseCoord.latitude, detail.baseCoord.longitude) && (
                    <MapMarker
                      id="base"
                      coordinate={detail.baseCoord}
                      anchor={{ x: 0.5, y: 1 }}
                    >
                      <View style={styles.destPill}>
                        <MaterialIcons name="store" size={12} color="#374151" />
                        <Text style={styles.destPillText} numberOfLines={1}>Base</Text>
                      </View>
                    </MapMarker>
                  )}
                </GoogleMapsMap>
                <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
                  <View style={styles.mapLeftControlsCol} pointerEvents="box-none">
                    <MapZoomControls
                      mapRef={mapRef}
                      floating={false}
                      onBeforeZoom={() => setFollowMyLocation(false)}
                    />
                    <DriverLocationFocusButton
                      following={followMyLocation}
                      style={[!preparerPos && styles.mapMyLocationBtnDisabled]}
                      disabled={!preparerPos}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (!preparerPos || !isValidGlobeCoordinate(preparerPos.latitude, preparerPos.longitude)) return;
                        setFollowMyLocation(true);
                      }}
                    />
                  </View>
                  {!isOnline && (
                    <View style={{ position: 'absolute', top: 12, alignSelf: 'center' }} pointerEvents="none">
                      <MapNetworkBadge state={networkBadgeState} />
                    </View>
                  )}
                </View>
                </View>
              </>
            ) : (
              <View style={[styles.mapPlaceholder, { height: MAP_HEIGHT }]}>
                <MaterialIcons name="map" size={40} color="#C9B87A" />
                <Text style={styles.mapPlaceholderText}>
                  {getMapboxAccessToken()
                    ? 'Coordenadas da coleta indisponíveis para o mapa.'
                    : 'Configure EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN no .env (raiz), prebuild e reinicie o Metro.'}
                </Text>
                <Text style={styles.mapPlaceholderSub} numberOfLines={2}>{detail.originAddress}</Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.tripIdRow}>
              <Text style={styles.tripIdLabel}>ID do pedido</Text>
              <Text style={styles.tripIdValue}>{detail.orderCode}</Text>
            </View>

            {/* Route */}
            <View style={styles.routeRow}>
              <Text style={styles.routeFrom} numberOfLines={1}>{detail.originAddress}</Text>
              <MaterialIcons name="arrow-forward" size={16} color="#C9A227" style={styles.routeArrow} />
              <Text style={styles.routeTo} numberOfLines={2}>{detail.baseAddress}</Text>
            </View>
            <Text style={styles.routeHint}>Sua rota: coleta no cliente → devolução na base.</Text>
            <Text style={styles.finalDestLabel} numberOfLines={2}>
              Destino final do envio: {detail.finalDestinationAddress}
            </Text>

            <View style={styles.cardDivider} />

            {/* Timeline */}
            <View style={styles.timeline}>
              <TimelineItem label="Solicitação" date={detail.createdAt} isLast={!detail.scheduledAt} />
              {detail.scheduledAt && (
                <TimelineItem label="Coleta confirmada" date={detail.scheduledAt} isLast={true} />
              )}
            </View>

            <View style={styles.cardDivider} />

            {/* Client */}
            <View style={styles.clientSection}>
              <View style={styles.clientRow}>
                <View style={styles.clientAvatar}>
                  <Text style={styles.clientAvatarInitial}>
                    {detail.clientName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.clientInfo}>
                  <Text style={styles.clientLabel}>Cliente</Text>
                  <Text style={styles.clientName}>{detail.clientName}</Text>
                </View>
              </View>
            </View>

            <View style={styles.cardDivider} />

            {/* Package info */}
            <View style={styles.packageRow}>
              <View style={styles.packageItem}>
                <Text style={styles.packageItemLabel}>Tamanho</Text>
                <Text style={styles.packageItemValue}>{detail.packageSize}</Text>
              </View>
              <View style={styles.packageDivider} />
              <View style={styles.packageItem}>
                <Text style={styles.packageItemLabel}>Valor</Text>
                <Text style={[styles.packageItemValue, { color: '#C9A227' }]}>{formatCents(detail.amountCents)}</Text>
              </View>
            </View>

            {detail.instructions && (
              <>
                <View style={styles.cardDivider} />
                <Text style={styles.obsLabel}>Instruções</Text>
                <Text style={styles.obsText}>{detail.instructions}</Text>
              </>
            )}

            <View style={styles.cardDivider} />

            {/* Support */}
            <TouchableOpacity
              style={styles.supportRow}
              activeOpacity={0.7}
              onPress={() => setSupportVisible(true)}
            >
              <MaterialIcons name="headset-mic" size={18} color="#6B7280" />
              <Text style={styles.supportText}>Mensagens com o cliente</Text>
              <MaterialIcons name="chevron-right" size={18} color="#9CA3AF" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Support modal */}
      <Modal visible={supportVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSupportVisible(false)} />
        <View style={styles.sheet}>
          <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setSupportVisible(false)} activeOpacity={0.7}>
            <MaterialIcons name="close" size={20} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>Como podemos ajudar?</Text>
          <Text style={styles.sheetSubtitle}>Escolha uma das opções abaixo{'\n'}para entrar em contato</Text>
          <View style={styles.sheetDivider} />
          <TouchableOpacity style={styles.supportOption} onPress={handleCall} activeOpacity={0.85}>
            <View style={styles.supportOptionIcon}>
              <MaterialIcons name="phone" size={24} color="#92400E" />
            </View>
            <Text style={styles.supportOptionText}>Ligar para o suporte Take Me</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.supportOption} onPress={handleWhatsApp} activeOpacity={0.85}>
            <View style={styles.supportOptionIcon}>
              <MaterialIcons name="chat" size={24} color="#92400E" />
            </View>
            <Text style={styles.supportOptionText}>WhatsApp do Take Me</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.supportOption} onPress={() => setSupportVisible(false)} activeOpacity={0.85}>
            <View style={styles.supportOptionIcon}>
              <MaterialIcons name="headset-mic" size={24} color="#92400E" />
            </View>
            <Text style={styles.supportOptionText}>Chat com o suporte Take Me</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TimelineItem({ label, date, isLast }: { label: string; date: string; isLast: boolean }) {
  return (
    <View style={tlStyles.row}>
      <View style={tlStyles.dotCol}>
        <View style={tlStyles.dot} />
        {!isLast && <View style={tlStyles.line} />}
      </View>
      <View style={tlStyles.content}>
        <Text style={tlStyles.label}>{label}</Text>
        <Text style={tlStyles.date}>{date}</Text>
      </View>
    </View>
  );
}

const tlStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  dotCol: { alignItems: 'center', width: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#9CA3AF', marginTop: 4 },
  line: { flex: 1, width: 2, backgroundColor: '#E5E7EB', minHeight: 24, marginTop: 4 },
  content: { flex: 1, paddingBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  date: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#111827', textAlign: 'center' },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingBottom: 40 },
  mapOuter: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F0EDE8',
    position: 'relative',
  },
  mapInnerWrap: {
    height: MAP_HEIGHT,
    width: '100%',
    position: 'relative',
  },
  mapLeftControlsCol: {
    position: 'absolute',
    top: 10,
    left: 10,
    gap: 10,
    alignItems: 'center',
  },
  mapMyLocationBtnDisabled: { opacity: 0.45 },
  pickupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GOLD,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    maxWidth: 160,
  },
  pickupPillText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF', flexShrink: 1 },
  destPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxWidth: 140,
  },
  destPillText: { fontSize: 11, fontWeight: '700', color: '#374151', flexShrink: 1 },
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  mapPlaceholderText: { fontSize: 13, color: '#6B7280', fontWeight: '500', textAlign: 'center' },
  mapPlaceholderSub: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },
  card: {
    marginHorizontal: 20, marginTop: 16,
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 20, overflow: 'hidden',
  },
  tripIdRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  tripIdLabel: { fontSize: 13, color: '#9CA3AF' },
  tripIdValue: { fontSize: 13, fontWeight: '700', color: '#111827' },
  routeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  routeFrom: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },
  routeArrow: { marginHorizontal: 8 },
  routeTo: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1, textAlign: 'right' },
  routeHint: {
    fontSize: 12, color: '#6B7280', paddingHorizontal: 16, paddingBottom: 6, lineHeight: 17,
  },
  finalDestLabel: {
    fontSize: 12, color: '#9CA3AF', paddingHorizontal: 16, paddingBottom: 12, lineHeight: 17,
  },
  cardDivider: { height: 1, backgroundColor: '#F3F4F6' },
  timeline: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  clientSection: { paddingHorizontal: 16, paddingVertical: 16 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clientAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center',
  },
  clientAvatarInitial: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  clientInfo: { flex: 1 },
  clientLabel: { fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  clientName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  packageRow: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 16,
  },
  packageItem: { flex: 1, alignItems: 'center', gap: 4 },
  packageItemLabel: { fontSize: 12, color: '#9CA3AF' },
  packageItemValue: { fontSize: 16, fontWeight: '700', color: '#111827' },
  packageDivider: { width: 1, backgroundColor: '#E5E7EB' },
  obsLabel: { fontSize: 13, fontWeight: '600', color: '#374151', paddingHorizontal: 16, paddingTop: 14, marginBottom: 4 },
  obsText: { fontSize: 14, color: '#6B7280', paddingHorizontal: 16, paddingBottom: 14, lineHeight: 20 },
  supportRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 16,
  },
  supportText: { fontSize: 14, color: '#6B7280' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, color: '#9CA3AF' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingBottom: 48, paddingTop: 24,
  },
  sheetCloseBtn: {
    alignSelf: 'flex-end', width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  sheetTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 8 },
  sheetSubtitle: { fontSize: 14, color: '#9CA3AF', lineHeight: 22, marginBottom: 20 },
  sheetDivider: { height: 1, backgroundColor: '#F3F4F6', marginBottom: 20 },
  supportOption: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#FFFBEB', borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 16, marginBottom: 12,
  },
  supportOptionIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center',
  },
  supportOptionText: { fontSize: 16, fontWeight: '600', color: '#111827', flex: 1 },
});
