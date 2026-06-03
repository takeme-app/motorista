import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { tripDisplayEarningsCents } from '../lib/driverTripEarnings';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'TripHistory'>;

const GOLD = '#C9A227';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Booking = {
  id: string;
  passenger_count: number | null;
  bags_count: number | null;
  status: string;
  amount_cents: number;
  worker_earning_cents?: number | null;
};

type Trip = {
  id: string;
  origin_address: string;
  destination_address: string;
  departure_at: string;
  status: 'completed' | 'cancelled';
  amount_cents?: number | null;
  bookings: Booking[];
  shipmentsCount: number;
  dependentsCount: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.getDate();
    const mon = PT_MONTHS[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mon} • ${hh}:${mm}`;
  } catch {
    return '—';
  }
}

function shortAddr(addr: string): string {
  return addr.split(',')[0]?.trim() ?? addr;
}

type TripCounts = { pax: number; bags: number; enc: number; dep: number };

function tripCounts(trip: Trip): TripCounts {
  const pax = trip.bookings.reduce((s, b) => s + (b.passenger_count ?? 0), 0);
  const bags = trip.bookings.reduce((s, b) => s + (b.bags_count ?? 0), 0);
  return { pax, bags, enc: trip.shipmentsCount, dep: trip.dependentsCount };
}

/** Tipo principal da viagem para rótulo/ícone (Viagem/Encomenda/Dependente/Misto). */
function tripKind(trip: Trip): { label: string; icon: 'car' | 'box' | 'people' } {
  const { pax, enc, dep } = tripCounts(trip);
  const kinds = [pax > 0, enc > 0, dep > 0].filter(Boolean).length;
  if (kinds > 1) return { label: 'Misto', icon: 'car' };
  if (enc > 0) return { label: 'Encomenda', icon: 'box' };
  if (dep > 0) return { label: 'Dependente', icon: 'people' };
  return { label: 'Viagem', icon: 'car' };
}

function subtitleForTrip(trip: Trip): string {
  const { pax, bags, enc, dep } = tripCounts(trip);
  const parts: string[] = [];
  if (pax > 0) parts.push(`${pax} passageiro${pax !== 1 ? 's' : ''}`);
  if (enc > 0) parts.push(`${enc} encomenda${enc !== 1 ? 's' : ''}`);
  if (dep > 0) parts.push(`${dep} dependente${dep !== 1 ? 's' : ''}`);
  if (parts.length === 0 && bags > 0) parts.push(`${bags} pacote${bags !== 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' • ') : '—';
}

