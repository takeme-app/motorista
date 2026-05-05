import { useState, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Modal,
  ActivityIndicator,
} from 'react-native';

let Location: any = null;
try { Location = require('expo-location'); } catch { /* expo-location not available */ }
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { fetchWorkerShipmentBaseId } from '../../lib/preparerEncomendasBase';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';

type PackageSize = 'Pequeno' | 'Médio' | 'Grande';

type Solicitacao = {
  id: string;
  clientName: string;
  clientInitial: string;
  size: PackageSize;
  priceFormatted: string;
  originAddress: string;
  scheduledAt: string;
  instructions: string;
  expanded: boolean;
};

const SIZE_COLORS: Record<PackageSize, { bg: string; text: string }> = {
  Pequeno: { bg: '#D1FAE5', text: '#065F46' },
  Médio:   { bg: '#DBEAFE', text: '#1E40AF' },
  Grande:  { bg: '#FEE2E2', text: '#991B1B' },
};

function packageSizeLabel(size: string): PackageSize {
  if (size === 'pequeno') return 'Pequeno';
  if (size === 'grande') return 'Grande';
  return 'Médio';
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

type Promotion = {
  id: string;
  title: string;
  description: string;
  gain_pct_to_worker?: number | null;
  discount_pct_to_passenger?: number | null;
};

export function HomeEncomendasScreen() {
  const { showAlert } = useAppAlert();
  const [preparadorName, setPreparadorName] = useState('Preparador');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptModal, setAcceptModal] = useState<Solicitacao | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [actioning, setActioning] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [promoModal, setPromoModal] = useState<Promotion | null>(null);
  const [missingBase, setMissingBase] = useState(false);
  const [queueLoadError, setQueueLoadError] = useState<string | null>(null);
  const locationSubRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMissingBase(false);
    setQueueLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) { setLoading(false); return; }
    setUserId(user.id);

    const myBaseId = await fetchWorkerShipmentBaseId(user.id);
    if (!myBaseId) {
      setMissingBase(true);
      setSolicitacoes([]);
      setLoading(false);
      return;
    }

    // Busca nome do preparador
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as { full_name?: string | null } | null;
    if (p?.full_name) {
      const firstName = p.full_name.split(' ')[0];
      if (firstName) setPreparadorName(firstName);
    }

    // RPC com SECURITY DEFINER: não depende da RLS de SELECT em shipments (que costuma devolver [] sem erro)
    const { data: shipments, error: shipmentsErr } = await supabase.rpc('preparer_shipment_queue');

    if (shipmentsErr) {
      setQueueLoadError(shipmentsErr.message || 'Não foi possível carregar as solicitações.');
      setSolicitacoes([]);
      setLoading(false);
      return;
    }

    const rows = (shipments ?? []) as {
      id: string;
      origin_address: string;
      package_size: string;
      amount_cents: number;
      instructions: string | null;
      scheduled_at: string | null;
      created_at: string;
      user_id: string;
    }[];

    const list: Solicitacao[] = [];
    for (const r of rows) {
      const { data: clientProf } = await supabase
        .from('profiles').select('full_name').eq('id', r.user_id).maybeSingle();
      const cp = clientProf as { full_name?: string | null } | null;
      const clientName = cp?.full_name ?? 'Cliente';
      list.push({
        id: r.id,
        clientName,
        clientInitial: clientName.charAt(0).toUpperCase(),
        size: packageSizeLabel(r.package_size),
        priceFormatted: formatCents(r.amount_cents),
        originAddress: r.origin_address,
        scheduledAt: formatTime(r.scheduled_at ?? r.created_at),
        instructions: r.instructions ?? 'Sem instruções.',
        expanded: false,
      });
    }
    setSolicitacoes(list);

    // Busca promoção ativa para preparador_encomendas
    try {
      const { data: promoData } = await supabase
        .from('promotions')
        .select('id, title, description, gain_pct_to_worker, discount_pct_to_passenger')
        .eq('is_active', true)
        .eq('target_type', 'preparador_encomendas')
        .maybeSingle();
      if (promoData) setPromoModal(promoData as Promotion);
    } catch { /* tabela pode não existir */ }

    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleGpsToggle = useCallback(async (val: boolean) => {
    if (val) {
      if (Location) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        locationSubRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy?.Balanced ?? 4, distanceInterval: 20 },
          () => {},
        );
      }
      setGpsEnabled(true);
    } else {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      setGpsEnabled(false);
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setSolicitacoes((prev) => prev.map((s) => (s.id === id ? { ...s, expanded: !s.expanded } : s)));
  }, []);

  const confirmAccept = useCallback(async () => {
    if (!acceptModal || !userId) return;
    const modal = acceptModal;
    setActioning(true);
    try {
      const { data: claimData, error: claimErr } = await supabase.rpc(
        'shipment_preparer_accept_claim' as never,
        { p_shipment_id: modal.id } as never,
      );
      const claim = claimData as { ok?: boolean; error?: string; skipped?: boolean } | null;

      if (claimErr) {
        showAlert('Erro', getUserErrorMessage(claimErr, 'Não foi possível aceitar a coleta.'));
        return;
      }
      if (claim?.ok !== true) {
        if (claim?.error === 'already_claimed') {
          showAlert(
            'Coleta indisponível',
            'Outro preparador já aceitou esta encomenda. A lista será atualizada.',
          );
          await load();
          return;
        }
        if (claim?.error === 'awaiting_driver') {
          showAlert(
            'Coleta aguardando motorista',
            'Esta encomenda ainda precisa ser aceita pelo motorista antes de ficar disponível para coleta.',
          );
          await load();
          return;
        }
        if (claim?.error === 'forbidden' || claim?.error === 'no_base') {
          showAlert(
            'Coleta indisponível',
            'Esta encomenda não pertence à sua base de preparação.',
          );
          await load();
          return;
        }
        showAlert(
          'Erro',
          'Não foi possível aceitar a coleta. Atualize a lista e tente novamente.',
        );
        await load();
        return;
      }

      setAccepted((prev) => [...prev, modal.id]);
      setSolicitacoes((prev) => prev.filter((s) => s.id !== modal.id));
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e, 'Não foi possível aceitar a coleta.'));
    } finally {
      setActioning(false);
      setAcceptModal(null);
    }
  }, [acceptModal, userId, showAlert, load]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={styles.greeting}>Olá, {preparadorName}!</Text>
        <Text style={styles.subGreeting}>
          {missingBase
            ? 'Vincule-se a uma base no cadastro para ver solicitações da sua região.'
            : 'Veja as solicitações de coleta disponíveis na sua base.'}
        </Text>

        <Text style={styles.sectionTitle}>Ações necessárias</Text>
        <View style={styles.actionCard}>
          <View style={styles.actionRow}>
            <View style={styles.actionLeft}>
              <View style={[styles.actionIcon, { backgroundColor: gpsEnabled ? '#D1FAE5' : '#F3F4F6' }]}>
                <MaterialIcons name="gps-fixed" size={20} color={gpsEnabled ? '#065F46' : '#6B7280'} />
              </View>
              <View>
                <Text style={styles.actionLabel}>GPS</Text>
                <Text style={styles.actionDesc}>{gpsEnabled ? 'Localização ativa' : 'Ativar localização'}</Text>
              </View>
            </View>
            <Switch value={gpsEnabled} onValueChange={handleGpsToggle} trackColor={{ false: '#E5E7EB', true: '#111827' }} thumbColor="#FFFFFF" />
          </View>
          <View style={styles.sep} />
          <View style={styles.actionRow}>
            <View style={styles.actionLeft}>
              <View style={[styles.actionIcon, { backgroundColor: notifEnabled ? '#D1FAE5' : '#F3F4F6' }]}>
                <MaterialIcons name="notifications" size={20} color={notifEnabled ? '#065F46' : '#6B7280'} />
              </View>
              <View>
                <Text style={styles.actionLabel}>Notificações</Text>
                <Text style={styles.actionDesc}>{notifEnabled ? 'Ativadas' : 'Ativar notificações'}</Text>
              </View>
            </View>
            <Switch value={notifEnabled} onValueChange={setNotifEnabled} trackColor={{ false: '#E5E7EB', true: '#111827' }} thumbColor="#FFFFFF" />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Solicitações de coleta</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#111827" style={{ marginTop: 32 }} />
        ) : solicitacoes.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="inventory-2" size={40} color="#D1D5DB" />
            <Text style={styles.emptyText}>
              {queueLoadError
                ? `${queueLoadError}\n\nConfira as migrations RLS da fila do preparador no repositório (Supabase).`
                : missingBase
                  ? 'Perfil sem base atribuída. Entre em contato com o suporte.'
                  : 'Nenhuma solicitação na fila da sua base.'}
            </Text>
          </View>
        ) : (
          solicitacoes.map((s) => {
            const isAccepted = accepted.includes(s.id);
            const c = SIZE_COLORS[s.size];
            return (
              <View key={s.id} style={[styles.card, isAccepted && styles.cardAccepted]}>
                <View style={styles.cardTop}>
                  <View style={styles.clientRow}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{s.clientInitial}</Text></View>
                    <View style={styles.clientInfo}>
                      <Text style={styles.clientName}>{s.clientName}</Text>
                      <Text style={styles.cardTime}>{s.scheduledAt}</Text>
                    </View>
                  </View>
                  <View style={[styles.sizeBadge, { backgroundColor: c.bg }]}>
                    <Text style={[styles.sizeBadgeText, { color: c.text }]}>{s.size}</Text>
                  </View>
                </View>
                <Text style={styles.price}>{s.priceFormatted}</Text>
                <View style={styles.locationRow}>
                  <MaterialIcons name="place" size={14} color="#9CA3AF" />
                  <Text style={styles.locationText} numberOfLines={1}>{s.originAddress}</Text>
                </View>
                <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(s.id)} activeOpacity={0.7}>
                  <Text style={styles.expandBtnText}>{s.expanded ? 'Ver menos' : 'Ver detalhes'}</Text>
                  <MaterialIcons name={s.expanded ? 'expand-less' : 'expand-more'} size={18} color="#6B7280" />
                </TouchableOpacity>
                {s.expanded && (
                  <View style={styles.expandedContent}>
                    <View style={styles.sep} />
                    <Text style={styles.obsLabel}>Instruções</Text>
                    <Text style={styles.obsText}>{s.instructions}</Text>
                  </View>
                )}
                {isAccepted ? (
                  <View style={styles.acceptedBadge}>
                    <MaterialIcons name="check-circle" size={16} color="#065F46" />
                    <Text style={styles.acceptedText}>Aceito</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.acceptBtn}
                    onPress={() => {
                      setPromoModal(null);
                      setAcceptModal(s);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.acceptBtnText}>Aceitar coleta</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={!!acceptModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Aceitar coleta?</Text>
            <Text style={styles.modalDesc}>Confirma a coleta de {acceptModal?.clientName}?</Text>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setAcceptModal(null)} activeOpacity={0.8} disabled={actioning}>
                <Text style={styles.modalBtnCancelText}>Não, voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnConfirm} onPress={confirmAccept} activeOpacity={0.85} disabled={actioning}>
                {actioning
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.modalBtnConfirmText}>Sim, aceitar</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de promoção */}
      <Modal visible={!!promoModal} transparent animationType="fade">
        <View style={styles.promoBackdrop}>
          <View style={styles.promoCard}>
            <View style={styles.promoIconWrap}>
              <Text style={styles.promoEmoji}>🎁</Text>
            </View>
            <Text style={styles.promoTitle}>{promoModal?.title ?? 'Promoção ativa'}</Text>
            <Text style={styles.promoDesc}>
              {promoModal?.description
                ?? (promoModal?.gain_pct_to_worker
                  ? `+${Number(promoModal.gain_pct_to_worker).toFixed(0)}% de bônus em todas as entregas realizadas durante a campanha.`
                  : 'Promoção ativa para preparador de encomendas.')}
            </Text>
            <TouchableOpacity style={styles.promoBtnPrimary} onPress={() => setPromoModal(null)} activeOpacity={0.85}>
              <Text style={styles.promoBtnPrimaryText}>Estou ciente</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.promoBtnSecondary} onPress={() => setPromoModal(null)} activeOpacity={0.7}>
              <Text style={styles.promoBtnSecondaryText}>Agora não</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 + SCREEN_TOP_EXTRA_PADDING },
  greeting: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  subGreeting: { fontSize: 14, color: '#6B7280', marginBottom: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 },
  actionCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4, backgroundColor: '#FAFAFA' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  actionDesc: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  sep: { height: 1, backgroundColor: '#F3F4F6' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF' },
  card: { borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 16, padding: 16, marginBottom: 14 },
  cardAccepted: { borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  cardTime: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  sizeBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  sizeBadgeText: { fontSize: 12, fontWeight: '700' },
  price: { fontSize: 20, fontWeight: '700', color: '#C9A227', marginBottom: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  locationText: { fontSize: 13, color: '#6B7280', flex: 1 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  expandBtnText: { fontSize: 13, color: '#6B7280' },
  expandedContent: { marginTop: 8 },
  obsLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 4 },
  obsText: { fontSize: 13, color: '#6B7280', lineHeight: 20 },
  acceptBtn: { backgroundColor: '#111827', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  acceptBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  acceptedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 12, backgroundColor: '#D1FAE5', borderRadius: 12 },
  acceptedText: { fontSize: 14, fontWeight: '600', color: '#065F46' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 10 },
  modalDesc: { fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 24 },
  modalRow: { flexDirection: 'row', gap: 12 },
  modalBtnCancel: { flex: 1, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalBtnCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  modalBtnConfirm: { flex: 1, backgroundColor: '#111827', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalBtnConfirmText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  // Promoção
  promoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  promoCard: {
    width: '85%', backgroundColor: '#FFFFFF', borderRadius: 24,
    padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, elevation: 14,
  },
  promoIconWrap: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#FEF3C7',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  promoEmoji: { fontSize: 40 },
  promoTitle: { fontSize: 20, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 10 },
  promoDesc: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  promoBtnPrimary: { width: '100%', backgroundColor: '#C9A227', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  promoBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  promoBtnSecondary: { paddingVertical: 8 },
  promoBtnSecondaryText: { fontSize: 14, color: '#9CA3AF' },
});
