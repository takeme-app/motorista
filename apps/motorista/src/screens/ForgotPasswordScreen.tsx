import { useCallback, useMemo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { Text } from '../components/Text';
import { StatusBar } from 'expo-status-bar';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { setLastRecoveryEmail } from '../lib/lastRecoveryEmail';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { parseInvokeData, parseInvokeError } from '../utils/edgeFunctionResponse';
import { detectPhoneOrEmailChannel, formatPhoneBRMask } from '../utils/phoneOrEmailInput';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);

  const channel = useMemo(() => detectPhoneOrEmailChannel(identifier), [identifier]);

  const handleIdentifierChange = useCallback((text: string) => {
    if (detectPhoneOrEmailChannel(text) === 'phone') {
      setIdentifier(formatPhoneBRMask(text));
    } else {
      setIdentifier(text);
    }
  }, []);

  const handleSubmit = async () => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      showAlert('Atenção', 'Digite seu e-mail ou telefone.');
      return;
    }
    if (!isSupabaseConfigured) {
      showAlert('Configuração', 'Serviço de recuperação não configurado.');
      return;
    }
    const kind = channel;
    const value = kind === 'phone' ? trimmed.replace(/\D/g, '') : trimmed;
    if (kind === 'phone' && (value.length < 10 || value.length > 11)) {
      showAlert('Atenção', 'Informe DDD + número (10 ou 11 dígitos).');
      return;
    }
    setLoading(true);
    try {
      const fnName = kind === 'email' ? 'send-email-verification-code' : 'send-phone-verification-code';
      const body =
        kind === 'email'
          ? { email: value, purpose: 'password_reset' as const }
          : { phone: value, purpose: 'password_reset' as const };
      const { data: sendData, error: fnError } = await supabase.functions.invoke(fnName, { body });
      const payload = parseInvokeData(sendData);
      if (payload?.error != null) {
        showAlert('Erro', String(payload.error));
        return;
      }
      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        showAlert('Erro', bodyError ?? getUserErrorMessage(fnError, 'Não foi possível enviar o código.'));
        return;
      }
      await supabase.auth.signOut();
      if (kind === 'email') {
        setLastRecoveryEmail(value);
      }
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            { name: 'Welcome' },
            {
              name: 'ForgotPasswordVerifyCode',
              params: kind === 'email' ? { email: value } : { phone: value },
            },
          ],
        })
      );
    } catch (e: unknown) {
      showAlert('Erro ao enviar código', getUserErrorMessage(e, 'Não foi possível enviar o código. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <StatusBar style="dark" />
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Recuperação de senha</Text>
        <Text style={styles.subtitle}>
          Digite seu e-mail ou telefone. Enviaremos um código de 4 dígitos para você redefinir a senha.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="E-mail ou telefone"
          placeholderTextColor="#9CA3AF"
          value={identifier}
          onChangeText={handleIdentifierChange}
          autoCapitalize="none"
          keyboardType={channel === 'phone' ? 'phone-pad' : 'email-address'}
          textContentType={channel === 'phone' ? 'telephoneNumber' : 'emailAddress'}
          editable={!loading}
        />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.submitButton, loading && styles.submitButtonDisabled]} activeOpacity={0.8} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Enviar código</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24, paddingTop: 60 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  backArrow: { fontSize: 22, color: '#000000', fontWeight: '600' },
  content: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', color: '#000000', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 24 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#000000' },
  footer: { paddingBottom: 48 },
  submitButton: { backgroundColor: '#000000', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
