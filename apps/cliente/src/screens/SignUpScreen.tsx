import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import {
  parseInvokeData,
  describeInvokeFailure,
  parseInvokeError,
  isSupabaseFunctionNotFoundMessage,
  notFoundHintForPhoneEdgeFn,
} from '../utils/edgeFunctionResponse';
import { isValidEmailFormat } from '../utils/validateEmail';
import {
  checkEmailAvailability,
  type EmailAvailability,
} from '../lib/checkEmailAvailability';
import { detectPhoneOrEmailChannel, formatPhoneBRMask } from '../utils/phoneOrEmailInput';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

const EMAIL_AVAILABILITY_DEBOUNCE_MS = 500;
const PASSWORD_MIN_LEN = 8;

type EmailCheckStatus = 'idle' | 'checking' | EmailAvailability | 'format';

export function SignUpScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { showAlert } = useAppAlert();
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [hideConfirm, setHideConfirm] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeOffers, setAgreeOffers] = useState(false);
  const [loading, setLoading] = useState(false);

  const [emailStatus, setEmailStatus] = useState<EmailCheckStatus>('idle');
  const [emailStatusMsg, setEmailStatusMsg] = useState<string | null>(null);
  const [identifierTouched, setIdentifierTouched] = useState(false);

  const openTerms = () => navigation.navigate('TermsOfUse');
  const openPrivacy = () => navigation.navigate('PrivacyPolicy');

  const channel = useMemo(() => detectPhoneOrEmailChannel(identifier), [identifier]);

  const handleIdentifierChange = useCallback((text: string) => {
    if (detectPhoneOrEmailChannel(text) === 'phone') {
      setIdentifier(formatPhoneBRMask(text));
    } else {
      setIdentifier(text);
    }
  }, []);

  const emailNormalized = channel === 'email' ? identifier.trim() : '';
  const phoneDigits = channel === 'phone' ? identifier.replace(/\D/g, '') : '';
  const emailFormatValid = useMemo(
    () => (channel === 'email' ? isValidEmailFormat(emailNormalized) : false),
    [channel, emailNormalized]
  );
  const phoneValid = channel === 'phone' && phoneDigits.length >= 10 && phoneDigits.length <= 11;

  const lastQueryRef = useRef<string>('');
  useEffect(() => {
    if (channel !== 'email' || !emailNormalized) {
      setEmailStatus('idle');
      setEmailStatusMsg(null);
      return;
    }
    if (!emailFormatValid) {
      setEmailStatus('format');
      setEmailStatusMsg('E-mail em formato inválido.');
      return;
    }

    let cancelled = false;
    setEmailStatus('checking');
    setEmailStatusMsg(null);
    const query = emailNormalized.toLowerCase();
    lastQueryRef.current = query;
    const timer = setTimeout(async () => {
      const result = await checkEmailAvailability(query);
      if (cancelled || lastQueryRef.current !== query) return;
      setEmailStatus(result.status);
      setEmailStatusMsg(result.message ?? null);
    }, EMAIL_AVAILABILITY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [channel, emailNormalized, emailFormatValid]);

  const handleIdentifierBlur = useCallback(() => setIdentifierTouched(true), []);

  const passwordValid = password.length >= PASSWORD_MIN_LEN;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const formReadyToSubmit =
    fullName.trim().length > 0 &&
    (channel === 'email'
      ? emailFormatValid && (emailStatus === 'available' || emailStatus === 'error')
      : phoneValid) &&
    passwordValid &&
    passwordsMatch &&
    agreeTerms &&
    !loading;

  const handleContinue = async () => {
    setIdentifierTouched(true);
    if (!fullName.trim()) {
      showAlert('Atenção', 'Preencha seu nome.');
      return;
    }
    if (channel === 'email') {
      if (!emailFormatValid) {
        showAlert('Atenção', 'Informe um e-mail válido.');
        return;
      }
      if (emailStatus === 'taken') {
        showAlert('Atenção', emailStatusMsg ?? 'Este e-mail já está cadastrado.');
        return;
      }
      if (emailStatus === 'checking') {
        showAlert('Aguarde', 'Ainda estamos verificando o e-mail.');
        return;
      }
    } else {
      if (!phoneValid) {
        showAlert('Atenção', 'Informe um telefone válido com DDD (10 ou 11 dígitos).');
        return;
      }
    }
    if (!passwordValid) {
      showAlert('Atenção', `A senha deve ter no mínimo ${PASSWORD_MIN_LEN} caracteres.`);
      return;
    }
    if (!passwordsMatch) {
      showAlert('Atenção', 'As senhas não coincidem.');
      return;
    }
    if (!agreeTerms) {
      showAlert('Atenção', 'Aceite os Termos de Uso e a Política de Privacidade.');
      return;
    }
    if (!isSupabaseConfigured) {
      showAlert(
        'Erro',
        'Supabase não configurado. Adicione EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env do app e reinicie o Metro.'
      );
      return;
    }

    setLoading(true);
    try {
      const fnName = channel === 'email' ? 'send-email-verification-code' : 'send-phone-verification-code';
      const fnBody: Record<string, unknown> =
        channel === 'email'
          ? { email: emailNormalized, purpose: 'signup' }
          : { phone: phoneDigits, purpose: 'signup' };

      const { data: fnData, error: fnError } = await supabase.functions.invoke(fnName, { body: fnBody });
      const payload = parseInvokeData(fnData);
      if (payload?.error != null) {
        const raw = String(payload.error);
        const msg =
          channel === 'phone' && isSupabaseFunctionNotFoundMessage(raw)
            ? notFoundHintForPhoneEdgeFn(raw, 'send')
            : raw;
        showAlert('Atenção', msg);
        setLoading(false);
        return;
      }
      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        if (bodyError) {
          const msg =
            channel === 'phone' && isSupabaseFunctionNotFoundMessage(bodyError)
              ? notFoundHintForPhoneEdgeFn(bodyError, 'send')
              : bodyError;
          showAlert('Atenção', msg);
          setLoading(false);
          return;
        }
        const message = await describeInvokeFailure(fnData, fnError);
        const msg =
          channel === 'phone' && isSupabaseFunctionNotFoundMessage(message)
            ? notFoundHintForPhoneEdgeFn(message, 'send')
            : message;
        showAlert('Atenção', msg);
        setLoading(false);
        return;
      }

      navigation.navigate('VerifyEmail', {
        email: channel === 'email' ? emailNormalized : '',
        password,
        fullName: fullName.trim(),
        phone: channel === 'phone' ? phoneDigits : '',
        channel,
      });
    } catch (err: unknown) {
      showAlert('Atenção', getUserErrorMessage(err, 'Não foi possível enviar o código. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  const identifierHint = useMemo(() => {
    if (!identifierTouched && emailStatus !== 'checking') return null;
    if (!identifier.trim()) return null;
    if (channel === 'phone') {
      if (!phoneValid) {
        return { kind: 'error' as const, text: 'Informe DDD + número (10 ou 11 dígitos).' };
      }
      return null;
    }
    if (emailStatus === 'format') return { kind: 'error' as const, text: 'E-mail em formato inválido.' };
    if (emailStatus === 'checking') return { kind: 'muted' as const, text: 'Verificando e-mail…' };
    if (emailStatus === 'taken')
      return { kind: 'error' as const, text: emailStatusMsg ?? 'Este e-mail já está cadastrado.' };
    if (emailStatus === 'available') return { kind: 'ok' as const, text: 'E-mail disponível.' };
    if (emailStatus === 'error')
      return {
        kind: 'muted' as const,
        text: 'Não foi possível validar agora. Continuaremos ao clicar em Continuar.',
      };
    return null;
  }, [channel, emailStatus, emailStatusMsg, identifier, identifierTouched, phoneValid]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: Math.max(12, insets.top) }]}>
        <TouchableOpacity
          style={styles.backButtonCircle}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Preencha seus dados para{'\n'}começar</Text>

        <TextInput
          style={styles.input}
          placeholder="Nome e sobrenome"
          placeholderTextColor="#9CA3AF"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        <View style={styles.fieldGroup}>
          <TextInput
            style={[
              styles.input,
              styles.inputWithHint,
              identifierHint?.kind === 'error' ? styles.inputError : null,
              identifierHint?.kind === 'ok' ? styles.inputOk : null,
            ]}
            placeholder="Telefone ou email"
            placeholderTextColor="#9CA3AF"
            value={identifier}
            onChangeText={handleIdentifierChange}
            onBlur={handleIdentifierBlur}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType={channel === 'phone' ? 'telephoneNumber' : 'emailAddress'}
          />
          {identifierHint && (
            <View style={styles.hintRow}>
              {emailStatus === 'checking' ? (
                <ActivityIndicator size="small" color="#6B7280" style={styles.hintSpinner} />
              ) : null}
              <Text
                style={[
                  styles.hintText,
                  identifierHint.kind === 'error' && styles.hintError,
                  identifierHint.kind === 'ok' && styles.hintOk,
                ]}
              >
                {identifierHint.text}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.inputPassword]}
            placeholder="Insira sua senha"
            placeholderTextColor="#9CA3AF"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={hidePassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
          />
          <TouchableOpacity style={styles.eyeButton} onPress={() => setHidePassword((v) => !v)}>
            <View style={styles.eyeIconWrap}>
              <MaterialIcons
                name={hidePassword ? 'visibility' : 'visibility-off'}
                size={22}
                color="#6B7280"
                style={styles.eyeIconCenter}
              />
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.inputPassword]}
            placeholder="Confirme sua nova senha"
            placeholderTextColor="#9CA3AF"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={hideConfirm}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
          />
          <TouchableOpacity style={styles.eyeButton} onPress={() => setHideConfirm((v) => !v)}>
            <View style={styles.eyeIconWrap}>
              <MaterialIcons
                name={hideConfirm ? 'visibility' : 'visibility-off'}
                size={22}
                color="#6B7280"
                style={styles.eyeIconCenter}
              />
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.continueButton, !formReadyToSubmit && styles.continueButtonDisabled]}
          activeOpacity={0.8}
          onPress={handleContinue}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.continueButtonText}>Continuar</Text>
          )}
        </TouchableOpacity>

        <View style={styles.checkboxRow}>
          <TouchableOpacity
            onPress={() => setAgreeTerms((v) => !v)}
            activeOpacity={0.7}
            style={styles.checkboxTouch}
          >
            <View style={[styles.checkbox, agreeTerms && styles.checkboxChecked]}>
              {agreeTerms && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </TouchableOpacity>
          <View style={styles.checkboxLabelWrap}>
            <Text style={styles.checkboxLabelInline}>Concordo com os </Text>
            <TouchableOpacity onPress={openTerms} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <Text style={styles.link}>Termos de Uso</Text>
            </TouchableOpacity>
            <Text style={styles.checkboxLabelInline}> e a </Text>
            <TouchableOpacity onPress={openPrivacy} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <Text style={styles.link}>Política de Privacidade.</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.checkboxRow}>
          <TouchableOpacity
            onPress={() => setAgreeOffers((v) => !v)}
            activeOpacity={0.7}
            style={styles.checkboxTouch}
          >
            <View style={[styles.checkbox, agreeOffers && styles.checkboxChecked]}>
              {agreeOffers && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAgreeOffers((v) => !v)}
            style={styles.checkboxLabelTouch}
          >
            <Text style={styles.checkboxLabel}>
              Aceito receber ofertas e comunicações do Take Me.
            </Text>
          </TouchableOpacity>
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
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  backButtonCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    marginTop: 8,
    marginBottom: 32,
    lineHeight: 28,
    textAlign: 'center',
  },
  fieldGroup: {
    marginBottom: 0,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000000',
    marginBottom: 16,
  },
  inputWithHint: {
    marginBottom: 6,
  },
  inputError: {
    borderColor: '#DC2626',
  },
  inputOk: {
    borderColor: '#059669',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -10,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  hintSpinner: {
    marginRight: 6,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
  },
  hintError: {
    color: '#DC2626',
  },
  hintOk: {
    color: '#059669',
  },
  passwordRow: {
    position: 'relative',
    marginBottom: 0,
  },
  inputPassword: {
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIconWrap: {
    height: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeIconCenter: {
    marginTop: -3,
  },
  continueButton: {
    backgroundColor: '#000000',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  continueButtonDisabled: {
    opacity: 0.45,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  checkboxTouch: {
    marginRight: 12,
    marginTop: 2,
  },
  checkboxLabelTouch: {
    flex: 1,
  },
  checkboxLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  checkmark: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  checkboxLabelInline: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  link: {
    color: '#2563EB',
    fontWeight: '600',
  },
});
