import { useState, useCallback, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
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

type Dependent = { id: string; full_name: string; status: string; contact_phone: string | null };

/** Máximo de fotos no carrossel (mesmo limite do fluxo de encomenda, p/ consistência). */
const MAX_DEPENDENT_PHOTOS = 8;

export function DependentShipmentFormScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [bagsCount, setBagsCount] = useState(1);
  const [instructions, setInstructions] = useState('');
  const [dependentId, setDependentId] = useState<string | undefined>(undefined);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [loadingDependents, setLoadingDependents] = useState(true);
  const [photoUris, setPhotoUris] = useState<string[]>([]);

  // Só o dependente embarca (sem passageiros extras nesta tela).
  const totalPassengers = dependentShipmentTotalPassengers(0);
  const maxBags = maxBagsForTrip(totalPassengers, null);
  const hasValidated = dependents.some((d) => d.status === 'validated');

  useEffect(() => {
    setBagsCount((b) => Math.min(b, maxBags));
  }, [maxBags]);

  const pickImages = async () => {
    const remaining = MAX_DEPENDENT_PHOTOS - photoUris.length;
    if (remaining <= 0) {
      showAlert('Fotos', `Máximo de ${MAX_DEPENDENT_PHOTOS} fotos.`);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permissão', 'Precisamos de acesso à galeria para adicionar fotos do dependente.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets?.length) {
      setPhotoUris((prev) =>
        [...prev, ...result.assets.map((a) => a.uri)].slice(0, MAX_DEPENDENT_PHOTOS),
      );
    }
  };

  const removePhotoAt = (index: number) => {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  };

  const loadDependents = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadingDependents(false);
      return;
    }
    const { data } = await supabase
      .from('dependents')
      .select('id, full_name, status, contact_phone')
      .eq('user_id', user.id)
      .in('status', ['pending', 'validated'])
      .order('created_at', { ascending: false });
    // contact_phone existe no banco, mas os tipos gerados podem estar defasados.
    setDependents((data ?? []) as unknown as Dependent[]);
    setLoadingDependents(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoadingDependents(true);
      loadDependents();
    }, [loadDependents])
  );

  const goToAddDependent = () => {
    navigation.navigate('AddDependent');
  };

  // Só dependentes validados pelo admin podem ser selecionados para o envio.
  const selectDependent = (d: Dependent) => {
    if (d.status !== 'validated') return;
    setDependentId(d.id);
  };

  const handleDefineTrip = () => {
    const selected = dependents.find((d) => d.id === dependentId);
    if (!selected || selected.status !== 'validated') {
      showAlert('Atenção', 'Selecione um dependente aprovado para o envio.');
      return;
    }
    if (bagsCount > maxBags) {
      showAlert('Malas', `Acima do limite estimado (${maxBags} mala${maxBags === 1 ? '' : 's'}). Ao escolher o motorista, o limite real do bagageiro da viagem se aplica.`);
      return;
    }
    navigation.navigate('DefineDependentTrip', {
      fullName: selected.full_name,
      contactPhone: (selected.contact_phone ?? '').replace(/\D/g, ''),
      bagsCount,
      extraPassengers: 0,
      instructions: instructions.trim() || undefined,
      dependentId: selected.id,
      ...(photoUris.length ? { photoUris } : {}),
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

          <View style={styles.depHeaderRow}>
            <Text style={styles.label}>Dependente</Text>
            <TouchableOpacity style={styles.linkButton} onPress={goToAddDependent} activeOpacity={0.8}>
              <Text style={styles.linkText}>Cadastrar contato</Text>
            </TouchableOpacity>
          </View>

          {!loadingDependents && dependents.length > 0 && (
            <View style={styles.dependentsRow}>
              {dependents.map((d) => {
                const selectable = d.status === 'validated';
                const selected = dependentId === d.id;
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.chip, selected && styles.chipSelected, !selectable && styles.chipPending]}
                    onPress={() => selectDependent(d)}
                    disabled={!selectable}
                    activeOpacity={0.7}
                  >
                    {!selectable && (
                      <MaterialIcons name="schedule" size={14} color={COLORS.neutral700} style={{ marginRight: 4 }} />
                    )}
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                        !selectable && styles.chipTextPending,
                      ]}
                      numberOfLines={1}
                    >
                      {d.full_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {!loadingDependents && dependents.some((d) => d.status !== 'validated') && (
            <Text style={styles.pendingHint}>
              Dependentes em cinza aguardam validação do admin e ainda não podem ser enviados.
            </Text>
          )}

          {!loadingDependents && !hasValidated && (
            <Text style={styles.noValidatedNotice}>
              Você precisa de um dependente aprovado para enviar. Toque em "Cadastrar contato" e aguarde a validação do admin.
            </Text>
          )}

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

          <Text style={styles.label}>Fotos do dependente (opcional, até {MAX_DEPENDENT_PHOTOS})</Text>
          {photoUris.length === 0 ? (
            <TouchableOpacity style={styles.photoBox} onPress={pickImages} activeOpacity={0.8}>
              <MaterialIcons name="camera-alt" size={32} color={COLORS.neutral700} />
              <Text style={styles.photoPlaceholderText}>Toque para adicionar uma ou mais fotos</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.photoGallery}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoGalleryRow}
                keyboardShouldPersistTaps="handled"
              >
                {photoUris.map((uri, idx) => (
                  <View key={`${uri}-${idx}`} style={styles.photoThumbWrap}>
                    <Image source={{ uri }} style={styles.photoThumbSmall} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.photoThumbRemove}
                      onPress={() => removePhotoAt(idx)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Remover foto"
                    >
                      <MaterialIcons name="close" size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
                {photoUris.length < MAX_DEPENDENT_PHOTOS ? (
                  <TouchableOpacity style={styles.photoAddTile} onPress={pickImages} activeOpacity={0.85}>
                    <MaterialIcons name="add-a-photo" size={28} color={COLORS.neutral700} />
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
              <Text style={styles.photoHint}>Toque em + para incluir mais · ✕ remove a foto</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, !dependentId && styles.primaryButtonDisabled]}
            onPress={handleDefineTrip}
            disabled={!dependentId}
            activeOpacity={0.8}
          >
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
  depHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dependentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
  },
  chipSelected: { backgroundColor: COLORS.black },
  chipPending: { opacity: 0.55 },
  chipText: { fontSize: 14, color: COLORS.black },
  chipTextSelected: { color: '#FFF' },
  chipTextPending: { color: COLORS.neutral700 },
  pendingHint: { fontSize: 12, color: COLORS.neutral700, marginBottom: 8, lineHeight: 16 },
  noValidatedNotice: { fontSize: 13, color: '#B91C1C', marginBottom: 8, lineHeight: 18 },
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
    width: '100%',
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
  photoGallery: { marginBottom: 24 },
  photoGalleryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  photoThumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 10,
  },
  photoThumbSmall: { width: '100%', height: '100%', backgroundColor: COLORS.neutral300 },
  photoThumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddTile: {
    width: 88,
    height: 88,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E2E2E2',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.neutral300,
  },
  photoHint: { fontSize: 12, color: COLORS.neutral700, marginTop: 10 },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
