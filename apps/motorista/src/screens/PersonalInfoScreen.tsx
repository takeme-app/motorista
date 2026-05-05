import { useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { formatCpf } from '../utils/formatCpf';
import { formatPhoneBR } from '../utils/formatPhone';
import { splitFullName, joinFullName } from '../utils/splitFullName';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { storageUrl } from '../utils/storageUrl';
import { avatarStorageObjectPath, uploadImageFromUriToPublicBucket } from '../utils/uploadToStorage';
import type { ProfileRow, WorkerProfilePersonalRow } from '../types/dbRows';
import { PersonalInfoFieldRow } from '../components/profile/PersonalInfoFieldRow';
import { SingleFieldModal } from '../components/profile/SingleFieldModal';
import { NameFieldsModal } from '../components/profile/NameFieldsModal';
import { CityStateModal } from '../components/profile/CityStateModal';
import { EditPhotoModal } from '../components/profile/EditPhotoModal';

type Props = NativeStackScreenProps<ProfileStackParamList, 'PersonalInfo'>;

const GOLD = '#C9A227';

type ModalKey = 'name' | 'age' | 'email' | 'phone' | 'city' | 'experience' | null;

type RowState = {
  userId: string;
  email: string | null;
  fullName: string;
  phoneDigits: string;
  avatarUrl: string | null;
  profileCpf: string | null;
  profileCity: string | null;
  profileState: string | null;
  workerCity: string | null;
  age: number | null;
  experienceYears: number | null;
  cnhFront: string | null;
  cnhBack: string | null;
  backgroundUrl: string | null;
  workerCpf: string | null;
};

function cityDisplay(s: RowState): string {
  const c = (s.profileCity ?? s.workerCity ?? '').trim();
  const st = (s.profileState ?? '').trim();
  if (c && st) return `${c}, ${st}`;
  if (c) return c;
  if (st) return st;
  return '—';
}

function mergedCpf(s: RowState): string {
  const w = s.workerCpf?.replace(/\D/g, '') ?? '';
  const p = s.profileCpf?.replace(/\D/g, '') ?? '';
  return w || p;
}

export function PersonalInfoScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<RowState | null>(null);
  const [modal, setModal] = useState<ModalKey>(null);
  const [photoSheet, setPhotoSheet] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setRow(null);
      setLoading(false);
      return;
    }

    const { data: profRaw } = await supabase
      .from('profiles')
      .select('full_name, phone, avatar_url, cpf, city, state')
      .eq('id', user.id)
      .maybeSingle();
    const prof = profRaw as ProfileRow | null;

    const { data: wrRaw } = await supabase
      .from('worker_profiles')
      .select(
        'cpf, age, experience_years, city, cnh_document_url, cnh_document_back_url, background_check_url'
      )
      .eq('id', user.id)
      .maybeSingle();
    const wr = wrRaw as WorkerProfilePersonalRow | null;

    const metaName =
      (user.user_metadata?.full_name as string)?.trim() ||
      (user.user_metadata?.name as string)?.trim() ||
      '';

    setRow({
      userId: user.id,
      email: user.email ?? null,
      fullName: prof?.full_name?.trim() || metaName || (user.email ? user.email.split('@')[0] : ''),
      phoneDigits: (prof?.phone ?? '').replace(/\D/g, ''),
      avatarUrl: prof?.avatar_url ?? null,
      profileCpf: prof?.cpf ?? null,
      profileCity: prof?.city ?? null,
      profileState: prof?.state ?? null,
      workerCity: wr?.city ?? null,
      age: wr?.age ?? null,
      experienceYears: wr?.experience_years ?? null,
      cnhFront: wr?.cnh_document_url ?? null,
      cnhBack: wr?.cnh_document_back_url ?? null,
      backgroundUrl: wr?.background_check_url ?? null,
      workerCpf: wr?.cpf ?? null,
    });
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onSaveError = (e: unknown) => {
    showAlert('Erro', getUserErrorMessage(e));
  };

  const onAvatarError = (e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e);
    showAlert('Erro ao trocar foto', raw || getUserErrorMessage(e));
  };

  const uploadAvatarFromUri = async (uri: string, pickerMimeType?: string | null) => {
    if (!row) return;
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user?.id) {
      throw new Error('Sessão inválida. Faça login de novo e tente outra vez.');
    }
    const path = avatarStorageObjectPath(authData.user.id);

    let urlWithBuster: string;
    try {
      urlWithBuster = await uploadImageFromUriToPublicBucket('avatars', path, uri, {
        pickerMimeType: pickerMimeType ?? null,
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.warn('[avatar][upload-storage]', raw);
      throw new Error(`Falha ao enviar a foto para o storage: ${raw}`);
    }

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: urlWithBuster, updated_at: new Date().toISOString() } as never)
      .eq('id', row.userId);
    if (error) {
      console.warn('[avatar][update-profile]', error.message ?? String(error));
      throw new Error(`Falha ao atualizar o perfil: ${error.message ?? 'erro desconhecido'}`);
    }
    await load();
  };

  const pickImage = async (fromCamera: boolean) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        showAlert('Permissão', 'Precisamos de acesso à câmera ou galeria.');
        return;
      }
      const launch = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await launch({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const a = result.assets[0];
      await uploadAvatarFromUri(a.uri, a.mimeType ?? null);
    } catch (e: unknown) {
      onAvatarError(e);
    }
  };

  const removeAvatar = async () => {
    if (!row) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user?.id) return;
      await supabase.storage.from('avatars').remove([avatarStorageObjectPath(u.user.id)]);
    } catch {
      /* arquivo pode não existir */
    }
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: null, updated_at: new Date().toISOString() } as never)
      .eq('id', row.userId);
    if (error) throw error;
    await load();
  };

  if (loading || !row) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      </SafeAreaView>
    );
  }

  const cpfDigits = mergedCpf(row);
  const cpfOk = cpfDigits.length === 11;
  const cnhOk = Boolean(row.cnhFront?.trim() && row.cnhBack?.trim());
  const bgOk = Boolean(row.backgroundUrl?.trim());

  const { first: firstName, last: lastName } = splitFullName(row.fullName);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.closeX}>×</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Informações pessoais</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarWrap}>
          {row.avatarUrl ? (
            <Image source={{ uri: storageUrl('avatars', row.avatarUrl) ?? undefined }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPh}>
              <MaterialIcons name="person" size={44} color="#9CA3AF" />
            </View>
          )}
          <TouchableOpacity style={styles.editFab} onPress={() => setPhotoSheet(true)} activeOpacity={0.85}>
            <MaterialIcons name="edit" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <PersonalInfoFieldRow label="Nome" value={row.fullName || '—'} onPress={() => setModal('name')} />
        <View style={styles.sep} />
        <PersonalInfoFieldRow
          label="Idade"
          value={row.age != null ? `${row.age} anos` : '—'}
          onPress={() => setModal('age')}
        />
        <View style={styles.sep} />
        <PersonalInfoFieldRow
          label="CPF (frente e verso)"
          value={cpfOk ? formatCpf(cpfDigits) : '—'}
          verified={cpfOk}
        />
        <View style={styles.sep} />
        <PersonalInfoFieldRow label="Cidade" value={cityDisplay(row)} onPress={() => setModal('city')} />
        <View style={styles.sep} />
        <PersonalInfoFieldRow
          label="Anos de experiência"
          value={row.experienceYears != null ? `${row.experienceYears} anos` : '—'}
          onPress={() => setModal('experience')}
        />
        <View style={styles.sep} />
        <PersonalInfoFieldRow
          label="CNH (frente e verso)"
          value={cnhOk ? 'Documentos enviados' : 'Pendente'}
          verified={cnhOk}
        />
        <View style={styles.sep} />
        <PersonalInfoFieldRow
          label="Antecedentes Criminais"
          value={bgOk ? 'Verificado' : 'Pendente'}
          verified={bgOk}
        />
        <View style={styles.sep} />
        <PersonalInfoFieldRow label="Email" value={row.email ?? '—'} onPress={() => setModal('email')} />
        <View style={styles.sep} />
        <PersonalInfoFieldRow
          label="Telefone"
          value={row.phoneDigits ? formatPhoneBR(row.phoneDigits) : '—'}
          onPress={() => setModal('phone')}
        />
      </ScrollView>

      <NameFieldsModal
        visible={modal === 'name'}
        onClose={() => setModal(null)}
        initialFirst={firstName}
        initialLast={lastName}
        onSave={async (f, l) => {
          try {
            const full = joinFullName(f, l);
            const { error: e1 } = await supabase.auth.updateUser({ data: { full_name: full } });
            if (e1) throw e1;
            const { error: e2 } = await supabase
              .from('profiles')
              .update({ full_name: full, updated_at: new Date().toISOString() } as never)
              .eq('id', row.userId);
            if (e2) throw e2;
            await load();
          } catch (e: unknown) {
            onSaveError(e);
            throw e;
          }
        }}
      />

      <SingleFieldModal
        visible={modal === 'age'}
        onClose={() => setModal(null)}
        title="Atualize sua idade"
        subtitle="Informe sua idade real. Ela é usada para manter seu cadastro atualizado."
        label="Idade"
        initialValue={row.age != null ? String(row.age) : ''}
        placeholder="Ex: 34"
        keyboardType="numeric"
        digitsOnly
        onSave={async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 18 || n > 100) {
            showAlert('Idade', 'Informe uma idade válida (18 a 100).');
            throw new Error('validation');
          }
          try {
            const { error } = await supabase
              .from('worker_profiles')
              .update({ age: n, updated_at: new Date().toISOString() } as never)
              .eq('id', row.userId);
            if (error) throw error;
            await load();
          } catch (e: unknown) {
            onSaveError(e);
            throw e;
          }
        }}
      />

      <SingleFieldModal
        visible={modal === 'experience'}
        onClose={() => setModal(null)}
        title="Atualize seus anos de experiência"
        subtitle="Indique há quantos anos você dirige profissionalmente. Essas informações são usadas para validar seu perfil."
        label="Anos de experiência"
        initialValue={row.experienceYears != null ? String(row.experienceYears) : ''}
        placeholder="Ex: 5"
        keyboardType="numeric"
        digitsOnly
        onSave={async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 0 || n > 80) {
            showAlert('Experiência', 'Informe um valor entre 0 e 80.');
            throw new Error('validation');
          }
          try {
            const { error } = await supabase
              .from('worker_profiles')
              .update({ experience_years: n, updated_at: new Date().toISOString() } as never)
              .eq('id', row.userId);
            if (error) throw error;
            await load();
          } catch (e: unknown) {
            onSaveError(e);
            throw e;
          }
        }}
      />

      <SingleFieldModal
        visible={modal === 'email'}
        onClose={() => setModal(null)}
        title="Atualize seu e-mail"
        subtitle="Use um e-mail válido. Ele será utilizado para notificações e recuperação de conta."
        label="Email"
        initialValue={row.email ?? ''}
        placeholder="seu@email.com"
        keyboardType="email-address"
        onSave={async (v) => {
          try {
            const { error } = await supabase.auth.updateUser({ email: v });
            if (error) throw error;
            showAlert('E-mail', 'Se necessário, confirme o novo e-mail pelo link enviado.');
            await load();
          } catch (e: unknown) {
            onSaveError(e);
            throw e;
          }
        }}
      />

      <SingleFieldModal
        visible={modal === 'phone'}
        onClose={() => setModal(null)}
        title="Atualize seu número de telefone"
        subtitle="Seu número será usado para contato e notificações via WhatsApp."
        label="Telefone"
        initialValue={row.phoneDigits}
        placeholder="(11) 995479867"
        keyboardType="phone-pad"
        digitsOnly
        formatDisplay={formatPhoneBR}
        onSave={async (v) => {
          try {
            const { error } = await supabase
              .from('profiles')
              .update({ phone: v || null, updated_at: new Date().toISOString() } as never)
              .eq('id', row.userId);
            if (error) throw error;
            await load();
          } catch (e: unknown) {
            onSaveError(e);
            throw e;
          }
        }}
      />

      <CityStateModal
        visible={modal === 'city'}
        onClose={() => setModal(null)}
        initialCity={row.profileCity ?? row.workerCity ?? ''}
        initialState={row.profileState ?? ''}
        onSave={async (city, uf) => {
          try {
            const { error: e1 } = await supabase
              .from('profiles')
              .update({
                city: city || null,
                state: uf || null,
                updated_at: new Date().toISOString(),
              } as never)
              .eq('id', row.userId);
            if (e1) throw e1;
            const { error: e2 } = await supabase
              .from('worker_profiles')
              .update({ city: city || null, updated_at: new Date().toISOString() } as never)
              .eq('id', row.userId);
            if (e2) throw e2;
            await load();
          } catch (e: unknown) {
            onSaveError(e);
            throw e;
          }
        }}
      />

      <EditPhotoModal
        visible={photoSheet}
        onClose={() => setPhotoSheet(false)}
        hasPhoto={Boolean(row.avatarUrl)}
        onTakePhoto={() => void pickImage(true)}
        onChoosePhoto={() => void pickImage(false)}
        onRemove={() => void removeAvatar().catch(onSaveError)}
      />
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
    paddingBottom: 16,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: { fontSize: 24, color: '#111827', fontWeight: '300', marginTop: -2 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  avatarWrap: { alignSelf: 'center', marginBottom: 28, position: 'relative' },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#F3F4F6' },
  avatarPh: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editFab: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  sep: { height: 1, backgroundColor: '#E5E7EB' },
});
