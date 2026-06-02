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

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditName'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

export function EditNameScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setInitialLoading(false);
        return;
      }
      const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      const full = (data?.full_name ?? '').trim();
      const parts = full.split(/\s+/);
      if (parts.length >= 2) {
        setLastName(parts.pop() ?? '');
        setFirstName(parts.join(' '));
      } else if (parts.length === 1) {
        setFirstName(parts[0] ?? '');
      }
      setInitialLoading(false);
    })();
  }, []);

  const handleUpdate = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const fullName = [first, last].filter(Boolean).join(' ');
    if (!fullName) {
      showAlert('Erro', 'Informe pelo menos o primeiro nome.');
      return;
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    setLoading(false);
    if (error) {
      showAlert('Erro', getUserErrorMessage(error, 'Não foi possível atualizar o nome.'));
      return;
    }
    navigation.goBack();
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
          <Text style={styles.title}>Atualize seu nome</Text>
          <Text style={styles.hint}>Esse nome será exibido para motoristas e parceiros nos serviços da plataforma.</Text>
        <Text style={styles.label}>Primeiro nome</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Ex: Ivan"
          placeholderTextColor={COLORS.neutral700}
          autoCapitalize="words"
        />
        <Text style={styles.label}>Último nome</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Ex: Porto"
          placeholderTextColor={COLORS.neutral700}
          autoCapitalize="words"
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
