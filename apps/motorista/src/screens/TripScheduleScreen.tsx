import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ensureWorkerRouteHasCoordinates } from '../lib/ensureWorkerRouteCoordinates';
import { coordsForScheduledTripFromRoute } from '../lib/routeScheduleTimes';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

type Props = NativeStackScreenProps<ProfileStackParamList, 'TripSchedule'>;

const DAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
// day_of_week: 1=Mon ... 7=Sun (or 0-6)

type TripRow = {
  id: string;
  route_id: string | null;
  route_origin: string | null;
  route_destination: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  /** 0=Dom … 6=Sáb (igual a `Date.getDay()` e ao `day_of_week` gravado na rota). */
  effective_day_of_week: number;
  is_active: boolean;
  status: string | null;
};

type DayState = {
  vehicleType: 'principal' | 'reserva';
  statusActive: boolean;
};

/** Índice do cartão (0=Seg … 6=Dom) → dia JS (1=Seg … 6=Sáb, 0=Dom). */
function targetDowFromCardIndex(dayIdx: number): number {
  return dayIdx === 6 ? 0 : dayIdx + 1;
}

function effectiveDayOfWeek(row: {
  day_of_week: number | null;
  departure_at: string | null;
}): number | null {
  if (row.day_of_week !== null && row.day_of_week !== undefined) return row.day_of_week;
  if (row.departure_at) return new Date(row.departure_at).getDay();
  return null;
}

function formatTripTime(time: string | null | undefined, at: string | null | undefined): string {
  if (time?.trim()) return time.trim().slice(0, 5);
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  }
  return '—';
}