function formatEarnings(trip: Trip): string {
  const cents = tripDisplayEarningsCents(trip.bookings, trip.amount_cents ?? null);
  if (cents <= 0) return '';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Trip Row ──────────────────────────────────────────────────────────────────

function TripRow({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const kind = tripKind(trip);
  const isCompleted = trip.status === 'completed';
  const earningsLabel = formatEarnings(trip);

  return (
    <TouchableOpacity style={styles.tripRow} onPress={onPress} activeOpacity={0.75}>
      {/* Icon por tipo */}
      <View style={styles.tripIcon}>
        {kind.icon === 'box' ? (
          <MaterialIcons name="inventory-2" size={28} color="#9CA3AF" />
        ) : kind.icon === 'people' ? (
          <MaterialIcons name="groups" size={28} color="#9CA3AF" />
        ) : (
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../assets/ChatGPT Image Oct 2, 2025 at 06_08_38 PM.png')}
            style={styles.tripIconImage}
            resizeMode="contain"
          />
        )}
      </View>

      {/* Content */}
      <View style={styles.tripContent}>
        <View style={styles.tripTitleRow}>
          <Text style={styles.tripDestination} numberOfLines={1}>
            {shortAddr(trip.destination_address)}
          </Text>
          <View style={styles.kindChip}>
            <Text style={styles.kindChipText}>{kind.label}</Text>
          </View>
        </View>
        <Text style={styles.tripMeta} numberOfLines={1}>
          {formatDateTime(trip.departure_at)}
          {'  '}
          <Text style={styles.tripMetaSub}>{subtitleForTrip(trip)}</Text>
        </Text>
        {earningsLabel ? (
          <Text style={styles.tripEarnings} numberOfLines={1}>
            {earningsLabel}
          </Text>
        ) : null}
      </View>

      {/* Badge */}
      <View style={isCompleted ? styles.badgeCompleted : styles.badgeCancelled}>
        <Text style={isCompleted ? styles.badgeCompletedText : styles.badgeCancelledText}>
          {isCompleted ? 'Concluída' : 'Cancelada'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Section ───────────────────────────────────────────────────────────────────

function Section({
  title,
  titleColor,
  trips,
  emptyLabel,
  onPressTrip,
}: {
  title: string;
  titleColor: string;
  trips: Trip[];
  emptyLabel: string;
  onPressTrip: (id: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: titleColor }]}>{title}</Text>
      {trips.length === 0 ? (
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      ) : (
        trips.map((t, i) => (
          <View key={t.id}>
            <TripRow trip={t} onPress={() => onPressTrip(t.id)} />
            {i < trips.length - 1 && <View style={styles.separator} />}
          </View>
        ))
      )}
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export function TripHistoryScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState<Trip[]>([]);
  const [cancelled, setCancelled] = useState<Trip[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('scheduled_trips')
      .select(
        'id, origin_address, destination_address, departure_at, status, amount_cents, bookings(id, passenger_count, bags_count, status, amount_cents, worker_earning_cents)'
      )
      .eq('driver_id', user.id)
      .in('status', ['completed', 'cancelled'])
      .order('departure_at', { ascending: false });

    if (!error && data) {
      const rows = (data as unknown as Trip[]).map((r) => ({
        ...r,
        shipmentsCount: 0,
        dependentsCount: 0,
      }));

      // Conta encomendas e dependentes por viagem para identificar o tipo.
      const tripIds = rows.map((r) => r.id);
      if (tripIds.length > 0) {
        const [{ data: ships }, { data: deps }] = await Promise.all([
          supabase.from('shipments').select('scheduled_trip_id').in('scheduled_trip_id' as never, tripIds as never),
          supabase
            .from('dependent_shipments')
            .select('scheduled_trip_id')
            .in('scheduled_trip_id' as never, tripIds as never),
        ]);
        const shipCount: Record<string, number> = {};
        for (const s of (ships ?? []) as unknown as { scheduled_trip_id: string | null }[]) {
          if (s.scheduled_trip_id) shipCount[s.scheduled_trip_id] = (shipCount[s.scheduled_trip_id] ?? 0) + 1;
        }
        const depCount: Record<string, number> = {};
        for (const d of (deps ?? []) as unknown as { scheduled_trip_id: string | null }[]) {
          if (d.scheduled_trip_id) depCount[d.scheduled_trip_id] = (depCount[d.scheduled_trip_id] ?? 0) + 1;
        }
        for (const r of rows) {
          r.shipmentsCount = shipCount[r.id] ?? 0;
          r.dependentsCount = depCount[r.id] ?? 0;
        }
      }

      setCompleted(rows.filter((r) => r.status === 'completed'));
      setCancelled(rows.filter((r) => r.status === 'cancelled'));
    }

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goToDetail = (tripId: string) => navigation.navigate('TripDetail', { tripId });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="close" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Histórico de viagens</Text>
        {/* spacer to keep title centred */}
        <View style={styles.closeBtnSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Section
            title="Viagens concluídas"
            titleColor={GOLD}
            trips={completed}
            emptyLabel="Nenhuma viagem aqui."
            onPressTrip={goToDetail}
          />

          <View style={styles.sectionDivider} />

          <Section
            title="Viagens canceladas"
            titleColor="#6B7280"
            trips={cancelled}
            emptyLabel="Nenhuma viagem aqui."
            onPressTrip={goToDetail}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnSpacer: { width: 36 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },

  // Scroll
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  // Section
  section: { marginBottom: 8 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 24,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    paddingVertical: 8,
  },

  // Trip row
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  tripIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tripIconImage: {
    width: 40,
    height: 40,
  },
  tripContent: { flex: 1 },
  tripTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  kindChip: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kindChipText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  tripDestination: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    flexShrink: 1,
  },
  tripMeta: {
    fontSize: 13,
    color: '#6B7280',
  },
  tripMetaSub: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  tripEarnings: {
    fontSize: 14,
    fontWeight: '700',
    color: GOLD,
    marginTop: 4,
  },

  // Badges
  badgeCompleted: {
    backgroundColor: '#D1FAE5',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeCompletedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  badgeCancelled: {
    backgroundColor: '#FEE2E2',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeCancelledText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B91C1C',
  },

  // Separator between rows
  separator: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 60,
  },
});
