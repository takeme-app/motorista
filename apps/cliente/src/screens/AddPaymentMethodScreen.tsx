import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../components/Text';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { CardField, useStripe } from '../lib/stripeNativeBridge';
import { supabase } from '../lib/supabase';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { parseEdgeFunctionResponse } from '../utils/parseEdgeFunctionResponse';
import { formatCpf, onlyDigits, validateCpf } from '../utils/formatCpf';

type Props = NativeStackScreenProps<RootStackParamList, 'AddPaymentMethod'>;

type PaymentType = 'credit' | 'debit' | null;

const CARD_STYLE = {
  backgroundColor: '#F9FAFB',
  textColor: '#111827',
  placeholderColor: '#9CA3AF',
  borderColor: '#E5E7EB',
  borderWidth: 1,
  borderRadius: 12,
  fontSize: 16,
};

export function AddPaymentMethodScreen({ navigation }: Props) {
  const { createPaymentMethod } = useStripe();
  const { showAlert } = useAppAlert();
  const [selected, setSelected] = useState<PaymentType>(null);
  const [cardName, setCardName] = useState('');
  const [cardComplete, setCardComplete] = useState(false);
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCpfChange = (text: string) => setCpfCnpj(formatCpf(text));

  const handleRegister = async () => {
    const type = selected ?? 'credit';
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
    setSaving(true);
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
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        showAlert('Erro', getUserErrorMessage(sessionError, 'Sessão expirada. Faça login novamente.'));
        return;
      }
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/save-payment-method`;
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
            payment_method_id: paymentMethod.id,
            type,
          }),
        });
      } catch (e) {
        showAlert('Erro', getUserErrorMessage(e, 'Falha ao enviar. Tente de novo.'));
        return;
      }
      const parsed = await parseEdgeFunctionResponse(res);
      if (!parsed.success) {
        const fallback = parsed.errorMessage || `Erro do servidor (${res.status}). Tente novamente.`;
        showAlert('Erro', getUserErrorMessage({ message: parsed.errorMessage }, fallback));
        return;
      }
      navigation.navigate('CardRegisteredSuccess');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Adicione um cartão</Text>
        <Text style={styles.subtitle}>
          Cadastre agora e facilite suas próximas viagens.
        </Text>

        <Text style={styles.sectionTitle}>Método de pagamento</Text>

        {/* Card: Cartão de crédito */}
        <View style={styles.methodCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => setSelected('credit')}
            activeOpacity={0.7}
          >
            <View style={styles.optionIcon}>
              <View style={styles.cardIcon} />
            </View>
            <Text style={styles.optionLabel}>Cartão de crédito</Text>
            <View style={[styles.radio, selected === 'credit' && styles.radioSelected]}>
              {selected === 'credit' && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          {selected === 'credit' && (
            <View style={styles.formBlock}>
              <Text style={styles.sectionLabel}>
                Informações do cartão de crédito
              </Text>
              <Text style={styles.inputLabel}>Método de pagamento</Text>
              <View style={styles.inputReadOnly}>
                <Text style={styles.inputReadOnlyText}>Cartão de crédito</Text>
                <Text style={styles.chevron}>⌄</Text>
              </View>
              <Text style={styles.inputLabel}>Dados do cartão</Text>
              <Text style={styles.inputLabelSmall}>Nome do cartão</Text>
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
              <Text style={styles.inputLabelSmall}>CPF</Text>
              <TextInput
                style={styles.input}
                placeholder="000.000.000-00"
                placeholderTextColor="#9CA3AF"
                value={cpfCnpj}
                onChangeText={handleCpfChange}
                keyboardType="number-pad"
                maxLength={14}
              />

              <TouchableOpacity
                style={[styles.registerButton, saving && { opacity: 0.7 }]}
                activeOpacity={0.8}
                onPress={handleRegister}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.registerButtonText}>Cadastrar cartão</Text>}
              </TouchableOpacity>

              <Text style={styles.policyTitle}>Política de Cancelamento</Text>
              <Text style={styles.policyItem}>
                • Cancelamento até 12h antes: reembolso integral
              </Text>
              <Text style={styles.policyItem}>
                • Cancelamento após 12h antes: sem reembolso
              </Text>
              <Text style={styles.policyItem}>
                • Reagendamento permitido até 2h antes
              </Text>
            </View>
          )}
        </View>

        {/* Card: Cartão de débito */}
        <View style={styles.methodCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => setSelected('debit')}
            activeOpacity={0.7}
          >
            <View style={styles.optionIcon}>
              <View style={styles.cardIcon} />
            </View>
            <Text style={styles.optionLabel}>Cartão de débito</Text>
            <View style={[styles.radio, selected === 'debit' && styles.radioSelected]}>
              {selected === 'debit' && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          {selected === 'debit' && (
            <View style={styles.formBlock}>
              <Text style={styles.sectionLabel}>
                Informações do cartão de débito
              </Text>
              <Text style={styles.inputLabel}>Método de pagamento</Text>
              <View style={styles.inputReadOnly}>
                <Text style={styles.inputReadOnlyText}>Cartão de débito</Text>
                <Text style={styles.chevron}>⌄</Text>
              </View>
              <Text style={styles.inputLabel}>Dados do cartão</Text>
              <Text style={styles.inputLabelSmall}>Nome do cartão</Text>
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
              <Text style={styles.inputLabelSmall}>CPF</Text>
              <TextInput
                style={styles.input}
                placeholder="000.000.000-00"
                placeholderTextColor="#9CA3AF"
                value={cpfCnpj}
                onChangeText={handleCpfChange}
                keyboardType="number-pad"
                maxLength={14}
              />

              <TouchableOpacity
                style={[styles.registerButton, saving && { opacity: 0.7 }]}
                activeOpacity={0.8}
                onPress={handleRegister}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.registerButtonText}>Cadastrar cartão</Text>}
              </TouchableOpacity>

              <Text style={styles.policyTitle}>Política de Cancelamento</Text>
              <Text style={styles.policyItem}>
                • Cancelamento até 12h antes: reembolso integral
              </Text>
              <Text style={styles.policyItem}>
                • Cancelamento após 12h antes: sem reembolso
              </Text>
              <Text style={styles.policyItem}>
                • Reagendamento permitido até 2h antes
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginTop: 60,
    marginBottom: 8,
  },
  backArrow: {
    fontSize: 22,
    color: '#000000',
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  methodCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  formBlock: {
    marginTop: 8,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  optionIcon: {
    width: 40,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  cardIcon: {
    width: 24,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#D4A84B',
    opacity: 0.8,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#000000',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000000',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  inputLabelSmall: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  cardField: {
    width: '100%',
    height: 56,
    marginVertical: 8,
  },
  inputReadOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  inputReadOnlyText: {
    fontSize: 16,
    color: '#6B7280',
  },
  chevron: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  half: {
    flex: 1,
  },
  registerButton: {
    backgroundColor: '#000000',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  registerButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  policyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  policyItem: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 4,
  },
});
