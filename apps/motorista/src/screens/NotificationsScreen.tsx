import { useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import {
  applyNotificationDeeplink,
  parseNotificationDeeplink,
} from '../lib/notificationDeeplink';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Notifications'>;

const GOLD = '#C9A227';

/** Alinhado a `notification_preferences` (migration 20250224000003) e ao app cliente. */
const PREF_KEYS = [
  {
    key: 'travel_updates',
    title: 'Atualizações de viagens',
    desc: 'Corridas, solicitações pendentes e mudanças de status nas suas viagens.',
  },
  {
    key: 'shipments_deliveries',
    title: 'Envios e coletas',
    desc: 'Encomendas e coletas quando você atua como preparador de encomendas.',
  },
  {
    key: 'excursions_dependents',
    title: 'Excursões',
    desc: 'Pedidos e atualizações de excursões (preparador de excursões).',
  },
  {
    key: 'first_steps_hints',
    title: 'Notificações de primeiros passos',
    desc: 'Mostra o card "Próximo passo" na Home e o modal de dicas "Como receber corridas".',
  },
  {
    key: 'payments_pending',
    title: 'Pagamentos pendentes',
    desc: 'Lembretes sobre repasses e valores em aberto.',
  },
  {
    key: 'payments_received',
    title: 'Pagamentos recebidos',
    desc: 'Confirmação quando um repasse for efetivado (status paid).',
  },
  {
    key: 'payment_receipts',
    title: 'Comprovantes de pagamento',
    desc: 'Recibos e confirmações de pagamento.',
  },
  {
    key: 'offers_promotions',
    title: 'Ofertas e promoções',
    desc: 'Campanhas e novidades da plataforma.',
  },
  {
    key: 'app_updates',
    title: 'Atualizações do app',
    desc: 'Novos recursos e melhorias.',
  },
  { key: 'disable_all', title: 'Desativar todas as notificações', desc: '' },
] as const;

type Tab = 'list' | 'config';

type NotifRow = {
  id: string;
  title: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
  category: string | null;
  data: Record<string, unknown> | null;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' • ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return '';
  }
}

