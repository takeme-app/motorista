import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../navigation/ActivitiesStackTypes';
import { supabase } from '../lib/supabase';
import { StatusBadge, clientViagemStatusBadge, type TripStatusBadge } from '../components/StatusBadge';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'TravelHistory'>;

type HistoryItem = {
  id: string;
  type: 'viagem' | 'envio';
  destinationOrId: string;
  dateTime: string;
  detailLine: string;
  badgeVariant: TripStatusBadge;
};

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
  green: '#166534',
  red: '#991b1b',
};

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  const month = months[d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} • ${hours}:${minutes}`;
}

export function TravelHistoryScreen({ navigation }: Props) {
  const [completed, setCompleted] = useState<HistoryItem[]>([]);
  const [cancelled, setCancelled] = useState<HistoryItem[]>([]);
  const [active, setActive] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCompleted([]);
      setCancelled([]);
      setActive([]);
      setLoading(false);
      return;
    }
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, origin_address, destination_address, status, created_at, cancellation_reason, scheduled_trips(status, driver_journey_started_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    const completedList: HistoryItem[] = [];
    const cancelledList: HistoryItem[] = [];
    const activeList: HistoryItem[] = [];
    (bookings ?? []).forEach((row) => {
      const b = row as {
        id: string;
        destination_address?: string;
        status?: string;
        created_at: string;
        cancellation_reason?: string | null;
        scheduled_trips?:
          | { status?: string; driver_journey_started_at?: string | null }
          | { status?: string; driver_journey_started_at?: string | null }[]
          | null;
      };
      const st = b.scheduled_trips;
      const tripStatus = Array.isArray(st) ? st[0]?.status : st?.status;
      const tripJourneyStartedAt = Array.isArray(st)
        ? st[0]?.driver_journey_started_at
        : st?.driver_journey_started_at;
      const badgeVariant = clientViagemStatusBadge(
        b.status,
        tripStatus ?? null,
        b.cancellation_reason,
        tripJourneyStartedAt ?? null,
      );
      const item: HistoryItem = {
        id: b.id,
        type: 'viagem',
        destinationOrId: b.destination_address ?? b.id.slice(0, 8).toUpperCase(),
        dateTime: formatHistoryDate(b.created_at),
        detailLine: '1 passageiro',
        badgeVariant,
      };
      if (badgeVariant === 'cancelada' || badgeVariant === 'reembolsada') cancelledList.push(item);
      else if (badgeVariant === 'concluida') completedList.push(item);
      else activeList.push(item);
    });
    setCompleted(completedList);
    setCancelled(cancelledList);
    setActive(activeList);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = ({ item }: { item: HistoryItem }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => navigation.navigate('TripDetail', { bookingId: item.id })}
      activeOpacity={0.7}
    >
      <View style={styles.iconWrap}>
        <MaterialIcons name="directions-car" size={24} color={COLORS.neutral700} />
      </View>
      <View style={styles.content}>
        <Text style={styles.destination} numberOfLines={1}>{item.destinationOrId}</Text>
        <Text style={styles.dateTime}>{item.dateTime}</Text>
        <Text style={styles.detailLine}>{item.detailLine}</Text>
      </View>
      <StatusBadge variant={item.badgeVariant} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn} hitSlop={12}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.title}>Histórico de viagens</Text>
        <View style={styles.headerSpacer} />
      </View>
      {loading ? (
        <View style={styles.centered}>
          <Text style={styles.subtitle}>Carregando...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {active.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: COLORS.neutral700 }]}>Em andamento ou aguardando</Text>
              {active.map((item) => (
                <View key={item.id}>{renderItem({ item })}</View>
              ))}
            </>
          )}
          {completed.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: COLORS.green }]}>Viagens concluídas</Text>
              {completed.map((item) => (
                <View key={item.id}>{renderItem({ item })}</View>
              ))}
            </>
          )}
          {cancelled.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: COLORS.red }]}>Viagens canceladas</Text>
              {cancelled.map((item) => (
                <View key={item.id}>{renderItem({ item })}</View>
              ))}
            </>
          )}
          {completed.length === 0 && cancelled.length === 0 && active.length === 0 && (
            <View style={styles.centered}>
              <Text style={styles.subtitle}>Nenhuma viagem no histórico</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  closeBtn: { padding: 4, width: 32 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  scroll: { flex: 1 },
  listContent: { paddingBottom: 40, paddingHorizontal: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  content: { flex: 1 },
  destination: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  dateTime: { fontSize: 14, color: COLORS.neutral700, marginTop: 2 },
  detailLine: { fontSize: 14, color: COLORS.neutral700, marginTop: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 15, color: COLORS.neutral700 },
});
