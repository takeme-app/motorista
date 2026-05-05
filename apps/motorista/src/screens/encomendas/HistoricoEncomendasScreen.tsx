import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasEncomendasStackParamList } from '../../navigation/ColetasEncomendasStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { fetchWorkerShipmentBaseId } from '../../lib/preparerEncomendasBase';

type Props = NativeStackScreenProps<ColetasEncomendasStackParamList, 'HistoricoEncomendas'>;

type HistoryItem = {
  id: string;
  clientName: string;
  dateLabel: string;
  rawDate: Date;
};

type Group = { title: string; items: HistoryItem[] };

function formatHistoryDate(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const month = months[d.getMonth()] ?? '';
    const day = d.getDate().toString().padStart(2, '0');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${month}, ${time}`;
  } catch { return iso; }
}

function groupItems(items: HistoryItem[]): Group[] {
  const now = new Date();

  const startOfThisWeek = new Date(now);
  startOfThisWeek.setDate(now.getDate() - now.getDay());
  startOfThisWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);

  const thisWeek: HistoryItem[] = [];
  const lastWeek: HistoryItem[] = [];
  const byMonth: Record<string, HistoryItem[]> = {};

  for (const item of items) {
    if (item.rawDate >= startOfThisWeek) {
      thisWeek.push(item);
    } else if (item.rawDate >= startOfLastWeek) {
      lastWeek.push(item);
    } else {
      const monthKey = item.rawDate.toLocaleDateString('pt-BR', { month: 'long' });
      const key = monthKey.charAt(0).toUpperCase() + monthKey.slice(1);
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key]!.push(item);
    }
  }

  const groups: Group[] = [];
  if (thisWeek.length > 0) groups.push({ title: 'Esta semana', items: thisWeek });
  if (lastWeek.length > 0) groups.push({ title: 'Semana passada', items: lastWeek });
  for (const [title, groupItems] of Object.entries(byMonth)) {
    groups.push({ title, items: groupItems });
  }
  return groups;
}

function parseDateInput(str: string): Date | null {
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!day || !month || !year) return null;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  if (isNaN(d.getTime())) return null;
  return d;
}

export function HistoricoEncomendasScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [allItems, setAllItems] = useState<HistoryItem[]>([]);
  const [filterVisible, setFilterVisible] = useState(false);
  const [dateFromInput, setDateFromInput] = useState('');
  const [dateToInput, setDateToInput] = useState('');
  const [filterActive, setFilterActive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) { setLoading(false); return; }

    const myBaseId = await fetchWorkerShipmentBaseId(user.id);
    if (!myBaseId) {
      setAllItems([]);
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('shipments')
      .select('id, created_at, user_id, delivered_to_base_at')
      .eq('preparer_id' as never, user.id)
      .eq('base_id' as never, myBaseId as never)
      .not('delivered_to_base_at', 'is', null)
      .order('delivered_to_base_at', { ascending: false });

    const rows = (data ?? []) as unknown as {
      id: string;
      created_at: string;
      user_id: string;
      delivered_to_base_at?: string | null;
    }[];
    const items: HistoryItem[] = [];
    for (const r of rows) {
      const { data: prof } = await supabase
        .from('profiles').select('full_name').eq('id', r.user_id).maybeSingle();
      const p = prof as { full_name?: string | null } | null;
      const finishedAt = r.delivered_to_base_at ?? r.created_at;
      items.push({
        id: r.id,
        clientName: p?.full_name ?? 'Cliente',
        dateLabel: formatHistoryDate(finishedAt),
        rawDate: new Date(finishedAt),
      });
    }
    setAllItems(items);
    setGroups(groupItems(items));
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const applyFilter = useCallback(() => {
    const from = parseDateInput(dateFromInput);
    const to = parseDateInput(dateToInput);
    if (!from && !to) {
      setGroups(groupItems(allItems));
      setFilterActive(false);
    } else {
      const filtered = allItems.filter((item) => {
        if (from && item.rawDate < from) return false;
        if (to) {
          const toEnd = new Date(to);
          toEnd.setHours(23, 59, 59, 999);
          if (item.rawDate > toEnd) return false;
        }
        return true;
      });
      setGroups(groupItems(filtered));
      setFilterActive(true);
    }
    setFilterVisible(false);
  }, [allItems, dateFromInput, dateToInput]);

  const clearFilter = useCallback(() => {
    setDateFromInput('');
    setDateToInput('');
    setGroups(groupItems(allItems));
    setFilterActive(false);
    setFilterVisible(false);
  }, [allItems]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={20} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Histórico</Text>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
          <MaterialIcons name="notifications-none" size={22} color="#111827" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#111827" style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {filterActive && (
            <TouchableOpacity style={styles.filterActiveBadge} onPress={clearFilter} activeOpacity={0.7}>
              <Text style={styles.filterActiveBadgeText}>Filtro ativo</Text>
              <MaterialIcons name="close" size={14} color="#1E40AF" />
            </TouchableOpacity>
          )}

          {groups.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="history" size={40} color="#D1D5DB" />
              <Text style={styles.emptyText}>Nenhuma coleta encontrada</Text>
            </View>
          ) : (
            groups.map((group) => (
              <View key={group.title} style={styles.groupSection}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                <View style={styles.listCard}>
                  {group.items.map((item, idx) => (
                    <View key={item.id}>
                      <TouchableOpacity
                        style={styles.historyRow}
                        activeOpacity={0.7}
                        onPress={() => navigation.navigate('DetalhesEncomenda', { shipmentId: item.id })}
                      >
                        <View style={styles.historyInfo}>
                          <Text style={styles.historyName}>{item.clientName}</Text>
                          <Text style={styles.historyDate}>{item.dateLabel}</Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={20} color="#9CA3AF" />
                      </TouchableOpacity>
                      {idx < group.items.length - 1 && <View style={styles.sep} />}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.fabFilter} activeOpacity={0.85} onPress={() => setFilterVisible(true)}>
        <MaterialIcons name="tune" size={22} color="#374151" />
      </TouchableOpacity>

      <Modal visible={filterVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setFilterVisible(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Filtrar atividades</Text>
          <View style={styles.sheetDivider} />
          <Text style={styles.filterSectionTitle}>Data da atividade</Text>
          <Text style={styles.filterLabel}>Data inicial</Text>
          <View style={styles.dateInputRow}>
            <MaterialIcons name="calendar-today" size={18} color="#9CA3AF" />
            <TextInput
              style={styles.dateInput}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#9CA3AF"
              value={dateFromInput}
              onChangeText={setDateFromInput}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
              maxLength={10}
            />
          </View>
          <Text style={[styles.filterLabel, { marginTop: 16 }]}>Data final</Text>
          <View style={styles.dateInputRow}>
            <MaterialIcons name="calendar-today" size={18} color="#9CA3AF" />
            <TextInput
              style={styles.dateInput}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="#9CA3AF"
              value={dateToInput}
              onChangeText={setDateToInput}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
              maxLength={10}
            />
          </View>
          <TouchableOpacity style={styles.applyBtn} onPress={applyFilter} activeOpacity={0.85}>
            <Text style={styles.applyBtnText}>Aplicar filtro</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#111827', textAlign: 'center' },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 80, paddingTop: 20 },
  filterActiveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', backgroundColor: '#DBEAFE',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16,
  },
  filterActiveBadgeText: { fontSize: 13, fontWeight: '600', color: '#1E40AF' },
  groupSection: { marginBottom: 24 },
  groupTitle: { fontSize: 15, fontWeight: '600', color: '#9CA3AF', marginBottom: 10 },
  listCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, overflow: 'hidden' },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16 },
  historyInfo: { flex: 1 },
  historyName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  historyDate: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  sep: { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF' },
  fabFilter: {
    position: 'absolute', bottom: 24, right: 24,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#D1D5DB', alignSelf: 'center', marginTop: 12, marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  sheetDivider: { height: 1, backgroundColor: '#F3F4F6', marginBottom: 24 },
  filterSectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },
  filterLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  dateInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  dateInput: { flex: 1, fontSize: 15, color: '#111827' },
  applyBtn: {
    backgroundColor: '#111827', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 28,
  },
  applyBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
