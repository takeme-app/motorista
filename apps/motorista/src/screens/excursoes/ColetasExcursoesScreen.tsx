import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from '../../navigation/ColetasExcursoesStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { ensureExcursionClientConversation } from '../../lib/excursionClientConversation';
import { navigateExcursionTabToChatThread } from '../../navigation/excursionNavigateToChat';
import { passengerTotalLabel } from './excursionFormat';

type Props = NativeStackScreenProps<ColetasExcursoesStackParamList, 'ColetasMain'>;

type Excursion = {
  id: string;
  origin: string;
  destination: string;
  departureTime: string | null;
  returnTime: string | null;
  transportType: string;
  responsible: string;
  direction: string;
  status: string;
  expanded: boolean;
  createdAt: string | null;
  confirmedAt: string | null;
  clientPhone: string | null;
  clientUserId: string;
  clientAvatarUrl: string | null;
  registeredPassengerCount: number;
};

type StatusConfig = { label: string; bg: string; text: string; border: string };

const STATUS_MAP: Record<string, StatusConfig> = {
  contacted:       { label: 'Em andamento',       bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  in_progress:     { label: 'Em andamento',       bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  scheduled:       { label: 'Em andamento',       bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  active:          { label: 'Em andamento',       bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  payment_done:    { label: 'Pagamento realizado', bg: '#DBEAFE', text: '#1E40AF', border: '#E5E7EB' },
  paid:            { label: 'Pagamento realizado', bg: '#DBEAFE', text: '#1E40AF', border: '#E5E7EB' },
  approved:        { label: 'Pagamento realizado', bg: '#DBEAFE', text: '#1E40AF', border: '#E5E7EB' },
  quoted:          { label: 'Orçamento enviado',  bg: '#E0E7FF', text: '#3730A3', border: '#E5E7EB' },
  in_analysis:     { label: 'Em análise',         bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' },
  pending:         { label: 'Pendente',           bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' },
  pending_rating:  { label: 'Avaliação Pendente', bg: '#E8EEF9', text: '#1E3A5F', border: '#E5E7EB' },
  confirmed:       { label: 'Concluído',          bg: '#D1FAE5', text: '#065F46', border: '#E5E7EB' },
  completed:       { label: 'Concluído',          bg: '#D1FAE5', text: '#065F46', border: '#E5E7EB' },
  cancelled:       { label: 'Cancelado',          bg: '#FEE2E2', text: '#991B1B', border: '#E5E7EB' },
};

const DEFAULT_STATUS: StatusConfig = { label: 'Pendente', bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' };

type ListTab = 'progress' | 'upcoming' | 'history';

const TAB_DEFS: { key: ListTab; label: string }[] = [
  { key: 'progress', label: 'Em andamento' },
  { key: 'upcoming', label: 'Próximas excursões' },
  { key: 'history', label: 'Histórico' },
];

const TAB_PROGRESS = new Set(['in_progress', 'scheduled', 'contacted', 'active', 'payment_done', 'paid']);
const TAB_UPCOMING = new Set(['pending', 'quoted', 'in_analysis', 'approved']);
const TAB_HISTORY = new Set(['completed', 'cancelled', 'pending_rating', 'confirmed']);

const CARD_GOLD = '#C9A227';
const LIST_BOARDING_STATUSES = new Set([
  'approved', 'scheduled', 'in_progress', 'payment_done', 'paid', 'active',
]);

const LIST_TIMELINE_LABELS = ['Pedido feito', 'Pagamento aprovado', 'Embarque confirmado', 'Ônibus partiu'];

function listTimelineSteps(status: string): boolean[] {
  const afterPayment = [
    'approved', 'scheduled', 'in_progress', 'completed',
    'payment_done', 'paid', 'pending_rating', 'confirmed',
  ];
  const afterBoarding = ['scheduled', 'in_progress', 'completed', 'confirmed'];
  const afterDeparted = ['in_progress', 'completed'];
  return [
    true,
    afterPayment.includes(status),
    afterBoarding.includes(status),
    afterDeparted.includes(status),
  ];
}

function formatTimelineSubtitle(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const day = d.getDate().toString().padStart(2, '0');
    const mon = months[d.getMonth()] ?? '';
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${mon}, ${time}`;
  } catch { return '—'; }
}

function excursionMatchesTab(status: string, tab: ListTab): boolean {
  const s = status || 'pending';
  if (tab === 'history') return TAB_HISTORY.has(s);
  if (tab === 'progress') return TAB_PROGRESS.has(s);
  return TAB_UPCOMING.has(s) || (!TAB_PROGRESS.has(s) && !TAB_HISTORY.has(s));
}

function fleetTypeLabel(v: string | null | undefined): string {
  if (!v) return 'Van';
  const m: Record<string, string> = {
    carro: 'Carro',
    van: 'Van',
    micro_onibus: 'Micro-ônibus',
    onibus: 'Ônibus Executivo',
  };
  return m[v] ?? v;
}

function statusCfg(status: string): StatusConfig {
  return STATUS_MAP[status] ?? DEFAULT_STATUS;
}

function DateLine({ iso, direction }: { iso: string | null; direction: string }) {
  if (!iso) {
    return <Text style={styles.dateLabel}>—</Text>;
  }
  try {
    const d = new Date(iso);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const day = d.getDate().toString().padStart(2, '0');
    const mon = months[d.getMonth()] ?? '';
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return (
      <Text style={styles.dateLabel}>
        {day} {mon} • <Text style={styles.dateTimeBold}>{time}</Text> ({direction})
      </Text>
    );
  } catch {
    return <Text style={styles.dateLabel}>—</Text>;
  }
}

export function ColetasExcursoesScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [listTab, setListTab] = useState<ListTab>('progress');
  const [excursions, setExcursions] = useState<Excursion[]>([]);
  const [openingChatExcursionId, setOpeningChatExcursionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('excursion_requests')
      .select(
        'id, destination, excursion_date, scheduled_departure_at, fleet_type, status, user_id, created_at, confirmed_at',
      )
      .eq('preparer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('[ColetasExcursoes] excursion_requests', error.message, error.code);
      Alert.alert(
        'Erro',
        __DEV__
          ? `Não foi possível carregar excursões.\n${error.message ?? ''}`
          : 'Não foi possível carregar excursões. Tente novamente.',
      );
      setExcursions([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as any[];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    let profRows: { id: string; full_name: string | null; phone: string | null; avatar_url: string | null }[] = [];
    if (userIds.length > 0) {
      const { data: pr } = await supabase
        .from('profiles')
        .select('id, full_name, phone, avatar_url')
        .in('id', userIds);
      profRows = (pr ?? []) as { id: string; full_name: string | null; phone: string | null; avatar_url: string | null }[];
    }
    const profById = new Map(profRows.map((p) => [p.id, p]));

    const excIds = rows.map((r) => r.id).filter(Boolean);
    const registeredByExc: Record<string, number> = {};
    if (excIds.length > 0) {
      const { data: psgRows } = await supabase
        .from('excursion_passengers')
        .select('excursion_request_id')
        .in('excursion_request_id', excIds);
      for (const row of psgRows ?? []) {
        const eid = (row as { excursion_request_id: string }).excursion_request_id;
        registeredByExc[eid] = (registeredByExc[eid] ?? 0) + 1;
      }
    }

    const list: Excursion[] = [];

    for (const r of rows) {
      const pr = profById.get(r.user_id) as
        | { full_name?: string | null; phone?: string | null; avatar_url?: string | null }
        | undefined;
      const responsible = pr?.full_name ?? 'Cliente';
      const clientPhone = pr?.phone?.trim() ? pr.phone : null;
      const clientAvatarUrl = pr?.avatar_url?.trim() ? pr.avatar_url.trim() : null;

      const depIso = r.scheduled_departure_at ?? r.excursion_date ?? null;
      const retIso = null;

      list.push({
        id: r.id,
        origin: 'Origem a definir',
        destination: r.destination ?? 'Destino',
        departureTime: depIso,
        returnTime: retIso,
        transportType: fleetTypeLabel(r.fleet_type),
        responsible,
        direction: 'Ida',
        status: r.status ?? 'pending',
        expanded: true,
        createdAt: r.created_at ?? null,
        confirmedAt: r.confirmed_at ?? null,
        clientPhone,
        clientUserId: r.user_id as string,
        clientAvatarUrl,
        registeredPassengerCount: registeredByExc[r.id] ?? 0,
      });
    }

    setExcursions(list);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleExpand = useCallback((id: string) => {
    setExcursions((prev) => prev.map((e) => e.id === id ? { ...e, expanded: !e.expanded } : e));
  }, []);

  const openResponsibleChat = useCallback(
    async (exc: Excursion) => {
      if (!exc.clientUserId) {
        Alert.alert('Chat', 'Não foi possível identificar o cliente desta excursão.');
        return;
      }
      setOpeningChatExcursionId(exc.id);
      const res = await ensureExcursionClientConversation({
        clientUserId: exc.clientUserId,
        participantName: exc.responsible,
        participantAvatar: exc.clientAvatarUrl,
      });
      setOpeningChatExcursionId(null);
      if ('error' in res) {
        Alert.alert('Chat', res.error);
        return;
      }
      navigateExcursionTabToChatThread(navigation, {
        conversationId: res.conversationId,
        participantName: exc.responsible,
        participantAvatar: exc.clientAvatarUrl ?? undefined,
      });
    },
    [navigation],
  );

  const filtered = excursions.filter((e) => excursionMatchesTab(e.status, listTab));
  const showBack = navigation.canGoBack();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View style={styles.headerSide}>
          {showBack ? (
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={22} color="#111827" />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSideSpacer} />
          )}
        </View>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Excursões</Text>
        </View>
        <View style={styles.headerSide}>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <MaterialIcons name="notifications-none" size={22} color="#111827" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabsRow}>
        {TAB_DEFS.map((t) => {
          const active = listTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tabBtn}
              onPress={() => setListTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                {t.label}
              </Text>
              {active ? <View style={styles.tabUnderline} /> : <View style={styles.tabUnderlinePlaceholder} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#111827" style={{ marginTop: 48 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="directions-bus" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>
            {excursions.length === 0 ? 'Nenhuma excursão ainda' : 'Nada nesta aba'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {filtered.map((exc) => {
            const cfg = statusCfg(exc.status);
            const prominent =
              listTab === 'progress' &&
              ['in_progress', 'scheduled', 'contacted'].includes(exc.status);
            const showBoardingBlock = listTab === 'progress' && LIST_BOARDING_STATUSES.has(exc.status);
            const tlSteps = listTimelineSteps(exc.status);
            const tlSubs = [
              formatTimelineSubtitle(exc.createdAt),
              formatTimelineSubtitle(exc.confirmedAt),
              formatTimelineSubtitle(exc.departureTime),
              formatTimelineSubtitle(exc.departureTime),
            ];
            return (
              <View
                key={exc.id}
                style={[
                  styles.card,
                  { borderColor: prominent ? CARD_GOLD : cfg.border },
                  prominent && styles.cardProminent,
                ]}
              >
                {/* Status row */}
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => toggleExpand(exc.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.statusText, { color: cfg.text }]}>{cfg.label}</Text>
                  </View>
                  <MaterialIcons
                    name={exc.expanded ? 'expand-less' : 'expand-more'}
                    size={22}
                    color="#9CA3AF"
                  />
                </TouchableOpacity>

                {/* Route */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('DetalhesExcursao', { excursionId: exc.id })}
                >
                  <View style={styles.routeRow}>
                    <Text style={styles.routeCity}>{exc.origin}</Text>
                    <MaterialIcons name="arrow-forward" size={16} color={CARD_GOLD} style={{ marginHorizontal: 8 }} />
                    <Text style={[styles.routeCity, { textAlign: 'right', flex: 1 }]}>{exc.destination}</Text>
                  </View>
                  <View style={styles.datesRow}>
                    <DateLine iso={exc.departureTime} direction="ida" />
                    {exc.returnTime ? (
                      <>
                        <Text style={styles.dateSep}> | </Text>
                        <DateLine iso={exc.returnTime} direction="retorno" />
                      </>
                    ) : null}
                  </View>

                  {exc.expanded && (
                    <>
                      <View style={styles.detailsSection}>
                        <DetailRow
                          label="Passageiros totais"
                          value={passengerTotalLabel(exc.registeredPassengerCount)}
                        />
                        <DetailRow label="Tipo de transporte" value={exc.transportType} />
                        <DetailRow label="Responsável" value={exc.responsible} />
                        <DetailRow label="Navegação" value={exc.direction} />
                      </View>
                      {showBoardingBlock ? (
                        <>
                          <TouchableOpacity
                            style={styles.whatsappRow}
                            onPress={() => void openResponsibleChat(exc)}
                            activeOpacity={0.85}
                            disabled={openingChatExcursionId === exc.id}
                          >
                            {openingChatExcursionId === exc.id ? (
                              <ActivityIndicator size="small" color="#111827" />
                            ) : (
                              <MaterialIcons name="chat" size={22} color="#111827" />
                            )}
                            <Text style={styles.whatsappText}>Contato do responsável</Text>
                          </TouchableOpacity>
                          <Text style={styles.inlineHistoricoTitle}>Histórico</Text>
                          {LIST_TIMELINE_LABELS.map((label, idx) => (
                            <View key={label} style={styles.tlRow}>
                              <View style={styles.tlDotCol}>
                                <View
                                  style={[
                                    styles.tlDot,
                                    tlSteps[idx] ? styles.tlDotDone : styles.tlDotPending,
                                  ]}
                                />
                                {idx < LIST_TIMELINE_LABELS.length - 1 ? (
                                  <View
                                    style={[
                                      styles.tlLine,
                                      tlSteps[idx] ? styles.tlLineDone : styles.tlLinePending,
                                    ]}
                                  />
                                ) : null}
                              </View>
                              <View style={styles.tlContent}>
                                <Text
                                  style={[
                                    styles.tlLabel,
                                    tlSteps[idx] ? styles.tlLabelDone : styles.tlLabelPending,
                                  ]}
                                >
                                  {label}
                                </Text>
                                <Text
                                  style={[
                                    styles.tlSub,
                                    tlSteps[idx] ? styles.tlSubDone : styles.tlSubPending,
                                  ]}
                                >
                                  {tlSubs[idx]}
                                </Text>
                              </View>
                            </View>
                          ))}
                          <TouchableOpacity
                            style={styles.cardBtnBlack}
                            onPress={() => navigation.navigate('RealizarEmbarques', { excursionId: exc.id })}
                            activeOpacity={0.88}
                          >
                            <Text style={styles.cardBtnBlackText}>
                              {exc.status === 'in_progress' ? 'Continuar embarque' : 'Iniciar embarque'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.cardBtnOutline}
                            onPress={() => navigation.navigate('DetalhesExcursao', { excursionId: exc.id })}
                            activeOpacity={0.88}
                          >
                            <Text style={styles.cardBtnOutlineText}>Acompanhar viagem</Text>
                          </TouchableOpacity>
                        </>
                      ) : null}
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerSide: { width: 40, alignItems: 'center', justifyContent: 'center' },
  headerSideSpacer: { width: 40, height: 40 },
  headerTitleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 4,
  },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabLabel: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', textAlign: 'center' },
  tabLabelActive: { color: '#111827' },
  tabUnderline: {
    marginTop: 6,
    height: 3,
    width: '70%',
    maxWidth: 72,
    backgroundColor: '#C9A227',
    borderRadius: 2,
  },
  tabUnderlinePlaceholder: { marginTop: 6, height: 3, width: '70%', maxWidth: 72 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },

  // Cards
  card: {
    borderWidth: 1.5, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 12,
    marginBottom: 16, backgroundColor: '#FFFFFF',
  },
  cardProminent: { borderWidth: 2 },
  cardTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusPill: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontSize: 13, fontWeight: '700' },

  routeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  routeCity: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },

  datesRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  dateLabel: { fontSize: 13, color: '#6B7280' },
  dateTimeBold: { fontWeight: '800', color: '#111827' },
  dateSep: { fontSize: 13, color: '#D1D5DB' },
  whatsappRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FEF9C3',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
  },
  whatsappText: { fontSize: 14, fontWeight: '700', color: '#111827' },
  inlineHistoricoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
    marginTop: 16,
    marginBottom: 12,
  },
  tlRow: { flexDirection: 'row', gap: 10 },
  tlDotCol: { alignItems: 'center', width: 14 },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  tlDotDone: { backgroundColor: '#111827' },
  tlDotPending: { backgroundColor: '#D1D5DB' },
  tlLine: { flex: 1, width: 2, minHeight: 16, marginTop: 2 },
  tlLineDone: { backgroundColor: '#111827' },
  tlLinePending: { backgroundColor: '#E5E7EB' },
  tlContent: { flex: 1, paddingBottom: 12 },
  tlLabel: { fontSize: 13, fontWeight: '600' },
  tlLabelDone: { color: '#111827' },
  tlLabelPending: { color: '#9CA3AF' },
  tlSub: { fontSize: 12, marginTop: 2 },
  tlSubDone: { color: '#374151' },
  tlSubPending: { color: '#9CA3AF' },
  cardBtnBlack: {
    marginTop: 14,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBtnBlackText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  cardBtnOutline: {
    marginTop: 10,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  cardBtnOutlineText: { fontSize: 15, fontWeight: '700', color: '#111827' },

  detailsSection: { gap: 8, paddingTop: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailLabel: { fontSize: 14, color: '#9CA3AF' },
  detailValue: { fontSize: 14, color: '#111827', fontWeight: '500', textAlign: 'right' },
});
