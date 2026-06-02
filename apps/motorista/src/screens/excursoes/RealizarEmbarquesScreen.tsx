import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from '../../navigation/ColetasExcursoesStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import * as ImagePicker from 'expo-image-picker';

type Props = NativeStackScreenProps<ColetasExcursoesStackParamList, 'RealizarEmbarques'>;

const BOARDING_PHOTO_BUCKET = 'excursion-passenger-docs';

type Passenger = {
  id: string;
  full_name: string;
  age: string | null;
  gender: string | null;
  status_departure: string;
  status_return: string;
  absence_justified: boolean;
};

const GOLD_MUTED = '#B8953D';

function initial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : '?';
}

function metaLine(p: Passenger): string {
  const g = p.gender?.trim() || '—';
  const a = p.age?.trim() || '—';
  return `${g} • ${a}`;
}

export function RealizarEmbarquesScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset({ extra: 24 });
  const { excursionId } = route.params;
  const phase: 'ida' | 'volta' = route.params.phase ?? 'ida';
  const isVolta = phase === 'volta';
  const statusCol = isVolta ? 'status_return' : 'status_departure';
  const photoCol = isVolta ? 'photo_url_return' : 'photo_url';
  const statusOf = useCallback(
    (p: Passenger) => (isVolta ? p.status_return : p.status_departure),
    [isVolta],
  );
  const [loading, setLoading] = useState(true);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'none' | 'pending' | 'justify'>('none');
  const [justifySelected, setJustifySelected] = useState<Set<string>>(new Set());
  const [savingJustify, setSavingJustify] = useState(false);
  const [uploadingPassengerId, setUploadingPassengerId] = useState<string | null>(null);
  const [totalAmountCents, setTotalAmountCents] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: psgData, error: psgErr } = await supabase
      .from('excursion_passengers')
      .select('id, full_name, age, gender, status_departure, status_return, absence_justified')
      .eq('excursion_request_id', excursionId)
      .order('full_name');
    if (psgErr) {
      console.warn('[RealizarEmbarques]', psgErr.message);
    }
    const rows = (psgData ?? []) as any[];
    const mapped: Passenger[] = rows.map((r) => ({
      id: r.id,
      full_name: r.full_name ?? '',
      age: r.age ?? null,
      gender: r.gender ?? null,
      status_departure: r.status_departure ?? 'not_embarked',
      status_return: r.status_return ?? 'not_embarked',
      absence_justified: Boolean(r.absence_justified),
    }));
    // Na volta, só entram as pessoas que embarcaram na ida (as mesmas pessoas).
    setPassengers(
      isVolta
        ? mapped.filter((p) => p.status_departure === 'embarked' || p.status_departure === 'disembarked')
        : mapped,
    );
    setLoading(false);
  }, [excursionId, isVolta]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('excursion_requests')
        .select('status, total_amount_cents, check_in_ida_started_at, check_in_volta_started_at')
        .eq('id', excursionId)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as any;
      setTotalAmountCents(row.total_amount_cents ?? null);
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {};
      if (isVolta) {
        // Abrir o embarque de volta marca o início do check-in de volta (notifica o cliente).
        if (!row.check_in_volta_started_at) patch.check_in_volta_started_at = now;
      } else {
        // Embarque de ida: a viagem entra em andamento e marca o início do check-in de ida.
        if (row.status === 'approved' || row.status === 'scheduled') patch.status = 'in_progress';
        if (!row.check_in_ida_started_at) patch.check_in_ida_started_at = now;
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from('excursion_requests').update(patch as never).eq('id', excursionId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [excursionId, isVolta]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return passengers;
    return passengers.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [passengers, search]);

  const boardedCount = useMemo(
    () => passengers.filter((p) => statusOf(p) === 'embarked').length,
    [passengers, statusOf],
  );

  const totalForBar = Math.max(passengers.length, 1);
  const progressPct = Math.min(100, Math.round((boardedCount / totalForBar) * 100));

  const notEmbarkedUnjustified = useMemo(
    () => passengers.filter((p) => statusOf(p) === 'not_embarked' && !p.absence_justified),
    [passengers, statusOf],
  );

  const navigateSuccess = useCallback(
    (list: Passenger[]) => {
      const boarded = list.filter((p) => statusOf(p) === 'embarked').length;
      const justified = list.filter((p) => statusOf(p) === 'not_embarked' && p.absence_justified).length;
      const totalExcursion = list.length;
      navigation.navigate('EmbarqueConcluido', {
        excursionId,
        boarded,
        justified,
        totalExcursion,
        totalAmountCents,
        phase,
      });
    },
    [excursionId, navigation, totalAmountCents, statusOf, phase],
  );

  const tryFinalize = useCallback(() => {
    if (notEmbarkedUnjustified.length > 0) {
      setModal('pending');
      return;
    }
    navigateSuccess(passengers);
  }, [notEmbarkedUnjustified.length, navigateSuccess, passengers]);

  const embarkOrUndo = useCallback(
    async (p: Passenger) => {
      if (statusOf(p) === 'embarked') {
        const { error } = await supabase
          .from('excursion_passengers')
          .update({
            [statusCol]: 'not_embarked',
            [photoCol]: null,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', p.id);
        if (error) {
          Alert.alert('Erro', 'Não foi possível desmarcar o embarque.');
          void loadAll();
          return;
        }
        setPassengers((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, [statusCol]: 'not_embarked' } : x)),
        );
        return;
      }

      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Câmera', 'Conceda acesso à câmera para registrar o embarque com foto.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.75,
        base64: true,
      });

      if (result.canceled || !result.assets[0]?.base64) {
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        Alert.alert('Sessão', 'Faça login novamente.');
        return;
      }

      const b64 = result.assets[0].base64;
      const path = `${user.id}/${excursionId}/${p.id}/boarding_${phase}_${Date.now()}.jpg`;
      let bytes: Uint8Array;
      try {
        const binary = atob(b64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        Alert.alert('Erro', 'Não foi possível processar a foto. Tente novamente.');
        return;
      }

      setUploadingPassengerId(p.id);
      const { error: upErr } = await supabase.storage
        .from(BOARDING_PHOTO_BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

      if (upErr) {
        setUploadingPassengerId(null);
        Alert.alert('Erro', upErr.message || 'Não foi possível enviar a foto.');
        return;
      }

      const { error: dbErr } = await supabase
        .from('excursion_passengers')
        .update({
          [statusCol]: 'embarked',
          [photoCol]: path,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', p.id);

      setUploadingPassengerId(null);
      if (dbErr) {
        Alert.alert('Erro', 'Foto enviada, mas o embarque não foi salvo. Tente marcar de novo.');
        void loadAll();
        return;
      }

      setPassengers((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, [statusCol]: 'embarked' } : x)),
      );
    },
    [excursionId, loadAll, statusCol, photoCol, phase, statusOf],
  );

  const openJustify = useCallback(() => {
    setModal('justify');
    setJustifySelected(new Set(notEmbarkedUnjustified.map((p) => p.id)));
  }, [notEmbarkedUnjustified]);

  const toggleJustifySelect = useCallback((id: string) => {
    setJustifySelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const applyJustifyAndFinish = useCallback(async () => {
    if (justifySelected.size === 0) {
      Alert.alert('Seleção', 'Marque os passageiros ausentes a justificar.');
      return;
    }
    setSavingJustify(true);
    const ids = [...justifySelected];
    const { error } = await supabase
      .from('excursion_passengers')
      .update({ absence_justified: true, updated_at: new Date().toISOString() })
      .in('id', ids);
    setSavingJustify(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível salvar as justificativas.');
      return;
    }
    setModal('none');
    const { data } = await supabase
      .from('excursion_passengers')
      .select('id, full_name, age, gender, status_departure, status_return, absence_justified')
      .eq('excursion_request_id', excursionId)
      .order('full_name');
    const rows = (data ?? []) as any[];
    const mapped: Passenger[] = rows.map((r) => ({
      id: r.id,
      full_name: r.full_name ?? '',
      age: r.age ?? null,
      gender: r.gender ?? null,
      status_departure: r.status_departure ?? 'not_embarked',
      status_return: r.status_return ?? 'not_embarked',
      absence_justified: Boolean(r.absence_justified),
    }));
    const list = isVolta
      ? mapped.filter((p) => p.status_departure === 'embarked' || p.status_departure === 'disembarked')
      : mapped;
    setPassengers(list);
    const stillPending = list.filter((p) => statusOf(p) === 'not_embarked' && !p.absence_justified);
    if (stillPending.length > 0) {
      Alert.alert(
        'Ausentes pendentes',
        'Ainda há passageiros não embarcados sem justificativa. Selecione todos os ausentes a justificar ou use "Finalizar mesmo assim" no aviso anterior.',
      );
      return;
    }
    navigateSuccess(list);
  }, [excursionId, justifySelected, navigateSuccess, isVolta, statusOf]);

  const finishAnyway = useCallback(() => {
    setModal('none');
    navigateSuccess(passengers);
  }, [navigateSuccess, passengers]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isVolta ? 'Embarque de volta' : 'Realizar embarques'}</Text>
        {isVolta ? (
          <View style={styles.iconBtn} />
        ) : (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate('CadastrarPassageiroExcursao', { excursionId })}
            activeOpacity={0.7}
          >
            <MaterialIcons name="add" size={24} color="#111827" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#111827" style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={styles.statsRow}>
            <Text style={styles.statLeft}>
              Passageiros totais: <Text style={styles.statBold}>{passengers.length}</Text>
            </Text>
            <Text style={styles.statRight}>
              Embarcados: <Text style={styles.statGold}>{boardedCount}</Text>
            </Text>
          </View>
          <Text style={styles.statsHint}>
            {isVolta
              ? 'Embarque de volta — as mesmas pessoas da ida. Embarcar abre a câmera para registrar a foto.'
              : 'Embarcar abre a câmera — é necessário tirar uma foto para confirmar.'}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>

          <View style={styles.searchWrap}>
            <MaterialIcons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar passageiro pelo nome"
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {filtered.map((p) => {
              const embarked = statusOf(p) === 'embarked';
              const busy = uploadingPassengerId === p.id;
              return (
                <View key={p.id} style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial(p.full_name)}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.name}>{p.full_name}</Text>
                    <Text style={styles.meta}>{metaLine(p)}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.embarkBtn, embarked && styles.embarkBtnDone, busy && { opacity: 0.65 }]}
                    onPress={() => void embarkOrUndo(p)}
                    activeOpacity={0.85}
                    disabled={busy || uploadingPassengerId !== null}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={embarked ? '#111827' : '#FFFFFF'} />
                    ) : embarked ? (
                      <>
                        <MaterialIcons name="check" size={18} color="#111827" />
                        <Text style={styles.embarkTextDone}>Embarcado</Text>
                      </>
                    ) : (
                      <>
                        <MaterialIcons name="photo-camera" size={18} color="#FFFFFF" />
                        <Text style={styles.embarkText}>Embarcar</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.bottom, { paddingBottom: bottomInset }]}>
            {!isVolta && (
              <TouchableOpacity
                style={styles.addLink}
                onPress={() => navigation.navigate('CadastrarPassageiroExcursao', { excursionId })}
                activeOpacity={0.7}
              >
                <MaterialIcons name="add" size={18} color="#111827" />
                <Text style={styles.addLinkText}> Cadastrar novo passageiro</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btnBlack} onPress={tryFinalize} activeOpacity={0.88}>
              <Text style={styles.btnBlackText}>
                {isVolta ? 'Finalizar embarque de volta' : 'Finalizar embarque'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal visible={modal === 'pending'} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setModal('none')} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Há passageiros que ainda não embarcaram.</Text>
            <Text style={styles.modalSub}>
              Deseja justificar os ausentes antes de finalizar?
            </Text>
            <View style={styles.modalDivider} />
            <TouchableOpacity style={styles.modalBtnBlack} onPress={openJustify} activeOpacity={0.88}>
              <Text style={styles.modalBtnBlackText}>Justificar ausentes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnGray} onPress={finishAnyway} activeOpacity={0.88}>
              <Text style={styles.modalBtnDanger}>Finalizar mesmo assim</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={modal === 'justify'} animationType="slide" transparent>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setModal('none')} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setModal('none')} activeOpacity={0.7}>
                <MaterialIcons name="close" size={22} color="#111827" />
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>Justificar ausentes</Text>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: 24 }}>
              {notEmbarkedUnjustified.map((p) => {
                const sel = justifySelected.has(p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.justifyRow}
                    onPress={() => toggleJustifySelect(p.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initial(p.full_name)}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.name}>{p.full_name}</Text>
                      <Text style={styles.meta}>{metaLine(p)}</Text>
                    </View>
                    <View style={[styles.checkbox, sel && styles.checkboxOn]}>
                      {sel ? <MaterialIcons name="check" size={16} color="#FFFFFF" /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={[styles.btnBlack, savingJustify && { opacity: 0.65 }]}
                onPress={applyJustifyAndFinish}
                disabled={savingJustify}
                activeOpacity={0.88}
              >
                {savingJustify ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.btnBlackText}>Avançar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  statLeft: { fontSize: 15, color: '#374151' },
  statBold: { fontWeight: '700', color: '#111827' },
  statRight: { fontSize: 15, color: '#374151' },
  statGold: { fontWeight: '800', color: GOLD_MUTED },
  statsHint: {
    fontSize: 12,
    color: '#9CA3AF',
    paddingHorizontal: 20,
    marginTop: 8,
    lineHeight: 17,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#E8E4DC',
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: GOLD_MUTED,
    borderRadius: 3,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 4 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: '#111827' },
  scroll: { flex: 1 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 150 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
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
  embarkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  embarkBtnDone: {
    backgroundColor: '#F5E6C3',
  },
  embarkText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  embarkTextDone: { fontSize: 13, fontWeight: '700', color: '#111827' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  addLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  addLinkText: { fontSize: 15, fontWeight: '600', color: '#111827' },
  btnBlack: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBlackText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 44,
    paddingBottom: 20,
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 10 },
  modalSub: { fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 16 },
  modalDivider: { height: 1, backgroundColor: '#E5E7EB', marginBottom: 16 },
  modalBtnBlack: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  modalBtnBlackText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  modalBtnGray: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#EFEFEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnDanger: { fontSize: 16, fontWeight: '700', color: '#B24A44' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingBottom: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginTop: 8,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#111827' },
  sheetScroll: { maxHeight: 360, paddingHorizontal: 16 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 8 },
  justifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#111827', borderColor: '#111827' },
});
