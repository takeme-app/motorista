import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { ConfigureNotificationsContent } from './ConfigureNotificationsContent';
import {
  parseNotificationDeeplink,
  applyNotificationDeeplink,
  type NotificationDeeplink,
} from '../../lib/notificationDeeplink';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Notifications'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

type NotificationRow = {
  id: string;
  title: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
  data?: unknown;
  deeplink?: NotificationDeeplink | null;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString('pt-BR', { month: 'short' });
  const year = d.getFullYear();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${month}. ${year} · ${time}`;
}

export function NotificationsScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<'list' | 'config'>('list');
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (activeTab !== 'list') return;
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }
        // Ordem correta do cliente Supabase: `.select()` logo após `.from()`.
        // Se a coluna `data` ainda não existe no remoto, a primeira query falha;
        // refazemos sem `data` (deeplink indisponível até a migration aplicar).
        const fetchList = (columns: string) =>
          supabase
            .from('notifications')
            .select(columns)
            .eq('user_id', user.id)
            .eq('target_app_slug', 'cliente')
            .order('created_at', { ascending: false })
            .limit(50);

        let res = await fetchList('id, title, message, read_at, created_at, data');
        if (res.error) {
          res = await fetchList('id, title, message, read_at, created_at');
        }
        const rows = (res.data ?? []) as (Omit<NotificationRow, 'deeplink'>)[];
        setNotifications(
          rows.map((n) => ({
            ...n,
            deeplink: parseNotificationDeeplink((n as { data?: unknown }).data),
          })),
        );
        setLoading(false);
      })();
    }, [activeTab])
  );

  const handlePress = async (n: NotificationRow) => {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
    }
    if (n.deeplink) {
      applyNotificationDeeplink(navigation, n.deeplink);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navbarButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.navbarTitle} numberOfLines={1}>Notificações</Text>
      </View>
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'list' && styles.tabActive]}
          onPress={() => setActiveTab('list')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'list' && styles.tabTextActive]}>Notificações</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'config' && styles.tabActive]}
          onPress={() => (activeTab === 'config' ? null : setActiveTab('config'))}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'config' && styles.tabTextActive]}>Configurar notificações</Text>
        </TouchableOpacity>
      </View>
      {activeTab === 'config' ? (
        <ConfigureNotificationsContent />
      ) : loading ? (
        <ActivityIndicator size="large" color={COLORS.black} style={styles.loader} />
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="notifications-none" size={48} color={COLORS.neutral700} />
          <Text style={styles.emptyText}>Nenhuma notificação</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.notifRow}
              onPress={() => handlePress(item)}
              activeOpacity={0.7}
            >
              {!item.read_at && <View style={styles.unreadDot} />}
              <View style={styles.notifIconWrap}>
                <MaterialIcons name="notifications" size={22} color={COLORS.black} />
              </View>
              <View style={styles.notifBody}>
                <Text style={styles.notifTitle}>{item.title}</Text>
                {item.message ? <Text style={styles.notifMessage} numberOfLines={2}>{item.message}</Text> : null}
                <Text style={styles.notifDate}>{formatDate(item.created_at)}</Text>
              </View>
            </TouchableOpacity>
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
  tabs: { flexDirection: 'row', paddingHorizontal: 24, marginBottom: 16 },
  tab: { marginRight: 24, paddingBottom: 8 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.black },
  tabText: { fontSize: 15, color: COLORS.neutral700 },
  tabTextActive: { fontWeight: '700', color: COLORS.black },
  listContent: { paddingHorizontal: 24, paddingBottom: 48 },
  loader: { marginTop: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  emptyText: { fontSize: 15, color: COLORS.neutral700, marginTop: 12 },
  notifRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
    marginRight: 12,
    marginTop: 10,
  },
  notifIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notifBody: { flex: 1 },
  notifTitle: { fontSize: 15, fontWeight: '700', color: COLORS.black },
  notifMessage: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  notifDate: { fontSize: 12, color: COLORS.neutral700, marginTop: 4 },
});
