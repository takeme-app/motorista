import { useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
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
import { displayCpf as formatCpfDisplay } from '../../utils/formatCpf';
import { displayEmail as computeDisplayEmail } from '../../utils/loginMethod';

type Props = NativeStackScreenProps<ProfileStackParamList, 'PersonalInfo'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  avatarEditFill: '#2b338a',
  avatarEditStroke: '#f3f4f6',
};

const AVATAR_SIZE = 78;

function formatPhoneDisplay(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 11) {
    if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

export function PersonalInfoScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<{
    full_name: string | null;
    phone: string | null;
    cpf: string | null;
    city: string | null;
    state: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [email, setEmail] = useState<string>('');
  const [authFallback, setAuthFallback] = useState<{ full_name: string; phone: string }>({ full_name: '', phone: '' });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setLoading(false);
      return;
    }
    setEmail(computeDisplayEmail(user));
    const nameFromAuth = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? '').trim();
    const phoneFromAuth = (user.user_metadata?.phone ?? '').trim();
    setAuthFallback({ full_name: nameFromAuth, phone: phoneFromAuth });

    const { data: row, error } = await supabase
      .from('profiles')
      .select('full_name, phone, cpf, city, state, avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const phoneNorm = (phoneFromAuth || '').replace(/\D/g, '').trim() || null;
    if (!row) {
      await supabase.from('profiles').upsert(
        {
          id: user.id,
          full_name: nameFromAuth || null,
          phone: phoneNorm,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      const { data: refetched } = await supabase
        .from('profiles')
        .select('full_name, phone, cpf, city, state, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      setProfile(refetched ?? null);
    } else {
      setProfile(row);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const avatarUrl = profile?.avatar_url
    ? (profile.avatar_url.startsWith('http') ? profile.avatar_url : `${supabaseUrl}/storage/v1/object/public/avatars/${profile.avatar_url}`)
    : null;
  const displayName = profile?.full_name?.trim() || authFallback.full_name || '—';
  const displayPhone = formatPhoneDisplay(profile?.phone || authFallback.phone) || '—';
  const displayCpf = formatCpfDisplay(profile?.cpf ?? null);
  const displayLocation = [profile?.city, profile?.state].filter(Boolean).join(' - ') || '—';
  const displayEmail = email || '—';

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
      {/* Navbar: botão fechar à esquerda, título centralizado (Figma 288:6988) */}
      <View style={styles.navbar}>
        <TouchableOpacity
          style={styles.navbarButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.navbarTitle} numberOfLines={1}>Informações pessoais</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Foto de perfil 78px com badge de edição (Figma 288:6950) */}
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={() => navigation.navigate('EditAvatar')}
          activeOpacity={0.8}
        >
          {avatarUrl ? (
            <Image key={avatarUrl} source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {(displayName !== '—' ? displayName : 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <MaterialIcons name="edit" size={12} color={COLORS.avatarEditStroke} />
          </View>
        </TouchableOpacity>

        {/* Lista: cada linha com label em cima, valor embaixo, borda inferior, chevron à direita (Figma 288:7082) */}
        <View style={styles.list}>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('EditName')} activeOpacity={0.7}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Nome</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{displayName}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.neutral700} />
          </TouchableOpacity>
          <View style={styles.rowBorder} />
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('EditEmail')} activeOpacity={0.7}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{displayEmail}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.neutral700} />
          </TouchableOpacity>
          <View style={styles.rowBorder} />
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('EditPhone')} activeOpacity={0.7}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Telefone</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{displayPhone}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.neutral700} />
          </TouchableOpacity>
          <View style={styles.rowBorder} />
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('EditCpf')} activeOpacity={0.7}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>CPF</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{displayCpf}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.neutral700} />
          </TouchableOpacity>
          <View style={styles.rowBorder} />
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('EditLocation')} activeOpacity={0.7}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Localidade</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{displayLocation}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.neutral700} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  navbarTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 48 },
  avatarWrap: { position: 'relative', alignSelf: 'flex-start', marginBottom: 24 },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 28, fontWeight: '700', color: COLORS.black },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.avatarEditFill,
    borderWidth: 2,
    borderColor: COLORS.avatarEditStroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  rowContent: { flex: 1, minWidth: 0, marginRight: 12 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: COLORS.black, marginBottom: 4 },
  rowValue: { fontSize: 14, fontWeight: '400', color: COLORS.neutral700 },
  rowBorder: { height: 1, backgroundColor: COLORS.neutral400 },
});
