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
import * as FileSystem from 'expo-file-system/legacy';
import { shareLocalFile } from '../../utils/shareLocalFile';

// expo-print é módulo nativo: dev clients antigos podem não tê-lo embutido.
// Carregamos de forma resiliente para a tela não quebrar sem o módulo.
let Print: typeof import('expo-print') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Print = require('expo-print') as typeof import('expo-print');
} catch {
  Print = null;
}

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Monta o HTML do orçamento que o expo-print converte em PDF. */
function buildBudgetHtml(args: {
  destination: string;
  dateLabel: string;
  peopleCount: number;
  lines: BudgetLine[];
  total: number;
  generatedAt: string;
}): string {
  const { destination, dateLabel, peopleCount, lines, total, generatedAt } = args;
  const rows = lines.length
    ? lines
        .map(
          (l) => `
        <tr>
          <td class="label">${escapeHtml(l.label)}</td>
          <td class="value">${escapeHtml(formatCents(l.amount_cents))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td class="label" colspan="2">Orçamento em preparação.</td></tr>`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; color: #0d0d0d; margin: 0; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #767676; font-size: 13px; margin: 0 0 24px; }
  .summary { background: #f1f1f1; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
  .summary-row { font-size: 14px; margin: 4px 0; }
  .summary-row b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  td { padding: 10px 0; border-bottom: 1px solid #e2e2e2; font-size: 14px; }
  td.value { text-align: right; }
  .total { display: flex; justify-content: space-between; padding-top: 12px; border-top: 2px solid #0d0d0d; font-size: 18px; font-weight: 700; }
  .footer { margin-top: 32px; color: #767676; font-size: 11px; line-height: 1.5; }
</style>
</head>
<body>
  <h1>Orçamento da excursão</h1>
  <p class="subtitle">Take Me — gerado em ${escapeHtml(generatedAt)}</p>
  <div class="summary">
    <div class="summary-row"><b>Destino:</b> ${escapeHtml(destination)}</div>
    <div class="summary-row"><b>Data:</b> ${escapeHtml(dateLabel)}</div>
    <div class="summary-row"><b>Pessoas:</b> ${peopleCount}</div>
  </div>
  <table>${rows}</table>
  <div class="total"><span>Total</span><span>${escapeHtml(formatCents(total))}</span></div>
  <p class="footer">Documento gerado pelo app Take Me. Os valores podem sofrer ajustes até a confirmação da excursão.</p>
</body>
</html>`;
}

export function ExcursionBudgetScreen({ navigation, route }: Props) {
  const excursionRequestId = route.params?.excursionRequestId ?? '';
  const [detail, setDetail] = useState<ExcursionBudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPayment, setSavingPayment] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>('pix');
  const [pixPaymentInfo, setPixPaymentInfo] = useState<PixPaymentInfo | null>(null);
  const [downloading, setDownloading] = useState(false);

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
      else if (savedMethod === 'cash') setSelectedPaymentMethod('dinheiro');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [excursionRequestId]);

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

    // Dinheiro: não passa pelo Stripe. Confirma direto via confirm-excursion-cash,
    // que aprova o orçamento e cria os payouts (espelha o stripe-webhook).
    if (params.method === 'dinheiro') {
      setSavingPayment(true);
      setPixPaymentInfo(null);
      try {
        const { data: refreshData } = await supabase.auth.refreshSession();
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = refreshData.session?.access_token ?? session?.access_token;
        if (!accessToken) {
          Alert.alert('Pagamento', 'Faça login novamente para concluir o pagamento.');
          return;
        }
        const { data, error } = await supabase.functions.invoke('confirm-excursion-cash', {
          headers: { Authorization: `Bearer ${accessToken}` },
          body: { excursion_request_id: detail.id },
        });
        const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
        const edgeError =
          error || (typeof payload.error === 'string' && payload.error.trim() ? { message: payload.error.trim() } : null);
        if (edgeError) {
          const message = await describeInvokeFailure(data, edgeError);
          Alert.alert('Pagamento', message || 'Não foi possível confirmar o pagamento em dinheiro.');
          return;
        }
        setDetail((prev) => prev ? { ...prev, payment_method: 'cash', status: 'approved' } : prev);
        Alert.alert(
          'Pagamento em dinheiro',
          'Orçamento confirmado. O valor total será pago em mãos ao motorista. Sua excursão será preparada.',
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } finally {
        setSavingPayment(false);
      }
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

  const handleDownloadBudget = async () => {
    if (!detail || downloading) return;
    if (!Print) {
      Alert.alert('Baixar orçamento', 'Atualize o app para baixar o orçamento em PDF.');
      return;
    }
    setDownloading(true);
    try {
      const lines = normalizeBudgetLines(detail.budget_lines);
      const total = detail.total_amount_cents ?? 0;
      const html = buildBudgetHtml({
        destination: detail.destination,
        dateLabel: formatDate(detail.excursion_date),
        peopleCount: detail.people_count,
        lines,
        total,
        generatedAt: new Date().toLocaleDateString('pt-BR'),
      });
      const { uri } = await Print.printToFileAsync({ html });
      // expo-print gera nome aleatório; renomeia para um nome amigável.
      let fileUri = uri;
      const stamp = new Date().toISOString().slice(0, 10);
      const dest = `${FileSystem.cacheDirectory}orcamento-excursao-takeme-${stamp}.pdf`;
      try {
        await FileSystem.deleteAsync(dest, { idempotent: true });
        await FileSystem.moveAsync({ from: uri, to: dest });
        fileUri = dest;
      } catch {
        /* mantém o uri original se o rename falhar */
      }
      const shared = await shareLocalFile(fileUri, {
        mimeType: 'application/pdf',
        uti: 'com.adobe.pdf',
        dialogTitle: 'Baixar orçamento da excursão',
        fallbackTitle: 'Orçamento da excursão — Take Me',
      });
      if (!shared.shared) {
        Alert.alert('Baixar orçamento', 'Atualize o app para baixar o orçamento em PDF neste dispositivo.');
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setDownloading(false);
    }
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

            <TouchableOpacity style={styles.downloadButton} onPress={handleDownloadBudget} disabled={downloading}>
              {downloading ? (
                <ActivityIndicator size="small" color={COLORS.black} />
              ) : (
                <MaterialIcons name="download" size={20} color={COLORS.black} />
              )}
              <Text style={styles.downloadButtonText}>{downloading ? 'Gerando PDF…' : 'Baixar orçamento'}</Text>
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
                    : method === 'dinheiro'
                      ? 'cash'
                      : method,
              );
            }}
            onConfirmPayment={handleConfirmPayment}
            confirmLabel="Pagar orçamento"
            cancellationPolicyVariant="trip"
            loading={savingPayment}
            allowedMethods={['credito', 'debito', 'pix', 'dinheiro']}
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
