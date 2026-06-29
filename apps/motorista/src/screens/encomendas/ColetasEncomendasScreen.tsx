import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Linking,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasEncomendasStackParamList } from '../../navigation/ColetasEncomendasStack';
import { SCREEN_TOP_EXTRA_PADDING } from '../../theme/screenLayout';
import { supabase } from '../../lib/supabase';
import { fetchWorkerShipmentBaseId } from '../../lib/preparerEncomendasBase';
import { formatShipmentCode, getOrCreateActiveSupportConversationId } from '@take-me/shared';
import { useAppAlert } from '../../contexts/AppAlertContext';

const SUPPORT_PHONE = 'tel:+5583999999999';
const SUPPORT_WHATSAPP = 'https://wa.me/5583999999999';

type Props = NativeStackScreenProps<ColetasEncomendasStackParamList, 'ColetasMain'>;

type ActiveColeta = {
  /** Encomenda representante (a mais recente) — usada para abrir a tela ativa. */
  id: string;
  shortId: string;
  clientName: string;
  originAddress: string;
  /** Endereço da base (devolução da encomenda). */
  baseAddress: string;
  scheduledAt: string;
  /** Quantidade de encomendas do mesmo cliente nesta coleta. */
  count: number;
};

type HistoryItem = {
  id: string;
  clientName: string;
  dateLabel: string;
};

type ChatPreview = {
  id: string;
  participantName: string;
  participantAvatar?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  status: 'active' | 'closed';
};

function shortId(id: string): string {
  return formatShipmentCode(id);
}

