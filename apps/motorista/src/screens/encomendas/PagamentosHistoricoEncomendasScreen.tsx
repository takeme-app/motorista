import { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PagamentosEncStackParamList } from '../../navigation/types';
import { supabase } from '../../lib/supabase';
import { fetchWorkerShipmentBaseId } from '../../lib/preparerEncomendasBase';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';

type Props = NativeStackScreenProps<PagamentosEncStackParamList, 'PagamentosHistorico'>;

const GOLD = '#C9A227';
const CREAM = '#FFFBEB';

type Transfer = {
  id: string;
  amount_cents: number;
  paid_at: string;
};

type WeekGroup = {
  id: string;
  label: string;
  transfers: Transfer[];
};

const PT_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const PT_MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')} ${PT_MONTHS_SHORT[d.getMonth()]}`;
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatPeriodLine(rs: Date, re: Date): string {
  const d1 = rs.getDate().toString().padStart(2, '0');
  const d2 = re.getDate().toString().padStart(2, '0');
  const m1 = PT_MONTHS_SHORT[rs.getMonth()];
  const m2 = PT_MONTHS_SHORT[re.getMonth()];
  const sameMonth = rs.getMonth() === re.getMonth() && rs.getFullYear() === re.getFullYear();
  if (sameMonth) return `${m1} ${d1} - ${m2} ${d2}`;
  return `${m1} ${d1} - ${m2} ${d2}`;
}

