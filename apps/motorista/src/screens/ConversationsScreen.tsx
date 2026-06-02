import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList, ChatExcStackParamList, ChatEncomendasStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';

const sb = supabase as { from: (table: string) => any };
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { storageUrl } from '../utils/storageUrl';

type Props =
  | NativeStackScreenProps<ProfileStackParamList, 'Conversations'>
  | NativeStackScreenProps<ChatExcStackParamList, 'ChatExcList'>
  | NativeStackScreenProps<ChatEncomendasStackParamList, 'ChatEncList'>;

const GOLD = '#C9A227';
const SUPPORT_COLOR = '#7C3D6E';

type Tab = 'recentes' | 'finalizadas';

type ConversationRow = {
  id: string;
  participant_name: string | null;
  participant_avatar: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_driver: number;
  status: string;
  conversation_kind?: string | null;
  client_id?: string | null;
  support_requester_id?: string | null;
};

/**
 * Mantém apenas UMA conversa por pessoa (a mais recente). O sistema cria uma
 * conversa por contexto (booking/encomenda/excursão), então o mesmo cliente
 * aparecia várias vezes na lista. `list` precisa vir ordenada por
 * last_message_at desc (a primeira de cada chave é a mais recente).
 */
function dedupeByPerson(list: ConversationRow[]): ConversationRow[] {
  const seen = new Set<string>();
  const out: ConversationRow[] = [];
  for (const c of list) {
    const key =
      c.conversation_kind === 'support_backoffice'
        ? 'support'
        : `client:${c.client_id ?? c.participant_name ?? c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? '?').toUpperCase();
}

function isSupport(name: string | null): boolean {
  return (name ?? '').toLowerCase().includes('suporte') || (name ?? '').toLowerCase().includes('take me');
}

export function ConversationsScreen({ navigation }: Props) {
  const route = useRoute();
  const listParams = (route.params ?? {}) as { hideBack?: boolean; chatScreenName?: string };
  const hideBack = listParams.hideBack === true;
  const chatScreenName = listParams.chatScreenName ?? 'Chat';

  const [tab, setTab] = useState<Tab>('recentes');
  const [recentes, setRecentes] = useState<ConversationRow[]>([]);
  const [finalizadas, setFinalizadas] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data } = await sb
        .from('conversations')
        .select(
          'id, participant_name, participant_avatar, last_message, last_message_at, unread_driver, status, conversation_kind, client_id, support_requester_id',
        )
        .eq('driver_id', user.id)
        .order('last_message_at', { ascending: false });

      const all = (data ?? []) as ConversationRow[];
      setRecentes(dedupeByPerson(all.filter((c) => c.status === 'active')));
      setFinalizadas(dedupeByPerson(all.filter((c) => c.status === 'closed')));
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = tab === 'recentes' ? recentes : finalizadas;

  function renderAvatar(item: ConversationRow) {
    if (item.participant_avatar) {
      const uri = storageUrl('avatars', item.participant_avatar);
      if (uri) return <Image source={{ uri }} style={styles.avatar} />;
    }
    const support = isSupport(item.participant_name);
    return (
      <View style={[styles.avatarInitials, support && { backgroundColor: SUPPORT_COLOR }]}>
        <Text style={styles.avatarText}>{getInitials(item.participant_name)}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        {hideBack ? (
          <View style={styles.iconBtn} />
        ) : (
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Conversas</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem} onPress={() => setTab('recentes')} activeOpacity={0.7}>
          <Text style={[styles.tabLabel, tab === 'recentes' && styles.tabLabelActive]}>Recentes</Text>
          {tab === 'recentes' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setTab('finalizadas')} activeOpacity={0.7}>
          <Text style={[styles.tabLabel, tab === 'finalizadas' && styles.tabLabelActive]}>Finalizadas</Text>
          {tab === 'finalizadas' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#111827" /></View>
      ) : active.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Nenhuma conversa aqui.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {active.map((item, i) => (
            <View key={item.id}>
              <TouchableOpacity
              style={styles.row}
              activeOpacity={0.75}
              onPress={() => {
                const displayName =
                  item.conversation_kind === 'support_backoffice'
                    ? 'Suporte Take Me'
                    : (item.participant_name ?? 'Usuário');
                (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
                  chatScreenName,
                  {
                    conversationId: item.id,
                    participantName: displayName,
                    participantAvatar: item.participant_avatar ?? undefined,
                  },
                );
              }}
            >
                {renderAvatar(item)}
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.conversation_kind === 'support_backoffice'
                        ? 'Suporte Take Me'
                        : (item.participant_name ?? 'Usuário')}
                    </Text>
                    <Text style={[styles.time, item.unread_driver > 0 && styles.timeActive]}>
                      {formatTime(item.last_message_at)}
                    </Text>
                  </View>
                  <View style={styles.rowBottom}>
                    <Text style={styles.preview} numberOfLines={2}>{item.last_message ?? ''}</Text>
                    {item.unread_driver > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.unread_driver}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
              {i < active.length - 1 && <View style={styles.sep} />}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#9CA3AF', fontSize: 15 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING, paddingBottom: 12,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  tabItem: { flex: 1, alignItems: 'center', paddingBottom: 10, paddingTop: 4, position: 'relative' },
  tabLabel: { fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  tabLabelActive: { color: '#111827', fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: 0, left: 16, right: 16, height: 2, backgroundColor: '#111827', borderRadius: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3F4F6' },
  avatarInitials: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  rowContent: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 },
  time: { fontSize: 13, color: '#9CA3AF' },
  timeActive: { color: GOLD, fontWeight: '600' },
  rowBottom: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  preview: { fontSize: 13, color: '#6B7280', flex: 1, lineHeight: 18, marginRight: 8 },
  badge: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  sep: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 82 },
});