export function NotificationsScreen({ navigation }: Props) {
  const [tab, setTab] = useState<Tab>('list');
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoadError, setListLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [prefsLoading, setPrefsLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setListLoadError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setNotifications([]);
        return;
      }

      /**
       * Ordem correta do cliente Supabase: `.select()` logo após `.from()`.
       * Colocar `.eq()` antes de `.select()` pode deixar a Promise pendurada
       * (spinner infinito).
       *
       * Se a coluna `data` ainda não existe no remoto, a primeira query falha —
       * repetimos sem `data` (deeplink indisponível até migrar).
       */
      const fetchList = (columns: string) =>
        supabase
          .from('notifications')
          .select(columns)
          .eq('user_id', user.id)
          .eq('target_app_slug', 'motorista')
          .order('created_at', { ascending: false })
          .limit(50);

      let res = await fetchList('id, title, message, read_at, created_at, category, data');

      if (res.error) {
        res = await fetchList('id, title, message, read_at, created_at, category');
      }

      if (res.error) {
        console.warn('[NotificationsScreen]', res.error.message);
        setListLoadError(res.error.message);
        setNotifications([]);
      } else {
        const rows = (res.data ?? []) as (Omit<NotifRow, 'data'> & { data?: NotifRow['data'] })[];
        setNotifications(
          rows.map((r) => ({
            ...r,
            data: r.data ?? null,
          })),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[NotificationsScreen] loadNotifications', msg);
      setListLoadError(msg);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications();
    }, [loadNotifications])
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setPrefsLoading(false);
        return;
      }
      const { data } = await supabase
        .from('notification_preferences')
        .select('key, enabled')
        .eq('user_id', user.id);

      const map: Record<string, boolean> = {};
      PREF_KEYS.forEach(({ key }) => {
        // `disable_all` é uma ação negativa: por padrão vem DESLIGADO
        // (usuário recebe notificações). Demais preferências começam ligadas.
        map[key] = key === 'disable_all' ? false : true;
      });
      (data ?? []).forEach((row: { key: string; enabled: boolean }) => {
        map[row.key] = row.enabled;
      });
      setPrefs(map);
      setPrefsLoading(false);
    })();
  }, []);

  const markRead = async (id: string) => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
    await supabase.from('notifications').update({ read_at: now } as never).eq('id', id);
  };

  /**
   * Toque em item do inbox: marca como lida e, havendo payload `data`, navega
   * para a tela indicada (deeplink) — mesma resolução usada pelos pushes FCM.
   */
  const handleNotificationPress = useCallback(
    (n: NotifRow) => {
      void markRead(n.id);
      const link = parseNotificationDeeplink(n.data);
      if (link) {
        applyNotificationDeeplink(navigation, link);
      }
    },
    [navigation],
  );

  const setPref = useCallback(async (key: string, enabled: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    setPrefs((prev) => ({ ...prev, [key]: enabled }));
    await supabase.from('notification_preferences').upsert(
      { user_id: user.id, key, enabled },
      { onConflict: 'user_id,key' }
    );
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notificações</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem} onPress={() => setTab('list')} activeOpacity={0.7}>
          <Text style={[styles.tabLabel, tab === 'list' && styles.tabLabelActive]}>Notificações</Text>
          {tab === 'list' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setTab('config')} activeOpacity={0.7}>
          <Text style={[styles.tabLabel, tab === 'config' && styles.tabLabelActive]}>Configurar notificações</Text>
          {tab === 'config' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      </View>

      {tab === 'list' ? (
        loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#111827" />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.center}>
            {listLoadError ? (
              <>
                <Text style={styles.emptyText}>Não foi possível carregar as notificações.</Text>
                <Text style={styles.emptyHint}>
                  Verifique a conexão e tente puxar a lista de novo (volte e entre de novo nesta tela).
                  Se o erro persistir, confira no Supabase se a migration que adiciona a coluna de
                  deeplink em notificações já foi aplicada.
                </Text>
                <Text style={styles.emptyHintMono} numberOfLines={4}>
                  {listLoadError}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyText}>Nenhuma notificação ainda.</Text>
                <Text style={styles.emptyHint}>
                  Avisos importantes aparecem aqui. Novas solicitações e eventos podem gerar registros via servidor.
                </Text>
              </>
            )}
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {notifications.map((n, i) => {
              const unread = n.read_at == null;
              return (
                <TouchableOpacity
                  key={n.id}
                  style={styles.notifRow}
                  onPress={() => handleNotificationPress(n)}
                  activeOpacity={0.7}
                >
                  {unread ? <View style={styles.unreadDot} /> : null}
                  <View style={[styles.bellCircle, { backgroundColor: unread ? '#FEF3C7' : '#F3F4F6' }]}>
                    <MaterialIcons name="notifications-none" size={22} color={unread ? GOLD : '#9CA3AF'} />
                  </View>
                  <View style={styles.notifContent}>
                    <Text style={[styles.notifTitle, unread && styles.notifTitleBold]}>{n.title}</Text>
                    <Text style={styles.notifBody} numberOfLines={3}>
                      {n.message?.trim() ? n.message : '—'}
                    </Text>
                    <Text style={styles.notifDate}>{formatDate(n.created_at)}</Text>
                  </View>
                  {i < notifications.length - 1 ? <View style={styles.notifSep} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )
      ) : prefsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.configScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.prefGroup}>
            <Text style={styles.prefGroupTitle}>Atividades e status</Text>
            {PREF_KEYS.slice(0, 4).map((item, i) => (
              <View key={item.key}>
                <View style={styles.prefRow}>
                  <View style={styles.prefText}>
                    <Text style={styles.prefLabel}>{item.title}</Text>
                    {item.desc ? <Text style={styles.prefSub}>{item.desc}</Text> : null}
                  </View>
                  <Switch
                    value={prefs[item.key] ?? true}
                    onValueChange={(v) => void setPref(item.key, v)}
                    trackColor={{ false: '#E5E7EB', true: '#111827' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                {i < 3 ? <View style={styles.prefSep} /> : null}
              </View>
            ))}
          </View>

          <View style={styles.prefGroup}>
            <Text style={styles.prefGroupTitle}>Pagamentos</Text>
            {PREF_KEYS.slice(4, 7).map((item, i, arr) => (
              <View key={item.key}>
                <View style={styles.prefRow}>
                  <View style={styles.prefText}>
                    <Text style={styles.prefLabel}>{item.title}</Text>
                    {item.desc ? <Text style={styles.prefSub}>{item.desc}</Text> : null}
                  </View>
                  <Switch
                    value={prefs[item.key] ?? true}
                    onValueChange={(v) => void setPref(item.key, v)}
                    trackColor={{ false: '#E5E7EB', true: '#111827' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                {i < arr.length - 1 ? <View style={styles.prefSep} /> : null}
              </View>
            ))}
          </View>

          <View style={styles.prefGroup}>
            <Text style={styles.prefGroupTitle}>Recomendações e novidades</Text>
            {PREF_KEYS.slice(7, 9).map((item, i) => (
              <View key={item.key}>
                <View style={styles.prefRow}>
                  <View style={styles.prefText}>
                    <Text style={styles.prefLabel}>{item.title}</Text>
                    {item.desc ? <Text style={styles.prefSub}>{item.desc}</Text> : null}
                  </View>
                  <Switch
                    value={prefs[item.key] ?? true}
                    onValueChange={(v) => void setPref(item.key, v)}
                    trackColor={{ false: '#E5E7EB', true: '#111827' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                {i < 1 ? <View style={styles.prefSep} /> : null}
              </View>
            ))}
          </View>

          <View style={styles.prefGroup}>
            <Text style={styles.prefGroupTitle}>Ações gerais</Text>
            {PREF_KEYS.slice(9, 10).map((item) => (
              <View key={item.key} style={styles.prefRow}>
                <Text style={styles.prefLabel}>{item.title}</Text>
                <Switch
                  value={prefs[item.key] ?? false}
                  onValueChange={(v) => void setPref(item.key, v)}
                  trackColor={{ false: '#E5E7EB', true: '#111827' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { color: '#9CA3AF', fontSize: 15, textAlign: 'center' },
  emptyHint: { color: '#D1D5DB', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  emptyHintMono: {
    color: '#9CA3AF',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 15,
    paddingHorizontal: 12,
  },
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
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  tabItem: { flex: 1, alignItems: 'center', paddingBottom: 10, paddingTop: 4, position: 'relative' },
  tabLabel: { fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  tabLabelActive: { color: '#111827', fontWeight: '700' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: '#111827',
    borderRadius: 1,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
    marginTop: 18,
    marginLeft: -4,
    marginRight: -10,
  },
  bellCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: 15, fontWeight: '500', color: '#111827', marginBottom: 4 },
  notifTitleBold: { fontWeight: '700' },
  notifBody: { fontSize: 13, color: '#6B7280', lineHeight: 18, marginBottom: 6 },
  notifDate: { fontSize: 12, color: '#9CA3AF' },
  notifSep: { position: 'absolute', bottom: 0, left: 78, right: 20, height: 1, backgroundColor: '#F3F4F6' },
  configScroll: { paddingHorizontal: 20, paddingBottom: 40 },
  prefGroup: { marginTop: 28 },
  prefGroupTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 16 },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    gap: 16,
  },
  prefText: { flex: 1 },
  prefLabel: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  prefSub: { fontSize: 13, color: '#6B7280', lineHeight: 17 },
  prefSep: { height: 1, backgroundColor: '#F3F4F6' },
});
