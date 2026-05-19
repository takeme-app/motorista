import { useState, useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image, type ImageSourcePropType } from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../navigation/ActivitiesStackTypes';
import { supabase } from '../lib/supabase';
import { formatActivityTotalPaidLine } from '../lib/tripDriverDisplay';
import {
  StatusBadge,
  clientViagemStatusBadge,
  clientDependentActivityStatusBadge,
  clientShipmentActivityStatusBadge,
  excursionRequestStatusToBadge,
  type ActivitySectionBadge,
  type TripStatusBadge,
} from '../components/StatusBadge';
import { SupportSheet } from '../components/SupportSheet';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ActivitiesList'>;

export type ActivityCategory = 'todas' | 'viagens' | 'envios' | 'dependente' | 'excursao';

export type ActivityItem = {
  id: string;
  type: 'viagem' | 'envio' | 'dependente' | 'excursao';
  title: string;
  originAddress?: string;
  dateTime: string;
  priceFormatted: string;
  categoryLabel: string;
  sectionBadge: ActivitySectionBadge;
  bookingStatus?: string;
  created_at: string;
  /** Resumo: passageiros, malas, encomendas na viagem, dependentes, tamanho do pacote, etc. */
  summaryLine?: string;
  /** Label do badge para excursões (Em análise, Agendado, Concluída, etc.) */
  excursionStatusLabel?: string;
  /** Status exibido no cartão (cores alinhadas a `StatusBadge` / Histórico de viagens). */
  statusBadgeVariant: TripStatusBadge;
  /** Sobrescreve o texto padrão do variant (ex.: excursões). */
  statusBadgeLabel?: string;
};

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

/** Nível do pacote de encomenda (mesma lógica do fluxo de envio: pequeno / médio / grande). */
function packageSizeSummaryLabel(size: string | null | undefined): string {
  switch (size) {
    case 'pequeno':
      return 'pequena';
    case 'medio':
      return 'média';
    case 'grande':
      return 'grande';
    default:
      return size?.trim() ? size : '—';
  }
}

function formatBookingDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  const month = months[d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} • ${hours}:${minutes}`;
}

const ACTIVITY_ICONS: Record<ActivityItem['type'], ImageSourcePropType> = {
  viagem: require('../../assets/icons/icon-atividade-tipo-viagem.png'),
  envio: require('../../assets/icons/icon-atividade-tipo-envio.png'),
  excursao: require('../../assets/icons/icon-atividade-tipo-excursao.png'),
  dependente: require('../../assets/icons/icon-atividade-tipo-enviodependente.png'),
};

const ACTIVITIES_FILTER_KEY = 'activities_filter';

type ActivitiesFilterValue = {
  category: ActivityCategory;
  dateStart: string | null;
  dateEnd: string | null;
};

export function ActivitiesScreen({ navigation }: Props) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<ActivityCategory>('todas');
  const [filterDateStart, setFilterDateStart] = useState<Date | null>(null);
  const [filterDateEnd, setFilterDateEnd] = useState<Date | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [supportSheetVisible, setSupportSheetVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const fabBottom = insets.bottom + 24 + 56;

  const loadFilterPreferences = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('user_preferences')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', ACTIVITIES_FILTER_KEY)
      .maybeSingle();
    const v = (data as { value?: ActivitiesFilterValue } | null)?.value;
    if (v?.category) setFilterCategory(v.category as ActivityCategory);
    if (v?.dateStart) setFilterDateStart(new Date(v.dateStart));
    if (v?.dateEnd) setFilterDateEnd(new Date(v.dateEnd));
  }, []);

  const saveFilterPreferences = useCallback(async (category: ActivityCategory, dateStart: Date | null, dateEnd: Date | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('user_preferences').upsert(
      {
        user_id: user.id,
        key: ACTIVITIES_FILTER_KEY,
        value: {
          category,
          dateStart: dateStart ? dateStart.toISOString() : null,
          dateEnd: dateEnd ? dateEnd.toISOString() : null,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,key' }
    );
  }, []);

  const loadActivities = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setActivities([]);
      setLoading(false);
      return;
    }
    const [bookingsRes, shipmentsRes, dependentShipmentsRes, excursionsRes] = await Promise.all([
      supabase
        .from('bookings')
        .select(
          'id, origin_address, destination_address, amount_cents, status, created_at, passenger_count, bags_count, scheduled_trip_id, cancellation_reason, scheduled_trips(status, driver_journey_started_at)',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('shipments')
        .select(
          'id, origin_address, destination_address, amount_cents, status, created_at, package_size, scheduled_trip_id, driver_id, cancellation_reason, scheduled_trips(status, driver_journey_started_at)',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('dependent_shipments')
        .select(
          'id, origin_address, destination_address, full_name, amount_cents, status, created_at, bags_count, scheduled_trip_id, cancellation_reason, scheduled_trips(status, driver_journey_started_at)',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('excursion_requests')
        .select(
          'id, destination, excursion_date, status, total_amount_cents, created_at, people_count',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const bookingRows = (bookingsRes.data ?? []) as {
      id: string;
      origin_address?: string;
      destination_address?: string;
      amount_cents?: number;
      status?: string;
      created_at: string;
      passenger_count?: number;
      bags_count?: number;
      scheduled_trip_id?: string | null;
      cancellation_reason?: string | null;
      scheduled_trips?:
        | { status?: string; driver_journey_started_at?: string | null }
        | { status?: string; driver_journey_started_at?: string | null }[]
        | null;
    }[];

    const tripIdsForShipments = [
      ...new Set(bookingRows.map((b) => b.scheduled_trip_id).filter((id): id is string => Boolean(id))),
    ];
    const shipmentCountByTripId = new Map<string, number>();
    if (tripIdsForShipments.length > 0) {
      const { data: shipTripRows } = await supabase
        .from('shipments')
        .select('scheduled_trip_id')
        .eq('user_id', user.id)
        .in('scheduled_trip_id', tripIdsForShipments)
        .neq('status', 'cancelled');
      for (const row of shipTripRows ?? []) {
        const tid = (row as { scheduled_trip_id?: string | null }).scheduled_trip_id;
        if (!tid) continue;
        shipmentCountByTripId.set(tid, (shipmentCountByTripId.get(tid) ?? 0) + 1);
      }
    }

    const bookingItems: ActivityItem[] = bookingRows.map((b) => {
      const s = (b as { status?: string }).status?.toLowerCase() ?? '';
      const sectionBadge: ActivitySectionBadge =
        s === 'paid' || s === 'in_progress' || s === 'confirmed' ? 'confirmada' : 'planejada';
      const st = b.scheduled_trips;
      const tripStatus = Array.isArray(st) ? st[0]?.status : st?.status;
      const tripJourneyStartedAt = Array.isArray(st)
        ? st[0]?.driver_journey_started_at
        : st?.driver_journey_started_at;
      const cr = (b as { cancellation_reason?: string | null }).cancellation_reason;
      const statusBadgeVariant = clientViagemStatusBadge(
        b.status,
        tripStatus ?? null,
        cr,
        tripJourneyStartedAt ?? null,
      );
      const dest = b.destination_address ?? 'Viagem';
      const origin = b.origin_address;
      const pax = Math.max(1, Math.floor(Number(b.passenger_count ?? 1)));
      const bags = Math.max(0, Math.floor(Number(b.bags_count ?? 0)));
      const tripId = b.scheduled_trip_id;
      const enc = tripId ? shipmentCountByTripId.get(tripId) ?? 0 : 0;
      const summaryParts = [
        `${pax} ${pax === 1 ? 'passageiro' : 'passageiros'}`,
        `${bags} ${bags === 1 ? 'mala' : 'malas'}`,
      ];
      if (enc > 0) {
        summaryParts.push(`${enc} ${enc === 1 ? 'encomenda' : 'encomendas'}`);
      }
      return {
        id: b.id,
        type: 'viagem',
        title: dest,
        originAddress: origin,
        dateTime: formatBookingDate(b.created_at),
        priceFormatted: formatActivityTotalPaidLine(b.amount_cents),
        categoryLabel: 'Viagem',
        sectionBadge,
        bookingStatus: b.status,
        created_at: b.created_at,
        summaryLine: summaryParts.join(' · '),
        statusBadgeVariant,
      };
    });
    const shipmentItems: ActivityItem[] = (shipmentsRes.data ?? []).map((s) => {
      const rawStatus = (s as { status?: string }).status;
      const status = rawStatus?.toLowerCase() ?? '';
      const sectionBadge: ActivitySectionBadge =
        status === 'confirmed' || status === 'in_progress' || status === 'delivered' ? 'confirmada' : 'planejada';
      const dest = (s as { destination_address?: string }).destination_address ?? 'Envio';
      const origin = (s as { origin_address?: string }).origin_address;
      const pkg = (s as { package_size?: string }).package_size;
      const encLabel = packageSizeSummaryLabel(pkg);
      const stShip = (s as {
        scheduled_trips?:
          | { status?: string; driver_journey_started_at?: string | null }
          | { status?: string; driver_journey_started_at?: string | null }[]
          | null;
      }).scheduled_trips;
      const tripStatusShip = Array.isArray(stShip) ? stShip[0]?.status : stShip?.status;
      const tripJourneyStartedShip = Array.isArray(stShip)
        ? stShip[0]?.driver_journey_started_at
        : stShip?.driver_journey_started_at;
      const statusBadgeVariant = clientShipmentActivityStatusBadge(
        rawStatus,
        (s as { cancellation_reason?: string | null }).cancellation_reason,
        (s as { driver_id?: string | null }).driver_id ?? null,
        tripStatusShip ?? null,
        undefined,
        tripJourneyStartedShip ?? null,
      );
      return {
        id: (s as { id: string }).id,
        type: 'envio',
        title: dest,
        originAddress: origin,
        dateTime: formatBookingDate((s as { created_at: string }).created_at),
        priceFormatted: formatActivityTotalPaidLine((s as { amount_cents?: number }).amount_cents),
        categoryLabel: 'Envio',
        sectionBadge,
        created_at: (s as { created_at: string }).created_at,
        summaryLine: `1 encomenda · tamanho ${encLabel}`,
        statusBadgeVariant,
      };
    });
    const dependentItems: ActivityItem[] = (dependentShipmentsRes.data ?? []).map((d) => {
      const rawStatus = (d as { status?: string }).status;
      const status = rawStatus?.toLowerCase() ?? '';
      const sectionBadge: ActivitySectionBadge =
        status === 'confirmed' || status === 'in_progress' || status === 'delivered' ? 'confirmada' : 'planejada';
      const dest = (d as { destination_address?: string }).destination_address ?? 'Envio dependente';
      const fullName = (d as { full_name?: string }).full_name;
      const title = fullName ? `Envio para ${fullName}` : dest;
      const origin = (d as { origin_address?: string }).origin_address;
      const depBags = Math.max(0, Math.floor(Number((d as { bags_count?: number }).bags_count ?? 0)));
      const stDep = (d as {
        scheduled_trips?:
          | { status?: string; driver_journey_started_at?: string | null }
          | { status?: string; driver_journey_started_at?: string | null }[]
          | null;
      }).scheduled_trips;
      const tripStatusDep = Array.isArray(stDep) ? stDep[0]?.status : stDep?.status;
      const tripJourneyStartedDep = Array.isArray(stDep)
        ? stDep[0]?.driver_journey_started_at
        : stDep?.driver_journey_started_at;
      const statusBadgeVariant = clientDependentActivityStatusBadge(
        rawStatus,
        (d as { cancellation_reason?: string | null }).cancellation_reason,
        tripStatusDep ?? null,
        tripJourneyStartedDep ?? null,
      );
      return {
        id: (d as { id: string }).id,
        type: 'dependente',
        title,
        originAddress: origin,
        dateTime: formatBookingDate((d as { created_at: string }).created_at),
        priceFormatted: formatActivityTotalPaidLine((d as { amount_cents?: number }).amount_cents),
        categoryLabel: 'Envio dependente',
        sectionBadge,
        created_at: (d as { created_at: string }).created_at,
        summaryLine: `1 dependente · ${depBags} ${depBags === 1 ? 'mala' : 'malas'}`,
        statusBadgeVariant,
      };
    });
    const excursionItems: ActivityItem[] = (excursionsRes.data ?? []).map((e) => {
      const status = (e as { status?: string }).status?.toLowerCase() ?? '';
      const isConfirmed = ['quoted', 'contacted', 'approved', 'scheduled', 'in_progress', 'completed'].includes(status);
      const sectionBadge: ActivitySectionBadge = isConfirmed ? 'confirmada' : 'planejada';
      const excursionStatusLabel =
        status === 'completed' ? 'Concluída'
        : status === 'cancelled' ? 'Cancelada'
        : status === 'in_progress' ? 'Em andamento'
        : ['scheduled', 'approved'].includes(status) ? 'Agendado'
        : ['quoted', 'in_analysis', 'pending', 'contacted'].includes(status) ? 'Em análise'
        : 'Planejada';
      const dest = (e as { destination?: string }).destination ?? 'Excursão';
      const excursionDate = (e as { excursion_date?: string }).excursion_date;
      const createdAt = (e as { created_at: string }).created_at;
      const totalCents = (e as { total_amount_cents?: number | null }).total_amount_cents;
      const people = Math.max(1, Math.floor(Number((e as { people_count?: number }).people_count ?? 1)));
      const dateTime = excursionDate
        ? (() => {
            const d = new Date(excursionDate + 'T00:00:00');
            const day = d.getDate();
            const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
            const month = months[d.getMonth()];
            return `${day} ${month}`;
          })()
        : formatBookingDate(createdAt);
      const priceFormatted =
        totalCents != null && totalCents > 0 ? formatActivityTotalPaidLine(totalCents) : '—';
      return {
        id: (e as { id: string }).id,
        type: 'excursao',
        title: dest ? `Excursão para ${dest}` : 'Excursão',
        dateTime,
        priceFormatted,
        categoryLabel: 'Excursão',
        sectionBadge,
        excursionStatusLabel,
        created_at: createdAt,
        summaryLine: `${people} ${people === 1 ? 'pessoa' : 'pessoas'}`,
        statusBadgeVariant: excursionRequestStatusToBadge(status),
        statusBadgeLabel: excursionStatusLabel,
      };
    });
    const combined = [...bookingItems, ...shipmentItems, ...dependentItems, ...excursionItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setActivities(combined);
    if (!silent) setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActivities();
    }, [loadActivities])
  );

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const uid = user.id;
      channel = supabase
        .channel(`client-activities-${uid}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${uid}` },
          () => {
            void loadActivities({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'shipments', filter: `user_id=eq.${uid}` },
          () => {
            void loadActivities({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'dependent_shipments', filter: `user_id=eq.${uid}` },
          () => {
            void loadActivities({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'excursion_requests', filter: `user_id=eq.${uid}` },
          () => {
            void loadActivities({ silent: true });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadActivities]);

  useEffect(() => {
    loadFilterPreferences();
  }, [loadFilterPreferences]);

  const filteredActivities = useMemo(() => {
    let list = filterCategory === 'todas'
      ? activities
      : filterCategory === 'viagens'
        ? activities.filter((a) => a.type === 'viagem')
        : filterCategory === 'envios'
          ? activities.filter((a) => a.type === 'envio')
          : activities.filter((a) => a.type === filterCategory);
    if (filterDateStart) {
      const start = filterDateStart.getTime();
      list = list.filter((a) => new Date(a.created_at).getTime() >= start);
    }
    if (filterDateEnd) {
      const end = new Date(filterDateEnd);
      end.setHours(23, 59, 59, 999);
      const endTime = end.getTime();
      list = list.filter((a) => new Date(a.created_at).getTime() <= endTime);
    }
    return list;
  }, [activities, filterCategory, filterDateStart, filterDateEnd]);

  const openFilter = () => setFilterModalVisible(true);

  const renderActivityCard = (item: ActivityItem) => {
    const navigateToDetail = () => {
      if (item.type === 'viagem') navigation.navigate('TripDetail', { bookingId: item.id });
      if (item.type === 'envio') navigation.navigate('ShipmentDetail', { shipmentId: item.id });
      if (item.type === 'excursao') navigation.navigate('ExcursionDetail', { excursionRequestId: item.id });
      if (item.type === 'dependente') navigation.navigate('DependentShipmentDetail', { dependentShipmentId: item.id });
    };

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.activityRow}
        onPress={navigateToDetail}
        activeOpacity={0.7}
      >
        <View style={styles.activityIconWrap}>
          <Image source={ACTIVITY_ICONS[item.type]} style={styles.activityIcon} />
        </View>
        <View style={styles.activityContent}>
          <View style={styles.activityCardHeader}>
            <Text style={styles.activityTitle} numberOfLines={1}>{item.title}</Text>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setSupportSheetVisible(true); }}
              hitSlop={10}
              activeOpacity={0.7}
            >
              <Image source={require('../../assets/icons/icon-chat.png')} style={styles.activitySupportIcon} />
            </TouchableOpacity>
          </View>
          <View style={styles.activityStatusRow}>
            <StatusBadge variant={item.statusBadgeVariant} label={item.statusBadgeLabel} />
          </View>
          <Text style={styles.activityDateTime}>{item.dateTime}</Text>
          {item.summaryLine ? (
            <Text style={styles.activitySummary} numberOfLines={2}>{item.summaryLine}</Text>
          ) : null}
          <Text style={styles.activityPrice}>{item.priceFormatted} • {item.categoryLabel}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Suas corridas</Text>
          <TouchableOpacity style={styles.filterButton} onPress={openFilter} activeOpacity={0.8}>
            <MaterialIcons name="tune" size={24} color={COLORS.black} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <Text style={styles.subtitle}>Carregando...</Text>
        </View>
      ) : filteredActivities.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.subtitle}>Nenhuma atividade ainda</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {filteredActivities.map((item) => renderActivityCard(item))}
        </ScrollView>
      )}

      <TouchableOpacity
        style={[styles.fab, { right: 24, bottom: fabBottom }]}
        onPress={() => setSupportSheetVisible(true)}
        activeOpacity={0.8}
      >
        <Image source={require('../../assets/icons/icon-chat.png')} style={styles.fabIcon} />
      </TouchableOpacity>

      <SupportSheet
        visible={supportSheetVisible}
        onClose={() => setSupportSheetVisible(false)}
        onOpenSupportChat={() => {
          navigation.navigate('Chat', {
            contactName: 'Suporte Take Me',
            supportBackoffice: true,
          });
        }}
      />

      {filterModalVisible && (
        <FilterModal
          selectedCategory={filterCategory}
          onApply={(category) => {
            setFilterCategory(category);
            setFilterModalVisible(false);
            saveFilterPreferences(category, filterDateStart, filterDateEnd);
          }}
          onClose={() => setFilterModalVisible(false)}
        />
      )}
    </SafeAreaView>
  );
}

type FilterModalProps = {
  selectedCategory: ActivityCategory;
  onApply: (category: ActivityCategory) => void;
  onClose: () => void;
};

function FilterModal({
  selectedCategory,
  onApply,
  onClose,
}: FilterModalProps) {
  const [localCategory, setLocalCategory] = useState<ActivityCategory>(selectedCategory);
  const categories: { key: ActivityCategory; label: string }[] = [
    { key: 'todas', label: 'Todas' },
    { key: 'viagens', label: 'Viagens' },
    { key: 'envios', label: 'Envios' },
    { key: 'dependente', label: 'Dependente' },
    { key: 'excursao', label: 'Excursões' },
  ];
  return (
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
      <View style={styles.modalContent}>
        <Text style={styles.modalTitle}>Filtrar atividades</Text>
        <View style={styles.modalDivider} />
        <Text style={styles.modalSectionLabel}>Categoria</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          {categories.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.chip, localCategory === key && styles.chipSelected]}
              onPress={() => setLocalCategory(key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, localCategory === key && styles.chipTextSelected]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.applyButton} onPress={() => onApply(localCategory)} activeOpacity={0.8}>
          <Text style={styles.applyButtonText}>Aplicar filtro</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 16, paddingVertical: 8 },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
  },
  headerSpacer: { width: 40 },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  listContent: { paddingBottom: 100, paddingHorizontal: 24 },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  activityIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#F1F1F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    overflow: 'hidden',
  },
  activityIcon: {
    width: 32,
    height: 32,
  },
  activityContent: { flex: 1 },
  activityCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  activityTitle: { fontSize: 15, fontWeight: '700', color: COLORS.black, flex: 1, marginRight: 8 },
  activityStatusRow: { marginTop: 6, marginBottom: 2, alignSelf: 'flex-start' },
  activityDateTime: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  activitySummary: { fontSize: 13, color: COLORS.black, marginTop: 4, lineHeight: 18 },
  activityPrice: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  activityLink: { fontSize: 13, color: COLORS.black, textDecorationLine: 'underline' },
  activitySupportIcon: { width: 24, height: 24 },
  separator: { height: 1, backgroundColor: COLORS.neutral400, marginLeft: 88 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 15, color: COLORS.neutral700 },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabIcon: { width: 28, height: 28 },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, textAlign: 'center', marginBottom: 16 },
  modalDivider: { height: 1, backgroundColor: COLORS.neutral400, marginBottom: 20, marginHorizontal: -24 },
  modalSectionLabel: { fontSize: 16, fontWeight: '600', color: COLORS.black, marginBottom: 12 },
  chipRow: { marginBottom: 24 },
  chipRowContent: { flexDirection: 'row', gap: 10 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
  },
  chipSelected: { backgroundColor: COLORS.black },
  chipText: { fontSize: 14, fontWeight: '500', color: COLORS.black },
  chipTextSelected: { color: '#FFFFFF' },
  applyButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
