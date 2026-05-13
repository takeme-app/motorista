import { useState, type ComponentType } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const logoSource = require('../../assets/logo.png');

const isWeb = Platform.OS === 'web';

type Props = {
  onForgotPassword: () => void;
  onLoginSuccess: () => void;
};

export function LoginScreen({ onForgotPassword, onLoginSuccess }: Props) {
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const clearErrors = () => {
    setEmailError('');
    setPasswordError('');
  };

  const handleLogin = async () => {
    const input = phoneOrEmail.trim();
    clearErrors();

    if (!input) {
      setEmailError('Digite seu e-mail ou telefone.');
      return;
    }
    if (!password) {
      setPasswordError('Digite sua senha.');
      return;
    }
    if (!isSupabaseConfigured) {
      setEmailError('Login não configurado. Configure as variáveis do Supabase no .env.');
      return;
    }

    setLoading(true);
    try {
      const isEmail = input.includes('@');

      if (isEmail) {
        const emailNorm = input.trim().toLowerCase();
        const { data, error: fnError } = await supabase.functions.invoke('login-with-email', {
          body: { email: emailNorm, password },
        });
        if (fnError) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        const errMsg = data?.error;
        if (errMsg) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        if (!data?.session) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        await supabase.auth.setSession(data.session);
      } else {
        const phoneDigits = input.replace(/\D/g, '');
        const { data, error: fnError } = await supabase.functions.invoke('login-with-phone', {
          body: { phone: phoneDigits, password },
        });
        if (fnError) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        const errMsg = data?.error;
        if (errMsg) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        if (!data?.session) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        await supabase.auth.setSession(data.session);
      }

      onLoginSuccess();
    } catch {
      setEmailError('E-mail incorreto');
      setPasswordError('Senha incorreta');
    } finally {
      setLoading(false);
    }
  };

  const Wrapper = (isWeb ? View : TouchableWithoutFeedback) as ComponentType<Record<string, unknown>>;
  const wrapperProps = isWeb
    ? { style: styles.containerOuter }
    : { onPress: Keyboard.dismiss, accessible: false };

  return (
    <Wrapper {...wrapperProps}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!isWeb && <StatusBar style="light" />}
        <View style={styles.card}>
          {isWeb ? (
            <View style={[styles.logo, styles.logoPlaceholder]} />
          ) : (
            <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          )}
          <Text style={styles.title}>Digite seu número de telefone ou email</Text>

          <Text style={styles.label}>Telefone ou email</Text>
          <TextInput
            style={StyleSheet.flatten([styles.input, emailError ? styles.inputError : null])}
            placeholder="Telefone ou email"
            placeholderTextColor="#9CA3AF"
            value={phoneOrEmail}
            onChangeText={(t) => {
              setPhoneOrEmail(t);
              if (emailError) setEmailError('');
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

          <Text style={styles.label}>Senha de acesso</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={StyleSheet.flatten([
                styles.input,
                styles.inputPassword,
                passwordError ? styles.inputError : null,
              ])}
              placeholder="Senha de acesso"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (passwordError) setPasswordError('');
              }}
              secureTextEntry={hidePassword}
              editable={!loading}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setHidePassword((v) => !v)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              {isWeb ? (
                <Text style={styles.eyeLabel}>{hidePassword ? 'Ver' : 'Ocultar'}</Text>
              ) : (
                <MaterialIcons
                  name={hidePassword ? 'visibility' : 'visibility-off'}
                  size={22}
                  color="#6B7280"
                />
              )}
            </TouchableOpacity>
          </View>
          {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

          <TouchableOpacity style={styles.forgotLink} onPress={onForgotPassword} disabled={loading}>
            <Text style={styles.forgotLinkText}>Esqueceu sua senha?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={StyleSheet.flatten([styles.continueButton, loading && styles.continueButtonDisabled])}
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
        </View>
      </KeyboardAvoidingView>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  containerOuter: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#1F1F1F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    width: '100%',
    maxWidth: 400,
  },
  logo: {
    width: 120,
    height: 64,
    marginBottom: 24,
    alignSelf: 'center',
  },
  logoPlaceholder: {
    backgroundColor: '#F3F4F6',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
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
    marginBottom: 4,
  },
  inputError: {
    borderColor: '#DC2626',
  },
  inputPassword: {
    paddingRight: 48,
  },
  passwordRow: {
    position: 'relative',
    marginBottom: 4,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    marginBottom: 12,
  },
  forgotLink: {
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  forgotLinkText: {
    fontSize: 14,
    color: '#000000',
    fontWeight: '500',
  },
  continueButton: {
    backgroundColor: '#0D0D0D',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.7,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