export function TripScheduleScreen({ navigation, route }: Props) {
  const { showAlert } = useAppAlert();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [dayStates, setDayStates] = useState<Record<number, DayState>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const baseSelect = `
          id, route_id, day_of_week, departure_time, arrival_time, departure_at, arrival_at,
          is_active, status,
          origin_address, destination_address
        `;
      let res = await supabase
        .from('scheduled_trips')
        .select(
          `${baseSelect},
          worker_routes ( origin_address, destination_address )`,
        )
        .eq('driver_id', user.id)
        .eq('is_active', true)
        .in('status', ['active', 'scheduled'])
        .order('departure_at', { ascending: true });

      if (res.error) {
        res = await supabase
          .from('scheduled_trips')
          .select(baseSelect)
          .eq('driver_id', user.id)
          .eq('is_active', true)
          .in('status', ['active', 'scheduled'])
          .order('departure_at', { ascending: true });
      }

      const { data, error } = res;
      if (error) {
        console.warn('[TripScheduleScreen] scheduled_trips', error.message);
        setTrips([]);
        setDayStates({});
        setLoading(false);
        return;
      }

      const raw = (data ?? []) as {
        id: string;
        route_id: string | null;
        day_of_week: number | null;
        departure_time: string | null;
        arrival_time: string | null;
        departure_at: string | null;
        arrival_at: string | null;
        is_active: boolean;
        status: string | null;
        origin_address: string | null;
        destination_address: string | null;
        worker_routes: { origin_address: string; destination_address: string } | null;
      }[];

      const rows: TripRow[] = [];
      for (const row of raw) {
        const ed = effectiveDayOfWeek(row);
        if (ed === null) continue;
        rows.push({
          id: row.id,
          route_id: row.route_id ?? null,
          effective_day_of_week: ed,
          departure_time: row.departure_time,
          arrival_time: row.arrival_time,
          departure_at: row.departure_at,
          arrival_at: row.arrival_at,
          is_active: row.is_active,
          status: row.status,
          route_origin: row.origin_address?.trim()
            ? row.origin_address
            : row.worker_routes?.origin_address ?? null,
          route_destination: row.destination_address?.trim()
            ? row.destination_address
            : row.worker_routes?.destination_address ?? null,
        });
      }

      rows.sort((a, b) => {
        const ta = a.departure_at ? new Date(a.departure_at).getTime() : 0;
        const tb = b.departure_at ? new Date(b.departure_at).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return (a.departure_time ?? '').localeCompare(b.departure_time ?? '');
      });

      setTrips(rows);
      const states: Record<number, DayState> = {};
      for (let d = 0; d < 7; d++) {
        const target = targetDowFromCardIndex(d);
        const first = rows.find((t) => t.effective_day_of_week === target);
        if (first) {
          states[d] = { vehicleType: 'principal', statusActive: first.is_active };
        }
      }
      setDayStates(states);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Realtime: status muda (active → completed/cancelled) ou is_active flipa
  // → recarrega para refletir sem precisar pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      let userId: string | null = null;
      let channel: ReturnType<typeof supabase.channel> | null = null;
      void (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;
        userId = user.id;
        channel = supabase
          .channel(`trip-schedule-${userId}`)
          .on(
            'postgres_changes' as never,
            { event: '*', schema: 'public', table: 'scheduled_trips', filter: `driver_id=eq.${userId}` } as never,
            () => { void load(); },
          )
          .subscribe();
      })();
      return () => { if (channel) void supabase.removeChannel(channel); };
    }, [load]),
  );

  const toggle = (dayIdx: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => (prev === dayIdx ? null : dayIdx));
  };

  const updateVehiclePrefOnly = (dayIdx: number, opt: 'principal' | 'reserva') => {
    setDayStates((prev) => ({
      ...prev,
      [dayIdx]: {
        vehicleType: opt,
        statusActive: prev[dayIdx]?.statusActive ?? true,
      },
    }));
  };

  const updateDayTripsActive = async (dayIdx: number, is_active: boolean) => {
    const target = targetDowFromCardIndex(dayIdx);
    const ids = trips.filter((t) => t.effective_day_of_week === target).map((t) => t.id);
    if (ids.length === 0) return;
    setSaving(ids[0]!);
    setDayStates((prev) => ({
      ...prev,
      [dayIdx]: {
        vehicleType: prev[dayIdx]?.vehicleType ?? 'principal',
        statusActive: is_active,
      },
    }));
    try {
      if (is_active) {
        const touched = trips.filter((t) => ids.includes(t.id));
        const routeIds = [...new Set(touched.map((t) => t.route_id).filter((x): x is string => Boolean(x)))];
        const geoByRoute = new Map<
          string,
          { origin_lat: number; origin_lng: number; destination_lat: number; destination_lng: number }
        >();
        for (const rid of routeIds) {
          const ok = await ensureWorkerRouteHasCoordinates(supabase, rid);
          if (!ok.ok) {
            showAlert('Mapa', ok.message);
            await load();
            return;
          }
          const { data: wr } = await supabase
            .from('worker_routes')
            .select('origin_lat, origin_lng, destination_lat, destination_lng')
            .eq('id', rid)
            .single();
          if (wr) {
            geoByRoute.set(
              rid,
              coordsForScheduledTripFromRoute(wr as {
                origin_lat?: number | null;
                origin_lng?: number | null;
                destination_lat?: number | null;
                destination_lng?: number | null;
              }),
            );
          }
        }
        const updActive = await Promise.all(
          ids.map((id) => {
            const trip = trips.find((t) => t.id === id);
            const rid = trip?.route_id;
            const geo = rid ? geoByRoute.get(rid) : undefined;
            const patch: Record<string, unknown> = {
              is_active: true,
              updated_at: new Date().toISOString(),
            };
            if (geo) {
              patch.origin_lat = geo.origin_lat;
              patch.origin_lng = geo.origin_lng;
              patch.destination_lat = geo.destination_lat;
              patch.destination_lng = geo.destination_lng;
            }
            return supabase.from('scheduled_trips').update(patch as never).eq('id', id);
          }),
        );
        for (const res of updActive) {
          if (res.error) throw res.error;
        }
      } else {
        const updOff = await Promise.all(
          ids.map((id) =>
            supabase
              .from('scheduled_trips')
              .update(
                {
                  is_active: false,
                  updated_at: new Date().toISOString(),
                  driver_journey_started_at: null,
                } as never,
              )
              .eq('id', id),
          ),
        );
        for (const res of updOff) {
          if (res.error) throw res.error;
        }
      }
      setTrips((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, is_active } : t)));
    } catch {
      showAlert('Erro', 'Não foi possível atualizar o status das viagens.');
      await load();
    } finally {
      setSaving(null);
    }
  };

  const dayTrips = (dayIdx: number) => {
    const target = targetDowFromCardIndex(dayIdx);
    return trips.filter((t) => t.effective_day_of_week === target);
  };

  function shortAddr(s: string | null) {
    if (!s) return '—';
    return s.split(',')[0]?.trim() ?? s;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => route.params?.fromHome ? (navigation.getParent() as any)?.navigate('Home') : navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cronograma de viagens</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.headerHint}>
        Cada linha é um trecho (origem → destino). Para oferecer volta, crie outra viagem com horário e sentido inversos.
      </Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#111827" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {DAYS.map((day, idx) => {
            const dayT = dayTrips(idx);
            const isOpen = expanded === idx;
            const tripCount = dayT.length;
            const ds = dayStates[idx];

            return (
              <View key={day} style={[styles.card, isOpen && styles.cardOpen]}>
                <TouchableOpacity style={styles.cardHeader} onPress={() => toggle(idx)} activeOpacity={0.7}>
                  <View>
                    <Text style={styles.dayName}>{day}</Text>
                    <Text style={styles.tripCount}>{tripCount} {tripCount === 1 ? 'viagem' : 'viagens'}</Text>
                  </View>
                  <MaterialIcons name={isOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={22} color="#6B7280" />
                </TouchableOpacity>

                {isOpen && dayT.length > 0 && (
                  <View style={styles.cardBody}>
                    <View style={styles.divider} />
                    {dayT.map((trip, tripIdx) => (
                      <View key={trip.id}>
                        {tripIdx > 0 ? <View style={[styles.divider, { marginTop: 6 }]} /> : null}
                        <View style={styles.tripRoute}>
                          <Text style={styles.tripOrigin}>{shortAddr(trip.route_origin)}</Text>
                          <View style={styles.arrowWrap}>
                            <MaterialIcons name="arrow-forward" size={18} color="#C9A227" />
                          </View>
                          <Text style={styles.tripDest}>{shortAddr(trip.route_destination)}</Text>
                        </View>

                        <View style={styles.timesRow}>
                          <Text style={styles.timeText}>{formatTripTime(trip.departure_time, trip.departure_at)}</Text>
                          <Text style={styles.timeText}>{formatTripTime(trip.arrival_time, trip.arrival_at)}</Text>
                        </View>
                      </View>
                    ))}

                    <View style={styles.divider} />

                    <Text style={styles.sectionLabel}>Definir tipo de uso do veículo</Text>

                    {(['principal', 'reserva'] as const).map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={styles.radioRow}
                        onPress={() => updateVehiclePrefOnly(idx, opt)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.radioOuter, (ds?.vehicleType ?? 'principal') === opt && styles.radioActive]}>
                          {(ds?.vehicleType ?? 'principal') === opt && <View style={styles.radioInner} />}
                        </View>
                        <View>
                          <Text style={styles.radioLabel}>{opt === 'principal' ? 'Principal' : 'Reserva'}</Text>
                          <Text style={styles.radioSub}>
                            {opt === 'principal' ? 'Veículo principal utilizado nas corridas.' : 'Usado apenas quando o principal estiver indisponível.'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>Status da viagem</Text>
                      <Switch
                        value={ds?.statusActive ?? true}
                        onValueChange={(v) => updateDayTripsActive(idx, v)}
                        trackColor={{ false: '#E5E7EB', true: '#111827' }}
                        thumbColor="#FFFFFF"
                        disabled={Boolean(saving && dayT.some((t) => t.id === saving))}
                      />
                    </View>
                  </View>
                )}

                {isOpen && dayT.length === 0 && (
                  <View style={styles.cardBody}>
                    <View style={styles.divider} />
                    <Text style={styles.emptyDay}>Nenhuma viagem neste dia.</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING, paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  headerHint: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  cardOpen: { borderColor: '#111827' },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 18,
  },
  dayName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  tripCount: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  cardBody: { paddingHorizontal: 20, paddingBottom: 18 },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 14 },
  tripRoute: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  tripOrigin: { fontSize: 16, fontWeight: '700', color: '#111827' },
  arrowWrap: { paddingHorizontal: 4 },
  tripDest: { fontSize: 16, fontWeight: '700', color: '#111827' },
  timesRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 22, fontWeight: '700', color: '#111827' },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 12 },
  radioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  radioActive: { borderColor: '#111827' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#111827' },
  radioLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  radioSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  statusLabel: { fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  emptyDay: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 8 },
});
