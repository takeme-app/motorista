import { useState, useCallback, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DependentShipmentStackParamList } from '../../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useAppAlert } from '../../contexts/AppAlertContext';
import * as ImagePicker from 'expo-image-picker';
import { dependentShipmentTotalPassengers, maxBagsForTrip } from '../../lib/tripCapacityLimits';

type Props = NativeStackScreenProps<DependentShipmentStackParamList, 'DependentShipmentForm'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

type Dependent = { id: string; full_name: string; status: string };

function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

function applyPhoneMask(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 11);
  return formatPhoneDisplay(digits);
}

export function DependentShipmentFormScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [bagsCount, setBagsCount] = useState(1);
  /** Outras pessoas que embarcam no veículo com o dependente (titular não conta). */
  const [extraPassengers, setExtraPassengers] = useState(0);
  const [instructions, setInstructions] = useState('');
  const [dependentId, setDependentId] = useState<string | undefined>(undefined);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [loadingDependents, setLoadingDependents] = useState(true);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const totalPassengers = dependentShipmentTotalPassengers(extraPassengers);
  const maxBags = maxBagsForTrip(totalPassengers, null);

  useEffect(() => {
    setBagsCount((b) => Math.min(b, maxBags));
  }, [maxBags]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permissão', 'Precisamos de acesso à galeria para adicionar uma foto da encomenda.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const loadDependents = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadingDependents(false);
      return;
    }
    const { data } = await supabase
      .from('dependents')
      .select('id, full_name, status')
      .eq('user_id', user.id)
      .in('status', ['pending', 'validated'])
      .order('created_at', { ascending: false });
    setDependents(data ?? []);
    setLoadingDependents(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoadingDependents(true);
      loadDependents();
    }, [loadDependents])
  );

  const handleContactChange = (text: string) => setContactPhone(applyPhoneMask(text));

  const goToAddDependent = () => {
    navigation.navigate('AddDependent');
  };

  const selectDependent = (d: Dependent) => {
    setDependentId(d.id);
    setFullName(d.full_name);
  };

  const handleDefineTrip = () => {
    const name = fullName.trim();
    if (!name) {
      showAlert('Atenção', 'Informe o nome do dependente.');
      return;
    }
    const phoneDigits = contactPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      showAlert('Atenção', 'Preencha o contato com DDD e número (ex.: (00) 00000-0000).');
      return;
    }
    if (bagsCount > maxBags) {
      showAlert('Malas', `Acima do limite estimado (${maxBags} mala${maxBags === 1 ? '' : 's'}). Ao escolher o motorista, o limite real do bagageiro da viagem se aplica.`);
      return;
    }
    navigation.navigate('DefineDependentTrip', {
      fullName: name,
      contactPhone: phoneDigits,
      bagsCount,
      extraPassengers,
      instructions: instructions.trim() || undefined,
      dependentId,
      photoUri: photoUri ?? undefined,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navbarButton} onPress={() => navigation.getParent()?.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <View style={styles.navbarTitleWrap} pointerEvents="box-none">
          <Text style={styles.navbarTitle} numberOfLines={1}>Envio de dependentes</Text>
        </View>
      </View>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>Confirme os detalhes do envio para seu dependente</Text>

          <Text style={styles.label}>Nome completo</Text>
          <View style={styles.nameInputWrap}>
            <TextInput
              style={styles.nameInput}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Nome do dependente"
              placeholderTextColor={COLORS.neutral700}
            />
            <TouchableOpacity style={styles.linkButton} onPress={goToAddDependent} activeOpacity={0.8}>
              <Text style={styles.linkText}>Cadastrar contato</Text>
            </TouchableOpacity>
          </View>
          {!loadingDependents && dependents.length > 0 && (
            <View style={styles.dependentsRow}>
              {dependents.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.chip, dependentId === d.id && styles.chipSelected]}
                  onPress={() => selectDependent(d)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, dependentId === d.id && styles.chipTextSelected]} numberOfLines={1}>
                    {d.full_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>Contato</Text>
          <TextInput
            style={styles.input}
            value={contactPhone}
            onChangeText={handleContactChange}
            placeholder="(00) 00000-0000"
            placeholderTextColor={COLORS.neutral700}
            keyboardType="phone-pad"
          />

          <Text style={[styles.label, { marginTop: 8 }]}>Quem embarca na viagem</Text>
          <Text style={styles.passengersExplain}>
            Contamos apenas quem vai no veículo: o dependente e, se precisar, outras pessoas na mesma corrida com ele.
            Você (quem solicita o envio) não embarca: não ocupa lugar nem aparece aqui.
          </Text>
          <View style={styles.compactStepperRow}>
            <TouchableOpacity
              style={[styles.compactStepperBtn, extraPassengers <= 0 && styles.stepperBtnDisabled]}
              onPress={() => setExtraPassengers((n) => Math.max(0, n - 1))}
              disabled={extraPassengers <= 0}
              activeOpacity={0.7}
            >
              <MaterialIcons name="remove" size={22} color={extraPassengers <= 0 ? COLORS.neutral700 : COLORS.black} />
            </TouchableOpacity>
            <Text style={styles.compactStepperValue}>
              {extraPassengers === 0 ? 'Nenhum extra' : extraPassengers === 1 ? '1 acompanhante' : `${extraPassengers} acompanhantes`}
            </Text>
            <TouchableOpacity
              style={styles.compactStepperBtn}
              onPress={() => setExtraPassengers((n) => n + 1)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="add" size={22} color={COLORS.black} />
            </TouchableOpacity>
          </View>
          <Text style={styles.passengersMeta}>
            Total embarcado(s): {totalPassengers}{' '}
            {extraPassengers === 0
              ? '(apenas o dependente).'
              : `(dependente + ${extraPassengers} ${extraPassengers === 1 ? 'acompanhante' : 'acompanhantes'}).`}
          </Text>

          <View style={styles.separator}>
            <View style={styles.separatorLine} />
          </View>
          <Text style={styles.bagagensLabel}>Bagagens</Text>
          <View style={styles.stepperWrap}>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[styles.stepperBtn, bagsCount <= 0 && styles.stepperBtnDisabled]}
                onPress={() => setBagsCount((c) => Math.max(0, c - 1))}
                disabled={bagsCount <= 0}
                activeOpacity={0.7}
              >
                <MaterialIcons name="remove" size={24} color={bagsCount <= 0 ? COLORS.neutral700 : COLORS.black} />
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{bagsCount} {bagsCount === 1 ? 'mala' : 'malas'}</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, bagsCount >= maxBags && styles.stepperBtnDisabled]}
                onPress={() => setBagsCount((c) => Math.min(maxBags, c + 1))}
                disabled={bagsCount >= maxBags}
                activeOpacity={0.7}
              >
                <MaterialIcons name="add" size={24} color={bagsCount >= maxBags ? COLORS.neutral700 : COLORS.black} />
              </TouchableOpacity>
            </View>
            <Text style={styles.stepperHint}>
              Ao escolher o motorista, o limite real do bagageiro da viagem se aplica. Combine com o motorista no embarque se houver dúvida.
            </Text>
          </View>
          <View style={styles.separator}>
            <View style={styles.separatorLine} />
          </View>

          <View style={styles.optionalRow}>
            <Text style={styles.label}>Instruções para o entregador</Text>
            <Text style={styles.optional}>(Opcional)</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Ex: entregar direto ao portão de embarque."
            placeholderTextColor={COLORS.neutral700}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Foto da encomenda (opcional)</Text>
          <TouchableOpacity style={styles.photoBox} onPress={pickImage} activeOpacity={0.8}>
            {photoUri ? (
              <Text style={styles.photoPlaceholderText} numberOfLines={1}>Foto selecionada</Text>
            ) : (
              <>
                <MaterialIcons name="camera-alt" size={32} color={COLORS.neutral700} />
                <Text style={styles.photoPlaceholderText}>Toque para adicionar</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.primaryButton} onPress={handleDefineTrip} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Definir viagem</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  navbarTitleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navbarButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navbarTitle: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  keyboard: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 48 },
  separator: { paddingVertical: 40, marginHorizontal: -24 },
  separatorLine: { height: 1, backgroundColor: '#E2E2E2', width: '100%' },
  sectionTitle: { fontSize: 24, fontWeight: '600', color: COLORS.black, marginBottom: 20 },
  label: { fontSize: 15, fontWeight: '500', color: COLORS.black, marginBottom: 8 },
  bagagensLabel: { fontSize: 24, fontWeight: '600', color: COLORS.black, textAlign: 'center', marginBottom: 48 },
  optionalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  optional: { fontSize: 13, color: COLORS.neutral700 },
  nameInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  nameInput: {
    flex: 1,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 12,
    marginBottom: 0,
    fontSize: 16,
    color: COLORS.black,
    backgroundColor: 'transparent',
  },
  input: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.black,
    marginBottom: 20,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  linkButton: { paddingVertical: 4, paddingLeft: 8 },
  linkText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#0D0D0D',
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
  dependentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
  },
  chipSelected: { backgroundColor: COLORS.black },
  chipText: { fontSize: 14, color: COLORS.black },
  chipTextSelected: { color: '#FFF' },
  passengersExplain: { fontSize: 13, color: COLORS.neutral700, marginBottom: 12, lineHeight: 18 },
  compactStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  compactStepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactStepperValue: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: COLORS.black },
  passengersMeta: { fontSize: 13, color: COLORS.neutral700, marginBottom: 8 },
  stepperWrap: { marginBottom: 20 },
  stepperRow: {
    flexDirection: 'row',
    width: 358,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.5 },
  stepperValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#0D0D0D',
    textAlign: 'center',
  },
  stepperHint: { fontSize: 13, color: COLORS.neutral700, textAlign: 'center' },
  photoBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E2E2E2',
    borderRadius: 12,
    minHeight: 120,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 24,
  },
  photoPlaceholderText: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
