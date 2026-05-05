import { memo, useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Animated,
  Pressable,
  Platform,
  useWindowDimensions,
  Alert,
  Image,
  KeyboardAvoidingView,
  BackHandler,
  Vibration,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar, setStatusBarHidden } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import {
  GoogleMapsMap,
  MapMarker,
  MapPolyline,
  MapZoomControls,
  type GoogleMapsMapRef,
  type LatLng,
  type MapRegion,
  regionFromLatLngPoints,
  isValidGlobeCoordinate,
  latLngFromDbColumns,
  MY_LOCATION_NAV_DELTA,
} from '../components/googleMaps';
import { NavigationView, latLngToWaypoint, type RouteProgressEvent } from '../components/navigation';
import { useNativeNavigationEnabled } from '../lib/navigationFeatureFlag';
import { supabase } from '../lib/supabase';
import { tripDisplayEarningsCents } from '../lib/driverTripEarnings';
import { closeConversationsForScheduledTrip } from '../lib/closeTripConversations';
import {
  useTripStops,
  type TripStop,
  STOP_TYPE_COLORS,
  computeFirstIncompleteStopIndex,
  isSyntheticTripStopId,
  normalizeTripStopTypeFromDb,
  dependentShipmentIdFromSyntheticStopId,
  fetchDependentShipmentEntityAliasKeys,
  ensureAllTripStopsRemote,
} from '../hooks/useTripStops';
import { Text } from '../components/Text';
import { DriverLocationFocusButton } from '../components/DriverLocationFocusButton';
import { MapNetworkBadge } from '../components/MapNetworkBadge';
import { SmoothDriverMapMarker } from '../components/SmoothDriverMapMarker';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useRouteOfflinePack } from '../hooks/useRouteOfflinePack';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getRouteWithDuration, getMultiPointRoute, formatEta } from '../lib/route';
import { getGoogleMapsApiKey, getMapboxAccessToken } from '../lib/googleMapsConfig';
import { getUserErrorMessage, isTripRatingsUnavailableError } from '../utils/errorMessage';
import { onlyDigits } from '../utils/formatCpf';
import { insertPlannedRouteSlotAfterComplete } from '../lib/insertPlannedRouteSlotAfterComplete';
import {
  buildNavigationPadding,
  computeNextNavigationCamera,
  createInitialBearingState,
  haversineMeters,
  offsetLatLngByMeters,
  type DriverFix,
  type NavigationBearingState,
  type NavigationEdgePadding,
} from '../lib/navigationCamera';
import { snapToRoutePolyline, trimPolylineFromSnap } from '../lib/routeSnap';
import {
  formatDependentShipmentCode,
  formatShipmentCode,
  formatTripCode,
} from '@take-me/shared';
import * as ImagePicker from 'expo-image-picker';
// expo-location — defensive import (needs native rebuild if just added)
let Location: any = null;
try { Location = require('expo-location'); } catch { /* not available yet */ }

/** Distância máxima para projetar o GPS na polyline (map matching simples). */
const NAV_ROUTE_SNAP_MAX_M = 68;

function trimRoutePolylineFromDriverSnap(driverPos: LatLng, poly: LatLng[]): LatLng[] {
  if (poly.length < 2) return poly;
  const snapD = snapToRoutePolyline(driverPos, poly, NAV_ROUTE_SNAP_MAX_M);
  if (snapD.distanceM > NAV_ROUTE_SNAP_MAX_M) return poly;
  let td = trimPolylineFromSnap(poly, snapD.segmentIndex, snapD.snapped);
  if (td.length < 2 && poly.length >= 2) {
    td = [snapD.snapped, poly[poly.length - 1]];
  }
  return td.length >= 2 ? td : poly;
}
/**
 * Metros à frente do PIN para o centro da câmera (só com polyline de rota).
 * O centro “à frente” empurra o ícone do motorista para baixo na tela; manter moderado.
 */
const NAV_LOOK_AHEAD_M = 70;
/** Salto GPS entre leituras acima disso não entra no odômetro (ruído / teletransporte). */
const ODOM_MAX_SEGMENT_M = 450;
/** Distância (m) do motorista à polyline para considerar "fora de rota" e recalcular. */
const REROUTE_TRIGGER_M = 55;
/** Cooldown entre recálculos automáticos consecutivos (ms). */
const REROUTE_COOLDOWN_MS = 10_000;
/** Número de fixes GPS fora da rota antes de acionar o recálculo (evita falso-positivo em curvas). */
const REROUTE_MIN_CONSECUTIVE_FIXES = 2;
/** Velocidade mínima (m/s) do motorista para considerar reroute — evita recalcular quando parado. */
const REROUTE_MIN_SPEED_MPS = 1;
/** Gatilho rápido por curva errada: >90° entre heading do GPS e bearing do segmento da rota. */
const REROUTE_FAST_BEARING_DELTA_DEG = 90;
/** Velocidade mínima (m/s) para habilitar o gatilho rápido por bearing. */
const REROUTE_FAST_MIN_SPEED_MPS = 3;
/** Fator do REROUTE_TRIGGER_M para o gatilho rápido (metade da distância normal). */
const REROUTE_FAST_DISTANCE_FACTOR = 0.5;
/** Janela que agrupa recálculos "frequentes" para decidir cooldown adaptativo. */
const REROUTE_ADAPTIVE_WINDOW_MS = 60_000;
/** Cooldown estendido quando o motorista recalcula múltiplas vezes na janela acima. */
const REROUTE_ADAPTIVE_COOLDOWN_MS = 30_000;
/** Número de reroutes na janela que ativa o cooldown estendido. */
const REROUTE_ADAPTIVE_THRESHOLD = 2;
/** Tempo mínimo de exibição do badge "Recalculando" para não piscar. */
const REROUTE_BADGE_MIN_VISIBLE_MS = 1800;
/** Timeout sem resposta → assume falha de rede e sinaliza badge vermelho. */
const REROUTE_NETWORK_FAIL_AFTER_MS = 15_000;
/** Duração da animação de entrada/saída do badge de reroute. */
const REROUTE_BADGE_ANIM_MS = 220;
/** Após este tempo, exibe countdown "~Ns" ao lado da mensagem para dar sensação de progresso. */
const REROUTE_BADGE_ELAPSED_THRESHOLD_MS = 2_000;

/** Diferença mínima entre heading do GPS e bearing do segmento da rota para
 *  classificar como "direção errada" (> 90°). */
const WRONG_DIRECTION_DELTA_DEG = 100;
/** Tempo mínimo persistindo na condição antes de mostrar o aviso. */
const WRONG_DIRECTION_ENTER_MS = 1_500;
/** Tempo mínimo na condição contrária antes de remover o aviso (anti-flicker). */
const WRONG_DIRECTION_LEAVE_MS = 1_500;
/** Velocidade mínima para considerar o heading do GPS confiável (m/s). */
const WRONG_DIRECTION_MIN_SPEED_MPS = 2;

/**
 * Abaixo desta velocidade, o curso reportado pelo GPS é instável (ruído de
 * fix); priorizamos a bússola para alimentar o heading do ícone.
 *  - 1.5 m/s ≈ 5.4 km/h (caminhada rápida / manobra lenta)
 */
const COMPASS_HEADING_MAX_SPEED_MPS = 1.5;
/** Vibração curta ao detectar desvio — feedback tátil universal (iOS + Android). */
const REROUTE_HAPTIC_MS = 40;

/**
 * Recuo de zoom aplicado durante navegação ativa: valores positivos afastam a câmera do PIN.
 * Cada unidade equivale aproximadamente a 2× mais área visível na tela.
 * (O zoom base do SDK fica em ~17.75–19.5; com -1.8 fica em ~15.95–17.7 — rua completa visível.)
 */
const TRIP_NAV_ZOOM_OFFSET = 1.8;

/** Intervalo do loop de dead-reckoning (ms) — ~60 fps. Aproxima a suavidade de Waze/Uber. */
const DR_TICK_MS = 16;
/** Duração da animação da câmera por tick: ~1.7× o tick para blending suave entre frames. */
const DR_CAMERA_ANIM_MS = 28;

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveTrip'>;

const DARK = '#111827';
const GOLD = '#C9A227';
/**
 * Padding inferior (pt ≈ dp) entre o centro “útil” do mapa SDK e o fundo seguro —
 * espaço ocupado pelo mini sheet flutuante + folga (~igual aos estilos do card).
 *
 * Valor maior puxa o motorista para cima na tela (estilo Waze) e dá espaço para
 * o `viewportDataSource` "olhar à frente", o que estabiliza a câmera durante
 * o tracking — evita a sensação de travado vinda de re-centramentos abruptos.
 */
const SDK_NATIVE_FLOATING_CARD_PADDING = 380;
/**
 * Zoom fixo do SDK no modo following. Maior = mais perto da posição do motorista.
 * 17.8 é o sweet spot Waze-like: amplo o suficiente para ver a próxima manobra
 * e estável o bastante para não amplificar jitter do GPS.
 */
const SDK_NATIVE_FOLLOWING_ZOOM = 17.8;
const SDK_NATIVE_CONTROL_GAP = 12;
const SDK_NATIVE_ROUTE_GUIDE_MAX_POINTS = 25;
/** Trecho imediato no mapa (GPS → próxima etapa): preto, distinto do ouro contínuo. */
const ROUTE_IMMEDIATE_LEG_COLOR = DARK;
/** Âncora compartilhada dos marcadores do mapa (centralizados no ponto). Referência estável
 *  → ajuda o `React.memo` do MapMarker a não recalcular por causa de objeto novo a cada render. */
const MAP_MARKER_CENTER_ANCHOR = { x: 0.5, y: 0.5 } as const;
/** `mapbox://styles/mapbox/streets-v12` — camada viária alta o suficiente para a rota não ficar por baixo das ruas. */
const MAPBOX_STREETS_ROUTE_ABOVE_LAYER_ID = 'road-motorway-trunk';
/**
 * Traço da rota imediata “mais próxima” (Mapbox): [traço, intervalo] em múltiplos da espessura da linha.
 * Valores um pouco maiores leem melhor no ecrã.
 */
const NEAREST_ROUTE_LINE_DASH: [number, number] = [4, 3];
/** Reduz rajadas de `getRoute` quando o GPS muda antes da resposta (cancelava o `.then` e a linha sumia). */
const NEAREST_DASHED_ROUTE_FETCH_DEBOUNCE_MS = 450;
/**
 * GPS chama o callback com frequência alta; `setDriverPosition` re-renderiza toda a `ActiveTripScreen`
 * (mapa + overlays). Ref sempre atualizado; React só neste intervalo ou após deslocamento mínimo.
 *
 * Valores reduzidos (de 160ms/10m → 90ms/4m) deixam o pin do motorista visivelmente
 * mais fluido tipo Waze/Uber. O dead-reckoning interno (`DR_TICK_MS = 16`) já cuida
 * da câmera; aqui é só a frequência com que o estado React reflete o GPS.
 */
const DRIVER_POSITION_UI_MIN_INTERVAL_MS = 90;
const DRIVER_POSITION_UI_MIN_MOVE_M = 4;
/** Soma trechos no ref e consolida `setTraveledMeters` em um único update periódico. */
const ODOMETER_UI_FLUSH_MS = 650;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stop = TripStop;
type CashPaymentInfo = {
  label: 'Viagem' | 'Encomenda' | 'Envio de dependente';
  amountCents: number;
};

type TripEntityEarningInfo = {
  amountCents: number;
  workerEarningCents: number | null;
  status?: string | null;
};

/** Helper — stop é coleta (embarque / pick-up) */
function isPickup(s: Stop) {
  return (
    s.stopType === 'passenger_pickup' ||
    s.stopType === 'dependent_pickup' ||
    s.stopType === 'package_pickup'
  );
}
/** Helper — stop é de passageiro */
function isPassenger(s: Stop) { return s.stopType === 'passenger_pickup' || s.stopType === 'passenger_dropoff'; }
/** Envio de dependente na viagem (embarque/desembarque do dependente). */
function isDependent(s: Stop) {
  return s.stopType === 'dependent_pickup' || s.stopType === 'dependent_dropoff';
}

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * RPC `resolve_*_trip_stop_row` por prefixo: converte id sintético do app
 * (`booking-…`, `shipment-…`, `dependent-…`) em UUID real de `trip_stops`.
 */
type SyntheticPrefix = 'booking' | 'shipment' | 'dependent';

function detectSyntheticPrefix(stopId: string): SyntheticPrefix | null {
  const m = /^(booking|shipment|dependent)-(pickup|dropoff)-/i.exec(stopId);
  return m ? (m[1].toLowerCase() as SyntheticPrefix) : null;
}

async function rpcResolveTripStopRow(
  prefix: SyntheticPrefix,
  scheduledTripId: string,
  clientStopId: string,
  fallbackEntityId: string | null,
): Promise<string | null> {
  const rpcName =
    prefix === 'dependent'
      ? 'resolve_dependent_trip_stop_row'
      : prefix === 'shipment'
        ? 'resolve_shipment_trip_stop_row'
        : 'resolve_passenger_trip_stop_row';
  const { data, error } = await supabase.rpc(
    rpcName as never,
    {
      p_scheduled_trip_id: scheduledTripId,
      p_client_stop_id: clientStopId,
      p_fallback_entity_id: fallbackEntityId,
    } as never,
  );
  if (error) return null;
  const v = String(data ?? '').trim();
  return looksLikeUuid(v) && !isSyntheticTripStopId(v) ? v : null;
}

/**
 * Fallback por entidade + tipo, quando a RPC de resolve falha em deploys antigos.
 * Lê direto `trip_stops` e casa `entity_id` + `stop_type` normalizado.
 */
async function findRealTripStopIdByEntity(
  scheduledTripId: string,
  stop: TripStop,
): Promise<string | null> {
  const wantT = stop.stopType;
  const wantEntityKeys = new Set<string>();
  const we = String(stop.entityId ?? '').trim().toLowerCase();
  if (we) wantEntityKeys.add(we);
  const depSyn = dependentShipmentIdFromSyntheticStopId(stop.id);
  if (depSyn) wantEntityKeys.add(depSyn);
  if (depSyn && (wantT === 'dependent_pickup' || wantT === 'dependent_dropoff')) {
    const am = await fetchDependentShipmentEntityAliasKeys(scheduledTripId, [depSyn]);
    for (const a of am.get(depSyn) ?? []) wantEntityKeys.add(a);
  }
  if (wantEntityKeys.size === 0) return null;

  const { data, error } = await supabase
    .from('trip_stops')
    .select('id, entity_id, stop_type')
    .eq('scheduled_trip_id', scheduledTripId);
  if (error || !data?.length) return null;

  for (const row of data as { id: string; entity_id?: string | null; stop_type?: string | null }[]) {
    const eid = String(row.entity_id ?? '').trim().toLowerCase();
    if (!wantEntityKeys.has(eid)) continue;
    const mapped = normalizeTripStopTypeFromDb(String(row.stop_type ?? ''));
    if (mapped === wantT) return String(row.id);
  }
  return null;
}

/** Reconcilia um id sintético → UUID real, materializando paradas no servidor se preciso. */
async function resolveSyntheticTripStopId(
  scheduledTripId: string,
  stop: TripStop,
): Promise<string | null> {
  const prefix = detectSyntheticPrefix(stop.id);
  if (!prefix) return null;
  const fallbackEntityId = looksLikeUuid(String(stop.entityId ?? '')) ? String(stop.entityId) : null;

  // 1ª tentativa: RPC específica do tipo (materializa internamente se faltar).
  let real = await rpcResolveTripStopRow(prefix, scheduledTripId, stop.id, fallbackEntityId);
  if (real) return real;

  // 2ª: garante que todas as paradas (passageiro/encomenda/dependente) estejam materializadas.
  await ensureAllTripStopsRemote(scheduledTripId);
  real = await rpcResolveTripStopRow(prefix, scheduledTripId, stop.id, fallbackEntityId);
  if (real) return real;

  // 3ª: busca direta em trip_stops por entity_id + stop_type.
  return findRealTripStopIdByEntity(scheduledTripId, stop);
}
/** Helper — stop é de encomenda */
function isPackage(s: Stop) { return s.stopType === 'package_pickup' || s.stopType === 'package_dropoff'; }

function formatCurrencyCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function entityEarningCents(row: TripEntityEarningInfo): number {
  const worker = Number(row.workerEarningCents);
  if (Number.isFinite(worker) && worker > 0) return Math.floor(worker);
  const amount = Number(row.amountCents);
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
}

function countsAsTripTotal(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s !== 'cancelled' && s !== 'rejected' && s !== 'expired';
}

/**
 * Paradas que exigem PIN de 4 dígitos digitado no app do motorista:
 *   - encomenda sem base: coleta é validada pelo cliente; entrega é validada pelo motorista.
 *   - encomenda com base: retirada na base e entrega são validadas pelo motorista.
 *   - passageiro: apenas embarque (desembarque é livre — cenário 1 do PDF).
 *   - dependente: embarque E desembarque (cenário 2 do PDF, etapas 1-3 e 5-7).
 */
function requiresDriverEnteredPin(s: Stop): boolean {
  if (s.stopType === 'package_pickup' && !isPackagePickupAtBase(s)) return false;
  if (isPackage(s)) return true;
  return (
    s.stopType === 'passenger_pickup' ||
    s.stopType === 'dependent_pickup' ||
    s.stopType === 'dependent_dropoff'
  );
}

function isPackagePickupAtBase(s: Stop | null | undefined): boolean {
  return !!s && s.stopType === 'package_pickup' && s.packageDriverLeg === 'base_pickup';
}

function isPackagePickupWithClientValidation(s: Stop | null | undefined): boolean {
  return !!s && s.stopType === 'package_pickup' && !isPackagePickupAtBase(s);
}

function isRouteWaypointStop(s: Stop) {
  return s.stopType === 'excursion_stop' || s.stopType === 'trip_destination';
}

/** Ícone no mapa / sidebar: passageiro, encomenda (caixa), destino (bandeira), base, demais “place”. */
function StopKindMarkerIcon({
  stop,
  completed,
  color,
  size = 18,
}: {
  stop: Stop;
  completed: boolean;
  color: string;
  size?: number;
}) {
  if (completed) {
    return <MaterialIcons name="check" size={size} color={color} />;
  }
  if (isDependent(stop)) {
    return <MaterialIcons name="child-care" size={size} color={color} />;
  }
  if (isPassenger(stop)) {
    return <MaterialIcons name="person" size={size} color={color} />;
  }
  if (isPackage(stop)) {
    return (
      <MaterialIcons
        name={isPackagePickupAtBase(stop) ? 'store' : 'inventory-2'}
        size={size}
        color={color}
      />
    );
  }
  if (stop.stopType === 'trip_destination') {
    return <MaterialIcons name="flag" size={size} color={color} />;
  }
  if (stop.stopType === 'base_dropoff') {
    return <MaterialIcons name="business" size={size} color={color} />;
  }
  return <MaterialIcons name="place" size={size} color={color} />;
}

// ---------------------------------------------------------------------------
// Markers do mapa (memoizados)
// ---------------------------------------------------------------------------

/**
 * Marcador de parada no mapa. Recebe apenas primitivas → o `React.memo` em
 * `MapMarker` só re-renderiza quando algo de fato mudou desta parada, mesmo
 * que o pai (`ActiveTripScreen`) re-renderize por GPS/ETA/UI.
 */
type ActiveStopMarkerProps = {
  id: string;
  stop: Stop;
  latitude: number;
  longitude: number;
  completed: boolean;
  isActiveSequentialStop: boolean;
  markerBg: string;
};

const ActiveStopMarker = memo(function ActiveStopMarker({
  id,
  stop,
  latitude,
  longitude,
  completed,
  isActiveSequentialStop,
  markerBg,
}: ActiveStopMarkerProps) {
  return (
    <MapMarker id={id} coordinate={{ latitude, longitude }} anchor={MAP_MARKER_CENTER_ANCHOR}>
      <View
        style={[
          styles.mapMarkerOuter,
          isActiveSequentialStop && styles.mapMarkerOuterGpsNext,
        ]}
      >
        <View style={[styles.mapMarker, { backgroundColor: markerBg }]}>
          <StopKindMarkerIcon stop={stop} completed={completed} color="#fff" />
        </View>
      </View>
    </MapMarker>
  );
});

/**
 * Marcador do motorista (pin do carro). Isolado em memo para que o tick do
 * GPS + re-render da tela inteira não force o Mapbox a refazer a view nativa
 * deste marker quando só mudou uma coord insignificante.
 */
/** Rótulo curto no card inferior — nunca tratar desembarque de passageiro como “Entrega”. */
function stopPhaseShortLabel(s: Stop): string {
  switch (s.stopType) {
    case 'passenger_pickup':
      return 'Embarque';
    case 'passenger_dropoff':
      return 'Desembarque';
    case 'dependent_pickup':
      return 'Embarque dependente';
    case 'dependent_dropoff':
      return 'Desembarque dependente';
    case 'package_pickup':
      return isPackagePickupAtBase(s) ? 'Retirada' : 'Coleta';
    case 'package_dropoff':
      return 'Entrega';
    case 'excursion_stop':
      return 'Parada';
    case 'trip_destination':
      return 'Destino';
    case 'base_dropoff':
      return 'Base';
    default:
      return 'Viagem';
  }
}

