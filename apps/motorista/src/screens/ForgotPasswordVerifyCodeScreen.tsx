import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  Dimensions,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Text } from '../components/Text';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { getUserErrorMessage } from '../utils/errorMessage';
import { parseInvokeData, parseInvokeError } from '../utils/edgeFunctionResponse';
import { setLastRecoveryEmail } from '../lib/lastRecoveryEmail';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPasswordVerifyCode'>;

const CODE_LENGTH = 4;
const OTP_GAP = 10;
const CONTENT_PADDING = 48;
const RESEND_COOLDOWN_SEC = 60;

function getOtpBoxSize(): number {
  const { width } = Dimensions.get('window');
  const available = width - CONTENT_PADDING;
  const boxSize = (available - OTP_GAP * (CODE_LENGTH - 1)) / CODE_LENGTH;
  return Math.min(85, Math.max(34, Math.floor(boxSize)));
}

export function ForgotPasswordVerifyCodeScreen({ navigation, route }: Props) {
  const email = route.params.email?.trim() ?? '';
  const phone = route.params.phone?.replace(/\D/g, '') ?? '';
  const channel = phone ? 'phone' : 'email';
  const destination = channel === 'phone' ? phone : email;
  const { showAlert } = useAppAlert();
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: CODE_LENGTH }, () => ''));
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SEC);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const code = digits.join('');
  const isComplete = code.length === CODE_LENGTH;
  const otpBoxSize = getOtpBoxSize();
  const insets = useSafeAreaInsets();
  const canResend = countdown <= 0 && !resendLoading;

  useEffect(() => {
    if (email) {
      setLastRecoveryEmail(email);
    }
  }, [email]);

  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  const setDigit = (index: number, value: string) => {
    const onlyNums = value.replace(/\D/g, '');
    if (onlyNums.length > 1) {
      const arr = onlyNums.slice(0, CODE_LENGTH).split('');
      const next = [...digits];
      arr.forEach((c, i) => {
        next[i] = c;
      });
      setDigits(next);
      const lastIdx = Math.min(arr.length, CODE_LENGTH) - 1;
      setFocusedIndex(lastIdx);
      setTimeout(() => inputRefs.current[lastIdx]?.focus(), 50);
      return;
    }
    const num = onlyNums.slice(-1);
    const next = [...digits];
    next[index] = num;
    setDigits(next);
    if (num && index < CODE_LENGTH - 1) {
      setFocusedIndex(index + 1);
      setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
    }
  };

  const handleKeyPress = (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      setFocusedIndex(index - 1);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleConfirm = async () => {
    if (!isComplete) return;
    if (!destination) {
      showAlert('Erro', 'Não foi possível identificar o destino do código. Solicite um novo código.');
      return;
    }
    setLoading(true);
    try {
      const fnName = channel === 'phone' ? 'verify-phone-code' : 'verify-email-code';
      const body =
        channel === 'phone'
          ? { phone, code, password_reset: true }
          : { email, code, password_reset: true };
      const { data: fnData, error: fnError } = await supabase.functions.invoke(fnName, { body });

      const payload = parseInvokeData(fnData);

      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        showAlert('Código incorreto', bodyError ?? getUserErrorMessage(fnError, 'Código inválido ou expirado.'));
        return;
      }

      if (payload?.error != null) {
        showAlert('Código incorreto', String(payload.error));
        return;
      }

      const token = payload?.password_reset_token;
      if (typeof token !== 'string' || !token) {
        showAlert(
          'Erro',
          'Não foi possível continuar a redefinição. Atualize o app e confira o deploy das Edge Functions.',
        );
        return;
      }

      await supabase.auth.signOut();
      navigation.navigate('ResetPassword', { passwordResetToken: token });
    } catch (err: unknown) {
      showAlert('Erro', getUserErrorMessage(err, 'Código inválido ou expirado.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = useCallback(async () => {
    if (!canResend) return;
    if (!destination) {
      showAlert('Erro', 'Não foi possível identificar o destino do código. Solicite um novo código.');
      return;
    }
    setResendLoading(true);
    try {
      const fnName = channel === 'phone' ? 'send-phone-verification-code' : 'send-email-verification-code';
      const body =
        channel === 'phone'
          ? { phone, purpose: 'password_reset' as const }
          : { email, purpose: 'password_reset' as const };
      const { data: resendData, error: fnError } = await supabase.functions.invoke(fnName, { body });
      const resendPayload = parseInvokeData(resendData);
      if (resendPayload?.error != null) {
        showAlert('Erro', String(resendPayload.error));
        return;
      }
      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        showAlert('Erro', bodyError ?? getUserErrorMessage(fnError, 'Não foi possível reenviar o código.'));
        return;
      }
      setDigits(Array.from({ length: CODE_LENGTH }, () => ''));
      setFocusedIndex(0);
      setCountdown(RESEND_COOLDOWN_SEC);
      inputRefs.current[0]?.focus();
      showAlert(
        'Código enviado',
        channel === 'phone'
          ? 'Enviamos um novo código de 4 dígitos para seu WhatsApp.'
          : 'Enviamos um novo código de 4 dígitos para seu e-mail.'
      );
    } catch (err: unknown) {
      showAlert('Erro', getUserErrorMessage(err, 'Não foi possível reenviar o código.'));
    } finally {
      setResendLoading(false);
    }
  }, [canResend, channel, destination, email, phone, showAlert]);

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <StatusBar style="dark" />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.content, { paddingTop: insets.top + 96 }]}>
            <Text style={styles.title}>{channel === 'phone' ? 'Código no WhatsApp' : 'Código no e-mail'}</Text>
            <Text style={styles.subtitle}>
              Digite o código de 4 dígitos que enviamos para{'\n'}
              <Text style={styles.emailEmphasis}>{destination}</Text>
            </Text>

            <View style={styles.otpWrapper}>
              {Array.from({ length: CODE_LENGTH }, (_, index) => index).map((index) => {
                const isFocused = focusedIndex === index;
                return (
                  <TextInput
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    style={[
                      styles.otpInput,
                      {
                        width: otpBoxSize,
                        height: otpBoxSize,
                        borderRadius: otpBoxSize / 2,
                        marginHorizontal: OTP_GAP / 2,
                        fontSize: Math.round(otpBoxSize * 0.4),
                      },
                      isFocused ? styles.otpInputFocused : styles.otpInputDefault,
                    ]}
                    value={digits[index]}
                    onChangeText={(v) => setDigit(index, v)}
                    onKeyPress={(e) => handleKeyPress(index, e)}
                    onFocus={() => setFocusedIndex(index)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    autoFocus={index === 0}
                  />
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.resendLink, (!canResend || resendLoading) && styles.resendLinkDisabled]}
              onPress={handleResendCode}
              disabled={!canResend || resendLoading}
            >
              {resendLoading ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <Text style={styles.resendLinkText}>
                  {canResend ? 'Reenviar código' : `Reenviar código (${countdown}s)`}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
          <TouchableOpacity
            style={styles.footerBackButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.footerBack}>←</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              isComplete && styles.confirmButtonActive,
              loading && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirm}
            disabled={!isComplete || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={[styles.confirmButtonText, isComplete && styles.confirmButtonTextActive]}
              >
                Continuar
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  content: { paddingHorizontal: 24, alignItems: 'center' },
  title: { color: '#0D0D0D', textAlign: 'center', fontSize: 24, fontWeight: '600', marginBottom: 8 },
  subtitle: { color: '#767676', textAlign: 'center', fontSize: 14, lineHeight: 21, marginBottom: 32 },
  emailEmphasis: { color: '#0D0D0D', fontWeight: '600' },
  otpWrapper: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  otpInput: { fontWeight: '700', color: '#0D0D0D', textAlign: 'center', padding: 0 },
  otpInputDefault: { backgroundColor: '#F1F1F1', borderWidth: 0 },
  otpInputFocused: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#0D0D0D' },
  resendLink: { paddingVertical: 8, alignSelf: 'center' },
  resendLinkDisabled: { opacity: 0.6 },
  resendLinkText: { fontSize: 14, fontWeight: '500', color: '#2563EB' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 24 },
  footerBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBack: { fontSize: 22, color: '#000000', fontWeight: '600' },
  confirmButton: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    minWidth: 160,
  },
  confirmButtonActive: { backgroundColor: '#0D0D0D' },
  confirmButtonDisabled: { opacity: 1 },
  confirmButtonText: { fontSize: 16, fontWeight: '600', color: '#9CA3AF' },
  confirmButtonTextActive: { color: '#FFFFFF' },
});
