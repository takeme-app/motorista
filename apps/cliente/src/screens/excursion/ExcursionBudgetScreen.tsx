import { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Clipboard,
  Linking,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import { supabase } from '../../lib/supabase';
import { PaymentMethodSection, type CardPaymentConfirmParams, type PaymentMethodType } from '../../components/PaymentMethodSection';
import { ensureAccessTokenForStripeFunctions } from '../../lib/ensureStripeCustomerForPayment';
import { describeInvokeFailure } from '../../utils/edgeFunctionResponse';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ExcursionBudget'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

type BudgetLine = { label: string; amount_cents: number };

type ExcursionBudgetDetail = {
  id: string;
  destination: string;
  excursion_date: string;
  people_count: number;
  total_amount_cents: number | null;
  budget_lines: unknown;
  payment_method: string | null;
  status?: string | null;
};

type PixPaymentInfo = {
  paymentIntentId: string | null;
  hostedVoucherUrl: string | null;
  pixCopyPaste: string | null;
};

function normalizeBudgetLines(raw: unknown): BudgetLine[] {
  if (Array.isArray(raw)) {
    return raw.map((line) => {
      const row = (line ?? {}) as Record<string, unknown>;
      const qty = Number(row.qty ?? row.quantity ?? 1) || 1;
      const unit = Number(row.value_cents ?? 0) || 0;
      return {
        label: String(row.label ?? row.name ?? 'Item'),
        amount_cents: Number(row.amount_cents ?? qty * unit) || 0,
      };
    });
  }
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.display_lines)) return normalizeBudgetLines(obj.display_lines);
  return [];
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  return `${day} ${months[d.getMonth()]}`;
}