function stopModalCode(stop: Stop): { label: string; code: string } | null {
  if (isPackage(stop)) {
    return { label: 'Encomenda', code: formatShipmentCode(stop.entityId) };
  }
  if (isDependent(stop)) {
    const dependentShipmentId = dependentShipmentIdFromSyntheticStopId(stop.id) ?? stop.entityId;
    return { label: 'Envio de dependente', code: formatDependentShipmentCode(dependentShipmentId) };
  }
  if (isPassenger(stop) || stop.stopType === 'trip_destination') {
    return { label: 'Viagem', code: formatTripCode(stop.entityId) };
  }
  return null;
}

function detailSheetTitle(stop: Stop | null): string {
  if (!stop) return '';
  switch (stop.stopType) {
    case 'passenger_pickup':
      return 'Detalhes do embarque';
    case 'passenger_dropoff':
      return 'Detalhes do desembarque';
    case 'dependent_pickup':
      return 'Embarque do dependente';
    case 'dependent_dropoff':
      return 'Desembarque do dependente';
    case 'package_pickup':
      return isPackagePickupAtBase(stop) ? 'Retirada na base' : 'Detalhes da coleta';
    case 'package_dropoff':
      return `Entrega para ${stop.label}`;
    case 'excursion_stop':
      return 'Parada na rota';
    case 'trip_destination':
      return 'Destino da viagem';
    case 'base_dropoff':
      return 'Entrega na base';
    default:
      return 'Detalhes da parada';
  }
}

function confirmPickupTitle(stop: Stop | null | undefined): string {
  if (!stop) return 'Confirmar';
  if (stop.stopType === 'passenger_dropoff' || stop.stopType === 'dependent_dropoff') {
    return 'Confirmar desembarque';
  }
  if (stop.stopType === 'trip_destination') return 'Concluir chegada';
  if (stop.stopType === 'excursion_stop') return 'Concluir parada';
  if (stop.stopType === 'package_pickup') {
    return isPackagePickupAtBase(stop) ? 'Confirmar retirada na base' : 'Confirmar coleta';
  }
  return 'Confirmar embarque';
}

function confirmPickupSubtitle(stop: Stop | null | undefined): string {
  if (!stop) return '';
  if (stop.stopType === 'package_pickup') {
    if (isPackagePickupAtBase(stop)) {
      // PDF cenário 3, etapas 10-11: motorista solicita o código à base e digita.
      return 'Solicite o código de 4 dígitos à base e digite abaixo para retirar a encomenda.';
    }
    return 'Informe este código ao cliente. Ele deve digitar no app dele para validar a coleta; depois toque abaixo para avançar.';
  }
  if (stop.stopType === 'package_dropoff') return '';
  if (isPackage(stop)) return 'Insira o código de 4 dígitos informado pelo remetente.';
  if (stop.stopType === 'passenger_pickup') {
    return 'Insira o código de 4 dígitos exibido no app do passageiro para confirmar o embarque.';
  }
  if (stop.stopType === 'passenger_dropoff') {
    return 'Confirme que o passageiro desembarcou neste ponto.';
  }
  if (stop.stopType === 'dependent_pickup') {
    return 'Insira o código de 4 dígitos exibido no app do responsável para confirmar o embarque do dependente.';
  }
  if (stop.stopType === 'dependent_dropoff') {
    // PDF cenário 2, etapas 5-7: motorista solicita o código ao responsável no destino.
    return 'Solicite ao responsável no destino o código de 4 dígitos e digite para confirmar a entrega do dependente.';
  }
  if (stop.stopType === 'trip_destination') return 'Confirme a chegada ao destino da viagem.';
  if (stop.stopType === 'excursion_stop') return 'Confirme que esta parada na rota foi concluída.';
  return 'Confirme o embarque do passageiro.';
}

function confirmPickupButtonLabel(stop: Stop | null | undefined): string {
  if (!stop) return 'Confirmar';
  if (stop.stopType === 'passenger_dropoff' || stop.stopType === 'dependent_dropoff') {
    return 'Confirmar desembarque';
  }
  if (isRouteWaypointStop(stop)) return 'Concluir';
  if (stop.stopType === 'package_pickup') {
    return isPackagePickupAtBase(stop)
      ? 'Confirmar retirada'
      : 'Cliente confirmou — seguir';
  }
  return 'Confirmar embarque';
}

type TripRow = {
  id: string;
  origin_address: string;
  destination_address: string;
  departure_at: string;
  /** Quando o motorista de fato iniciou a viagem (preferir para “tempo total”). */
  driver_journey_started_at?: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  amount_cents: number | null;
  status: string;
  route_id?: string | null;
  day_of_week?: number | null;
  departure_time?: string | null;
  arrival_time?: string | null;
  capacity?: number | null;
  price_per_person_cents?: number | null;
  bookings?: { amount_cents: number; worker_earning_cents?: number | null; status: string }[] | null;
};

/** Destino final no sheet ao tocar na bandeira da lateral (quando o destino não está como parada em `trip_stops`). */
function buildSidebarTripDestinationStop(trip: TripRow, tripDestLL: LatLng): Stop {
  const addr = trip.destination_address || '';
  const line = addr.split('\n')[0]?.trim();
  return {
    id: 'sidebar-trip-destination',
    scheduledTripId: trip.id,
    stopType: 'trip_destination',
    entityId: trip.id,
    label: line || 'Destino da viagem',
    address: addr,
    lat: trip.destination_lat ?? tripDestLL.latitude,
    lng: trip.destination_lng ?? tripDestLL.longitude,
    sequenceOrder: 999_999,
    status: 'pending',
    notes: null,
    code: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDuration(startIso: string, endDate: Date): string {
  const diffMs = endDate.getTime() - new Date(startIso).getTime();
  const totalMin = Math.max(0, Math.floor(diffMs / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

/** HEIC/PNG etc. — alinha content-type ao arquivo real (evita upload como image/jpeg incorreto). */
function mimeAndExtFromExpenseAsset(asset: ImagePicker.ImagePickerAsset): { mime: string; ext: string } {
  const mime = (asset.mimeType ?? '').toLowerCase() || 'image/jpeg';
  if (mime.includes('png')) return { mime: 'image/png', ext: 'png' };
  if (mime.includes('webp')) return { mime: 'image/webp', ext: 'webp' };
  if (mime.includes('heic')) return { mime: 'image/heic', ext: 'heic' };
  if (mime.includes('heif')) return { mime: 'image/heif', ext: 'heif' };
  if (mime.includes('gif')) return { mime: 'image/gif', ext: 'gif' };
  const name = (asset.fileName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const e = name.slice(dot + 1);
    if (e === 'png') return { mime: 'image/png', ext: 'png' };
    if (e === 'webp') return { mime: 'image/webp', ext: 'webp' };
    if (e === 'heic' || e === 'heif') return { mime: e === 'heif' ? 'image/heif' : 'image/heic', ext: e };
    if (e === 'gif') return { mime: 'image/gif', ext: 'gif' };
  }
  return { mime: 'image/jpeg', ext: 'jpg' };
}

/** Android pode destruir a Activity ao fechar o picker — recupera o resultado pendente. */
async function mergePendingAndroidGalleryResult(
  result: ImagePicker.ImagePickerResult,
): Promise<ImagePicker.ImagePickerResult> {
  if (Platform.OS !== 'android' || !result.canceled) return result;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    if (pending == null) return result;
    if ('code' in pending && typeof (pending as { code?: string }).code === 'string') return result;
    if ('assets' in pending && pending.assets && pending.assets.length > 0) {
      return { canceled: false, assets: pending.assets };
    }
  } catch {
    /* ignore */
  }
  return result;
}

/** Upload no Storage: evita `fetch(uri)` + Blob (quebram com ph:// e com alguns tipos no RN). */
function uint8ArrayFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Ignora null, NaN e (0,0) — evita rotas para o Atlântico vindas do banco. */
function pickStopCoord(
  lat: number | null | undefined,
  lng: number | null | undefined,
): LatLng | undefined {
  const p = latLngFromDbColumns(lat, lng);
  if (!p || !isValidGlobeCoordinate(p.latitude, p.longitude)) return undefined;
  return { latitude: p.latitude, longitude: p.longitude };
}

function dedupeConsecutivePoints(pts: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.latitude === p.latitude && last.longitude === p.longitude) continue;
    out.push(p);
  }
  return out;
}

function sampleRouteGuidePoints(points: LatLng[], maxPoints: number): LatLng[] {
  const deduped = dedupeConsecutivePoints(
    points.filter((p) => isValidGlobeCoordinate(p.latitude, p.longitude)),
  );
  if (deduped.length <= maxPoints) return deduped;
  const lastIndex = deduped.length - 1;
  const sampled: LatLng[] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(deduped[Math.round((lastIndex * i) / (maxPoints - 1))]!);
  }
  return dedupeConsecutivePoints(sampled);
}

/**
 * Navegação: primeira parada restante com coordenadas válidas (cliente/encomenda/destino).
 * Ignora driver_origin caso ainda apareça em algum fluxo legado.
 */
function resolveNavigationDestination(
  stopsList: TripStop[],
  fromIndex: number,
  finalDest: LatLng | null,
): LatLng | null {
  for (let i = fromIndex; i < stopsList.length; i++) {
    const s = stopsList[i];
    if (s.stopType === 'driver_origin') continue;
    const coord = pickStopCoord(s.lat, s.lng);
    if (coord) return coord;
  }
  return finalDest;
}

/** Pontos da viagem restante para polyline (GPS cobre o “início”; sem parada sintética de partida). */
function collectRemainingStopPoints(stopsList: TripStop[], fromIndex: number): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = fromIndex; i < stopsList.length; i++) {
    const s = stopsList[i];
    if (s.stopType === 'driver_origin') continue;
    const coord = pickStopCoord(s.lat, s.lng);
    if (coord) pts.push(coord);
  }
  return pts;
}

