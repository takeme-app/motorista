import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, Modal, Pressable, Animated, ActivityIndicator, Image } from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TripStackParamList } from '../../navigation/types';
import { AddressAutocomplete } from '../../components/AddressAutocomplete';
import { distanceKm, formatDistanceKm, getCurrentPlace, type AddressSuggestion } from '../../lib/location';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useCurrentLocation } from '../../contexts/CurrentLocationContext';
import { formatRecentDestinationDisplay } from '../../lib/recentDestinations';
import { useRecentDestinationsSorted } from '../../hooks/useRecentDestinationsSorted';
import {
  toISODate,
  parseTimeSlotRange,
  toISODateFromUtcIso,
  getDateCarouselOptions,
} from '../../lib/dateTimeSlots';
import {
  loadClientScheduledTrips,
  compareTripsByDepartureAndBadge,
  tripFitsPassengersAndBags,
} from '../../lib/clientScheduledTrips';
import { formatDriverRatingLabel, formatTripFareBrl } from '../../lib/tripDriverDisplay';
import type { ScheduledTripItem } from './SearchTripScreen';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Place = { address: string; latitude: number; longitude: number };

const DEFAULT_ORIGIN: Place = {
  address: 'Rua Rego Freitas, 370',
  latitude: -7.3289,
  longitude: -35.3328,
};
const DEFAULT_DESTINATION_COORDS = { latitude: -7.3305, longitude: -35.3335 };
const TIME_SHEET_SLIDE = 450;
const PLAN_RIDE_DAY_OPTIONS = getDateCarouselOptions();
const ROUTE_MATCH_DEGREES = 0.15;
const LIST_PASSENGERS = 1;
const LIST_BAGS = 0;

type Props = NativeStackScreenProps<TripStackParamList, 'PlanRide'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

