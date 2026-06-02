import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  Animated,
} from 'react-native';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { unregisterMotoristaProfileFcmToken } from '../lib/motoristaFcm';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { getRootStackNavigation } from '../navigation/getRootStackNavigation';
import { SingleFieldModal } from '../components/profile/SingleFieldModal';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { storageUrl } from '../utils/storageUrl';
import type { ProfileOverviewRow, WorkerOverviewRow } from '../types/dbRows';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileOverview'>;

const GOLD = '#C9A227';
const PIX_CARD_BG = '#FFFBEB';
const PIX_BORDER = '#F5E6A3';

type Loaded = {
  userId: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
  tripsCompleted: number;
  rating: number | null;
  verified: boolean;
  subtypeLabel: string;
  pixKey: string | null;
};

function subtypeToLabel(subtype: string | null): string {
  const s = (subtype ?? '').toLowerCase();
  if (s === 'partner') return 'Parceiro TakeMe';
  if (s === 'excursions') return 'Preparador de Excursões';
  if (s === 'shipments') return 'Preparador de Encomendas';
  return 'Motorista TakeMe';
}

export function ProfileOverviewScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Loaded | null>(null);
  const [pixModal, setPixModal] = useState(false);
  const [deleteModal1, setDeleteModal1] = useState(false);
  const [deleteModal2, setDeleteModal2] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setData(null);
      setLoading(false);
      return;
    }

    const { data: profRaw } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, rating, verified')
      .eq('id', user.id)
      .maybeSingle();
    const prof = profRaw as ProfileOverviewRow | null;

    const { data: workerRaw } = await supabase
      .from('worker_profiles')
      .select('subtype, pix_key')
      .eq('id', user.id)
      .maybeSingle();
    const worker = workerRaw as WorkerOverviewRow | null;

    const metaName =
      (user.user_metadata?.full_name as string)?.trim() ||
      (user.user_metadata?.name as string)?.trim() ||
      '';
    const fullName = prof?.full_name?.trim() || metaName || (user.email ? user.email.split('@')[0] : 'Motorista');

    const { count } = await supabase
      .from('scheduled_trips')
      .select('id', { count: 'exact', head: true })
      .eq('driver_id', user.id)
      .eq('status', 'completed');

    setData({
      userId: user.id,
      email: user.email ?? null,
      fullName,
      avatarUrl: prof?.avatar_url ?? null,
      tripsCompleted: count ?? 0,
      rating: prof?.rating != null ? Number(prof.rating) : null,
      verified: Boolean(prof?.verified),
      subtypeLabel: subtypeToLabel(worker?.subtype ?? null),
      pixKey: worker?.pix_key?.trim() || null,
    });
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const rootNav = getRootStackNavigation(navigation);

  const handleLogout = async () => {
    await unregisterMotoristaProfileFcmToken();
    await supabase.auth.signOut();
    const root = navigation.getParent()?.getParent();
    if (root) {
      root.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Welcome' }] }));
    }
  };

  const savePix = async (value: string) => {
    if (!data) return;
    const { error } = await supabase
      .from('worker_profiles')
      .update({ pix_key: value.trim() || null, updated_at: new Date().toISOString() } as never)
      .eq('id', data.userId);
    if (error) throw error;
    await load();
  };

  const { dragY: del1DragY, panHandlers: del1Pan, resetDrag: resetDel1 } = useBottomSheetDrag(() => setDeleteModal1(false));
  const { dragY: del2DragY, panHandlers: del2Pan, resetDrag: resetDel2 } = useBottomSheetDrag(() => setDeleteModal2(false));

  const confirmDeleteAccount = () => { resetDel1(); setDeleteModal1(true); };

  // Após a exclusão a sessão fica inválida: confirma se o usuário realmente sumiu
  // antes de tratar um erro de rede como falha (mesmo padrão do app cliente).
  const checkUserGone = async (): Promise<boolean> => {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      return Boolean(error) || !user;
    } catch {
      return true;
    }
  };

  const finishDeletion = async () => {
    setDeleteModal2(false);
    await handleLogout();
    showAlert('Conta excluída', 'Sua conta foi excluída com sucesso.');
  };

  const handleFinalDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { confirm: 'EXCLUIR' },
      });
      if (error || data?.error || !data?.ok) {
        if (await checkUserGone()) {
          await finishDeletion();
          return;
        }
        const backendMsg = typeof data?.error === 'string' ? data.error : '';
        showAlert(
          'Erro',
          getUserErrorMessage(
            error ?? { message: data?.error },
            backendMsg || 'Não foi possível excluir a conta. Tente novamente.'
          )
        );
        return;
      }
      await finishDeletion();
    } catch (e: unknown) {
      if (await checkUserGone()) {
        await finishDeletion();
        return;
      }
      showAlert('Erro', getUserErrorMessage(e, 'A requisição demorou ou falhou. Tente novamente.'));
    } finally {
      setDeleting(false);
    }
  };

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Perfil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroRow}>
          <View style={styles.heroText}>
            <Text style={styles.displayName}>{data.fullName}</Text>
            <Text style={styles.tripsSub}>
              {data.tripsCompleted} {data.tripsCompleted === 1 ? 'viagem concluída' : 'viagens concluídas'}
            </Text>
            <View style={styles.chipsRow}>
              <View style={styles.chip}>
                <MaterialIcons name="star" size={14} color={GOLD} />
                <Text style={styles.chipText}>{data.rating != null ? data.rating.toFixed(1) : '—'}</Text>
              </View>
              {data.verified ? (
                <View style={styles.chip}>
                  <MaterialIcons name="verified" size={14} color={GOLD} />
                  <Text style={styles.chipText}>Verificado</Text>
                </View>
              ) : null}
              <View style={styles.chip}>
                <MaterialIcons name="north-east" size={14} color={GOLD} />
                <Text style={styles.chipText}>{data.subtypeLabel}</Text>
              </View>
            </View>
          </View>
          {data.avatarUrl ? (
            <Image source={{ uri: storageUrl('avatars', data.avatarUrl) ?? undefined }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <MaterialIcons name="person" size={36} color="#9CA3AF" />
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.profileTile} onPress={() => navigation.navigate('PersonalInfo')} activeOpacity={0.85}>
          <MaterialIcons name="person-outline" size={28} color="#111827" />
          <Text style={styles.profileTileLabel}>Perfil</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.pixCard} onPress={() => setPixModal(true)} activeOpacity={0.9}>
          <View style={styles.pixCardInner}>
            <View>
              <Text style={styles.pixLabel}>Chave Pix cadastrada</Text>
              <Text style={styles.pixValue}>{data.pixKey || 'Nenhuma chave cadastrada'}</Text>
            </View>
            <MaterialIcons name="edit" size={20} color="#111827" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.listRow}
          onPress={() => rootNav?.navigate('ResetPassword', {})}
          activeOpacity={0.7}
        >
          <MaterialIcons name="edit" size={22} color="#111827" />
          <Text style={styles.listLabel}>Alterar senha</Text>
        </TouchableOpacity>
        <View style={styles.listSep} />

        <TouchableOpacity
          style={styles.listRow}
          onPress={() => rootNav?.navigate('ForgotPassword')}
          activeOpacity={0.7}
        >
          <MaterialIcons name="lock-outline" size={22} color="#111827" />
          <Text style={styles.listLabel}>Recuperar senha</Text>
        </TouchableOpacity>
        <View style={styles.listSep} />

        <TouchableOpacity style={styles.listRow} onPress={handleLogout} activeOpacity={0.7}>
          <MaterialIcons name="logout" size={22} color="#111827" />
          <Text style={styles.listLabel}>Sair</Text>
        </TouchableOpacity>
        <View style={styles.listSep} />

        <TouchableOpacity style={styles.listRow} onPress={confirmDeleteAccount} activeOpacity={0.7}>
          <MaterialIcons name="delete-outline" size={22} color="#B91C1C" />
          <Text style={styles.listLabelDanger}>Excluir conta</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Modal 1 — confirmação inicial */}
      <Modal visible={deleteModal1} transparent animationType="fade" onRequestClose={() => setDeleteModal1(false)}>
        <View style={delStyles.overlay}>
          <Animated.View style={[delStyles.sheet, { transform: [{ translateY: del1DragY }] }]}>
            <View style={delStyles.handleArea} {...del1Pan}>
              <View style={delStyles.handle} />
            </View>
            <TouchableOpacity style={delStyles.closeBtn} onPress={() => setDeleteModal1(false)} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color="#111827" />
            </TouchableOpacity>
            <Text style={delStyles.title}>Tem certeza de que deseja excluir sua conta?</Text>
            <Text style={delStyles.body}>
              Ao confirmar, todos os seus dados e históricos serão removidos da plataforma de forma permanente.
            </Text>
            <Text style={delStyles.bodyBold}>Essa ação não pode ser desfeita.</Text>
            <TouchableOpacity
              style={delStyles.keepBtn}
              onPress={() => setDeleteModal1(false)}
              activeOpacity={0.85}
            >
              <Text style={delStyles.keepBtnText}>Manter conta</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={delStyles.deleteBtn}
              onPress={() => { setDeleteModal1(false); resetDel2(); setDeleteModal2(true); }}
              activeOpacity={0.85}
            >
              <Text style={delStyles.deleteBtnText}>Excluir conta</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* Modal 2 — aviso adicional */}
      <Modal visible={deleteModal2} transparent animationType="fade" onRequestClose={() => setDeleteModal2(false)}>
        <View style={delStyles.overlay}>
          <Animated.View style={[delStyles.sheet, { transform: [{ translateY: del2DragY }] }]}>
            <View style={delStyles.handleArea} {...del2Pan}>
              <View style={delStyles.handle} />
            </View>
            <TouchableOpacity style={delStyles.closeBtn} onPress={() => setDeleteModal2(false)} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color="#111827" />
            </TouchableOpacity>
            <Text style={delStyles.title}>Antes de prosseguir</Text>
            <Text style={delStyles.body}>
              Você também perderá acesso aos seus métodos de pagamento, histórico de atividades e dados de dependentes vinculados à conta.
            </Text>
            <TouchableOpacity
              style={delStyles.keepBtn}
              onPress={() => setDeleteModal2(false)}
              activeOpacity={0.85}
              disabled={deleting}
            >
              <Text style={delStyles.keepBtnText}>Manter conta</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[delStyles.deleteBtn, deleting && delStyles.deleteBtnDisabled]}
              onPress={handleFinalDelete}
              activeOpacity={0.85}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator color="#EF4444" />
              ) : (
                <Text style={delStyles.deleteBtnText}>Prosseguir com a exclusão</Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <SingleFieldModal
        visible={pixModal}
        onClose={() => setPixModal(false)}
        title="Chave Pix"
        subtitle="Informe a chave para receber seus repasses."
        label="Chave Pix"
        initialValue={data.pixKey ?? ''}
        placeholder="CPF, e-mail, telefone ou chave aleatória"
        onSave={async (v) => {
          try {
            await savePix(v);
          } catch (e: unknown) {
            showAlert('Erro', getUserErrorMessage(e));
            throw e;
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
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
  topTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  heroText: { flex: 1, paddingRight: 12 },
  displayName: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  tripsSub: { fontSize: 14, color: '#6B7280', marginBottom: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F3F4F6' },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTile: {
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingVertical: 22,
    alignItems: 'center',
    marginBottom: 16,
  },
  profileTileLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#111827' },
  pixCard: {
    backgroundColor: PIX_CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PIX_BORDER,
    padding: 16,
    marginBottom: 20,
  },
  pixCardInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pixLabel: { fontSize: 12, color: '#374151', marginBottom: 4 },
  pixValue: { fontSize: 17, fontWeight: '700', color: '#111827' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  listLabel: { flex: 1, fontSize: 16, fontWeight: '500', color: '#111827' },
  listLabelDanger: { flex: 1, fontSize: 16, fontWeight: '500', color: '#B91C1C' },
  listSep: { height: 1, backgroundColor: '#E5E7EB' },
});

const delStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 40,
  },
  handleArea: { paddingTop: 14, paddingBottom: 4, alignItems: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' },
  closeBtn: {
    alignSelf: 'flex-end',
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 26, fontWeight: '700', color: '#111827', marginBottom: 16, lineHeight: 32 },
  body: { fontSize: 17, color: '#9CA3AF', lineHeight: 24, marginBottom: 12 },
  bodyBold: { fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 28 },
  keepBtn: {
    backgroundColor: '#111827', borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginBottom: 12,
  },
  keepBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: '#F3F4F6', borderRadius: 14, paddingVertical: 18,
    alignItems: 'center',
  },
  deleteBtnDisabled: { opacity: 0.7 },
  deleteBtnText: { color: '#EF4444', fontSize: 16, fontWeight: '600' },
});