/** Distância em metros (aprox., esfera). */
function distanceMetersApprox(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Se duas paradas têm distância parecida ao GPS, prefere a que vem **antes** no roteiro
 * (evita “saltar” etapa só por ruído de posição).
 */
const GEO_NAV_TIE_METERS = 35;

type GeoNavTarget = {
  kind: 'stop' | 'trip_dest';
  /** Índice em `stops` quando `kind === 'stop'`; -1 quando só o destino da viagem (fora das paradas). */
  stopIndex: number;
  coord: LatLng;
  label: string;
  address: string | null;
};

function stopLatLngForGeographicNav(s: TripStop): LatLng | null {
  if (s.stopType === 'driver_origin') return null;
  if (s.lat != null && s.lng != null && isValidGlobeCoordinate(s.lat, s.lng)) {
    return { latitude: s.lat, longitude: s.lng };
  }
  const c = pickStopCoord(s.lat, s.lng);
  return c && isValidGlobeCoordinate(c.latitude, c.longitude) ? c : null;
}

function collectGeographicNavTargets(
  stopsList: TripStop[],
  fromIndex: number,
  tripDest: LatLng | undefined | null,
  tripDestAddress: string | null | undefined,
): GeoNavTarget[] {
  const out: GeoNavTarget[] = [];
  for (let i = fromIndex; i < stopsList.length; i++) {
    const s = stopsList[i];
    const coord = stopLatLngForGeographicNav(s);
    if (!coord) continue;
    out.push({
      kind: 'stop',
      stopIndex: i,
      coord,
      label: s.label,
      address: s.address ?? null,
    });
  }
  if (tripDest && isValidGlobeCoordinate(tripDest.latitude, tripDest.longitude)) {
    const dup = out.some((t) => distanceMetersApprox(t.coord, tripDest) < 18);
    if (!dup) {
      const label =
        typeof tripDestAddress === 'string' && tripDestAddress.trim()
          ? tripDestAddress.trim()
          : 'Destino da viagem';
      out.push({
        kind: 'trip_dest',
        stopIndex: -1,
        coord: tripDest,
        label,
        address: tripDestAddress ?? null,
      });
    }
  }
  return out;
}

function pickGeographicNearestNavTarget(
  driver: LatLng,
  targets: GeoNavTarget[],
): GeoNavTarget | null {
  if (targets.length === 0) return null;
  const routeRank = (x: GeoNavTarget) => (x.kind === 'stop' ? x.stopIndex : 1_000_000);
  const sorted = [...targets].sort((a, b) => {
    const da = distanceMetersApprox(driver, a.coord);
    const db = distanceMetersApprox(driver, b.coord);
    if (Math.abs(da - db) > GEO_NAV_TIE_METERS) return da - db;
    return routeRank(a) - routeRank(b);
  });
  return sorted[0] ?? null;
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function ActiveTripScreen({ navigation, route }: Props) {
  const { tripId } = route.params;
  const { showAlert } = useAppAlert();

  /** Mapa em tela cheia: esconde a barra de status enquanto esta tela está em foco. */
  useFocusEffect(
    useCallback(() => {
      setStatusBarHidden(true, 'fade');
      return () => {
        setStatusBarHidden(false, 'fade');
      };
    }, []),
  );
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  /**
   * Folga inferior confiável: em Android edge-to-edge com botões virtuais, `insets.bottom`
   * às vezes vem 0 e o conteúdo absoluto fica sob a barra do sistema (card / logo Mapbox).
   */
  const effectiveBottomInset = useMemo(() => {
    const raw = insets.bottom;
    if (Platform.OS === 'android' && raw < 24) {
      return Math.max(raw, 48);
    }
    return raw;
  }, [insets.bottom]);

  // Data
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [tripLoading, setTripLoading] = useState(true);
  const { stops, loading: stopsLoading, reload: reloadTripStops } = useTripStops(tripId);
  const loading = tripLoading || stopsLoading;

  // State machine — alinhado ao `trip_stops.status` no primeiro carregamento
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const didInitialStopIndexSync = useRef(false);
  useEffect(() => {
    didInitialStopIndexSync.current = false;
  }, [tripId]);

  useEffect(() => {
    if (loading || stops.length === 0) return;
    if (didInitialStopIndexSync.current) return;
    didInitialStopIndexSync.current = true;
    setCurrentStopIndex(computeFirstIncompleteStopIndex(stops));
  }, [loading, stops, tripId]);

  // Routes
  /** Trecho imediato no mapa: GPS → alvo geograficamente mais próximo entre paradas restantes (e destino da viagem). */
  const [nearestDashedCoords, setNearestDashedCoords] = useState<LatLng[]>([]);
  const [nearestTargetCoord, setNearestTargetCoord] = useState<LatLng | null>(null);
  const [stopsRouteCoords, setStopsRouteCoords] = useState<LatLng[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [nativeDistanceRemainingMeters, setNativeDistanceRemainingMeters] = useState<number | null>(null);

  // Driver position (ref atualizado a cada fix; estado React com throttle para fluidez)
  const [driverPosition, setDriverPosition] = useState<LatLng | null>(null);
  const driverPositionRef = useRef<LatLng | null>(null);
  const driverUiLastFlushRef = useRef<{ t: number; lat: number; lng: number } | null>(null);
  /**
   * Heading do motorista para rotacionar o ícone no mapa fora do modo
   * heading-up. Throttled para não re-renderizar a cada tick do GPS.
   */
  const [driverHeadingDeg, setDriverHeadingDeg] = useState<number | null>(null);
  const driverHeadingLastFlushRef = useRef<{ t: number; deg: number | null }>({ t: 0, deg: null });
  const locationSub = useRef<any>(null);
  const mapRef = useRef<GoogleMapsMapRef>(null);
  const hasFramedDriverOnMap = useRef(false);
  const [followMyLocation, setFollowMyLocation] = useState(false);
  const [nativeNavigationRequested, setNativeNavigationRequested] = useState(false);
  const [nativeRecenterRequestKey, setNativeRecenterRequestKey] = useState(0);
  const [miniSheetVisible, setMiniSheetVisible] = useState(true);
  const [nativeVoiceMuted, setNativeVoiceMuted] = useState(false);
  const [cashPaymentByEntity, setCashPaymentByEntity] = useState<Record<string, CashPaymentInfo>>({});
  const [cashPlatformFeeCents, setCashPlatformFeeCents] = useState(0);
  const [tripEarningsByEntity, setTripEarningsByEntity] = useState<Record<string, number>>({});
  const nativeNavigationActiveRef = useRef(false);
  const locationPermissionWarned = useRef(false);
  const locationModuleWarned = useRef(false);

  /** Seguir GPS em modo navegação (heading-up); ref lida com callbacks antes do paint. */
  const followNavRef = useRef(false);
  const latestDriverFixRef = useRef<DriverFix | null>(null);
  const compassHeadingRef = useRef<number | null>(null);
  const navBearingStateRef = useRef<NavigationBearingState | null>(null);
  const navRafRef = useRef<number | null>(null);
  /** Polyline usada para snap + bearing da via (prioridade: rota dourada, senão trecho escuro). */
  const routeForSnapRef = useRef<LatLng[]>([]);
  /**
   * Polyline usada **somente** para detecção off-route. Ignora o fallback de linha reta
   * (2 pontos) do trecho tracejado para não gerar falsos negativos quando o motorista
   * está em uma rua paralela perto de uma diagonal abstrata.
   */
  const offRouteGuideRef = useRef<LatLng[]>([]);

  /**
   * Estado de dead-reckoning: produzido a cada fix GPS por applyHeadingUpCamera
   * e consumido pelo loop de ~30fps para extrapolar a posição entre fixes.
   */
  type NavDRState = {
    anchorLat: number;
    anchorLng: number;
    heading: number;
    pitch: number;
    zoomLevel: number;
    padding: NavigationEdgePadding;
    fixedAt: number;
    speedMps: number;
    lookAheadM: number;
  };
  const lastNavDRRef = useRef<NavDRState | null>(null);
  const drIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Contador que força recálculo de rota ao ser incrementado (off-route detection).
   * Adicionado como dep nos effects de gold e dashed route.
   */
  const [rerouteKey, setRerouteKey] = useState(0);
  /** `true` enquanto o motorista está fora da rota e o app busca nova polyline. */
  const [isRerouting, setIsRerouting] = useState(false);
  /**
   * Feedback imediato: o GPS mostra o motorista fora da polyline atual,
   * mesmo antes do trigger consolidar o recálculo (2 fixes + cooldown).
   * Mantém o badge visível durante toda a janela de desvio.
   */
  const [isOffRouteSoft, setIsOffRouteSoft] = useState(false);
  const isOffRouteSoftRef = useRef(false);

  /**
   * "Você está indo na direção errada": ativa quando o heading do motorista difere
   * por mais de ~90° do bearing do segmento da rota mais próximo, com velocidade
   * suficiente para descartar GPS parado/ruído. Persiste por algum tempo após
   * voltar à rota para evitar piscar.
   */
  const [isWrongDirection, setIsWrongDirection] = useState(false);
  const isWrongDirectionRef = useRef(false);
  const wrongDirectionEnterAtRef = useRef<number | null>(null);
  const wrongDirectionLeaveAtRef = useRef<number | null>(null);
  /** Nenhuma polyline chegou após timeout → possivelmente sem conexão. */
  const [rerouteNetworkError, setRerouteNetworkError] = useState(false);
  /** Fixes consecutivos fora da rota; zera ao retornar. */
  const rerouteOffCountRef = useRef(0);
  /** Timestamp do último recálculo automático (cooldown). */
  const rerouteLastAtRef = useRef(0);
  /** Timestamps recentes de reroutes para habilitar cooldown adaptativo. */
  const rerouteHistoryRef = useRef<number[]>([]);
  /** AbortController do fetch de rota em voo; substituído a cada novo trigger. */
  const rerouteAbortRef = useRef<AbortController | null>(null);
  /** Instante em que o reroute atual começou — usado p/ respeitar visibilidade mínima do badge. */
  const rerouteStartAtRef = useRef(0);
  /** Timer que aciona badge de "sem conexão" quando o reroute demora. */
  const rerouteNetworkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Último `rerouteKey` cujo fetch da rota dourada já completou com sucesso.
   * Enquanto `handled < rerouteKey`, o badge segue visível mesmo se `stopsRouteCoords` mudar
   * por outros motivos (ex.: fallback de linha reta do trecho tracejado).
   */
  const handledRerouteKeyRef = useRef(0);
  /** Anim value (0 → 1) do badge: fade + slide-down curto ao entrar, reverso ao sair. */
  const rerouteBadgeAnim = useRef(new Animated.Value(0)).current;
  /** Mantém o `Animated.View` montado até a animação de saída terminar. */
  const [rerouteBadgeMounted, setRerouteBadgeMounted] = useState(false);
  /** Segundos decorridos desde o trigger — alimenta o countdown do badge. */
  const [rerouteElapsedSec, setRerouteElapsedSec] = useState(0);

  const triggerReroute = useCallback(() => {
    const now = Date.now();
    const history = rerouteHistoryRef.current;
    while (history.length > 0 && now - history[0] > REROUTE_ADAPTIVE_WINDOW_MS) {
      history.shift();
    }
    history.push(now);
    rerouteLastAtRef.current = now;
    rerouteStartAtRef.current = now;
    rerouteAbortRef.current?.abort();
    rerouteAbortRef.current = new AbortController();
    if (rerouteNetworkTimerRef.current) clearTimeout(rerouteNetworkTimerRef.current);
    rerouteNetworkTimerRef.current = setTimeout(() => {
      setRerouteNetworkError(true);
    }, REROUTE_NETWORK_FAIL_AFTER_MS);
    setRerouteNetworkError(false);
    setIsRerouting(true);
    setRerouteKey((k) => k + 1);
  }, []);
  /** Ref estável para chamar triggerReroute dentro de closures de GPS sem precisar de deps. */
  const triggerRerouteRef = useRef<() => void>(triggerReroute);
  useEffect(() => {
    triggerRerouteRef.current = triggerReroute;
  }, [triggerReroute]);

  /** Retorna o cooldown efetivo levando em conta reroutes frequentes (adaptativo). */
  const getEffectiveRerouteCooldownMs = useCallback(() => {
    const now = Date.now();
    const history = rerouteHistoryRef.current;
    const recent = history.filter((t) => now - t <= REROUTE_ADAPTIVE_WINDOW_MS);
    return recent.length >= REROUTE_ADAPTIVE_THRESHOLD
      ? REROUTE_ADAPTIVE_COOLDOWN_MS
      : REROUTE_COOLDOWN_MS;
  }, []);
  const getEffectiveRerouteCooldownMsRef = useRef(getEffectiveRerouteCooldownMs);
  useEffect(() => {
    getEffectiveRerouteCooldownMsRef.current = getEffectiveRerouteCooldownMs;
  }, [getEffectiveRerouteCooldownMs]);

  /** Distância percorrida nesta tela (soma dos trechos GPS; não é o tamanho da polyline planejada). */
  const odometerLastFixRef = useRef<{ lat: number; lng: number } | null>(null);
  const odometerPendingMRef = useRef(0);
  const odometerFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [traveledMeters, setTraveledMeters] = useState(0);

  const flushDriverPositionToUi = useCallback((lat: number, lng: number) => {
    if (!isValidGlobeCoordinate(lat, lng)) return;
    const next: LatLng = { latitude: lat, longitude: lng };
    driverPositionRef.current = next;
    const last = driverUiLastFlushRef.current;
    const now = Date.now();
    if (!last) {
      driverUiLastFlushRef.current = { t: now, lat, lng };
      setDriverPosition(next);
      return;
    }
    const dt = now - last.t;
    const moved = haversineMeters(last.lat, last.lng, lat, lng);
    if (moved >= DRIVER_POSITION_UI_MIN_MOVE_M || dt >= DRIVER_POSITION_UI_MIN_INTERVAL_MS) {
      driverUiLastFlushRef.current = { t: now, lat, lng };
      setDriverPosition(next);
    }
  }, []);

  /**
   * Throttle separado para o heading. Mais permissivo que o de coordenada
   * porque o gargalo agora é o sensor (GPS @ 2 Hz; bússola pode ir mais alto):
   *  - 50 ms: deixa passar bússola sem amarrar
   *  - 2.5°: ainda corta tremor < 1 frame de animação
   *
   * O `useSmoothCoordinate` interpola entre estes alvos, então qualquer
   * jitter pequeno é absorvido na animação.
   */
  const flushDriverHeadingToUi = useCallback((deg: number | null) => {
    const now = Date.now();
    const last = driverHeadingLastFlushRef.current;
    if (now - last.t < 50) return;
    const prev = last.deg;
    const sameNull = prev == null && deg == null;
    if (sameNull) return;
    if (prev != null && deg != null) {
      // Comparação angular curta (cruza 359↔0 sem disparar 359° de mudança).
      const delta = Math.abs(((deg - prev + 540) % 360) - 180);
      if (delta < 2.5) return;
    }
    driverHeadingLastFlushRef.current = { t: now, deg };
    setDriverHeadingDeg(deg);
  }, []);

  const accumulateTripOdometer = useCallback((lat: number, lng: number) => {
    if (!isValidGlobeCoordinate(lat, lng)) return;
    const prev = odometerLastFixRef.current;
    odometerLastFixRef.current = { lat, lng };
    if (!prev) return;
    const d = haversineMeters(prev.lat, prev.lng, lat, lng);
    if (d < 2 || d > ODOM_MAX_SEGMENT_M) return;
    odometerPendingMRef.current += d;
    if (odometerFlushTimerRef.current != null) return;
    odometerFlushTimerRef.current = setTimeout(() => {
      odometerFlushTimerRef.current = null;
      const add = odometerPendingMRef.current;
      odometerPendingMRef.current = 0;
      if (add > 0) setTraveledMeters((m) => m + add);
    }, ODOMETER_UI_FLUSH_MS);
  }, []);

  useEffect(() => {
    odometerLastFixRef.current = null;
    odometerPendingMRef.current = 0;
    if (odometerFlushTimerRef.current != null) {
      clearTimeout(odometerFlushTimerRef.current);
      odometerFlushTimerRef.current = null;
    }
    setTraveledMeters(0);
    driverUiLastFlushRef.current = null;
    driverPositionRef.current = null;
    setDriverPosition(null);
    setNativeNavigationRequested(false);
  }, [tripId]);

  // UI state
  const [detailVisible, setDetailVisible] = useState(false);
  /** Parada mostrada no sheet de detalhe ao tocar na lateral; `null` = mesma que `currentStopIndex`. */
  const [detailViewStop, setDetailViewStop] = useState<Stop | null>(null);
  const [confirmPickupVisible, setConfirmPickupVisible] = useState(false);
  const [confirmDeliveryVisible, setConfirmDeliveryVisible] = useState(false);
  const [finalizeVisible, setFinalizeVisible] = useState(false);
  const [completedVisible, setCompletedVisible] = useState(false);

  // Confirm modal inputs
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmError, setConfirmError] = useState('');
  /** Snapshot da parada ao abrir o sheet — o modal NÃO deve usar `currentStop` (realtime pode alterar a lista/índice). */
  const [confirmUiStop, setConfirmUiStop] = useState<Stop | null>(null);

  // Finalize — comprovantes (fotos): `base64` vem do picker para upload sem depender de fetch(uri).
  const [tripExpenseFiles, setTripExpenseFiles] = useState<
    { uri: string; mimeType: string; name: string; base64?: string | null }[]
  >([]);
  const [finalizingTrip, setFinalizingTrip] = useState(false);

  // Rating
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  // Animations
  const detailSlide = useRef(new Animated.Value(600)).current;
  const finalizeSlide = useRef(new Animated.Value(600)).current;
  /** Coleta/entrega: só um sheet de código visível por vez — um único translateY. */
  const confirmSheetSlide = useRef(new Animated.Value(600)).current;
  const completedSlide = useRef(new Animated.Value(600)).current;
  /**
   * Parada fixada ao abrir o sheet de confirmação. Evita falha silenciosa quando Realtime
   * recarrega `stops` e `currentStop` (índice) deixa de bater com a parada confirmada.
   */
  const confirmTargetStopRef = useRef<Stop | null>(null);

  // ---------------------------------------------------------------------------
  // Câmera heading-up (navegação tipo Waze)
  // ---------------------------------------------------------------------------

  const applyHeadingUpCamera = useCallback(() => {
    if (!followNavRef.current) return;
    const raw = latestDriverFixRef.current;
    if (!raw || !isValidGlobeCoordinate(raw.latitude, raw.longitude)) return;
    if (!navBearingStateRef.current) {
      navBearingStateRef.current = createInitialBearingState(0);
    }
    const guide = routeForSnapRef.current;
    let fix: DriverFix = raw;
    let roadCourseDeg: number | null = null;
    if (guide.length >= 2) {
      const snap = snapToRoutePolyline(
        { latitude: raw.latitude, longitude: raw.longitude },
        guide,
        NAV_ROUTE_SNAP_MAX_M,
      );
      if (snap.distanceM <= NAV_ROUTE_SNAP_MAX_M) {
        fix = {
          ...raw,
          latitude: snap.snapped.latitude,
          longitude: snap.snapped.longitude,
        };
        // Sempre que estiver colado à rota, o bearing segue o segmento (alinha rotação com a linha).
        roadCourseDeg = snap.segmentBearingDeg;
      }
    }
    /** Sem rota desenhada: centra no veículo (0 m à frente) para o PIN não descer em direção ao card. */
    const lookAheadM = guide.length >= 2 ? NAV_LOOK_AHEAD_M : 0;
    // Padding simples: topo reserva barra de status + header; base fica levemente acima do card inferior.
    const padding: NavigationEdgePadding = {
      paddingTop: insets.top + 56,
      paddingBottom: effectiveBottomInset + 160,
      paddingLeft: 14,
      paddingRight: 14,
    };
    const out = computeNextNavigationCamera({
      fix,
      compassHeadingDeg: compassHeadingRef.current,
      state: navBearingStateRef.current,
      lookAheadMeters: lookAheadM,
      roadCourseDeg,
      bearingLerp: 0.25,
      zoomLerp: 0.20,
    });
    navBearingStateRef.current = out.state;
    // Grava o estado para o loop de dead-reckoning consumir em ~30fps.
    lastNavDRRef.current = {
      anchorLat: fix.latitude,
      anchorLng: fix.longitude,
      heading: out.heading,
      pitch: out.pitch,
      zoomLevel: out.zoomLevel - TRIP_NAV_ZOOM_OFFSET,
      padding,
      fixedAt: Date.now(),
      speedMps: raw.speedMps != null && raw.speedMps > 0 ? raw.speedMps : 0,
      lookAheadM,
    };
  }, [insets.top, effectiveBottomInset]);

  const scheduleNavFrame = useCallback(() => {
    if (!followNavRef.current) return;
    if (navRafRef.current != null) return;
    navRafRef.current = requestAnimationFrame(() => {
      navRafRef.current = null;
      applyHeadingUpCamera();
    });
  }, [applyHeadingUpCamera]);

  useLayoutEffect(() => {
    const legacyFollow = followMyLocation && !nativeNavigationActiveRef.current;
    followNavRef.current = legacyFollow;
    if (legacyFollow) {
      navBearingStateRef.current = createInitialBearingState(0);
      requestAnimationFrame(() => scheduleNavFrame());
    } else if (navRafRef.current != null) {
      cancelAnimationFrame(navRafRef.current);
      navRafRef.current = null;
    }
  }, [followMyLocation, nativeNavigationRequested, scheduleNavFrame]);

  useEffect(
    () => () => {
      if (navRafRef.current != null) {
        cancelAnimationFrame(navRafRef.current);
        navRafRef.current = null;
      }
      if (drIntervalRef.current != null) {
        clearInterval(drIntervalRef.current);
        drIntervalRef.current = null;
      }
    },
    [],
  );

  /**
   * Loop de dead-reckoning (~30fps): extrapola a posição GPS entre fixes reais para que
   * a câmera se mova de forma contínua em vez de saltar a cada 1 segundo.
   *
   * A cada tick:
   *  1. Pega o último estado gerado por applyHeadingUpCamera (bearing suavizado, zoom, pitch, padding).
   *  2. Calcula quanto o veículo andou desde aquele fix: Δd = speedMps × Δt.
   *  3. Desloca o ponto âncora nessa distância na direção do bearing atual.
   *  4. Re-aplica o look-ahead e chama setNavigationCamera com animationDuration curto (55 ms)
   *     para cobrir o próximo tick — câmera sempre em movimento.
   */
  useEffect(() => {
    if (!followMyLocation || nativeNavigationActiveRef.current) {
      if (drIntervalRef.current != null) {
        clearInterval(drIntervalRef.current);
        drIntervalRef.current = null;
      }
      return;
    }
    drIntervalRef.current = setInterval(() => {
      // Guarda sincronizada com useLayoutEffect: para imediatamente ao sair do follow.
      if (!followNavRef.current) return;
      const nav = lastNavDRRef.current;
      if (!nav || !mapRef.current) return;
      const dtS = Math.min((Date.now() - nav.fixedAt) / 1000, 2.5);
      // Extrapola o ponto GPS somente se o veículo estiver em movimento (> ~1.4 km/h)
      const extrapolated =
        nav.speedMps > 0.4
          ? offsetLatLngByMeters(nav.anchorLat, nav.anchorLng, nav.heading, nav.speedMps * dtS)
          : { latitude: nav.anchorLat, longitude: nav.anchorLng };
      // Reaplica o look-ahead na direção do bearing atual
      const center =
        nav.lookAheadM > 0
          ? offsetLatLngByMeters(
              extrapolated.latitude,
              extrapolated.longitude,
              nav.heading,
              nav.lookAheadM,
            )
          : extrapolated;
      mapRef.current.setNavigationCamera({
        centerCoordinate: [center.longitude, center.latitude],
        heading: nav.heading,
        pitch: nav.pitch,
        zoomLevel: nav.zoomLevel,
        padding: nav.padding,
        animationDuration: DR_CAMERA_ANIM_MS,
      });
    }, DR_TICK_MS);
    return () => {
      if (drIntervalRef.current != null) {
        clearInterval(drIntervalRef.current);
        drIntervalRef.current = null;
      }
    };
  }, [followMyLocation, nativeNavigationRequested]);

  // ---------------------------------------------------------------------------
  // Location tracking
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let active = true;
    async function startLocation() {
      if (!Location) {
        if (!locationModuleWarned.current) {
          locationModuleWarned.current = true;
          showAlert(
            'Localização',
            'O módulo de localização não está disponível. Faça um build nativo: expo run:android ou expo run:ios.',
          );
        }
        return;
      }
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!locationPermissionWarned.current) {
            locationPermissionWarned.current = true;
            showAlert(
              'Localização desativada',
              'Sem permissão o mapa não mostra sua posição nem a rota até a próxima parada. Ative nas configurações do aparelho.',
            );
          }
          return;
        }
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy?.High ?? Location.Accuracy.Balanced,
        });
        if (active) {
          const la = current.coords.latitude;
          const lo = current.coords.longitude;
          accumulateTripOdometer(la, lo);
          flushDriverPositionToUi(la, lo);
          latestDriverFixRef.current = {
            latitude: la,
            longitude: lo,
            speedMps:
              typeof current.coords.speed === 'number' && current.coords.speed >= 0
                ? current.coords.speed
                : null,
            headingDeg:
              typeof current.coords.heading === 'number' && current.coords.heading >= 0
                ? current.coords.heading
                : null,
            timestamp: Date.now(),
          };
        }
        locationSub.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy?.BestForNavigation ?? Location.Accuracy.High,
            // Mais frequência para ícone/heading fluidos (Waze-like). 500 ms é
            // o piso confiável no Android — abaixo disso muitos devices ignoram
            // ou clipam silenciosamente. Em 1 m de distância, o GPS responde
            // mesmo em manobras lentas.
            distanceInterval: 1,
            timeInterval: 500,
          },
          (loc: any) => {
            if (!active) return;
            const la = loc.coords.latitude;
            const lo = loc.coords.longitude;
            accumulateTripOdometer(la, lo);
            flushDriverPositionToUi(la, lo);
            const speedMps =
              typeof loc.coords.speed === 'number' && loc.coords.speed >= 0 ? loc.coords.speed : null;
            const headingDeg =
              typeof loc.coords.heading === 'number' && loc.coords.heading >= 0 ? loc.coords.heading : null;
            latestDriverFixRef.current = {
              latitude: la,
              longitude: lo,
              speedMps,
              headingDeg,
              timestamp: Date.now(),
            };
            // Acima de COMPASS_HEADING_MAX_SPEED_MPS, o curso do GPS é mais
            // estável que a bússola (que reflete a direção do celular, não a
            // do veículo). Abaixo, deixamos a bússola comandar (ver effect do
            // watchHeadingAsync) — não escrevemos `null` aqui para não
            // "apagar" o último heading válido enquanto a bússola publica.
            if (headingDeg != null && (speedMps ?? 0) >= COMPASS_HEADING_MAX_SPEED_MPS) {
              flushDriverHeadingToUi(headingDeg);
            }
            if (nativeNavigationActiveRef.current) {
              if (isOffRouteSoftRef.current) {
                isOffRouteSoftRef.current = false;
                setIsOffRouteSoft(false);
              }
              if (isWrongDirectionRef.current) {
                isWrongDirectionRef.current = false;
                wrongDirectionEnterAtRef.current = null;
                wrongDirectionLeaveAtRef.current = null;
                setIsWrongDirection(false);
              }
              return;
            }
            // Detecção off-route: visual (badge + opacidade) funciona mesmo sem velocidade válida;
            // o TRIGGER de recálculo exige speedMps >= REROUTE_MIN_SPEED_MPS para evitar loops parados.
            const activeRoute = offRouteGuideRef.current;
            if (activeRoute.length >= 2) {
              const snapResult = snapToRoutePolyline(
                { latitude: la, longitude: lo },
                activeRoute,
                REROUTE_TRIGGER_M,
              );
              const farAway = snapResult.distanceM > REROUTE_TRIGGER_M;
              const halfDistance = snapResult.distanceM > REROUTE_TRIGGER_M * REROUTE_FAST_DISTANCE_FACTOR;
              let fastBearingTrigger = false;
              let bearingDiffDeg: number | null = null;
              if (headingDeg != null) {
                bearingDiffDeg = Math.abs(((headingDeg - snapResult.segmentBearingDeg + 540) % 360) - 180);
              }
              if (
                halfDistance &&
                bearingDiffDeg != null &&
                (speedMps ?? 0) >= REROUTE_FAST_MIN_SPEED_MPS
              ) {
                fastBearingTrigger = bearingDiffDeg > REROUTE_FAST_BEARING_DELTA_DEG;
              }
              // Feedback visual imediato (independe da velocidade vir nula).
              const isOffSoft = farAway || fastBearingTrigger;

              // "Você está indo na direção errada": só vale com velocidade
              // suficiente para o heading ser confiável, e diff bem alto vs.
              // o segmento da rota. Usa janela temporal para entrar/sair
              // sem piscar (motoristas curvando, semáforos, etc.).
              const wrongCandidate =
                bearingDiffDeg != null &&
                bearingDiffDeg > WRONG_DIRECTION_DELTA_DEG &&
                (speedMps ?? 0) >= WRONG_DIRECTION_MIN_SPEED_MPS;
              const nowTs = Date.now();
              if (wrongCandidate) {
                wrongDirectionLeaveAtRef.current = null;
                if (wrongDirectionEnterAtRef.current == null) {
                  wrongDirectionEnterAtRef.current = nowTs;
                } else if (
                  !isWrongDirectionRef.current &&
                  nowTs - wrongDirectionEnterAtRef.current >= WRONG_DIRECTION_ENTER_MS
                ) {
                  isWrongDirectionRef.current = true;
                  setIsWrongDirection(true);
                }
              } else {
                wrongDirectionEnterAtRef.current = null;
                if (isWrongDirectionRef.current) {
                  if (wrongDirectionLeaveAtRef.current == null) {
                    wrongDirectionLeaveAtRef.current = nowTs;
                  } else if (
                    nowTs - wrongDirectionLeaveAtRef.current >= WRONG_DIRECTION_LEAVE_MS
                  ) {
                    isWrongDirectionRef.current = false;
                    wrongDirectionLeaveAtRef.current = null;
                    setIsWrongDirection(false);
                  }
                }
              }
              if (isOffSoft !== isOffRouteSoftRef.current) {
                isOffRouteSoftRef.current = isOffSoft;
                setIsOffRouteSoft(isOffSoft);
                if (isOffSoft) {
                  try {
                    Vibration.vibrate(REROUTE_HAPTIC_MS);
                  } catch {
                    /* alguns devices/emuladores não expõem vibração */
                  }
                }
              }
              // Trigger de recálculo: exige velocidade mínima (ou o gatilho rápido de curva errada).
              const canTrigger = (speedMps ?? 0) >= REROUTE_MIN_SPEED_MPS || fastBearingTrigger;
              if (isOffSoft && canTrigger) {
                rerouteOffCountRef.current += 1;
                const needed = fastBearingTrigger ? 1 : REROUTE_MIN_CONSECUTIVE_FIXES;
                const cooldown = getEffectiveRerouteCooldownMsRef.current();
                if (
                  rerouteOffCountRef.current >= needed &&
                  Date.now() - rerouteLastAtRef.current > cooldown
                ) {
                  rerouteOffCountRef.current = 0;
                  triggerRerouteRef.current();
                }
              } else if (!isOffSoft) {
                rerouteOffCountRef.current = 0;
              }
            } else {
              if (isOffRouteSoftRef.current) {
                // Sem rota confiável → não dá para afirmar que está fora; desliga o badge.
                isOffRouteSoftRef.current = false;
                setIsOffRouteSoft(false);
              }
              if (isWrongDirectionRef.current) {
                isWrongDirectionRef.current = false;
                wrongDirectionEnterAtRef.current = null;
                wrongDirectionLeaveAtRef.current = null;
                setIsWrongDirection(false);
              }
            }
            if (followNavRef.current) scheduleNavFrame();
          },
        );
      } catch {
        if (!locationPermissionWarned.current) {
          locationPermissionWarned.current = true;
          showAlert(
            'Localização',
            'Não foi possível obter o GPS. Verifique se a localização está ligada e tente de novo.',
          );
        }
      }
    }
    startLocation();
    return () => {
      active = false;
      locationSub.current?.remove?.();
      if (odometerFlushTimerRef.current != null) {
        clearTimeout(odometerFlushTimerRef.current);
        odometerFlushTimerRef.current = null;
        const add = odometerPendingMRef.current;
        odometerPendingMRef.current = 0;
        if (add > 0) setTraveledMeters((m) => m + add);
      }
    };
  }, [showAlert, scheduleNavFrame, accumulateTripOdometer, flushDriverPositionToUi, flushDriverHeadingToUi]);

  /** Publica posição para o app do passageiro (`scheduled_trip_live_locations`) enquanto a viagem está ativa. */
  useEffect(() => {
    if (trip?.status !== 'active') return;
    const publish = () => {
      const fix = latestDriverFixRef.current;
      if (!fix || !isValidGlobeCoordinate(fix.latitude, fix.longitude)) return;
      void (supabase as any).from('scheduled_trip_live_locations').upsert(
        {
          scheduled_trip_id: tripId,
          latitude: fix.latitude,
          longitude: fix.longitude,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'scheduled_trip_id' },
      );
    };
    publish();
    const id = setInterval(publish, 2000);
    return () => clearInterval(id);
  }, [tripId, trip?.status]);

  /**
   * Bússola SEMPRE ativa enquanto a tela está montada. Tem dois papéis:
   *  1) `compassHeadingRef` alimenta a câmera Waze-like (`computeNextNavigationCamera`).
   *  2) Em baixa velocidade (≤ COMPASS_HEADING_MAX_SPEED_MPS), também alimenta
   *     diretamente o ícone do motorista — o curso do GPS fica instável quase
   *     parado, e a bússola vira a fonte mais responsiva. Acima dessa
   *     velocidade preferimos o GPS heading, que é estável em movimento e
   *     reflete a direção do veículo (não a do celular).
   */
  useEffect(() => {
    if (!Location?.watchHeadingAsync) return;
    let cancelled = false;
    let sub: { remove: () => void } | undefined;
    (async () => {
      try {
        const s = await Location.watchHeadingAsync((h: {
          trueHeading?: number;
          magHeading?: number;
        }) => {
          const th = h.trueHeading;
          const mh = h.magHeading;
          const v =
            typeof th === 'number' && th >= 0
              ? th
              : typeof mh === 'number' && mh >= 0
                ? mh
                : null;
          if (v != null) compassHeadingRef.current = v;
          // Em baixa velocidade, a bússola é mais responsiva que o curso do GPS.
          const lastFix = latestDriverFixRef.current;
          const speed = lastFix?.speedMps ?? 0;
          if (v != null && speed < COMPASS_HEADING_MAX_SPEED_MPS) {
            flushDriverHeadingToUi(v);
          }
          if (followNavRef.current) scheduleNavFrame();
        });
        if (!cancelled) sub = s;
      } catch {
        /* Android / permissão / hardware */
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, [scheduleNavFrame, flushDriverHeadingToUi]);

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    setTripLoading(true);
    try {
      const { data: tripData } = await supabase
        .from('scheduled_trips')
        .select(
          [
            'id, origin_address, destination_address, departure_at, driver_journey_started_at, origin_lat, origin_lng,',
            'destination_lat, destination_lng, amount_cents, status,',
            'route_id, day_of_week, departure_time, arrival_time, capacity, price_per_person_cents,',
            'bookings(amount_cents, worker_earning_cents, status)',
          ].join(' '),
        )
        .eq('id', tripId)
        .single();
      if (tripData) setTrip(tripData as TripRow);
    } finally {
      setTripLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const bookingIds = new Set<string>();
    const shipmentIds = new Set<string>();
    const dependentIds = new Set<string>();

    for (const stop of stops) {
      if (!stop.entityId) continue;
      if (isPassenger(stop)) bookingIds.add(stop.entityId);
      else if (isPackage(stop)) shipmentIds.add(stop.entityId);
      else if (isDependent(stop)) {
        const dependentShipmentId = dependentShipmentIdFromSyntheticStopId(stop.id) ?? stop.entityId;
        dependentIds.add(dependentShipmentId);
      }
    }

    if (bookingIds.size === 0 && shipmentIds.size === 0 && dependentIds.size === 0) {
      setCashPaymentByEntity({});
      setCashPlatformFeeCents(0);
      setTripEarningsByEntity({});
      return;
    }

    void (async () => {
      const next: Record<string, CashPaymentInfo> = {};
      const earnings: Record<string, number> = {};
      let nextCashPlatformFeeCents = 0;

      const [bookingsRes, shipmentsRes, dependentsRes] = await Promise.all([
        bookingIds.size > 0
          ? supabase
              .from('bookings')
              .select(
                'id, amount_cents, worker_earning_cents, admin_earning_cents, payment_method, payment_method_id, stripe_payment_intent_id, status',
              )
              .in('id', [...bookingIds])
          : Promise.resolve({ data: [] as unknown[] }),
        shipmentIds.size > 0
          ? supabase
              .from('shipments')
              .select('id, amount_cents, worker_earning_cents, payment_method, status')
              .in('id', [...shipmentIds])
          : Promise.resolve({ data: [] as unknown[] }),
        dependentIds.size > 0
          ? supabase
              .from('dependent_shipments')
              .select('id, amount_cents, worker_earning_cents, payment_method, status')
              .in('id', [...dependentIds])
          : Promise.resolve({ data: [] as unknown[] }),
      ]);

      for (const row of (bookingsRes.data ?? []) as unknown as {
        id: string;
        amount_cents?: number | null;
        worker_earning_cents?: number | null;
        admin_earning_cents?: number | null;
        payment_method?: string | null;
        payment_method_id?: string | null;
        stripe_payment_intent_id?: string | null;
        status?: string | null;
      }[]) {
        const amount = Math.max(0, Math.floor(Number(row.amount_cents ?? 0)));
        const method = String(row.payment_method ?? '').trim().toLowerCase();
        const isCash =
          method === 'cash' ||
          (!method && !row.payment_method_id && !row.stripe_payment_intent_id);
        if (countsAsTripTotal(row.status)) {
          const earning = entityEarningCents({
            amountCents: amount,
            workerEarningCents: row.worker_earning_cents ?? null,
            status: row.status,
          });
          if (earning > 0) earnings[row.id] = earning;
        }
        if (isCash && amount > 0 && row.status !== 'cancelled') {
          next[row.id] = { label: 'Viagem', amountCents: amount };
          if (countsAsTripTotal(row.status)) {
            nextCashPlatformFeeCents += Math.max(0, Math.floor(Number(row.admin_earning_cents ?? 0)));
          }
        }
      }

      for (const row of (shipmentsRes.data ?? []) as unknown as {
        id: string;
        amount_cents?: number | null;
        worker_earning_cents?: number | null;
        payment_method?: string | null;
        status?: string | null;
      }[]) {
        const amount = Math.max(0, Math.floor(Number(row.amount_cents ?? 0)));
        const method = String(row.payment_method ?? '').trim().toLowerCase();
        if (countsAsTripTotal(row.status)) {
          const earning = entityEarningCents({
            amountCents: amount,
            workerEarningCents: row.worker_earning_cents ?? null,
            status: row.status,
          });
          if (earning > 0) earnings[row.id] = earning;
        }
        if ((method === 'dinheiro' || method === 'cash') && amount > 0 && row.status !== 'cancelled') {
          next[row.id] = { label: 'Encomenda', amountCents: amount };
        }
      }

      for (const row of (dependentsRes.data ?? []) as unknown as {
        id: string;
        amount_cents?: number | null;
        worker_earning_cents?: number | null;
        payment_method?: string | null;
        status?: string | null;
      }[]) {
        const amount = Math.max(0, Math.floor(Number(row.amount_cents ?? 0)));
        const method = String(row.payment_method ?? '').trim().toLowerCase();
        if (countsAsTripTotal(row.status)) {
          const earning = entityEarningCents({
            amountCents: amount,
            workerEarningCents: row.worker_earning_cents ?? null,
            status: row.status,
          });
          if (earning > 0) earnings[row.id] = earning;
        }
        if ((method === 'dinheiro' || method === 'cash') && amount > 0 && row.status !== 'cancelled') {
          next[row.id] = { label: 'Envio de dependente', amountCents: amount };
        }
      }

      if (!cancelled) {
        setCashPaymentByEntity(next);
        setCashPlatformFeeCents(nextCashPlatformFeeCents);
        setTripEarningsByEntity(earnings);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stops]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const currentStop = stops[currentStopIndex] ?? null;
  const detailSheetStop = detailViewStop ?? currentStop;
  const confirmSheetStop =
    confirmPickupVisible || confirmDeliveryVisible ? (confirmUiStop ?? currentStop) : null;
  const totalStops = stops.length;
  const allDone = currentStopIndex >= totalStops && totalStops > 0;
  const confirmSheetCashPayment = useMemo(() => {
    if (!confirmSheetStop) return null;
    const entityId = isDependent(confirmSheetStop)
      ? (dependentShipmentIdFromSyntheticStopId(confirmSheetStop.id) ?? confirmSheetStop.entityId)
      : confirmSheetStop.entityId;
    return cashPaymentByEntity[entityId] ?? null;
  }, [cashPaymentByEntity, confirmSheetStop]);
  const totalCashToReceiveCents = useMemo(() => {
    const seen = new Set<string>();
    let total = 0;
    for (const stop of stops) {
      const entityId = isDependent(stop)
        ? (dependentShipmentIdFromSyntheticStopId(stop.id) ?? stop.entityId)
        : stop.entityId;
      if (!entityId || seen.has(entityId)) continue;
      const cash = cashPaymentByEntity[entityId];
      if (!cash) continue;
      seen.add(entityId);
      total += cash.amountCents;
    }
    return total;
  }, [cashPaymentByEntity, stops]);

  const completedTripEarningsLabel = useMemo(() => {
    if (!trip) return '—';
    const seen = new Set<string>();
    let cents = 0;
    for (const stop of stops) {
      const entityId = isDependent(stop)
        ? (dependentShipmentIdFromSyntheticStopId(stop.id) ?? stop.entityId)
        : stop.entityId;
      if (!entityId || seen.has(entityId)) continue;
      const earning = tripEarningsByEntity[entityId] ?? 0;
      if (earning <= 0) continue;
      seen.add(entityId);
      cents += earning;
    }
    if (cents <= 0) cents = tripDisplayEarningsCents(trip.bookings, trip.amount_cents);
    return cents > 0 ? `R$ ${(cents / 100).toFixed(2).replace('.', ',')}` : '—';
  }, [trip, tripEarningsByEntity, stops]);

  /**
   * Tempo desde o início real (`driver_journey_started_at`). Sem isso, usa `departure_at` só se já
   * passou — evita “0min” quando a partida agendada está no futuro e a jornada ainda não foi gravada.
   */
  const tripElapsedLabel = useMemo(() => {
    if (!trip) return '—';
    const now = new Date();
    const journey = trip.driver_journey_started_at;
    if (journey) return formatDuration(journey, now);
    const dep = trip.departure_at;
    if (!dep) return '—';
    if (new Date(dep).getTime() > now.getTime()) return '—';
    return formatDuration(dep, now);
  }, [trip]);

  /** Odômetro aproximado (GPS nesta sessão); trechos curtos mostram metros em vez de “—”. */
  const tripTraveledDistanceLabel = useMemo(() => {
    if (traveledMeters < 5) return '—';
    if (traveledMeters < 1000) return `~${Math.round(traveledMeters)} m`;
    const km = traveledMeters / 1000;
    return `~${km.toFixed(1).replace('.', ',')} km`;
  }, [traveledMeters]);

  const nativeDistanceRemainingLabel = useMemo(() => {
    if (nativeDistanceRemainingMeters == null || nativeDistanceRemainingMeters < 0) return null;
    if (nativeDistanceRemainingMeters < 1000) return `${Math.round(nativeDistanceRemainingMeters)} m`;
    const km = nativeDistanceRemainingMeters / 1000;
    return `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
  }, [nativeDistanceRemainingMeters]);

  /** Último ponto válido do roteiro (entrega final / última parada) ou destino da viagem. */
  const finalDestination = useMemo((): LatLng | null => {
    for (let i = stops.length - 1; i >= 0; i--) {
      const s = stops[i];
      if (
        s.lat != null &&
        s.lng != null &&
        isValidGlobeCoordinate(s.lat, s.lng)
      ) {
        return { latitude: s.lat, longitude: s.lng };
      }
    }
    if (!trip) return null;
    return pickStopCoord(trip.destination_lat, trip.destination_lng) ?? null;
  }, [stops, trip]);

  const fallbackNavDest = useMemo(() => {
    if (
      nearestTargetCoord &&
      isValidGlobeCoordinate(nearestTargetCoord.latitude, nearestTargetCoord.longitude)
    ) {
      return nearestTargetCoord;
    }
    return resolveNavigationDestination(stops, currentStopIndex, finalDestination);
  }, [nearestTargetCoord, stops, currentStopIndex, finalDestination]);

  /** ~100m de resolução: atualiza rota dourada “você → destino” sem spammar Directions a cada tick de GPS. */
  const driverPositionKey = useMemo(() => {
    if (
      !driverPosition ||
      !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)
    ) {
      return '';
    }
    return `${driverPosition.latitude.toFixed(3)},${driverPosition.longitude.toFixed(3)}`;
  }, [driverPosition]);

  /**
   * Estável durante toda a vida da viagem: só muda quando o GPS sai/entra
   * (no-gps ↔ has-gps). Usada para disparar a busca da linha imediata
   * **uma vez** ao receber o primeiro fix, sem refazer a cada movimento.
   */
  const hasGpsKey = useMemo(
    () =>
      driverPosition && isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)
        ? 'has-gps'
        : 'no-gps',
    [driverPosition],
  );

  const tripDestLL = useMemo(
    () => (trip ? pickStopCoord(trip.destination_lat, trip.destination_lng) : undefined),
    [trip?.destination_lat, trip?.destination_lng, trip?.id],
  );

  /** Alvo “mais próximo” no mapa/card (mesma base que `nearestDashedCoords` / trecho tracejado). */
  const nearestGeographicNavPick = useMemo((): GeoNavTarget | null => {
    if (
      !driverPosition ||
      !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude) ||
      stops.length === 0
    ) {
      return null;
    }
    const targets = collectGeographicNavTargets(
      stops,
      currentStopIndex,
      tripDestLL ?? null,
      trip?.destination_address,
    );
    return pickGeographicNearestNavTarget(driverPosition, targets);
  }, [driverPosition, stops, currentStopIndex, tripDestLL, trip?.destination_address, trip?.id]);

  const nearestNavStopIndex = useMemo((): number | null => {
    const pick = nearestGeographicNavPick;
    if (pick?.kind === 'stop') return pick.stopIndex;
    return null;
  }, [nearestGeographicNavPick]);

  /**
   * Identidade do alvo atual da linha imediata. Só muda ao trocar de parada/destino
   * (latitude/longitude com 4 casas ≈ 11 m). Enquanto o motorista percorre a mesma
   * via até o mesmo alvo, esta chave fica constante e a linha imediata não recarrega.
   */
  const nearestDashedTargetKey = useMemo(() => {
    const c = nearestGeographicNavPick?.coord;
    if (!c || !isValidGlobeCoordinate(c.latitude, c.longitude)) return '';
    return `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
  }, [nearestGeographicNavPick?.coord]);

  /** Índice destacado no mapa e na barra lateral: com GPS = parada geograficamente mais próxima; senão = sequencial. */
  const mapHighlightStopIndex = nearestNavStopIndex ?? currentStopIndex;

  const nativeNavigationTarget = useMemo((): { coord: LatLng; name?: string } | null => {
    const nearest = nearestGeographicNavPick;
    if (nearest?.coord && isValidGlobeCoordinate(nearest.coord.latitude, nearest.coord.longitude)) {
      return { coord: nearest.coord, name: nearest.label };
    }
    const fallback = resolveNavigationDestination(stops, currentStopIndex, finalDestination);
    if (!fallback || !isValidGlobeCoordinate(fallback.latitude, fallback.longitude)) return null;
    const stop = stops[currentStopIndex];
    return { coord: fallback, name: stop?.label ?? trip?.destination_address ?? 'Destino' };
  }, [nearestGeographicNavPick, stops, currentStopIndex, finalDestination, trip?.destination_address]);

  /**
   * Feature flag: quando `EXPO_PUBLIC_USE_NATIVE_NAVIGATION=1` e o módulo nativo
   * (`@take-me/expo-mapbox-navigation`) está disponível, a tela usa o
   * `<ExpoMapboxNavigationView>` (Mapbox Navigation SDK v3) por baixo do
   * `<NavigationView>`. Caso contrário, o caminho legado (`<GoogleMapsMap>`) é
   * preservado intacto via `legacyRender` — zero regressão quando OFF.
   */
  const useNativeNav = useNativeNavigationEnabled();

  /**
   * Waypoints do SDK: apenas o trecho atual que o mapa sem SDK exibe como
   * rota tracejada (motorista -> próxima parada/coleta/embarque). Ao concluir
   * a parada, `currentStopIndex` avança e um novo trecho é calculado.
   */
  const navigationWaypoints = useMemo(() => {
    if (!useNativeNav) return [];
    if (!driverPosition || !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)) {
      return [];
    }
    if (!nativeNavigationTarget) return [];
    const points: { coord: LatLng; name?: string }[] = [
      { coord: driverPosition, name: 'Você' },
      nativeNavigationTarget,
    ];
    return points
      .filter((p) => p.coord && isValidGlobeCoordinate(p.coord.latitude, p.coord.longitude))
      .map((p, i, arr) =>
        latLngToWaypoint(p.coord, p.name, false),
      );
  }, [useNativeNav, driverPosition, nativeNavigationTarget]);

  const nativeNavigationActive =
    useNativeNav && nativeNavigationRequested && navigationWaypoints.length >= 2;

  useEffect(() => {
    nativeNavigationActiveRef.current = nativeNavigationActive;
    if (nativeNavigationActive) {
      followNavRef.current = false;
      if (navRafRef.current != null) {
        cancelAnimationFrame(navRafRef.current);
        navRafRef.current = null;
      }
      if (drIntervalRef.current != null) {
        clearInterval(drIntervalRef.current);
        drIntervalRef.current = null;
      }
    } else {
      setNativeDistanceRemainingMeters(null);
    }
  }, [nativeNavigationActive]);

  const handleNativeRouteProgress = useCallback((progress: RouteProgressEvent) => {
    if (Number.isFinite(progress.durationRemainingSeconds)) {
      setEtaSeconds(Math.max(0, progress.durationRemainingSeconds));
    }
    if (Number.isFinite(progress.distanceRemainingMeters)) {
      setNativeDistanceRemainingMeters(Math.max(0, progress.distanceRemainingMeters));
    }
    if (Number.isFinite(progress.distanceTraveledMeters)) {
      setTraveledMeters(Math.max(0, progress.distanceTraveledMeters));
    }
    setRerouteNetworkError(false);
  }, []);

  const handleNativeOffRoute = useCallback(() => {
    isOffRouteSoftRef.current = true;
    setIsOffRouteSoft(true);
  }, []);

  const handleNativeReroute = useCallback(() => {
    rerouteStartAtRef.current = Date.now();
    setRerouteNetworkError(false);
    setIsOffRouteSoft(false);
    setIsRerouting(true);
    setTimeout(() => setIsRerouting(false), REROUTE_BADGE_MIN_VISIBLE_MS);
  }, []);

  const fallbackToLegacyNavigation = useCallback((message?: string) => {
    setNativeNavigationRequested(false);
    if (driverPosition && isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)) {
      setFollowMyLocation(true);
    }
    if (message) showAlert('Navegação', message);
  }, [driverPosition, showAlert]);

  /**
   * Card inferior: com GPS, a parada geograficamente mais próxima (rota imediata);
   * sem GPS, próxima parada sequencial; sem paradas no roteiro, destino da viagem.
   */
  const cardInfo = useMemo((): Stop | null => {
    const pick = nearestGeographicNavPick;
    if (pick?.kind === 'stop') {
      return stops[pick.stopIndex] ?? currentStop ?? null;
    }
    if (pick?.kind === 'trip_dest' && trip) {
      return buildSidebarTripDestinationStop(trip, pick.coord);
    }
    if (currentStop) return currentStop;
    if (!trip) return null;
    return {
      id: 'trip-dest',
      scheduledTripId: trip.id,
      stopType: 'passenger_dropoff',
      entityId: trip.id,
      label: trip.destination_address,
      address: trip.destination_address,
      lat: trip.destination_lat ?? null,
      lng: trip.destination_lng ?? null,
      sequenceOrder: 0,
      status: 'pending',
      notes: null,
      code: null,
    };
  }, [nearestGeographicNavPick, stops, currentStop, trip]);
  const nativeMiniSheetCode = cardInfo ? stopModalCode(cardInfo) : null;

  /** Evita dois botões com bandeira: parada trip_destination ou mesmo lugar do destino da viagem. */
  const showSidebarTripEndFlag = useMemo(() => {
    if (!tripDestLL) return false;
    if (stops.some((s) => s.stopType === 'trip_destination')) return false;
    const tlat = tripDestLL.latitude;
    const tlng = tripDestLL.longitude;
    const nearDeg = 0.002;
    return !stops.some(
      (s) =>
        s.lat != null &&
        s.lng != null &&
        Math.abs(s.lat - tlat) < nearDeg &&
        Math.abs(s.lng - tlng) < nearDeg,
    );
  }, [stops, tripDestLL]);

  /**
   * Rota dourada: posição atual (GPS) → paradas da rota (cliente/encomenda/destino).
   * Paradas `driver_origin` não são carregadas no app.
   */
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const controller = new AbortController();
    const signal = controller.signal;
    const routeOpts = {
      mapboxToken: getMapboxAccessToken(),
      googleMapsApiKey: getGoogleMapsApiKey(),
      signal,
    };
    const snapshotRerouteKey = rerouteKey;

    const stopPts = dedupeConsecutivePoints(collectRemainingStopPoints(stops, currentStopIndex));

    // Usa a posição mais fresca disponível (ref > state), importante ao recalcular off-route.
    const dpLive = driverPositionRef.current;
    const dp =
      dpLive && isValidGlobeCoordinate(dpLive.latitude, dpLive.longitude)
        ? dpLive
        : driverPosition;

    const commit = (coords: LatLng[]) => {
      setStopsRouteCoords(coords);
      handledRerouteKeyRef.current = Math.max(handledRerouteKeyRef.current, snapshotRerouteKey);
    };

    (async () => {
      if (stopPts.length >= 2) {
        const withDriver =
          dp && isValidGlobeCoordinate(dp.latitude, dp.longitude)
            ? dedupeConsecutivePoints([dp, ...stopPts])
            : stopPts;
        const r = await getMultiPointRoute(withDriver, routeOpts);
        if (!cancelled && r?.coordinates?.length) {
          commit(r.coordinates);
          return;
        }
      }
      if (dp && isValidGlobeCoordinate(dp.latitude, dp.longitude) && stopPts.length === 1) {
        const r = await getRouteWithDuration(dp, stopPts[0]!, routeOpts);
        if (!cancelled && r?.coordinates?.length) {
          commit(r.coordinates);
          return;
        }
      }
      const navDest = resolveNavigationDestination(stops, currentStopIndex, finalDestination);
      if (dp && isValidGlobeCoordinate(dp.latitude, dp.longitude) && navDest) {
        const r = await getRouteWithDuration(dp, navDest, routeOpts);
        if (!cancelled && r?.coordinates?.length) {
          commit(r.coordinates);
          return;
        }
      }
      if (!cancelled) setStopsRouteCoords([]);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loading, stops, finalDestination, driverPositionKey, currentStopIndex, rerouteKey]);

  // Trecho imediato: GPS → alvo geograficamente mais próximo (paradas restantes + destino da viagem).
  useEffect(() => {
    if (nativeNavigationActive) return;
    if (loading) return;
    const dpLive = driverPositionRef.current;
    const dp =
      dpLive && isValidGlobeCoordinate(dpLive.latitude, dpLive.longitude)
        ? dpLive
        : driverPosition;
    if (!dp || !isValidGlobeCoordinate(dp.latitude, dp.longitude)) {
      setNearestDashedCoords([]);
      setNearestTargetCoord(null);
      setEtaSeconds(null);
      return;
    }

    const targets = collectGeographicNavTargets(
      stops,
      currentStopIndex,
      tripDestLL ?? null,
      trip?.destination_address,
    );
    const nearest = pickGeographicNearestNavTarget(dp, targets);
    if (!nearest || !isValidGlobeCoordinate(nearest.coord.latitude, nearest.coord.longitude)) {
      setNearestDashedCoords([]);
      setNearestTargetCoord(null);
      setEtaSeconds(null);
      return;
    }

    setNearestTargetCoord(nearest.coord);

    const straightFrom = (from: LatLng): LatLng[] => [
      { latitude: from.latitude, longitude: from.longitude },
      nearest.coord,
    ];
    const straightFallback = straightFrom(dp);
    setNearestDashedCoords(straightFallback);
    setEtaSeconds(null);

    let cancelled = false;
    const controller = new AbortController();
    const routeOpts = {
      mapboxToken: getMapboxAccessToken(),
      googleMapsApiKey: getGoogleMapsApiKey(),
      signal: controller.signal,
    };

    const timer = setTimeout(() => {
      const dp = driverPositionRef.current;
      if (
        cancelled ||
        !dp ||
        !isValidGlobeCoordinate(dp.latitude, dp.longitude)
      ) {
        return;
      }
      getRouteWithDuration(dp, nearest.coord, routeOpts)
        .then((result) => {
          if (cancelled) return;
          const coords = result?.coordinates;
          if (coords && coords.length >= 2) {
            setNearestDashedCoords(coords);
            setEtaSeconds(result.durationSeconds ?? null);
          } else {
            setNearestDashedCoords(straightFrom(dp));
            setEtaSeconds(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            const d2 = driverPositionRef.current;
            if (d2 && isValidGlobeCoordinate(d2.latitude, d2.longitude)) {
              setNearestDashedCoords(straightFrom(d2));
            } else {
              setNearestDashedCoords(straightFallback);
            }
            setEtaSeconds(null);
          }
        });
    }, NEAREST_DASHED_ROUTE_FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // Importante: NÃO depender de `driverPositionKey` aqui — antes, a cada ~100 m o
    // efeito recalculava, mostrando o fallback de linha reta antes de a Directions
    // chegar (ficava "piscando" em direção ao destino). Agora só dispara em mudança
    // real de alvo (`nearestDashedTargetKey`/`currentStopIndex`), reroute (`rerouteKey`)
    // ou primeira aquisição de GPS (`hasGpsKey`).
  }, [loading, nativeNavigationActive, hasGpsKey, nearestDashedTargetKey, currentStopIndex, stops, trip?.id, trip?.destination_address, tripDestLL, rerouteKey]);

  useEffect(() => {
    if (stopsRouteCoords.length >= 2) routeForSnapRef.current = stopsRouteCoords;
    else if (nearestDashedCoords.length >= 2) routeForSnapRef.current = nearestDashedCoords;
    else routeForSnapRef.current = [];

    // Detecção de off-route: só aceita polylines "reais" (> 2 pontos), nunca o fallback de linha reta.
    if (stopsRouteCoords.length >= 2) {
      offRouteGuideRef.current = stopsRouteCoords;
    } else if (nearestDashedCoords.length > 2) {
      offRouteGuideRef.current = nearestDashedCoords;
    } else {
      offRouteGuideRef.current = [];
    }

    // Reavalia o soft-off-route imediatamente contra a nova polyline para desligar o badge
    // assim que a rota passar pelo motorista (não precisa esperar o próximo fix).
    const guide = offRouteGuideRef.current;
    const dp = driverPositionRef.current;
    if (guide.length >= 2 && dp) {
      const snapRes = snapToRoutePolyline(
        { latitude: dp.latitude, longitude: dp.longitude },
        guide,
        REROUTE_TRIGGER_M,
      );
      const onRoute = snapRes.distanceM <= REROUTE_TRIGGER_M;
      if (onRoute && isOffRouteSoftRef.current) {
        isOffRouteSoftRef.current = false;
        setIsOffRouteSoft(false);
      }
    }
  }, [stopsRouteCoords, nearestDashedCoords]);

  /**
   * Ao chegar a rota dourada correspondente ao último trigger de reroute, desliga o estado
   * visual de "recalculando" respeitando o tempo mínimo de exibição do badge para evitar flicker.
   * Só olha `stopsRouteCoords` (dourada) + `handledRerouteKeyRef` para evitar que o fallback
   * tracejado (linha reta) apague o badge prematuramente.
   */
  useEffect(() => {
    if (!isRerouting) return;
    if (handledRerouteKeyRef.current < rerouteKey) return;
    if (stopsRouteCoords.length < 2) return;
    const elapsed = Date.now() - rerouteStartAtRef.current;
    const remaining = Math.max(0, REROUTE_BADGE_MIN_VISIBLE_MS - elapsed);
    const t = setTimeout(() => {
      setIsRerouting(false);
      setRerouteNetworkError(false);
      if (rerouteNetworkTimerRef.current) {
        clearTimeout(rerouteNetworkTimerRef.current);
        rerouteNetworkTimerRef.current = null;
      }
    }, remaining);
    return () => clearTimeout(t);
  }, [isRerouting, rerouteKey, stopsRouteCoords]);

  /** Limpeza final dos timers/abort de reroute ao desmontar a tela. */
  useEffect(
    () => () => {
      rerouteAbortRef.current?.abort();
      rerouteAbortRef.current = null;
      if (rerouteNetworkTimerRef.current) {
        clearTimeout(rerouteNetworkTimerRef.current);
        rerouteNetworkTimerRef.current = null;
      }
    },
    [],
  );

  /**
   * Estado derivado: mostrar o badge quando qualquer fase do reroute está ativa.
   * Suprimimos o overlay no modo SDK nativo: o próprio Mapbox SDK cuida do reroute
   * e o badge gerava flicker constante por causa de jitter de GPS.
   */
  const shouldShowRerouteBadge =
    !nativeNavigationActive &&
    (isRerouting || isOffRouteSoft || rerouteNetworkError || isWrongDirection);

  /**
   * Anima entrada/saída do badge (fade + slide-down). Mantém o node montado até a animação
   * de saída concluir, evitando "desaparecimento instantâneo" que quebra a sensação de fluidez.
   */
  useEffect(() => {
    if (shouldShowRerouteBadge) {
      setRerouteBadgeMounted(true);
      Animated.timing(rerouteBadgeAnim, {
        toValue: 1,
        duration: REROUTE_BADGE_ANIM_MS,
        useNativeDriver: true,
      }).start();
    } else if (rerouteBadgeMounted) {
      Animated.timing(rerouteBadgeAnim, {
        toValue: 0,
        duration: REROUTE_BADGE_ANIM_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRerouteBadgeMounted(false);
      });
    }
  }, [shouldShowRerouteBadge, rerouteBadgeMounted, rerouteBadgeAnim]);

  /**
   * Tick de 1s para alimentar o countdown "~Ns" do badge enquanto o fetch de rota estiver em voo.
   * Dá ao motorista a sensação de "algo acontecendo" em vez de UI parada.
   */
  useEffect(() => {
    if (!isRerouting) {
      if (rerouteElapsedSec !== 0) setRerouteElapsedSec(0);
      return;
    }
    const tick = () => {
      const el = Math.max(0, Math.round((Date.now() - rerouteStartAtRef.current) / 1000));
      setRerouteElapsedSec(el);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // rerouteElapsedSec não entra na dep: senão reentra no effect a cada tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRerouting]);

  // Região inicial: paradas relevantes + destino (sem priorizar origem cadastrada da viagem).
  const mapInitialRegion = useMemo((): MapRegion => {
    const pts = collectRemainingStopPoints(stops, 0);
    if (tripDestLL) pts.push(tripDestLL);
    if (pts.length > 0) return regionFromLatLngPoints(pts);
    if (tripDestLL) {
      return {
        latitude: tripDestLL.latitude,
        longitude: tripDestLL.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }
    return {
      latitude: -2.53,
      longitude: -44.3,
      latitudeDelta: 0.5,
      longitudeDelta: 0.5,
    };
  }, [trip?.id, tripDestLL, stops]);

  const overlayTop = insets.top + 56;
  const nativeSdkToggleBottom = miniSheetVisible
    ? effectiveBottomInset + 12 + SDK_NATIVE_FLOATING_CARD_PADDING + 14
    : effectiveBottomInset + 16;
  const nativeSdkRecenterBottom = nativeSdkToggleBottom + 46 + SDK_NATIVE_CONTROL_GAP;
  const nativeSdkVoiceBottom = nativeSdkRecenterBottom + 46 + SDK_NATIVE_CONTROL_GAP;

  /** Centraliza o mapa na parada correspondente ao ícone da lateral (mesmo fallback de coord. dos markers). */
  const focusMapOnSidebarStop = useCallback(
    (stop: TripStop, idx: number) => {
      if (!mapRef.current) return;
      setFollowMyLocation(false);
      const p = pickStopCoord(stop.lat, stop.lng);
      const lat = p?.latitude ?? mapInitialRegion.latitude + idx * 0.002;
      const lng = p?.longitude ?? mapInitialRegion.longitude + idx * 0.002;
      if (!isValidGlobeCoordinate(lat, lng)) return;
      const d = MY_LOCATION_NAV_DELTA * 6;
      mapRef.current.animateToRegion(
        {
          latitude: lat,
          longitude: lng,
          latitudeDelta: d,
          longitudeDelta: d,
        },
        450,
      );
    },
    [mapInitialRegion.latitude, mapInitialRegion.longitude],
  );

  const focusMapOnSidebarTripDestination = useCallback(() => {
    if (!mapRef.current || !tripDestLL) return;
    setFollowMyLocation(false);
    const { latitude: lat, longitude: lng } = tripDestLL;
    if (!isValidGlobeCoordinate(lat, lng)) return;
    const d = MY_LOCATION_NAV_DELTA * 6;
    mapRef.current.animateToRegion(
      {
        latitude: lat,
        longitude: lng,
        latitudeDelta: d,
        longitudeDelta: d,
      },
      450,
    );
  }, [tripDestLL]);

  /**
   * Modo seguir: apara a polyline a partir do ponto colado na via (linha começa no “carro”).
   * Fora do modo seguir: mantém as polylines completas.
   */
  const navRoutePresentation = useMemo(() => {
    const goldBase = stopsRouteCoords;
    const darkBase = nearestDashedCoords;
    const guide =
      goldBase.length >= 2 ? goldBase : darkBase.length >= 2 ? darkBase : [];

    if (
      !followMyLocation ||
      !driverPosition ||
      !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)
    ) {
      return {
        goldLine: goldBase,
        showGold: goldBase.length >= 2,
        snappedForFallback: null as LatLng | null,
      };
    }
    if (guide.length < 2) {
      return {
        goldLine: goldBase,
        showGold: goldBase.length >= 2,
        snappedForFallback: null,
      };
    }
    const snap = snapToRoutePolyline(driverPosition, guide, NAV_ROUTE_SNAP_MAX_M);
    if (snap.distanceM > NAV_ROUTE_SNAP_MAX_M) {
      return {
        goldLine: goldBase,
        showGold: goldBase.length >= 2,
        snappedForFallback: null,
      };
    }
    let trimmed = trimPolylineFromSnap(guide, snap.segmentIndex, snap.snapped);
    if (trimmed.length < 2 && guide.length >= 2) {
      trimmed = [snap.snapped, guide[guide.length - 1]];
    }
    if (goldBase.length >= 2) {
      return {
        goldLine: trimmed.length >= 2 ? trimmed : goldBase,
        showGold: trimmed.length >= 2,
        snappedForFallback: snap.snapped,
      };
    }
    return {
      goldLine: goldBase,
      showGold: false,
      snappedForFallback: snap.snapped,
    };
  }, [followMyLocation, driverPosition, stopsRouteCoords, nearestDashedCoords]);

  /** Trecho imediato (tracejado): GPS → alvo geograficamente mais próximo; trim no modo seguir. */
  const nearestDashedDisplayLine = useMemo((): LatLng[] => {
    const base = nearestDashedCoords;
    if (base.length < 2) return [];
    if (
      !followMyLocation ||
      !driverPosition ||
      !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)
    ) {
      return base;
    }
    return trimRoutePolylineFromDriverSnap(
      { latitude: driverPosition.latitude, longitude: driverPosition.longitude },
      base,
    );
  }, [nearestDashedCoords, followMyLocation, driverPosition]);

  /**
   * Trecho imediato (**tracejado** no mapa): polyline Directions GPS → alvo mais próximo quando existir;
   * senão reta GPS → mesmo alvo geográfico ou `resolveNavigationDestination`.
   */
  const immediateLegLineForMap = useMemo((): LatLng[] => {
    if (nearestDashedDisplayLine.length >= 2) return nearestDashedDisplayLine;
    if (
      !driverPosition ||
      !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)
    ) {
      return [];
    }
    const targets = collectGeographicNavTargets(
      stops,
      currentStopIndex,
      tripDestLL ?? null,
      trip?.destination_address,
    );
    const geo = pickGeographicNearestNavTarget(driverPosition, targets);
    const nav =
      geo?.coord ??
      resolveNavigationDestination(stops, currentStopIndex, finalDestination);
    if (!nav || !isValidGlobeCoordinate(nav.latitude, nav.longitude)) return [];
    return [
      { latitude: driverPosition.latitude, longitude: driverPosition.longitude },
      nav,
    ];
  }, [
    nearestDashedDisplayLine,
    driverPosition,
    stops,
    currentStopIndex,
    finalDestination,
    tripDestLL,
    trip?.destination_address,
  ]);

  /** Rota sólida no mapa: itinerário completo ou fallback reta. */
  const goldLineForMap = useMemo((): LatLng[] | null => {
    if (navRoutePresentation.goldLine.length >= 2) {
      return navRoutePresentation.goldLine;
    }
    if (
      stopsRouteCoords.length < 2 &&
      driverPosition &&
      isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude) &&
      fallbackNavDest
    ) {
      return [navRoutePresentation.snappedForFallback ?? driverPosition, fallbackNavDest];
    }
    return null;
  }, [navRoutePresentation.goldLine, navRoutePresentation.snappedForFallback, stopsRouteCoords.length, driverPosition, fallbackNavDest]);

  const nativeSdkRouteGuide = useMemo(
    () => sampleRouteGuidePoints(immediateLegLineForMap, SDK_NATIVE_ROUTE_GUIDE_MAX_POINTS),
    [immediateLegLineForMap],
  );

  /** Troca de trecho (parada / destino sequencial): remonta a polyline para o Mapbox não “arrastar” geometria antiga. */
  const dashedRouteSegmentKey = useMemo(() => {
    const t = nearestTargetCoord;
    if (!t || !isValidGlobeCoordinate(t.latitude, t.longitude)) {
      return String(currentStopIndex);
    }
    return `${currentStopIndex}-${t.latitude.toFixed(5)}-${t.longitude.toFixed(5)}`;
  }, [currentStopIndex, nearestTargetCoord]);

  /**
   * Pin do motorista no mapa: em modo seguir, usa o mesmo snap da polyline (fica na linha/rua),
   * em vez de overlay fixo na tela (que não acompanha look-ahead + padding da câmera).
   */
  const driverMapPinCoordinate = useMemo((): LatLng | null => {
    if (!driverPosition || !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)) {
      return null;
    }
    if (!followMyLocation) return driverPosition;
    const goldBase = stopsRouteCoords;
    const darkBase = nearestDashedCoords;
    const guide =
      goldBase.length >= 2 ? goldBase : darkBase.length >= 2 ? darkBase : [];
    if (guide.length < 2) return driverPosition;
    const snap = snapToRoutePolyline(driverPosition, guide, NAV_ROUTE_SNAP_MAX_M);
    if (snap.distanceM > NAV_ROUTE_SNAP_MAX_M) return driverPosition;
    return snap.snapped;
  }, [driverPosition, followMyLocation, stopsRouteCoords, nearestDashedCoords]);

  /** Sem GPS e sem nenhuma coordenada de viagem/paradas → não confundir com mapa “real” centrado no BR. */
  const activeTripMapReady = useMemo(() => {
    if (loading) return true;
    if (
      driverPosition &&
      isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)
    )
      return true;
    if (tripDestLL) return true;
    return stops.some(
      (s) =>
        s.lat != null &&
        s.lng != null &&
        isValidGlobeCoordinate(s.lat, s.lng),
    );
  }, [loading, driverPosition, tripDestLL, stops]);

  // Primeira posição GPS: centraliza no motorista com zoom 16.
  useEffect(() => {
    if (loading || !driverPosition || hasFramedDriverOnMap.current) return;
    if (!isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)) return;
    const id = requestAnimationFrame(() => {
      mapRef.current?.animateToRegion(
        {
          latitude: driverPosition.latitude,
          longitude: driverPosition.longitude,
          latitudeDelta: MY_LOCATION_NAV_DELTA,
          longitudeDelta: MY_LOCATION_NAV_DELTA,
        },
        500,
      );
    });
    hasFramedDriverOnMap.current = true;
    return () => cancelAnimationFrame(id);
  }, [loading, driverPosition]);

  // ---------------------------------------------------------------------------
  // Detail sheet animation
  // ---------------------------------------------------------------------------

  const openDetail = () => {
    detailSlide.setValue(600);
    setDetailVisible(true);
    // translateY + useNativeDriver:true desloca o hit-test dos botões no Android (toques “mortos”).
    Animated.spring(detailSlide, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  };

  const openDetailFromMiniSheet = () => {
    if (cardInfo) setDetailViewStop(cardInfo);
    openDetail();
  };

  const closeDetail = () => {
    Animated.timing(detailSlide, { toValue: 600, duration: 250, useNativeDriver: false }).start(() => {
      setDetailVisible(false);
      setDetailViewStop(null);
    });
  };

  /** Fecha o sheet sem animar — use quando o modal de detalhe já está invisível (ex.: fluxo só com modal de confirmação). Animar `detailSlide` com Modal desmontado trava no iOS. */
  const syncCloseDetailOnly = () => {
    detailSlide.setValue(600);
    setDetailVisible(false);
    setDetailViewStop(null);
  };

  const openFinalize = () => {
    setTripExpenseFiles([]);
    finalizeSlide.setValue(600);
    setFinalizeVisible(true);
    Animated.spring(finalizeSlide, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  };

  const closeFinalize = () => {
    Animated.timing(finalizeSlide, { toValue: 600, duration: 250, useNativeDriver: false }).start(() => {
      setFinalizeVisible(false);
      setTripExpenseFiles([]);
    });
  };

  const handlePickTripExpenses = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permissão', 'Precisamos de acesso às fotos para anexar comprovantes de despesa.');
      return;
    }
    const raw = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.85,
      base64: true,
      selectionLimit: 8,
      ...(Platform.OS === 'ios'
        ? { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible }
        : {}),
    });
    const result = await mergePendingAndroidGalleryResult(raw);
    if (result.canceled || !result.assets?.length) return;
    setTripExpenseFiles((prev) => {
      const next = [...prev];
      for (const a of result.assets) {
        const { mime, ext } = mimeAndExtFromExpenseAsset(a);
        const name = a.fileName?.trim() || `comprovante-${Date.now()}.${ext}`;
        next.push({ uri: a.uri, mimeType: mime, name, base64: a.base64 ?? null });
      }
      return next.slice(0, 8);
    });
  };

  const removeTripExpenseAt = (index: number) => {
    setTripExpenseFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Liga para o contacto da parada aberta no sheet de detalhes.
   * Resolve o número via RPC `driver_get_trip_stop_contact` (passageiro usa
   * `profiles.phone`, dependente/encomenda guardam o telefone na própria linha).
   */
  const handleCallStopContact = async () => {
    const stop = detailSheetStop;
    if (!stop) return;

    let stopId = stop.id;
    if (isSyntheticTripStopId(stopId)) {
      const resolvedId = await resolveSyntheticTripStopId(tripId, stop);
      if (!resolvedId) {
        showAlert(
          'Contacto',
          'Não foi possível sincronizar esta parada com o servidor. Tente novamente em alguns segundos.',
        );
        return;
      }
      stopId = resolvedId;
    }

    try {
      const { data, error } = await supabase.rpc(
        'driver_get_trip_stop_contact' as never,
        { p_trip_stop_id: stopId } as never,
      );
      if (error) {
        showAlert('Contacto', getUserErrorMessage(error));
        return;
      }
      const payload = (data ?? {}) as { ok?: boolean; error?: string; phone?: string | null };
      if (payload.ok === false) {
        showAlert(
          'Contacto',
          payload.error === 'forbidden'
            ? 'Sem permissão para ver este contacto.'
            : 'Não foi possível obter o contacto desta parada.',
        );
        return;
      }
      const digits = onlyDigits(String(payload.phone ?? ''));
      if (digits.length < 8) {
        showAlert('Contacto', 'Nenhum telefone disponível para esta parada.');
        return;
      }
      await Linking.openURL(`tel:${digits}`);
    } catch (e) {
      showAlert('Contacto', getUserErrorMessage(e));
    }
  };

  /**
   * Cancelamento de coleta no sheet de detalhes (passageiro/dependente não
   * compareceu ou coleta desistida no local). Chama `driver_cancel_pickup`
   * que marca a parada de pickup — e o dropoff da mesma entidade — como
   * `skipped`, permitindo avançar a rota sem mexer em bookings/shipments.
   */
  const handleCancelPickup = () => {
    const stop = detailSheetStop;
    if (!stop) return;

    const isPackage = stop.stopType === 'package_pickup';
    const isDep = stop.stopType === 'dependent_pickup';
    const title = isPackage
      ? isPackagePickupAtBase(stop)
        ? 'Cancelar retirada?'
        : 'Cancelar coleta?'
      : isDep
        ? 'Cancelar embarque do dependente?'
        : 'Cancelar embarque?';
    const message = isPackage
      ? 'A coleta será ignorada e a rota avança para a próxima parada. A encomenda continua no sistema — fale com o suporte se precisar de cancelamento definitivo.'
      : isDep
        ? 'O embarque e o desembarque deste dependente serão ignorados e a rota avança para a próxima parada. Use só quando o responsável/dependente não comparecer.'
        : 'O embarque e o desembarque deste passageiro serão ignorados e a rota avança para a próxima parada. Use só em caso de não comparecimento do passageiro.';

    Alert.alert(title, message, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Sim, cancelar',
        style: 'destructive',
        onPress: () => void runCancelPickup(stop),
      },
    ]);
  };

  const runCancelPickup = async (stop: Stop) => {
    let stopId = stop.id;
    if (isSyntheticTripStopId(stopId)) {
      const resolvedId = await resolveSyntheticTripStopId(tripId, stop);
      if (!resolvedId) {
        showAlert(
          'Paradas',
          'Não foi possível sincronizar esta parada com o servidor. Tente novamente em alguns segundos.',
        );
        return;
      }
      stopId = resolvedId;
    }

    try {
      const { data, error } = await supabase.rpc(
        'driver_cancel_pickup' as never,
        { p_trip_stop_id: stopId } as never,
      );
      if (error) {
        showAlert('Erro', getUserErrorMessage(error));
        return;
      }
      const payload = (data ?? {}) as { ok?: boolean; error?: string };
      if (payload.ok === false) {
        const err = String(payload.error ?? '');
        const msg =
          err === 'forbidden'
            ? 'Sem permissão para cancelar esta parada.'
            : err === 'stop_not_found'
              ? 'Parada não encontrada.'
              : err === 'not_a_pickup'
                ? 'Esta parada não pode ser cancelada.'
                : 'Não foi possível cancelar a parada.';
        showAlert('Erro', msg);
        return;
      }
    } catch (e) {
      showAlert('Erro', getUserErrorMessage(e));
      return;
    }

    const fresh = await reloadTripStops();
    syncCloseDetailOnly();
    const nextIndex = computeFirstIncompleteStopIndex(fresh);
    setCurrentStopIndex(nextIndex);
    if (nextIndex >= fresh.length) {
      setTimeout(() => openFinalize(), 120);
    }
  };

  /**
   * Dois Modais transparentes abertos ao mesmo tempo no iOS costumam roubar toques:
   * o sheet de detalhes ficava “por cima” do de confirmação → “Iniciar embarque” parecia morto.
   * Fechamos o sheet e abrimos só o modal de confirmação; ao voltar, reabrimos o sheet.
   */
  const hideDetailAndOpenConfirmPickup = () => {
    const stopForFlow = detailViewStop ?? currentStop;
    confirmTargetStopRef.current = stopForFlow;
    setConfirmUiStop(stopForFlow);
    setConfirmCode('');
    setConfirmError('');
    detailSlide.setValue(600);
    setDetailVisible(false);
    confirmSheetSlide.setValue(600);
    setConfirmPickupVisible(true);
    requestAnimationFrame(() => {
      Animated.spring(confirmSheetSlide, {
        toValue: 0,
        // translateY + useNativeDriver desalinha hit-test de botões no Android (toque “morto”).
        useNativeDriver: false,
        bounciness: 0,
      }).start();
    });
  };

  const hideDetailAndOpenConfirmDelivery = () => {
    const stopForFlow = detailViewStop ?? currentStop;
    confirmTargetStopRef.current = stopForFlow;
    setConfirmUiStop(stopForFlow);
    setConfirmCode('');
    setConfirmError('');
    detailSlide.setValue(600);
    setDetailVisible(false);
    confirmSheetSlide.setValue(600);
    setConfirmDeliveryVisible(true);
    requestAnimationFrame(() => {
      Animated.spring(confirmSheetSlide, {
        toValue: 0,
        useNativeDriver: false,
        bounciness: 0,
      }).start();
    });
  };

  const dismissConfirmPickupBackToDetail = () => {
    const backStop = confirmUiStop ?? confirmTargetStopRef.current;
    confirmTargetStopRef.current = null;
    setConfirmUiStop(null);
    setConfirmCode('');
    setConfirmError('');
    Animated.timing(confirmSheetSlide, { toValue: 600, duration: 250, useNativeDriver: false }).start(() => {
      setConfirmPickupVisible(false);
      setTimeout(() => {
        if (backStop) setDetailViewStop(backStop);
        openDetail();
      }, 320);
    });
  };

  const dismissConfirmDeliveryBackToDetail = () => {
    const backStop = confirmUiStop ?? confirmTargetStopRef.current;
    confirmTargetStopRef.current = null;
    setConfirmUiStop(null);
    setConfirmCode('');
    setConfirmError('');
    Animated.timing(confirmSheetSlide, { toValue: 600, duration: 250, useNativeDriver: false }).start(() => {
      setConfirmDeliveryVisible(false);
      setTimeout(() => {
        if (backStop) setDetailViewStop(backStop);
        openDetail();
      }, 320);
    });
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const confirmStopInFlightRef = useRef(false);

  const handleConfirmStop = async () => {
    if (confirmStopInFlightRef.current) return;
    confirmStopInFlightRef.current = true;
    try {
      const stop = confirmTargetStopRef.current ?? stops[currentStopIndex] ?? null;
      if (!stop) {
        showAlert(
          'Paradas',
          'Não foi possível identificar esta parada (a lista foi atualizada). Toque em Voltar e abra de novo.',
        );
        return;
      }

      if (requiresDriverEnteredPin(stop)) {
        const digitsIn = onlyDigits(confirmCode);
        if (digitsIn.length !== 4) {
          setConfirmError('O código deve ter 4 dígitos.');
          return;
        }
        const expectedDigits = onlyDigits(stop.code ?? '');
        if (expectedDigits.length === 4 && digitsIn !== expectedDigits) {
          setConfirmError(
            isPassenger(stop)
              ? 'Código incorreto. Verifique com o passageiro.'
              : isDependent(stop)
                ? 'Código incorreto. Verifique com o responsável pelo dependente.'
                : 'Código incorreto. Verifique com o cliente.',
          );
          return;
        }
      }

      let stopId = stop.id;
      if (isSyntheticTripStopId(stopId)) {
        const resolvedId = await resolveSyntheticTripStopId(tripId, stop);
        if (resolvedId) {
          stopId = resolvedId;
        } else {
          showAlert('Paradas', 'Não foi possível sincronizar as paradas com o servidor. Tente novamente.');
          return;
        }
      }

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'complete_trip_stop' as never,
          {
            p_trip_stop_id: stopId,
            p_confirmation_code: requiresDriverEnteredPin(stop) ? confirmCode.trim() : null,
          } as never,
        );

        if (rpcError) {
          showAlert('Erro', getUserErrorMessage(rpcError));
          return;
        }

        const payload = rpcData as { ok?: boolean; error?: string } | null;
        if (payload && payload.ok === false) {
          const err = String(payload.error ?? '');
          const msg =
            err === 'invalid_code'
              ? isPassenger(stop) || isDependent(stop)
                ? 'Código incorreto. Confira o código no app do passageiro ou do responsável.'
                : 'Código incorreto. Verifique com o cliente.'
              : err === 'code_length'
                ? 'O código deve ter 4 dígitos.'
              : err === 'missing_code'
                ? isDependent(stop)
                  ? 'Código do envio de dependente não encontrado. Atualize a viagem ou fale com o suporte.'
                  : 'Código da encomenda não encontrado no sistema. Atualize a viagem ou fale com o suporte.'
                : err === 'forbidden'
                  ? 'Sem permissão para concluir esta parada.'
                  : err === 'pickup_not_confirmed'
                    ? 'O cliente ainda não validou o código de coleta no app dele.'
                  : err === 'stop_not_found'
                    ? 'Parada não encontrada.'
                    : 'Não foi possível concluir a parada.';
          showAlert('Erro', msg);
          return;
        }
      } catch (e: unknown) {
        showAlert('Erro', getUserErrorMessage(e));
        return;
      }

      const fresh = await reloadTripStops();
      confirmTargetStopRef.current = null;
      setConfirmUiStop(null);
      setConfirmError('');
      setConfirmCode('');
      confirmSheetSlide.setValue(600);
      setConfirmPickupVisible(false);
      setConfirmDeliveryVisible(false);
      syncCloseDetailOnly();

      const nextIndex = computeFirstIncompleteStopIndex(fresh);
      setCurrentStopIndex(nextIndex);
      if (nextIndex >= fresh.length) {
        setTimeout(() => openFinalize(), 120);
      }
    } finally {
      confirmStopInFlightRef.current = false;
    }
  };

  /** Fecha o sheet “Viagem concluída” e volta ao tab principal (após avaliação ou fallback). */
  const goHomeFromCompletedRating = useCallback(() => {
    Animated.timing(completedSlide, { toValue: 600, duration: 280, useNativeDriver: false }).start(() => {
      setCompletedVisible(false);
      completedSlide.setValue(600);
      requestAnimationFrame(() => {
        navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Main' }] }));
      });
    });
  }, [navigation, completedSlide]);

  const handleFinalizeTrip = async () => {
    const routeSlotSnapshot = trip;
    const completedCashFeeCents = cashPlatformFeeCents;
    setFinalizingTrip(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Sessão inválida. Faça login novamente.');

      const uploadedPaths: string[] = [];
      for (const file of tripExpenseFiles) {
        let bytes: Uint8Array;
        if (file.base64) {
          try {
            bytes = uint8ArrayFromBase64(file.base64);
          } catch {
            throw new Error('Foto inválida. Remova o anexo e escolha de novo na galeria.');
          }
        } else {
          let res: Response;
          try {
            res = await fetch(file.uri);
          } catch {
            throw new Error(
              'Não foi possível ler a foto (URI inválida ou biblioteca de fotos). No iPhone, remova o anexo e escolha de novo na galeria.',
            );
          }
          if (!res.ok) {
            throw new Error(`Não foi possível ler a foto (código ${res.status}). Tente outra imagem.`);
          }
          const buf = await res.arrayBuffer();
          bytes = new Uint8Array(buf);
        }
        const rawExt = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : 'jpg';
        const ext = rawExt && /^[a-z0-9]+$/.test(rawExt) ? rawExt : 'jpg';
        const path = `${user.id}/${tripId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('trip-expenses').upload(path, bytes, {
          contentType: file.mimeType || 'image/jpeg',
          upsert: false,
        });
        if (upErr) {
          const um = String((upErr as { message?: string }).message || '');
          if (/row-level security|rls|violates row-level|new row violates/i.test(um)) {
            throw new Error(
              'O servidor recusou o envio do comprovante (armazenamento). Tente finalizar sem fotos ou peça ao suporte para revisar o bucket trip-expenses no Supabase.',
            );
          }
          throw upErr;
        }
        uploadedPaths.push(path);
      }

      const rpcPayload =
        uploadedPaths.length > 0
          ? { p_trip_id: tripId, p_expense_paths: uploadedPaths }
          : { p_trip_id: tripId };
      const { data: rpcJson, error: rpcErr } = await supabase.rpc(
        'motorista_complete_scheduled_trip',
        rpcPayload as never,
      );
      if (rpcErr) {
        const rm = String(rpcErr.message || '');
        if (/could not find the function|schema cache|404/i.test(rm)) {
          throw new Error(
            'O servidor ainda não tem a função para concluir a viagem. Aplique a migração motorista_complete_scheduled_trip no Supabase (supabase db push) e tente de novo.',
          );
        }
        throw rpcErr;
      }
      const rpcData = rpcJson as { ok?: boolean; error?: string; message?: string } | null;
      if (rpcData && rpcData.ok === false) {
        if (rpcData.error === 'not_your_trip') {
          throw new Error('Esta viagem não está atribuída à sua conta.');
        }
        if (rpcData.error === 'not_found') {
          throw new Error('Viagem não encontrada ou já removida.');
        }
        if (rpcData.error === 'unauthorized') {
          throw new Error('Sessão inválida. Faça login novamente.');
        }
        throw new Error(
          rpcData.message ||
            'Não foi possível concluir a viagem no servidor. Tente de novo ou fale com o suporte.',
        );
      }
      void (supabase as any).from('scheduled_trip_live_locations').delete().eq('scheduled_trip_id', tripId);
      await closeConversationsForScheduledTrip(tripId);

      if (
        routeSlotSnapshot?.route_id &&
        routeSlotSnapshot.day_of_week != null &&
        !Number.isNaN(Number(routeSlotSnapshot.day_of_week))
      ) {
        await insertPlannedRouteSlotAfterComplete(supabase, user.id, {
          route_id: routeSlotSnapshot.route_id,
          day_of_week: Number(routeSlotSnapshot.day_of_week),
          departure_time: routeSlotSnapshot.departure_time ?? null,
          arrival_time: routeSlotSnapshot.arrival_time ?? null,
          capacity: routeSlotSnapshot.capacity ?? 4,
          price_per_person_cents: routeSlotSnapshot.price_per_person_cents ?? 0,
          origin_address: routeSlotSnapshot.origin_address,
          destination_address: routeSlotSnapshot.destination_address,
          origin_lat: routeSlotSnapshot.origin_lat ?? null,
          origin_lng: routeSlotSnapshot.origin_lng ?? null,
          destination_lat: routeSlotSnapshot.destination_lat ?? null,
          destination_lng: routeSlotSnapshot.destination_lng ?? null,
        });
      }
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
      return;
    } finally {
      setFinalizingTrip(false);
    }
    setTripExpenseFiles([]);
    // Não animar finalize com o modal a desmontar ao abrir o próximo — iOS pode travar toques.
    finalizeSlide.setValue(600);
    setFinalizeVisible(false);
    completedSlide.setValue(600);
    setCompletedVisible(true);
    requestAnimationFrame(() => {
      Animated.spring(completedSlide, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
    });
    if (completedCashFeeCents > 0) {
      setTimeout(() => {
        showAlert(
          'Taxa da plataforma',
          `Taxa ${formatCurrencyCents(completedCashFeeCents)} registrada; será abatida nas próximas corridas com cartão/Pix.`,
        );
      }, 350);
    }
  };

  const handleSubmitRating = async () => {
    if (rating < 1) {
      // Modal nativo: fica acima do bottom sheet (Modal) da viagem concluída; showAlert pode ficar oculto.
      Alert.alert('Avaliação', 'Selecione de 1 a 5 estrelas para enviar.');
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      Alert.alert('Erro', 'Sessão inválida. Faça login novamente.');
      return;
    }
    setSubmittingRating(true);
    try {
      const { error } = await supabase.from('trip_ratings' as never).upsert(
        {
          trip_id: tripId,
          driver_id: user.id,
          rating,
          comment: ratingComment.trim() || null,
        } as never,
        { onConflict: 'trip_id,driver_id' }
      );
      if (error) throw error;
    } catch (e: unknown) {
      if (isTripRatingsUnavailableError(e)) {
        Alert.alert(
          'Avaliação indisponível',
          'O servidor Supabase deste app ainda não tem a tabela de avaliações (trip_ratings). É preciso aplicar as migrações do repositório nesse projeto (por exemplo `supabase db push` ou SQL no painel).\n\nVocê pode ir para o início sem salvar a avaliação.',
          [
            { text: 'Ficar aqui', style: 'cancel' },
            { text: 'Ir para o início', onPress: () => goHomeFromCompletedRating() },
          ],
        );
      } else {
        Alert.alert('Erro', getUserErrorMessage(e));
      }
      return;
    } finally {
      setSubmittingRating(false);
    }
    goHomeFromCompletedRating();
  };

  // Modal nativo por cima de MapView (SurfaceView) no Android não recebe toques; usamos overlay em View.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const stackOpen =
      detailVisible ||
      confirmPickupVisible ||
      confirmDeliveryVisible ||
      finalizeVisible ||
      completedVisible;
    if (!stackOpen) return;

    const onHardwareBack = () => {
      if (completedVisible) return true;
      if (finalizeVisible) {
        closeFinalize();
        return true;
      }
      if (confirmDeliveryVisible) {
        dismissConfirmDeliveryBackToDetail();
        return true;
      }
      if (confirmPickupVisible) {
        dismissConfirmPickupBackToDetail();
        return true;
      }
      if (detailVisible) {
        closeDetail();
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [
    completedVisible,
    detailVisible,
    confirmPickupVisible,
    confirmDeliveryVisible,
    finalizeVisible,
    closeDetail,
    closeFinalize,
    dismissConfirmDeliveryBackToDetail,
    dismissConfirmPickupBackToDetail,
  ]);

  // ---------------------------------------------------------------------------
  // Mapa offline (basemap) + indicador de rede
  // ---------------------------------------------------------------------------
  // Auto-download do pack offline cobrindo a rota dourada (`stopsRouteCoords`).
  // É idempotente por `trip-<id>`: só baixa uma vez por viagem nesta sessão.
  const { online: isOnline } = useNetworkStatus();
  useRouteOfflinePack({
    packName: tripId ? `trip-${tripId}` : null,
    coords: stopsRouteCoords,
  });

  const handleNativeWaypointArrival = useCallback((waypointIndex: number) => {
    const relativeIndex = Math.max(0, waypointIndex - 1);
    const maxStopIndex = Math.max(stops.length - 1, 0);
    const stop = stops[Math.min(currentStopIndex + relativeIndex, maxStopIndex)] ?? currentStop;
    if (stop) {
      setDetailViewStop(stop);
      openDetail();
      return;
    }
    if (allDone) openFinalize();
  }, [allDone, currentStop, currentStopIndex, openDetail, openFinalize, stops]);

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={DARK} />
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.root}>
      <StatusBar hidden animated hideTransitionAnimation="fade" style="light" />

      {/* ── Mapa: wrapper que escolhe entre Mapbox Navigation SDK nativo (flag ON) ou Mapbox Maps legado (flag OFF) ─ */}
      <NavigationView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        waypoints={navigationWaypoints}
        routeCoordinates={nativeSdkRouteGuide}
        accessToken={getMapboxAccessToken()}
        voiceLanguage="pt-BR"
        mute={nativeVoiceMuted}
        nativeNavigationActive={nativeNavigationActive}
        followingPaddingTop={overlayTop}
        followingPaddingBottom={effectiveBottomInset + 12 + SDK_NATIVE_FLOATING_CARD_PADDING}
        followingPaddingLeft={14}
        followingPaddingRight={14}
        followingZoom={SDK_NATIVE_FOLLOWING_ZOOM}
        recenterRequestKey={nativeRecenterRequestKey}
        onProgress={handleNativeRouteProgress}
        onWaypointArrival={handleNativeWaypointArrival}
        onArrival={() => handleNativeWaypointArrival(navigationWaypoints.length - 1)}
        onOffRoute={handleNativeOffRoute}
        onReroute={handleNativeReroute}
        onCancel={() => fallbackToLegacyNavigation()}
        onNativeUnavailable={() => {
          if (nativeNavigationRequested) {
            fallbackToLegacyNavigation('Navegação nativa indisponível neste build. Mantive o mapa legado.');
          }
        }}
        legacyInitialRegion={mapInitialRegion}
        legacyRender={({ mapRef: legacyMapRef, initialRegion }) => (
          <GoogleMapsMap
            ref={legacyMapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={initialRegion}
            layoutBottomInset={Platform.OS === 'android' ? effectiveBottomInset : 0}
            onUserAdjustedMap={() => {
              setFollowMyLocation(false);
              setNativeNavigationRequested(false);
            }}
          >
            {(goldLineForMap?.length ?? 0) >= 2 || immediateLegLineForMap.length >= 2 ? (
          <>
            {goldLineForMap && goldLineForMap.length >= 2 && (
              <MapPolyline
                id="trip-gold"
                coordinates={goldLineForMap}
                strokeColor={GOLD}
                strokeWidth={5}
                lineOpacity={isRerouting || isOffRouteSoft ? 0.4 : 1}
                aboveLayerID={MAPBOX_STREETS_ROUTE_ABOVE_LAYER_ID}
              />
            )}
            {immediateLegLineForMap.length >= 2 && (
              <>
                <MapPolyline
                  key={`trip-immediate-under-${dashedRouteSegmentKey}`}
                  id="trip-immediate-under"
                  coordinates={immediateLegLineForMap}
                  strokeColor="#0a0a0a"
                  strokeWidth={12}
                  lineOpacity={0.55}
                  aboveLayerID={
                    (goldLineForMap?.length ?? 0) >= 2 ? 'trip-gold-layer' : MAPBOX_STREETS_ROUTE_ABOVE_LAYER_ID
                  }
                  layerIndex={982}
                />
                <MapPolyline
                  key={`trip-immediate-core-${dashedRouteSegmentKey}`}
                  id="trip-immediate-core"
                  coordinates={immediateLegLineForMap}
                  strokeColor="#000000"
                  strokeWidth={4}
                  lineOpacity={0.95}
                  aboveLayerID="trip-immediate-under-layer"
                  layerIndex={983}
                />
                <MapPolyline
                  key={`trip-immediate-${dashedRouteSegmentKey}`}
                  id="trip-immediate"
                  coordinates={immediateLegLineForMap}
                  strokeColor="#000000"
                  strokeWidth={8}
                  lineOpacity={1}
                  lineDasharray={NEAREST_ROUTE_LINE_DASH}
                  aboveLayerID="trip-immediate-core-layer"
                  layerIndex={984}
                />
              </>
            )}
          </>
        ) : null}

        {/* Stop markers */}
        {stops.map((stop, idx) => {
          const hasCoord =
            stop.lat != null &&
            stop.lng != null &&
            isValidGlobeCoordinate(stop.lat, stop.lng);
          const baseLat = mapInitialRegion.latitude;
          const baseLng = mapInitialRegion.longitude;
          const lat = hasCoord ? stop.lat! : baseLat + idx * 0.002;
          const lng = hasCoord ? stop.lng! : baseLng + idx * 0.002;
          const isCompleted = idx < currentStopIndex;
          const markerBg = isCompleted ? '#374151' : STOP_TYPE_COLORS[stop.stopType];
          const isActiveSequentialStop = idx === mapHighlightStopIndex && !allDone;
          return (
            <ActiveStopMarker
              key={stop.id}
              id={stop.id}
              stop={stop}
              latitude={lat}
              longitude={lng}
              completed={isCompleted}
              isActiveSequentialStop={isActiveSequentialStop}
              markerBg={markerBg}
            />
          );
        })}

        {driverMapPinCoordinate && (
          <SmoothDriverMapMarker
            targetLatitude={driverMapPinCoordinate.latitude}
            targetLongitude={driverMapPinCoordinate.longitude}
            following={followMyLocation}
            targetHeadingDeg={driverHeadingDeg}
          />
        )}
          </GoogleMapsMap>
        )}
      />

      {!activeTripMapReady && (
        <View style={styles.mapCoordsLoading} pointerEvents="none">
          <ActivityIndicator size="large" color={DARK} />
          <Text style={styles.mapCoordsLoadingText}>Carregando mapa…</Text>
        </View>
      )}

      {/* ── Overlay UI (mesmo padrão da coleta ativa / Mapbox) ── */}
      <SafeAreaView edges={['top', 'bottom']} style={StyleSheet.absoluteFillObject} pointerEvents="box-none">

        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + 8, left: 14 }]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <MaterialIcons name="arrow-back" size={20} color={DARK} />
        </TouchableOpacity>

        {/* Badge: sem internet → mapa segue offline (se houver pack baixado). */}
        {!isOnline && !rerouteBadgeMounted && (
          <View
            style={[styles.networkBadgeWrap, { top: insets.top + 12 }]}
            pointerEvents="none"
          >
            <MapNetworkBadge online={false} />
          </View>
        )}

        {rerouteBadgeMounted && (
          <View style={styles.rerouteOverlay} pointerEvents="none">
            <Animated.View
              pointerEvents="none"
              style={[
                styles.rerouteCard,
                rerouteNetworkError && styles.rerouteCardError,
                isWrongDirection && !rerouteNetworkError && styles.rerouteCardWarning,
                {
                  opacity: rerouteBadgeAnim,
                  transform: [
                    {
                      scale: rerouteBadgeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.92, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.rerouteIconWrap}>
                {rerouteNetworkError ? (
                  <MaterialIcons name="cloud-off" size={28} color="#fff" />
                ) : isWrongDirection ? (
                  <MaterialIcons name="u-turn-left" size={28} color="#fff" />
                ) : (
                  <ActivityIndicator size="large" color="#fff" />
                )}
              </View>
              <Text style={styles.rerouteCardTitle}>
                {rerouteNetworkError
                  ? 'Sem conexão'
                  : isWrongDirection
                    ? 'Você está indo na direção errada'
                    : 'Recalculando rota…'}
              </Text>
              <Text style={styles.rerouteCardSubtitle}>
                {rerouteNetworkError
                  ? 'Reconectando ao servidor de rotas…'
                  : isWrongDirection
                    ? 'Faça o retorno ou aguarde uma nova rota'
                    : isRerouting &&
                        rerouteElapsedSec * 1000 >= REROUTE_BADGE_ELAPSED_THRESHOLD_MS
                      ? `Tempo: ${rerouteElapsedSec}s`
                      : 'Aguarde alguns segundos'}
              </Text>
            </Animated.View>
          </View>
        )}

        {!nativeNavigationActive && (
          <View style={[styles.zoomWrap, { top: overlayTop, left: 14 }]} pointerEvents="box-none">
            <MapZoomControls
              mapRef={mapRef}
              floating={false}
              onBeforeZoom={() => {
                // Apenas sai do follow — não re-centraliza para o usuário poder usar os controles livremente.
                setFollowMyLocation(false);
                setNativeNavigationRequested(false);
              }}
            />
          </View>
        )}

        {/*
          O DriverLocationFocusButton serve para "entrar" no SDK e para
          recentralizar o mapa fora do SDK. Uma vez que a navegação SDK
          está ativa, o controle equivalente é o sdkFloatingBtn (à esquerda,
          ícone "near-me"). Esconder evita ações duplicadas e poluição visual.
        */}
        {!nativeNavigationActive && (
          <DriverLocationFocusButton
            following={followMyLocation}
            style={[
              styles.myLocationBtn,
              { top: overlayTop + 44 + 6 + 44 + 10, left: 14 },
            ]}
            onPress={() => {
              if (!driverPosition || !isValidGlobeCoordinate(driverPosition.latitude, driverPosition.longitude)) return;
              if (useNativeNav) {
                if (navigationWaypoints.length < 2) {
                  showAlert('Navegação', 'Ainda não há rota suficiente para iniciar a navegação.');
                  return;
                }
                setFollowMyLocation(false);
                setNativeNavigationRequested(true);
                setNativeRecenterRequestKey((v) => v + 1);
                return;
              }
              setFollowMyLocation(true);
            }}
          />
        )}

        {nativeNavigationActive && (
          <>
            <TouchableOpacity
              style={[styles.sdkFloatingBtn, { left: 14, bottom: nativeSdkVoiceBottom }]}
              onPress={() => setNativeVoiceMuted((muted) => !muted)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={nativeVoiceMuted ? 'Ativar auxiliar de voz' : 'Desativar auxiliar de voz'}
            >
              <MaterialIcons name={nativeVoiceMuted ? 'volume-off' : 'volume-up'} size={22} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sdkFloatingBtn, { left: 14, bottom: nativeSdkRecenterBottom }]}
              onPress={() => setNativeRecenterRequestKey((v) => v + 1)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="Centralizar na direção da corrida"
            >
              <MaterialIcons name="near-me" size={22} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sdkFloatingBtn, { left: 14, bottom: nativeSdkToggleBottom }]}
              onPress={() => setMiniSheetVisible((visible) => !visible)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={miniSheetVisible ? 'Ocultar informações da próxima parada' : 'Mostrar informações da próxima parada'}
            >
              <MaterialIcons name={miniSheetVisible ? 'keyboard-arrow-down' : 'keyboard-arrow-up'} size={26} color="#fff" />
            </TouchableOpacity>
          </>
        )}

        {(stops.length > 0 || showSidebarTripEndFlag) && (
          <View style={[styles.sidebar, { top: overlayTop, right: 14 }]} pointerEvents="box-none">
            {(stops.length + (showSidebarTripEndFlag ? 1 : 0)) > 1 && (
              <View style={styles.sidebarLine} pointerEvents="none" />
            )}

            {stops.map((stop, idx) => {
              const isCompleted = idx < currentStopIndex;
              const isCurrent = idx === mapHighlightStopIndex;
              const btnBg = isCompleted ? '#9CA3AF' : isCurrent ? STOP_TYPE_COLORS[stop.stopType] : '#E5E7EB';
              const iconColor = isCompleted || isCurrent ? '#fff' : '#6B7280';
              return (
                <TouchableOpacity
                  key={stop.id}
                  style={[styles.sidebarBtn, { backgroundColor: btnBg }]}
                  accessibilityRole="button"
                  accessibilityLabel={stopPhaseShortLabel(stop)}
                  activeOpacity={0.85}
                  onPress={() => focusMapOnSidebarStop(stop, idx)}
                >
                  <StopKindMarkerIcon stop={stop} completed={isCompleted} color={iconColor} />
                </TouchableOpacity>
              );
            })}

            {showSidebarTripEndFlag && (
              <TouchableOpacity
                style={[styles.sidebarBtn, styles.sidebarDestBtn]}
                accessibilityRole="button"
                accessibilityLabel="Destino da viagem"
                activeOpacity={0.85}
                onPress={focusMapOnSidebarTripDestination}
              >
                <MaterialIcons name="flag" size={18} color={DARK} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Mini bottom card — sempre visível quando há viagem ativa */}
        {cardInfo && !detailVisible && !allDone && miniSheetVisible && (
          <TouchableOpacity
            style={[styles.miniSheet, { bottom: effectiveBottomInset + 12 }]}
            onPress={openDetailFromMiniSheet}
            activeOpacity={0.95}
          >
            <View style={styles.navNextBannerIntro}>
              <Text style={styles.navNextBannerKicker}>A partir da sua posição…</Text>
            </View>

            <View style={styles.miniSheetTopRow}>
              <View style={[
                styles.stopTypePill,
                (isPassenger(cardInfo) || isDependent(cardInfo)) && styles.stopTypePillTrip,
              ]}>
                <View style={styles.stopTypeDot} />
                <Text style={styles.stopTypePillText}>
                  {stopPhaseShortLabel(cardInfo)}
                </Text>
              </View>
              {etaSeconds !== null && (
                <View style={styles.etaBadge}>
                  <Text style={styles.etaBadgeText}>
                    {Math.max(1, Math.round(etaSeconds / 60))} min
                    {nativeDistanceRemainingLabel ? ` • ${nativeDistanceRemainingLabel}` : ''}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.miniSheetName} numberOfLines={1}>
              {totalStops > 0 ? cardInfo.label : (trip?.origin_address ?? cardInfo.label)}
            </Text>
            {nativeNavigationActive && nativeMiniSheetCode?.code ? (
              <Text style={styles.miniSheetOrderId} numberOfLines={1}>
                {nativeMiniSheetCode.label} #{nativeMiniSheetCode.code}
              </Text>
            ) : null}

            <View style={styles.addressRow}>
              <MaterialIcons name="location-on" size={14} color="#6B7280" />
              <Text style={styles.addressText} numberOfLines={1}>{cardInfo.address}</Text>
            </View>

            {totalStops > 0 && (
              <View style={styles.miniSheetFooter}>
                <View style={styles.progressBarContainer}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${((currentStopIndex + 1) / Math.max(totalStops, 1)) * 100}%` as any },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>{currentStopIndex + 1}/{totalStops}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* All done float button */}
        {allDone && !finalizeVisible && !completedVisible && (
          <TouchableOpacity
            style={[styles.finalizeFloatBtn, { bottom: effectiveBottomInset + 16 }]}
            onPress={openFinalize}
            activeOpacity={0.85}
          >
            <Text style={styles.finalizeFloatBtnText}>Finalizar viagem</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {/* ── Detail bottom sheet (View overlay: Modal + MapView quebra toques no Android) ─ */}
      {detailVisible ? (
        <View style={styles.fullScreenMapOverlay} accessibilityViewIsModal>
        <KeyboardAvoidingView style={styles.modalRoot} behavior="padding">
          <Pressable style={styles.overlayBackdrop} onPress={closeDetail} />
          <Animated.View
            collapsable={false}
            style={[
              styles.detailSheet,
              styles.sheetAboveBackdrop,
              { transform: [{ translateY: detailSlide }], paddingBottom: effectiveBottomInset + 24 },
            ]}
          >
          <View style={styles.handle} />

          <View style={styles.detailTopRow}>
            <TouchableOpacity style={styles.iconCircleBtn} onPress={closeDetail} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={DARK} />
            </TouchableOpacity>
            <Text style={styles.detailTitle}>
              {detailSheetTitle(detailSheetStop)}
            </Text>
            <TouchableOpacity
              style={styles.iconCircleBtn}
              onPress={() => void handleCallStopContact()}
              activeOpacity={0.7}
            >
              <MaterialIcons name="phone" size={20} color={DARK} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailScroll}>
            {detailSheetStop && isPickup(detailSheetStop) ? (
              <>
                <View style={styles.avatarCenter}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarInitials}>{getInitials(detailSheetStop?.label ?? '?')}</Text>
                  </View>
                </View>
                <Text style={styles.detailName}>{detailSheetStop?.label}</Text>
                <View style={styles.detailMetaRow}>
                </View>
                <Text style={styles.detailLabel}>
                  {detailSheetStop.stopType === 'package_pickup'
                    ? isPackagePickupAtBase(detailSheetStop)
                      ? 'Endereço da base'
                      : 'Endereço da coleta'
                    : detailSheetStop.stopType === 'dependent_pickup'
                      ? 'Endereço do embarque do dependente'
                      : 'Endereço do embarque'}
                </Text>
                <Text style={styles.detailValue}>{detailSheetStop?.address}</Text>
                {detailSheetStop?.notes ? (
                  <>
                    <Text style={styles.detailLabel}>Observações</Text>
                    <Text style={styles.detailValue}>{detailSheetStop.notes}</Text>
                  </>
                ) : null}
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={hideDetailAndOpenConfirmPickup}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>
                    {detailSheetStop.stopType === 'package_pickup'
                      ? isPackagePickupAtBase(detailSheetStop)
                        ? 'Iniciar retirada na base'
                        : 'Iniciar coleta'
                      : detailSheetStop.stopType === 'dependent_pickup'
                        ? 'Iniciar embarque do dependente'
                        : 'Iniciar embarque'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={handleCancelPickup}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>
                    {detailSheetStop.stopType === 'package_pickup'
                      ? isPackagePickupAtBase(detailSheetStop)
                        ? 'Cancelar retirada'
                        : 'Cancelar coleta'
                      : detailSheetStop.stopType === 'dependent_pickup'
                        ? 'Cancelar embarque do dependente'
                        : 'Cancelar embarque'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : detailSheetStop &&
              (detailSheetStop.stopType === 'passenger_dropoff' ||
                detailSheetStop.stopType === 'dependent_dropoff') ? (
              <>
                <View style={styles.avatarCenter}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarInitials}>{getInitials(detailSheetStop?.label ?? '?')}</Text>
                  </View>
                </View>
                <Text style={styles.detailName}>{detailSheetStop.label}</Text>
                <Text style={styles.detailLabel}>
                  {detailSheetStop.stopType === 'dependent_dropoff'
                    ? 'Endereço do desembarque do dependente'
                    : 'Endereço do desembarque'}
                </Text>
                <Text style={styles.detailValue}>{detailSheetStop.address}</Text>
                {detailSheetStop.notes ? (
                  <>
                    <Text style={styles.detailLabel}>Observações</Text>
                    <Text style={styles.detailValue}>{detailSheetStop.notes}</Text>
                  </>
                ) : null}
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={hideDetailAndOpenConfirmPickup}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>Confirmar desembarque</Text>
                </TouchableOpacity>
              </>
            ) : detailSheetStop && isRouteWaypointStop(detailSheetStop) ? (
              <>
                <View style={styles.avatarCenter}>
                  <View
                    style={[
                      styles.avatarCircle,
                      { backgroundColor: STOP_TYPE_COLORS[detailSheetStop.stopType] },
                    ]}
                  >
                    <MaterialIcons
                      name={detailSheetStop.stopType === 'trip_destination' ? 'flag' : 'place'}
                      size={26}
                      color="#fff"
                    />
                  </View>
                </View>
                <Text style={styles.detailName}>{detailSheetStop.label}</Text>
                <Text style={styles.detailLabel}>Local</Text>
                <Text style={styles.detailValue}>{detailSheetStop.address}</Text>
                {detailSheetStop.notes ? (
                  <>
                    <Text style={styles.detailLabel}>Observações</Text>
                    <Text style={styles.detailValue}>{detailSheetStop.notes}</Text>
                  </>
                ) : null}
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={hideDetailAndOpenConfirmPickup}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>
                    {detailSheetStop.stopType === 'trip_destination' ? 'Concluir chegada' : 'Concluir parada'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.avatarCenter}>
                  <View style={[styles.avatarCircle, { backgroundColor: GOLD }]}>
                    <MaterialIcons name="inventory-2" size={26} color="#fff" />
                  </View>
                </View>
                <View style={styles.deliveryArrowRow}>
                  <Text style={styles.deliveryNameText}>
                    {'Destinatário: '}
                    <Text style={{ fontWeight: '700' }}>{detailSheetStop?.label}</Text>
                  </Text>
                </View>
                <Text style={styles.detailLabel}>Local de entrega</Text>
                <Text style={styles.detailValue}>{detailSheetStop?.address}</Text>
                {detailSheetStop?.notes ? (
                  <>
                    <Text style={styles.detailLabel}>Observações</Text>
                    <Text style={styles.detailValue}>{detailSheetStop.notes}</Text>
                  </>
                ) : null}
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={hideDetailAndOpenConfirmDelivery}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>Confirmar entrega</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </Animated.View>
        </KeyboardAvoidingView>
        </View>
      ) : null}

      {/* ── Confirmar coleta / entrega (um bottom sheet, um translateY) ─ */}
      {confirmPickupVisible || confirmDeliveryVisible ? (
        <View style={styles.fullScreenMapOverlay} accessibilityViewIsModal>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={styles.overlayBackdrop}
            onPress={
              confirmDeliveryVisible ? dismissConfirmDeliveryBackToDetail : dismissConfirmPickupBackToDetail
            }
          />
          <Animated.View
            collapsable={false}
            style={[
              styles.detailSheet,
              styles.sheetAboveBackdrop,
              { transform: [{ translateY: confirmSheetSlide }], paddingBottom: effectiveBottomInset + 24 },
            ]}
          >
            <View style={styles.handle} />
            {confirmDeliveryVisible ? (
              <>
                <View style={styles.confirmSheetHeaderRow}>
                  <Text style={styles.confirmSheetTitle} numberOfLines={2}>
                    Confirmar entrega
                  </Text>
                  <TouchableOpacity
                    style={styles.iconCircleBtn}
                    onPress={dismissConfirmDeliveryBackToDetail}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="close" size={20} color={DARK} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.confirmSheetSubtitle}>
                  Insira o código informado pelo cliente para confirmar a entrega.
                </Text>
                {confirmSheetCashPayment ? (
                  <View style={styles.cashPaymentNotice}>
                    <MaterialIcons name="payments" size={20} color="#92400E" />
                    <View style={styles.cashPaymentTextCol}>
                      <Text style={styles.cashPaymentTitle}>Receber em dinheiro</Text>
                      <Text style={styles.cashPaymentValue}>
                        {confirmSheetCashPayment.label}: {formatCurrencyCents(confirmSheetCashPayment.amountCents)}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.confirmSheetDivider} />
                <Text style={styles.fieldLabel}>Código de entrega</Text>
                <TextInput
                  style={styles.codeInput}
                  value={confirmCode}
                  onChangeText={(v) => {
                    setConfirmCode(v.replace(/\D/g, '').slice(0, 4));
                    setConfirmError('');
                  }}
                  keyboardType="numeric"
                  maxLength={4}
                  placeholder="Ex: 1234"
                  placeholderTextColor="#9CA3AF"
                />
                {confirmError ? <Text style={styles.errorText}>{confirmError}</Text> : null}
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => void handleConfirmStop()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>Confirmar entrega</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sheetBackBtn}
                  onPress={dismissConfirmDeliveryBackToDetail}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Voltar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.confirmSheetHeaderRow}>
                  <Text style={styles.confirmSheetTitle} numberOfLines={2}>
                    {confirmPickupTitle(confirmSheetStop)}
                  </Text>
                  <TouchableOpacity
                    style={styles.iconCircleBtn}
                    onPress={dismissConfirmPickupBackToDetail}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="close" size={20} color={DARK} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.confirmSheetSubtitle}>{confirmPickupSubtitle(confirmSheetStop)}</Text>
                {confirmSheetCashPayment ? (
                  <View style={styles.cashPaymentNotice}>
                    <MaterialIcons name="payments" size={20} color="#92400E" />
                    <View style={styles.cashPaymentTextCol}>
                      <Text style={styles.cashPaymentTitle}>Receber em dinheiro</Text>
                      <Text style={styles.cashPaymentValue}>
                        {confirmSheetCashPayment.label}: {formatCurrencyCents(confirmSheetCashPayment.amountCents)}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.confirmSheetDivider} />
                {confirmSheetStop && requiresDriverEnteredPin(confirmSheetStop) ? (
                  <>
                    <Text style={styles.fieldLabel}>
                      {confirmSheetStop.stopType === 'passenger_pickup'
                        ? 'Código de embarque'
                        : confirmSheetStop.stopType === 'dependent_pickup'
                          ? 'Código de embarque do dependente'
                          : confirmSheetStop.stopType === 'dependent_dropoff'
                            ? 'Código do responsável no destino'
                            : confirmSheetStop.stopType === 'package_pickup'
                              ? isPackagePickupAtBase(confirmSheetStop)
                                ? 'Código informado pela base'
                                : 'Código de coleta'
                              : 'Código'}
                    </Text>
                    <TextInput
                      style={styles.codeInput}
                      value={confirmCode}
                      onChangeText={(v) => {
                        setConfirmCode(v.replace(/\D/g, '').slice(0, 4));
                        setConfirmError('');
                      }}
                      keyboardType="numeric"
                      maxLength={4}
                      placeholder="Ex: 1234"
                      placeholderTextColor="#9CA3AF"
                    />
                  </>
                ) : null}
                {isPackagePickupWithClientValidation(confirmSheetStop) ? (
                  <View style={styles.handoffCodeWrap}>
                    <Text style={styles.fieldLabel}>Código para informar ao cliente</Text>
                    <View style={styles.handoffCodeBox}>
                      <Text style={styles.handoffCodeText}>
                        {onlyDigits(confirmSheetStop?.code ?? '').length === 4
                          ? onlyDigits(confirmSheetStop?.code ?? '')
                          : '— — — —'}
                      </Text>
                    </View>
                    <Text style={styles.handoffCodeHint}>
                      Peça para o cliente digitar esse código no app dele. Quando ele confirmar,
                      toque no botão abaixo para avançar para a próxima parada.
                    </Text>
                  </View>
                ) : null}
                {confirmError ? <Text style={styles.errorText}>{confirmError}</Text> : null}
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => void handleConfirmStop()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>{confirmPickupButtonLabel(confirmSheetStop)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sheetBackBtn}
                  onPress={dismissConfirmPickupBackToDetail}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Voltar</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
        </View>
      ) : null}

      {/* ── Finalize Trip sheet ─────────────────────────────── */}
      {finalizeVisible ? (
        <View style={styles.fullScreenMapOverlay} accessibilityViewIsModal>
        <KeyboardAvoidingView style={styles.modalRoot} behavior="padding">
          <Pressable style={styles.overlayBackdrop} onPress={closeFinalize} />
          <Animated.View
            collapsable={false}
            style={[
              styles.detailSheet,
              styles.sheetAboveBackdrop,
              { transform: [{ translateY: finalizeSlide }], paddingBottom: effectiveBottomInset + 24 },
            ]}
          >
          <View style={styles.handle} />
          <View style={styles.finalizeTopRow}>
            <TouchableOpacity style={styles.iconCircleBtn} onPress={closeFinalize} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={DARK} />
            </TouchableOpacity>
            <Text style={styles.detailTitle}>Finalizar viagem</Text>
            <View style={styles.iconCircleBtn} />
          </View>

          <View style={styles.finalizeSummaryCard}>
            <View style={styles.finalizeSummaryRow}>
              <Text style={styles.finalizeSummaryLabel}>Tempo total</Text>
              <Text style={styles.finalizeSummaryValue}>
                {tripElapsedLabel}
              </Text>
            </View>
            <View style={styles.finalizeDivider} />
            <View style={styles.finalizeSummaryRow}>
              <Text style={styles.finalizeSummaryLabel}>Distância</Text>
              <Text style={styles.finalizeSummaryValue}>{tripTraveledDistanceLabel}</Text>
            </View>
            <View style={styles.finalizeDivider} />
            <View style={styles.finalizeSummaryRow}>
              <Text style={styles.finalizeSummaryLabel}>Status</Text>
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusBadgeText}>Concluído</Text>
              </View>
            </View>
            <View style={styles.finalizeDivider} />
            <View style={styles.finalizeSummaryRow}>
              <Text style={styles.finalizeSummaryLabel}>Total da corrida</Text>
              <Text style={styles.finalizeSummaryValue}>{completedTripEarningsLabel}</Text>
            </View>
            {totalCashToReceiveCents > 0 ? (
              <>
                <View style={styles.finalizeDivider} />
                <View style={styles.finalizeSummaryRow}>
                  <Text style={styles.finalizeSummaryLabel}>Dinheiro a receber</Text>
                  <Text style={styles.finalizeSummaryValue}>{formatCurrencyCents(totalCashToReceiveCents)}</Text>
                </View>
              </>
            ) : null}
          </View>

          <Text style={styles.expenseOptional}>Anexar despesas (opcional)</Text>
          <TouchableOpacity
            style={[styles.expenseBox, tripExpenseFiles.length > 0 && styles.expenseBoxAttached]}
            onPress={() => void handlePickTripExpenses()}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="add-photo-alternate"
              size={26}
              color={tripExpenseFiles.length > 0 ? GOLD : '#9CA3AF'}
            />
            <View style={styles.expenseTextCol}>
              <Text style={[styles.expenseText, tripExpenseFiles.length > 0 && { color: DARK, fontWeight: '600' }]}>
                Toque para escolher fotos dos comprovantes
              </Text>
              <Text style={styles.expenseHint}>Até 8 imagens (galeria)</Text>
            </View>
          </TouchableOpacity>
          {tripExpenseFiles.length > 0 ? (
            <View style={styles.expenseThumbsRow}>
              {tripExpenseFiles.map((f, idx) => (
                <View key={`${f.uri}-${idx}`} style={styles.expenseThumbWrap}>
                  <Image source={{ uri: f.uri }} style={styles.expenseThumbImg} />
                  <TouchableOpacity
                    style={styles.expenseThumbRemove}
                    onPress={() => removeTripExpenseAt(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnFullWidth, finalizingTrip && { opacity: 0.6 }]}
            onPress={handleFinalizeTrip}
            disabled={finalizingTrip}
            activeOpacity={0.85}
          >
            {finalizingTrip ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.actionBtnText}>Enviar e finalizar viagem</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
        </KeyboardAvoidingView>
        </View>
      ) : null}

      {/* ── Viagem concluída + avaliação (bottom sheet sobre o mapa) ─ */}
      {completedVisible ? (
        <View style={styles.fullScreenMapOverlay} accessibilityViewIsModal>
        <KeyboardAvoidingView style={styles.modalRoot} behavior="padding">
          <View style={styles.overlayBackdrop} />
          <Animated.View
            collapsable={false}
            style={[
              styles.completedBottomSheet,
              styles.sheetAboveBackdrop,
              {
                transform: [{ translateY: completedSlide }],
                paddingBottom: Math.max(effectiveBottomInset, 16) + 16,
              },
            ]}
          >
            <View style={styles.handle} />
            <ScrollView
              contentContainerStyle={styles.completedScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
            >
              <View style={styles.completedIconCircle}>
                <MaterialIcons name="check" size={40} color="#fff" />
              </View>
              <Text style={styles.completedTitle}>Viagem Concluída!</Text>
              <Text style={styles.completedSubtitle}>Todas as entregas foram realizadas com sucesso</Text>

              <View style={styles.completedStatsRow}>
                <View style={styles.completedStatItem}>
                  <Text style={styles.completedStatValue}>
                    {tripElapsedLabel}
                  </Text>
                  <Text style={styles.completedStatLabel}>Tempo total</Text>
                </View>
                <View style={styles.completedStatDivider} />
                <View style={styles.completedStatItem}>
                  <Text style={styles.completedStatValue}>{tripTraveledDistanceLabel}</Text>
                  <Text style={styles.completedStatLabel}>Distância percorrida</Text>
                </View>
                <View style={styles.completedStatDivider} />
                <View style={styles.completedStatItem}>
                  <Text style={styles.completedStatValue}>{completedTripEarningsLabel}</Text>
                  <Text style={styles.completedStatLabel}>Total recebido</Text>
                </View>
              </View>

              <Text style={styles.ratingQuestion}>Como foi a viagem?</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} onPress={() => setRating(star)} activeOpacity={0.7}>
                    <MaterialIcons
                      name={star <= rating ? 'star' : 'star-border'}
                      size={36}
                      color={star <= rating ? GOLD : '#D1D5DB'}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.ratingHint}>(1 = muito insatisfeito, 5 = muito satisfeito)</Text>

              <View style={styles.commentLabelRow}>
                <Text style={[styles.fieldLabel, styles.commentFieldLabel]}>Comentário</Text>
                <Text style={styles.commentOptionalTag}>Opcional</Text>
              </View>
              <TextInput
                style={styles.commentInput}
                value={ratingComment}
                onChangeText={setRatingComment}
                placeholder="Descreva algum comentário sobre a entrega..."
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnFullWidth, submittingRating && { opacity: 0.6 }]}
                onPress={handleSubmitRating}
                disabled={submittingRating}
                activeOpacity={0.85}
              >
                {submittingRating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.actionBtnText}>Enviar avaliação</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  /**
   * Cobre o mapa na mesma árvore RN (acima do MapView).
   * `Modal` transparente sobre Mapbox/SurfaceView no Android costuma não receber toques nos botões.
   */
  fullScreenMapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9000,
    ...(Platform.OS === 'android' ? { elevation: 9000 } : {}),
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  mapCoordsLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245,245,245,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  mapCoordsLoadingText: { fontSize: 14, color: '#6B7280' },

  // ── Map markers ──────────────────────────────────────────
  mapMarker: {
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
  mapMarkerOuter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapMarkerOuterGpsNext: {
    padding: 4,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: ROUTE_IMMEDIATE_LEG_COLOR,
    backgroundColor: 'rgba(255,255,255,0.96)',
  },

  // Driver marker
  driverPulse: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(17,24,39,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: DARK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },

  // ── My location button — lado esquerdo ───────────────────
  backBtn: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4,
  },

  zoomWrap: { position: 'absolute' },

  rerouteOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rerouteCard: {
    minWidth: 260,
    maxWidth: 340,
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  rerouteCardError: {
    backgroundColor: 'rgba(185, 28, 28, 0.96)',
  },
  rerouteCardWarning: {
    backgroundColor: 'rgba(217, 119, 6, 0.96)',
  },
  rerouteIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 12,
  },
  rerouteCardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  rerouteCardSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 6,
  },

  myLocationBtn: {
    position: 'absolute',
  },
  sdkFloatingBtn: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: DARK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },

  networkBadgeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // ── Right sidebar ─────────────────────────────────────────
  sidebar: {
    position: 'absolute',
    alignItems: 'center',
    gap: 6,
  },
  sidebarLine: {
    position: 'absolute',
    top: 22,
    bottom: 22,
    width: 2,
    backgroundColor: '#D1D5DB',
    zIndex: -1,
  },
  sidebarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  sidebarDestBtn: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
  },

  // ── Mini bottom sheet — card flutuante ────────────────────
  navNextBannerIntro: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  navNextBannerKicker: {
    fontSize: 11,
    fontWeight: '700',
    color: ROUTE_IMMEDIATE_LEG_COLOR,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  miniSheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  miniSheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stopTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FEF9C3',
    borderRadius: 20,
  },
  stopTypePillTrip: {
    backgroundColor: '#FEF3C7',
  },
  stopTypeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: GOLD,
  },
  stopTypePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    letterSpacing: 0.2,
  },
  etaBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  etaBadgeText: {
    color: DARK,
    fontSize: 14,
    fontWeight: '700',
  },
  miniSheetName: {
    fontSize: 21,
    fontWeight: '700',
    color: DARK,
    marginBottom: 6,
  },
  miniSheetOrderId: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginTop: -2,
    marginBottom: 6,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 0,
  },
  addressText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },
  miniSheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  progressBarContainer: {
    flex: 1,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: GOLD,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },

  // ── Finalize float button ────────────────────────────────
  finalizeFloatBtn: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: DARK,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  finalizeFloatBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Modal root (evita hit-test errado entre overlay e sheet no iOS) ──
  modalRoot: {
    flex: 1,
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 0,
  },
  sheetAboveBackdrop: {
    zIndex: 1,
    elevation: 40,
  },

  // ── Detail / Finalize sheet ───────────────────────────────
  detailSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  detailTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    flex: 1,
    textAlign: 'center',
  },
  iconCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailScroll: { paddingBottom: 16 },
  avatarCenter: { alignItems: 'center', marginBottom: 12 },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: '#fff', fontSize: 20, fontWeight: '700' },
  detailName: { fontSize: 20, fontWeight: '700', color: DARK, textAlign: 'center', marginBottom: 6 },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 20,
  },
  detailMetaText: { fontSize: 14, color: '#6B7280' },
  detailLabel: { fontSize: 12, color: '#9CA3AF', marginTop: 14, marginBottom: 4, fontWeight: '600' },
  detailValue: { fontSize: 15, color: DARK, fontWeight: '500' },
  deliveryArrowRow: { alignItems: 'center', marginBottom: 16 },
  deliveryNameText: { fontSize: 15, color: '#6B7280', textAlign: 'center' },
  actionBtn: {
    backgroundColor: DARK,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  /** Em ScrollView com `alignItems: 'center'`, força o botão à largura útil do sheet. */
  actionBtnFullWidth: { alignSelf: 'stretch', width: '100%' },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelBtnText: { color: '#EF4444', fontSize: 15, fontWeight: '600' },

  confirmSheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  confirmSheetTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    lineHeight: 24,
  },
  confirmSheetSubtitle: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 16 },
  cashPaymentNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  cashPaymentTextCol: { flex: 1 },
  cashPaymentTitle: { fontSize: 12, fontWeight: '800', color: '#92400E', textTransform: 'uppercase' },
  cashPaymentValue: { fontSize: 15, fontWeight: '800', color: DARK, marginTop: 2 },
  confirmSheetDivider: { height: 1, backgroundColor: '#F3F4F6', marginBottom: 16 },
  sheetBackBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#F3F4F6',
  },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 4 },
  /** Sem letterSpacing alto: no RN isso empurra o cursor para a direita mesmo com textAlign center. */
  codeInput: {
    alignSelf: 'center',
    width: 220,
    maxWidth: '100%',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 24,
    fontWeight: '700',
    color: DARK,
    letterSpacing: 0,
    backgroundColor: '#F9FAFB',
    marginBottom: 4,
    textAlign: 'center',
  },
  handoffCodeWrap: { marginBottom: 8 },
  handoffCodeBox: {
    alignSelf: 'center',
    minWidth: 180,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    paddingVertical: 14,
    paddingHorizontal: 22,
    marginBottom: 10,
  },
  handoffCodeText: {
    fontSize: 28,
    fontWeight: '800',
    color: DARK,
    textAlign: 'center',
    letterSpacing: 1,
  },
  handoffCodeHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 4,
  },
  errorText: { fontSize: 13, color: '#EF4444', marginTop: 4, marginBottom: 4, textAlign: 'center' },

  // ── Finalize summary card ─────────────────────────────────
  finalizeSummaryCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    marginTop: 12,
  },
  finalizeSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  finalizeSummaryLabel: { fontSize: 14, color: '#6B7280' },
  finalizeSummaryValue: { fontSize: 15, fontWeight: '700', color: DARK },
  finalizeDivider: { height: 1, backgroundColor: '#F3F4F6' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },
  statusBadgeText: { fontSize: 14, fontWeight: '600', color: '#166534' },
  expenseBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
  },
  expenseBoxAttached: { borderColor: GOLD },
  expenseText: { fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  expenseTextCol: { flex: 1, gap: 4, minWidth: 0 },
  expenseHint: { fontSize: 12, color: '#9CA3AF' },
  expenseThumbsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
    marginTop: 4,
  },
  expenseThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  expenseThumbImg: { width: '100%', height: '100%' },
  expenseThumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseOptional: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 4,
  },

  finalizeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  // ── Viagem concluída (bottom sheet) ───────────────────────
  completedBottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 8,
    maxHeight: '88%',
  },
  completedScroll: { paddingBottom: 24, paddingTop: 16, alignItems: 'center' },
  completedIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  completedTitle: { fontSize: 26, fontWeight: '700', color: DARK, marginBottom: 8, textAlign: 'center' },
  completedSubtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 28, lineHeight: 22 },
  completedStatsRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 28,
    width: '100%',
  },
  completedStatItem: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  completedStatValue: { fontSize: 16, fontWeight: '700', color: DARK, marginBottom: 4 },
  completedStatLabel: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
  completedStatDivider: { width: 1, backgroundColor: '#E5E7EB' },
  ratingQuestion: { fontSize: 17, fontWeight: '700', color: DARK, marginBottom: 12, textAlign: 'center' },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  ratingHint: { fontSize: 12, color: '#9CA3AF', marginBottom: 20, textAlign: 'center' },
  commentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 6,
    marginTop: 4,
  },
  commentFieldLabel: { marginTop: 0, marginBottom: 0 },
  commentOptionalTag: { fontSize: 12, color: '#9CA3AF', fontWeight: '500' },
  commentInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: DARK,
    minHeight: 100,
    backgroundColor: '#F9FAFB',
    marginBottom: 20,
  },
});