function formatHistoryDate(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const month = months[d.getMonth()] ?? '';
    const day = d.getDate().toString().padStart(2, '0');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${month}, ${time}`;
  } catch { return iso; }
}

function formatScheduledAt(iso: string | null, createdAt: string): string {
  const src = iso ?? createdAt;
  try {
    return new Date(src).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function formatChatTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ColetasEncomendasScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [loading, setLoading] = useState(true);
  const [actives, setActives] = useState<ActiveColeta[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [chatPreviews, setChatPreviews] = useState<ChatPreview[]>([]);
  const [supportVisible, setSupportVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) { setLoading(false); return; }

    const myBaseId = await fetchWorkerShipmentBaseId(user.id);
    if (!myBaseId) {
      setActives([]);
      setHistory([]);
      setChatPreviews([]);
      setLoading(false);
      return;
    }

    // Encomendas ativas assumidas pelo preparador (mesma base), ainda não entregues
    // na base. Agrupadas POR CLIENTE: o preparador pega todas do mesmo cliente numa
    // única coleta e leva à base de uma vez.
    const { data: activeRows } = await supabase
      .from('shipments')
      .select('id, origin_address, scheduled_at, created_at, user_id, base_id, delivered_to_base_at, bases(name, address)')
      .in('status', ['confirmed', 'in_progress'])
      .eq('preparer_id' as never, user.id)
      .eq('base_id' as never, myBaseId as never)
      .is('delivered_to_base_at', null)
      .order('created_at', { ascending: false });

    const arows = (activeRows ?? []) as unknown as {
      id: string;
      origin_address: string;
      scheduled_at: string | null;
      created_at: string;
      user_id: string;
      bases?: { name?: string | null; address?: string | null } | null;
    }[];
    // Agrupa por cliente (user_id), preservando a ordem (mais recente primeiro).
    const byClient = new Map<string, typeof arows>();
    for (const r of arows) {
      const arr = byClient.get(r.user_id);
      if (arr) arr.push(r);
      else byClient.set(r.user_id, [r]);
    }
    const coletas: ActiveColeta[] = [];
    for (const [uid, group] of byClient) {
      const rep = group[0]!;
      const { data: prof } = await supabase
        .from('profiles').select('full_name').eq('id', uid).maybeSingle();
      const p = prof as { full_name?: string | null } | null;
      const baseAddr = rep.bases?.address?.trim()
        ? `${rep.bases?.name ? `${rep.bases.name} — ` : ''}${rep.bases.address}`.trim()
        : 'Base (endereço indisponível)';
      coletas.push({
        id: rep.id,
        shortId: shortId(rep.id),
        clientName: p?.full_name ?? 'Cliente',
        originAddress: rep.origin_address,
        baseAddress: baseAddr,
        scheduledAt: formatScheduledAt(rep.scheduled_at, rep.created_at),
        count: group.length,
      });
    }
    setActives(coletas);

    // Histórico recente: só encomendas já depositadas/finalizadas pelo preparador.
    const { data: histData } = await supabase
      .from('shipments')
      .select('id, created_at, user_id, delivered_to_base_at')
      .eq('preparer_id' as never, user.id)
      .eq('base_id' as never, myBaseId as never)
      .not('delivered_to_base_at', 'is', null)
      .order('delivered_to_base_at', { ascending: false })
      .limit(4);

    const rows = (histData ?? []) as unknown as {
      id: string;
      created_at: string;
      user_id: string;
      delivered_to_base_at?: string | null;
    }[];
    const items: HistoryItem[] = [];
    for (const r of rows) {
      const { data: prof } = await supabase
        .from('profiles').select('full_name').eq('id', r.user_id).maybeSingle();
      const p = prof as { full_name?: string | null } | null;
      items.push({
        id: r.id,
        clientName: p?.full_name ?? 'Cliente',
        dateLabel: formatHistoryDate(r.delivered_to_base_at ?? r.created_at),
      });
    }
    setHistory(items);

    const { data: chatsData } = await supabase
      .from('conversations' as never)
      .select('id, participant_name, participant_avatar, last_message, last_message_at, unread_driver, status, client_id')
      .eq('driver_id', user.id)
      .not('shipment_id', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(30);

    const rawChats = (chatsData ?? []) as unknown as {
      id: string;
      participant_name?: string | null;
      participant_avatar?: string | null;
      last_message?: string | null;
      last_message_at?: string | null;
      unread_driver?: number | null;
      status?: string | null;
      client_id?: string | null;
    }[];
    // Uma conversa por cliente: várias encomendas do mesmo cliente geram várias
    // conversas (uma por shipment); aqui mantemos só a mais recente de cada cliente.
    const seenClients = new Set<string>();
    const dedupedChats = rawChats.filter((c) => {
      const key = `client:${c.client_id ?? c.participant_name ?? c.id}`;
      if (seenClients.has(key)) return false;
      seenClients.add(key);
      return true;
    });

    setChatPreviews(dedupedChats.slice(0, 3).map((c) => ({
      id: c.id,
      participantName: c.participant_name?.trim() || 'Cliente',
      participantAvatar: c.participant_avatar ?? null,
      lastMessage: c.last_message ?? null,
      lastMessageAt: c.last_message_at ?? null,
      unreadCount: c.unread_driver ?? 0,
      status: c.status === 'closed' ? 'closed' : 'active',
    })));
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openChatThread = useCallback((chat: ChatPreview) => {
    const parent = navigation.getParent() as
      | { navigate: (screen: string, params?: unknown) => void }
      | undefined;
    parent?.navigate('ChatEnc', {
      screen: 'ChatEncThread',
      params: {
        conversationId: chat.id,
        participantName: chat.participantName,
        participantAvatar: chat.participantAvatar ?? undefined,
      },
    });
  }, [navigation]);

  const handleCall = () => {
    setSupportVisible(false);
    void Linking.openURL(SUPPORT_PHONE);
  };

  const handleWhatsApp = () => {
    setSupportVisible(false);
    void Linking.openURL(SUPPORT_WHATSAPP);
  };

  const handleChatSupport = () => {
    setSupportVisible(false);
    void (async () => {
      const { conversationId, error } = await getOrCreateActiveSupportConversationId(supabase);
      if (error || !conversationId) {
        showAlert('Suporte', error ?? 'Não foi possível abrir o chat.');
        return;
      }
      const parent = navigation.getParent() as
        | { navigate: (screen: string, params?: unknown) => void }
        | undefined;
      parent?.navigate('ChatEnc', {
        screen: 'ChatEncThread',
        params: { conversationId, participantName: 'Suporte Take Me' },
      });
    })();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Coletas</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#111827" style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Em rota */}
          <Text style={styles.sectionTitle}>Em rota</Text>
          {actives.length > 0 ? (
            actives.map((coleta) => (
              <TouchableOpacity
                key={coleta.id}
                style={styles.activeCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ActiveShipment', { shipmentId: coleta.id })}
              >
                <View style={styles.activeCardTop}>
                  <Text style={styles.activeCardTitle} numberOfLines={1}>
                    {coleta.count > 1
                      ? `Coleta — ${coleta.clientName}`
                      : `Pedido #${coleta.shortId} — ${coleta.clientName}`}
                  </Text>
                  <View style={styles.activeStatusBadge}>
                    <Text style={styles.activeStatusText}>Em coleta</Text>
                  </View>
                </View>
                {coleta.count > 1 && (
                  <Text style={styles.activeCountText}>
                    {coleta.count} encomendas do mesmo cliente
                  </Text>
                )}
                <View style={styles.activeRouteRow}>
                  <Text style={styles.activeRouteFrom} numberOfLines={1}>{coleta.originAddress}</Text>
                  <MaterialIcons name="arrow-forward" size={14} color="#6B7280" style={{ marginHorizontal: 6 }} />
                  <Text style={styles.activeRouteTo} numberOfLines={1}>{coleta.baseAddress}</Text>
                </View>
                <View style={styles.activeTimeRow}>
                  <MaterialIcons name="access-time" size={14} color="#6B7280" />
                  <Text style={styles.activeTimeText}>{coleta.scheduledAt}</Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>Nenhuma coleta em andamento</Text>
            </View>
          )}

          {/* Histórico */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Histórico</Text>
            <TouchableOpacity
              style={styles.filterBtn}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('HistoricoEncomendas')}
            >
              <MaterialIcons name="tune" size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          <View style={styles.listCard}>
            {history.length === 0 ? (
              <View style={styles.emptyHistory}>
                <MaterialIcons name="history" size={32} color="#D1D5DB" />
                <Text style={styles.emptyListText}>Sem histórico ainda</Text>
              </View>
            ) : (
              history.map((item, idx) => (
                <View key={item.id}>
                  <TouchableOpacity
                    style={styles.historyRow}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('DetalhesEncomenda', { shipmentId: item.id })}
                  >
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyName}>{item.clientName}</Text>
                      <Text style={styles.historyDate}>{item.dateLabel}</Text>
                    </View>
                    <View style={styles.historyStatusBadge}>
                      <Text style={styles.historyStatusText}>Finalizada</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                  {idx < history.length - 1 && <View style={styles.sep} />}
                </View>
              ))
            )}
            {history.length > 0 && (
              <>
                <View style={styles.sep} />
                <TouchableOpacity
                  style={styles.verMaisBtn}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('HistoricoEncomendas')}
                >
                  <Text style={styles.verMaisText}>Ver mais</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Chat */}
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Chat</Text>
          <View style={styles.listCard}>
            {chatPreviews.length === 0 ? (
              <View style={styles.chatEmptyRow}>
                <MaterialIcons name="chat-bubble-outline" size={28} color="#D1D5DB" />
                <Text style={styles.emptyListText}>Nenhuma conversa recente</Text>
              </View>
            ) : (
              chatPreviews.map((chat, idx) => (
                <View key={chat.id}>
                  <TouchableOpacity style={styles.chatRow} activeOpacity={0.75} onPress={() => openChatThread(chat)}>
                    <View style={styles.chatIcon}>
                      <MaterialIcons name="chat-bubble-outline" size={20} color="#92400E" />
                    </View>
                    <View style={styles.chatInfo}>
                      <View style={styles.chatTitleRow}>
                        <Text style={styles.chatName} numberOfLines={1}>{chat.participantName}</Text>
                        <Text style={styles.chatTime}>{formatChatTime(chat.lastMessageAt)}</Text>
                      </View>
                      <Text style={styles.chatPreviewText} numberOfLines={1}>
                        {chat.lastMessage || (chat.status === 'closed' ? 'Conversa finalizada' : 'Abrir conversa')}
                      </Text>
                    </View>
                    {chat.unreadCount > 0 && (
                      <View style={styles.chatBadge}>
                        <Text style={styles.chatBadgeText}>{chat.unreadCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {idx < chatPreviews.length - 1 && <View style={styles.sep} />}
                </View>
              ))
            )}
            {chatPreviews.length > 0 && <View style={styles.sep} />}
            <TouchableOpacity
              style={styles.verMaisBtn}
              activeOpacity={0.7}
              onPress={() => navigation.getParent()?.navigate('ChatEnc')}
            >
              <Text style={styles.verMaisText}>Ver mais</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      )}

      {/* FAB suporte */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => setSupportVisible(true)}
      >
        <MaterialIcons name="headset-mic" size={20} color="#92400E" />
      </TouchableOpacity>

      {/* Modal suporte — card centralizado */}
      <Modal visible={supportVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSupportVisible(false)} />
          <View style={styles.modalCard}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSupportVisible(false)} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Como podemos{'\n'}ajudar?</Text>
            <Text style={styles.modalSubtitle}>Escolha uma das opções abaixo para entrar em contato</Text>
            <TouchableOpacity style={styles.supportOption} onPress={handleCall} activeOpacity={0.85}>
              <View style={styles.supportOptionIcon}>
                <MaterialIcons name="phone" size={22} color="#92400E" />
              </View>
              <Text style={styles.supportOptionText}>Ligar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.supportOption} onPress={handleChatSupport} activeOpacity={0.85}>
              <View style={styles.supportOptionIcon}>
                <MaterialIcons name="chat-bubble-outline" size={22} color="#92400E" />
              </View>
              <Text style={styles.supportOptionText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.supportOption} onPress={handleWhatsApp} activeOpacity={0.85}>
              <View style={styles.supportOptionIcon}>
                <MaterialIcons name="chat" size={22} color="#92400E" />
              </View>
              <Text style={styles.supportOptionText}>WhatsApp</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 12 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#111827', textAlign: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 20 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 12 },
  filterBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  activeCard: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16,
    padding: 16, marginBottom: 28,
  },
  activeCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  activeCardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  activeStatusBadge: { backgroundColor: '#D1FAE5', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  activeStatusText: { fontSize: 12, fontWeight: '700', color: '#065F46' },
  activeCountText: { fontSize: 12, fontWeight: '600', color: '#92400E', marginBottom: 8 },
  activeRouteRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  activeRouteFrom: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 1 },
  activeRouteTo: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 1, textAlign: 'right' },
  activeTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeTimeText: { fontSize: 13, color: '#6B7280' },
  emptyCard: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16,
    padding: 20, alignItems: 'center', marginBottom: 28,
  },
  emptyCardText: { fontSize: 14, color: '#9CA3AF' },
  listCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  historyInfo: { flex: 1 },
  historyName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  historyDate: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  historyStatusBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 8,
  },
  historyStatusText: { fontSize: 11, fontWeight: '800', color: '#047857' },
  sep: { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 16 },
  verMaisBtn: { paddingVertical: 14, alignItems: 'center' },
  verMaisText: { fontSize: 14, fontWeight: '600', color: '#374151', textDecorationLine: 'underline' },
  chatEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  chatRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  chatIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  chatInfo: { flex: 1 },
  chatTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chatName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111827' },
  chatTime: { fontSize: 12, color: '#9CA3AF' },
  chatPreviewText: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  chatBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#92400E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  chatBadgeText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  emptyListText: { fontSize: 14, color: '#9CA3AF' },
  emptyHistory: { paddingVertical: 28, alignItems: 'center', gap: 10 },
  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  // Support modal — centered card
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalCard: {
    width: '88%', backgroundColor: '#FFFFFF',
    borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  closeBtn: {
    alignSelf: 'flex-end',
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 6, lineHeight: 30 },
  modalSubtitle: { fontSize: 13, color: '#9CA3AF', lineHeight: 20, marginBottom: 20 },
  supportOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFBEB', borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 14, marginBottom: 10,
  },
  supportOptionIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center',
  },
  supportOptionText: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 },
});
