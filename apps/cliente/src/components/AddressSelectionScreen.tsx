import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddressAutocomplete } from './AddressAutocomplete';
import { WhenTimeSheets } from './WhenTimeSheets';
import { MapboxMap, MapboxMarker, MapboxPolyline } from './mapbox';
import type { MapRegion } from './mapbox';
import { useOriginLocation } from '../hooks/useOriginLocation';
import { useWhenTimeSelection, type WhenTimeResult } from '../hooks/useWhenTimeSelection';
import { useRecentDestinationsSorted } from '../hooks/useRecentDestinationsSorted';
import { distanceKm, formatDistanceKm, type AddressSuggestion } from '../lib/location';
import { getRoutePolyline, type RoutePoint } from '../lib/route';
import { formatRecentDestinationDisplay } from '../lib/recentDestinations';
import { useAppAlert } from '../contexts/AppAlertContext';
import { MAPBOX_DESTINATION_MARKER_COLOR, MAPBOX_ORIGIN_MARKER_COLOR } from '@take-me/shared';

export type SelectedPlaces = {
  origin: { address: string; latitude: number; longitude: number; city?: string };
  destination: { address: string; latitude: number; longitude: number };
};

export type InitialDestinationParam = {
  address: string;
  city?: string;
  latitude?: number;
  longitude?: number;
};

type Props = {
  title: string;
  /** Vindo da home (destinos recentes): mesmo UI que abrir «Viagens», já com destino. */
  initialDestination?: InitialDestinationParam;
  onConfirm: (places: SelectedPlaces, when: WhenTimeResult) => void;
  onGoBack: () => void;
  extractOriginCity?: boolean;
  showRecentDestinations?: boolean;
  renderExtraPills?: () => ReactNode;
  /** Conteúdo extra abaixo dos endereços (ex.: lista de viagens). `when` reflete Agora vs agendamento. */
  renderResults?: (places: SelectedPlaces, when: WhenTimeResult) => ReactNode;
  /** Texto do botão fixo inferior (padrão: "Continuar"). Útil quando há lista de viagens. */
  continueBottomLabel?: string;
  /** Quando true, o botão inferior não é exibido (ex.: lista de viagens carregando ou aguardando seleção). */
  continueBottomHidden?: boolean;
  /** Se definido, substitui o fluxo padrão de `onConfirm` ao tocar no botão inferior. */
  onContinuePressOverride?: () => void;
  destinationPlaceholder?: string;
  whenTitle?: string;
  nowSubtitle?: string;
  laterSubtitle?: string;
};

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.38);
const DEFAULT_DEST_COORDS = { latitude: -7.3305, longitude: -35.3335 };

