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
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from '../../navigation/ColetasExcursoesStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { formatCpf, onlyDigits, validateCpf } from '../../utils/formatCpf';

type Props = NativeStackScreenProps<ColetasExcursoesStackParamList, 'CadastrarPassageiroExcursao'>;

const GENDER_OPTIONS = ['Masculino', 'Feminino', 'Outro'] as const;

export function CadastrarPassageiroExcursaoScreen({ navigation, route }: Props) {
  const { excursionId } = route.params;
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);
  // Documento (RG/CNH) e foto — upload p/ bucket privado `excursion-passenger-docs`
  // (path começa com auth.uid() do preparador — RLS). *Uri = preview local; *Path = caminho salvo.
  const [documentUri, setDocumentUri] = useState<string | null>(null);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'doc' | 'photo' | null>(null);

  const pickAndUpload = useCallback(async (kind: 'doc' | 'photo') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permissão', 'Precisamos de acesso à galeria para enviar a imagem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      Alert.alert('Sessão', 'Faça login novamente.');
      return;
    }
    let bytes: Uint8Array;
    try {
      const binary = atob(asset.base64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      Alert.alert('Erro', 'Não foi possível processar a imagem. Tente novamente.');
      return;
    }
    // Path DEVE começar com auth.uid() (RLS do bucket excursion-passenger-docs).
    const path = `${user.id}/${excursionId}/${kind}_${Date.now()}.jpg`;
    setUploading(kind);
    const { error } = await supabase.storage
      .from('excursion-passenger-docs')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    setUploading(null);
    if (error) {
      Alert.alert('Erro', 'Não foi possível enviar a imagem. Tente novamente.');
      return;
    }
    if (kind === 'doc') {
      setDocumentPath(path);
      setDocumentUri(asset.uri);
    } else {
      setPhotoPath(path);
      setPhotoUri(asset.uri);
    }
  }, [excursionId]);

  const onSave = useCallback(async () => {
    const name = fullName.trim();
    if (!name) {
      Alert.alert('Atenção', 'Informe o nome completo.');
      return;
    }
    const cpfDigits = onlyDigits(cpf);
    if (cpfDigits && !validateCpf(cpfDigits)) {
      Alert.alert('CPF inválido', 'Verifique o CPF informado (11 dígitos válidos).');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('excursion_passengers').insert({
      excursion_request_id: excursionId,
      full_name: name,
      cpf: cpfDigits ? formatCpf(cpf) : null,
      age: age.trim() || null,
      gender: gender || null,
      observations: observations.trim() || null,
      document_url: documentPath,
      photo_url: photoPath,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível cadastrar o passageiro.');
      return;
    }
    navigation.goBack();
  }, [excursionId, fullName, cpf, age, gender, observations, documentPath, photoPath, navigation]);

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
          <Field label="Nome completo" placeholder="Digite o nome do passageiro" value={fullName} onChangeText={setFullName} />
          <Field
            label="CPF"
            placeholder="000.000.000-00"
            value={cpf}
            onChangeText={(t) => setCpf(formatCpf(t))}
            keyboardType="number-pad"
            maxLength={14}
          />
          <Field
            label="Idade"
            placeholder="Ex: 25"
            value={age}
            onChangeText={(t) => setAge(onlyDigits(t).slice(0, 3))}
            keyboardType="number-pad"
            maxLength={3}
          />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Sexo</Text>
            <View style={styles.genderRow}>
              {GENDER_OPTIONS.map((opt) => {
                const sel = gender === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.genderChip, sel && styles.genderChipOn]}
                    onPress={() => setGender(opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.genderChipText, sel && styles.genderChipTextOn]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Text style={styles.uploadLabel}>Documento de identificação</Text>
          <TouchableOpacity
            style={styles.uploadBox}
            onPress={() => pickAndUpload('doc')}
            disabled={uploading !== null}
            activeOpacity={0.85}
          >
            {uploading === 'doc' ? (
              <ActivityIndicator color="#5C4A2E" />
            ) : documentUri ? (
              <Image source={{ uri: documentUri }} style={styles.uploadPreview} resizeMode="cover" />
            ) : (
              <>
                <View style={styles.uploadIconWrap}>
                  <MaterialIcons name="cloud-upload" size={22} color="#5C4A2E" />
                </View>
                <Text style={styles.uploadTitle}>Upload frente e verso</Text>
                <Text style={styles.uploadHint}>Aceitamos RG, CNH ou documento de identificação válido.</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.rowLabel}>
            <Text style={styles.uploadLabel}>Foto do passageiro</Text>
            <Text style={styles.optional}>Opcional</Text>
          </View>
          <TouchableOpacity
            style={styles.uploadBox}
            onPress={() => pickAndUpload('photo')}
            disabled={uploading !== null}
            activeOpacity={0.85}
          >
            {uploading === 'photo' ? (
              <ActivityIndicator color="#5C4A2E" />
            ) : photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.uploadPreview} resizeMode="cover" />
            ) : (
              <>
                <View style={styles.uploadIconWrap}>
                  <MaterialIcons name="photo-camera" size={22} color="#5C4A2E" />
                </View>
                <Text style={styles.uploadTitle}>Clique pra fazer o upload</Text>
              </>
            )}
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
  maxLength,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'numbers-and-punctuation' | 'number-pad';
  maxLength?: number;
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
        maxLength={maxLength}
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
  genderRow: { flexDirection: 'row', gap: 10 },
  genderChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F2F2F2',
  },
  genderChipOn: { backgroundColor: '#111827', borderColor: '#111827' },
  genderChipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  genderChipTextOn: { color: '#FFFFFF' },
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
    minHeight: 130,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    overflow: 'hidden',
  },
  uploadPreview: { width: '100%', height: 160, borderRadius: 10 },
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
