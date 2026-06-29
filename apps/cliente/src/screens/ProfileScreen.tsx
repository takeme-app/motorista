import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { unregisterClienteProfileFcmToken } from '../lib/clienteFcm';
import { IconProfileGrid, IconNotifications, IconDependents, IconConversations } from '../components/ProfileGridIcons';
import { useUnreadNotifications } from '../hooks/useUnreadNotifications';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileMain'>;

// Tokens do Figma: brand/light/neutral-100, neutral-300, neutral-400, black-500, red-600, radius-12
const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  danger: '#b53838', // brand/red/red-600 (Figma)
  avatarEditFill: '#2b338a',
  avatarEditStroke: '#f3f4f6',
};

const GRID_ITEMS = [
  { id: 'perfil', label: 'Perfil', icon: 'person' as const, screen: 'PersonalInfo' as const },
  { id: 'carteira', label: 'Carteira', icon: 'account-balance-wallet' as const, screen: 'Wallet' as const },
  { id: 'sobre', label: 'Sobre', icon: 'info-outline' as const, screen: 'About' as const },
  { id: 'notificacoes', label: 'Notificações', icon: 'notifications-outline' as const, screen: 'Notifications' as const },
  { id: 'dependentes', label: 'Dependentes', icon: 'accessible' as const, screen: 'Dependents' as const },
  { id: 'conversas', label: 'Conversas', icon: 'chat-bubble-outline' as const, screen: 'Conversations' as const },
];

