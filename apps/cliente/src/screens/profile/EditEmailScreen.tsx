import { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';
import { isPhoneLoginAccount, getRecordEmail } from '../../utils/loginMethod';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditEmail'>;

/** Mascara o e-mail para a mensagem de confirmação (ex.: jo***@gmail.com). */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

export function EditEmailScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [email, setEmail] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [isPhoneLogin, setIsPhoneLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const phoneLogin = isPhoneLoginAccount(user);
      setIsPhoneLogin(phoneLogin);
      // Conta por telefone: e-mail é só registro (user_metadata.email), nunca o sintético.
      const initial = phoneLogin ? getRecordEmail(user) : (user?.email ?? '');
      setEmail(initial);
      setCurrentEmail(initial);
      setInitialLoading(false);
    })();
  }, []);

  const handleUpdate = async () => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed === currentEmail.trim().toLowerCase()) {
      showAlert('Atenção', 'O e-mail informado é o mesmo da sua conta. Não é necessário atualizar.');
      return;
    }

    // Conta por telefone: e-mail é apenas um registro → salva direto, sem confirmação.
    if (isPhoneLogin) {
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        showAlert('Erro', 'Informe um e-mail válido.');
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ data: { email: trimmed || null } });
      setLoading(false);
      if (error) {
        showAlert('Erro', getUserErrorMessage(error, 'Não foi possível salvar o e-mail.'));
        return;
      }
      navigation.goBack();
      return;
    }

    // Conta por e-mail: trocar o e-mail é trocar o login → confirmação por link no e-mail atual.
    if (!trimmed) {
      showAlert('Erro', 'Informe um e-mail válido.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('change-login-email', {
      body: { newEmail: trimmed },
    });
    setLoading(false);
    if (error || (data && (data as { error?: string }).error)) {
      const backendMsg = (data as { error?: string } | null)?.error;
      showAlert('Erro', backendMsg || getUserErrorMessage(error, 'Não foi possível solicitar a troca de e-mail.'));
      return;
    }
    showAlert(
      'Confirme pelo e-mail',
      `Enviamos um link de confirmação para ${maskEmail(currentEmail)}. Abra-o para concluir a troca para ${trimmed}.`,
      { onClose: () => navigation.goBack() },
    );
  };

  if (initialLoading) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.dialog}>
          <View style={styles.headerRow}>
            <View style={styles.headerSpacer} />
            <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <MaterialIcons name="close" size={22} color={COLORS.neutral700} />
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>Atualize seu e-mail</Text>
          <Text style={styles.hint}>Use um e-mail válido. Ele será utilizado para notificações e recuperação de conta.</Text>
          <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="seu@email.com"
          placeholderTextColor={COLORS.neutral700}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleUpdate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Atualizar</Text>}
        </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboard: { flex: 1 },
  dialog: { flex: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 },
  headerSpacer: { flex: 1 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 12 },
  hint: { fontSize: 14, color: COLORS.neutral700, marginBottom: 24 },
  label: { fontSize: 15, fontWeight: '500', color: COLORS.black, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.black,
    marginBottom: 20,
  },
  button: {
    backgroundColor: COLORS.black,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
