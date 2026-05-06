import { useCallback, useMemo, useState } from 'react';
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
import { assertClientePassengerOnlyAccount } from '../lib/clientePassengerOnlyGate';
import { signInWithOAuthProvider } from '../lib/oauth';
import { getUserErrorMessage } from '../utils/errorMessage';
import { parseInvokeData, parseInvokeError } from '../utils/edgeFunctionResponse';
import { detectPhoneOrEmailChannel, formatPhoneBRMask } from '../utils/phoneOrEmailInput';
import { syncClienteProfileFcmToken } from '../lib/clienteFcm';
import type { Session } from '@supabase/supabase-js';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/** Grava sessão devolvida por `login-with-email` / `login-with-phone` e expõe erro real (ex.: JWT inválido se .env ≠ projeto). */
async function persistEdgeLoginSession(
  client: typeof supabase,
  fnPayload: unknown,
): Promise<Session> {
  const payload =
    parseInvokeData(fnPayload) ??
    (fnPayload && typeof fnPayload === 'object' ? (fnPayload as Record<string, unknown>) : null);
  const sess = payload?.session;
  if (!sess || typeof sess !== 'object') {
    throw new Error('Resposta inválida (sem sessão do servidor).');
  }
  const { data, error } = await client.auth.setSession(sess as never);
  if (error) {
    const m = error.message || String(error);
    const hint = /jwt|refresh|invalid|malformed|session/i.test(m)
      ? ' Verifique se EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY são do mesmo projeto Supabase das Edge Functions; altere o .env, pare o Metro (Ctrl+C) e rode de novo `npm start` em apps/cliente.'
      : '';
    throw new Error((m || 'Não foi possível guardar a sessão.') + hint);
  }
  if (!data.session?.user) {
    throw new Error(
      'Sessão vazia após o login. Confirme EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY, reinicie o Metro com cache limpo: `npx expo start --clear`.',
    );
  }
  return data.session;
}

export function LoginScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  const loginIdentifierChannel = useMemo(
    () => detectPhoneOrEmailChannel(phoneOrEmail),
    [phoneOrEmail]
  );

  const handlePhoneOrEmailChange = useCallback((text: string) => {
    if (detectPhoneOrEmailChannel(text) === 'phone') {
      setPhoneOrEmail(formatPhoneBRMask(text));
    } else {
      setPhoneOrEmail(text);
    }
  }, []);

  /** Sempre volta à entrada (Criar conta / Já tenho conta), não ao histórico anterior do stack. */
  const goBackToWelcome = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
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
      let activeSession: Session;

      if (isEmail) {
        const emailNorm = input.trim().toLowerCase();
        const { data, error: fnError } = await supabase.functions.invoke('login-with-email', {
          body: { email: emailNorm, password },
        });
        if (fnError) {
          const bodyError = await parseInvokeError(fnError);
          Keyboard.dismiss();
          setLoading(false);
          showAlert(
            'Erro no login',
            bodyError ?? getUserErrorMessage(fnError, 'E-mail ou senha incorretos. Tente novamente.'),
          );
          return;
        }
        const errMsg = data?.error;
        if (errMsg) {
          Keyboard.dismiss();
          setLoading(false);
          showAlert('Erro no login', String(errMsg));
          return;
        }
        if (!data?.session && !parseInvokeData(data)?.session) {
          throw new Error('Resposta inválida.');
        }
        activeSession = await persistEdgeLoginSession(supabase, data);
      } else {
        const phoneDigits = input.replace(/\D/g, '');
        const { data, error: fnError } = await supabase.functions.invoke('login-with-phone', {
          body: { phone: phoneDigits, password },
        });
        if (fnError) {
          const bodyError = await parseInvokeError(fnError);
          const msg = bodyError ?? getUserErrorMessage(fnError, 'Telefone ou senha incorretos. Tente novamente.');
          Keyboard.dismiss();
          setLoading(false);
          showAlert('Erro no login', msg);
          return;
        }
        const errMsg = data?.error;
        if (errMsg) {
          Keyboard.dismiss();
          setLoading(false);
          showAlert('Erro no login', String(errMsg));
          return;
        }
        if (!data?.session && !parseInvokeData(data)?.session) {
          throw new Error('Resposta inválida.');
        }
        activeSession = await persistEdgeLoginSession(supabase, data);
      }

      const gate = await assertClientePassengerOnlyAccount(activeSession.user.id);
      if (!gate.ok) {
        await supabase.auth.signOut();
        Keyboard.dismiss();
        setLoading(false);
        showAlert('Acesso não permitido', gate.message);
        return;
      }

      await syncClienteProfileFcmToken();
      navigation.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      });
    } catch (e: unknown) {
      const isNetworkError =
        e instanceof TypeError && (e.message === 'Network request failed' || (e as Error).message?.includes('Network request failed'));
      const msg = isNetworkError
        ? 'Sem conexão com a internet ou servidor temporariamente indisponível. Verifique sua rede e tente novamente.'
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
      const { data: { session: oauthSession } } = await supabase.auth.getSession();
      if (!oauthSession?.user) {
        showAlert('Google', 'Não foi possível obter a sessão. Tente novamente.');
        return;
      }
      const gate = await assertClientePassengerOnlyAccount(oauthSession.user.id);
      if (!gate.ok) {
        await supabase.auth.signOut();
        showAlert('Acesso não permitido', gate.message);
        return;
      }
      await syncClienteProfileFcmToken();
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
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
      const { data: { session: oauthSession } } = await supabase.auth.getSession();
      if (!oauthSession?.user) {
        showAlert('Apple', 'Não foi possível obter a sessão. Tente novamente.');
        return;
      }
      const gate = await assertClientePassengerOnlyAccount(oauthSession.user.id);
      if (!gate.ok) {
        await supabase.auth.signOut();
        showAlert('Acesso não permitido', gate.message);
        return;
      }
      await syncClienteProfileFcmToken();
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
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

          <Text style={styles.title}>Digite seu número de telefone ou email</Text>

      <TextInput
        style={styles.input}
        placeholder="Telefone ou email"
        placeholderTextColor="#9CA3AF"
        value={phoneOrEmail}
        onChangeText={handlePhoneOrEmailChange}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType={loginIdentifierChannel === 'phone' ? 'telephoneNumber' : 'emailAddress'}
      />
      <View style={styles.passwordRow}>
        <TextInput
          style={[styles.input, styles.inputPassword]}
          placeholder="Senha de acesso"
          placeholderTextColor="#9CA3AF"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={hidePassword}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setHidePassword((v) => !v)}
        >
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

      <TouchableOpacity
        style={[styles.continueButton, loading && styles.continueButtonDisabled]}
        activeOpacity={0.8}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.continueButtonText}>Continuar</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  containerInner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  backArrow: {
    fontSize: 22,
    color: '#000000',
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 24,
  },
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
    marginBottom: 16,
  },
  continueButtonDisabled: {
    opacity: 0.7,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginBottom: 32,
  },
  forgotLinkText: {
    fontSize: 14,
    color: '#000000',
    fontWeight: '500',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
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
  socialIconImage: {
    marginRight: 12,
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000000',
  },
});
