import { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, RegistrationType } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { getUserErrorMessage } from '../utils/errorMessage';
import { parseInvokeData, parseInvokeError } from '../utils/edgeFunctionResponse';
import { useDeferredDriverSignup } from '../contexts/DeferredDriverSignupContext';

function isDriverRegistration(t: string | undefined): t is RegistrationType {
  return t === 'take_me' || t === 'parceiro' || t === 'preparador_excursões' || t === 'preparador_encomendas';
}

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyEmail'>;

const CODE_LENGTH = 4;

export function VerifyEmailScreen({ navigation, route }: Props) {
  const { email, password, fullName: fullNameParam, phone: phoneParam, registrationType, channel: channelParam } = route.params;
  const fullName = fullNameParam ?? '';
  const phone = phoneParam ?? '';
  const channel: 'email' | 'phone' = channelParam === 'phone' ? 'phone' : 'email';
  const driverRegistration: RegistrationType | null = isDriverRegistration(registrationType)
    ? registrationType
    : null;
  const { showAlert } = useAppAlert();
  const { setDriverType } = useDeferredDriverSignup();
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: CODE_LENGTH }, () => ''));
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  /**
   * Guarda síncrona contra duplo-toque em "Reenviar código" — evita dois disparos
   * paralelos para a edge function `send-email-verification-code`.
   */
  const resendingRef = useRef(false);

  const code = digits.join('');
  const isComplete = code.length === CODE_LENGTH;
  const insets = useSafeAreaInsets();

  const bottomInset = useBottomSafeInset();
  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  const setDigit = (index: number, value: string) => {
    const onlyNums = value.replace(/\D/g, '');
    if (onlyNums.length > 1) {
      const arr = onlyNums.slice(0, CODE_LENGTH).split('');
      const next = [...digits];
      arr.forEach((c, i) => { next[i] = c; });
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
    setLoading(true);
    try {
      const fnName = channel === 'phone' ? 'verify-phone-code' : 'verify-email-code';
      const fnBody: Record<string, unknown> =
        channel === 'phone'
          ? {
              phone,
              code,
              password,
              fullName,
              ...(driverRegistration ? { driver_type: driverRegistration } : {}),
            }
          : {
              email: email.trim(),
              code,
              password,
              fullName,
              phone,
              ...(driverRegistration ? { driver_type: driverRegistration } : {}),
            };

      const { data: fnData, error: fnError } = await supabase.functions.invoke(fnName, { body: fnBody });

      const payload = parseInvokeData(fnData);

      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        const message = bodyError ?? getUserErrorMessage(fnError, 'Código inválido ou expirado. Tente novamente.');
        showAlert('Código incorreto', message);
        setLoading(false);
        return;
      }

      if (payload?.error != null) {
        showAlert('Código incorreto', String(payload.error));
        setLoading(false);
        return;
      }

      // Quando o cadastro é por telefone, a conta é criada com e-mail fake
      // no formato `{phoneDigits}@takeme.com` (ver verify-phone-code). Logamos
      // com esse e-mail + senha — o `login-with-phone` dispensa esse passo em
      // fluxos de login futuro (ele encontra o e-mail via profiles.phone).
      const phoneDigits = phone.replace(/\D/g, '');
      const { error: signInError } =
        channel === 'phone'
          ? await supabase.auth.signInWithPassword({
              email: `${phoneDigits}@takeme.com`,
              password,
            })
          : await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        showAlert(
          'Login',
          getUserErrorMessage(
            signInError,
            'Conta criada, mas não foi possível entrar automaticamente. Use suas credenciais na tela de login.'
          )
        );
        setLoading(false);
        return;
      }

      if (driverRegistration) {
        setDriverType(driverRegistration);
        if (driverRegistration === 'preparador_excursões') {
          navigation.reset({ index: 0, routes: [{ name: 'CompletePreparadorExcursoes' }] });
        } else if (driverRegistration === 'preparador_encomendas') {
          navigation.reset({ index: 0, routes: [{ name: 'CompletePreparadorEncomendas' }] });
        } else {
          navigation.reset({
            index: 0,
            routes: [{ name: 'CompleteDriverRegistration', params: { driverType: driverRegistration } }],
          });
        }
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      }
    } catch (err: unknown) {
      showAlert('Código incorreto', getUserErrorMessage(err, 'Código inválido ou expirado. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendingRef.current) return;
    resendingRef.current = true;
    setResendLoading(true);
    try {
      const fnName = channel === 'phone' ? 'send-phone-verification-code' : 'send-email-verification-code';
      const fnBody = channel === 'phone' ? { phone, purpose: 'signup' } : { email: email.trim(), purpose: 'signup' };
      const { data: resendData, error: fnError } = await supabase.functions.invoke(fnName, { body: fnBody });
      const resendPayload = parseInvokeData(resendData);
      if (resendPayload?.error != null) {
        showAlert('Erro', String(resendPayload.error));
        return;
      }
      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        showAlert(
          'Erro',
          bodyError ?? getUserErrorMessage(fnError, 'Não foi possível reenviar o código.')
        );
        return;
      }
      setDigits(Array.from({ length: CODE_LENGTH }, () => ''));
      setFocusedIndex(0);
      inputRefs.current[0]?.focus();
    } catch (err: unknown) {
      showAlert('Erro', getUserErrorMessage(err, 'Não foi possível reenviar o código.'));
    } finally {
      resendingRef.current = false;
      setResendLoading(false);
    }
  };

  const title = channel === 'phone' ? 'Vamos confirmar seu telefone' : 'Vamos confirmar seu e-mail';
  const subtitleLine1 =
    channel === 'phone' ? 'Enviamos um código para seu WhatsApp.' : 'Enviamos um código para seu e-mail.';
  const subtitleLine2 = 'Digite abaixo para confirmar.';

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior="height"
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
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>
                {subtitleLine1}
                {'\n'}
                {subtitleLine2}
              </Text>
            </View>

            <View style={styles.otpWrapper}>
              {Array.from({ length: CODE_LENGTH }, (_, index) => index).map((index) => {
                const isFocused = focusedIndex === index;
                const hasValue = digits[index]?.length > 0;
                return (
                  <TextInput
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el; }}
                    style={[
                      styles.otpInput,
                      isFocused
                        ? styles.otpInputFocused
                        : hasValue
                          ? styles.otpInputFilled
                          : styles.otpInputDefault,
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
              style={styles.resendLink}
              onPress={handleResendCode}
              disabled={resendLoading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {resendLoading ? (
                <ActivityIndicator size="small" color="#767676" />
              ) : (
                <Text style={styles.resendLinkText}>Reenviar código</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: bottomInset + 8 }]}>
          <TouchableOpacity
            style={styles.footerBackButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <MaterialIcons name="arrow-back" size={22} color="#0D0D0D" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmButton, isComplete ? styles.confirmButtonActive : styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={!isComplete || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={isComplete ? '#FFFFFF' : '#767676'} />
            ) : (
              <Text style={[styles.confirmButtonText, isComplete ? styles.confirmButtonTextActive : styles.confirmButtonTextDisabled]}>
                Confirmar código
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
  content: { paddingHorizontal: 16, alignItems: 'stretch' },
  header: { alignItems: 'center', marginBottom: 48 },
  title: {
    color: '#0D0D0D',
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 30,
    marginBottom: 4,
  },
  subtitle: {
    color: '#767676',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 21,
  },
  otpWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 24,
  },
  otpInput: {
    flex: 1,
    height: 85,
    borderRadius: 999,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '600',
    color: '#0D0D0D',
    padding: 0,
  },
  otpInputDefault: { backgroundColor: '#F1F1F1', borderWidth: 0 },
  otpInputFilled: { backgroundColor: '#F1F1F1', borderWidth: 0 },
  otpInputFocused: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#0D0D0D' },
  resendLink: { paddingVertical: 8, alignSelf: 'center' },
  resendLinkText: { fontSize: 14, fontWeight: '600', color: '#0D0D0D' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  footerBackButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F1F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButton: {
    height: 48,
    minWidth: 104,
    paddingHorizontal: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: { backgroundColor: '#F1F1F1' },
  confirmButtonActive: { backgroundColor: '#0D0D0D' },
  confirmButtonText: { fontSize: 16, fontWeight: '500' },
  confirmButtonTextDisabled: { color: '#767676' },
  confirmButtonTextActive: { color: '#FFFFFF' },
});
