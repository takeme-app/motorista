import { useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Text } from '../../components/Text';
import { AnimatedBottomSheet } from '../../components/AnimatedBottomSheet';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { BRAZIL_STATES, fetchCitiesByState } from '../../data/brazilStates';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditLocation'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

type CityOption = { id: number; nome: string };

export function EditLocationScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [stateUf, setStateUf] = useState<string | null>(null);
  const [stateName, setStateName] = useState<string>('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [stateModalVisible, setStateModalVisible] = useState(false);
  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setInitialLoading(false);
      return;
    }
    const { data } = await supabase.from('profiles').select('city, state').eq('id', user.id).maybeSingle();
    const savedState = (data?.state ?? '').trim();
    const savedCity = (data?.city ?? '').trim();
    setCity(savedCity);
    if (savedState) {
      const upper = savedState.toUpperCase();
      const found =
        (savedState.length === 2 ? BRAZIL_STATES.find((s) => s.sigla === upper) : null) ??
        BRAZIL_STATES.find((s) => s.nome.toLowerCase() === savedState.toLowerCase());
      if (found) {
        setStateUf(found.sigla);
        setStateName(found.nome);
      } else {
        setStateUf(null);
        setStateName('');
      }
    } else {
      setStateUf(null);
      setStateName('');
    }
    setInitialLoading(false);
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const openCityModal = useCallback(async () => {
    if (!stateUf) {
      showAlert('Selecione o estado', 'Escolha o estado (UF) antes de selecionar a cidade.');
      return;
    }
    setCityModalVisible(true);
    setCitiesLoading(true);
    setCities([]);
    const list = await fetchCitiesByState(stateUf);
    setCities(list);
    setCitiesLoading(false);
  }, [stateUf]);

  const handleSelectState = (uf: string, nome: string) => {
    setStateUf(uf);
    setStateName(nome);
    setCity('');
    setStateModalVisible(false);
  };

  const handleSelectCity = (nome: string) => {
    setCity(nome);
    setCityModalVisible(false);
  };

  const handleUpdate = async () => {
    if (!stateUf) {
      showAlert('Campo obrigatório', 'Selecione o estado (UF).');
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
      .update({
        city: city.trim() || null,
        state: stateUf,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    setLoading(false);
    if (error) {
      showAlert('Erro', getUserErrorMessage(error, 'Não foi possível atualizar o endereço.'));
      return;
    }
    navigation.goBack();
  };

  const stateDisplay = stateName ? `${stateName} - ${stateUf}` : 'Selecione o estado (UF)';
  const cityDisplay = city || 'Selecione a cidade';

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
          <Text style={styles.title}>Editar localidade</Text>
          <Text style={styles.label}>Estado (UF)</Text>
        <TouchableOpacity
          style={styles.selectButton}
          onPress={() => setStateModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={stateUf ? styles.selectButtonText : styles.selectButtonPlaceholder}>
            {stateDisplay}
          </Text>
          <Text style={styles.selectChevron}>›</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Cidade</Text>
        <TouchableOpacity
          style={[styles.selectButton, !stateUf && styles.selectButtonDisabled]}
          onPress={openCityModal}
          disabled={!stateUf}
          activeOpacity={0.7}
        >
          <Text style={city ? styles.selectButtonText : styles.selectButtonPlaceholder}>
            {cityDisplay}
          </Text>
          <Text style={styles.selectChevron}>›</Text>
        </TouchableOpacity>

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

      <AnimatedBottomSheet visible={stateModalVisible} onClose={() => setStateModalVisible(false)}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Estado (UF)</Text>
          <TouchableOpacity onPress={() => setStateModalVisible(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fechar</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={BRAZIL_STATES}
          keyExtractor={(item) => item.sigla}
          style={styles.modalList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.modalItem}
              onPress={() => handleSelectState(item.sigla, item.nome)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalItemText}>{item.nome} - {item.sigla}</Text>
              {stateUf === item.sigla && <Text style={styles.modalItemCheck}>✓</Text>}
            </TouchableOpacity>
          )}
        />
      </AnimatedBottomSheet>

      <AnimatedBottomSheet visible={cityModalVisible} onClose={() => setCityModalVisible(false)}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Cidade</Text>
          <TouchableOpacity onPress={() => setCityModalVisible(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fechar</Text>
          </TouchableOpacity>
        </View>
        {citiesLoading ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator size="large" color={COLORS.black} />
            <Text style={styles.modalLoadingText}>Carregando cidades...</Text>
          </View>
        ) : (
          <FlatList
            data={cities}
            keyExtractor={(item) => String(item.id)}
            style={styles.modalList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.modalItem}
                onPress={() => handleSelectCity(item.nome)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalItemText}>{item.nome}</Text>
                {city === item.nome && <Text style={styles.modalItemCheck}>✓</Text>}
              </TouchableOpacity>
            )}
          />
        )}
      </AnimatedBottomSheet>
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
  label: { fontSize: 15, fontWeight: '500', color: COLORS.black, marginBottom: 8 },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  selectButtonDisabled: { opacity: 0.6 },
  selectButtonText: { fontSize: 16, color: COLORS.black },
  selectButtonPlaceholder: { fontSize: 16, color: COLORS.neutral700 },
  selectChevron: { fontSize: 20, color: COLORS.neutral700 },
  button: {
    backgroundColor: COLORS.black,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  modalList: {
    maxHeight: 350,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black },
  modalClose: { fontSize: 16, color: COLORS.black },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.neutral400,
  },
  modalItemText: { fontSize: 16, color: COLORS.black },
  modalItemCheck: { fontSize: 16, color: COLORS.black, fontWeight: '600' },
  modalLoading: {
    padding: 40,
    alignItems: 'center',
  },
  modalLoadingText: { marginTop: 12, fontSize: 15, color: COLORS.neutral700 },
});
