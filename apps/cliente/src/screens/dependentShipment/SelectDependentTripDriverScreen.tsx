import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DependentShipmentStackParamList, TripDriverParam } from '../../navigation/types';
import { loadShipmentDriversForRoute } from '../../lib/loadShipmentDriversForRoute';
import {
  tripFitsPassengersAndBags,
  filterScheduledTripsByWhenSelection,
  type ClientScheduledTripItem,
} from '../../lib/clientScheduledTrips';
import type { WhenTimeResult } from '../../hooks/useWhenTimeSelection';
import { dependentShipmentTotalPassengers } from '../../lib/tripCapacityLimits';
import { formatVehicleDescription } from '../../lib/tripDriverDisplay';
import { useAppAlert } from '../../contexts/AppAlertContext';

type Props = NativeStackScreenProps<DependentShipmentStackParamList, 'SelectDependentTripDriver'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

function toTripDriverParam(sel: ClientScheduledTripItem): TripDriverParam {
  return {
    id: sel.id,
    driver_id: sel.driver_id,
    name: sel.driverName,
    rating: sel.rating,
    badge: sel.badge,
    departure: sel.departure,
    arrival: sel.arrival,
    seats: sel.seats,
    bags: sel.bags,
    amount_cents: sel.amount_cents ?? undefined,
    vehicle_model: sel.vehicle_model,
    vehicle_year: sel.vehicle_year,
    vehicle_plate: sel.vehicle_plate,
    avatar_url: sel.driverAvatarUrl,
  };
}

export function SelectDependentTripDriverScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { showAlert } = useAppAlert();
  const {
    origin,
    destination,
    whenOption,
    whenLabel,
    scheduledDateId,
    scheduledTimeSlot,
    fullName,
    contactPhone,
    bagsCount,
    instructions,
    dependentId,
    photoUri,
    photoUris,
    extraPassengers,
  } = route.params;

  const companions = extraPassengers ?? 0;
  const totalPassengersInTrip = dependentShipmentTotalPassengers(companions);

  const legParams = {
    origin,
    destination,
    whenOption,
    whenLabel,
    fullName,
    contactPhone,
    bagsCount,
    extraPassengers: companions,
    instructions,
    dependentId,
    ...(photoUris?.length ? { photoUris } : {}),
    ...(photoUri ? { photoUri } : {}),
  };

  const [items, setItems] = useState<ClientScheduledTripItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const whenForTrips: WhenTimeResult = useMemo(
    () => ({
      whenOption,
      whenLabel: whenLabel ?? (whenOption === 'now' ? 'Agora' : ''),
      scheduledDateId,
      scheduledTimeSlot,
    }),
    [whenOption, whenLabel, scheduledDateId, scheduledTimeSlot],
  );

  const tripsMatchingWhen = useMemo(
    () => filterScheduledTripsByWhenSelection(items, whenForTrips),
    [items, whenForTrips],
  );

  /** Mesmo critério da busca de viagens: lista só por lugares; malas na confirmação do pagamento. */
  const visibleItems = useMemo(
    () =>
      tripsMatchingWhen.filter((t) => tripFitsPassengersAndBags(t, totalPassengersInTrip, 0)),
    [tripsMatchingWhen, totalPassengersInTrip],
  );

  useEffect(() => {
    setSelectedId((prev) => (prev && visibleItems.some((v) => v.id === prev) ? prev : null));
  }, [visibleItems]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { items: list, error: err } = await loadShipmentDriversForRoute({
      originLat: origin.latitude,
      originLng: origin.longitude,
      destinationLat: destination.latitude,
      destinationLng: destination.longitude,
    });
    if (err) setError(err);
    setItems(list);
    setLoading(false);
  }, [origin.latitude, origin.longitude, destination.latitude, destination.longitude]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleContinue = () => {
    const sel = visibleItems.find((i) => i.id === selectedId);
    if (!sel) return;
    const amountCents = sel.amount_cents;
    if (amountCents == null || !Number.isFinite(amountCents) || amountCents < 1) {
      showAlert(
        'Preço indisponível',
        'Esta viagem ainda não tem preço configurado. Escolha outra opção ou contate o suporte.',
      );
      return;
    }
    const driver = toTripDriverParam(sel);
    navigation.navigate('ConfirmDependentShipment', {
      ...legParams,
      driver,
      amountCents,
      scheduledTripDepartureAt: sel.departure_at,
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: bottomInset }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.title}>Escolher motorista</Text>
      </View>
      <Text style={styles.subtitle}>
        Selecione o motorista da rota que fará o transporte do dependente. Se ele não aceitar a tempo, a oferta pode passar ao próximo na mesma rota.
      </Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryBtnText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>Nenhum motorista disponível nesta rota no momento.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      ) : tripsMatchingWhen.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>
            {whenOption === 'later' && whenLabel
              ? `Nenhuma viagem nesta rota para ${whenLabel}. Tente outro dia ou altere origem e destino.`
              : 'Nenhuma viagem nesta rota para hoje. Você pode tentar agendar outro dia.'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>
            Nenhuma viagem nesta rota tem lugares suficientes para {totalPassengersInTrip}{' '}
            {totalPassengersInTrip === 1 ? 'passageiro embarcado' : 'passageiros embarcados'}
            {companions > 0 ? ` (dependente + ${companions} acompanhante(s))` : ' (dependente)'}. Reduza acompanhantes ou escolha outra data/rota.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {visibleItems.map((t) => {
              const selected = selectedId === t.id;
              const avatarUri = t.driverAvatarUrl?.startsWith('http')
                ? t.driverAvatarUrl
                : t.driverAvatarUrl
                  ? `${supabaseUrl}/storage/v1/object/public/avatars/${t.driverAvatarUrl}`
                  : null;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.card, selected && styles.cardSelected]}
                  onPress={() => setSelectedId(t.id)}
                  activeOpacity={0.85}
                >
                  <View style={styles.cardRow}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPh]}>
                        <MaterialIcons name="person" size={28} color={COLORS.neutral700} />
                      </View>
                    )}
                    <View style={styles.cardBody}>
                      <Text style={styles.driverName}>{t.driverName}</Text>
                      <Text style={styles.meta}>
                        {t.departure} → {t.arrival} · {t.badge}
                      </Text>
                      <Text style={styles.vehicle}>{formatVehicleDescription(t.vehicle_model, t.vehicle_year, t.vehicle_plate)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[styles.primary, !selectedId && styles.primaryDisabled]}
            disabled={!selectedId}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>Continuar</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  backButton: { marginRight: 8, padding: 4 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.black, flex: 1 },
  subtitle: { fontSize: 14, color: COLORS.neutral700, paddingHorizontal: 24, marginBottom: 16 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errText: { fontSize: 15, color: COLORS.neutral700, textAlign: 'center' },
  retryBtn: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 20 },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  card: {
    borderWidth: 1,
    borderColor: COLORS.neutral300,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: COLORS.background,
  },
  cardSelected: { borderColor: COLORS.black, borderWidth: 2 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, marginRight: 12 },
  avatarPh: { backgroundColor: COLORS.neutral300, justifyContent: 'center', alignItems: 'center' },
  cardBody: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  meta: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  vehicle: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  primary: {
    marginHorizontal: 24,
    marginTop: 8,
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