export function PlanRideScreen({ navigation, route }: Props) {
  const { showAlert } = useAppAlert();
  const { currentPlace, refreshLocation } = useCurrentLocation();
  const [origin, setOrigin] = useState<Place>(() => {
    const o = route.params?.origin;
    if (o && o.latitude != null && o.longitude != null) return { address: o.address, latitude: o.latitude, longitude: o.longitude };
    return DEFAULT_ORIGIN;
  });
  const [destination, setDestination] = useState<Place | null>(() => {
    const d = route.params?.destination;
    if (!d?.address) return null;
    return { address: d.address, latitude: d.latitude ?? DEFAULT_DESTINATION_COORDS.latitude, longitude: d.longitude ?? DEFAULT_DESTINATION_COORDS.longitude };
  });
  const [destinationText, setDestinationText] = useState(() => route.params?.destination?.address ?? '');
  const [destinationConfirmed, setDestinationConfirmed] = useState(() => Boolean(route.params?.destination?.address));
  const destinationReady = destinationConfirmed && destination != null && destination.address.length > 0;
  const { sortedRecentDestinations, saveRecentDestination } = useRecentDestinationsSorted(
    origin.latitude,
    origin.longitude,
  );
  const scheduledDateId = route.params?.scheduledDateId;
  const scheduledTimeSlot = route.params?.scheduledTimeSlot ?? null;
  const [dateLabel, setDateLabel] = useState(() => {
    if (scheduledDateId && scheduledTimeSlot) {
      const d = new Date(scheduledDateId + 'T12:00:00');
      const pt = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
      return `${pt} · ${scheduledTimeSlot.split(' - ')[0]}`;
    }
    if (scheduledDateId) {
      const d = new Date(scheduledDateId + 'T12:00:00');
      return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    const today = new Date();
    return today.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  });
  /** Data e horário usados para filtrar a lista: vêm dos params ou da seleção no sheet. */
  const [filterDateId, setFilterDateId] = useState<string>(() => scheduledDateId ?? toISODate(new Date()));
  const [filterTimeSlot, setFilterTimeSlot] = useState<string | null>(() => scheduledTimeSlot ?? null);
  const [timeSheetVisible, setTimeSheetVisible] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>(() => toISODate(new Date()));
  const timeSheetOverlayOpacity = useRef(new Animated.Value(0)).current;
  const timeSheetTranslateY = useRef(new Animated.Value(TIME_SHEET_SLIDE)).current;

  const [allScheduledTrips, setAllScheduledTrips] = useState<ScheduledTripItem[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const [editingOrigin, setEditingOrigin] = useState(false);
  const [editOriginText, setEditOriginText] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);

  // Quando não há origin nos params, usar localização pré-carregada do contexto (ou buscar) como origem padrão
  useEffect(() => {
    const o = route.params?.origin;
    if (o && o.latitude != null && o.longitude != null) return;
    if (currentPlace) {
      setOrigin({ address: currentPlace.address, latitude: currentPlace.latitude, longitude: currentPlace.longitude });
    } else {
      getCurrentPlace().then((place) => {
        if (place) setOrigin({ address: place.address, latitude: place.latitude, longitude: place.longitude });
      });
    }
  }, [route.params?.origin, currentPlace?.latitude, currentPlace?.longitude, currentPlace?.address]);

  const effectiveDestination = destinationConfirmed && destination ? destination : null;

  useEffect(() => {
    setSelectedTripId(null);
  }, [origin.latitude, origin.longitude, effectiveDestination?.latitude, effectiveDestination?.longitude]);

  useEffect(() => {
    setSelectedTripId(null);
  }, [filterDateId, filterTimeSlot]);

  useEffect(() => {
    if (!timeSheetVisible) return;
    timeSheetOverlayOpacity.setValue(0);
    timeSheetTranslateY.setValue(TIME_SHEET_SLIDE);
    Animated.sequence([
      Animated.timing(timeSheetOverlayOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(timeSheetTranslateY, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [timeSheetVisible]);

  /** Lista filtrada por ponto de partida, destino e data/hora. Só exibe viagens quando origem e destino estão definidos. */
  const scheduledTrips = useMemo(() => {
    if (!origin?.latitude || !origin?.longitude || !effectiveDestination?.latitude || !effectiveDestination?.longitude) return [];
    const oLat = origin.latitude;
    const oLng = origin.longitude;
    const dLat = effectiveDestination.latitude;
    const dLng = effectiveDestination.longitude;
    let list = allScheduledTrips.filter(
      (t) =>
        Math.abs(t.origin_lat - oLat) <= ROUTE_MATCH_DEGREES &&
        Math.abs(t.origin_lng - oLng) <= ROUTE_MATCH_DEGREES &&
        Math.abs(t.latitude - dLat) <= ROUTE_MATCH_DEGREES &&
        Math.abs(t.longitude - dLng) <= ROUTE_MATCH_DEGREES &&
        tripFitsPassengersAndBags(t, LIST_PASSENGERS, LIST_BAGS)
    );
    if (filterDateId && list.length > 0) {
      list = list.filter((t) => {
        if (!t.departure_at) return false;
        const tripDate = toISODateFromUtcIso(t.departure_at);
        if (tripDate !== filterDateId) return false;
        if (filterTimeSlot) {
          const slot = parseTimeSlotRange(filterTimeSlot);
          if (!slot) return true;
          const dep = new Date(t.departure_at);
          const depMinutes = dep.getHours() * 60 + dep.getMinutes();
          return depMinutes >= slot.startMinutes && depMinutes < slot.endMinutes;
        }
        return true;
      });
    }
    return [...list].sort(compareTripsByDepartureAndBadge);
  }, [allScheduledTrips, origin?.latitude, origin?.longitude, effectiveDestination?.latitude, effectiveDestination?.longitude, filterDateId, filterTimeSlot]);

  useEffect(() => {
    let cancelled = false;
    setTripsLoading(true);
    setTripsError(null);
    (async () => {
      const { items, error } = await loadClientScheduledTrips();
      if (cancelled) return;
      if (error) {
        setTripsError(error);
        setAllScheduledTrips([]);
      } else {
        setAllScheduledTrips(items);
      }
      setTripsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleEditOrigin = useCallback(() => {
    if (editingOrigin) {
      setEditingOrigin(false);
    } else {
      setEditOriginText('');
      setEditingOrigin(true);
    }
  }, [editingOrigin]);

  const handleDestinationChange = useCallback((text: string) => {
    setDestinationText(text);
    setDestinationConfirmed(false);
    setSelectedTripId(null);
  }, []);

  const handleDestinationSelect = useCallback(
    (place: AddressSuggestion) => {
      setDestinationText(place.address);
      setDestination({ address: place.address, latitude: place.latitude, longitude: place.longitude });
      setDestinationConfirmed(true);
      setSelectedTripId(null);
      const city = place.city ?? (place.address.includes(', ')
        ? place.address.split(', ').slice(-1)[0] ?? place.address
        : place.address);
      void saveRecentDestination({
        address: place.address,
        city,
        latitude: place.latitude,
        longitude: place.longitude,
      });
    },
    [saveRecentDestination],
  );

  const handleRecentSelect = useCallback((address: string, lat: number, lng: number) => {
    setDestinationText(address);
    setDestination({ address, latitude: lat, longitude: lng });
    setDestinationConfirmed(true);
    setSelectedTripId(null);
  }, []);

  const useMyLocationForOrigin = async () => {
    setLocationLoading(true);
    try {
      const place = await refreshLocation();
      if (place) {
        setOrigin({ address: place.address, latitude: place.latitude, longitude: place.longitude });
        setEditOriginText(place.address);
        setEditingOrigin(false);
      } else {
        showAlert('Localização', 'Não foi possível usar sua localização. Verifique se o app tem permissão nas configurações.');
      }
    } catch {
      showAlert('Localização', 'Não foi possível obter seu endereço. Tente novamente.');
    } finally {
      setLocationLoading(false);
    }
  };

  const openTimeSheet = () => {
    setSelectedDay(filterDateId || toISODate(new Date()));
    timeSheetOverlayOpacity.setValue(0);
    timeSheetTranslateY.setValue(TIME_SHEET_SLIDE);
    setTimeSheetVisible(true);
  };

  const closeTimeSheet = () => {
    timeSheetOverlayOpacity.setValue(0);
    timeSheetTranslateY.setValue(TIME_SHEET_SLIDE);
    setTimeSheetVisible(false);
  };

  const handleSelectTime = () => {
    const d = new Date(selectedDay + 'T12:00:00');
    const pt = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    setDateLabel(pt);
    setFilterDateId(selectedDay);
    setFilterTimeSlot(null);
    setSelectedTripId(null);
    closeTimeSheet();
  };

  const handleAgendar = useCallback(() => {
    if (!selectedTripId) return;
    const trip = scheduledTrips.find((t) => t.id === selectedTripId);
    if (!trip || !effectiveDestination) return;
    // Janela mínima de 30min antes da partida (alinha com PendingRequestsScreen do motorista).
    if (trip.departure_at) {
      const minutesUntilDeparture = (new Date(trip.departure_at).getTime() - Date.now()) / 60000;
      if (minutesUntilDeparture < 30) {
        showAlert(
          'Viagem muito próxima',
          'Esta viagem sai em menos de 30 minutos. Para dar tempo do motorista aceitar, escolha uma viagem com pelo menos 30 minutos de antecedência.',
        );
        return;
      }
    }
    navigation.navigate('ConfirmDetails', {
      scheduled_trip_id: trip.id,
      origin: { address: origin.address, latitude: origin.latitude, longitude: origin.longitude },
      destination: {
        address: effectiveDestination.address,
        latitude: effectiveDestination.latitude,
        longitude: effectiveDestination.longitude,
      },
      driver: {
        id: trip.id,
        driver_id: trip.driver_id,
        name: trip.driverName,
        rating: trip.rating,
        badge: trip.badge,
        departure: trip.departure,
        arrival: trip.arrival,
        seats: trip.seats,
        bags: trip.bags,
        amount_cents: trip.amount_cents ?? 0,
        vehicle_model: trip.vehicle_model,
        vehicle_year: trip.vehicle_year,
        vehicle_plate: trip.vehicle_plate,
        avatar_url: trip.driverAvatarUrl,
      },
      immediateTrip: false,
      scheduledTripDepartureAt: trip.departure_at,
    });
  }, [selectedTripId, scheduledTrips, effectiveDestination, origin, navigation, showAlert]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Planeje sua corrida</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.dateRow} onPress={openTimeSheet} activeOpacity={0.8}>
          <MaterialIcons name="event" size={24} color={COLORS.black} />
          <Text style={styles.dateText}>{dateLabel}</Text>
          <MaterialIcons name="keyboard-arrow-down" size={24} color={COLORS.black} />
        </TouchableOpacity>

        {/* Card de rota — mesmo padrão visual da tela "Agora" (AddressSelectionScreen) */}
        <View style={styles.routeCard}>
          <View style={styles.routeIcons}>
            <View style={styles.originDotOuter}>
              <View style={styles.originDotInner} />
            </View>
            <View style={styles.routeConnectorLine} />
            <View style={styles.destSquare} />
          </View>
          <View style={styles.routeFields}>
            {editingOrigin ? (
              <View style={styles.originEditWrap}>
                <AddressAutocomplete
                  value={editOriginText}
                  onChangeText={setEditOriginText}
                  onSelectPlace={(place) => {
                    setOrigin({ address: place.address, latitude: place.latitude, longitude: place.longitude });
                    setEditOriginText(place.address);
                    setEditingOrigin(false);
                    setSelectedTripId(null);
                  }}
                  placeholder="Digite o ponto de partida"
                  autoFocus
                  style={styles.originAutocomplete}
                  inputStyle={styles.originInput}
                />
              </View>
            ) : (
              <TouchableOpacity style={styles.originReadOnly} onPress={toggleEditOrigin} activeOpacity={0.7}>
                <Text style={styles.originText} numberOfLines={1}>{origin.address}</Text>
              </TouchableOpacity>
            )}
            <View style={styles.fieldDivider} />
            <View style={[styles.destinationWrap, editingOrigin && styles.destinationWrapLowZ]}>
              <AddressAutocomplete
                value={destinationText}
                onChangeText={handleDestinationChange}
                onSelectPlace={handleDestinationSelect}
                placeholder="Para onde?"
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

        <TouchableOpacity
          style={styles.myLocationButton}
          onPress={useMyLocationForOrigin}
          disabled={locationLoading}
          activeOpacity={0.8}
        >
          {locationLoading ? (
            <ActivityIndicator size="small" color={COLORS.black} />
          ) : (
            <MaterialIcons name="my-location" size={16} color={COLORS.black} />
          )}
          <Text style={styles.myLocationText}>Minha localização</Text>
        </TouchableOpacity>

        <Text style={styles.roundTripHint}>
          Ida e volta: faça uma reserva para cada trecho (volta em outro horário ou dia), conforme as viagens ofertadas pelo motorista.
        </Text>

        {sortedRecentDestinations.length > 0 && (
          <View style={styles.recentsSection}>
            <Text style={styles.recentsTitle}>Destinos recentes</Text>
            {sortedRecentDestinations.map((item, index) => {
              const dist = distanceKm(origin.latitude, origin.longitude, item.latitude, item.longitude);
              const distLabel = dist != null ? formatDistanceKm(dist) : null;
              const { line1, line2 } = formatRecentDestinationDisplay(item);
              return (
                <TouchableOpacity
                  key={`${item.address}-${index}`}
                  style={styles.recentRow}
                  onPress={() => handleRecentSelect(item.address, item.latitude ?? DEFAULT_DESTINATION_COORDS.latitude, item.longitude ?? DEFAULT_DESTINATION_COORDS.longitude)}
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

        {/* Lista filtrada por partida, destino e horário — seleção obrigatória para Agendar */}
        {tripsLoading && (
          <View style={styles.tripsLoadingWrap}>
            <ActivityIndicator size="large" color={COLORS.black} />
            <Text style={styles.tripsLoadingText}>Carregando viagens...</Text>
          </View>
        )}
        {!tripsLoading && tripsError != null && (
          <Text style={styles.tripsErrorText}>{tripsError}</Text>
        )}
        {!tripsLoading && !tripsError && scheduledTrips.length === 0 && (
          <Text style={styles.tripsEmptyText}>
            {!destinationReady ? 'Defina origem e destino para ver viagens disponíveis.' : 'Nenhuma viagem encontrada para esta rota e data.'}
          </Text>
        )}
        {!tripsLoading && scheduledTrips.map((trip) => (
          <TouchableOpacity
            key={trip.id}
            style={[styles.tripCard, selectedTripId === trip.id && styles.tripCardSelected]}
            onPress={() => setSelectedTripId(trip.id)}
            activeOpacity={0.8}
          >
            <View style={styles.tripCardTopRow}>
              {trip.driverAvatarUrl ? (
                <Image source={{ uri: trip.driverAvatarUrl }} style={styles.tripCardAvatar} />
              ) : (
                <View style={[styles.tripCardAvatar, styles.tripCardAvatarFallback]}>
                  <Text style={styles.tripCardAvatarInitials}>{getInitials(trip.driverName)}</Text>
                </View>
              )}
              <View style={styles.tripCardDriverWrap}>
                <Text style={styles.tripCardDriverName}>{trip.driverName}</Text>
                <Text style={styles.tripCardRating}>★ {formatDriverRatingLabel(trip.rating)}</Text>
              </View>
              <View style={[styles.tripCardBadge, styles.tripCardBadgeBg]}>
                <Text style={[styles.tripCardBadgeText, trip.badge === 'Take Me' ? styles.tripCardBadgeTakeMe : styles.tripCardBadgeParceiro]}>{trip.badge}</Text>
              </View>
            </View>
            <View style={styles.tripCardDivider} />
            <View style={styles.tripCardTimes}>
              <View style={styles.tripCardTimeRow}>
                <Text style={styles.tripCardTimeLabel}>Saída</Text>
                <Text style={styles.tripCardTimeValue}>{trip.departure}</Text>
              </View>
              <View style={styles.tripCardTimeRow}>
                <Text style={styles.tripCardTimeLabel}>Chegada</Text>
                <Text style={styles.tripCardTimeValue}>{trip.arrival}</Text>
              </View>
            </View>
            <View style={styles.tripCardFareRow}>
              <Text style={styles.tripCardFareLabel}>Valor da corrida</Text>
              <Text style={styles.tripCardFareValue}>{formatTripFareBrl(trip.amount_cents)}</Text>
            </View>
            <View style={styles.tripCardDivider} />
            <View style={styles.tripCardCapacity}>
              <View style={styles.tripCardCapacityItem}>
                <MaterialIcons name="people" size={18} color={COLORS.neutral700} />
                <Text style={styles.tripCardCapacityText}>{trip.seats} lugares</Text>
              </View>
              <View style={styles.tripCardCapacityItem}>
                <MaterialIcons name="work-outline" size={18} color={COLORS.neutral700} />
                <Text style={styles.tripCardCapacityText}>{trip.bags} malas</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.agendarButton, (!selectedTripId || !destinationReady) && styles.agendarButtonDisabled]}
          onPress={handleAgendar}
          disabled={!selectedTripId || !destinationReady}
          activeOpacity={0.8}
        >
          <Text style={styles.agendarButtonText}>Agendar</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={timeSheetVisible} transparent animationType="none" onRequestClose={closeTimeSheet} statusBarTranslucent>
        <View style={styles.timeSheetOverlayContainer} pointerEvents="box-none">
          <Animated.View style={[styles.timeSheetOverlay, { opacity: timeSheetOverlayOpacity }]} pointerEvents="none" />
          <Pressable style={styles.timeSheetOverlayTouchable} onPress={closeTimeSheet} />
          <Animated.View style={[styles.timeSheetContent, { transform: [{ translateY: timeSheetTranslateY }] }]} pointerEvents="box-none">
            <View style={styles.timeSheetHandle} />
            <Text style={styles.timeSheetTitle}>Escolha o dia</Text>
            <ScrollView style={styles.timeSlotsScroll} contentContainerStyle={styles.timeSlotsContent}>
              {PLAN_RIDE_DAY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={styles.timeSlotRow}
                  onPress={() => setSelectedDay(opt.id)}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={styles.timeSlotText}>{opt.dayLabel}</Text>
                    <Text style={styles.daySubLabel}>{opt.dateLabel}</Text>
                  </View>
                  <View style={[styles.timeRadio, selectedDay === opt.id && styles.timeRadioSelected]}>
                    {selectedDay === opt.id && <View style={styles.timeRadioInner} />}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.timeSheetFooter}>
              <TouchableOpacity
                style={styles.timePrimaryButton}
                onPress={handleSelectTime}
                activeOpacity={0.8}
              >
                <Text style={styles.timePrimaryButtonText}>Selecionar dia</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.timeCancelButton} onPress={closeTimeSheet}>
                <Text style={styles.timeCancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
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
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 22, color: COLORS.black, fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  dateText: { flex: 1, fontSize: 16, fontWeight: '500', color: COLORS.black },
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
  routeConnectorLine: { width: 2, flex: 1, backgroundColor: COLORS.neutral400, marginVertical: 4, minHeight: 20 },
  destSquare: { width: 12, height: 12, backgroundColor: COLORS.black, borderRadius: 2 },
  routeFields: { flex: 1, overflow: 'visible' },
  originEditWrap: { zIndex: 20, position: 'relative' },
  originReadOnly: { paddingVertical: 12 },
  originText: { fontSize: 15, color: COLORS.black },
  originAutocomplete: { marginBottom: 0 },
  originInput: {
    fontSize: 15,
    color: COLORS.black,
    backgroundColor: COLORS.background,
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
  recentsSection: { marginTop: 8, marginBottom: 8 },
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
  roundTripHint: {
    fontSize: 13,
    color: COLORS.neutral700,
    lineHeight: 18,
    marginBottom: 14,
  },
  timeSheetOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  timeSheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  timeSheetOverlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  timeSheetContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  timeSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.neutral400,
    alignSelf: 'center',
    marginBottom: 24,
  },
  timeSheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
    marginBottom: 20,
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  dateInputText: { fontSize: 16, color: COLORS.black, fontWeight: '500' },
  datePickerDoneButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.black,
    borderRadius: 10,
  },
  datePickerDoneText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  timeDayScroll: { marginBottom: 24, maxHeight: 64 },
  timeDayTab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    alignItems: 'center',
    minWidth: 72,
  },
  timeDayTabSelected: { borderColor: COLORS.black, backgroundColor: COLORS.neutral300 },
  timeDayTabLabelTop: { fontSize: 14, fontWeight: '600', color: COLORS.neutral700 },
  timeDayTabLabelBottom: { fontSize: 12, fontWeight: '500', color: COLORS.neutral700, marginTop: 2 },
  timeDayTabTextSelected: { color: COLORS.black },
  timeSlotsScroll: { maxHeight: 320 },
  timeSlotsContent: { paddingBottom: 24 },
  timeSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  timeSlotText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  daySubLabel: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  timeRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.neutral400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRadioSelected: { borderColor: COLORS.black },
  timeRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.black,
  },
  timeSheetFooter: { paddingTop: 16 },
  timePrimaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  timePrimaryButtonDisabled: { opacity: 0.5 },
  timePrimaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  timeCancelButton: { paddingVertical: 12, alignItems: 'center' },
  timeCancelButtonText: { fontSize: 16, fontWeight: '500', color: COLORS.neutral700 },
  tripCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tripCardSelected: {
    borderColor: COLORS.black,
  },
  tripsLoadingWrap: { paddingVertical: 32, alignItems: 'center', gap: 12 },
  tripsLoadingText: { fontSize: 14, color: COLORS.neutral700 },
  tripsErrorText: { fontSize: 14, color: '#dc2626', marginBottom: 16 },
  tripsEmptyText: { fontSize: 14, color: COLORS.neutral700, marginBottom: 16 },
  tripCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tripCardAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FBBF24',
    marginRight: 12,
    overflow: 'hidden',
  },
  tripCardAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripCardAvatarInitials: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.black,
  },
  tripCardDriverWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  tripCardDriverName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.black,
  },
  tripCardRating: {
    fontSize: 14,
    color: '#CBA04B',
    marginTop: 2,
  },
  tripCardBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tripCardBadgeBg: {
    backgroundColor: '#FFFFFF',
  },
  tripCardBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tripCardBadgeTakeMe: {
    color: '#A37E38',
  },
  tripCardBadgeParceiro: {
    color: '#0D0D0D',
  },
  tripCardDivider: {
    height: 1,
    backgroundColor: COLORS.neutral400,
    marginVertical: 12,
  },
  tripCardTimes: {
    gap: 6,
  },
  tripCardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripCardTimeLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.neutral700,
  },
  tripCardTimeValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.black,
  },
  tripCardFareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  tripCardFareLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
  },
  tripCardFareValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EA580C',
  },
  tripCardCapacity: {
    flexDirection: 'row',
    paddingTop: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  tripCardCapacityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripCardCapacityText: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.neutral700,
  },
  agendarButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  agendarButtonDisabled: { opacity: 0.5 },
  agendarButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
