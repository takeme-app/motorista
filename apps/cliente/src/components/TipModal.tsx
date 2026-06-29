import { useMemo, useState } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useBottomSafeInset } from '@take-me/shared';
import { CardField, useStripe } from '../lib/stripeNativeBridge';
import { supabase } from '../lib/supabase';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { parseEdgeFunctionResponse } from '../utils/parseEdgeFunctionResponse';
import { formatCpf, onlyDigits, validateCpf } from '../utils/formatCpf';

export type TipEntityType = 'booking' | 'shipment' | 'dependent_shipment';

export type TipModalProps = {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: { tipCents: number }) => void;
  entityType: TipEntityType;
  entityId: string;
  driverName?: string | null;
};

const PRESET_VALUES_CENTS = [500, 1000, 1500, 2000];

const CARD_STYLE = {
  backgroundColor: '#F9FAFB',
  textColor: '#111827',
  placeholderColor: '#9CA3AF',
  borderColor: '#E5E7EB',
  borderWidth: 1,
  borderRadius: 12,
  fontSize: 16,
};

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function centsFromInput(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Math.min(100_000, parseInt(digits, 10));
}

export function TipModal({
  visible,
  onClose,
  onSuccess,
  entityType,
  entityId,
  driverName,
}: TipModalProps) {
  const bottomInset = useBottomSafeInset({ extra: 16 });
  const { createPaymentMethod } = useStripe();
  const { showAlert } = useAppAlert();

  const [selectedPreset, setSelectedPreset] = useState<number | null>(1000);
  const [customInput, setCustomInput] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardComplete, setCardComplete] = useState(false);
  const [cpf, setCpf] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const amountCents = useMemo(() => {
    if (selectedPreset != null) return selectedPreset;
    return centsFromInput(customInput);
  }, [selectedPreset, customInput]);

  const canSubmit =
    amountCents >= 100 && cardComplete && cardName.trim().length > 0 && !submitting;

  const resetState = () => {
    setSelectedPreset(1000);
    setCustomInput('');
    setCardName('');
    setCardComplete(false);
    setCpf('');
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    resetState();
    onClose();
  };

  const handleCustomChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setCustomInput(digits);
    setSelectedPreset(null);
  };

  const handlePickPreset = (cents: number) => {
    setSelectedPreset(cents);
    setCustomInput('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const cpfDigits = onlyDigits(cpf);
    if (!cpfDigits) {
      showAlert('Atenção', 'Preencha o CPF do titular do cartão.');
      return;
    }
    if (!validateCpf(cpfDigits)) {
      showAlert('CPF inválido', 'O CPF informado não é válido.');
      return;
    }

    setSubmitting(true);
    try {
      const { paymentMethod, error: pmError } = await createPaymentMethod({
        paymentMethodType: 'Card',
        paymentMethodData: {
          billingDetails: cardName.trim() ? { name: cardName.trim() } : undefined,
        },
      });
      if (pmError) {
        showAlert('Erro', getUserErrorMessage(pmError, 'Falha ao processar o cartão.'));
        return;
      }
      if (!paymentMethod?.id) {
        showAlert('Erro', 'Não foi possível obter o método de pagamento.');
        return;
      }

      await supabase.auth.refreshSession();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        showAlert('Erro', 'Sessão expirada. Faça login novamente.');
        return;
      }

      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/charge-tip`;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Auth-Token': token,
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            amount_cents: amountCents,
            stripe_payment_method_id: paymentMethod.id,
          }),
        });
      } catch (e) {
        showAlert('Erro', getUserErrorMessage(e, 'Falha ao enviar. Tente novamente.'));
        return;
      }

      const parsed = await parseEdgeFunctionResponse(res);
      if (!parsed.success) {
        const fallback = parsed.errorMessage || `Erro do servidor (${res.status}).`;
        showAlert('Gorjeta não enviada', fallback);
        return;
      }

      const paidCents = Number(
        (parsed.data as { tip_cents?: number } | undefined)?.tip_cents ?? amountCents,
      );
      onSuccess({ tipCents: paidCents });
      resetState();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoid}
        >
          <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>Enviar gorjeta</Text>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                disabled={submitting}
              >
                <MaterialIcons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>
            {driverName ? (
              <Text style={styles.subtitle}>
                Para {driverName}. 100% do valor vai direto para o motorista.
              </Text>
            ) : (
              <Text style={styles.subtitle}>
                100% do valor vai direto para o motorista.
              </Text>
            )}

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <Text style={styles.sectionLabel}>Valor</Text>
              <View style={styles.presetRow}>
                {PRESET_VALUES_CENTS.map((cents) => {
                  const active = selectedPreset === cents;
                  return (
                    <TouchableOpacity
                      key={cents}
                      style={[styles.presetChip, active && styles.presetChipActive]}
                      onPress={() => handlePickPreset(cents)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                        R$ {formatBrl(cents)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.inputLabelSmall}>Outro valor</Text>
              <View style={styles.customRow}>
                <Text style={styles.currencyPrefix}>R$</Text>
                <TextInput
                  style={styles.customInput}
                  placeholder="0,00"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  value={customInput ? formatBrl(centsFromInput(customInput)) : ''}
                  onChangeText={handleCustomChange}
                />
              </View>

              <Text style={styles.sectionLabel}>Cartão</Text>
              <Text style={styles.inputLabelSmall}>Nome no cartão</Text>
              <TextInput
                style={styles.input}
                placeholder="Nome como está no cartão"
                placeholderTextColor="#9CA3AF"
                value={cardName}
                onChangeText={setCardName}
                autoCapitalize="words"
              />
              <Text style={styles.inputLabelSmall}>Número, validade e CVV</Text>
              <CardField
                postalCodeEnabled={false}
                onCardChange={(details) => setCardComplete(details.complete)}
                style={styles.cardField}
                cardStyle={CARD_STYLE}
              />
              <Text style={styles.inputLabelSmall}>CPF do titular</Text>
              <TextInput
                style={styles.input}
                placeholder="000.000.000-00"
                placeholderTextColor="#9CA3AF"
                value={cpf}
                onChangeText={(t) => setCpf(formatCpf(t))}
                keyboardType="number-pad"
                maxLength={14}
              />
            </ScrollView>

            <TouchableOpacity
              style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.submitText}>
                  Enviar R$ {formatBrl(amountCents)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  avoid: { width: '100%' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginTop: 10,
    marginBottom: 10,
  },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  presetChipActive: { backgroundColor: '#111827', borderColor: '#111827' },
  presetChipText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  presetChipTextActive: { color: '#FFFFFF' },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  currencyPrefix: { fontSize: 16, color: '#6B7280', fontWeight: '600' },
  customInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  inputLabelSmall: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  cardField: { width: '100%', height: 52, marginVertical: 6 },
  submitButton: {
    marginTop: 14,
    backgroundColor: '#111827',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
