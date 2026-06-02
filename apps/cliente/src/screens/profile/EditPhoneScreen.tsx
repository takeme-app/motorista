import { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
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
import { isPhoneLoginAccount } from '../../utils/loginMethod';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditPhone'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function EditPhoneScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [phone, setPhone] = useState('');
  const [currentPhoneDigits, setCurrentPhoneDigits] = useState('');
  const [isPhoneLogin, setIsPhoneLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setInitialLoading(false);
        return;
      }
      setIsPhoneLogin(isPhoneLoginAccount(user));
      const { data } = await supabase.from('profiles').select('phone').eq('id', user.id).single();
      const raw = (data?.phone ?? '').trim().replace(/\D/g, '') || '';
      setCurrentPhoneDigits(raw);
      setPhone(formatPhone(raw));
      setInitialLoading(false);
    })();
  }, []);

  const performUpdate = async (phoneDigits: string) => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ phone: phoneDigits, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    // Conta por telefone: o número é o login → espelha em user_metadata.phone.
    if (!error && isPhoneLogin) {
      await supabase.auth.updateUser({ data: { phone: phoneDigits } });
    }
    setLoading(false);
    if (error) {
      const isDuplicate = error.code === '23505' || /unique|already exists|duplicate|já.*uso/i.test(String(error.message ?? ''));
      if (isDuplicate) {
        showAlert('Atenção', 'Este telefone já está cadastrado em outra conta. Use outro número.');
      } else {
        showAlert('Erro', getUserErrorMessage(error, 'Não foi possível atualizar o telefone.'));
      }
      return;
    }
    navigation.goBack();
  };

  const handleUpdate = async () => {
    const phoneDigits = phone.replace(/\D/g, '').trim() || null;
    if (!phoneDigits) {
      showAlert('Erro', 'Informe um telefone válido.');
      return;
    }
    if (phoneDigits === currentPhoneDigits) {
      showAlert('Atenção', 'O telefone informado é o mesmo da sua conta. Não é necessário atualizar.');
      return;
    }
    // Conta por telefone: trocar o número troca o login → confirma antes.
    if (isPhoneLogin) {
      Alert.alert(
        'Trocar telefone de login',
        'Este número é o login da sua conta. Ao trocar, você passará a entrar com o novo número. Deseja continuar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Trocar', style: 'destructive', onPress: () => { void performUpdate(phoneDigits); } },
        ],
      );
      return;
    }
    // Conta por e-mail: telefone é só registro → salva direto.
    await performUpdate(phoneDigits);
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
          <Text style={styles.title}>Atualize seu telefone</Text>
          <Text style={styles.hint}>Seu número será usado para contato e notificações via WhatsApp.</Text>
        <Text style={styles.label}>Telefone</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={(text) => setPhone(formatPhone(text))}
          placeholder="(11) 995479867"
          placeholderTextColor={COLORS.neutral700}
          keyboardType="phone-pad"
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
