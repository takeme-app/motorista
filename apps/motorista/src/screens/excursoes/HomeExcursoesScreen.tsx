import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';

type GroupSize = 'Pequeno' | 'Médio' | 'Grande';

type Solicitacao = {
  id: string;
  clientName: string;
  clientInitial: string;
  size: GroupSize;
  priceFormatted: string;
  baseLocation: string;
  time: string;
  observations: string;
  status: string;
};

const SIZE_COLORS: Record<GroupSize, { bg: string; text: string }> = {
  Pequeno: { bg: '#D1FAE5', text: '#065F46' },
  Médio: { bg: '#DBEAFE', text: '#1E40AF' },
  Grande: { bg: '#FEE2E2', text: '#991B1B' },
};

/** Cliente pagou/aprovou; agora o preparador confirma a operação e agenda. */
const ACCEPTABLE_STATUSES = new Set(['approved']);

function peopleToSize(count: number): GroupSize {
  if (count <= 15) return 'Pequeno';
  if (count <= 35) return 'Médio';
  return 'Grande';
}

function formatPriceCents(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) {
    return 'Valor a definir';
  }
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatCardTime(scheduledAt: string | null, excursionDate: string | null, legacyDeparture?: string | null): string {
  const iso = scheduledAt ?? legacyDeparture ?? null;
  if (iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (excursionDate) {
    const d = new Date(`${String(excursionDate).slice(0, 10)}T12:00:00`);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
  return '—';
}

function clientInitialFromName(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  return t[0]!.toUpperCase();
}

export function HomeExcursoesScreen() {
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [acceptModal, setAcceptModal] = useState<Solicitacao | null>(null);
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setSolicitacoes([]);
      return;
    }

    // Colunas alinhadas ao schema em migrations (evita PostgREST 400 por coluna inexistente).
    // `departure_time` / `responsible_name` existem só em alguns ambientes; `scheduled_departure_at` está na migration base estendida.
    const { data, error } = await (supabase as any)
      .from('excursion_requests')
      .select(
        'id, destination, excursion_date, scheduled_departure_at, people_count, status, user_id, observations, total_amount_cents',
      )
      .eq('preparer_id', user.id)
      .neq('status', 'cancelled')
      .order('excursion_date', { ascending: true });

    if (error) {
      console.warn('[HomeExcursoes] excursion_requests', error.message, error.code, error.details);
      Alert.alert(
        'Erro',
        __DEV__
          ? `Não foi possível carregar as solicitações.\n${error.message ?? ''}`
          : 'Não foi possível carregar as solicitações. Verifique sua conexão ou atualize o app.',
      );
      setSolicitacoes([]);
      return;
    }

    const rows = (data ?? []) as {
      id: string;
      destination: string | null;
      excursion_date: string | null;
      scheduled_departure_at?: string | null;
      /** Alguns backends expõem este alias; ignorado se undefined. */
      departure_time?: string | null;
      people_count: number | null;
      status: string | null;
      user_id: string;
      observations: string | null;
      total_amount_cents: number | null;
    }[];

    const byId = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
      const st = String(r.status ?? '');
      const isActiveOrScheduled = st === 'scheduled' || st === 'in_progress';
      const needsAccept = ACCEPTABLE_STATUSES.has(st);
      const waitingAssignment = st === 'pending' || st === 'contacted' || st === 'quoted' || st === 'in_analysis';
      if (isActiveOrScheduled || needsAccept || waitingAssignment) {
        byId.set(r.id, r);
      }
    }
    const mergedRows = [...byId.values()].sort((a, b) => {
      const isoA = a.scheduled_departure_at ?? a.departure_time ?? null;
      const isoB = b.scheduled_departure_at ?? b.departure_time ?? null;
      const ta = isoA
        ? new Date(isoA).getTime()
        : new Date(`${String(a.excursion_date ?? '').slice(0, 10)}T12:00:00`).getTime();
      const tb = isoB
        ? new Date(isoB).getTime()
        : new Date(`${String(b.excursion_date ?? '').slice(0, 10)}T12:00:00`).getTime();
      return ta - tb;
    });
    const userIds = [...new Set(mergedRows.map((r) => r.user_id).filter(Boolean))];
    let profById = new Map<string, { full_name: string | null }>();
    if (userIds.length > 0) {
      const { data: pr, error: profErr } = await (supabase as any)
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      if (profErr) {
        console.warn('[HomeExcursoes] profiles', profErr.message);
      }
      profById = new Map((pr ?? []).map((p: { id: string; full_name: string | null }) => [p.id, { full_name: p.full_name }]));
    }

    const list: Solicitacao[] = mergedRows.map((r) => {
      const pr = profById.get(r.user_id);
      const clientName = (pr?.full_name ?? 'Cliente').trim() || 'Cliente';
      const pc = r.people_count ?? 1;
      const obs =
        (r.observations?.trim() || '') ||
        (r.destination ? `Destino: ${r.destination}` : 'Sem observações.');
      return {
        id: r.id,
        clientName,
        clientInitial: clientInitialFromName(clientName),
        size: peopleToSize(pc),
        priceFormatted: formatPriceCents(r.total_amount_cents),
        baseLocation: r.destination?.trim() || 'Local a definir',
        time: formatCardTime(r.scheduled_departure_at ?? null, r.excursion_date, r.departure_time ?? null),
        observations: obs,
        status: r.status ?? 'pending',
      };
    });

    setSolicitacoes(list);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const confirmAccept = useCallback(async () => {
    if (!acceptModal) return;
    setAccepting(true);
    const { error } = await (supabase as any)
      .from('excursion_requests')
      .update({
        status: 'scheduled',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', acceptModal.id);

    if (error) {
      Alert.alert('Erro', 'Não foi possível aceitar a excursão. Tente novamente.');
      setAccepting(false);
      return;
    }

    setAcceptModal(null);
    setAccepting(false);
    await load();
  }, [acceptModal, load]);

  const needsAccept = (s: Solicitacao) => ACCEPTABLE_STATUSES.has(s.status);
  const isAccepted = (s: Solicitacao) => ['scheduled', 'in_progress', 'completed'].includes(s.status);
  const waitingLabel = (s: Solicitacao) =>
    s.status === 'quoted'
      ? 'Aguardando pagamento do cliente'
      : s.status === 'pending' || s.status === 'contacted' || s.status === 'in_analysis'
        ? 'Em análise/orçamento'
        : 'Aguardando confirmação';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.greeting}>Olá, Preparador!</Text>
        <Text style={styles.subGreeting}>Excursões agendadas, em andamento ou aguardando sua confirmação.</Text>

        <Text style={styles.sectionTitle}>Ações necessárias</Text>
        <View style={styles.actionCard}>
          <View style={styles.actionRow}>
            <View style={styles.actionLeft}>
              <View style={[styles.actionIcon, { backgroundColor: gpsEnabled ? '#D1FAE5' : '#F3F4F6' }]}>
                <MaterialIcons name="gps-fixed" size={20} color={gpsEnabled ? '#065F46' : '#6B7280'} />
              </View>
              <View>
                <Text style={styles.actionLabel}>GPS</Text>
                <Text style={styles.actionDesc}>{gpsEnabled ? 'Localização ativa' : 'Ativar localização'}</Text>
              </View>
            </View>
            <Switch value={gpsEnabled} onValueChange={setGpsEnabled} trackColor={{ false: '#E5E7EB', true: '#111827' }} thumbColor="#FFFFFF" />
          </View>
          <View style={styles.sep} />
          <View style={styles.actionRow}>
            <View style={styles.actionLeft}>
              <View style={[styles.actionIcon, { backgroundColor: notifEnabled ? '#D1FAE5' : '#F3F4F6' }]}>
                <MaterialIcons name="notifications" size={20} color={notifEnabled ? '#065F46' : '#6B7280'} />
              </View>
              <View>
                <Text style={styles.actionLabel}>Notificações</Text>
                <Text style={styles.actionDesc}>{notifEnabled ? 'Ativadas' : 'Ativar notificações'}</Text>
              </View>
            </View>
            <Switch value={notifEnabled} onValueChange={setNotifEnabled} trackColor={{ false: '#E5E7EB', true: '#111827' }} thumbColor="#FFFFFF" />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Solicitações de excursão</Text>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#C9A227" />
          </View>
        ) : solicitacoes.length === 0 ? (
          <Text style={styles.emptyText}>
            Nenhuma excursão atribuída a você no momento.
          </Text>
        ) : (
          solicitacoes.map((s) => {
            const accepted = isAccepted(s);
            const c = SIZE_COLORS[s.size];
            const expanded = !!expandedIds[s.id];
            return (
              <View key={s.id} style={[styles.card, accepted && styles.cardAccepted]}>
                <View style={styles.cardTop}>
                  <View style={styles.clientRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{s.clientInitial}</Text>
                    </View>
                    <View style={styles.clientInfo}>
                      <Text style={styles.clientName}>{s.clientName}</Text>
                      <Text style={styles.cardTime}>{s.time}</Text>
                    </View>
                  </View>
                  <View style={[styles.sizeBadge, { backgroundColor: c.bg }]}>
                    <Text style={[styles.sizeBadgeText, { color: c.text }]}>{s.size}</Text>
                  </View>
                </View>
                <Text style={styles.price}>{s.priceFormatted}</Text>
                <View style={styles.locationRow}>
                  <MaterialIcons name="place" size={14} color="#9CA3AF" />
                  <Text style={styles.locationText} numberOfLines={2}>
                    {s.baseLocation}
                  </Text>
                </View>
                <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(s.id)} activeOpacity={0.7}>
                  <Text style={styles.expandBtnText}>{expanded ? 'Ver menos' : 'Ver detalhes'}</Text>
                  <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={18} color="#6B7280" />
                </TouchableOpacity>
                {expanded ? (
                  <View style={styles.expandedContent}>
                    <View style={styles.sep} />
                    <Text style={styles.obsLabel}>Observações</Text>
                    <Text style={styles.obsText}>{s.observations}</Text>
                  </View>
                ) : null}
                {accepted ? (
                  <View style={styles.acceptedBadge}>
                    <MaterialIcons name="check-circle" size={16} color="#065F46" />
                    <Text style={styles.acceptedText}>Aceito</Text>
                  </View>
                ) : needsAccept(s) ? (
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => setAcceptModal(s)} activeOpacity={0.85}>
                    <Text style={styles.acceptBtnText}>Aceitar viagem</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.waitingBadge}>
                    <MaterialIcons name="schedule" size={16} color="#92400E" />
                    <Text style={styles.waitingText}>{waitingLabel(s)}</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={!!acceptModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Aceitar viagem?</Text>
            <Text style={styles.modalDesc}>Confirma a solicitação de {acceptModal?.clientName}?</Text>
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => !accepting && setAcceptModal(null)}
                activeOpacity={0.8}
                disabled={accepting}
              >
                <Text style={styles.modalBtnCancelText}>Não, voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnConfirm, accepting && { opacity: 0.7 }]}
                onPress={confirmAccept}
                activeOpacity={0.85}
                disabled={accepting}
              >
                {accepting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>Sim, aceitar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 + SCREEN_TOP_EXTRA_PADDING },
  greeting: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  subGreeting: { fontSize: 14, color: '#6B7280', marginBottom: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 },
  loaderWrap: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#9CA3AF', lineHeight: 22, marginBottom: 8 },
  actionCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4, backgroundColor: '#FAFAFA' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  actionDesc: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  sep: { height: 1, backgroundColor: '#F3F4F6' },
  card: { borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 16, padding: 16, marginBottom: 14 },
  cardAccepted: { borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  cardTime: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  sizeBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  sizeBadgeText: { fontSize: 12, fontWeight: '700' },
  price: { fontSize: 20, fontWeight: '700', color: '#C9A227', marginBottom: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  locationText: { fontSize: 13, color: '#6B7280', flex: 1 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  expandBtnText: { fontSize: 13, color: '#6B7280' },
  expandedContent: { marginTop: 8 },
  obsLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 4 },
  obsText: { fontSize: 13, color: '#6B7280', lineHeight: 20 },
  acceptBtn: { backgroundColor: '#111827', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  acceptBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  acceptedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 12, backgroundColor: '#D1FAE5', borderRadius: 12 },
  acceptedText: { fontSize: 14, fontWeight: '600', color: '#065F46' },
  waitingBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 12, backgroundColor: '#FEF3C7', borderRadius: 12, paddingHorizontal: 10 },
  waitingText: { fontSize: 13, fontWeight: '600', color: '#92400E', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 10 },
  modalDesc: { fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 24 },
  modalRow: { flexDirection: 'row', gap: 12 },
  modalBtnCancel: { flex: 1, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalBtnCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  modalBtnConfirm: { flex: 1, backgroundColor: '#111827', borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  modalBtnConfirmText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
