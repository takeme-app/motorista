import { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from '../../navigation/ColetasExcursoesStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { useBottomSafeInset } from '@take-me/shared';
import * as ImagePicker from 'expo-image-picker';

type Props = NativeStackScreenProps<ColetasExcursoesStackParamList, 'JustificarAusenciaExcursao'>;

const ATTACHMENT_BUCKET = 'excursion-passenger-docs';

type JustifyState = { reason: string; attachmentUri?: string; attachmentPath?: string };

function initial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : '?';
}

function metaLine(gender: string | null, age: string | null): string {
  return `${gender?.trim() || '—'} • ${age?.trim() || '—'}`;
}

export function JustificarAusenciaExcursaoScreen({ navigation, route }: Props) {
  const bottomInset = useBottomSafeInset({ extra: 24 });
  const { excursionId, passengers, totalAmountCents } = route.params;
  const phase: 'ida' | 'volta' = route.params.phase ?? 'ida';
  const isVolta = phase === 'volta';

  const [byId, setById] = useState<Record<string, JustifyState>>(() =>
    Object.fromEntries(passengers.map((p) => [p.id, { reason: '' }])),
  );
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setReason = useCallback((id: string, reason: string) => {
    setById((prev) => ({ ...prev, [id]: { ...prev[id], reason } }));
  }, []);

  const pickAttachment = useCallback(
    async (passengerId: string) => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permissão', 'Precisamos de acesso à galeria para anexar o comprovante.');
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
      const path = `${user.id}/${excursionId}/${passengerId}/absence_${phase}_${Date.now()}.jpg`;
      setUploadingId(passengerId);
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      setUploadingId(null);
      if (error) {
        Alert.alert('Erro', 'Não foi possível enviar o anexo. Tente novamente.');
        return;
      }
      setById((prev) => ({ ...prev, [passengerId]: { ...prev[passengerId], attachmentUri: asset.uri, attachmentPath: path } }));
    },
    [excursionId, phase],
  );

  const onConfirm = useCallback(async () => {
    // 1) Descrição obrigatória para todos.
    const missing = passengers.filter((p) => !byId[p.id]?.reason.trim());
    if (missing.length > 0) {
      Alert.alert(
        'Descrição obrigatória',
        `Informe o motivo da ausência de: ${missing.map((p) => p.full_name).join(', ')}.`,
      );
      return;
    }
    setSaving(true);
    // 2) Grava por passageiro.
    for (const p of passengers) {
      const st = byId[p.id];
      const { error } = await supabase
        .from('excursion_passengers')
        .update({
          absence_justified: true,
          absence_reason: st.reason.trim(),
          absence_attachment_url: st.attachmentPath ?? null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', p.id);
      if (error) {
        setSaving(false);
        Alert.alert('Erro', 'Não foi possível salvar as justificativas. Tente novamente.');
        return;
      }
    }
    // 3) Re-consulta para recomputar contagem e decidir finalização.
    const { data } = await supabase
      .from('excursion_passengers')
      .select('id, status_departure, status_return, absence_justified')
      .eq('excursion_request_id', excursionId);
    const rows = (data ?? []) as any[];
    const list = isVolta
      ? rows.filter((r) => r.status_departure === 'embarked' || r.status_departure === 'disembarked')
      : rows;
    const statusOf = (r: any) => (isVolta ? r.status_return : r.status_departure) ?? 'not_embarked';
    const stillPending = list.filter((r) => statusOf(r) === 'not_embarked' && !r.absence_justified);
    if (stillPending.length > 0) {
      setSaving(false);
      Alert.alert(
        'Ausentes pendentes',
        'Ainda há passageiros não embarcados sem justificativa. Volte e justifique todos os ausentes ou use "Finalizar mesmo assim".',
        [{ text: 'Voltar', onPress: () => navigation.goBack() }],
      );
      return;
    }
    // 4) Finaliza a fase e segue para a tela de conclusão.
    const boarded = list.filter((r) => statusOf(r) === 'embarked').length;
    const justified = list.filter((r) => statusOf(r) === 'not_embarked' && r.absence_justified).length;
    const totalExcursion = list.length;
    const doneCol = isVolta ? 'boarding_volta_done_at' : 'boarding_ida_done_at';
    await supabase
      .from('excursion_requests')
      .update({ [doneCol]: new Date().toISOString() } as never)
      .eq('id', excursionId);
    setSaving(false);
    navigation.navigate('EmbarqueConcluido', {
      excursionId,
      boarded,
      justified,
      totalExcursion,
      totalAmountCents,
      phase,
    });
  }, [passengers, byId, excursionId, isVolta, totalAmountCents, phase, navigation]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Justificar ausência</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Descreva o motivo da ausência de cada passageiro e, se quiser, anexe um comprovante (ex.: atestado).
        </Text>
        {passengers.map((p) => {
          const st = byId[p.id] ?? { reason: '' };
          const busy = uploadingId === p.id;
          return (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial(p.full_name)}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{p.full_name}</Text>
                  <Text style={styles.meta}>{metaLine(p.gender, p.age)}</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Motivo da ausência</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Descreva por que este passageiro não embarcou."
                placeholderTextColor="#9CA3AF"
                value={st.reason}
                onChangeText={(t) => setReason(p.id, t)}
                multiline
                textAlignVertical="top"
              />

              <View style={styles.rowLabel}>
                <Text style={styles.fieldLabel}>Comprovante</Text>
                <Text style={styles.optional}>Opcional</Text>
              </View>
              <TouchableOpacity
                style={styles.uploadBox}
                onPress={() => pickAttachment(p.id)}
                disabled={uploadingId !== null}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color="#5C4A2E" />
                ) : st.attachmentUri ? (
                  <Image source={{ uri: st.attachmentUri }} style={styles.uploadPreview} resizeMode="cover" />
                ) : (
                  <>
                    <View style={styles.uploadIconWrap}>
                      <MaterialIcons name="cloud-upload" size={22} color="#5C4A2E" />
                    </View>
                    <Text style={styles.uploadTitle}>Anexar comprovante</Text>
                    <Text style={styles.uploadHint}>Toque para escolher uma imagem da galeria.</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <TouchableOpacity
          style={[styles.btnBlack, (saving || uploadingId !== null) && { opacity: 0.65 }]}
          onPress={onConfirm}
          disabled={saving || uploadingId !== null}
          activeOpacity={0.88}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.btnBlackText}>Confirmar justificativas</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827', flex: 1, textAlign: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  hint: { fontSize: 13, color: '#6B7280', lineHeight: 18, marginBottom: 16 },
  card: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#4B5563' },
  rowBody: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: '#111827' },
  meta: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 8 },
  textArea: {
    backgroundColor: '#F2F2F2',
    borderRadius: 12,
    minHeight: 88,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    marginBottom: 14,
  },
  rowLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  optional: { fontSize: 13, color: '#9CA3AF' },
  uploadBox: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 14,
    minHeight: 120,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
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
  uploadTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 },
  uploadHint: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  uploadPreview: { width: '100%', height: 150, borderRadius: 10 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  btnBlack: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBlackText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
