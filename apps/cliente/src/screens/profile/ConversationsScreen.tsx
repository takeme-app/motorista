import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import {
  fetchClientConversationsList,
  type ClientConversationListRow,
} from '../../lib/chatConversations';
import { storageUrl } from '../../utils/storageUrl';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Conversations'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatListTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function previewText(lastMessage: string | null): string {
  if (!lastMessage?.trim()) return 'Nova conversa';
  const t = lastMessage.trim();
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

/**
 * Mantém apenas UMA conversa por pessoa (a mais recente). Há uma conversa por
 * contexto (viagem/encomenda), então o mesmo motorista/suporte aparecia
 * repetido. `list` já vem ordenada desc por data, então a primeira de cada
 * chave é a mais recente.
 */
function dedupeByPeer(list: ClientConversationListRow[]): ClientConversationListRow[] {
  const seen = new Set<string>();
  const out: ClientConversationListRow[] = [];
  for (const r of list) {
    const key =
      r.conversation_kind === 'support_backoffice'
        ? 'support'
        : `peer:${r.driver_id ?? r.client_id ?? r.displayName ?? r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function ConversationsScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<'recent' | 'finished'>('recent');
  const [rows, setRows] = useState<ClientConversationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setRows([]);
        setLoadError(null);
        setClientId(null);
        return;
      }
      setClientId(user.id);
      const { rows: next, error } = await fetchClientConversationsList(user.id);
      if (error) setLoadError(error.message);
      else {
        setLoadError(null);
        setRows(next);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Erro ao carregar conversas.');
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!clientId) return;
    const reload = () => {
      void load();
    };
    const channel = supabase
      .channel(`client-conversations-list:${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `client_id=eq.${clientId}` },
        reload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `driver_id=eq.${clientId}` },
        reload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `support_requester_id=eq.${clientId}` },
        reload,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, load]);

  const normStatus = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

  const filteredRows = useMemo(
    () =>
      dedupeByPeer(
        rows.filter((r) => {
          const s = normStatus(r.status);
          if (activeTab === 'recent') return s !== 'closed';
          return s === 'closed';
        }),
      ),
    [rows, activeTab],
  );

  const openChat = (row: ClientConversationListRow) => {
    const isSupport = row.conversation_kind === 'support_backoffice';
    navigation.navigate('Chat', {
      conversationId: row.id,
      contactName: row.displayName,
      participantAvatarKey: row.participantAvatarKey,
      supportBackoffice: isSupport,
      bookingId: row.booking_id,
    });
  };

  const renderRow = ({ item }: { item: ClientConversationListRow }) => {
    const avatarUri = storageUrl('avatars', item.participantAvatarKey);
    const timeLabel = formatListTime(item.last_message_at ?? item.updated_at);
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => openChat(item)}
        activeOpacity={0.7}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.rowAvatar} />
        ) : (
          <View style={styles.rowAvatarPlaceholder}>
            <Text style={styles.rowAvatarText}>{getInitials(item.displayName)}</Text>
          </View>
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <View style={styles.rowTitleBlock}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.displayName}
              </Text>
              <Text style={styles.rowKind} numberOfLines={1}>
                {item.kindLabel}
              </Text>
            </View>
            {timeLabel ? <Text style={styles.rowTime}>{timeLabel}</Text> : null}
          </View>
          <View style={styles.rowBottom}>
            <Text style={styles.rowPreview} numberOfLines={2}>
              {previewText(item.last_message)}
            </Text>
            {item.unread_client > 0 ? (
              <View style={styles.unreadPill}>
                <Text style={styles.unreadText}>
                  {item.unread_client > 99 ? '99+' : String(item.unread_client)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <MaterialIcons name="chevron-right" size={22} color={COLORS.neutral700} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navbarButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.navbarTitle} numberOfLines={1}>Conversas</Text>
        <View style={styles.navbarSpacer} />
      </View>
      <Text style={styles.screenHint}>
        Motorista, suporte e encomendas — puxe para atualizar a lista.
      </Text>
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'recent' && styles.tabActive]}
          onPress={() => setActiveTab('recent')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'recent' && styles.tabTextActive]}>Recentes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'finished' && styles.tabActive]}
          onPress={() => setActiveTab('finished')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'finished' && styles.tabTextActive]}>Finalizadas</Text>
        </TouchableOpacity>
      </View>

      {loadError ? (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              void load();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.retryButtonText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      ) : (
        <FlatList
          data={filteredRows}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={filteredRows.length === 0 ? styles.listEmptyGrow : styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={(
            <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} />
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <MaterialIcons name="chat-bubble-outline" size={48} color={COLORS.neutral700} />
              <Text style={styles.emptyText}>
                {activeTab === 'recent' ? 'Nenhuma conversa recente' : 'Nenhuma conversa finalizada'}
              </Text>
            </View>
          )}
        />
      )}
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
  navbarSpacer: { width: 48 },
  screenHint: {
    fontSize: 12,
    color: COLORS.neutral700,
    paddingHorizontal: 24,
    marginBottom: 8,
    lineHeight: 16,
  },
  tabs: { flexDirection: 'row', paddingHorizontal: 24, marginBottom: 8 },
  tab: { marginRight: 24, paddingBottom: 8 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.black },
  tabText: { fontSize: 15, color: COLORS.neutral700 },
  tabTextActive: { fontWeight: '700', color: COLORS.black },
  listContent: { paddingHorizontal: 16, paddingBottom: 48 },
  listEmptyGrow: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  rowAvatar: { width: 52, height: 52, borderRadius: 26, marginRight: 12, backgroundColor: COLORS.neutral300 },
  rowAvatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 12,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarText: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  rowTitleBlock: { flex: 1, minWidth: 0, marginRight: 8 },
  rowName: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  rowKind: { fontSize: 12, fontWeight: '500', color: COLORS.neutral700, marginTop: 2 },
  rowTime: { fontSize: 12, color: COLORS.neutral700 },
  rowBottom: { flexDirection: 'row', alignItems: 'center' },
  rowPreview: { flex: 1, fontSize: 14, color: COLORS.neutral700, marginRight: 8 },
  unreadPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: COLORS.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, color: COLORS.neutral700, textAlign: 'center', marginBottom: 16 },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: COLORS.black,
  },
  retryButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  emptyText: { fontSize: 15, color: COLORS.neutral700, marginTop: 12, textAlign: 'center' },
});
