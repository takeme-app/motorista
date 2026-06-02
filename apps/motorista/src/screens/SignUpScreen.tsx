import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
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
import { parseInvokeError } from '../utils/edgeFunctionResponse';
import { useDeferredDriverSignup } from '../contexts/DeferredDriverSignupContext';
import { isValidEmailFormat } from '../utils/validateEmail';
import {
  checkEmailAvailability,
  type EmailAvailability,
} from '../lib/checkEmailAvailability';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

/** Debounce da checagem de e-mail após `onBlur`/digitação: evita rajadas de `functions.invoke`. */
const EMAIL_AVAILABILITY_DEBOUNCE_MS = 500;
const PASSWORD_MIN_LEN = 8;

type EmailCheckStatus = 'idle' | 'checking' | EmailAvailability | 'format';

/** Máscara progressiva de telefone BR: `(xx) xxxxx-xxxx` / `(xx) xxxx-xxxx`. */
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Decide se o conteúdo do campo unificado é tratado como telefone ou e-mail.
 * Regra: começa com dígito/+/(/espaço → telefone. Qualquer outra coisa → e-mail.
 */
function detectChannel(raw: string): 'email' | 'phone' {
  const trimmed = raw.trim();
  if (!trimmed) return 'email';
  return /^[+(\s\d]/.test(trimmed) ? 'phone' : 'email';
}

export function SignUpScreen({ navigation, route }: Props) {
  const registrationType = route.params?.registrationType;
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { showAlert } = useAppAlert();
  const { setDriverType } = useDeferredDriverSignup();

  // Campo único: pode conter telefone formatado ou e-mail.
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
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  /**
   * Guarda síncrona contra duplo-toque no botão "Continuar". `setLoading(true)` só surte
   * efeito após o próximo render, então um toque muito rápido pode reentrar em
   * `handleContinue` e disparar dois `send-email-verification-code` em paralelo
   * (resultando em dois e-mails com códigos diferentes).
   */
  const submittingRef = useRef(false);

  const openTerms = () => navigation.navigate('TermsOfUse');
  const openPrivacy = () => navigation.navigate('PrivacyPolicy');

  const channel = useMemo(() => detectChannel(identifier), [identifier]);

  // Aplica máscara de telefone quando o conteúdo parece telefone; senão mantém literal.
  const handleIdentifierChange = useCallback((text: string) => {
    if (detectChannel(text) === 'phone') {
      setIdentifier(formatPhone(text));
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

  // Checagem de existência do e-mail no servidor, com debounce + race guard.
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
  const handlePasswordBlur = useCallback(() => setPasswordTouched(true), []);
  const handleConfirmBlur = useCallback(() => setConfirmTouched(true), []);

  const passwordValid = password.length >= PASSWORD_MIN_LEN;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const formReadyToSubmit =
    (channel === 'email'
      ? emailFormatValid && (emailStatus === 'available' || emailStatus === 'error')
      : phoneValid) &&
    passwordValid &&
    passwordsMatch &&
    agreeTerms &&
    !loading;

  const handleContinue = async () => {
    if (submittingRef.current) return;
    setIdentifierTouched(true);
    setPasswordTouched(true);
    setConfirmTouched(true);

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
      showAlert('Erro', 'Supabase não configurado. Verifique o .env.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const fnName = channel === 'email' ? 'send-email-verification-code' : 'send-phone-verification-code';
      const fnBody: Record<string, unknown> =
        channel === 'email'
          ? { email: emailNormalized, purpose: 'signup' }
          : { phone: phoneDigits, purpose: 'signup' };

      const { data: fnData, error: fnError } = await supabase.functions.invoke(fnName, { body: fnBody });
      const apiErrorMsg =
        fnData && typeof fnData === 'object' && fnData !== null && 'error' in fnData
          ? String((fnData as { error: unknown }).error)
          : null;
      if (apiErrorMsg) {
        showAlert('Atenção', apiErrorMsg);
        setLoading(false);
        return;
      }
      if (fnError) {
        const bodyError = await parseInvokeError(fnError);
        if (bodyError) {
          showAlert('Atenção', bodyError);
          setLoading(false);
          return;
        }
        throw fnError;
      }

      if (registrationType) {
        setDriverType(registrationType);
      }

      navigation.navigate('VerifyEmail', {
        email: channel === 'email' ? emailNormalized : '',
        password,
        fullName: '',
        phone: channel === 'phone' ? phoneDigits : '',
        channel,
        ...(registrationType && { registrationType }),
      });
    } catch (err: unknown) {
      showAlert('Atenção', getUserErrorMessage(err, 'Não foi possível enviar o código. Tente novamente.'));
    } finally {
      submittingRef.current = false;
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

  const passwordHint = useMemo(() => {
    if (!passwordTouched || password.length === 0) return null;
    if (!passwordValid) {
      return { kind: 'error' as const, text: `Use no mínimo ${PASSWORD_MIN_LEN} caracteres.` };
    }
    return { kind: 'ok' as const, text: 'Senha ok.' };
  }, [password, passwordTouched, passwordValid]);

  const confirmHint = useMemo(() => {
    if (!confirmTouched || confirmPassword.length === 0) return null;
    if (!passwordsMatch) return { kind: 'error' as const, text: 'As senhas não coincidem.' };
    return { kind: 'ok' as const, text: 'Senhas coincidem.' };
  }, [confirmPassword, confirmTouched, passwordsMatch]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior="height">
      <StatusBar style="dark" />
      <View style={[styles.navbar, { paddingTop: Math.max(12, insets.top + 8) }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <MaterialIcons name="arrow-back" size={22} color="#0D0D0D" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Preencha seus dados para começar</Text>
        </View>

        <View style={styles.fieldGroup}>
          <TextInput
            style={[
              styles.input,
              styles.inputWithHint,
              identifierHint?.kind === 'error' ? styles.inputError : null,
              identifierHint?.kind === 'ok' ? styles.inputOk : null,
            ]}
            placeholder="Telefone ou email"
            placeholderTextColor="#767676"
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
                <ActivityIndicator size="small" color="#767676" style={styles.hintSpinner} />
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

        <View style={styles.fieldGroup}>
          <View style={styles.passwordRow}>
            <TextInput
              style={[
                styles.input,
                styles.inputPassword,
                styles.inputWithHint,
                passwordHint?.kind === 'error' ? styles.inputError : null,
                passwordHint?.kind === 'ok' ? styles.inputOk : null,
              ]}
              placeholder="Insira sua senha"
              placeholderTextColor="#767676"
              value={password}
              onChangeText={setPassword}
              onBlur={handlePasswordBlur}
              secureTextEntry={hidePassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />
            <TouchableOpacity style={styles.eyeButton} onPress={() => setHidePassword((v) => !v)}>
              <MaterialIcons
                name={hidePassword ? 'visibility' : 'visibility-off'}
                size={22}
                color="#767676"
              />
            </TouchableOpacity>
          </View>
          {passwordHint && (
            <Text
              style={[
                styles.hintText,
                passwordHint.kind === 'error' && styles.hintError,
                passwordHint.kind === 'ok' && styles.hintOk,
              ]}
            >
              {passwordHint.text}
            </Text>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <View style={styles.passwordRow}>
            <TextInput
              style={[
                styles.input,
                styles.inputPassword,
                styles.inputWithHint,
                confirmHint?.kind === 'error' ? styles.inputError : null,
                confirmHint?.kind === 'ok' ? styles.inputOk : null,
              ]}
              placeholder="Confirme sua nova senha"
              placeholderTextColor="#767676"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onBlur={handleConfirmBlur}
              secureTextEntry={hideConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />
            <TouchableOpacity style={styles.eyeButton} onPress={() => setHideConfirm((v) => !v)}>
              <MaterialIcons
                name={hideConfirm ? 'visibility' : 'visibility-off'}
                size={22}
                color="#767676"
              />
            </TouchableOpacity>
          </View>
          {confirmHint && (
            <Text
              style={[
                styles.hintText,
                confirmHint.kind === 'error' && styles.hintError,
                confirmHint.kind === 'ok' && styles.hintOk,
              ]}
            >
              {confirmHint.text}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.continueButton, !formReadyToSubmit && styles.continueButtonDisabled]}
          activeOpacity={0.8}
          onPress={handleContinue}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.continueButtonText}>Continuar</Text>}
        </TouchableOpacity>

        <View style={styles.checkboxRow}>
          <TouchableOpacity
            onPress={() => setAgreeTerms((v) => !v)}
            activeOpacity={0.7}
            style={styles.checkboxTouch}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreeTerms }}
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
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreeOffers }}
          >
            <View style={[styles.checkbox, agreeOffers && styles.checkboxChecked]}>
              {agreeOffers && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </TouchableOpacity>
          <View style={styles.checkboxLabelWrap}>
            <Text style={styles.checkboxLabelInline}>Aceito receber ofertas e comunicações do Take Me.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F1F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  hero: { marginTop: 24, marginBottom: 32 },
  heroTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#0D0D0D',
    lineHeight: 30,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#F1F1F1',
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 16,
    color: '#0D0D0D',
    marginBottom: 12,
  },
  inputWithHint: { marginBottom: 6 },
  inputError: { borderWidth: 1, borderColor: '#DC2626' },
  inputOk: { borderWidth: 1, borderColor: '#059669' },
  fieldGroup: { marginBottom: 12 },
  passwordRow: { position: 'relative', marginBottom: 0 },
  inputPassword: { paddingRight: 48 },
  eyeButton: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 6,
    width: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4 },
  hintSpinner: { marginRight: 6 },
  hintText: { fontSize: 12, color: '#767676', marginBottom: 6, paddingHorizontal: 4 },
  hintError: { color: '#DC2626' },
  hintOk: { color: '#059669' },
  continueButton: {
    backgroundColor: '#0D0D0D',
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  continueButtonText: { fontSize: 16, fontWeight: '500', color: '#FFFFFF' },
  continueButtonDisabled: { backgroundColor: '#9A9A9A' },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  checkboxTouch: { marginRight: 8, marginTop: 2 },
  checkboxLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#767676',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#0D0D0D', borderColor: '#0D0D0D' },
  checkmark: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
  checkboxLabelInline: { fontSize: 12, color: '#767676', lineHeight: 18, fontWeight: '600' },
  link: { color: '#016DF9', fontWeight: '600' },
});
