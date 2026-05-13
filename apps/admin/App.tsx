/**
 * Admin — tela de login como index.
 * No web usa React Router DOM para navegação por URL.
 * No native usa navegação por estado simples.
 */
import { useEffect, useState } from 'react';
import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase, isSupabaseConfigured } from './src/lib/supabase';

const isWeb = Platform.OS === 'web';

// Web: usa React Router DOM + AuthProvider
let WebApp: React.ComponentType | null = null;
if (isWeb) {
  // Lazy import para evitar carregar react-router-dom no native
  const { RouterProvider } = require('react-router-dom');
  const { AuthProvider } = require('./src/contexts/AuthContext');
  const { router } = require('./src/router');
  WebApp = function WebAppInner() {
    return React.createElement(AuthProvider, null,
      React.createElement(RouterProvider, { router }));
  };
}

type Screen = 'loading' | 'login' | 'forgot' | 'signup' | 'home';

export default function App() {
  // Web: renderizar com Router
  if (isWeb && WebApp) {
    return React.createElement(WebApp);
  }

  // —— Native: estado + React Native View/Text/etc ——
  const [screen, setScreen] = useState<Screen>('loading');
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupHidePassword, setSignupHidePassword] = useState(true);
  const [signupHideConfirm, setSignupHideConfirm] = useState(true);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setScreen(session ? 'home' : 'login');
    }).catch(() => setScreen('login'));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setScreen(s ? 'home' : 'login');
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    const input = phoneOrEmail.trim();
    setEmailError('');
    setPasswordError('');
    if (!input) { setEmailError('Digite seu e-mail ou telefone.'); return; }
    if (!password) { setPasswordError('Digite sua senha.'); return; }
    if (!isSupabaseConfigured) { setEmailError('Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.'); return; }
    setLoading(true);
    try {
      if (input.includes('@')) {
        const emailNorm = input.trim().toLowerCase();
        const { data, error: fnErr } = await supabase.functions.invoke('login-with-email', {
          body: { email: emailNorm, password },
        });
        if (fnErr || data?.error || !data?.session) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        await supabase.auth.setSession(data.session);
      } else {
        const phone = input.replace(/\D/g, '');
        const { data, error: fnErr } = await supabase.functions.invoke('login-with-phone', { body: { phone, password } });
        if (fnErr || data?.error || !data?.session) { setEmailError('E-mail incorreto'); setPasswordError('Senha incorreta'); setLoading(false); return; }
        await supabase.auth.setSession(data.session);
      }
      setScreen('home');
    } catch {
      setEmailError('E-mail incorreto');
      setPasswordError('Senha incorreta');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async () => {
    const email = forgotEmail.trim();
    setForgotError('');
    if (!email) { setForgotError('Digite seu e-mail.'); return; }
    if (!isSupabaseConfigured) { setForgotError('Supabase não configurado.'); return; }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setForgotSent(true);
    } catch {
      setForgotError('Não foi possível enviar o e-mail. Tente novamente.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleSignUp = async () => {
    const email = signupEmail.trim();
    setSignupError('');
    if (!email) { setSignupError('Digite seu e-mail.'); return; }
    if (!signupPassword) { setSignupError('Digite uma senha.'); return; }
    if (signupPassword.length < 6) { setSignupError('A senha deve ter no mínimo 6 caracteres.'); return; }
    if (signupPassword !== signupConfirmPassword) { setSignupError('As senhas não coincidem.'); return; }
    if (!isSupabaseConfigured) { setSignupError('Cadastro não configurado. Configure o Supabase no .env.'); return; }
    setSignupLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: signupPassword,
        options: signupName.trim() ? { data: { full_name: signupName.trim() } } : undefined,
      });
      if (error) throw error;
      if (data?.user && !data.session) {
        setSignupSuccess(true);
        setSignupError('');
      } else if (data?.session) {
        setScreen('home');
      } else {
        setSignupSuccess(true);
      }
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Não foi possível criar a conta. Tente novamente.';
      setSignupError(msg);
    } finally {
      setSignupLoading(false);
    }
  };

  const s = StyleSheet.create({
    outer: { flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', padding: 24 },
    loading: { flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: '#6B7280', fontSize: 16 },
    home: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
    homeText: { fontSize: 20, fontWeight: '600', color: '#000' },
    card: { backgroundColor: '#fff', padding: 32, width: '100%', maxWidth: 400 },
    backBtn: { marginBottom: 20 },
    backArrow: { fontSize: 18, fontWeight: '600', color: '#000' },
    logo: { width: 120, height: 64, backgroundColor: '#F3F4F6', borderRadius: 8, alignSelf: 'center', marginBottom: 24 },
    title: { fontSize: 18, fontWeight: '400', color: '#000', marginBottom: 20 },
    subtitle: { fontSize: 15, color: '#6B7280', marginBottom: 24 },
    label: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 6 },
    input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#000', backgroundColor: '#fff', marginBottom: 4 },
    inputError: { borderColor: '#DC2626' },
    inputPassword: { paddingRight: 56 },
    passwordRow: { position: 'relative', marginBottom: 4 },
    eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
    eyeLabel: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
    errorText: { fontSize: 12, color: '#DC2626', marginBottom: 12 },
    link: { alignSelf: 'flex-start', marginBottom: 20 },
    linkText: { fontSize: 14, fontWeight: '500', color: '#000' },
    primaryBtn: { backgroundColor: '#0D0D0D', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
    primaryBtnDisabled: { opacity: 0.7 },
    primaryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
    secondaryBtn: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#0D0D0D', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
    secondaryBtnText: { fontSize: 16, fontWeight: '600', color: '#0D0D0D' },
    sentText: { fontSize: 15, color: '#059669' },
  });

  if (screen === 'loading') {
    return (
      <View style={s.loading}>
        <StatusBar style="light" />
        <Text style={s.loadingText}>Carregando...</Text>
      </View>
    );
  }
  if (screen === 'home') {
    return (
      <View style={s.home}>
        <StatusBar style="dark" />
        <Text style={s.homeText}>Bem-vindo ao Admin</Text>
      </View>
    );
  }
  if (screen === 'forgot') {
    return (
      <KeyboardAvoidingView style={s.outer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="light" />
        <View style={s.card}>
          <TouchableOpacity onPress={() => setScreen('login')} style={s.backBtn}>
            <Text style={s.backArrow}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={s.title}>Recuperação de senha</Text>
          <Text style={s.subtitle}>Digite seu e-mail e enviaremos um link para redefinir sua senha.</Text>
          {forgotSent ? (
            <Text style={s.sentText}>Verifique seu e-mail.</Text>
          ) : (
            <>
              <TextInput style={[s.input, forgotError ? s.inputError : null]} placeholder="E-mail" placeholderTextColor="#9CA3AF" value={forgotEmail} onChangeText={(t) => { setForgotEmail(t); setForgotError(''); }} autoCapitalize="none" keyboardType="email-address" editable={!forgotLoading} />
              {forgotError ? <Text style={s.errorText}>{forgotError}</Text> : null}
              <TouchableOpacity style={[s.primaryBtn, forgotLoading && s.primaryBtnDisabled]} onPress={handleForgotSubmit} disabled={forgotLoading}>
                {forgotLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Enviar link</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }
  if (screen === 'signup') {
    return (
      <KeyboardAvoidingView style={s.outer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="light" />
        <View style={s.card}>
          <TouchableOpacity onPress={() => { setScreen('login'); setSignupSuccess(false); setSignupError(''); }} style={s.backBtn}>
            <Text style={s.backArrow}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={s.title}>Criar conta</Text>
          {signupSuccess ? (
            <>
              <Text style={s.sentText}>Conta criada. Faça login com seu e-mail e senha.</Text>
              <TouchableOpacity style={[s.primaryBtn, { marginTop: 16 }]} onPress={() => { setScreen('login'); setSignupSuccess(false); }}>
                <Text style={s.primaryBtnText}>Ir para o login</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.label}>Nome (opcional)</Text>
              <TextInput style={s.input} placeholder="Nome" placeholderTextColor="#9CA3AF" value={signupName} onChangeText={(t) => { setSignupName(t); setSignupError(''); }} editable={!signupLoading} />
              <Text style={s.label}>E-mail</Text>
              <TextInput style={[s.input, signupError ? s.inputError : null]} placeholder="E-mail" placeholderTextColor="#9CA3AF" value={signupEmail} onChangeText={(t) => { setSignupEmail(t); setSignupError(''); }} autoCapitalize="none" keyboardType="email-address" editable={!signupLoading} />
              <Text style={s.label}>Senha (mín. 6 caracteres)</Text>
              <View style={s.passwordRow}>
                <TextInput style={[s.input, s.inputPassword, signupError ? s.inputError : null]} placeholder="Senha" placeholderTextColor="#9CA3AF" value={signupPassword} onChangeText={(t) => { setSignupPassword(t); setSignupError(''); }} secureTextEntry={signupHidePassword} editable={!signupLoading} />
                <TouchableOpacity style={s.eyeBtn} onPress={() => setSignupHidePassword((v) => !v)}>
                  <Text style={s.eyeLabel}>{signupHidePassword ? 'Ver' : 'Ocultar'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.label}>Confirmar senha</Text>
              <View style={s.passwordRow}>
                <TextInput style={[s.input, s.inputPassword]} placeholder="Confirmar senha" placeholderTextColor="#9CA3AF" value={signupConfirmPassword} onChangeText={(t) => { setSignupConfirmPassword(t); setSignupError(''); }} secureTextEntry={signupHideConfirm} editable={!signupLoading} />
                <TouchableOpacity style={s.eyeBtn} onPress={() => setSignupHideConfirm((v) => !v)}>
                  <Text style={s.eyeLabel}>{signupHideConfirm ? 'Ver' : 'Ocultar'}</Text>
                </TouchableOpacity>
              </View>
              {signupError ? <Text style={s.errorText}>{signupError}</Text> : null}
              <TouchableOpacity style={s.link} onPress={() => setScreen('login')} disabled={signupLoading}>
                <Text style={s.linkText}>Já tem conta? Entrar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.primaryBtn, signupLoading && s.primaryBtnDisabled]} onPress={handleSignUp} disabled={signupLoading}>
                {signupLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Criar conta</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }
  return (
    <KeyboardAvoidingView style={s.outer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={s.card}>
        <View style={s.logo} />
        <Text style={s.title}>Digite seu número de telefone ou email</Text>
        <Text style={s.label}>Telefone ou email</Text>
        <TextInput style={[s.input, emailError ? s.inputError : null]} placeholder="Telefone ou email" placeholderTextColor="#9CA3AF" value={phoneOrEmail} onChangeText={(t) => { setPhoneOrEmail(t); setEmailError(''); }} autoCapitalize="none" keyboardType="email-address" editable={!loading} />
        {emailError ? <Text style={s.errorText}>{emailError}</Text> : null}
        <Text style={s.label}>Senha de acesso</Text>
        <View style={s.passwordRow}>
          <TextInput style={[s.input, s.inputPassword, passwordError ? s.inputError : null]} placeholder="Senha de acesso" placeholderTextColor="#9CA3AF" value={password} onChangeText={(t) => { setPassword(t); setPasswordError(''); }} secureTextEntry={hidePassword} editable={!loading} />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setHidePassword((v) => !v)}>
            <Text style={s.eyeLabel}>{hidePassword ? 'Ver' : 'Ocultar'}</Text>
          </TouchableOpacity>
        </View>
        {passwordError ? <Text style={s.errorText}>{passwordError}</Text> : null}
        <TouchableOpacity style={s.link} onPress={() => setScreen('forgot')} disabled={loading}>
          <Text style={s.linkText}>Esqueceu sua senha?</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.primaryBtn, loading && s.primaryBtnDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Continuar</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.secondaryBtn} onPress={() => setScreen('signup')} disabled={loading}>
          <Text style={s.secondaryBtnText}>Criar conta</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
