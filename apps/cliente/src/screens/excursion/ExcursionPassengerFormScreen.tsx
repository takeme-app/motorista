import { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { supabase } from '../../lib/supabase';
import { formatCpf, onlyDigits, validateCpf } from '../../utils/formatCpf';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ExcursionPassengerForm'>;

/** Formata até 11 dígitos como telefone: (00) 00000-0000 ou (00) 0000-0000 */
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

/** Opções de sexo (mesmo modelo do ambiente preparador de excursão). */
const GENDER_OPTIONS = ['Masculino', 'Feminino', 'Outro'] as const;

export function ExcursionPassengerFormScreen({ navigation, route }: Props) {
  const { showAlert } = useAppAlert();
  const excursionRequestId = route.params?.excursionRequestId ?? '';
  const passengerId = route.params?.passengerId;
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [observations, setObservations] = useState('');
  const [loading, setLoading] = useState(!!passengerId);
  const [saving, setSaving] = useState(false);
  // Documento (RG/CNH) e foto do passageiro — upload p/ bucket privado
  // `excursion-passenger-docs` (path começa com auth.uid()). *Uri = preview
  // local da imagem recém-escolhida; *Path = caminho salvo no storage.
  const [documentUri, setDocumentUri] = useState<string | null>(null);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'doc' | 'photo' | null>(null);

  useEffect(() => {
    if (!passengerId) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('excursion_passengers')
        .select('full_name, cpf, phone, age, gender, observations, document_url, photo_url')
        .eq('id', passengerId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      const row = data as { full_name: string; cpf: string | null; phone: string | null; age: string | null; gender: string | null; observations: string | null; document_url: string | null; photo_url: string | null };
      setFullName(row.full_name ?? '');
      setCpf(row.cpf ? formatCpf(onlyDigits(row.cpf)) : '');
      setPhone(row.phone ? formatPhone(row.phone.replace(/\D/g, '')) : '');
      setAge(row.age ?? '');
      setGender(row.gender ?? '');
      setObservations(row.observations ?? '');
      setDocumentPath(row.document_url ?? null);
      setPhotoPath(row.photo_url ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [passengerId]);

  const pickAndUpload = async (kind: 'doc' | 'photo') => {
    if (!excursionRequestId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      showAlert('Permissão', 'Precisamos de acesso à galeria para enviar a imagem.');
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
      showAlert('Sessão', 'Faça login novamente.');
      return;
    }
    let bytes: Uint8Array;
    try {
      const binary = atob(asset.base64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      showAlert('Erro', 'Não foi possível processar a imagem. Tente novamente.');
      return;
    }
    // Path DEVE começar com auth.uid() (RLS do bucket excursion-passenger-docs).
    const path = `${user.id}/${excursionRequestId}/${kind}_${Date.now()}.jpg`;
    setUploading(kind);
    const { error } = await supabase.storage
      .from('excursion-passenger-docs')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    setUploading(null);
    if (error) {
      showAlert('Erro', 'Não foi possível enviar a imagem. Tente novamente.');
      return;
    }
    if (kind === 'doc') {
      setDocumentPath(path);
      setDocumentUri(asset.uri);
    } else {
      setPhotoPath(path);
      setPhotoUri(asset.uri);
    }
  };

  const handleSave = async () => {
    const name = fullName.trim();
    if (!name) {
      showAlert('Atenção', 'Informe o nome do passageiro.');
      return;
    }
    const cpfDigits = onlyDigits(cpf);
    if (cpfDigits && !validateCpf(cpfDigits)) {
      showAlert('CPF inválido', 'O CPF informado não é válido. Verifique e tente novamente.');
      return;
    }
    if (!excursionRequestId) return;
    setSaving(true);
    const payload = {
      full_name: name,
      cpf: cpf.trim() || null,
      phone: phone.trim() || null,
      age: age.trim() || null,
      gender: gender.trim() || null,
      observations: observations.trim() || null,
      document_url: documentPath,
      photo_url: photoPath,
    };
    if (passengerId) {
      const { error } = await supabase
        .from('excursion_passengers')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', passengerId);
      setSaving(false);
      if (error) {
        showAlert('Erro', 'Não foi possível salvar.');
        return;
      }
      showAlert('Salvo', 'Passageiro atualizado.', { onClose: () => navigation.goBack() });
    } else {
      const { error } = await supabase
        .from('excursion_passengers')
        .insert({
          excursion_request_id: excursionRequestId,
          full_name: name,
          cpf: payload.cpf,
          phone: payload.phone,
          age: payload.age,
          gender: payload.gender,
          observations: payload.observations,
          document_url: payload.document_url,
          photo_url: payload.photo_url,
        });
      setSaving(false);
      if (error) {
        showAlert('Erro', 'Não foi possível cadastrar o passageiro.');
        return;
      }
      showAlert('Salvo', 'Passageiro adicionado.', { onClose: () => navigation.goBack() });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Cadastro do passageiro</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cadastro do passageiro</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Nome completo</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Digite o nome do dependente"
            placeholderTextColor={COLORS.neutral700}
          />
          <Text style={styles.label}>CPF</Text>
          <TextInput
            style={styles.input}
            value={cpf}
            onChangeText={(t) => setCpf(formatCpf(t))}
            placeholder="Ex: 123.456.789-99"
            placeholderTextColor={COLORS.neutral700}
            keyboardType="number-pad"
            maxLength={14}
          />
          <Text style={styles.label}>Telefone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t))}
            placeholder="Ex: (11) 99999-8888"
            placeholderTextColor={COLORS.neutral700}
            keyboardType="phone-pad"
            maxLength={16}
          />
          <Text style={styles.label}>Idade</Text>
          <TextInput
            style={styles.input}
            value={age}
            onChangeText={setAge}
            placeholder="Ex: 25 anos"
            placeholderTextColor={COLORS.neutral700}
          />
          <Text style={styles.label}>Sexo</Text>
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
            ) : documentPath ? (
              <>
                <View style={styles.uploadIconWrap}>
                  <MaterialIcons name="check-circle" size={22} color="#15803d" />
                </View>
                <Text style={styles.uploadTitle}>Documento enviado</Text>
                <Text style={styles.uploadHint}>Toque para trocar.</Text>
              </>
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
            ) : photoPath ? (
              <>
                <View style={styles.uploadIconWrap}>
                  <MaterialIcons name="check-circle" size={22} color="#15803d" />
                </View>
                <Text style={styles.uploadTitle}>Foto enviada</Text>
                <Text style={styles.uploadHint}>Toque para trocar.</Text>
              </>
            ) : (
              <>
                <View style={styles.uploadIconWrap}>
                  <MaterialIcons name="photo-camera" size={22} color="#5C4A2E" />
                </View>
                <Text style={styles.uploadTitle}>Clique pra fazer o upload</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.label}>Observações (opcional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={observations}
            onChangeText={setObservations}
            placeholder="Digite algo aqui."
            placeholderTextColor={COLORS.neutral700}
            multiline
          />

          <TouchableOpacity style={styles.primaryButton} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Salvar passageiro</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()} disabled={saving}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  closeButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 48 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.black,
    marginBottom: 16,
  },
  genderRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  genderChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.neutral300,
  },
  genderChipOn: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  genderChipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  genderChipTextOn: { color: '#FFFFFF' },
  uploadLabel: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 10 },
  rowLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 8,
  },
  optional: { fontSize: 13, color: COLORS.neutral700 },
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
    marginBottom: 16,
    overflow: 'hidden',
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
  uploadTitle: { fontSize: 15, fontWeight: '600', color: COLORS.black, marginBottom: 4 },
  uploadHint: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  uploadPreview: { width: '100%', height: 160, borderRadius: 10 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  cancelButton: { paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: '#DC2626' },
});
