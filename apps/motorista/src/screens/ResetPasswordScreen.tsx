import { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import {
  parseInvokeData,
  parseInvokeError,
  isSupabaseFunctionNotFoundMessage,
  MSG_DEPLOY_COMPLETE_PASSWORD_RESET,
} from '../utils/edgeFunctionResponse';

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

export function ResetPasswordScreen({ navigation, route }: Props) {
  const { showAlert } = useAppAlert();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [hideConfirm, setHideConfirm] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (password.length < 8) {
      showAlert('Atenção', 'A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Atenção', 'As senhas não coincidem.');
      return;
    }
    if (!isSupabaseConfigured) {
      showAlert('Configuração', 'Serviço não configurado.');
      return;
    }
    setLoading(true);
    try {
      const token = route.params?.passwordResetToken;
      if (token) {
        const { data: fnData, error: fnError } = await supabase.functions.invoke('complete-password-reset', {
          body: { token, password },
        });
        const payload = parseInvokeData(fnData);
        if (payload?.error != null) {
          showAlert('Erro', String(payload.error));
          return;
        }
        if (fnError) {
          const bodyError = await parseInvokeError(fnError);
          const fnMsg =
            fnError && typeof fnError === 'object' && typeof (fnError as { message?: string }).message === 'string'
              ? (fnError as { message: string }).message
              : '';
          if (isSupabaseFunctionNotFoundMessage(bodyError) || isSupabaseFunctionNotFoundMessage(fnMsg)) {
            showAlert('Serviço indisponível', MSG_DEPLOY_COMPLETE_PASSWORD_RESET);
            return;
          }
          showAlert('Erro', bodyError ?? getUserErrorMessage(fnError, 'Não foi possível atualizar a senha.'));
          return;
        }
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      }
      navigation.navigate('ResetPasswordSuccess');
    } catch (e: unknown) {
      showAlert(
        'Erro',
        getUserErrorMessage(e, 'Não foi possível atualizar a senha. Solicite um novo código ou abra o link do e-mail.'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="height">
      <StatusBar style="dark" />
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Defina sua nova senha</Text>
      <Text style={styles.subtitle}>Agora é só definir uma nova senha para acessar sua conta.</Text>

      <View style={styles.passwordRow}>
        <TextInput style={[styles.input, styles.inputPassword]} placeholder="Nova senha" placeholderTextColor="#9CA3AF" value={password} onChangeText={setPassword} secureTextEntry={hidePassword} />
        <TouchableOpacity style={styles.eyeButton} onPress={() => setHidePassword((v) => !v)}>
          <MaterialIcons name={hidePassword ? 'visibility' : 'visibility-off'} size={22} color="#6B7280" style={styles.eyeIconCenter} />
        </TouchableOpacity>
      </View>
      <View style={styles.passwordRow}>
        <TextInput style={[styles.input, styles.inputPassword]} placeholder="Confirme a senha" placeholderTextColor="#9CA3AF" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={hideConfirm} />
        <TouchableOpacity style={styles.eyeButton} onPress={() => setHideConfirm((v) => !v)}>
          <MaterialIcons name={hideConfirm ? 'visibility' : 'visibility-off'} size={22} color="#6B7280" style={styles.eyeIconCenter} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[styles.submitButton, loading && styles.submitButtonDisabled]} activeOpacity={0.8} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Atualizar senha</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24, paddingTop: 60 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  backArrow: { fontSize: 22, color: '#000000', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: '#000000', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 24 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#000000' },
  passwordRow: { position: 'relative', marginBottom: 16 },
  inputPassword: { paddingRight: 48 },
  eyeButton: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  eyeIconCenter: { marginTop: -3 },
  submitButton: { backgroundColor: '#000000', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