export function ProfileScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<{
    full_name: string | null;
    avatar_url: string | null;
    rating: number | null;
    verified: boolean;
  } | null>(null);
  const [nameFallback, setNameFallback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasUnreadNotifications = useUnreadNotifications();

  const loadProfile = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setUnreadNotifications(0);
      setLoading(false);
      return;
    }
    const nameFromAuth =
      (user.user_metadata?.full_name as string)?.trim() ||
      (user.user_metadata?.name as string)?.trim() ||
      (user.email ? user.email.split('@')[0] : null) ||
      null;
    setNameFallback(nameFromAuth);

    const { data: row } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, rating, verified')
      .eq('id', user.id)
      .maybeSingle();
    setProfile(row ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleLogout = async () => {
    await unregisterClienteProfileFcmToken();
    await supabase.auth.signOut();
    const root = navigation.getParent()?.getParent();
    if (root) {
      root.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Splash' }],
        })
      );
    }
  };

  const { width: screenWidth } = useWindowDimensions();
  const displayName = profile?.full_name?.trim() || nameFallback || 'Usuário';
  const rating = profile?.rating ?? null;
  const verified = profile?.verified ?? false;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const avatarDisplayUrl = profile?.avatar_url
    ? (profile.avatar_url.startsWith('http')
        ? profile.avatar_url
        : `${supabaseUrl}/storage/v1/object/public/avatars/${profile.avatar_url}`)
    : null;
  const isNarrowScreen = screenWidth < 400;
  const gridLabelFontSize = isNarrowScreen ? 12 : 14;
  const gridItemPaddingH = isNarrowScreen ? 8 : 16;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: nome do usuário + 2 tags (nota de avaliação + verificado) + avatar — ref. Figma 7 Perfil */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.userName} numberOfLines={1}>
              {displayName}
            </Text>
            <View style={styles.tags}>
              <View style={[styles.tag, styles.tagBorder]}>
                <MaterialIcons name="star" size={19} color={COLORS.black} style={styles.tagIcon} />
                <Text style={styles.tagText}>
                  {rating != null ? Number(rating).toFixed(1) : '—'}
                </Text>
              </View>
              {verified && (
                <View style={[styles.tag, styles.tagBorder]}>
                  <MaterialIcons name="verified" size={19} color={COLORS.black} style={styles.tagIcon} />
                  <Text style={styles.tagText}>Verificado</Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={() => navigation.navigate('PersonalInfo')}
            activeOpacity={0.8}
          >
            {avatarDisplayUrl ? (
              <Image key={avatarDisplayUrl} source={{ uri: avatarDisplayUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <MaterialIcons name="edit" size={12} color={COLORS.avatarEditStroke} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Grid 3x2 (Figma): ícones customizados para Perfil, Notificações e Dependentes */}
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            {GRID_ITEMS.slice(0, 3).map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.gridItem, { paddingHorizontal: gridItemPaddingH }]}
                onPress={() => navigation.navigate(item.screen)}
                activeOpacity={0.7}
              >
                {item.id === 'perfil' ? (
                  <IconProfileGrid color={COLORS.black} width={24} height={24} />
                ) : (
                  <MaterialIcons name={item.icon} size={24} color={COLORS.black} />
                )}
                <Text
                  style={[styles.gridLabel, { fontSize: gridLabelFontSize }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.gridRow}>
            {GRID_ITEMS.slice(3, 6).map((item) => (
              <View key={item.id} style={styles.gridItemWrap}>
                <TouchableOpacity
                  style={[styles.gridItem, { paddingHorizontal: gridItemPaddingH }]}
                  onPress={() => navigation.navigate(item.screen)}
                  activeOpacity={0.7}
                >
                  {item.id === 'notificacoes' ? (
                    <IconNotifications color={COLORS.black} width={24} height={24} />
                  ) : item.id === 'dependentes' ? (
                    <IconDependents color={COLORS.black} width={24} height={24} />
                  ) : item.id === 'conversas' ? (
                    <IconConversations color={COLORS.black} width={24} height={24} />
                  ) : (
                    <MaterialIcons name={item.icon} size={24} color={COLORS.black} />
                  )}
                  <Text
                    style={[styles.gridLabel, { fontSize: gridLabelFontSize }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
                {item.id === 'notificacoes' && hasUnreadNotifications ? (
                  <View style={styles.notificationBadge} accessibilityLabel="Notificações não lidas" />
                ) : null}
              </View>
            ))}
          </View>
        </View>

        {/* Ações: lista com borda inferior apenas (Figma: 48px altura, 24px ícone, 16px texto) */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => navigation.navigate('ChangePassword')}
            activeOpacity={0.7}
          >
            <View style={styles.actionIconWrap}>
              <MaterialIcons name="edit" size={24} color={COLORS.black} />
            </View>
            <Text style={styles.actionText}>Alterar senha</Text>
          </TouchableOpacity>
          <View style={styles.actionDivider} />
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => (navigation.getParent() as any)?.getParent()?.navigate('ForgotPassword')}
            activeOpacity={0.7}
          >
            <View style={styles.actionIconWrap}>
              <MaterialIcons name="lock-outline" size={24} color={COLORS.black} />
            </View>
            <Text style={styles.actionText}>Recuperar senha</Text>
          </TouchableOpacity>
          <View style={styles.actionDivider} />
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => navigation.navigate('DeleteAccountStep1')}
            activeOpacity={0.7}
          >
            <View style={styles.actionIconWrap}>
              <MaterialIcons name="delete-outline" size={24} color={COLORS.danger} />
            </View>
            <Text style={[styles.actionText, styles.actionTextDanger]}>Excluir conta</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutButtonText}>Sair</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  headerLeft: { flex: 1, minWidth: 0, marginRight: 16 },
  userName: { fontSize: 32, fontWeight: '600', color: COLORS.black },
  tags: { flexDirection: 'row', marginTop: 8, gap: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 90,
    gap: 4,
  },
  tagBorder: {
    borderWidth: 1,
    borderColor: COLORS.neutral400,
  },
  tagIcon: { marginRight: 0 },
  tagText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  avatarWrap: { position: 'relative' },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 24, fontWeight: '700', color: COLORS.black },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 12,
    backgroundColor: COLORS.avatarEditFill,
    borderWidth: 2,
    borderColor: COLORS.avatarEditStroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    gap: 16,
    marginBottom: 24,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 16,
  },
  gridItemWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.danger,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  gridItem: {
    flex: 1,
    minWidth: 0,
    height: 84,
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  gridLabel: { fontWeight: '600', color: COLORS.black, textAlign: 'center' },
  actions: {
    marginTop: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingRight: 16,
  },
  actionIconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionText: { fontSize: 16, fontWeight: '500', color: COLORS.black, flex: 1 },
  actionTextDanger: { color: COLORS.danger },
  actionDivider: { height: 1, backgroundColor: COLORS.neutral400, marginLeft: 36 },
  logoutButton: {
    marginTop: 24,
    backgroundColor: COLORS.neutral300,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutButtonText: { fontSize: 15, fontWeight: '500', color: COLORS.neutral700 },
});