export function AddressSelectionScreen({
  title,
  initialDestination,
  onConfirm,
  onGoBack,
  extractOriginCity = false,
  showRecentDestinations = true,
  renderExtraPills,
  renderResults,
  continueBottomLabel,
  continueBottomHidden = false,
  onContinuePressOverride,
  destinationPlaceholder = 'Para onde?',
  whenTitle,
  nowSubtitle,
  laterSubtitle,
}: Props) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();
  const origin = useOriginLocation({ extractCity: extractOriginCity });
  const when = useWhenTimeSelection();
  const { sortedRecentDestinations, saveRecentDestination } = useRecentDestinationsSorted(
    origin.originLat,
    origin.originLng,
  );

  const [destinationText, setDestinationText] = useState('');
  const [destinationLat, setDestinationLat] = useState(DEFAULT_DEST_COORDS.latitude);
  const [destinationLng, setDestinationLng] = useState(DEFAULT_DEST_COORDS.longitude);
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [routeCoords, setRouteCoords] = useState<RoutePoint[] | null>(null);

  const [editingOrigin, setEditingOrigin] = useState(false);
  const [editOriginText, setEditOriginText] = useState('');
  const appliedInitialDestinationRef = useRef(false);

  // Destino pré-preenchido (ex.: toque num recente na home) — uma vez por montagem do ecrã.
  useEffect(() => {
    if (!initialDestination || appliedInitialDestinationRef.current) return;
    appliedInitialDestinationRef.current = true;
    const { address, city, latitude, longitude } = initialDestination;
    const text = [address?.trim(), city?.trim()].filter(Boolean).join(', ') || address;
    setDestinationText(text);
    if (latitude != null && longitude != null) {
      setDestinationLat(latitude);
      setDestinationLng(longitude);
      setDestinationConfirmed(true);
    } else {
      setDestinationConfirmed(false);
    }
  }, [initialDestination]);

  // Buscar rota real quando destino é confirmado
  useEffect(() => {
    if (!destinationConfirmed) {
      setRouteCoords(null);
      return;
    }
    let cancelled = false;
    getRoutePolyline(
      { latitude: origin.originLat, longitude: origin.originLng },
      { latitude: destinationLat, longitude: destinationLng },
    ).then((coords) => {
      if (!cancelled) setRouteCoords(coords);
    });
    return () => { cancelled = true; };
  }, [origin.originLat, origin.originLng, destinationLat, destinationLng, destinationConfirmed]);

  const mapRegion: MapRegion = useMemo(() => {
    if (destinationConfirmed) {
      const midLat = (origin.originLat + destinationLat) / 2;
      const midLng = (origin.originLng + destinationLng) / 2;
      const dLat = Math.abs(origin.originLat - destinationLat) * 1.8 || 0.05;
      const dLng = Math.abs(origin.originLng - destinationLng) * 1.8 || 0.05;
      return { latitude: midLat, longitude: midLng, latitudeDelta: Math.max(dLat, 0.02), longitudeDelta: Math.max(dLng, 0.02) };
    }
    return { latitude: origin.originLat, longitude: origin.originLng, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }, [origin.originLat, origin.originLng, destinationLat, destinationLng, destinationConfirmed]);

  const selectedPlaces: SelectedPlaces | null = useMemo(() => {
    if (!destinationConfirmed) return null;
    return {
      origin: {
        address: origin.originAddress,
        latitude: origin.originLat,
        longitude: origin.originLng,
        ...(origin.originCityTag ? { city: origin.originCityTag } : {}),
      },
      destination: { address: destinationText, latitude: destinationLat, longitude: destinationLng },
    };
  }, [destinationConfirmed, origin, destinationText, destinationLat, destinationLng]);

  const handleDestinationChange = useCallback((text: string) => {
    setDestinationText(text);
    setDestinationConfirmed(false);
  }, []);

  const handleDestinationSelect = useCallback((place: AddressSuggestion) => {
    setDestinationText(place.address);
    setDestinationLat(place.latitude);
    setDestinationLng(place.longitude);
    setDestinationConfirmed(true);
  }, []);

  const handleContinue = useCallback(() => {
    if (!destinationConfirmed) {
      showAlert('Atenção', 'Selecione o destino a partir das sugestões.');
      return;
    }
    const city = destinationText.includes(', ')
      ? destinationText.split(', ').slice(-1)[0] ?? destinationText
      : destinationText;
    saveRecentDestination({ address: destinationText, city, latitude: destinationLat, longitude: destinationLng });
    onConfirm(
      {
        origin: {
          address: origin.originAddress,
          latitude: origin.originLat,
          longitude: origin.originLng,
          ...(origin.originCityTag ? { city: origin.originCityTag } : {}),
        },
        destination: { address: destinationText, latitude: destinationLat, longitude: destinationLng },
      },
      when.getResult(),
    );
  }, [destinationConfirmed, destinationText, destinationLat, destinationLng, origin, when, saveRecentDestination, onConfirm, showAlert]);

  const handleBottomPress = useCallback(() => {
    if (onContinuePressOverride) {
      onContinuePressOverride();
      return;
    }
    handleContinue();
  }, [onContinuePressOverride, handleContinue]);

  const handleRecentSelect = useCallback(
    (address: string, lat: number, lng: number) => {
      setDestinationText(address);
      setDestinationLat(lat);
      setDestinationLng(lng);
      setDestinationConfirmed(true);
    },
    [],
  );

  const toggleEditOrigin = useCallback(() => {
    if (editingOrigin) {
      setEditingOrigin(false);
    } else {
      setEditOriginText('');
      setEditingOrigin(true);
    }
  }, [editingOrigin]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" translucent />

      {/* Map background */}
      <View style={[styles.mapContainer, { height: MAP_HEIGHT + insets.top }]}>
        {/*
         * Antes da localização real chegar, o mapa renderizava no placeholder
         * (Campina Grande/PB) e "saltava" para a posição do usuário em ~2-5s.
         * Cobrimos com um overlay opaco enquanto `originReady === false` —
         * o pin de origem só aparece depois que as coords reais foram aplicadas.
         */}
        <MapboxMap
          style={styles.map}
          initialRegion={mapRegion}
          scrollEnabled
          showControls={false}
        >
          {origin.originReady && (
            <MapboxMarker
              id="origin-pin"
              coordinate={{ latitude: origin.originLat, longitude: origin.originLng }}
              pinColor={MAPBOX_ORIGIN_MARKER_COLOR}
            />
          )}
          {destinationConfirmed && (
            <>
              <MapboxMarker
                id="dest-pin"
                coordinate={{ latitude: destinationLat, longitude: destinationLng }}
                pinColor={MAPBOX_DESTINATION_MARKER_COLOR}
              />
              {routeCoords && routeCoords.length >= 2 && (
                <MapboxPolyline coordinates={routeCoords} strokeWidth={4} />
              )}
            </>
          )}
        </MapboxMap>

        {!origin.originReady && (
          <View pointerEvents="none" style={styles.mapLoadingOverlay}>
            <View style={styles.mapLoadingChip}>
              <ActivityIndicator size="small" color="#FFFFFF" style={styles.mapLoadingSpinner} />
              <Text style={styles.mapLoadingText}>Obtendo sua localização…</Text>
            </View>
          </View>
        )}

        {/* Back button floating on map */}
        <TouchableOpacity
          style={[styles.mapBackButton, { top: insets.top + 8 }]}
          onPress={onGoBack}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={22} color={COLORS.black} />
        </TouchableOpacity>
      </View>

      {/* Content card overlapping map */}
      <View style={styles.cardContainer}>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              continueBottomHidden && { paddingBottom: Math.max(insets.bottom, 24) },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
              <View style={styles.pillsRow}>
                <TouchableOpacity style={styles.pill} onPress={when.openWhenSheet} activeOpacity={0.8}>
                  <MaterialIcons name="schedule" size={16} color={COLORS.black} />
                  <Text style={styles.pillText}>{when.whenLabel}</Text>
                  <MaterialIcons name="keyboard-arrow-down" size={16} color={COLORS.black} />
                </TouchableOpacity>
                {renderExtraPills?.()}
              </View>
            </View>

            {/* Route card */}
            <View style={styles.routeCard}>
              <View style={styles.routeIcons}>
                <View style={styles.originDotOuter}><View style={styles.originDotInner} /></View>
                <View style={styles.routeLine} />
                <View style={styles.destSquare} />
              </View>
              <View style={styles.routeFields}>
                {editingOrigin ? (
                  <View style={styles.originEditWrap}>
                    <AddressAutocomplete
                      value={editOriginText}
                      onChangeText={setEditOriginText}
                      onSelectPlace={(place) => {
                        origin.setOriginFromAutocomplete(place);
                        setEditOriginText(place.address);
                        setEditingOrigin(false);
                      }}
                      placeholder="Digite o ponto de partida"
                      autoFocus
                      style={styles.originAutocomplete}
                      inputStyle={styles.originInput}
                    />
                  </View>
                ) : (
                  <TouchableOpacity style={styles.originReadOnly} onPress={toggleEditOrigin} activeOpacity={0.7}>
                    <Text style={styles.originText} numberOfLines={1}>{origin.originAddress}</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.fieldDivider} />
                <View style={[styles.destinationWrap, editingOrigin && styles.destinationWrapLowZ]}>
                  <AddressAutocomplete
                    value={destinationText}
                    onChangeText={handleDestinationChange}
                    onSelectPlace={handleDestinationSelect}
                    placeholder={destinationPlaceholder}
                    autoFocus={!editingOrigin}
                    style={styles.destAutocomplete}
                    inputStyle={styles.destInput}
                  />
                </View>
              </View>
              <TouchableOpacity
                style={styles.editOriginIcon}
                onPress={toggleEditOrigin}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialIcons name={editingOrigin ? 'close' : 'edit'} size={18} color={COLORS.neutral700} />
              </TouchableOpacity>
            </View>

            {/* My location */}
            <TouchableOpacity
              style={styles.myLocationButton}
              onPress={origin.useMyLocationForOrigin}
              disabled={origin.locationLoading}
              activeOpacity={0.8}
            >
              {origin.locationLoading ? (
                <ActivityIndicator size="small" color={COLORS.black} />
              ) : (
                <MaterialIcons name="my-location" size={16} color={COLORS.black} />
              )}
              <Text style={styles.myLocationText}>Minha localização</Text>
            </TouchableOpacity>

            {/* Recent destinations — antes da lista de viagens para não ficar entre lista e o rodapé */}
            {showRecentDestinations && sortedRecentDestinations.length > 0 && (
              <View style={styles.recentsSection}>
                <Text style={styles.recentsTitle}>Destinos recentes</Text>
                {sortedRecentDestinations.map((item, index) => {
                  const dist = distanceKm(origin.originLat, origin.originLng, item.latitude, item.longitude);
                  const distLabel = dist != null ? formatDistanceKm(dist) : null;
                  const { line1, line2 } = formatRecentDestinationDisplay(item);
                  return (
                    <TouchableOpacity
                      key={index}
                      style={styles.recentRow}
                      onPress={() => handleRecentSelect(item.address, item.latitude ?? -7.33, item.longitude ?? -35.33)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.recentIconWrap}>
                        <MaterialIcons name="access-time" size={22} color={COLORS.black} />
                        {distLabel != null && <Text style={styles.recentDistance} numberOfLines={1}>{distLabel}</Text>}
                      </View>
                      <View style={styles.recentTextWrap}>
                        <Text style={styles.recentLine1} numberOfLines={1}>{line1}</Text>
                        <Text style={styles.recentLine2} numberOfLines={1}>{line2}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Results (viagens disponíveis, etc.) */}
            {renderResults && selectedPlaces && renderResults(selectedPlaces, when.getResult())}
          </ScrollView>

          {/* Continue button */}
          {!continueBottomHidden && (
            <View style={[styles.bottomButtonWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              <TouchableOpacity
                style={[styles.continueButton, !destinationConfirmed && styles.continueButtonDisabled]}
                onPress={handleBottomPress}
                disabled={!destinationConfirmed}
                activeOpacity={0.8}
              >
                <Text style={styles.continueButtonText}>{continueBottomLabel ?? 'Continuar'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </View>

      <WhenTimeSheets state={when} whenTitle={whenTitle} nowSubtitle={nowSubtitle} laterSubtitle={laterSubtitle} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },

  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  map: { flex: 1 },
  mapBackButton: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLoadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.9)',
  },
  mapLoadingSpinner: { marginRight: 8 },
  mapLoadingText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },

  cardContainer: {
    flex: 1,
    marginTop: MAP_HEIGHT - 16,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    marginBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, flex: 1 },
  pillsRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.neutral300,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 4,
  },
  pillText: { fontSize: 13, fontWeight: '500', color: COLORS.black },

  routeCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.neutral300,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    overflow: 'visible',
    zIndex: 20,
  },
  routeIcons: { alignItems: 'center', marginRight: 14, paddingTop: 14 },
  originDotOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  originDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.black },
  routeLine: { width: 2, flex: 1, backgroundColor: COLORS.neutral400, marginVertical: 4 },
  destSquare: { width: 12, height: 12, backgroundColor: COLORS.black, borderRadius: 2 },

  routeFields: { flex: 1, overflow: 'visible' },
  originEditWrap: { zIndex: 20, position: 'relative' },
  originReadOnly: { paddingVertical: 12 },
  originText: { fontSize: 15, color: COLORS.black },
  originAutocomplete: { marginBottom: 0 },
  originInput: {
    fontSize: 15,
    color: COLORS.black,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 0,
  },
  fieldDivider: { height: 1, backgroundColor: COLORS.neutral400, marginVertical: 4 },
  destinationWrap: { zIndex: 10, position: 'relative' },
  destinationWrapLowZ: { zIndex: 1 },
  destAutocomplete: { marginBottom: 0 },
  destInput: {
    fontSize: 15,
    color: COLORS.black,
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  editOriginIcon: { paddingTop: 14, paddingLeft: 8 },

  myLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  myLocationText: { fontSize: 13, fontWeight: '500', color: COLORS.black },

  recentsSection: { marginTop: 8 },
  recentsTitle: { fontSize: 14, fontWeight: '600', color: COLORS.neutral700, marginBottom: 12 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  recentIconWrap: { alignItems: 'center', width: 48 },
  recentDistance: { fontSize: 11, color: COLORS.neutral700, marginTop: 2 },
  recentTextWrap: { flex: 1, marginLeft: 4 },
  recentLine1: { fontSize: 15, fontWeight: '500', color: COLORS.black },
  recentLine2: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },

  bottomButtonWrap: { paddingHorizontal: 24 },
  continueButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonDisabled: { opacity: 0.4 },
  continueButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
