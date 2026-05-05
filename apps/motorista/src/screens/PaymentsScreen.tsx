import { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { fetchDriverPaymentTransfers, type DriverPaymentTransfer } from '../lib/driverPaymentTransfers';
import {
  fetchDriverPlatformFeeSummary,
  platformFeeLedgerAmountLabel,
  platformFeeLedgerTitle,
  type DriverPlatformFeeSummary,
} from '../lib/driverPlatformFee';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { describeInvokeFailure } from '../utils/edgeFunctionResponse';
import { getStripeConnectState, type StripeConnectState } from '../lib/motoristaAccess';
import { StripeConnectBlock } from '../components/StripeConnectBlock';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Payments'>,
  NativeStackScreenProps<RootStackParamList>
>;

const GOLD = '#C9A227';
const CREAM = '#FFFBEB';
const MUTED = '#6B7280';
const SUBTLE = '#9CA3AF';
const INK = '#111827';

type Transfer = DriverPaymentTransfer;

const EMPTY_PLATFORM_FEE_SUMMARY: DriverPlatformFeeSummary = {
  owedCents: 0,
  entries: [],
  unavailable: false,
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${d.getDate().toString().padStart(2, '0')} ${months[d.getMonth()]}`;
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function PixIcon() {
  return (
    <View style={styles.pixIconCircle}>
      <Text style={styles.pixIconDiamond}>◆</Text>
    </View>
  );
}

export function PaymentsScreen({ navigation }: Props) {
  const [totalCents, setTotalCents] = useState(0);
  const [rides, setRides] = useState(0);
  const [tips, setTips] = useState(0);
  const [tipsCents, setTipsCents] = useState(0);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [stripeState, setStripeState] = useState<StripeConnectState>('none');
  const [stripePendingVerification, setStripePendingVerification] = useState(0);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [expressLoginLoading, setExpressLoginLoading] = useState(false);
  const [platformFeeSummary, setPlatformFeeSummary] = useState<DriverPlatformFeeSummary>(
    EMPTY_PLATFORM_FEE_SUMMARY,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Sync best-effort com a Stripe antes de ler do banco, para não ficar dependendo
    // só do webhook `account.updated`. Se a função falhar, seguimos com o que temos.
    await supabase.functions.invoke('stripe-connect-sync', { body: {} }).catch(() => undefined);

    const { data: wp } = await supabase
      .from('worker_profiles')
      .select(
        'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due_count, stripe_connect_pending_verification_count'
      )
      .eq('id', user.id)
      .single();
    setStripeState(getStripeConnectState(wp));
    setStripePendingVerification(Number(wp?.stripe_connect_pending_verification_count ?? 0) || 0);
    const acct = (wp?.stripe_connect_account_id as string | null | undefined)?.trim() ?? '';
    setStripeAccountId(acct || null);
    const feeSummary = await fetchDriverPlatformFeeSummary(supabase, 5).catch(() => ({
      ...EMPTY_PLATFORM_FEE_SUMMARY,
      unavailable: true,
    }));
    setPlatformFeeSummary(feeSummary);

    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

    const list = await fetchDriverPaymentTransfers(supabase, user.id, start, end);

    setTransfers(list);
    setRides(list.length);
    const transfersSum = list.reduce((s, t) => s + t.amount_cents, 0);

    // Gorjetas recebidas hoje (via PaymentIntent separado, transferido 100% para
    // o motorista via transfer_data.destination). Somamos as 3 entidades.
    const [bTips, sTips, dTips] = await Promise.all([
      supabase
        .from('bookings')
        .select('tip_cents, scheduled_trips!inner(driver_id)')
        .eq('tip_status', 'succeeded')
        .gte('tip_paid_at', start)
        .lte('tip_paid_at', end)
        .eq('scheduled_trips.driver_id', user.id),
      supabase
        .from('shipments')
        .select('tip_cents')
        .eq('tip_status', 'succeeded')
        .eq('driver_id', user.id)
        .gte('tip_paid_at', start)
        .lte('tip_paid_at', end),
      supabase
        .from('dependent_shipments')
        .select('tip_cents, scheduled_trips!inner(driver_id)')
        .eq('tip_status', 'succeeded')
        .gte('tip_paid_at', start)
        .lte('tip_paid_at', end)
        .eq('scheduled_trips.driver_id', user.id),
    ]);

    const tipRows = [
      ...((bTips.data ?? []) as { tip_cents: number | null }[]),
      ...((sTips.data ?? []) as { tip_cents: number | null }[]),
      ...((dTips.data ?? []) as { tip_cents: number | null }[]),
    ];
    const tipsSum = tipRows.reduce((s, r) => s + (Number(r.tip_cents) || 0), 0);
    setTips(tipRows.length);
    setTipsCents(tipsSum);
    setTotalCents(transfersSum + tipsSum);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleStripeConnectSetup = async () => {
    setConnectLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        setConnectLoading(false);
        return;
      }
      const res = await supabase.functions.invoke('stripe-connect-link', {
        body: {
          return_url: 'take-me-motorista://payments',
          refresh_url: 'take-me-motorista://payments',
          link_type:
            stripeState === 'action_required' || stripeState === 'in_review' ? 'update' : 'onboarding',
        },
      });
      const url = (res.data as { url?: unknown } | null)?.url;
      const isHttp = typeof url === 'string' && /^https?:\/\//i.test(url.trim());
      if (res.error || !isHttp) {
        const msg = await describeInvokeFailure(res.data, res.error);
        Alert.alert('Erro', msg || 'Não foi possível gerar o link de configuração.');
        setConnectLoading(false);
        return;
      }
      await Linking.openURL((url as string).trim());
    } catch (e: any) {
      Alert.alert('Erro', e?.message || 'Falha ao abrir configuração de pagamento.');
    }
    setConnectLoading(false);
  };

  const handleStripeExpressLogin = async () => {
    setExpressLoginLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        return;
      }
      const res = await supabase.functions.invoke('stripe-connect-link', {
        body: { flow: 'express_login' },
      });
      const url = (res.data as { url?: unknown } | null)?.url;
      const isHttp = typeof url === 'string' && /^https?:\/\//i.test(url.trim());
      if (res.error || !isHttp) {
        const msg = await describeInvokeFailure(res.data, res.error);
        Alert.alert('Erro', msg || 'Não foi possível abrir o painel Stripe.');
        return;
      }
      await Linking.openURL((url as string).trim());
    } catch (e: any) {
      Alert.alert('Erro', e?.message || 'Falha ao abrir o painel Stripe.');
    } finally {
      setExpressLoginLoading(false);
    }
  };

  const showStripeExpressLink = Boolean(stripeAccountId) && stripeState !== 'active';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.headerTitle}>Pagamentos</Text>
        <View style={styles.headerSide}>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => navigation.navigate('Notifications')}
            activeOpacity={0.7}
          >
            <MaterialIcons name="notifications-none" size={22} color={INK} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={GOLD} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hero: recebido hoje */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Recebido hoje</Text>
            <Text style={styles.heroAmount}>{formatCents(totalCents)}</Text>
            <View style={styles.heroChips}>
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{rides}</Text>
                <Text style={styles.chipLabel}>{rides === 1 ? 'corrida' : 'corridas'}</Text>
              </View>
              <View style={styles.chipDivider} />
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{tips}</Text>
                <Text style={styles.chipLabel}>{tips === 1 ? 'gorjeta' : 'gorjetas'}</Text>
              </View>
            </View>
            {tipsCents > 0 && (
              <Text style={styles.tipsHeroSub}>
                + {formatCents(tipsCents)} em gorjetas
              </Text>
            )}
          </View>

          {/* Seção: Conta de recebimento */}
          <Text style={styles.sectionTitle}>Conta de recebimento</Text>

          <StripeConnectBlock
            state={stripeState}
            pendingVerificationCount={stripePendingVerification}
            loading={connectLoading}
            onPressSetup={handleStripeConnectSetup}
            showExpressLink={showStripeExpressLink}
            expressLoginLoading={expressLoginLoading}
            onPressExpress={handleStripeExpressLogin}
          />

          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Saldo devido à plataforma</Text>
          <View style={styles.platformFeeCard}>
            <View style={styles.platformFeeHeader}>
              <View style={styles.platformFeeIcon}>
                <MaterialIcons name="account-balance-wallet" size={20} color={GOLD} />
              </View>
              <View style={styles.platformFeeTitleCol}>
                <Text style={styles.platformFeeLabel}>Saldo atual</Text>
                <Text style={styles.platformFeeHint}>
                  Taxas de corridas em dinheiro são abatidas quando o Connect estiver ativo.
                </Text>
              </View>
              <Text
                style={[
                  styles.platformFeeAmount,
                  platformFeeSummary.owedCents > 0 ? styles.platformFeeAmountWarn : styles.platformFeeAmountOk,
                ]}
              >
                {formatCents(platformFeeSummary.owedCents)}
              </Text>
            </View>

            {platformFeeSummary.unavailable ? (
              <Text style={styles.platformFeeEmpty}>
                Saldo temporariamente indisponível. Tente atualizar novamente em alguns instantes.
              </Text>
            ) : platformFeeSummary.entries.length === 0 ? (
              <Text style={styles.platformFeeEmpty}>Nenhuma movimentação registrada.</Text>
            ) : (
              <View style={styles.ledgerList}>
                {platformFeeSummary.entries.map((entry, i) => (
                  <View key={entry.id}>
                    <View style={styles.ledgerRow}>
                      <View style={styles.ledgerInfo}>
                        <Text style={styles.ledgerTitle}>{platformFeeLedgerTitle(entry)}</Text>
                        <Text style={styles.ledgerMeta}>
                          {formatShortDate(entry.createdAt)} • {formatHour(entry.createdAt)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.ledgerAmount,
                          entry.kind === 'credit' ? styles.ledgerAmountCredit : styles.ledgerAmountDebit,
                        ]}
                      >
                        {platformFeeLedgerAmountLabel(entry)}
                      </Text>
                    </View>
                    {i < platformFeeSummary.entries.length - 1 && <View style={styles.ledgerSep} />}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Transferências de hoje */}
          <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Transferências de hoje</Text>

          {transfers.length === 0 ? (
            <Text style={styles.emptyText}>Nenhuma transferência hoje.</Text>
          ) : (
            <View>
              {transfers.map((t, i) => (
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
                  {i < transfers.length - 1 && <View style={styles.sep} />}
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.historyLink}
            onPress={() => navigation.navigate('PaymentHistory')}
            activeOpacity={0.7}
          >
            <Text style={styles.historyLinkText}>Ver histórico completo</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerSide: { width: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: INK },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 24 },

  /* Hero */
  hero: { alignItems: 'center', marginBottom: 32 },
  heroLabel: { fontSize: 13, color: SUBTLE, marginBottom: 4, letterSpacing: 0.3 },
  heroAmount: { fontSize: 40, fontWeight: '700', color: INK, marginBottom: 16, letterSpacing: -0.5 },
  heroChips: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipValue: { fontSize: 15, fontWeight: '700', color: INK },
  chipLabel: { fontSize: 13, color: MUTED },
  tipsHeroSub: { marginTop: 10, fontSize: 13, fontWeight: '600', color: GOLD },
  chipDivider: { width: 1, height: 14, backgroundColor: '#E5E7EB', marginHorizontal: 14 },

  /* Seções */
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: SUBTLE,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },

  /* Transferências */
  emptyText: { fontSize: 14, color: SUBTLE, marginVertical: 8 },
  transferRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  pixIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center',
  },
  pixIconDiamond: { fontSize: 20, color: GOLD },
  transferInfo: { flex: 1 },
  transferAmount: { fontSize: 16, fontWeight: '700', color: INK },
  transferMeta: { fontSize: 13, color: SUBTLE, marginTop: 2 },
  transferDate: { fontSize: 14, color: SUBTLE },
  sep: { height: 1, backgroundColor: '#F3F4F6' },

  platformFeeCard: {
    borderWidth: 1,
    borderColor: '#F3E3A3',
    backgroundColor: CREAM,
    borderRadius: 16,
    padding: 16,
  },
  platformFeeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  platformFeeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformFeeTitleCol: { flex: 1 },
  platformFeeLabel: { fontSize: 15, fontWeight: '700', color: INK },
  platformFeeHint: { fontSize: 12, color: MUTED, lineHeight: 16, marginTop: 2 },
  platformFeeAmount: { fontSize: 17, fontWeight: '800' },
  platformFeeAmountWarn: { color: '#92400E' },
  platformFeeAmountOk: { color: '#16A34A' },
  platformFeeEmpty: { marginTop: 14, fontSize: 13, color: MUTED, lineHeight: 18 },
  ledgerList: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#F3E3A3' },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  ledgerInfo: { flex: 1 },
  ledgerTitle: { fontSize: 13, fontWeight: '700', color: INK },
  ledgerMeta: { fontSize: 12, color: SUBTLE, marginTop: 2 },
  ledgerAmount: { fontSize: 13, fontWeight: '800' },
  ledgerAmountCredit: { color: '#92400E' },
  ledgerAmountDebit: { color: '#16A34A' },
  ledgerSep: { height: 1, backgroundColor: '#F3E3A3' },

  historyLink: { alignItems: 'center', marginTop: 24 },
  historyLinkText: { fontSize: 14, color: MUTED, textDecorationLine: 'underline', fontWeight: '500' },
});
