import { useState, useCallback, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { checkMotoristaCanAccessApp, getMotoristaPendingCopy, subtypeToMainRoute } from '../lib/motoristaAccess';

type Props = NativeStackScreenProps<RootStackParamList, 'MotoristaPendingApproval'>;

export function MotoristaPendingApprovalScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState('Cadastro em análise');
  const [message, setMessage] = useState(
    'Seu cadastro está passando por aprovação da equipe administrativa. Você será notificado quando estiver liberado para usar o app.'
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id || cancelled) return;
      const gate = await checkMotoristaCanAccessApp(user.id);
      if (cancelled || gate.kind !== 'pending') return;
      const c = getMotoristaPendingCopy(gate.status);
      setTitle(c.title);
      setMessage(c.message);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
        return;
      }
      const gate = await checkMotoristaCanAccessApp(user.id);
      if (gate.kind === 'active') {
        navigation.reset({ index: 0, routes: [{ name: subtypeToMainRoute(gate.subtype, gate.role) }] });
        return;
      }
      if (gate.kind === 'needs_stripe_connect') {
        navigation.reset({ index: 0, routes: [{ name: 'StripeConnectSetup', params: { subtype: gate.subtype } }] });
        return;
      }
      if (gate.kind === 'pending') {
        const c = getMotoristaPendingCopy(gate.status);
        setTitle(c.title);
        setMessage(c.message);
      }
    } finally {
      setRefreshing(false);
    }
  }, [navigation]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="dark" />
      <View style={styles.iconWrap}>
        <View style={styles.circle}>
          <Text style={styles.circleText}>⏳</Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Text style={styles.hint}>
        Quando a equipe aprovar seu cadastro, toque em &quot;Atualizar status&quot; para entrar no app.
      </Text>

      <TouchableOpacity
        style={[styles.primary, refreshing && styles.btnDisabled]}
        onPress={handleRefresh}
        disabled={refreshing}
        activeOpacity={0.85}
      >
        {refreshing ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.primaryText}>Atualizar status</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondary} onPress={handleSignOut} activeOpacity={0.85}>
        <Text style={styles.secondaryText}>Voltar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: { marginBottom: 20 },
  circle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: { fontSize: 32 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 12 },
  message: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  hint: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 18, marginBottom: 28 },
  primary: {
    alignSelf: 'stretch',
    backgroundColor: '#000000',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDisabled: { opacity: 0.7 },
  primaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondary: { alignSelf: 'stretch', paddingVertical: 14, alignItems: 'center' },
  secondaryText: { fontSize: 16, fontWeight: '600', color: '#374151' },
});
