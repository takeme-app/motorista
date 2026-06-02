import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
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
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../../lib/supabase';
import { tryOpenSupportTicket } from '../../lib/supportTickets';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AddDependent'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

const BUCKET_DOCS = 'dependent-documents';

type PickedFile = { uri: string; name: string; mimeType: string };

function getExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '.pdf';
}

function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

function applyPhoneMask(text: string): string {
  return formatPhoneDisplay(text.replace(/\D/g, '').slice(0, 11));
}

export function AddDependentScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [age, setAge] = useState('');
  const [observations, setObservations] = useState('');
  const [documentFile, setDocumentFile] = useState<PickedFile | null>(null);
  const [representativeFile, setRepresentativeFile] = useState<PickedFile | null>(null);
  const [saving, setSaving] = useState(false);

  const pickDocument = async (which: 'dependent' | 'representative') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = 'assets' in result && result.assets?.[0]
        ? result.assets[0]
        : { uri: (result as { uri: string; name: string; mimeType?: string }).uri, name: (result as { name: string }).name, mimeType: (result as { mimeType?: string }).mimeType };
      const file: PickedFile = {
        uri: asset.uri,
        name: asset.name ?? 'documento',
        mimeType: asset.mimeType ?? 'application/pdf',
      };
      if (which === 'dependent') setDocumentFile(file);
      else setRepresentativeFile(file);
    } catch (e) {
      showAlert('Erro', getUserErrorMessage(e, 'Não foi possível abrir o seletor de arquivos.'));
    }
  };

  const uploadFile = async (uri: string, path: string, mimeType: string): Promise<boolean> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const { error } = await supabase.storage.from(BUCKET_DOCS).upload(path, blob, {
      contentType: mimeType || 'application/octet-stream',
      upsert: true,
    });
    return !error;
  };

  const handleSubmit = async () => {
    const name = fullName.trim();
    if (!name) {
      showAlert('Erro', 'Informe o nome completo do dependente.');
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      showAlert('Erro', 'Sessão expirada.');
      return;
    }

    const phoneDigits = contactPhone.replace(/\D/g, '');
    const { data: inserted, error: insertError } = await supabase
      .from('dependents')
      .insert({
        user_id: user.id,
        full_name: name,
        contact_phone: phoneDigits || null,
        age: age.trim() || null,
        observations: observations.trim() || null,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) {
      setSaving(false);
      showAlert('Erro', getUserErrorMessage(insertError, 'Não foi possível cadastrar o dependente.'));
      return;
    }

    const dependentId = inserted.id;
    const prefix = `${user.id}/${dependentId}`;
    let documentUrl: string | null = null;
    let representativeDocumentUrl: string | null = null;

    if (documentFile) {
      const ext = getExtension(documentFile.name);
      const path = `${prefix}/documento_dependente${ext}`;
      const ok = await uploadFile(documentFile.uri, path, documentFile.mimeType);
      if (ok) documentUrl = path;
    }
    if (representativeFile) {
      const ext = getExtension(representativeFile.name);
      const path = `${prefix}/documento_responsavel${ext}`;
      const ok = await uploadFile(representativeFile.uri, path, representativeFile.mimeType);
      if (ok) representativeDocumentUrl = path;
    }

    if (documentUrl !== null || representativeDocumentUrl !== null) {
      await supabase
        .from('dependents')
        .update({
          document_url: documentUrl,
          representative_document_url: representativeDocumentUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dependentId);
    }

    setSaving(false);
    void tryOpenSupportTicket('autorizar_menores', { dependent_id: dependentId });
    navigation.navigate('DependentSuccess');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navbarButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.navbarTitle} numberOfLines={1}>Cadastro de dependente</Text>
      </View>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Nome completo</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Digite o nome do dependente"
            placeholderTextColor={COLORS.neutral700}
          />
          <Text style={styles.label}>Telefone de contato</Text>
          <TextInput
            style={styles.input}
            value={contactPhone}
            onChangeText={(t) => setContactPhone(applyPhoneMask(t))}
            placeholder="(00) 00000-0000"
            placeholderTextColor={COLORS.neutral700}
            keyboardType="phone-pad"
          />
          <Text style={styles.label}>Idade</Text>
          <TextInput
            style={styles.input}
            value={age}
            onChangeText={setAge}
            placeholder="Ex: 25 anos"
            placeholderTextColor={COLORS.neutral700}
            keyboardType="number-pad"
          />
          <View style={styles.optionalRow}>
            <Text style={styles.label}>Documento do dependente</Text>
            <Text style={styles.optional}>Opcional</Text>
          </View>
          <TouchableOpacity
            style={styles.uploadArea}
            onPress={() => pickDocument('dependent')}
            activeOpacity={0.7}
          >
            <MaterialIcons name="description" size={32} color={COLORS.neutral700} />
            <Text style={styles.uploadText} numberOfLines={1}>
              {documentFile ? documentFile.name : 'Enviar documento do dependente (PDF ou imagem)'}
            </Text>
            {documentFile && (
              <TouchableOpacity
                style={styles.removeFile}
                onPress={() => setDocumentFile(null)}
                hitSlop={8}
              >
                <Text style={styles.removeFileText}>Remover</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          <View style={styles.optionalRow}>
            <Text style={styles.label}>Documento do responsável</Text>
            <Text style={styles.optional}>Opcional</Text>
          </View>
          <TouchableOpacity
            style={styles.uploadArea}
            onPress={() => pickDocument('representative')}
            activeOpacity={0.7}
          >
            <MaterialIcons name="person" size={32} color={COLORS.neutral700} />
            <Text style={styles.uploadText} numberOfLines={1}>
              {representativeFile ? representativeFile.name : 'Enviar documento do responsável (PDF ou imagem)'}
            </Text>
            {representativeFile && (
              <TouchableOpacity
                style={styles.removeFile}
                onPress={() => setRepresentativeFile(null)}
                hitSlop={8}
              >
                <Text style={styles.removeFileText}>Remover</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          <View style={styles.optionalRow}>
            <Text style={styles.label}>Observações</Text>
            <Text style={styles.optional}>Opcional</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={observations}
            onChangeText={setObservations}
            placeholder="Inclua informações adicionais sobre o dependente."
            placeholderTextColor={COLORS.neutral700}
            multiline
            numberOfLines={4}
          />
          <TouchableOpacity
            style={[styles.submitButton, saving && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitButtonText}>Finalizar cadastro</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  navbarButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navbarTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.black, textAlign: 'center' },
  keyboard: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 },
  label: { fontSize: 15, fontWeight: '500', color: COLORS.black, marginBottom: 8 },
  optionalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  optional: { fontSize: 13, color: COLORS.neutral700 },
  input: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.black,
    marginBottom: 20,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  uploadArea: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  uploadText: { fontSize: 14, color: COLORS.neutral700, marginTop: 8, paddingHorizontal: 8 },
  removeFile: { marginTop: 8 },
  removeFileText: { fontSize: 13, color: COLORS.neutral700, textDecorationLine: 'underline' },
  submitButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  buttonDisabled: { opacity: 0.7 },
  submitButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  cancelButton: { alignItems: 'center', paddingVertical: 12 },
  cancelButtonText: { fontSize: 15, color: '#DC2626', fontWeight: '500' },
});