function formatFilterField(d: Date | null): string {
  if (!d) return 'Selecione a data';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Faixas 1–7, 8–14, 15–21, 22–fim por mês, recortadas pelo intervalo [rs, re]. */
function getGroupsForDateRange(transfers: Transfer[], rs: Date, re: Date): WeekGroup[] {
  const rangeStart = startOfDay(rs).getTime();
  const rangeEnd = endOfDay(re).getTime();
  const groups: WeekGroup[] = [];

  let y = rs.getFullYear();
  let m = rs.getMonth();
  const endY = re.getFullYear();
  const endM = re.getMonth();

  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(y, m + 1, 0).getDate();
    const bands: { start: number; end: number }[] = [
      { start: 1, end: 7 },
      { start: 8, end: 14 },
      { start: 15, end: 21 },
      { start: 22, end: lastDay },
    ];
    const monthName = PT_MONTHS_SHORT[m]!.toLowerCase();

    for (const band of bands) {
      if (band.start > lastDay) continue;
      const bEnd = Math.min(band.end, lastDay);
      const bandStartT = new Date(y, m, band.start).getTime();
      const bandEndT = endOfDay(new Date(y, m, bEnd)).getTime();
      if (bandEndT < rangeStart || bandStartT > rangeEnd) continue;

      const label =
        band.start === 22
          ? `${band.start} a ${bEnd} de ${monthName}`
          : `${String(band.start).padStart(2, '0')} a ${bEnd} de ${monthName}`;

      const lo = Math.max(bandStartT, rangeStart);
      const hi = Math.min(bandEndT, rangeEnd);
      const filtered = transfers.filter((t) => {
        const tt = new Date(t.paid_at).getTime();
        return tt >= lo && tt <= hi;
      });
      if (filtered.length > 0) {
        groups.push({ id: `${y}-${m}-${band.start}`, label, transfers: filtered });
      }
    }

    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return groups;
}

function PixIcon() {
  return (
    <View style={styles.pixIconCircle}>
      <Text style={styles.pixIconDiamond}>◆</Text>
    </View>
  );
}

export function PagamentosHistoricoEncomendasScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const now = new Date();
  const defaultStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultEnd = startOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [rangeStart, setRangeStart] = useState(defaultStart);
  const [rangeEnd, setRangeEnd] = useState(defaultEnd);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setLoading(false);
      return;
    }

    const myBaseId = await fetchWorkerShipmentBaseId(user.id);
    if (!myBaseId) {
      setTransfers([]);
      setLoading(false);
      return;
    }

    const startIso = startOfDay(rangeStart).toISOString();
    const endIso = endOfDay(rangeEnd).toISOString();

    const { data: rows } = await supabase
      .from('shipments')
      .select('id, amount_cents, delivered_at')
      .eq('preparer_id' as never, user.id)
      .eq('base_id' as never, myBaseId as never)
      .eq('status', 'delivered')
      .gte('delivered_at', startIso)
      .lte('delivered_at', endIso)
      .order('delivered_at', { ascending: false });

    setTransfers(
      ((rows ?? []) as { id: string; amount_cents: number | null; delivered_at: string | null }[])
        .filter((r) => r.delivered_at)
        .map((r) => ({
          id: r.id,
          amount_cents: r.amount_cents ?? 0,
          paid_at: r.delivered_at as string,
        })),
    );
    setLoading(false);
  }, [rangeStart, rangeEnd]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const goToPrevMonth = () => {
    const ref = new Date(rangeStart);
    const nm = ref.getMonth() === 0 ? 11 : ref.getMonth() - 1;
    const ny = ref.getMonth() === 0 ? ref.getFullYear() - 1 : ref.getFullYear();
    setRangeStart(startOfDay(new Date(ny, nm, 1)));
    setRangeEnd(startOfDay(new Date(ny, nm + 1, 0)));
  };

  const goToNextMonth = () => {
    const ref = new Date(rangeStart);
    const nm = ref.getMonth() === 11 ? 0 : ref.getMonth() + 1;
    const ny = ref.getMonth() === 11 ? ref.getFullYear() + 1 : ref.getFullYear();
    setRangeStart(startOfDay(new Date(ny, nm, 1)));
    setRangeEnd(startOfDay(new Date(ny, nm + 1, 0)));
  };

  const openFilter = () => {
    setDraftStart(rangeStart);
    setDraftEnd(rangeEnd);
    setPickerTarget(null);
    setFilterVisible(true);
  };

  const applyFilter = () => {
    if (!draftStart || !draftEnd) {
      showAlert('Datas', 'Selecione a data de início e a data de término.');
      return;
    }
    let a = startOfDay(draftStart);
    let b = startOfDay(draftEnd);
    if (a.getTime() > b.getTime()) {
      const t = a;
      a = b;
      b = t;
    }
    setRangeStart(a);
    setRangeEnd(b);
    setFilterVisible(false);
    setPickerTarget(null);
  };

  const onPickerChange = (_: unknown, date?: Date) => {
    if (Platform.OS === 'android') {
      setPickerTarget(null);
    }
    if (!date || !pickerTarget) return;
    const normalized = startOfDay(date);
    if (pickerTarget === 'start') setDraftStart(normalized);
    else setDraftEnd(normalized);
  };

  const totalCents = transfers.reduce((s, t) => s + t.amount_cents, 0);
  const weekGroups = getGroupsForDateRange(transfers, rangeStart, rangeEnd);

  const monthNavLabel =
    rangeStart.getMonth() === rangeEnd.getMonth() && rangeStart.getFullYear() === rangeEnd.getFullYear()
      ? PT_MONTHS[rangeStart.getMonth()]
      : 'Período';

  const pickerValue =
    pickerTarget === 'start'
      ? (draftStart ?? new Date())
      : pickerTarget === 'end'
        ? (draftEnd ?? draftStart ?? new Date())
        : new Date();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Histórico de pagamentos</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={openFilter} activeOpacity={0.7}>
          <MaterialIcons name="tune" size={22} color="#111827" />
        </TouchableOpacity>
      </View>

      <View style={styles.monthNav}>
        <TouchableOpacity onPress={goToPrevMonth} hitSlop={12} activeOpacity={0.7}>
          <MaterialIcons name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthNavLabel}</Text>
        <TouchableOpacity onPress={goToNextMonth} hitSlop={12} activeOpacity={0.7}>
          <MaterialIcons name="chevron-right" size={26} color="#111827" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.periodCard}>
            <Text style={styles.periodRange}>{formatPeriodLine(rangeStart, rangeEnd)}</Text>
            <Text style={styles.periodTotal}>{formatCents(totalCents)}</Text>
          </View>

          {weekGroups.length === 0 ? (
            <Text style={styles.emptyText}>Nenhuma transferência neste período.</Text>
          ) : (
            weekGroups.map((group) => (
              <View key={group.id} style={styles.weekGroup}>
                <Text style={styles.weekLabel}>{group.label}</Text>
                {group.transfers.map((t, i) => (
                  <View key={t.id}>
                    <View style={styles.transferRow}>
                      <PixIcon />
                      <View style={styles.transferInfo}>
                        <Text style={styles.transferAmount}>{formatCents(t.amount_cents)}</Text>
                        <Text style={styles.transferMeta}>Pix • {formatHour(t.paid_at)}</Text>
                      </View>
                      <Text style={styles.transferDate}>{formatShortDate(t.paid_at)}</Text>
                    </View>
                    {i < group.transfers.length - 1 ? <View style={styles.sep} /> : null}
                  </View>
                ))}
              </View>
            ))
          )}

          <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backLinkText}>Voltar para pagamentos</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <Modal
        visible={filterVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setFilterVisible(false);
          setPickerTarget(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => {
              setFilterVisible(false);
              setPickerTarget(null);
            }}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandleRow}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.sheetHeaderContent}>
              <Text style={styles.sheetTitle}>Filtrar mês</Text>
            </View>
            <View style={styles.sheetDivider} />
            <View style={styles.sheetBody}>
              <Text style={styles.filterSectionTitle}>Data do histórico de pagamento</Text>

              <Text style={styles.filterLabelText}>Data de início</Text>
              <TouchableOpacity
                style={styles.filterDateRow}
                onPress={() => setPickerTarget('start')}
                activeOpacity={0.75}
              >
                <Text
                  style={[styles.filterDateRowText, !draftStart && styles.filterDateRowPlaceholder]}
                  numberOfLines={1}
                >
                  {formatFilterField(draftStart)}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={22} color="#6B7280" />
              </TouchableOpacity>

              <Text style={styles.filterLabelText}>Data de término</Text>
              <TouchableOpacity
                style={styles.filterDateRow}
                onPress={() => setPickerTarget('end')}
                activeOpacity={0.75}
              >
                <Text
                  style={[styles.filterDateRowText, !draftEnd && styles.filterDateRowPlaceholder]}
                  numberOfLines={1}
                >
                  {formatFilterField(draftEnd)}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={22} color="#6B7280" />
              </TouchableOpacity>

              {pickerTarget && Platform.OS === 'ios' ? (
                <View style={styles.iosPickerWrap}>
                  <DateTimePicker
                    value={pickerValue}
                    mode="date"
                    display="spinner"
                    onChange={onPickerChange}
                    locale="pt-BR"
                  />
                  <TouchableOpacity
                    style={styles.iosPickerDone}
                    onPress={() => setPickerTarget(null)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.iosPickerDoneText}>Concluído</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {pickerTarget && Platform.OS === 'android' ? (
                <DateTimePicker
                  value={pickerValue}
                  mode="date"
                  display="default"
                  onChange={onPickerChange}
                />
              ) : null}

              <TouchableOpacity style={styles.btnPrimary} onPress={applyFilter} activeOpacity={0.85}>
                <Text style={styles.btnPrimaryText}>Aplicar filtro</Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  monthLabel: { fontSize: 16, fontWeight: '600', color: '#111827', minWidth: 100, textAlign: 'center' },

  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 20 },

  periodCard: {
    alignItems: 'center',
    marginBottom: 24,
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  periodRange: { fontSize: 14, color: '#9CA3AF', marginBottom: 4 },
  periodTotal: { fontSize: 32, fontWeight: '700', color: '#111827' },

  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginVertical: 24 },

  weekGroup: { marginBottom: 24 },
  weekLabel: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 8 },

  transferRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  pixIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pixIconDiamond: { fontSize: 20, color: GOLD },
  transferInfo: { flex: 1 },
  transferAmount: { fontSize: 16, fontWeight: '700', color: '#111827' },
  transferMeta: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  transferDate: { fontSize: 14, color: '#9CA3AF' },
  sep: { height: 1, backgroundColor: '#F3F4F6' },

  backLink: { alignItems: 'center', marginTop: 12 },
  backLinkText: { fontSize: 15, color: '#111827', textDecorationLine: 'underline', fontWeight: '500' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  sheetHandleRow: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  sheetHeaderContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  sheetDivider: { height: 1, backgroundColor: '#E5E7EB' },
  sheetBody: { paddingHorizontal: 24, paddingTop: 24, gap: 4 },

  filterSectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 12 },
  filterLabelText: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 6 },

  filterDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F2F2F2',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  filterDateRowText: { fontSize: 15, color: '#111827', flex: 1, marginRight: 8 },
  filterDateRowPlaceholder: { color: '#9CA3AF' },

  iosPickerWrap: { marginTop: 8 },
  iosPickerDone: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  iosPickerDoneText: { fontSize: 16, fontWeight: '600', color: '#111827' },

  btnPrimary: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  btnPrimaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
