import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DependentShipmentStackParamList } from '../../navigation/types';
import type { ShipmentPlaceParam } from '../../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import { getCurrentPlace, distanceKm, formatDistanceKm } from '../../lib/location';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useCurrentLocation } from '../../contexts/CurrentLocationContext';
import { AddressAutocomplete } from '../../components/AddressAutocomplete';
import { guessCityFromPtAddress } from '../../lib/shipmentOriginCity';
import { useRecentDestinationsSorted } from '../../hooks/useRecentDestinationsSorted';
import { formatRecentDestinationDisplay } from '../../lib/recentDestinations';
import { useWhenTimeSelection } from '../../hooks/useWhenTimeSelection';
import { WhenTimeSheets } from '../../components/WhenTimeSheets';

type Props = NativeStackScreenProps<DependentShipmentStackParamList, 'DefineDependentTrip'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};
const DEFAULT_COORDS = { latitude: -7.3289, longitude: -35.3328 };
const DEFAULT_DEST_COORDS = { latitude: -7.3305, longitude: -35.3335 };

export function DefineDependentTripScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();
  const { currentPlace, refreshLocation } = useCurrentLocation();
  const { fullName, contactPhone, bagsCount, instructions, dependentId, photoUri, extraPassengers } = route.params;

  const when = useWhenTimeSelection();

  const [originAddress, setOriginAddress] = useState('Obtendo sua localização...');
  const [originLat, setOriginLat] = useState(DEFAULT_COORDS.latitude);
  const [originLng, setOriginLng] = useState(DEFAULT_COORDS.longitude);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [destinationLat, setDestinationLat] = useState(DEFAULT_DEST_COORDS.latitude);
  const [destinationLng, setDestinationLng] = useState(DEFAULT_DEST_COORDS.longitude);
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  /** Origem com coordenadas válidas: GPS/reverse geocode ou escolha nas sugestões (igual encomendas/viagens). */
  const [originConfirmed, setOriginConfirmed] = useState(false);
  /** Cidade vinda da sugestão (Nominatim); GPS usa só `guessCityFromPtAddress`. */
  const [originCityHint, setOriginCityHint] = useState<string | undefined>();
  const [locationLoading, setLocationLoading] = useState(false);

  const { sortedRecentDestinations, saveRecentDestination, loadRecentDestinations } =
    useRecentDestinationsSorted(originLat, originLng);

  useFocusEffect(
    useCallback(() => {
      loadRecentDestinations();
    }, [loadRecentDestinations]),
  );

  const loadOrigin = useCallback(async () => {
    const place = await getCurrentPlace();
    if (place) {
      setOriginAddress(place.address);
      setOriginLat(place.latitude);
      setOriginLng(place.longitude);
      setOriginConfirmed(true);
      setOriginCityHint(undefined);
    } else {
      setOriginAddress('Permita acesso à localização');
      setOriginConfirmed(false);
    }
  }, []);

  useEffect(() => {
    if (currentPlace) {
      setOriginAddress(currentPlace.address);
      setOriginLat(currentPlace.latitude);
      setOriginLng(currentPlace.longitude);
      setOriginConfirmed(true);
      setOriginCityHint(undefined);
    } else {
      loadOrigin();
    }
  }, [currentPlace?.latitude, currentPlace?.longitude, currentPlace?.address, loadOrigin]);

  const useMyLocation = useCallback(async () => {
    setLocationLoading(true);
    try {
      const place = await refreshLocation();
      if (place) {
        setOriginAddress(place.address);
        setOriginLat(place.latitude);
        setOriginLng(place.longitude);
        setOriginConfirmed(true);
        setOriginCityHint(undefined);
      } else {
        showAlert('Localização', 'Não foi possível usar sua localização.');
      }
    } catch {
      showAlert('Localização', 'Não foi possível obter seu endereço.');
    } finally {
      setLocationLoading(false);
    }
  }, [refreshLocation, showAlert]);

  const goToDriverSelection = useCallback(() => {
    const orig = originAddress.trim();
    if (!orig || orig === 'Obtendo sua localização...') {
      showAlert('Atenção', 'Informe o ponto de partida.');
      return;
    }
    if (!originConfirmed) {
      showAlert(
        'Atenção',
        'Selecione o ponto de partida a partir das sugestões para garantir a localização correta (ou use Minha localização).',
      );
      return;
    }
    const dest = destinationAddress.trim();
    if (!dest) {
      showAlert('Atenção', 'Informe o destino da viagem.');
      return;
    }
    if (!destinationConfirmed) {
      showAlert('Atenção', 'Selecione o destino a partir das sugestões para garantir a localização correta.');
      return;
    }
    const timeResult = when.getResult();
    const originCityTag = (originCityHint?.trim() || guessCityFromPtAddress(orig)).trim() || undefined;
    const originParam: ShipmentPlaceParam = {
      address: orig,
      latitude: originLat,
      longitude: originLng,
      ...(originCityTag ? { city: originCityTag } : {}),
    };
    const destinationParam: ShipmentPlaceParam = {
      address: dest,
      latitude: destinationLat,
      longitude: destinationLng,
    };
    const city = dest.includes(', ') ? dest.split(', ').slice(-1)[0] ?? dest : dest;
    void saveRecentDestination({
      address: dest,
      city,
      latitude: destinationLat,
      longitude: destinationLng,
    });
    navigation.navigate('SelectDependentTripDriver', {
      origin: originParam,
      destination: destinationParam,
      whenOption: timeResult.whenOption,
      whenLabel: timeResult.whenOption === 'later' ? timeResult.whenLabel : 'Agora',
      ...(timeResult.whenOption === 'later' && timeResult.scheduledDateId
        ? { scheduledDateId: timeResult.scheduledDateId }
        : {}),
      fullName,
      contactPhone,
      bagsCount,
      instructions,
      dependentId,
      extraPassengers,
      ...(photoUri ? { photoUri } : {}),
    });
  }, [
    destinationAddress,
    destinationConfirmed,
    destinationLat,
    destinationLng,
    originAddress,
    originLat,
    originLng,
    originConfirmed,
    when,
    fullName,
    contactPhone,
    bagsCount,
    instructions,
    dependentId,
    extraPassengers,
    photoUri,
    navigation,
    showAlert,
    saveRecentDestination,
    originCityHint,
  ]);

  const handleRecentDestinationPress = useCallback(
    (address: string, lat: number, lng: number) => {
      setDestinationAddress(address);
      setDestinationLat(lat);
      setDestinationLng(lng);
      setDestinationConfirmed(true);
    },
    [],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Definir viagem</Text>
      </View>

      <TouchableOpacity style={styles.whenPill} onPress={when.openWhenSheet} activeOpacity={0.8}>
        <MaterialIcons name="schedule" size={20} color={COLORS.black} />
        <Text style={styles.pillText}>{when.whenLabel}</Text>
        <MaterialIcons name="keyboard-arrow-down" size={20} color={COLORS.black} />
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.label}>Ponto de partida</Text>
        <AddressAutocomplete
          value={originAddress}
          onChangeText={(text) => {
            setOriginAddress(text);
            setOriginConfirmed(false);
            setOriginCityHint(undefined);
          }}
          onSelectPlace={(place) => {
            setOriginAddress(place.address);
            setOriginLat(place.latitude);
            setOriginLng(place.longitude);
            setOriginConfirmed(true);
            setOriginCityHint(place.city?.trim() || undefined);
          }}
          placeholder="Ex: Seu endereço, ponto de encontro..."
          style={styles.autocomplete}
        />
        <View style={styles.addressRow}>
          <TouchableOpacity
            style={styles.useLocationBtn}
            onPress={useMyLocation}
            disabled={locationLoading}
            activeOpacity={0.8}
          >
            {locationLoading ? (
              <ActivityIndicator size="small" color={COLORS.black} />
            ) : (
              <MaterialIcons name="my-location" size={20} color={COLORS.black} />
            )}
            <Text style={styles.useLocationText}>Minha localização</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.label}>Destino</Text>
        <AddressAutocomplete
          value={destinationAddress}
          onChangeText={(text) => {
            setDestinationAddress(text);
            setDestinationConfirmed(false);
          }}
          onSelectPlace={(place) => {
            setDestinationAddress(place.address);
            setDestinationLat(place.latitude);
            setDestinationLng(place.longitude);
            setDestinationConfirmed(true);
          }}
          placeholder="Ex: Rodoviária, hotel..."
          style={styles.autocomplete}
        />
        {sortedRecentDestinations.length > 0 && (
          <View style={styles.recentsSection}>
            <Text style={styles.recentsTitle}>Destinos recentes</Text>
            {sortedRecentDestinations.map((item, index) => {
              const dist = distanceKm(originLat, originLng, item.latitude, item.longitude);
              const distLabel = dist != null ? formatDistanceKm(dist) : null;
              const { line1, line2 } = formatRecentDestinationDisplay(item);
              return (
                <TouchableOpacity
                  key={`${item.address}-${index}`}
                  style={styles.recentRow}
                  onPress={() =>
                    handleRecentDestinationPress(item.address, item.latitude ?? DEFAULT_DEST_COORDS.latitude, item.longitude ?? DEFAULT_DEST_COORDS.longitude)
                  }
                  activeOpacity={0.7}
                >
                  <View style={styles.recentIconWrap}>
                    <MaterialIcons name="history" size={22} color={COLORS.black} />
                    {distLabel != null ? (
                      <Text style={styles.recentDistance} numberOfLines={1}>
                        {distLabel}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.recentTextWrap}>
                    <Text style={styles.recentLine1} numberOfLines={1}>
                      {line1}
                    </Text>
                    <Text style={styles.recentLine2} numberOfLines={1}>
                      {line2}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        <TouchableOpacity style={styles.primaryButton} onPress={goToDriverSelection} activeOpacity={0.8}>
          <Text style={styles.primaryButtonText}>Continuar</Text>
        </TouchableOpacity>
      </ScrollView>

      <WhenTimeSheets
        state={when}
        whenTitle="Para quando é o envio?"
        nowSubtitle="Envio imediato"
        laterSubtitle="Agende escolhendo o dia"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backArrow: { fontSize: 22, color: COLORS.black, fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1 },
  whenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.neutral300,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    gap: 8,
    marginBottom: 20,
  },
  pillText: { fontSize: 15, fontWeight: '600', color: COLORS.black },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  label: { fontSize: 15, fontWeight: '500', color: COLORS.black, marginBottom: 8 },
  addressRow: { marginBottom: 20, marginTop: 4 },
  useLocationBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  useLocationText: { fontSize: 14, color: COLORS.black, fontWeight: '500' },
  autocomplete: { marginBottom: 8 },
  recentsSection: { marginBottom: 16 },
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
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
