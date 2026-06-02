import { useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { resolveVehiclePhotoUri } from '../utils/storageUrl';
import { uploadToStorage } from '../utils/uploadToStorage';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';

type Props = NativeStackScreenProps<ProfileStackParamList, 'VehicleForm'>;

type UseType = 'principal' | 'reserva';

type FormState = {
  model: string;
  year: string;
  renavam: string;
  plate: string;
  passengerCapacity: string;
  useType: UseType;
  docUri: string | null;
  docName: string | null;
  photoUris: string[];
};

const EMPTY_FORM: FormState = {
  model: '',
  year: '',
  renavam: '',
  plate: '',
  passengerCapacity: '',
  useType: 'principal',
  docUri: null,
  docName: null,
  photoUris: [],
};

const MAX_PHOTOS = 4;
const GOLD = '#C9A227';

export function VehicleFormScreen({ navigation, route }: Props) {
  const { vehicleId } = route.params ?? {};
  const scrollBottom = useBottomSafeInset({ extra: 24 });
  const isEdit = Boolean(vehicleId);
  const { showAlert } = useAppAlert();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [existingDocUrl, setExistingDocUrl] = useState<string | null>(null);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);
  const [existingPhotoDisplayUris, setExistingPhotoDisplayUris] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        existingPhotoUrls.map(async (storageRef) => {
          const uri = await resolveVehiclePhotoUri(storageRef);
          if (uri) next[storageRef] = uri;
        }),
      );
      if (!cancelled) setExistingPhotoDisplayUris(next);
    })();
    return () => { cancelled = true; };
  }, [JSON.stringify(existingPhotoUrls)]);

  useFocusEffect(
    useCallback(() => {
      if (!isEdit || !vehicleId) return;
      let mounted = true;
      setLoading(true);
      supabase
        .from('vehicles')
        .select('model, plate, year, passenger_capacity, renavam, use_type, vehicle_document_url, vehicle_photos_urls')
        .eq('id', vehicleId)
        .maybeSingle()
        .then(({ data }) => {
          if (!mounted || !data) return;
          const d = data as {
            model: string;
            plate: string;
            year: number;
            passenger_capacity: number;
            renavam: string | null;
            use_type: string | null;
            vehicle_document_url: string | null;
            vehicle_photos_urls: string[] | null;
          };
          setExistingDocUrl(d.vehicle_document_url ?? null);
          setExistingPhotoUrls(d.vehicle_photos_urls ?? []);
          setForm({
            model: d.model ?? '',
            year: d.year ? String(d.year) : '',
            renavam: d.renavam ?? '',
            plate: d.plate ?? '',
            passengerCapacity: d.passenger_capacity ? String(d.passenger_capacity) : '',
            useType: (d.use_type ?? 'principal') as UseType,
            docUri: null,
            docName: null,
            photoUris: [],
          });
          setLoading(false);
        });
      return () => { mounted = false; };
    }, [isEdit, vehicleId]),
  );

  const pickDoc = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setForm((f) => ({ ...f, docUri: asset.uri, docName: asset.name ?? 'documento.pdf' }));
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const pickPhotos = async () => {
    const currentCount = form.photoUris.length + existingPhotoUrls.length;
    if (currentCount >= MAX_PHOTOS) {
      showAlert('Fotos', `Máximo de ${MAX_PHOTOS} fotos permitidas.`);
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        showAlert('Permissão', 'Precisamos de acesso à galeria.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS - currentCount,
        quality: 0.85,
      });
      if (result.canceled) return;
      const uris = result.assets.map((a) => a.uri);
      setForm((f) => ({
        ...f,
        photoUris: [...f.photoUris, ...uris].slice(0, MAX_PHOTOS - existingPhotoUrls.length),
      }));
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const removeNewPhoto = (uri: string) => {
    setForm((f) => ({ ...f, photoUris: f.photoUris.filter((u) => u !== uri) }));
  };

  const removeExistingPhoto = (url: string) => {
    setExistingPhotoUrls((prev) => prev.filter((u) => u !== url));
  };

  const uploadFile = async (_userId: string, uri: string, path: string, contentType: string): Promise<string> => {
    return uploadToStorage('vehicles', path, uri, contentType);
  };

  const handleSave = async () => {
    if (!form.model.trim()) { showAlert('Atenção', 'Informe o modelo do veículo.'); return; }
    const yearNum = parseInt(form.year, 10);
    if (!yearNum || yearNum < 1950 || yearNum > new Date().getFullYear() + 1) {
      showAlert('Atenção', 'Informe um ano válido.'); return;
    }
    if (!form.plate.trim()) { showAlert('Atenção', 'Informe a placa.'); return; }
    const capNum = parseInt(form.passengerCapacity, 10);
    if (!capNum || capNum < 1 || capNum > 5) {
      showAlert('Atenção', 'Capacidade deve ser entre 1 e 5.'); return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Usuário não autenticado.');

      let docUrl: string | null = existingDocUrl;
      if (form.docUri) {
        const ext = form.docName?.split('.').pop() ?? 'pdf';
        const contentType = ext === 'pdf' ? 'application/pdf' : 'image/jpeg';
        docUrl = await uploadFile(
          user.id,
          form.docUri,
          `${user.id}/${vehicleId ?? 'new'}/document.${ext}`,
          contentType,
        );
      }

      let photoUrls: string[] = [...existingPhotoUrls];
      for (let i = 0; i < form.photoUris.length; i++) {
        const idx = existingPhotoUrls.length + i;
        const url = await uploadFile(
          user.id,
          form.photoUris[i],
          `${user.id}/${vehicleId ?? 'new'}/photo_${idx}.jpg`,
          'image/jpeg',
        );
        photoUrls.push(url);
      }

      const payload = {
        worker_id: user.id,
        model: form.model.trim(),
        year: yearNum,
        renavam: form.renavam.trim() || null,
        plate: form.plate.trim().toUpperCase(),
        passenger_capacity: capNum,
        use_type: form.useType,
        vehicle_document_url: docUrl,
        vehicle_photos_urls: photoUrls.length > 0 ? photoUrls : null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      };

      if (isEdit && vehicleId) {
        const { error } = await supabase.from('vehicles').update(payload).eq('id', vehicleId);
        if (error) throw error;
        navigation.navigate('WorkerVehicles', { successMessage: 'Veículo atualizado com sucesso' });
      } else {
        const { error } = await supabase.from('vehicles').insert({ ...payload, is_active: true });
        if (error) throw error;
        navigation.navigate('WorkerVehicles', { successMessage: 'Veículo cadastrado com sucesso' });
      }
    } catch (e: unknown) {
      const supaErr = e as { message?: string; details?: string; hint?: string } | null;
      const detail = [supaErr?.message, supaErr?.details, supaErr?.hint].filter(Boolean).join(' — ');
      console.error('[VehicleForm] save error:', detail || e);
      showAlert('Erro', detail || getUserErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      </SafeAreaView>
    );
  }

  const allPhotos = [...existingPhotoUrls, ...form.photoUris];
  const canAddMore = allPhotos.length < MAX_PHOTOS;
  const docLabel = form.docName ?? (existingDocUrl ? existingDocUrl.split('/').pop() : null);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Editar informações do veículo' : 'Adicionar novo veículo'}</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Modelo */}
          <Text style={styles.label}>Modelo</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Honda Civic"
            placeholderTextColor="#9CA3AF"
            value={form.model}
            onChangeText={(v) => setForm((f) => ({ ...f, model: v }))}
          />

          {/* Ano */}
          <Text style={styles.label}>Ano do veículo</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: 2020"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            maxLength={4}
            value={form.year}
            onChangeText={(v) => setForm((f) => ({ ...f, year: v.replace(/\D/g, '') }))}
          />

          {/* Renavam */}
          <Text style={styles.label}>Renavam</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: 1234567890-X"
            placeholderTextColor="#9CA3AF"
            value={form.renavam}
            onChangeText={(v) => setForm((f) => ({ ...f, renavam: v }))}
          />

          {/* Placa */}
          <Text style={styles.label}>Placa</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: SAP-4494"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="characters"
            value={form.plate}
            onChangeText={(v) => setForm((f) => ({ ...f, plate: v }))}
          />

          {/* Capacidade */}
          <Text style={styles.label}>Capacidade de passageiros (máx. 5)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: 4"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            maxLength={1}
            value={form.passengerCapacity}
            onChangeText={(v) => setForm((f) => ({ ...f, passengerCapacity: v.replace(/\D/g, '') }))}
          />

          {/* Tipo de uso */}
          <Text style={styles.label}>Definir tipo de uso do veículo</Text>
          <TouchableOpacity
            style={styles.radioRow}
            onPress={() => setForm((f) => ({ ...f, useType: 'principal' }))}
            activeOpacity={0.7}
          >
            <View style={[styles.radioOuter, form.useType === 'principal' && styles.radioOuterActive]}>
              {form.useType === 'principal' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.radioTextWrap}>
              <Text style={styles.radioLabel}>Principal</Text>
              <Text style={styles.radioSub}>Veículo principal utilizado nas corridas.</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.radioRow}
            onPress={() => setForm((f) => ({ ...f, useType: 'reserva' }))}
            activeOpacity={0.7}
          >
            <View style={[styles.radioOuter, form.useType === 'reserva' && styles.radioOuterActive]}>
              {form.useType === 'reserva' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.radioTextWrap}>
              <Text style={styles.radioLabel}>Reserva</Text>
              <Text style={styles.radioSub}>Usado apenas quando o principal estiver indisponível.</Text>
            </View>
          </TouchableOpacity>

          {/* Documento */}
          <Text style={styles.label}>Documento do veículo</Text>
          {docLabel ? (
            <View style={styles.docRow}>
              <MaterialIcons name="insert-drive-file" size={22} color="#9CA3AF" />
              <Text style={styles.docName} numberOfLines={1}>{docLabel}</Text>
              <TouchableOpacity onPress={pickDoc} hitSlop={8}>
                <MaterialIcons name="edit" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.uploadArea} onPress={pickDoc} activeOpacity={0.7}>
              <View style={styles.uploadIconCircle}>
                <MaterialIcons name="cloud-upload" size={28} color={GOLD} />
              </View>
              <Text style={styles.uploadLabel}>Clique pra fazer o upload</Text>
            </TouchableOpacity>
          )}

          {/* Fotos */}
          <Text style={styles.label}>Fotos do veículo</Text>
          <Text style={styles.subLabel}>Máx. {MAX_PHOTOS} fotos, 20MB</Text>

          {allPhotos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosScroll}>
              {existingPhotoUrls.map((url, i) => (
                <View key={`existing-${i}`} style={styles.photoThumbWrap}>
                  <Image
                    source={{ uri: existingPhotoDisplayUris[url] ?? undefined }}
                    style={styles.photoThumb}
                    resizeMode="cover"
                  />
                  <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removeExistingPhoto(url)}>
                    <Text style={styles.removePhotoText}>Remover foto</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {form.photoUris.map((uri, i) => (
                <View key={`new-${i}`} style={styles.photoThumbWrap}>
                  <Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
                  <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removeNewPhoto(uri)}>
                    <Text style={styles.removePhotoText}>Remover foto</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {canAddMore && (
                <TouchableOpacity style={[styles.photoThumbWrap, styles.addPhotoCell]} onPress={pickPhotos} activeOpacity={0.7}>
                  <MaterialIcons name="add" size={32} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </ScrollView>
          ) : (
            <TouchableOpacity style={styles.uploadArea} onPress={pickPhotos} activeOpacity={0.7}>
              <View style={styles.uploadIconCircle}>
                <MaterialIcons name="cloud-upload" size={28} color={GOLD} />
              </View>
              <Text style={styles.uploadLabel}>Clique para fazer upload (múltiplas fotos)</Text>
            </TouchableOpacity>
          )}

          {/* Botões */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Salvar veículo</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => navigation.goBack()}
            disabled={saving}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>{isEdit ? 'Voltar sem salvar' : 'Cancelar'}</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#111827', marginTop: 20, marginBottom: 8 },
  subLabel: { fontSize: 12, color: '#6B7280', marginTop: -6, marginBottom: 10 },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#111827',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioOuterActive: { borderColor: '#111827' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#111827' },
  radioTextWrap: { flex: 1 },
  radioLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  radioSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  docName: { flex: 1, fontSize: 14, color: '#374151' },
  uploadArea: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  uploadIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEF9C3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadLabel: { fontSize: 14, color: '#9CA3AF' },
  photosScroll: { marginTop: 4 },
  photoThumbWrap: { marginRight: 12, alignItems: 'center' },
  photoThumb: { width: 140, height: 120, borderRadius: 10, backgroundColor: '#F3F4F6' },
  removePhotoBtn: { marginTop: 6 },
  removePhotoText: { fontSize: 13, color: '#374151', textDecorationLine: 'underline' },
  addPhotoCell: {
    width: 140,
    height: 120,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  cancelBtnText: { color: '#EF4444', fontSize: 15, fontWeight: '600' },
});
