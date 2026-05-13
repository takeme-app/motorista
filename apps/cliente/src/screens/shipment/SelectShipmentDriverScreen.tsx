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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ShipmentStackParamList } from '../../navigation/types';
import { loadShipmentDriversForRoute } from '../../lib/loadShipmentDriversForRoute';
import {
  filterScheduledTripsByWhenSelection,
  type ClientScheduledTripItem,
} from '../../lib/clientScheduledTrips';
import type { WhenTimeResult } from '../../hooks/useWhenTimeSelection';
import { formatVehicleDescription } from '../../lib/tripDriverDisplay';
import { quoteShipmentForClient, type ShipmentQuoteOk } from '../../lib/shipmentQuote';
import { resolveShipmentBaseId } from '../../lib/resolveShipmentBase';

type Props = NativeStackScreenProps<ShipmentStackParamList, 'SelectShipmentDriver'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export function SelectShipmentDriverScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const {
    origin,
    destination,
    whenOption,
    whenLabel,
    scheduledDateId,
    scheduledTimeSlot,
    packageSize,
    packageSizeLabel,
  } = route.params;

  const [items, setItems] = useState<ClientScheduledTripItem[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [quote, setQuote] = useState<ShipmentQuoteOk | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [resolvedBaseId, setResolvedBaseId] = useState<string | null>(null);
  const [quoteRetryKey, setQuoteRetryKey] = useState(0);

  /** Quote específico do preparador selecionado (override), quando diferente do genérico. */
  const [selectedQuote, setSelectedQuote] = useState<ShipmentQuoteOk | null>(null);
  const [selectedQuoteLoading, setSelectedQuoteLoading] = useState(false);

  const loadDrivers = useCallback(async () => {
    setDriversLoading(true);
    setDriversError(null);
    const { items: list, error: err } = await loadShipmentDriversForRoute({
      originLat: origin.latitude,
      originLng: origin.longitude,
      destinationLat: destination.latitude,
      destinationLng: destination.longitude,
      bagsOnly: true,
    });
    if (err) setDriversError(err);
    setItems(list);
    setDriversLoading(false);
  }, [origin.latitude, origin.longitude, destination.latitude, destination.longitude]);

  const whenForTrips: WhenTimeResult = useMemo(
    () => ({
      whenOption,
      whenLabel: whenLabel ?? (whenOption === 'now' ? 'Agora' : ''),
      scheduledDateId,
      scheduledTimeSlot,
    }),
    [whenOption, whenLabel, scheduledDateId, scheduledTimeSlot],
  );

  const filteredItems = useMemo(
    () => filterScheduledTripsByWhenSelection(items, whenForTrips),
    [items, whenForTrips],
  );

  useEffect(() => {
    if (selectedId && !filteredItems.some((t) => t.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredItems, selectedId]);

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  useEffect(() => {
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuote(null);
    (async () => {
      const res = await quoteShipmentForClient({
        originAddress: origin.address,
        destinationAddress: destination.address,
        originLat: origin.latitude,
        originLng: origin.longitude,
        destinationLat: destination.latitude,
        destinationLng: destination.longitude,
        packageSize,
      });
      if (cancelled) return;
      if (!res.ok) {
        setQuoteError(res.error);
        setQuote(null);
      } else {
        setQuote(res.quote);
      }
      let base: string | null = null;
      try {
        const resolved = await resolveShipmentBaseId({
          origin: { latitude: origin.latitude, longitude: origin.longitude },
          originAddress: origin.address,
        });
        base = resolved ?? null;
      } catch {
        base = null;
      }
      if (!cancelled) setResolvedBaseId(base);
      setQuoteLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    origin.address,
    origin.latitude,
    origin.longitude,
    destination.address,
    destination.latitude,
    destination.longitude,
    packageSize,
    quoteRetryKey,
  ]);

  // Recalcula quote com `preparerId` ao selecionar o motorista — aplica override do preparador
  // na hierarquia do shipmentQuote. Antes da seleção, mantém o quote genérico (preview).
  useEffect(() => {
    const preparerId = selectedId
      ? filteredItems.find((i) => i.id === selectedId)?.driver_id ?? null
      : null;
    if (!preparerId) {
      setSelectedQuote(null);
      setSelectedQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setSelectedQuoteLoading(true);
    (async () => {
      const res = await quoteShipmentForClient({
        originAddress: origin.address,
        destinationAddress: destination.address,
        originLat: origin.latitude,
        originLng: origin.longitude,
        destinationLat: destination.latitude,
        destinationLng: destination.longitude,
        packageSize,
        preparerId,
      });
      if (cancelled) return;
      setSelectedQuote(res.ok ? res.quote : null);
      setSelectedQuoteLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedId,
    filteredItems,
    origin.address,
    origin.latitude,
    origin.longitude,
    destination.address,
    destination.latitude,
    destination.longitude,
    packageSize,
  ]);

  const effectiveQuote = selectedQuote ?? quote;

  const handleContinue = () => {
    const sel = filteredItems.find((i) => i.id === selectedId);
    if (!sel || !effectiveQuote) return;
    navigation.navigate('Recipient', {
      origin,
      destination,
      whenOption,
      whenLabel,
      ...(scheduledDateId ? { scheduledDateId } : {}),
      ...(scheduledTimeSlot ? { scheduledTimeSlot } : {}),
      packageSize,
      packageSizeLabel,
      amountCents: effectiveQuote.amountCents,
      pricingSubtotalCents: effectiveQuote.pricingSubtotalCents,
      platformFeeCents: effectiveQuote.platformFeeCents,
      priceRouteBaseCents: effectiveQuote.priceRouteBaseCents,
      pricingRouteId: effectiveQuote.pricingRouteId,
      adminPctApplied: effectiveQuote.adminPctApplied,
      resolvedBaseId,
      clientPreferredDriverId: sel.driver_id,
      scheduledTripDepartureAt: sel.departure_at,
      scheduledTripId: sel.id,
    });
  };

  const loading = driversLoading || quoteLoading;
  const blockingError = quoteError;
  const emptyDriversHint =
    items.length > 0 && filteredItems.length === 0
      ? whenOption === 'later' && whenLabel
        ? `Nenhum motorista nesta rota para ${whenLabel}. Altere o dia ou volte para ajustar origem e destino.`
        : 'Nenhum motorista nesta rota para hoje. Você pode tentar outro dia ou revisar origem e destino.'
      : 'Nenhum motorista disponível nesta rota no momento.';

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.title}>Escolher motorista</Text>
      </View>
      <Text style={styles.subtitle}>
        Selecione o motorista cadastrado para esta rota que fará a entrega. Se ele não aceitar a tempo, a oferta pode passar ao próximo na mesma rota.
      </Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
          <Text style={styles.loadingHint}>Calculando valor e motoristas…</Text>
        </View>
      ) : blockingError ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>{blockingError}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setQuoteRetryKey((k) => k + 1);
              void loadDrivers();
            }}
          >
            <Text style={styles.retryBtnText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : driversError ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>{driversError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadDrivers()}>
            <Text style={styles.retryBtnText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>{emptyDriversHint}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {filteredItems.map((t) => {
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
                      <Text style={styles.meta}>{t.departure} → {t.arrival} · {t.badge}</Text>
                      <Text style={styles.vehicle}>{formatVehicleDescription(t.vehicle_model, t.vehicle_year, t.vehicle_plate)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[
              styles.primary,
              (!selectedId || !effectiveQuote || selectedQuoteLoading) && styles.primaryDisabled,
            ]}
            disabled={!selectedId || !effectiveQuote || selectedQuoteLoading}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            {selectedQuoteLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryText}>Continuar</Text>
            )}
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
  loadingHint: { marginTop: 12, fontSize: 14, color: COLORS.neutral700, textAlign: 'center' },
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
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.neutral300 },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  meta: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  vehicle: { fontSize: 12, color: COLORS.neutral700, marginTop: 2 },
  primary: {
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: COLORS.black,
    alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
