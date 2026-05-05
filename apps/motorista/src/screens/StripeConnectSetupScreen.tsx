import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import {
  canUseAppWithStripeState,
  checkMotoristaCanAccessApp,
  getStripeConnectState,
  subtypeToMainRoute,
  type StripeConnectState,
} from '../lib/motoristaAccess';
import { clearStripeConnectSetupSkipped, markStripeConnectSetupSkipped } from '../lib/stripeConnectSkip';
import { describeInvokeFailure } from '../utils/edgeFunctionResponse';

function isOpenableHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed);
}

type Props = NativeStackScreenProps<RootStackParamList, 'StripeConnectSetup'>;

const GOLD = '#C9A227';

export function StripeConnectSetupScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stripeState, setStripeState] = useState<StripeConnectState>('none');
  const [stripePendingVerification, setStripePendingVerification] = useState(0);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [expressLoginLoading, setExpressLoginLoading] = useState(false);

  const gateCheckGen = useRef(0);
  const navigateAfterStripeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNavigateAfterStripeTimer = useCallback(() => {
    if (navigateAfterStripeTimerRef.current) {
      clearTimeout(navigateAfterStripeTimerRef.current);
      navigateAfterStripeTimerRef.current = null;
    }
  }, []);

  const navigateAccordingToAccessGate = useCallback(async (userId: string) => {
    const gate = await checkMotoristaCanAccessApp(userId);
    if (gate.kind === 'active') {
      navigation.reset({ index: 0, routes: [{ name: subtypeToMainRoute(gate.subtype, gate.role) }] });
      return;
    }
    if (gate.kind === 'pending') {
      navigation.reset({ index: 0, routes: [{ name: 'MotoristaPendingApproval' }] });
      return;
    }
    if (gate.kind === 'needs_profile_completion') {
      navigation.reset({ index: 0, routes: [{ name: 'MotoristaPendingApproval' }] });
      return;
    }
    if (gate.kind === 'missing_profile') {
      navigation.reset({ index: 0, routes: [{ name: 'SignUpType' }] });
      return;
    }
    if (gate.kind === 'error') {
      await supabase.auth.signOut();
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    }
  }, [navigation]);

  // Sincroniza com a Stripe e lê o banco. `useFocusEffect` sozinho não reexecuta
  // quando o utilizador volta do Safari/Chrome (a tela continua focada na stack).
  const syncStripeGateFromServer = useCallback(async () => {
    const gen = ++gateCheckGen.current;
    setChecking(true);
    try {
      await supabase.functions.invoke('stripe-connect-sync', { body: {} }).catch(() => undefined);
      if (gen !== gateCheckGen.current) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || gen !== gateCheckGen.current) return;
      const { data: wp } = await supabase
        .from('worker_profiles')
        .select('stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due_count, stripe_connect_pending_verification_count')
        .eq('id', user.id)
        .maybeSingle();
      if (gen !== gateCheckGen.current) return;
      const state = getStripeConnectState(wp);
      setStripeState(state);
      setStripePendingVerification(Number(wp?.stripe_connect_pending_verification_count ?? 0) || 0);
      const acct = (wp?.stripe_connect_account_id as string | null | undefined)?.trim() ?? '';
      setStripeAccountId(acct || null);
      if (canUseAppWithStripeState(state)) {
        await clearStripeConnectSetupSkipped(user.id).catch(() => undefined);
        clearNavigateAfterStripeTimer();
        navigateAfterStripeTimerRef.current = setTimeout(() => {
          navigateAfterStripeTimerRef.current = null;
          if (gen === gateCheckGen.current) {
            void navigateAccordingToAccessGate(user.id);
          }
        }, 1500);
      }
    } finally {
      if (gen === gateCheckGen.current) setChecking(false);
    }
  }, [navigateAccordingToAccessGate, clearNavigateAfterStripeTimer]);

  const handleSkip = useCallback(async () => {
    setChecking(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        await markStripeConnectSetupSkipped(user.id).catch(() => undefined);
        await navigateAccordingToAccessGate(user.id);
        return;
      }
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    } finally {
      setChecking(false);
    }
  }, [navigation, navigateAccordingToAccessGate]);

  useFocusEffect(
    useCallback(() => {
      void syncStripeGateFromServer();
      return () => {
        clearNavigateAfterStripeTimer();
      };
    }, [syncStripeGateFromServer, clearNavigateAfterStripeTimer])
  );

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        void syncStripeGateFromServer();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [syncStripeGateFromServer]);

  // Volta do Stripe via deep link: em alguns dispositivos o URL chega sem repetir
  // o ciclo de foco/AppState da forma esperada — forçar sync ao receber o scheme.
  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      if (url.includes('stripe-connect-return')) {
        void syncStripeGateFromServer();
      }
    };
    const sub = Linking.addEventListener('url', onUrl);
    void Linking.getInitialURL().then((u) => {
      if (u?.includes('stripe-connect-return')) void syncStripeGateFromServer();
    });
    return () => sub.remove();
  }, [syncStripeGateFromServer]);

  useEffect(() => () => {
    gateCheckGen.current += 1;
    clearNavigateAfterStripeTimer();
  }, [clearNavigateAfterStripeTimer]);

  const handleSetup = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        setLoading(false);
        return;
      }
      const res = await supabase.functions.invoke('stripe-connect-link', {
        body: {
          return_url: 'take-me-motorista://stripe-connect-return',
          refresh_url: 'take-me-motorista://stripe-connect-return',
          link_type:
            stripeState === 'action_required' || stripeState === 'in_review' ? 'update' : 'onboarding',
        },
      });
      const url = (res.data as { url?: unknown } | null)?.url;
      if (res.error || !isOpenableHttpUrl(url)) {
        const msg = await describeInvokeFailure(res.data, res.error);
        Alert.alert('Erro', msg || 'Não foi possível gerar o link de configuração. Tente novamente.');
        setLoading(false);
        return;
      }
      await Linking.openURL(url);
    } catch (e: unknown) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Falha ao abrir configuracao.');
    }
    setLoading(false);
  };

  const handleExpressLogin = async () => {
    setExpressLoginLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Erro', 'Sessão expirada. Faça login novamente.');
        return;
      }
      const res = await supabase.functions.invoke('stripe-connect-link', {
        body: { flow: 'express_login' },
      });
      const url = (res.data as { url?: unknown } | null)?.url;
      if (res.error || !isOpenableHttpUrl(url)) {
        const msg = await describeInvokeFailure(res.data, res.error);
        Alert.alert('Erro', msg || 'Não foi possível abrir o painel Stripe.');
        return;
      }
      await Linking.openURL(url.trim());
    } catch (e: unknown) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Falha ao abrir o painel Stripe.');
    } finally {
      setExpressLoginLoading(false);
    }
  };

  if (stripeState === 'active') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <MaterialIcons name="check-circle" size={64} color="#22C55E" />
          <Text style={styles.successTitle}>Tudo pronto!</Text>
          <Text style={styles.successSubtitle}>
            Seu recebimento automatico via PIX esta configurado. Redirecionando...
          </Text>
          <ActivityIndicator size="small" color={GOLD} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  if (stripeState === 'in_review') {
    const reviewBody =
      stripePendingVerification > 0
        ? 'Sem concluir o que a Stripe pedir, cartão/Pix e recebimento automático não liberam. Até lá, as viagens ficam em dinheiro e a taxa da plataforma acumula saldo.'
        : 'Cartão/Pix e recebimento automático só liberam após a Stripe aprovar. Enquanto isso, as viagens ficam em dinheiro e a taxa da plataforma acumula saldo.';
    const reviewTitle = 'Ação pendente';
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <MaterialIcons name="hourglass-top" size={64} color="#B45309" />
          <Text style={styles.successTitle}>{reviewTitle}</Text>
          <Text style={styles.successSubtitle}>
            {reviewBody}
          </Text>
          <TouchableOpacity
            style={[styles.btnPrimary, { marginTop: 24, marginHorizontal: 24, alignSelf: 'stretch' }, (loading || checking) && { opacity: 0.6 }]}
            onPress={handleSetup}
            disabled={loading || checking}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialIcons name="open-in-new" size={20} color="#fff" />
                <Text style={styles.btnPrimaryText}>Abrir cadastro na Stripe</Text>
              </>
            )}
          </TouchableOpacity>
          {stripeAccountId ? (
            <TouchableOpacity
              style={{ marginTop: 16, marginHorizontal: 24, alignSelf: 'stretch' }}
              onPress={handleExpressLogin}
              disabled={expressLoginLoading || loading || checking}
              activeOpacity={0.7}
            >
              <Text style={styles.expressLinkText}>
                {expressLoginLoading
                  ? 'Abrindo painel…'
                  : 'Abrir painel Stripe do motorista (pendências e repasses)'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {checking ? <ActivityIndicator size="small" color={GOLD} style={{ marginTop: 16 }} /> : null}
        </View>
      </SafeAreaView>
    );
  }

  const isIncomplete = stripeState === 'incomplete';
  const isActionRequired = stripeState === 'action_required';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={[styles.navbar, { paddingTop: Math.max(8, insets.top > 0 ? 8 : 12) }]}>
        <View style={styles.backBtnPlaceholder} />
        <Text style={styles.navbarTitle}>Configurar recebimento</Text>
        <View style={styles.backBtnPlaceholder} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Configure seu recebimento</Text>
          <Text style={styles.heroSubtitle}>
            Para liberar cartão/Pix e receber seus ganhos automaticamente, configure sua conta de recebimento.
          </Text>
        </View>

        <View style={styles.iconContainer}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="account-balance" size={48} color={GOLD} />
          </View>
        </View>

        {/* Benefits */}
        <View style={styles.benefitsCard}>
          <BenefitRow icon="flash-on" text="Receba automaticamente após cada viagem com cartão/Pix" />
          <BenefitRow icon="pix" text="Depósito direto via PIX na sua conta" />
          <BenefitRow icon="security" text="Seguro e protegido pelo Stripe" />
          <BenefitRow icon="account-balance-wallet" text="Abate automático das taxas acumuladas em dinheiro" />
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          <MaterialIcons name="info-outline" size={20} color="#6B7280" />
          <Text style={styles.infoText}>
            Você será redirecionado para uma página segura do Stripe. Sem Connect aprovado, o passageiro paga em dinheiro e a taxa da plataforma fica como saldo devido para abater depois.
          </Text>
        </View>

        {isIncomplete && (
          <View style={[styles.infoCard, styles.pendingCard]}>
            <MaterialIcons name="hourglass-empty" size={20} color="#B45309" />
            <Text style={[styles.infoText, styles.pendingText]}>
              Seu cadastro no Stripe ainda não foi concluído. Toque em Continuar configuração para retomar o onboarding.
            </Text>
          </View>
        )}

        {isActionRequired && (
          <View style={[styles.infoCard, styles.pendingCard]}>
            <MaterialIcons name="error-outline" size={20} color="#B45309" />
            <Text style={[styles.infoText, styles.pendingText]}>
              A Stripe pediu informações adicionais para liberar o recebimento automático. Toque em Completar informações para enviar os dados pendentes.
            </Text>
          </View>
        )}

        {/* Main CTA */}
        <TouchableOpacity
          style={[styles.btnPrimary, loading && { opacity: 0.6 }]}
          onPress={handleSetup}
          disabled={loading || checking}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialIcons name="arrow-forward" size={20} color="#fff" />
              <Text style={styles.btnPrimaryText}>
                {isActionRequired
                  ? 'Completar informações'
                  : isIncomplete
                    ? 'Continuar configuração'
                    : 'Configurar recebimento automático'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnRefresh}
          onPress={() => {
            void syncStripeGateFromServer();
          }}
          disabled={loading || checking}
          activeOpacity={0.75}
        >
          {checking ? (
            <ActivityIndicator size="small" color="#1D4ED8" />
          ) : (
            <Text style={styles.btnRefreshText}>Já concluí no site da Stripe — toque para atualizar</Text>
          )}
        </TouchableOpacity>

        {stripeAccountId ? (
          <TouchableOpacity
            onPress={handleExpressLogin}
            disabled={expressLoginLoading || loading || checking}
            activeOpacity={0.7}
            style={{ width: '100%', marginBottom: 8 }}
          >
            <Text style={styles.expressLinkText}>
              {expressLoginLoading
                ? 'Abrindo painel Stripe…'
                : 'Abrir painel Stripe do motorista (pendências e repasses)'}
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.btnSkip}
          onPress={() => {
            void handleSkip();
          }}
          disabled={loading || checking}
          activeOpacity={0.7}
        >
          <Text style={styles.btnSkipText}>Pular esta etapa</Text>
        </TouchableOpacity>
        <Text style={styles.skipHint}>
          Você pode configurar depois em Configurações → Pagamentos. Até a aprovação do Connect, as viagens ficam em dinheiro.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}


function BenefitRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefitRow}>
      <MaterialIcons name={icon as any} size={22} color="#22C55E" />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  navbarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0D0D0D',
  },
  backBtnPlaceholder: { width: 36, height: 36 },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0D0D0D',
    lineHeight: 30,
    marginBottom: 8,
    fontFamily: 'Inter_700Bold',
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#767676',
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  iconContainer: { marginBottom: 24 },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFF8E6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  benefitsCard: {
    width: '100%',
    backgroundColor: '#F1F1F1',
    borderRadius: 12,
    padding: 18,
    gap: 14,
    marginBottom: 16,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  benefitText: {
    fontSize: 14,
    color: '#0D0D0D',
    flex: 1,
    fontFamily: 'Inter_500Medium',
  },
  infoCard: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#F1F1F1',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  infoText: {
    fontSize: 13,
    color: '#767676',
    flex: 1,
    lineHeight: 18,
    fontFamily: 'Inter_400Regular',
  },
  btnPrimary: {
    width: '100%',
    height: 48,
    borderRadius: 8,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  btnPrimaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
  },
  btnRefresh: {
    width: '100%',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F1F1F1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  btnRefreshText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0D0D0D',
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
  },
  btnSkip: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 4,
  },
  btnSkipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D0D0D',
    fontFamily: 'Inter_600SemiBold',
  },
  skipHint: {
    fontSize: 12,
    color: '#767676',
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    lineHeight: 16,
    fontFamily: 'Inter_400Regular',
  },
  pendingCard: {
    backgroundColor: '#FEF3C7',
  },
  pendingText: {
    color: '#92400E',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D0D0D',
    marginTop: 16,
    fontFamily: 'Inter_700Bold',
  },
  successSubtitle: {
    fontSize: 14,
    color: '#767676',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  expressLinkText: {
    fontSize: 14,
    color: '#0D0D0D',
    textDecorationLine: 'underline',
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
  },
});
