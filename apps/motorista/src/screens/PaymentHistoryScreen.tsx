import { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { fetchDriverPaymentTransfers, type DriverPaymentTransfer } from '../lib/driverPaymentTransfers';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentHistory'>;

const GOLD = '#C9A227';
const CREAM = '#FFFBEB';

type Transfer = DriverPaymentTransfer;

type WeekGroup = {
  label: string;
  transfers: Transfer[];
};

const PT_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const PT_MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

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

function getWeekGroups(transfers: Transfer[], year: number, month: number): WeekGroup[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = PT_MONTHS_SHORT[month].toLowerCase();

  // Grupos fixos por semana
  const weekRanges = [
    { start: 22, end: daysInMonth },
    { start: 15, end: 21 },
    { start: 8, end: 14 },
    { start: 1, end: 7 },
  ].filter((w) => w.start <= daysInMonth);

  return weekRanges
    .map((w) => {
      const label =
        w.start === 22
          ? `${w.start} a ${w.end} de ${monthName}`
          : `${w.start.toString().padStart(2, '0')} a ${w.end} de ${monthName}`;
      const filtered = transfers.filter((t) => {
        const d = new Date(t.paid_at).getDate();
        return d >= w.start && d <= w.end;
      });
      return { label, transfers: filtered };
    })
    .filter((g) => g.transfers.length > 0);
}

function PixIcon() {
  return (
    <View style={styles.pixIconCircle}>
      <Text style={styles.pixIconDiamond}>◆</Text>
    </View>
  );
}

export function PaymentHistoryScreen({ navigation }: Props) {
  const bottomInset = useBottomSafeInset({ extra: 16 });
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [startDay, setStartDay] = useState(1);
  const [endDay, setEndDay] = useState(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth());
  const [filterStartDay, setFilterStartDay] = useState(1);
  const [filterEndDay, setFilterEndDay] = useState(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());

  const load = useCallback(async (y: number, m: number, sd: number, ed: number) => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const daysInM = new Date(y, m + 1, 0).getDate();
    const clampedEd = Math.min(ed, daysInM);
    const start = new Date(y, m, sd).toISOString();
    const end = new Date(y, m, clampedEd, 23, 59, 59, 999).toISOString();

    const list = await fetchDriverPaymentTransfers(supabase, user.id, start, end);
    setTransfers(list);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(year, month, startDay, endDay); }, [load, year, month, startDay, endDay]));

  const goToPrevMonth = () => {
    const newM = month === 0 ? 11 : month - 1;
    const newY = month === 0 ? year - 1 : year;
    const newLastDay = new Date(newY, newM + 1, 0).getDate();
    setMonth(newM); setYear(newY);
    setStartDay(1); setEndDay(newLastDay);
  };

  const goToNextMonth = () => {
    const newM = month === 11 ? 0 : month + 1;
    const newY = month === 11 ? year + 1 : year;
    const newLastDay = new Date(newY, newM + 1, 0).getDate();
    setMonth(newM); setYear(newY);
    setStartDay(1); setEndDay(newLastDay);
  };

  const applyFilter = () => {
    setYear(filterYear); setMonth(filterMonth);
    setStartDay(filterStartDay); setEndDay(filterEndDay);
    setFilterVisible(false);
  };

  const openFilter = () => {
    setFilterYear(year); setFilterMonth(month);
    setFilterStartDay(startDay); setFilterEndDay(endDay);
    setFilterVisible(true);
  };

  const totalCents = transfers.reduce((s, t) => s + t.amount_cents, 0);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthShort = PT_MONTHS_SHORT[month];
  const weekGroups = getWeekGroups(transfers, year, month);

  const filterDaysInMonth = new Date(filterYear, filterMonth + 1, 0).getDate();
  const filterMonthNameStr = PT_MONTHS[filterMonth].toLowerCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Histórico de pagamentos</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={openFilter} activeOpacity={0.7}>
          <MaterialIcons name="tune" size={22} color="#111827" />
        </TouchableOpacity>
      </View>

      {/* Month navigator */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={goToPrevMonth} hitSlop={12} activeOpacity={0.7}>
          <MaterialIcons name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{PT_MONTHS[month]}</Text>
        <TouchableOpacity onPress={goToNextMonth} hitSlop={12} activeOpacity={0.7}>
          <MaterialIcons name="chevron-right" size={26} color="#111827" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={GOLD} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Period total */}
          <View style={styles.periodCard}>
            <Text style={styles.periodRange}>{monthShort} {String(startDay).padStart(2,'0')} - {monthShort} {String(Math.min(endDay, daysInMonth)).padStart(2,'0')}</Text>
            <Text style={styles.periodTotal}>{formatCents(totalCents)}</Text>
          </View>

          {weekGroups.length === 0 ? (
            <Text style={styles.emptyText}>Nenhuma transferência neste mês.</Text>
          ) : (
            weekGroups.map((group) => (
              <View key={group.label} style={styles.weekGroup}>
                <Text style={styles.weekLabel}>{group.label}</Text>
                {group.transfers.map((t, i) => (
                  <View key={t.id}>
                    <View style={styles.transferRow}>
                      <PixIcon />
                      <View style={styles.transferInfo}>
                        <Text style={styles.transferAmount}>{formatCents(t.amount_cents)}</Text>
                        <Text style={styles.transferMeta}>
                          {t.source === 'completed_trip'
                            ? `Viagem concluída • ${formatHour(t.paid_at)}`
                            : `Pix • ${formatHour(t.paid_at)}`}
                        </Text>
                      </View>
                      <Text style={styles.transferDate}>{formatShortDate(t.paid_at)}</Text>
                    </View>
                    {i < group.transfers.length - 1 && <View style={styles.sep} />}
                  </View>
                ))}
              </View>
            ))
          )}

          <TouchableOpacity
            style={styles.backLink}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={styles.backLinkText}>Voltar para pagamentos</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Filter modal */}
      <Modal visible={filterVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setFilterVisible(false)} />
          <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
            <View style={styles.sheetHandleRow}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.sheetHeaderContent}>
              <Text style={styles.sheetTitle}>Filtrar mês</Text>
            </View>
            <View style={styles.sheetDivider} />
            <View style={styles.sheetBody}>
              <Text style={styles.filterSectionTitle}>Data do histórico de pagamento</Text>

              {/* Month navigation inside filter */}
              <View style={styles.filterMonthNav}>
                <TouchableOpacity
                  onPress={() => {
                    const newM = filterMonth === 0 ? 11 : filterMonth - 1;
                    const newY = filterMonth === 0 ? filterYear - 1 : filterYear;
                    setFilterMonth(newM); setFilterYear(newY);
                  }}
                  hitSlop={12} activeOpacity={0.7}
                >
                  <MaterialIcons name="chevron-left" size={24} color="#374151" />
                </TouchableOpacity>
                <Text style={styles.filterMonthLabel}>{PT_MONTHS[filterMonth]} {filterYear}</Text>
                <TouchableOpacity
                  onPress={() => {
                    const newM = filterMonth === 11 ? 0 : filterMonth + 1;
                    const newY = filterMonth === 11 ? filterYear + 1 : filterYear;
                    setFilterMonth(newM); setFilterYear(newY);
                  }}
                  hitSlop={12} activeOpacity={0.7}
                >
                  <MaterialIcons name="chevron-right" size={24} color="#374151" />
                </TouchableOpacity>
              </View>

              {/* Data inicial */}
              <Text style={styles.filterLabelText}>Data inicial</Text>
              <View style={styles.filterDateField}>
                <MaterialIcons name="calendar-today" size={18} color="#9CA3AF" />
                <Text style={styles.filterDateText}>{String(filterStartDay).padStart(2,'0')} de {filterMonthNameStr}</Text>
                <View style={styles.filterDayStepper}>
                  <TouchableOpacity
                    onPress={() => setFilterStartDay((d) => Math.max(1, d - 1))}
                    hitSlop={8} activeOpacity={0.7}
                  >
                    <MaterialIcons name="remove" size={20} color="#374151" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setFilterStartDay((d) => Math.min(filterEndDay - 1, filterDaysInMonth, d + 1))}
                    hitSlop={8} activeOpacity={0.7}
                  >
                    <MaterialIcons name="add" size={20} color="#374151" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Data final */}
              <Text style={styles.filterLabelText}>Data final</Text>
              <View style={styles.filterDateField}>
                <MaterialIcons name="calendar-today" size={18} color="#9CA3AF" />
                <Text style={styles.filterDateText}>{String(filterEndDay).padStart(2,'0')} de {filterMonthNameStr}</Text>
                <View style={styles.filterDayStepper}>
                  <TouchableOpacity
                    onPress={() => setFilterEndDay((d) => Math.max(filterStartDay + 1, d - 1))}
                    hitSlop={8} activeOpacity={0.7}
                  >
                    <MaterialIcons name="remove" size={20} color="#374151" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setFilterEndDay((d) => Math.min(filterDaysInMonth, d + 1))}
                    hitSlop={8} activeOpacity={0.7}
                  >
                    <MaterialIcons name="add" size={20} color="#374151" />
                  </TouchableOpacity>
                </View>
              </View>

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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },

  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, gap: 20,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  monthLabel: { fontSize: 16, fontWeight: '600', color: '#111827', minWidth: 100, textAlign: 'center' },

  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 20 },

  periodCard: { alignItems: 'center', marginBottom: 24 },
  periodRange: { fontSize: 14, color: '#9CA3AF', marginBottom: 4 },
  periodTotal: { fontSize: 32, fontWeight: '700', color: '#111827' },

  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginVertical: 24 },

  weekGroup: { marginBottom: 24 },
  weekLabel: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 8 },

  transferRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  pixIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center',
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
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  sheetHandleRow: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  sheetHeaderContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  sheetDivider: { height: 1, backgroundColor: '#E5E7EB' },
  sheetBody: { paddingHorizontal: 24, paddingTop: 24, gap: 12 },

  filterSectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  filterMonthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 16, marginBottom: 8,
  },
  filterMonthLabel: { fontSize: 15, fontWeight: '600', color: '#374151', minWidth: 140, textAlign: 'center' },
  filterLabelText: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 4 },
  filterDateField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  filterDateText: { fontSize: 15, color: '#6B7280', flex: 1 },
  filterDayStepper: { flexDirection: 'row', gap: 16, alignItems: 'center' },

  btnPrimary: {
    backgroundColor: '#0d0d0d', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnPrimaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
