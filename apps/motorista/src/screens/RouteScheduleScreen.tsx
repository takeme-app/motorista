import { useState, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Pressable,
  InteractionManager,
  Alert,
} from 'react-native';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
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
import {
  coordsForScheduledTripFromRoute,
  normalizeRouteTimeForSchedule,
  computeNextDepartureArrivalFromWeekday,
} from '../lib/routeScheduleTimes';
import { ensureWorkerRouteHasCoordinates } from '../lib/ensureWorkerRouteCoordinates';

type Props = NativeStackScreenProps<ProfileStackParamList, 'RouteSchedule'>;

const GOLD = '#C9A227';
const DAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
const DAY_SHORT_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
// day_of_week: 1=Mon ... 6=Sat, 0=Sun

type TripRow = {
  id: string;
  day_of_week: number;
  departure_time: string | null;
  arrival_time: string | null;
  capacity: number;
  confirmed_count: number;
  price_per_person_cents: number;
  is_active: boolean;
  status: string | null;
};

type DayToggle = Record<number, boolean>;

type PriceAdjust = {
  weekend: string;
  nocturnal: string;
  holiday: string;
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function isNocturnalTime(departureTime: string | null | undefined): boolean {
  if (!departureTime) return false;
  const match = /^(\d{1,2}):(\d{2})/.exec(departureTime);
  if (!match) return false;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return false;
  return hour >= 22 || hour < 6;
}

/**
 * Aplica ganhos adicionais (fim de semana / noturno / feriado) ao valor total
 * da viagem. A verificação de feriado é externa (backoffice/calendário) —
 * a UI aqui apenas persiste o % e, por enquanto, não o aplica ao preview.
 */
function totalValue(
  base: number,
  count: number,
  adjust: PriceAdjust,
  dayIdx: number,
  departureTime: string | null | undefined,
): number {
  const isWeekend = dayIdx === 5 || dayIdx === 6;
  const isNocturnal = isNocturnalTime(departureTime);
  let total = base * count;
  if (isWeekend) {
    const pct = parseFloat(adjust.weekend) || 0;
    total *= 1 + pct / 100;
  }
  if (isNocturnal) {
    const pct = parseFloat(adjust.nocturnal) || 0;
    total *= 1 + pct / 100;
  }
  return total;
}

export function RouteScheduleScreen({ navigation, route }: Props) {
  const { routeId, routeName } = route.params;
  const { showAlert } = useAppAlert();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayToggles, setDayToggles] = useState<DayToggle>({});
  const [priceAdjust, setPriceAdjust] = useState<PriceAdjust>({ weekend: '15', nocturnal: '15', holiday: '15' });
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [addingDayIdx, setAddingDayIdx] = useState(0);
  const [newDepart, setNewDepart] = useState('');
  const [newArrive, setNewArrive] = useState('');
  const [newCapacity, setNewCapacity] = useState('4');
  const [addSaving, setAddSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(400)).current;

  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [transferTripId, setTransferTripId] = useState<string | null>(null);
  const [transferTargetDay, setTransferTargetDay] = useState(0);
  const [transferSaving, setTransferSaving] = useState(false);
  const transferSlideAnim = useRef(new Animated.Value(400)).current;
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setTrips([]);
      setDayToggles({});
      if (!silent) setLoading(false);
      return;
    }
    const [tripsRes, routeRes] = await Promise.all([
      supabase
        .from('scheduled_trips')
        .select(
          'id, day_of_week, departure_time, arrival_time, capacity, confirmed_count, price_per_person_cents, is_active, status',
        )
        .eq('route_id', routeId)
        .eq('driver_id', user.id)
        .in('status', ['active', 'scheduled'])
        .order('day_of_week', { ascending: true }),
      (supabase as any)
        .from('worker_routes')
        .select('weekend_surcharge_pct, nocturnal_surcharge_pct, holiday_surcharge_pct')
        .eq('id', routeId)
        .maybeSingle(),
    ]);

    const error = tripsRes.error;
    const data = tripsRes.data;

    if (error) {
      console.warn('[RouteScheduleScreen] scheduled_trips', error.message);
      setTrips([]);
      setDayToggles({});
      if (!silent) setLoading(false);
      return;
    }

    const rows = (data ?? []) as TripRow[];
    setTrips(rows);
    const toggles: DayToggle = {};
    for (const t of rows) {
      const idx = t.day_of_week === 0 ? 6 : t.day_of_week - 1;
      toggles[idx] = (toggles[idx] ?? false) || Boolean(t.is_active);
    }
    setDayToggles(toggles);

    const surcharges = routeRes.data as
      | {
          weekend_surcharge_pct?: number | null;
          nocturnal_surcharge_pct?: number | null;
          holiday_surcharge_pct?: number | null;
        }
      | null;
    if (surcharges) {
      setPriceAdjust({
        weekend: String(Number(surcharges.weekend_surcharge_pct ?? 0)),
        nocturnal: String(Number(surcharges.nocturnal_surcharge_pct ?? 0)),
        holiday: String(Number(surcharges.holiday_surcharge_pct ?? 0)),
      });
    }
    if (!silent) setLoading(false);
  }, [routeId]);

  useFocusEffect(useCallback(() => {
    void load({ silent: false });
  }, [load]));

  const dayTrips = (dayIdx: number) =>
    trips.filter((t) => {
      const idx = t.day_of_week === 0 ? 6 : t.day_of_week - 1;
      return idx === dayIdx;
    });

  const toggleDay = async (dayIdx: number, value: boolean) => {
    setDayToggles((p) => ({ ...p, [dayIdx]: value }));
    const dayNum = dayIdx === 6 ? 0 : dayIdx + 1;
    try {
      if (value) {
        const rowsToEnable: { id: string; dep: string; arr: string }[] = [];
        for (const t of dayTrips(dayIdx)) {
          const dep = normalizeRouteTimeForSchedule(t.departure_time);
          const arr = normalizeRouteTimeForSchedule(t.arrival_time);
          if (dep && arr) rowsToEnable.push({ id: t.id, dep, arr });
        }
        if (rowsToEnable.length === 0) {
          const dayList = dayTrips(dayIdx);
          if (dayList.length === 0) {
            showAlert('Atenção', 'Não há viagens neste dia. Use + Adicionar viagem.');
          } else {
            showAlert(
              'Atenção',
              'Horários de partida ou chegada inválidos. Use HH:MM (ex.: 09:00 e 10:30).',
            );
          }
          await load({ silent: true });
          return;
        }
        const geoOk = await ensureWorkerRouteHasCoordinates(supabase, routeId);
        if (!geoOk.ok) {
          showAlert('Mapa', geoOk.message);
          await load({ silent: true });
          return;
        }
        const { data: routeGeoRow } = await supabase
          .from('worker_routes')
          .select('origin_lat, origin_lng, destination_lat, destination_lng, origin_address, destination_address')
          .eq('id', routeId)
          .single();
        const geo = coordsForScheduledTripFromRoute(
          (routeGeoRow ?? {}) as {
            origin_lat?: number | null;
            origin_lng?: number | null;
            destination_lat?: number | null;
            destination_lng?: number | null;
          },
        );

        for (const row of rowsToEnable) {
          const { departureAt, arrivalAt } = computeNextDepartureArrivalFromWeekday(
            dayNum,
            row.dep,
            row.arr,
          );
          const { error } = await supabase
            .from('scheduled_trips')
            .update(
              {
                is_active: true,
                status: 'active',
                departure_at: departureAt.toISOString(),
                arrival_at: arrivalAt.toISOString(),
                origin_lat: geo.origin_lat,
                origin_lng: geo.origin_lng,
                destination_lat: geo.destination_lat,
                destination_lng: geo.destination_lng,
                updated_at: new Date().toISOString(),
              } as never,
            )
            .eq('id', row.id);
          if (error) throw error;
        }
      } else {
        const { error } = await supabase
          .from('scheduled_trips')
          .update(
            {
              is_active: false,
              status: 'active',
              updated_at: new Date().toISOString(),
              driver_journey_started_at: null,
            } as never,
          )
          .eq('route_id', routeId)
          .eq('day_of_week', dayNum)
          .neq('status', 'completed')
          .neq('status', 'cancelled');
        if (error) throw error;
      }
    } catch {
      showAlert('Erro', 'Não foi possível atualizar o cronograma.');
    }
    await load({ silent: true });
  };

  const openAddModal = (dayIdx: number) => {
    setAddingDayIdx(dayIdx);
    setNewDepart(''); setNewArrive(''); setNewCapacity('4');
    resetDrag();
    slideAnim.setValue(400);
    setModalVisible(true);
    // useNativeDriver:false: Animated.add(slideAnim, dragY) + Modal evita travamento no iOS ao cadastrar horário.
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  };

  const closeModal = () => {
    Animated.timing(slideAnim, { toValue: 400, duration: 250, useNativeDriver: false })
      .start(() => setModalVisible(false));
  };

  const { dragY, panHandlers, resetDrag } = useBottomSheetDrag(closeModal, { useNativeDriver: false });

  const closeTransferModal = () => {
    Animated.timing(transferSlideAnim, { toValue: 400, duration: 250, useNativeDriver: false })
      .start(() => setTransferModalVisible(false));
  };

  const { dragY: transferDragY, panHandlers: transferPanHandlers, resetDrag: resetTransferDrag } =
    useBottomSheetDrag(closeTransferModal, { useNativeDriver: false });

  const handleTransfer = async () => {
    if (!transferTripId || transferTargetDay === null) return;
    setTransferSaving(true);
    try {
      const dayNum = transferTargetDay === 6 ? 0 : transferTargetDay + 1;
      const moved = trips.find((x) => x.id === transferTripId);
      let patch: Record<string, unknown> = {
        day_of_week: dayNum,
        updated_at: new Date().toISOString(),
      };
      const depN = normalizeRouteTimeForSchedule(moved?.departure_time);
      const arrN = normalizeRouteTimeForSchedule(moved?.arrival_time);
      if (depN && arrN) {
        const { departureAt, arrivalAt } = computeNextDepartureArrivalFromWeekday(
          dayNum,
          depN,
          arrN,
        );
        patch = {
          ...patch,
          departure_at: departureAt.toISOString(),
          arrival_at: arrivalAt.toISOString(),
        };
      }
      await supabase.from('scheduled_trips')
        .update(patch as never)
        .eq('id', transferTripId);
      closeTransferModal();
      await load({ silent: true });
    } catch (e) {
      showAlert('Erro', 'Não foi possível transferir a viagem.');
    } finally {
      setTransferSaving(false);
    }
  };

  /** Soft delete: marca a scheduled_trip como cancelled+is_active=false.
   *  Trigger `sync_*_when_trip_cancelled` propaga cancelamento para
   *  bookings/shipments/dependent_shipments vinculados. Bloqueia se já há
   *  passageiros confirmados — nesse caso o motorista deve cancelar a viagem
   *  pelo fluxo normal (com reembolso/política aplicada). */
  const runDeleteTrip = async (tripId: string) => {
    setDeletingTripId(tripId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        showAlert('Erro', 'Não autenticado.');
        return;
      }
      const { error } = await supabase
        .from('scheduled_trips')
        .update({
          status: 'cancelled',
          is_active: false,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', tripId)
        .eq('driver_id', user.id);
      if (error) throw error;
      await load({ silent: true });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Não foi possível excluir o horário.';
      showAlert('Erro', msg);
    } finally {
      setDeletingTripId(null);
    }
  };

  const confirmDeleteTrip = (t: TripRow) => {
    if ((t.confirmed_count ?? 0) > 0) {
      showAlert(
        'Não é possível excluir',
        'Este horário já tem passageiros confirmados. Cancele a viagem por inteiro (com reembolso) no detalhe da viagem antes de excluir o horário.',
      );
      return;
    }
    const dayIdx = t.day_of_week === 0 ? 6 : t.day_of_week - 1;
    const dayLabel = DAYS[dayIdx] ?? '';
    const time = t.departure_time?.slice(0, 5) ?? '—';
    Alert.alert(
      'Excluir horário',
      `Remover a viagem de ${dayLabel} às ${time}? Esta ação não pode ser desfeita pela tela — o horário some do cronograma.`,
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: () => { void runDeleteTrip(t.id); } },
      ],
    );
  };

  const handleAddTrip = async () => {
    if (!newDepart.match(/^\d{1,2}:\d{2}$/)) { showAlert('Atenção', 'Informe horário de saída (ex: 06:00).'); return; }
    if (!newArrive.match(/^\d{1,2}:\d{2}$/)) { showAlert('Atenção', 'Informe horário de chegada (ex: 08:30).'); return; }
    const cap = parseInt(newCapacity, 10);
    if (!cap || cap < 1) { showAlert('Atenção', 'Capacidade inválida.'); return; }
    setAddSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Não autenticado.');

      const ensured = await ensureWorkerRouteHasCoordinates(supabase, routeId);
      if (!ensured.ok) {
        showAlert('Mapa', ensured.message);
        return;
      }

      const { data: routeData, error: routeErr } = await supabase
        .from('worker_routes')
        .select(
          'origin_address, destination_address, price_per_person_cents, origin_lat, origin_lng, destination_lat, destination_lng',
        )
        .eq('id', routeId)
        .single();
      if (routeErr || !routeData) throw new Error('Não foi possível carregar os dados da rota.');

      const r = routeData as {
        origin_address: string;
        destination_address: string;
        price_per_person_cents: number;
        origin_lat?: number | null;
        origin_lng?: number | null;
        destination_lat?: number | null;
        destination_lng?: number | null;
      };

      const geo = coordsForScheduledTripFromRoute(r);

      // dayNum: 0=Dom, 1=Seg … 6=Sáb (mesmo que JS Date.getDay())
      const dayNum = addingDayIdx === 6 ? 0 : addingDayIdx + 1;

      const { departureAt, arrivalAt } = computeNextDepartureArrivalFromWeekday(
        dayNum,
        newDepart,
        newArrive,
      );

      const { error } = await supabase.from('scheduled_trips').insert({
        driver_id: user.id,
        route_id: routeId,
        day_of_week: dayNum,
        departure_time: newDepart,
        arrival_time: newArrive,
        departure_at: departureAt.toISOString(),
        arrival_at: arrivalAt.toISOString(),
        capacity: cap,
        seats_available: cap,
        bags_available: 0,
        confirmed_count: 0,
        is_active: true,
        status: 'active',
        origin_address: r.origin_address,
        destination_address: r.destination_address,
        price_per_person_cents: r.price_per_person_cents,
        origin_lat: geo.origin_lat,
        origin_lng: geo.origin_lng,
        destination_lat: geo.destination_lat,
        destination_lng: geo.destination_lng,
      });
      if (error) throw error;
      closeModal();
      await new Promise<void>((r) => {
        InteractionManager.runAfterInteractions(() => r());
      });
      await load({ silent: true });
    } catch (e: unknown) {
      const msg =
        typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Erro ao adicionar viagem.';
      closeModal();
      slideAnim.setValue(400);
      setModalVisible(false);
      setTimeout(() => showAlert('Erro', msg), 0);
    } finally {
      setAddSaving(false);
    }
  };

  const saveAdjustments = async () => {
    setSavingAdjust(true);
    await supabase
      .from('worker_routes')
      .update({
        weekend_surcharge_pct: parseFloat(priceAdjust.weekend) || 0,
        nocturnal_surcharge_pct: parseFloat(priceAdjust.nocturnal) || 0,
        holiday_surcharge_pct: parseFloat(priceAdjust.holiday) || 0,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', routeId);
    setSavingAdjust(false);
    showAlert('Ajustes', 'Ajustes salvos com sucesso.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cronograma da rota</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#111827" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>Roteiro da semana atual</Text>

          {DAYS.map((day, idx) => {
            const dTrips = dayTrips(idx);
            const enabled = dayToggles[idx] ?? false;

            return (
              <View key={day} style={[styles.dayCard, !enabled && styles.dayCardDisabled]}>
                <View style={styles.dayHeader}>
                  <View>
                    <Text style={styles.dayName}>{day}</Text>
                    <Text style={styles.dayCount}>{dTrips.length} {dTrips.length === 1 ? 'viagem' : 'viagens'}</Text>
                  </View>
                  <Switch
                    value={enabled}
                    onValueChange={(v) => toggleDay(idx, v)}
                    trackColor={{ false: '#E5E7EB', true: '#111827' }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {dTrips.map((t) => {
                  const total = totalValue(
                    t.price_per_person_cents,
                    t.confirmed_count,
                    priceAdjust,
                    idx,
                    t.departure_time,
                  );
                  return (
                    <View key={t.id} style={styles.tripCard}>
                      <View style={styles.tripRoute}>
                        <Text style={styles.tripRouteText}>{routeName}</Text>
                      </View>
                      <View style={styles.tripTimes}>
                        <Text style={styles.tripTime}>{t.departure_time?.slice(0, 5) ?? '—'}</Text>
                        <MaterialIcons name="arrow-forward" size={14} color="#9CA3AF" />
                        <Text style={styles.tripTime}>{t.arrival_time?.slice(0, 5) ?? '—'}</Text>
                      </View>
                      <Text style={styles.tripSeats}>{t.capacity} lugares</Text>
                      <Text style={styles.tripConfirmed}>{t.confirmed_count} passageiros confirmados</Text>
                      <View style={styles.tripPriceRow}>
                        <Text style={styles.tripPriceLabel}>Valor por pessoa</Text>
                        <Text style={styles.tripPriceValue}>{formatCents(t.price_per_person_cents)}</Text>
                      </View>
                      <View style={styles.tripPriceRow}>
                        <Text style={styles.tripPriceLabel}>Valor total da viagem</Text>
                        <Text style={[styles.tripPriceValue, { color: GOLD }]}>{formatCents(total)}</Text>
                      </View>
                      <View style={styles.tripActionsRow}>
                        <TouchableOpacity style={styles.actionRow} onPress={() => {
                          setTransferTripId(t.id);
                          setTransferTargetDay(idx);
                          resetTransferDrag();
                          transferSlideAnim.setValue(400);
                          setTransferModalVisible(true);
                          Animated.spring(transferSlideAnim, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
                        }} activeOpacity={0.7}>
                          <MaterialIcons name="swap-horiz" size={18} color="#111827" />
                          <Text style={styles.actionLabel}>Transferir viagem</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionRow}
                          onPress={() => confirmDeleteTrip(t)}
                          disabled={deletingTripId === t.id}
                          activeOpacity={0.7}
                          accessibilityLabel="Excluir horário"
                        >
                          {deletingTripId === t.id ? (
                            <ActivityIndicator size="small" color="#EF4444" />
                          ) : (
                            <MaterialIcons name="delete-outline" size={18} color="#EF4444" />
                          )}
                          <Text style={[styles.actionLabel, styles.actionLabelDanger]}>Excluir horário</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => openAddModal(idx)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="add" size={18} color="#111827" />
                  <Text style={styles.actionLabel}>Adicionar viagem</Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {/* Ajustes de preços */}
          <Text style={styles.adjustTitle}>Ajustes de preços desta semana</Text>

          {[
            { label: 'Adicional fim de semana (%)', key: 'weekend', base: 150 },
            { label: 'Adicional noturno (%)', key: 'nocturnal', base: 125 },
            { label: 'Adicional feriado (%)', key: 'holiday', base: 125 },
          ].map((item) => (
            <View key={item.key} style={styles.adjustGroup}>
              <Text style={styles.adjustLabel}>{item.label}</Text>
              <TextInput
                style={styles.adjustInput}
                value={priceAdjust[item.key as keyof PriceAdjust]}
                onChangeText={(v) => setPriceAdjust((p) => ({ ...p, [item.key]: v.replace(/[^0-9.]/g, '') }))}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#9CA3AF"
              />
              <Text style={styles.adjustHint}>
                Valor da viagem + adicional{'  '}
                <Text style={styles.adjustHintValue}>
                  R$ {item.base},00
                </Text>
              </Text>
            </View>
          ))}

          <TouchableOpacity
            style={[styles.saveAdjBtn, savingAdjust && { opacity: 0.6 }]}
            onPress={saveAdjustments}
            disabled={savingAdjust}
            activeOpacity={0.85}
          >
            {savingAdjust
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.saveAdjBtnText}>Salvar ajustes</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => setPriceAdjust({ weekend: '', nocturnal: '', holiday: '' })}
            activeOpacity={0.7}
          >
            <Text style={styles.clearBtnText}>Limpar campos</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Transferir viagem modal */}
      <Modal visible={transferModalVisible} transparent animationType="none" onRequestClose={closeTransferModal}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior="padding"
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeTransferModal} />
          <Animated.View style={[styles.sheet, { transform: [{ translateY: Animated.add(transferSlideAnim, transferDragY) }] }]}>
            <View style={styles.handleArea} {...transferPanHandlers}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.sheetTopRow}>
              <Text style={styles.sheetTitle}>Transferir viagem</Text>
              <TouchableOpacity style={styles.iconBtn} onPress={closeTransferModal} activeOpacity={0.7}>
                <MaterialIcons name="close" size={20} color="#111827" />
              </TouchableOpacity>
            </View>
            <View style={styles.sheetDivider} />
            <Text style={styles.fieldLabel}>Escolha o novo dia da semana para esta viagem.</Text>
            <View style={styles.dayChipsRow}>
              {DAY_SHORT_LABELS.map((label, i) => (
                <TouchableOpacity
                  key={label}
                  style={[styles.dayChip, transferTargetDay === i && styles.dayChipSelected]}
                  onPress={() => setTransferTargetDay(i)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayChipText, transferTargetDay === i && styles.dayChipTextSelected]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.addBtn, transferSaving && { opacity: 0.6 }]}
              onPress={handleTransfer}
              disabled={transferSaving}
              activeOpacity={0.85}
            >
              {transferSaving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.addBtnText}>Confirmar transferência</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={styles.transferCancelBtn} onPress={closeTransferModal} disabled={transferSaving} activeOpacity={0.7}>
              <Text style={styles.transferCancelText}>Voltar</Text>
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Nova viagem modal */}
      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior="padding"
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeModal} />
          <Animated.View style={[styles.sheet, { transform: [{ translateY: Animated.add(slideAnim, dragY) }] }]}>
            <View style={styles.handleArea} {...panHandlers}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.sheetTopRow}>
              <Text style={styles.sheetTitle}>Nova viagem</Text>
              <TouchableOpacity style={styles.iconBtn} onPress={closeModal} activeOpacity={0.7}>
                <MaterialIcons name="close" size={20} color="#111827" />
              </TouchableOpacity>
            </View>
            <View style={styles.sheetDivider} />

            <Text style={styles.fieldLabel}>Horário de saída</Text>
            <TextInput
              style={styles.input}
              placeholder="00:00"
              placeholderTextColor="#9CA3AF"
              value={newDepart}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 4);
                if (digits.length <= 2) {
                  setNewDepart(digits);
                } else {
                  setNewDepart(digits.slice(0, 2) + ':' + digits.slice(2));
                }
              }}
              keyboardType="numeric"
              maxLength={5}
            />

            <Text style={styles.fieldLabel}>Horário de chegada</Text>
            <TextInput
              style={styles.input}
              placeholder="00:00"
              placeholderTextColor="#9CA3AF"
              value={newArrive}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 4);
                if (digits.length <= 2) {
                  setNewArrive(digits);
                } else {
                  setNewArrive(digits.slice(0, 2) + ':' + digits.slice(2));
                }
              }}
              keyboardType="numeric"
              maxLength={5}
            />

            <Text style={styles.fieldLabel}>Capacidade</Text>
            <TextInput
              style={styles.input}
              placeholder="4"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              maxLength={2}
              value={newCapacity}
              onChangeText={(v) => setNewCapacity(v.replace(/\D/g, ''))}
            />

            <TouchableOpacity
              style={[styles.addBtn, addSaving && { opacity: 0.6 }]}
              onPress={handleAddTrip}
              disabled={addSaving}
              activeOpacity={0.85}
            >
              {addSaving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.addBtnText}>Adicionar</Text>
              }
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING, paddingBottom: 12,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  scroll: { paddingHorizontal: 16, paddingBottom: 48 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginVertical: 16 },
  dayCard: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16,
    padding: 16, marginBottom: 12,
  },
  dayCardDisabled: { opacity: 0.6 },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  dayName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  dayCount: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  tripCard: {
    backgroundColor: '#F9FAFB', borderRadius: 12, padding: 14, marginBottom: 10,
  },
  tripRoute: { marginBottom: 4 },
  tripRouteText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  tripTimes: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  tripTime: { fontSize: 13, fontWeight: '500', color: '#374151' },
  tripSeats: { fontSize: 13, color: '#6B7280', marginBottom: 2 },
  tripConfirmed: { fontSize: 13, color: '#6B7280', marginBottom: 8 },
  tripPriceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tripPriceLabel: { fontSize: 13, color: '#6B7280' },
  tripPriceValue: { fontSize: 13, fontWeight: '600', color: '#111827' },
  tripActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6',
    flex: 1,
  },
  actionLabel: { fontSize: 14, color: '#111827', fontWeight: '500' },
  actionLabelDanger: { color: '#EF4444' },
  adjustTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 24, marginBottom: 16 },
  adjustGroup: { marginBottom: 16 },
  adjustLabel: { fontSize: 14, color: '#6B7280', marginBottom: 6 },
  adjustInput: {
    backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#111827', marginBottom: 4,
  },
  adjustHint: { fontSize: 12, color: '#9CA3AF' },
  adjustHintValue: { fontWeight: '600', color: '#374151' },
  saveAdjBtn: {
    backgroundColor: '#111827', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
  },
  saveAdjBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  clearBtn: { alignItems: 'center', paddingVertical: 14 },
  clearBtnText: { color: '#6B7280', fontSize: 15, fontWeight: '500' },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  handleArea: { paddingTop: 14, paddingBottom: 6, alignItems: 'center', marginBottom: -6 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' },
  sheetTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  sheetDivider: { height: 1, backgroundColor: '#E5E7EB', marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#111827', marginTop: 12, marginBottom: 8 },
  input: {
    backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#111827',
  },
  addBtn: {
    backgroundColor: '#111827', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
  },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dayChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },
  dayChip: {
    backgroundColor: '#F3F4F6', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  dayChipSelected: { backgroundColor: '#111827' },
  dayChipText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  dayChipTextSelected: { color: '#FFFFFF' },
  transferCancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  transferCancelText: { color: '#EF4444', fontSize: 15, fontWeight: '600' },
});
