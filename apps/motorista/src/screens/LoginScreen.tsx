import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { Text } from '../components/Text';
import { useAppAlert } from '../contexts/AppAlertContext';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '../components/GoogleLogo';
import { StatusBar } from 'expo-status-bar';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { signInWithOAuthProvider } from '../lib/oauth';
import { checkMotoristaCanAccessApp, getMotoristaPendingCopy, subtypeToMainRoute } from '../lib/motoristaAccess';
import { useDeferredDriverSignup } from '../contexts/DeferredDriverSignupContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { syncMotoristaProfileFcmToken } from '../lib/motoristaFcm';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const { setDriverType } = useDeferredDriverSignup();
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  /** Sempre volta à entrada (Criar conta / Já tenho conta), não ao histórico anterior do stack. */
  const goBackToWelcome = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  /** Após senha OK: só entra no Main se worker_profiles.status = approved. */
  const navigateAccordingToMotoristaStatus = async () => {
    Keyboard.dismiss();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      await supabase.auth.signOut();
      showAlert('Erro no login', 'Sessão inválida. Tente novamente.');
      return;
    }
    const gate = await checkMotoristaCanAccessApp(user.id);
    if (gate.kind === 'error') {
      await supabase.auth.signOut();
      showAlert('Erro', gate.message);
      return;
    }
    // Usuário já criou conta (Auth + worker_profile draft), mas abandonou a etapa 2.
    // Retomamos exatamente na tela "Complete seu perfil" correspondente ao tipo escolhido.
    if (gate.kind === 'needs_profile_completion') {
      await syncMotoristaProfileFcmToken();
      const rt = gate.registrationType;
      if (rt === 'preparador_excursões') {
        setDriverType(rt);
        navigation.reset({ index: 0, routes: [{ name: 'CompletePreparadorExcursoes' }] });
        return;
      }
      if (rt === 'preparador_encomendas') {
        setDriverType(rt);
        navigation.reset({ index: 0, routes: [{ name: 'CompletePreparadorEncomendas' }] });
        return;
      }
      // driver/takeme ou driver/partner (ou fallback null → assume take_me).
      const driverType: 'take_me' | 'parceiro' = rt === 'parceiro' ? 'parceiro' : 'take_me';
      setDriverType(driverType);
      navigation.reset({
        index: 0,
        routes: [{ name: 'CompleteDriverRegistration', params: { driverType } }],
      });
      return;
    }
    // Conta existe no Auth mas faltou a linha em worker_profiles (ex.: insert falhou na
    // verify-email-code). Mantemos a sessão e levamos o usuário para escolher o tipo
    // de cadastro — o SignUpType detecta a sessão e insere a linha draft antes de seguir.
    if (gate.kind === 'missing_profile') {
      showAlert(
        'Finalize seu cadastro',
        'Você já tem uma conta, mas ainda precisa escolher o tipo de cadastro para continuar.',
        {
          onClose: () => {
            navigation.reset({ index: 0, routes: [{ name: 'SignUpType' }] });
          },
        }
      );
      return;
    }
    if (gate.kind === 'pending') {
      const c = getMotoristaPendingCopy(gate.status);
      await syncMotoristaProfileFcmToken();
      showAlert(c.title, c.message, {
        onClose: () => {
          navigation.reset({ index: 0, routes: [{ name: 'MotoristaPendingApproval' }] });
        },
      });
      return;
    }
    if (gate.kind === 'needs_stripe_connect') {
      await syncMotoristaProfileFcmToken();
      navigation.reset({ index: 0, routes: [{ name: 'StripeConnectSetup', params: { subtype: gate.subtype } }] });
      return;
    }
    await syncMotoristaProfileFcmToken();
    navigation.reset({ index: 0, routes: [{ name: subtypeToMainRoute(gate.subtype, gate.role) }] });
  };

  const handleLogin = async () => {
    const input = phoneOrEmail.trim();
    if (!input) {
      showAlert('Atenção', 'Digite seu e-mail ou telefone.');
      return;
    }
    if (!password) {
      showAlert('Atenção', 'Digite sua senha.');
      return;
    }
    if (!isSupabaseConfigured) {
      showAlert(
        'Configuração',
        'Login não configurado. Verifique as variáveis do Supabase no .env.'
      );
      return;
    }
    setLoading(true);
    try {
      const isEmail = input.includes('@');

      if (isEmail) {
        const result = await supabase.auth.signInWithPassword({
          email: input,
          password,
        });
        const hasSession = result?.data?.session != null;
        if (result?.error || !hasSession) {
          Keyboard.dismiss();
          setLoading(false);
          showAlert('Erro no login', 'E-mail ou senha incorretos. Tente novamente.');
          return;
        }
      } else {
        const phoneDigits = input.replace(/\D/g, '');
        const { data, error: fnError } = await supabase.functions.invoke('login-with-phone', {
          body: { phone: phoneDigits, password },
        });
        if (fnError) {
          const msg = getUserErrorMessage(fnError, 'Telefone ou senha incorretos. Tente novamente.');
          Keyboard.dismiss();
          setLoading(false);
          showAlert('Erro no login', msg);
          return;
        }
        if (data?.error) {
          Keyboard.dismiss();
          setLoading(false);
          showAlert('Erro no login', String(data.error));
          return;
        }
        if (!data?.session) throw new Error('Resposta inválida.');
        await supabase.auth.setSession(data.session);
      }

      await navigateAccordingToMotoristaStatus();
    } catch (e: unknown) {
      const isNetworkError =
        e instanceof TypeError && (e as Error).message?.includes('Network request failed');
      const msg = isNetworkError
        ? 'Sem conexão com a internet. Verifique sua rede e tente novamente.'
        : getUserErrorMessage(e, 'Não foi possível entrar. Verifique e-mail/senha ou telefone/senha.');
      Keyboard.dismiss();
      showAlert(isNetworkError ? 'Erro de conexão' : 'Erro no login', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured) {
      showAlert('Configuração', 'Login não configurado. Verifique as variáveis do Supabase no .env.');
      return;
    }
    setGoogleLoading(true);
    try {
      const { success, error } = await signInWithOAuthProvider('google');
      if (!success) {
        if (error && error !== 'Login cancelado.') {
          showAlert('Google', error);
        }
        return;
      }
      await navigateAccordingToMotoristaStatus();
    } catch (e) {
      showAlert('Google', getUserErrorMessage(e, 'Não foi possível entrar com o Google.'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (Platform.OS !== 'ios') {
      showAlert('Apple', 'Login com Apple disponível apenas no iOS.');
      return;
    }
    if (!isSupabaseConfigured) {
      showAlert('Configuração', 'Login não configurado. Verifique as variáveis do Supabase no .env.');
      return;
    }
    setAppleLoading(true);
    try {
      /** Apple exige nonce hashed (SHA256) na request; o raw nonce vai pro Supabase validar o id_token. */
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) {
        showAlert('Apple', 'Não foi possível obter o token da Apple. Tente novamente.');
        return;
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error) {
        showAlert('Apple', error.message);
        return;
      }
      await navigateAccordingToMotoristaStatus();
    } catch (e: unknown) {
      /** Cancelamento do usuário (ERR_REQUEST_CANCELED) não é erro: silenciar. */
      const code = (e as { code?: string } | null | undefined)?.code;
      if (code === 'ERR_REQUEST_CANCELED') return;
      showAlert('Apple', getUserErrorMessage(e, 'Não foi possível entrar com a Apple.'));
    } finally {
      setAppleLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
      >
        <View style={styles.containerInner}>
          <StatusBar style="dark" />
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBackToWelcome}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Digite seu e-mail ou telefone</Text>

          <TextInput
            style={styles.input}
            placeholder="Telefone ou email"
            placeholderTextColor="#9CA3AF"
            value={phoneOrEmail}
            onChangeText={setPhoneOrEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.inputPassword]}
              placeholder="Senha"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={hidePassword}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setHidePassword((v) => !v)}
            >
              <MaterialIcons
                name={hidePassword ? 'visibility' : 'visibility-off'}
                size={22}
                color="#6B7280"
                style={styles.eyeIconCenter}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.continueButton, loading && styles.continueButtonDisabled]}
            activeOpacity={0.8}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueButtonText}>Entrar</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.forgotLink}
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            <Text style={styles.forgotLinkText}>Esqueceu sua senha?</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.socialButton, (loading || googleLoading) && styles.continueButtonDisabled]}
            activeOpacity={0.8}
            onPress={handleGoogleSignIn}
            disabled={loading || googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color="#111827" />
            ) : (
              <>
                <GoogleLogo size={22} style={styles.socialIconImage} />
                <Text style={styles.socialButtonText}>Continuar com Google</Text>
              </>
            )}
          </TouchableOpacity>
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.socialButton, (loading || appleLoading) && styles.continueButtonDisabled]}
              activeOpacity={0.8}
              onPress={handleAppleSignIn}
              disabled={loading || appleLoading}
            >
              {appleLoading ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={22} color="#000000" style={styles.socialIconImage} />
                  <Text style={styles.socialButtonText}>Continuar com Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  containerInner: { flex: 1, paddingHorizontal: 24, paddingTop: 60 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  backArrow: { fontSize: 22, color: '#000000', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: '#000000', marginBottom: 24 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000000',
    marginBottom: 16,
  },
  passwordRow: { position: 'relative', marginBottom: 0 },
  inputPassword: { paddingRight: 48 },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIconCenter: { marginTop: -3 },
  continueButton: {
    backgroundColor: '#000000',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  continueButtonDisabled: { opacity: 0.7 },
  continueButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  forgotLink: { alignSelf: 'flex-end', marginBottom: 32 },
  forgotLinkText: { fontSize: 14, color: '#000000', fontWeight: '500' },
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { marginHorizontal: 16, fontSize: 14, color: '#6B7280', fontWeight: '500' },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  socialIconImage: { marginRight: 12 },
  socialButtonText: { fontSize: 16, fontWeight: '500', color: '#000000' },
});
