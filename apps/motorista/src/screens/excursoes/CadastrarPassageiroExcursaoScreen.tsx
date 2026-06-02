import { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from '../../navigation/ColetasExcursoesStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';

type Props = NativeStackScreenProps<ColetasExcursoesStackParamList, 'CadastrarPassageiroExcursao'>;

export function CadastrarPassageiroExcursaoScreen({ navigation, route }: Props) {
  const { excursionId } = route.params;
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);

  const onUploadDoc = useCallback(() => {
    Alert.alert(
      'Documento',
      'O envio de RG/CNH será ligado ao armazenamento em uma próxima versão. Por agora, cadastre os dados abaixo.',
    );
  }, []);

  const onUploadPhoto = useCallback(() => {
    Alert.alert('Foto', 'Upload de foto opcional em breve.');
  }, []);

  const onSave = useCallback(async () => {
    const name = fullName.trim();
    if (!name) {
      Alert.alert('Atenção', 'Informe o nome completo.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('excursion_passengers').insert({
      excursion_request_id: excursionId,
      full_name: name,
      cpf: cpf.trim() || null,
      age: age.trim() || null,
      gender: gender.trim() || null,
      observations: observations.trim() || null,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível cadastrar o passageiro.');
      return;
    }
    navigation.goBack();
  }, [excursionId, fullName, cpf, age, gender, observations, navigation]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="height"
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="close" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Cadastrar passageiro</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field label="Nome completo" placeholder="Digite o nome do dependente" value={fullName} onChangeText={setFullName} />
          <Field label="CPF" placeholder="Ex: 123.456.789-99" value={cpf} onChangeText={setCpf} keyboardType="numbers-and-punctuation" />
          <Field label="Idade" placeholder="Ex: 25 anos" value={age} onChangeText={setAge} />
          <Field label="Sexo" placeholder="Ex: Masculino" value={gender} onChangeText={setGender} />

          <Text style={styles.uploadLabel}>Documento de identificação</Text>
          <TouchableOpacity style={styles.uploadBox} onPress={onUploadDoc} activeOpacity={0.85}>
            <View style={styles.uploadIconWrap}>
              <MaterialIcons name="cloud-upload" size={22} color="#5C4A2E" />
            </View>
            <Text style={styles.uploadTitle}>Upload frente e verso</Text>
            <Text style={styles.uploadHint}>Aceitamos RG, CNH ou documento de identificação válido.</Text>
          </TouchableOpacity>

          <View style={styles.rowLabel}>
            <Text style={styles.uploadLabel}>Foto do passageiro</Text>
            <Text style={styles.optional}>Opcional</Text>
          </View>
          <TouchableOpacity style={styles.uploadBox} onPress={onUploadPhoto} activeOpacity={0.85}>
            <View style={styles.uploadIconWrap}>
              <MaterialIcons name="photo-camera" size={22} color="#5C4A2E" />
            </View>
            <Text style={styles.uploadTitle}>Clique pra fazer o upload</Text>
          </TouchableOpacity>

          <View style={styles.rowLabel}>
            <Text style={styles.uploadLabel}>Observações</Text>
            <Text style={styles.optional}>Opcional</Text>
          </View>
          <TextInput
            style={styles.textArea}
            placeholder="Alguma observação sobre o passageiro."
            placeholderTextColor="#9CA3AF"
            value={observations}
            onChangeText={setObservations}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btnPrimary, saving && { opacity: 0.65 }]}
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.88}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Finalizar cadastro</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={styles.btnSecondaryText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'numbers-and-punctuation';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#111827' },
  headerSpacer: { width: 40 },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 8 },
  input: {
    backgroundColor: '#F2F2F2',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#111827',
  },
  uploadLabel: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 10 },
  rowLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 8,
  },
  optional: { fontSize: 13, color: '#9CA3AF' },
  uploadBox: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  uploadIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5F0E6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  uploadTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 },
  uploadHint: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  textArea: {
    backgroundColor: '#F2F2F2',
    borderRadius: 12,
    minHeight: 100,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    marginBottom: 16,
  },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  btnPrimary: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  btnSecondary: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#EFEFEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { fontSize: 16, fontWeight: '700', color: '#B24A44' },
});
