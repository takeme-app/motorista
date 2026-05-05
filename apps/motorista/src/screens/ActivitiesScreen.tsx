import { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  Linking,
  KeyboardAvoidingView,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { getOrCreateActiveSupportConversationId, formatTripCode as formatSharedTripCode } from '@take-me/shared';
import { supabase } from '../lib/supabase';
import { invokeRefundJourneyStartNotAccepted } from '../lib/refundJourneyStartNotAccepted';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { useAppAlert } from '../contexts/AppAlertContext';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Activities'>,
  NativeStackScreenProps<RootStackParamList>
>;

type Booking = {
  id: string;
  passenger_count: number | null;
  bags_count: number | null;
  status: string;
};

type RawTrip = {
  id: string;
  origin_address: string;
  destination_address: string;
  departure_at: string;
  bags_available: number | null;
  trunk_occupancy_pct: number | null;
  status: string;
  route_id?: string | null;
  is_active?: boolean | null;
  driver_journey_started_at?: string | null;
  bookings: Booking[];
};

type TripRow = {
  id: string;
  origin_address: string;
  destination_address: string;
  departure_at: string;
  bags_available: number;
  status: string;
  confirmedBookings: Booking[];
  passengerCount: number;
  /** Malas declaradas nas reservas (`bookings.bags_count`), não é envio de encomenda. */
  bagsUsed: number;
  /** Linhas em `shipments` vinculadas à viagem (frete). */
  shipmentCount: number;
  /** Envios de dependentes na mesma `scheduled_trip` (não cancelados). */
  dependentCount: number;
  /** Soma de `bags_count` dos dependentes na viagem. */
  dependentBagsSum: number;
  trunkPct: number;
  isConfirmed: boolean;
  driverJourneyStartedAt: string | null;
  /** Viagem de rota com o dia desligado no cronograma (`is_active = false`). */
  offerPaused: boolean;
};

type FilterCategory = 'Todas' | 'Viagens' | 'Envios' | 'Dependentes';

const SUPPORT_PHONE = 'tel:+5583999999999';
const SUPPORT_WHATSAPP = 'https://wa.me/5583999999999';

function applyDateMask(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatTripCode(id: string): string {
  return formatSharedTripCode(id);
}

function shortAddr(addr: string): string {
  const parts = addr.split(',');
  return parts[0]?.trim() ?? addr;
}

function formatDeparture(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.getDate();
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const month = monthNames[d.getMonth()] ?? '';
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} • ${hours}:${minutes}`;
  } catch {
    return '—';
  }
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function buildTripRow(raw: RawTrip): TripRow {
  const rows = raw.bookings ?? [];
  const bagsAvailable = raw.bags_available ?? 0;
  const trunkPct = raw.trunk_occupancy_pct ?? 0;
  /** Reservas já aceitas (`confirmed` / `in_progress`); `paid`/`pending` só em Solicitações pendentes. */
  const acceptedBookings = rows.filter((b) => {
    const s = String(b.status ?? '').toLowerCase();
    return s === 'confirmed' || s === 'in_progress';
  });
  const passengerCount = acceptedBookings.reduce((s, b) => s + (b.passenger_count ?? 0), 0);
  const bagsUsed = acceptedBookings.reduce((s, b) => s + (b.bags_count ?? 0), 0);
  const isConfirmed = acceptedBookings.length > 0;

  return {
    id: raw.id,
    origin_address: raw.origin_address,
    destination_address: raw.destination_address,
    departure_at: raw.departure_at,
    bags_available: bagsAvailable,
    status: raw.status,
    confirmedBookings: acceptedBookings,
    passengerCount,
    bagsUsed,
    shipmentCount: 0,
    dependentCount: 0,
    dependentBagsSum: 0,
    trunkPct,
    isConfirmed,
    driverJourneyStartedAt: raw.driver_journey_started_at ?? null,
    offerPaused: raw.route_id != null && raw.is_active === false,
  };
}

function TripCard({
  trip,
  onPress,
  onTrunkChange,
  onStartTrip,
  onContinueTrip,
  startTripLoading,
  ongoingTripId,
}: {
  trip: TripRow;
  onPress: () => void;
  onTrunkChange?: (newPct: number) => void;
  onStartTrip?: () => void;
  onContinueTrip?: () => void;
  startTripLoading?: boolean;
  /** Se definido e diferente deste card, não permitir iniciar outra viagem. */
  ongoingTripId: string | null;
}) {
  const isConfirmed = trip.isConfirmed;
  const journeyStarted = Boolean(trip.driverJourneyStartedAt);
  const hasPassengers = trip.passengerCount > 0;
  const totalMalas = trip.bagsUsed + trip.dependentBagsSum;
  const hasLuggage = totalMalas > 0;
  const hasShipments = trip.shipmentCount > 0;
  const hasDependents = trip.dependentCount > 0;
  const anotherTripInProgress =
    ongoingTripId != null && ongoingTripId !== trip.id;

  const trunkColor =
    trip.trunkPct >= 80 ? '#EF4444' : trip.trunkPct >= 50 ? GOLD : '#22C55E';

  const badgeStyle = journeyStarted
    ? styles.badgeInProgress
    : isConfirmed
      ? styles.badgeConfirmed
      : styles.badgePlanned;
  const badgeTextStyle = journeyStarted
    ? styles.badgeTextInProgress
    : isConfirmed
      ? styles.badgeTextConfirmed
      : styles.badgeTextPlanned;
  const badgeLabel = journeyStarted ? 'Em andamento' : isConfirmed ? 'Confirmada' : 'Planejada';

  return (
    <View style={styles.card}>
      {/* Row 1: code + badge */}
      <View style={styles.cardRow}>
        <Text style={styles.tripCode}>{formatTripCode(trip.id)}</Text>
        <View style={[styles.badge, badgeStyle]}>
          <Text style={[styles.badgeText, badgeTextStyle]}>{badgeLabel}</Text>
        </View>
      </View>

      {/* Row 2: route */}
      <View style={styles.routeRow}>
        <Text style={styles.routeText} numberOfLines={1}>
          {shortAddr(trip.origin_address)}
        </Text>
        <MaterialIcons
          name="arrow-forward"
          size={16}
          color="#6B7280"
          style={styles.routeArrow}
        />
        <Text style={styles.routeText} numberOfLines={1}>
          {shortAddr(trip.destination_address)}
        </Text>
      </View>

      {/* Row 3: date */}
      <Text style={styles.dateText}>{formatDeparture(trip.departure_at)}</Text>
      {trip.offerPaused ? (
        <Text style={styles.offerPausedHint}>
          Oferta pausada — ative o dia em Perfil → Cronograma das rotas.
        </Text>
      ) : null}

      {/* Row 4: passageiros + malas na mesma linha; encomendas abaixo (largura total) */}
      {(hasPassengers || hasLuggage || hasShipments || hasDependents) && (
        <View style={styles.contentBlock}>
          {(hasPassengers || hasLuggage) ? (
            <View style={styles.contentRowTop}>
              {hasPassengers ? (
                <View style={[styles.contentItem, styles.contentItemTop]}>
                  <Text style={styles.contentLabel}>Passageiros</Text>
                  <Text style={styles.contentValue} numberOfLines={1}>
                    {trip.passengerCount}{' '}
                    {trip.passengerCount === 1 ? 'passageiro' : 'passageiros'}
                  </Text>
                </View>
              ) : null}
              {hasLuggage ? (
                <View style={[styles.contentItem, styles.contentItemTop]}>
                  <Text style={styles.contentLabel}>Malas</Text>
                  <Text style={styles.contentValue} numberOfLines={1}>
                    {totalMalas === 1 ? '1 mala' : `${totalMalas} malas`}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {hasShipments ? (
            <View style={styles.contentShipmentRow}>
              <Text style={styles.contentLabel}>Encomendas</Text>
              <Text style={styles.contentValueShipment}>
                {trip.shipmentCount === 1
                  ? '1 encomenda'
                  : `${trip.shipmentCount} encomendas`}
              </Text>
            </View>
          ) : null}
          {hasDependents ? (
            <View style={styles.contentShipmentRow}>
              <Text style={styles.contentLabel}>Dependentes</Text>
              <Text style={styles.contentValueShipment}>
                {trip.dependentCount === 1
                  ? '1 envio de dependente'
                  : `${trip.dependentCount} envios de dependentes`}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Trunk occupation bar + stepper */}
      <View style={styles.barContainer}>
        <View style={[styles.barFill, { width: `${trip.trunkPct}%` as any, backgroundColor: trunkColor }]} />
      </View>
      <View style={styles.trunkRow}>
        <Text style={styles.barLabel}>
          Bagageiro: {trip.trunkPct}%
        </Text>
        {onTrunkChange && (
          <View style={styles.trunkStepper}>
            <TouchableOpacity
              onPress={() => onTrunkChange(Math.max(0, trip.trunkPct - 10))}
              hitSlop={8}
              activeOpacity={0.7}
              style={styles.stepBtn}
            >
              <MaterialIcons name="remove" size={16} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onTrunkChange(Math.min(100, trip.trunkPct + 10))}
              hitSlop={8}
              activeOpacity={0.7}
              style={styles.stepBtn}
            >
              <MaterialIcons name="add" size={16} color="#374151" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {!journeyStarted &&
      onStartTrip &&
      !trip.offerPaused &&
      trip.status !== 'cancelled' &&
      trip.status !== 'completed' &&
      !anotherTripInProgress &&
      (hasPassengers || hasShipments || hasDependents) ? (
        <TouchableOpacity
          onPress={onStartTrip}
          activeOpacity={0.85}
          style={styles.btnStartTrip}
          disabled={startTripLoading}
        >
          {startTripLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.btnStartTripText}>Iniciar viagem</Text>
          )}
        </TouchableOpacity>
      ) : null}

      {!journeyStarted &&
      anotherTripInProgress &&
      !trip.offerPaused &&
      trip.status !== 'cancelled' &&
      trip.status !== 'completed' ? (
        <Text style={styles.blockedStartHint}>
          Já existe uma viagem em andamento. Finalize-a antes de iniciar esta.
        </Text>
      ) : null}

      {journeyStarted && trip.status !== 'completed' && onContinueTrip ? (
        <TouchableOpacity
          onPress={onContinueTrip}
          activeOpacity={0.85}
          style={styles.btnContinueTrip}
        >
          <Text style={styles.btnContinueTripText}>Continuar no mapa</Text>
        </TouchableOpacity>
      ) : null}

      {/* Bottom link */}
      <TouchableOpacity
        onPress={() => {
          if (journeyStarted && onContinueTrip) {
            onContinueTrip();
          } else {
            onPress();
          }
        }}
        activeOpacity={0.7}
        style={styles.linkBtn}
      >
        <Text style={styles.linkText}>
          {journeyStarted ? 'Abrir mapa da viagem' : 'Ver mais'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function ActivitiesScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [loading, setLoading] = useState(true);
  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  const [confirmedTrips, setConfirmedTrips] = useState<TripRow[]>([]);
  const [plannedTrips, setPlannedTrips] = useState<TripRow[]>([]);
  const [filterVisible, setFilterVisible] = useState(false);
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('Todas');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');
  const [appliedCategory, setAppliedCategory] = useState<FilterCategory>('Todas');
  const [appliedDateStart, setAppliedDateStart] = useState('');
  const [appliedDateEnd, setAppliedDateEnd] = useState('');
  const [filterDateStartDisplay, setFilterDateStartDisplay] = useState('');
  const [filterDateEndDisplay, setFilterDateEndDisplay] = useState('');
  const [supportModalVisible, setSupportModalVisible] = useState(false);
  const [supportBannerVisible, setSupportBannerVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setConfirmedTrips([]);
      setPlannedTrips([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('scheduled_trips')
      .select(
        'id, origin_address, destination_address, departure_at, bags_available, trunk_occupancy_pct, status, route_id, is_active, driver_journey_started_at, bookings(id, passenger_count, bags_count, status)',
      )
      .eq('driver_id', user.id)
      .in('status', ['active', 'scheduled'])
      .order('departure_at', { ascending: true });

    if (error) {
      console.warn('[ActivitiesScreen] scheduled_trips', error.message);
      setConfirmedTrips([]);
      setPlannedTrips([]);
      setLoading(false);
      return;
    }

    const rawTrips = (data ?? []) as RawTrip[];
    let rows = rawTrips.map(buildTripRow);

    if (rows.length > 0) {
      const tripIds = rows.map((r) => r.id);
      const { data: shipRows } = await supabase
        .from('shipments')
        .select('scheduled_trip_id')
        .in('scheduled_trip_id', tripIds)
        .eq('driver_id', user.id)
        .in('status', ['confirmed', 'in_progress', 'delivered']);
      const countByTrip = new Map<string, number>();
      for (const s of shipRows ?? []) {
        const tid = (s as { scheduled_trip_id?: string }).scheduled_trip_id;
        if (!tid) continue;
        countByTrip.set(tid, (countByTrip.get(tid) ?? 0) + 1);
      }

      const { data: depRows } = await supabase
        .from('dependent_shipments')
        .select('scheduled_trip_id, bags_count, status')
        .in('scheduled_trip_id', tripIds)
        .in('status', ['confirmed', 'in_progress', 'delivered']);
      const depCountByTrip = new Map<string, number>();
      const depBagsByTrip = new Map<string, number>();
      for (const d of depRows ?? []) {
        const tid = (d as { scheduled_trip_id?: string }).scheduled_trip_id;
        if (!tid) continue;
        depCountByTrip.set(tid, (depCountByTrip.get(tid) ?? 0) + 1);
        const bc = Math.max(0, Math.floor(Number((d as { bags_count?: number }).bags_count ?? 0)));
        depBagsByTrip.set(tid, (depBagsByTrip.get(tid) ?? 0) + bc);
      }

      rows = rows.map((r) => {
        const sc = countByTrip.get(r.id) ?? 0;
        const dc = depCountByTrip.get(r.id) ?? 0;
        return {
          ...r,
          shipmentCount: sc,
          dependentCount: dc,
          dependentBagsSum: depBagsByTrip.get(r.id) ?? 0,
          isConfirmed: r.isConfirmed || sc > 0 || dc > 0,
        };
      });
    }

    let filtered = rows;

    // Apply date filter
    if (appliedDateStart) {
      const start = new Date(appliedDateStart + 'T00:00:00');
      filtered = filtered.filter(
        (t) => new Date(t.departure_at) >= start,
      );
    }
    if (appliedDateEnd) {
      const end = new Date(appliedDateEnd + 'T23:59:59');
      filtered = filtered.filter(
        (t) => new Date(t.departure_at) <= end,
      );
    }

    setConfirmedTrips(filtered.filter((t) => t.isConfirmed));
    setPlannedTrips(filtered.filter((t) => !t.isConfirmed));
    setLoading(false);
  }, [appliedDateStart, appliedDateEnd]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id || cancelled) return;
        const { data, error } = await supabase
          .from('conversations')
          .select('unread_driver')
          .eq('driver_id', user.id)
          .eq('conversation_kind', 'support_backoffice')
          .eq('status', 'active');
        if (cancelled || error) return;
        const rows = (data ?? []) as { unread_driver?: number }[];
        const total = rows.reduce((s, r) => s + (r.unread_driver ?? 0), 0);
        setSupportBannerVisible(total > 0);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const openFilter = () => {
    setFilterCategory(appliedCategory);
    setFilterDateStart(appliedDateStart);
    setFilterDateEnd(appliedDateEnd);
    setFilterDateStartDisplay(appliedDateStart ? formatDateDisplay(appliedDateStart) : '');
    setFilterDateEndDisplay(appliedDateEnd ? formatDateDisplay(appliedDateEnd) : '');
    setFilterVisible(true);
  };

  const applyFilter = () => {
    setAppliedCategory(filterCategory);
    setAppliedDateStart(filterDateStart);
    setAppliedDateEnd(filterDateEnd);
    setFilterVisible(false);
  };

  const goTripDetail = (tripId: string) => {
    navigation.navigate('TripDetail', { tripId });
  };

  const goTripHistory = () => {
    navigation.navigate('TripHistory');
  };

  const startTripJourney = useCallback(
    async (tripId: string) => {
      setStartingTripId(tripId);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setStartingTripId(null);
        showAlert('Erro', 'Sessão inválida. Faça login novamente.');
        return;
      }
      const { data: otherInProgress } = await supabase
        .from('scheduled_trips')
        .select('id')
        .eq('driver_id', user.id)
        .not('driver_journey_started_at', 'is', null)
        .in('status', ['active', 'scheduled'])
        .neq('id', tripId)
        .limit(1)
        .maybeSingle();
      if (otherInProgress?.id) {
        setStartingTripId(null);
        showAlert(
          'Viagem em andamento',
          'Já existe uma viagem iniciada. Finalize-a antes de iniciar outra.',
        );
        return;
      }
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('scheduled_trips')
        .update(
          {
            status: 'active',
            driver_journey_started_at: now,
            updated_at: now,
          } as never,
        )
        .eq('id', tripId);
      setStartingTripId(null);
      if (error) {
        showAlert('Erro', 'Não foi possível iniciar a viagem. Tente novamente.');
        return;
      }
      void invokeRefundJourneyStartNotAccepted(tripId);
      await load();
      navigation.navigate('ActiveTrip', { tripId });
    },
    [load, navigation, showAlert],
  );

  const updateTrunk = useCallback(async (tripId: string, pct: number) => {
    const update = (prev: TripRow[]) =>
      prev.map((t) => (t.id === tripId ? { ...t, trunkPct: pct } : t));
    setConfirmedTrips(update);
    setPlannedTrips(update);
    await supabase
      .from('scheduled_trips')
      .update({ trunk_occupancy_pct: pct } as never)
      .eq('id', tripId);
  }, []);

  const categories: FilterCategory[] = ['Todas', 'Viagens', 'Envios', 'Dependentes'];

  const ongoingTripId = useMemo(() => {
    const all = [...confirmedTrips, ...plannedTrips];
    const found = all.find((t) => Boolean(t.driverJourneyStartedAt));
    return found?.id ?? null;
  }, [confirmedTrips, plannedTrips]);

  const isEmpty = !loading && confirmedTrips.length === 0 && plannedTrips.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text style={styles.headerTitle}>Suas corridas</Text>
        <TouchableOpacity
          onPress={openFilter}
          activeOpacity={0.7}
          style={styles.filterBtn}
        >
          <MaterialIcons name="tune" size={24} color="#111827" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Large title + history chip */}
        <Text style={styles.screenTitle}>Atividades</Text>
        {supportBannerVisible ? (
          <TouchableOpacity
            style={styles.supportBanner}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Profile', { screen: 'Conversations' })}
          >
            <MaterialIcons name="support-agent" size={22} color="#92400E" style={{ marginRight: 10 }} />
            <Text style={styles.supportBannerText}>
              Há mensagem do suporte. Toque para abrir Perfil → Conversas.
            </Text>
            <MaterialIcons name="chevron-right" size={22} color="#92400E" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={goTripHistory}
          activeOpacity={0.7}
          style={styles.historyChip}
        >
          <Text style={styles.historyChipText}>⏱ Histórico de Viagens</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#C9A227" />
          </View>
        ) : isEmpty ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nenhuma atividade por enquanto.</Text>
          </View>
        ) : (
          <>
            {confirmedTrips.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Viagens confirmadas</Text>
                {confirmedTrips.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    ongoingTripId={ongoingTripId}
                    onPress={() => goTripDetail(trip.id)}
                    onTrunkChange={(pct) => updateTrunk(trip.id, pct)}
                    onStartTrip={() => {
                      void startTripJourney(trip.id);
                    }}
                    onContinueTrip={() => navigation.navigate('ActiveTrip', { tripId: trip.id })}
                    startTripLoading={startingTripId === trip.id}
                  />
                ))}
              </>
            )}

            {plannedTrips.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Viagens planejadas</Text>
                {plannedTrips.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    ongoingTripId={ongoingTripId}
                    onPress={() => goTripDetail(trip.id)}
                    onTrunkChange={(pct) => updateTrunk(trip.id, pct)}
                    onStartTrip={() => {
                      void startTripJourney(trip.id);
                    }}
                    onContinueTrip={() => navigation.navigate('ActiveTrip', { tripId: trip.id })}
                    startTripLoading={startingTripId === trip.id}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Support FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => setSupportModalVisible(true)}
      >
        <MaterialIcons name="chat" size={26} color="#3D2B00" />
      </TouchableOpacity>

      {/* Support Modal */}
      <Modal
        visible={supportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSupportModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSupportModalVisible(false)}
        />
        <View style={styles.supportModalCard}>
          <TouchableOpacity
            style={styles.supportModalClose}
            onPress={() => setSupportModalVisible(false)}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={20} color="#6B7280" />
          </TouchableOpacity>

          <Text style={styles.supportModalTitle}>Como podemos ajudar?</Text>
          <Text style={styles.supportModalSubtitle}>
            Escolha uma das opções abaixo{'\n'}para entrar em contato
          </Text>

          <TouchableOpacity
            style={styles.supportItem}
            activeOpacity={0.8}
            onPress={() => { setSupportModalVisible(false); Linking.openURL(SUPPORT_PHONE); }}
          >
            <View style={styles.supportIconWrap}>
              <MaterialIcons name="phone" size={22} color="#92400E" />
            </View>
            <Text style={styles.supportItemText}>Ligar para o suporte Take Me</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.supportItem}
            activeOpacity={0.8}
            onPress={() => {
              void (async () => {
                setSupportModalVisible(false);
                const { conversationId, error } = await getOrCreateActiveSupportConversationId(supabase);
                if (error || !conversationId) {
                  showAlert('Suporte', error ?? 'Não foi possível abrir o chat.');
                  return;
                }
                navigation.navigate('Profile', {
                  screen: 'Chat',
                  params: {
                    conversationId,
                    participantName: 'Suporte Take Me',
                  },
                });
              })();
            }}
          >
            <View style={styles.supportIconWrap}>
              <MaterialIcons name="headset-mic" size={22} color="#92400E" />
            </View>
            <Text style={styles.supportItemText}>Chat com o suporte Take Me</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.supportItem}
            activeOpacity={0.8}
            onPress={() => { setSupportModalVisible(false); Linking.openURL(SUPPORT_WHATSAPP); }}
          >
            <View style={styles.supportIconWrap}>
              <MaterialIcons name="forum" size={22} color="#92400E" />
            </View>
            <Text style={styles.supportItemText}>WhatsApp do Take Me</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Filter Modal */}
      <Modal
        visible={filterVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterVisible(false)}
      >
        <KeyboardAvoidingView style={styles.filterModalRoot} behavior="padding">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setFilterVisible(false)}
        />
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Filtrar atividades</Text>

          {/* Category chips */}
          <View style={styles.chipRow}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat}
                onPress={() => setFilterCategory(cat)}
                activeOpacity={0.7}
                style={[
                  styles.categoryChip,
                  filterCategory === cat && styles.categoryChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    filterCategory === cat && styles.categoryChipTextActive,
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Date section */}
          <Text style={styles.dateLabel}>Data da atividade</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateInputWrap}>
              <Text style={styles.dateInputLabel}>Data inicial</Text>
              <TextInput
                style={styles.dateInput}
                value={filterDateStartDisplay}
                placeholder="dd/mm/aaaa"
                placeholderTextColor="#9CA3AF"
                onChangeText={(text) => {
                  const masked = applyDateMask(text);
                  setFilterDateStartDisplay(masked);
                  const digits = text.replace(/\D/g, '');
                  if (digits.length === 8) {
                    setFilterDateStart(`${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`);
                  } else {
                    setFilterDateStart('');
                  }
                }}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                maxLength={10}
              />
            </View>
            <View style={styles.dateInputWrap}>
              <Text style={styles.dateInputLabel}>Data final</Text>
              <TextInput
                style={styles.dateInput}
                value={filterDateEndDisplay}
                placeholder="dd/mm/aaaa"
                placeholderTextColor="#9CA3AF"
                onChangeText={(text) => {
                  const masked = applyDateMask(text);
                  setFilterDateEndDisplay(masked);
                  const digits = text.replace(/\D/g, '');
                  if (digits.length === 8) {
                    setFilterDateEnd(`${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`);
                  } else {
                    setFilterDateEnd('');
                  }
                }}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                maxLength={10}
              />
            </View>
          </View>

          {/* Apply button */}
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={applyFilter}
            activeOpacity={0.85}
          >
            <Text style={styles.applyBtnText}>Aplicar filtro</Text>
          </TouchableOpacity>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const GOLD = '#C9A227';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerSpacer: { width: 40 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    flex: 1,
  },
  filterBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Scroll
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 14,
  },
  supportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  supportBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#78350F',
    lineHeight: 19,
  },
  historyChip: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  historyChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },

  // Section title
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: GOLD,
    marginBottom: 12,
    marginTop: 20,
  },

  // Empty / loading
  center: { paddingTop: 60, alignItems: 'center' },
  emptyState: { paddingTop: 80, alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#9CA3AF', textAlign: 'center' },

  // Trip card
  card: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tripCode: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  badgeConfirmed: { backgroundColor: '#D1FAE5' },
  badgePlanned: { backgroundColor: '#F3F4F6' },
  badgeInProgress: { backgroundColor: '#FEF3C7' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeTextConfirmed: { color: '#065F46' },
  badgeTextPlanned: { color: '#374151' },
  badgeTextInProgress: { color: '#92400E' },
  blockedStartHint: {
    marginTop: 12,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    textAlign: 'center',
  },

  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 4,
  },
  routeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    flexShrink: 1,
  },
  routeArrow: { marginHorizontal: 4 },

  offerPausedHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#92400E',
    lineHeight: 16,
  },
  dateText: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 10,
  },

  contentBlock: {
    marginBottom: 10,
    gap: 8,
  },
  contentRowTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    rowGap: 6,
  },
  contentItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contentItemTop: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
  },
  contentShipmentRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    width: '100%',
  },
  contentLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  contentValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
  },
  contentValueShipment: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },

  barContainer: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    marginVertical: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  barLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  trunkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trunkStepper: {
    flexDirection: 'row',
    gap: 4,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  btnStartTrip: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  btnStartTripText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  btnContinueTrip: {
    backgroundColor: '#C9A227',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  btnContinueTripText: { fontSize: 15, fontWeight: '700', color: '#111827' },
  linkBtn: { alignItems: 'center', paddingTop: 4 },
  linkText: {
    fontSize: 14,
    color: '#111827',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },

  // Modal / bottom sheet
  filterModalRoot: { flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  categoryChip: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  categoryChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },

  dateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  dateInputWrap: { flex: 1 },
  dateInputLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },

  applyBtn: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C9A227',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },

  supportModalCard: {
    position: 'absolute',
    top: '50%',
    left: 20,
    right: 20,
    transform: [{ translateY: -200 }],
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
  },
  supportModalClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    marginRight: 32,
  },
  supportModalSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 19,
    marginBottom: 24,
  },
  supportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  supportIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportItemText: { flex: 1, fontSize: 15, fontWeight: '500', color: '#111827' },
});
