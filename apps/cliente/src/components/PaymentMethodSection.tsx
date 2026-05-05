import { useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import { CardField, useStripe } from '../lib/stripeNativeBridge';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { formatCpf, onlyDigits, validateCpf } from '../utils/formatCpf';
import { supabase } from '../lib/supabase';

export type PaymentMethodType = 'credito' | 'debito' | 'pix' | 'dinheiro';

export type CancellationPolicyVariant = 'trip' | 'shipment_credit' | 'shipment_debit';

export type CardPaymentConfirmParams = {
  method: PaymentMethodType;
  /** Id do PaymentMethod na Stripe (`pm_…`), quando o cartão foi tokenizado agora. */
  paymentMethodId?: string;
  /** Id da linha em `public.payment_methods` (cartão já salvo no cadastro / carteira). */
  savedPaymentMethodId?: string;
  /** CPF do portador (11 dígitos), para registro no Customer Stripe (BR). */
  holderCpfDigits?: string;
};

export type PaymentMethodSectionProps = {
  amountCents: number;
  selectedMethod: PaymentMethodType | null;
  onSelectMethod: (method: PaymentMethodType) => void;
  onConfirmPayment: (params: CardPaymentConfirmParams) => void | Promise<void>;
  confirmLabel: string;
  cancellationPolicyVariant: CancellationPolicyVariant;
  loading?: boolean;
  /** Se definido, só estes métodos são exibidos (ex.: só dinheiro sem Stripe Connect). */
  allowedMethods?: PaymentMethodType[];
  /** Texto do aviso quando só dinheiro por falta de Stripe Connect (default: viagem). */
  connectCashOnlyContext?: 'trip' | 'dependent_shipment';
};

type SavedCardRow = {
  id: string;
  type: 'credit' | 'debit';
  last_four: string | null;
  holder_name: string | null;
  brand: string | null;
};

const PAYMENT_OPTIONS: { type: PaymentMethodType; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { type: 'credito', label: 'Cartão de crédito', icon: 'credit-card' },
  { type: 'debito', label: 'Cartão de débito', icon: 'credit-card' },
  { type: 'pix', label: 'Pix', icon: 'qr-code-2' },
  { type: 'dinheiro', label: 'Dinheiro', icon: 'payments' },
];

function getCancellationPolicyLines(
  variant: CancellationPolicyVariant,
  freeWindowHours: number,
): string[] {
  const hoursLabel = formatHoursLabel(freeWindowHours);
  switch (variant) {
    case 'shipment_credit':
    case 'shipment_debit':
    case 'trip':
    default:
      return [
        `Cancelamento até ${hoursLabel} antes da partida: reembolso integral`,
        `Cancelamento após esse prazo: sem reembolso`,
      ];
  }
}

function formatHoursLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '2h';
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

export function PaymentMethodSection({
  amountCents,
  selectedMethod,
  onSelectMethod,
  onConfirmPayment,
  confirmLabel,
  cancellationPolicyVariant,
  loading = false,
  allowedMethods,
  connectCashOnlyContext = 'trip',
}: PaymentMethodSectionProps) {
  const isFocused = useIsFocused();
  const { createPaymentMethod } = useStripe();
  const { showAlert } = useAppAlert();
  const [cardName, setCardName] = useState('');
  const [cardComplete, setCardComplete] = useState(false);
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pixResendCooldown, setPixResendCooldown] = useState(0);
  const [savedCards, setSavedCards] = useState<SavedCardRow[]>([]);
  const [savedCardsLoading, setSavedCardsLoading] = useState(false);
  /** Cartão salvo vs tokenizar novo (quando existir salvo). */
  const [cardEntryMode, setCardEntryMode] = useState<'saved' | 'new'>('new');
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  /** Janela de reembolso integral vinda de `platform_settings`; fallback 2h. */
  const [freeWindowHours, setFreeWindowHours] = useState<number>(2);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'booking_cancellation_free_window_hours')
          .maybeSingle();
        if (cancelled) return;
        const raw = (data as { value?: unknown } | null)?.value;
        const val =
          raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
            ? Number((raw as { value: unknown }).value)
            : Number(raw);
        if (Number.isFinite(val) && val >= 0) setFreeWindowHours(val);
      } catch {
        // fallback mantido
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCpfChange = useCallback((text: string) => setCpfCnpj(formatCpf(text)), []);

  useEffect(() => {
    if (selectedMethod !== 'credito' && selectedMethod !== 'debito') {
      setSavedCards([]);
      setSelectedSavedId(null);
      setCardEntryMode('new');
      return;
    }
    const dbType = selectedMethod === 'credito' ? 'credit' : 'debit';
    let cancelled = false;
    setSavedCardsLoading(true);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || cancelled) {
        if (!cancelled) setSavedCardsLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, type, last_four, holder_name, brand')
        .eq('user_id', user.id)
        .eq('type', dbType)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setSavedCardsLoading(false);
      if (error) {
        setSavedCards([]);
        setSelectedSavedId(null);
        setCardEntryMode('new');
        return;
      }
      const rows = (data ?? []) as SavedCardRow[];
      setSavedCards(rows);
      if (rows.length > 0) {
        setSelectedSavedId(rows[0].id);
        setCardEntryMode('saved');
      } else {
        setSelectedSavedId(null);
        setCardEntryMode('new');
      }
    })();
    return () => {
      cancelled = true;
    };
    // `loading` (ex.: fareLoading no checkout) e foco da tela: primeira rodada pode ocorrer antes da sessão/preço;
    // sem reexecutar, a lista de cartões salva ficava vazia para sempre.
  }, [selectedMethod, loading, isFocused]);

  const handleConfirmSavedCard = useCallback(async () => {
    if (selectedMethod !== 'credito' && selectedMethod !== 'debito') return;
    if (!selectedSavedId) {
      showAlert('Atenção', 'Selecione um cartão salvo.');
      return;
    }
    const cpfDigits = onlyDigits(cpfCnpj);
    if (!cpfDigits) {
      showAlert('Atenção', 'Preencha o CPF.');
      return;
    }
    if (!validateCpf(cpfDigits)) {
      showAlert('CPF inválido', 'O CPF informado não é válido. Verifique e tente novamente.');
      return;
    }
    setConfirming(true);
    try {
      await onConfirmPayment({
        method: selectedMethod,
        savedPaymentMethodId: selectedSavedId,
        holderCpfDigits: cpfDigits,
      });
    } finally {
      setConfirming(false);
    }
  }, [selectedMethod, selectedSavedId, cpfCnpj, onConfirmPayment, showAlert]);

  const handleConfirmCard = useCallback(async () => {
    if (selectedMethod !== 'credito' && selectedMethod !== 'debito') return;
    if (!cardName.trim()) {
      showAlert('Atenção', 'Preencha o nome do cartão.');
      return;
    }
    if (!cardComplete) {
      showAlert('Atenção', 'Preencha os dados do cartão (número, validade e CVV).');
      return;
    }
    const cpfDigits = onlyDigits(cpfCnpj);
    if (!cpfDigits) {
      showAlert('Atenção', 'Preencha o CPF.');
      return;
    }
    if (!validateCpf(cpfDigits)) {
      showAlert('CPF inválido', 'O CPF informado não é válido. Verifique e tente novamente.');
      return;
    }
    setConfirming(true);
    try {
      const { paymentMethod, error } = await createPaymentMethod({
        paymentMethodType: 'Card',
        paymentMethodData: {
          billingDetails: cardName.trim() ? { name: cardName.trim() } : undefined,
        },
      });
      if (error) {
        showAlert('Erro', getUserErrorMessage(error, 'Falha ao processar o cartão.'));
        return;
      }
      if (!paymentMethod?.id) {
        showAlert('Erro', 'Não foi possível obter o método de pagamento.');
        return;
      }
      await onConfirmPayment({
        method: selectedMethod,
        paymentMethodId: paymentMethod.id,
        holderCpfDigits: cpfDigits,
      });
    } finally {
      setConfirming(false);
    }
  }, [selectedMethod, cardName, cardComplete, cpfCnpj, createPaymentMethod, onConfirmPayment, showAlert]);

  const handleConfirmPix = useCallback(() => {
    onConfirmPayment({ method: 'pix' });
  }, [onConfirmPayment]);

  const handleConfirmDinheiro = useCallback(() => {
    onConfirmPayment({ method: 'dinheiro' });
  }, [onConfirmPayment]);

  const policyLines = getCancellationPolicyLines(
    selectedMethod === 'credito' ? 'shipment_credit' : selectedMethod === 'debito' ? 'shipment_debit' : cancellationPolicyVariant,
    freeWindowHours,
  );

  const visibleOptions =
    allowedMethods == null || allowedMethods.length === 0
      ? PAYMENT_OPTIONS
      : PAYMENT_OPTIONS.filter((o) => allowedMethods.includes(o.type));
  const cashOnlyConnect =
    allowedMethods != null &&
    allowedMethods.length === 1 &&
    allowedMethods[0] === 'dinheiro';

  const connectCashOnlyMessage =
    connectCashOnlyContext === 'dependent_shipment'
      ? 'Este motorista ainda não concluiu a configuração financeira (Stripe Connect). Apenas pagamento em dinheiro está disponível para este envio do dependente — o valor total (incluindo taxa da plataforma) será pago ao motorista ao final da viagem.'
      : 'Este motorista ainda não concluiu a configuração financeira (Stripe Connect). Apenas pagamento em dinheiro está disponível para esta viagem — o valor total (incluindo taxa da plataforma) será pago ao motorista ao final da viagem.';

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Método de pagamento</Text>
      {cashOnlyConnect ? (
        <Text style={styles.connectHint}>{connectCashOnlyMessage}</Text>
      ) : null}

      {visibleOptions.map((opt) => (
        <View key={opt.type} style={[styles.optionCard, selectedMethod === opt.type && styles.optionCardSelected]}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => onSelectMethod(opt.type)}
            activeOpacity={0.8}
          >
            <MaterialIcons name={opt.icon} size={24} color={COLORS.black} style={styles.optionIcon} />
            <Text style={styles.optionLabel}>{opt.label}</Text>
            <View style={[styles.radio, selectedMethod === opt.type && styles.radioSelected]}>
              {selectedMethod === opt.type && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          {selectedMethod === opt.type && (opt.type === 'credito' || opt.type === 'debito') && (
            <View style={styles.expanded}>
              <Text style={styles.formLabel}>Método de pagamento</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>
                  {opt.type === 'credito' ? 'Cartão de crédito' : 'Cartão de débito'}
                </Text>
              </View>

              {opt.type === 'credito' ? (
                <>
                  <Text style={styles.formLabel}>Número de parcelas</Text>
                  <View style={styles.readOnlyField}>
                    <Text style={styles.readOnlyText}>
                      1x de R$ {(amountCents / 100).toFixed(2).replace('.', ',')} (parcela única)
                    </Text>
                  </View>
                </>
              ) : null}

              {savedCardsLoading ? (
                <ActivityIndicator style={styles.savedCardsLoader} color={COLORS.black} />
              ) : null}

              {!savedCardsLoading && savedCards.length > 0 ? (
                <View style={styles.savedModeRow}>
                  <TouchableOpacity
                    style={[styles.savedModeChip, cardEntryMode === 'saved' && styles.savedModeChipActive]}
                    onPress={() => setCardEntryMode('saved')}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.savedModeChipText,
                        cardEntryMode === 'saved' && styles.savedModeChipTextActive,
                      ]}
                    >
                      Cartão salvo
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.savedModeChip, cardEntryMode === 'new' && styles.savedModeChipActive]}
                    onPress={() => setCardEntryMode('new')}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.savedModeChipText,
                        cardEntryMode === 'new' && styles.savedModeChipTextActive,
                      ]}
                    >
                      Outro cartão
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {!savedCardsLoading && cardEntryMode === 'saved' && savedCards.length > 0 ? (
                <>
                  <Text style={styles.formLabel}>Selecione o cartão</Text>
                  {savedCards.map((row) => (
                    <TouchableOpacity
                      key={row.id}
                      style={[styles.savedCardRow, selectedSavedId === row.id && styles.savedCardRowSelected]}
                      onPress={() => setSelectedSavedId(row.id)}
                      activeOpacity={0.75}
                    >
                      <MaterialIcons name="credit-card" size={22} color={COLORS.black} />
                      <View style={styles.savedCardTextCol}>
                        <Text style={styles.savedCardTitle}>
                          {(row.brand ?? 'cartão').replace(/\s/g, '')} {row.last_four ? `•••• ${row.last_four}` : ''}
                        </Text>
                        {row.holder_name ? (
                          <Text style={styles.savedCardMeta} numberOfLines={1}>
                            {row.holder_name}
                          </Text>
                        ) : null}
                      </View>
                      <View style={[styles.radio, selectedSavedId === row.id && styles.radioSelected]}>
                        {selectedSavedId === row.id ? <View style={styles.radioInner} /> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                  <Text style={styles.formLabelSmall}>CPF</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="000.000.000-00"
                    placeholderTextColor={COLORS.neutral700}
                    value={cpfCnpj}
                    onChangeText={handleCpfChange}
                    keyboardType="number-pad"
                    maxLength={14}
                  />
                  <TouchableOpacity
                    style={[
                      styles.confirmButton,
                      (!selectedSavedId || !validateCpf(onlyDigits(cpfCnpj)) || loading || confirming) &&
                        styles.confirmButtonDisabled,
                    ]}
                    onPress={handleConfirmSavedCard}
                    disabled={!selectedSavedId || !validateCpf(onlyDigits(cpfCnpj)) || loading || confirming}
                    activeOpacity={0.8}
                  >
                    {confirming ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : !savedCardsLoading ? (
                <>
                  <Text style={styles.formLabel}>Dados do cartão</Text>
                  <Text style={styles.formLabelSmall}>Nome do cartão</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Nome como está no cartão"
                    placeholderTextColor={COLORS.neutral700}
                    value={cardName}
                    onChangeText={setCardName}
                    autoCapitalize="words"
                  />
                  <CardField
                    postalCodeEnabled={false}
                    onCardChange={(d) => setCardComplete(d.complete)}
                    style={styles.cardField}
                    cardStyle={CARD_STYLE}
                  />
                  <Text style={styles.formLabelSmall}>CPF</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="000.000.000-00"
                    placeholderTextColor={COLORS.neutral700}
                    value={cpfCnpj}
                    onChangeText={handleCpfChange}
                    keyboardType="number-pad"
                    maxLength={14}
                  />
                  <TouchableOpacity
                    style={[
                      styles.confirmButton,
                      (!cardComplete || loading || confirming) && styles.confirmButtonDisabled,
                    ]}
                    onPress={handleConfirmCard}
                    disabled={!cardComplete || loading || confirming}
                    activeOpacity={0.8}
                  >
                    {confirming ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : null}

              <Text style={styles.policyTitle}>Política de Cancelamento</Text>
              {policyLines.map((line, i) => (
                <Text key={i} style={styles.policyItem}>• {line}</Text>
              ))}
            </View>
          )}

          {selectedMethod === opt.type && opt.type === 'pix' && (
            <View style={styles.expanded}>
              <Text style={styles.pixIntro}>
                Ao confirmar o envio, abriremos o Pix oficial (Stripe): você poderá copiar o código, abrir o
                comprovante no navegador e pagar no app do banco. Só depois disso o pedido segue para os motoristas.
              </Text>
              <TouchableOpacity
                style={[styles.confirmButton, loading && styles.confirmButtonDisabled]}
                onPress={handleConfirmPix}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedMethod === opt.type && opt.type === 'dinheiro' && (
            <View style={styles.expanded}>
              <Text style={styles.dinheiroText}>
                O pagamento em dinheiro deve ser feito ao motorista quando você chegar ao destino final — o valor
                total abaixo (incluindo taxa da plataforma) é o que você entrega em mãos.
              </Text>
              <Text style={styles.dinheiroText}>
                Você receberá o comprovante digital assim que o pagamento for registrado no sistema.
              </Text>
              <TouchableOpacity
                style={[styles.confirmButton, loading && styles.confirmButtonDisabled]}
                onPress={handleConfirmDinheiro}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const COLORS = {
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  /** Somente leitura (ex.: rótulo do método) — cinza mais fechado, não parece campo de digitação. */
  readOnlyBg: '#E8EAEF',
  /** Campos digitáveis — fundo bem claro. */
  editableBg: '#FFFFFF',
  editableBorder: '#D1D5DB',
};

const CARD_STYLE = {
  backgroundColor: COLORS.editableBg,
  textColor: COLORS.black,
  placeholderColor: COLORS.neutral700,
  borderColor: COLORS.editableBorder,
  borderWidth: 1,
  borderRadius: 12,
  fontSize: 16,
};

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  connectHint: {
    fontSize: 13,
    color: COLORS.neutral700,
    lineHeight: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.black,
    marginBottom: 12,
  },
  optionCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    padding: 16,
    marginBottom: 12,
  },
  optionCardSelected: {
    borderColor: COLORS.black,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionIcon: {
    marginRight: 12,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.black,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.neutral400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: COLORS.black,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.black,
  },
  expanded: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral400,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
    marginBottom: 8,
  },
  formLabelSmall: {
    fontSize: 14,
    color: COLORS.neutral700,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.editableBg,
    borderWidth: 1,
    borderColor: COLORS.editableBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.black,
  },
  cardField: {
    width: '100%',
    height: 56,
    marginVertical: 8,
  },
  readOnlyField: {
    backgroundColor: COLORS.readOnlyBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  readOnlyText: {
    fontSize: 16,
    color: COLORS.neutral700,
  },
  confirmButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  policyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.black,
    marginTop: 20,
    marginBottom: 8,
  },
  policyItem: {
    fontSize: 13,
    color: COLORS.neutral700,
    lineHeight: 20,
    marginBottom: 4,
  },
  pixIntro: {
    fontSize: 14,
    color: COLORS.neutral700,
    lineHeight: 22,
    marginBottom: 12,
  },
  dinheiroText: {
    fontSize: 14,
    color: COLORS.neutral700,
    lineHeight: 22,
    marginBottom: 12,
  },
  savedCardsLoader: {
    marginVertical: 16,
  },
  savedModeRow: {
    flexDirection: 'row',
    marginBottom: 16,
    marginTop: 4,
  },
  savedModeChip: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    alignItems: 'center',
  },
  savedModeChipActive: {
    borderColor: COLORS.black,
    backgroundColor: COLORS.neutral300,
  },
  savedModeChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.neutral700,
  },
  savedModeChipTextActive: {
    color: COLORS.black,
  },
  savedCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    marginBottom: 10,
  },
  savedCardRowSelected: {
    borderColor: COLORS.black,
    backgroundColor: COLORS.neutral300,
  },
  savedCardTextCol: {
    flex: 1,
    marginLeft: 12,
  },
  savedCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.black,
  },
  savedCardMeta: {
    fontSize: 13,
    color: COLORS.neutral700,
    marginTop: 2,
  },
});