function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export function ExcursionBudgetScreen({ navigation, route }: Props) {
  const excursionRequestId = route.params?.excursionRequestId ?? '';
  const [detail, setDetail] = useState<ExcursionBudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPayment, setSavingPayment] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>('pix');
  const [pixPaymentInfo, setPixPaymentInfo] = useState<PixPaymentInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !excursionRequestId) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('excursion_requests')
        .select('id, destination, excursion_date, people_count, total_amount_cents, budget_lines, payment_method, status')
        .eq('id', excursionRequestId)
        .eq('user_id', user.id)
        .single();
      if (cancelled) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      setDetail(data as ExcursionBudgetDetail);
      const savedMethod = (data as ExcursionBudgetDetail).payment_method;
      if (savedMethod === 'credit_card') setSelectedPaymentMethod('credito');
      else if (savedMethod === 'debit_card') setSelectedPaymentMethod('debito');
      else if (savedMethod === 'pix') setSelectedPaymentMethod('pix');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [excursionRequestId]);

  // Após gerar o Pix, o pagamento é assíncrono: o stripe-webhook muda o status
  // para `approved`. Faz polling do status enquanto o Pix está pendente para
  // atualizar a tela sem o usuário precisar sair e voltar.
  useEffect(() => {
    if (!pixPaymentInfo || !detail || detail.status === 'approved') return;
    let cancelled = false;
    const excId = detail.id;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('excursion_requests')
        .select('status')
        .eq('id', excId)
        .maybeSingle();
      if (cancelled) return;
      const st = (data as { status?: string } | null)?.status;
      if (st === 'approved') {
        clearInterval(interval);
        setDetail((prev) => (prev ? { ...prev, status: 'approved' } : prev));
        setPixPaymentInfo(null);
        Alert.alert('Pagamento confirmado', 'Recebemos o seu Pix e sua excursão foi confirmada.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else if (st && st !== 'quoted') {
        clearInterval(interval);
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pixPaymentInfo, detail, navigation]);

  const handlePaymentSelect = async (method: string) => {
    if (!excursionRequestId || savingPayment) return;
    setSavingPayment(true);
    const { error } = await supabase
      .from('excursion_requests')
      .update({ payment_method: method })
      .eq('id', excursionRequestId);
    setSavingPayment(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível salvar o método de pagamento.');
      return;
    }
    setDetail((prev) => prev ? { ...prev, payment_method: method } : null);
  };

  const handleConfirmPayment = async (params: CardPaymentConfirmParams) => {
    if (!detail || savingPayment) return;
    const total = detail.total_amount_cents ?? 0;
    if (total < 1) {
      Alert.alert('Orçamento', 'Este orçamento ainda não tem valor para pagamento.');
      return;
    }
    const payment_method =
      params.method === 'credito'
        ? 'credit_card'
        : params.method === 'debito'
          ? 'debit_card'
          : params.method === 'pix'
            ? 'pix'
            : null;
    if (!payment_method) {
      Alert.alert('Pagamento', 'Este orçamento só aceita Pix ou cartão pelo app.');
      return;
    }

    setSavingPayment(true);
    setPixPaymentInfo(null);
    try {
      const tokenRes = await ensureAccessTokenForStripeFunctions({
        holderCpfDigits: params.holderCpfDigits,
      });
      if (!tokenRes.ok) {
        Alert.alert('Pagamento', tokenRes.message);
        return;
      }
      const body: Record<string, unknown> = {
        excursion_request_id: detail.id,
        payment_method,
      };
      if (params.savedPaymentMethodId) body.payment_method_id = params.savedPaymentMethodId.trim();
      if (params.paymentMethodId) body.stripe_payment_method_id = params.paymentMethodId.trim();
      const { data, error } = await supabase.functions.invoke('charge-excursion-request', {
        headers: { Authorization: `Bearer ${tokenRes.accessToken}` },
        body,
      });
      const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const edgeError =
        error || (typeof payload.error === 'string' && payload.error.trim() ? { message: payload.error.trim() } : null);
      if (edgeError) {
        const message = await describeInvokeFailure(data, edgeError);
        Alert.alert('Pagamento', message || 'Não foi possível iniciar o pagamento.');
        return;
      }
      if (payload.pix_requires_payment === true) {
        setPixPaymentInfo({
          paymentIntentId: typeof payload.payment_intent_id === 'string' ? payload.payment_intent_id : null,
          hostedVoucherUrl: typeof payload.hosted_voucher_url === 'string' ? payload.hosted_voucher_url : null,
          pixCopyPaste: typeof payload.pix_copy_paste === 'string' ? payload.pix_copy_paste : null,
        });
        setDetail((prev) => prev ? { ...prev, payment_method } : prev);
        Alert.alert('Pix gerado', 'Use o código Pix para concluir o pagamento no app do seu banco.');
        return;
      }
      setDetail((prev) => prev ? { ...prev, payment_method, status: 'approved' } : prev);
      Alert.alert('Pagamento', 'Pagamento aprovado. Sua excursão será confirmada em instantes.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDownloadBudget = () => {
    if (!detail) return;
    const lines = normalizeBudgetLines(detail.budget_lines);
    const total = detail.total_amount_cents ?? 0;
    const text = [
      'Resumo da excursão',
      `Destino: ${detail.destination}`,
      `Data: ${formatDate(detail.excursion_date)}`,
      `Pessoas: ${detail.people_count}`,
      '',
      'Orçamento',
      ...lines.map((l) => `${l.label}: ${formatCents(l.amount_cents)}`),
      '',
      `Total: ${formatCents(total)}`,
    ].join('\n');
    Alert.alert('Orçamento', 'Conteúdo do orçamento gerado. Em produção você pode compartilhar ou salvar como arquivo.', [
      { text: 'OK' },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes da excursão</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes da excursão</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.mutedText}>Orçamento não encontrado.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const lines = normalizeBudgetLines(detail.budget_lines);
  const total = detail.total_amount_cents ?? 0;
  const hasBudget = lines.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalhes da excursão</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Detalhes do orçamento</Text>
        <Text style={styles.sectionSubtitle}>Confira o resumo da sua excursão antes de prosseguir com o pagamento.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Resumo da excursão</Text>
          <View style={styles.summaryRow}>
            <MaterialIcons name="place" size={20} color={COLORS.neutral700} />
            <Text style={styles.summaryText}>{detail.destination}</Text>
          </View>
          <View style={styles.summaryRow}>
            <MaterialIcons name="event" size={20} color={COLORS.neutral700} />
            <Text style={styles.summaryText}>{formatDate(detail.excursion_date)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <MaterialIcons name="people" size={20} color={COLORS.neutral700} />
            <Text style={styles.summaryText}>{detail.people_count} pessoas</Text>
          </View>
        </View>

        {hasBudget ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Resumo da excursão</Text>
              {lines.map((line, i) => (
                <View key={i} style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>{line.label}</Text>
                  <Text style={styles.budgetValue}>{formatCents(line.amount_cents)}</Text>
                </View>
              ))}
              <View style={[styles.budgetRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{formatCents(total)}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.downloadButton} onPress={handleDownloadBudget}>
              <MaterialIcons name="download" size={20} color={COLORS.black} />
              <Text style={styles.downloadButtonText}>Baixar orçamento</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.mutedText}>Orçamento em preparação. Você será notificado quando estiver pronto.</Text>
          </View>
        )}

        {detail.status && detail.status !== 'quoted' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Status do orçamento</Text>
            <Text style={styles.mutedText}>
              {detail.status === 'approved'
                ? 'Pagamento aprovado. A equipe já pode preparar a operação.'
                : 'Este orçamento não está disponível para pagamento no momento.'}
            </Text>
          </View>
        ) : null}

        {pixPaymentInfo ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pix gerado</Text>
            {pixPaymentInfo.pixCopyPaste ? (
              <TouchableOpacity
                style={styles.downloadButton}
                onPress={() => {
                  Clipboard.setString(pixPaymentInfo.pixCopyPaste ?? '');
                  Alert.alert('Pix', 'Código copiado.');
                }}
              >
                <MaterialIcons name="content-copy" size={20} color={COLORS.black} />
                <Text style={styles.downloadButtonText}>Copiar código Pix</Text>
              </TouchableOpacity>
            ) : null}
            {pixPaymentInfo.hostedVoucherUrl ? (
              <TouchableOpacity
                style={styles.downloadButton}
                onPress={() => Linking.openURL(pixPaymentInfo.hostedVoucherUrl ?? '')}
              >
                <MaterialIcons name="open-in-new" size={20} color={COLORS.black} />
                <Text style={styles.downloadButtonText}>Abrir comprovante Pix</Text>
              </TouchableOpacity>
            ) : null}
            {pixPaymentInfo.paymentIntentId ? (
              <Text style={styles.mutedText}>Pagamento: {pixPaymentInfo.paymentIntentId}</Text>
            ) : null}
            <View style={styles.pixWaitingRow}>
              <ActivityIndicator size="small" color={COLORS.neutral700} />
              <Text style={styles.mutedText}>Aguardando confirmação do pagamento…</Text>
            </View>
          </View>
        ) : null}

        {detail.status === 'quoted' ? (
          <PaymentMethodSection
            amountCents={total}
            selectedMethod={selectedPaymentMethod}
            onSelectMethod={(method) => {
              setSelectedPaymentMethod(method);
              void handlePaymentSelect(
                method === 'credito'
                  ? 'credit_card'
                  : method === 'debito'
                    ? 'debit_card'
                    : method,
              );
            }}
            onConfirmPayment={handleConfirmPayment}
            confirmLabel="Pagar orçamento"
            cancellationPolicyVariant="trip"
            loading={savingPayment}
            allowedMethods={['credito', 'debito', 'pix']}
          />
        ) : null}
      </ScrollView>
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
    borderBottomColor: COLORS.neutral400,
  },
  closeButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mutedText: { fontSize: 15, color: COLORS.neutral700 },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 48 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, color: COLORS.neutral700, marginBottom: 16 },
  card: {
    backgroundColor: COLORS.neutral300,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.black, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  summaryText: { fontSize: 15, color: COLORS.black, flex: 1 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  budgetLabel: { fontSize: 15, color: COLORS.black },
  budgetValue: { fontSize: 15, color: COLORS.black },
  totalRow: { marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.neutral400, paddingTop: 12 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  totalValue: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.neutral300,
    marginBottom: 24,
  },
  downloadButtonText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  pixWaitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  paymentLabel: { fontSize: 16, color: COLORS.black },
});
