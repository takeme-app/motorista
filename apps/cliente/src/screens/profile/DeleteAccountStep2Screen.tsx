import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { clearRecentDestinationsStorage } from '../../lib/recentDestinations';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';
import { useRootNavigation } from '../../navigation/RootNavigationContext';

type Props = NativeStackScreenProps<ProfileStackParamList, 'DeleteAccountStep2'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
  danger: '#DC2626',
};

const CONFIRM_TEXT = 'EXCLUIR';

export function DeleteAccountStep2Screen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const { resetToSplash } = useRootNavigation();
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const doSignOutAndRedirect = () => {
    clearRecentDestinationsStorage().catch(() => {});
    supabase.auth.signOut().catch(() => {});
    resetToSplash();
  };

  const redirectToLoginWithConfirmation = () => {
    showAlert('Conta excluída', 'Sua conta foi excluída com sucesso.', {
      onClose: doSignOutAndRedirect,
    });
  };

  const checkUserGoneAndRedirect = async (): Promise<boolean> => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        redirectToLoginWithConfirmation();
        return true;
      }
    } catch {
      redirectToLoginWithConfirmation();
      return true;
    }
    return false;
  };

  const handleDelete = async () => {
    if (confirm.trim() !== CONFIRM_TEXT) {
      showAlert('Confirmação', `Digite ${CONFIRM_TEXT} para confirmar a exclusão.`);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { confirm: CONFIRM_TEXT },
      });
      if (error) {
        const gone = await checkUserGoneAndRedirect();
        if (!gone) showAlert('Erro', getUserErrorMessage(error, 'Não foi possível excluir a conta. Tente novamente.'));
        return;
      }
      if (data?.error) {
        const gone = await checkUserGoneAndRedirect();
        if (!gone) {
          const backendMsg = typeof data.error === 'string' ? data.error : '';
          showAlert('Erro', getUserErrorMessage({ message: data.error }, backendMsg || 'Não foi possível excluir a conta. Tente novamente.'));
        }
        return;
      }
      if (!data?.ok) {
        const gone = await checkUserGoneAndRedirect();
        if (!gone) showAlert('Erro', 'Não foi possível excluir a conta. Tente novamente.');
        return;
      }
      redirectToLoginWithConfirmation();
    } catch (e) {
      const gone = await checkUserGoneAndRedirect();
      if (!gone) showAlert('Erro', getUserErrorMessage(e, 'A requisição demorou ou falhou. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

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
          <Text style={styles.title}>Confirmar exclusão</Text>
          <Text style={styles.hint}>
            Para excluir sua conta permanentemente, digite <Text style={styles.hintBold}>{CONFIRM_TEXT}</Text> abaixo.
          </Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder={CONFIRM_TEXT}
            placeholderTextColor={COLORS.neutral700}
            autoCapitalize="characters"
            editable={!loading}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.goBack()} disabled={loading} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Voltar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.destructiveButton, loading && styles.buttonDisabled]}
            onPress={handleDelete}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? <ActivityIndicator color={COLORS.danger} /> : <Text style={styles.destructiveButtonText}>Excluir minha conta</Text>}
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
  title: { fontSize: 20, fontWeight: '700', color: COLORS.black, marginBottom: 16 },
  hint: { fontSize: 15, color: COLORS.neutral700, marginBottom: 12 },
  hintBold: { fontWeight: '700', color: COLORS.black },
  input: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.black,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  destructiveButton: {
    backgroundColor: COLORS.neutral300,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  destructiveButtonText: { fontSize: 16, fontWeight: '600', color: COLORS.danger },
});
