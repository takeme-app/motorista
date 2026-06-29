import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Linking,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StripeProvider } from './src/lib/stripeNativeBridge';
import Mapbox from '@rnmapbox/maps';
import { RootNavigator } from './src/navigation/RootNavigator';
import { createSessionFromUrl } from './src/lib/oauth';
import { assertClientePassengerOnlyAccount } from './src/lib/clientePassengerOnlyGate';
import { AppAlertProvider } from './src/contexts/AppAlertContext';
import { CurrentLocationProvider } from './src/contexts/CurrentLocationContext';
import { supabase } from './src/lib/supabase';
import { syncClienteProfileFcmToken } from './src/lib/clienteFcm';

const SPLASH_MIN_MS = 500;
const SPLASH_MAX_MS = 10000; // Se passar disso, esconde a splash de qualquer forma (evita travar no Android)

SplashScreen.preventAutoHideAsync();

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
if (mapboxToken) Mapbox.setAccessToken(mapboxToken);

function useAuthDeepLink() {
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url || !url.includes('access_token')) return;
      try {
        const session = await createSessionFromUrl(url);
        if (session?.user) {
          const gate = await assertClientePassengerOnlyAccount(session.user.id);
          if (!gate.ok) {
            await supabase.auth.signOut();
          }
        }
      } catch (_) {
        // ignore
      }
    };
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [ready, setReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<'Welcome' | 'Main'>('Welcome');
  const [splashTimedOut, setSplashTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  useAuthDeepLink();

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const messaging = (await import('@react-native-firebase/messaging')).default;
        unsub = messaging().onTokenRefresh(() => {
          void syncClienteProfileFcmToken();
        });
      } catch (_) {
        /* módulo nativo indisponível (ex.: web) */
      }
    })();
    return () => {
      unsub?.();
    };
  }, []);

  // Pushes em foreground + deeplink ao tocar (foreground/background/killed) são
  // tratados pelo NotificationDeeplinkHandler montado no RootNavigator, que registra
  // o onMessage/Notifee com o callback de navegação.

  const runSessionInit = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return 'Welcome' as const;
    const gate = await assertClientePassengerOnlyAccount(session.user.id);
    if (!gate.ok) {
      await supabase.auth.signOut();
      return 'Welcome' as const;
    }
    return 'Main' as const;
  }, []);

  // Se as fontes nunca carregarem nem derem erro (bug em alguns Androids), força sair da splash após 12s.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!ready) {
        SplashScreen.hideAsync().catch(() => {});
        setSplashTimedOut(true);
        setReady(true);
      }
    }, 12000);
    return () => clearTimeout(t);
  }, [ready]);

  // Splash nativa fica visível até: fontes + sessão + tempo mínimo; aí esconde e abre Welcome ou Main.
  // Timeout máximo evita ficar travado na splash no Android (ex.: getSession lento ou fontes que não disparam fontError).
  useEffect(() => {
    if (!fontsLoaded && !fontError) return;

    let mounted = true;
    const timeoutId = setTimeout(() => {
      if (!mounted) return;
      mounted = false;
      SplashScreen.hideAsync().catch(() => {});
      setSplashTimedOut(true);
      setInitialRoute('Welcome');
      setReady(true);
    }, SPLASH_MAX_MS);

    (async () => {
      try {
        const route = await runSessionInit();
        const elapsed = Date.now() - startTimeRef.current;
        const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
        await new Promise((r) => setTimeout(r, wait));

        if (!mounted) return;
        setInitialRoute(route);
        await SplashScreen.hideAsync();
        setReady(true);
      } catch (_) {
        if (!mounted) return;
        setInitialRoute('Welcome');
        await SplashScreen.hideAsync().catch(() => {});
        setReady(true);
      } finally {
        mounted = false;
        clearTimeout(timeoutId);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [fontsLoaded, fontError, runSessionInit]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const route = await runSessionInit();
      setInitialRoute(route);
      setSplashTimedOut(false);
    } catch (_) {
      setInitialRoute('Welcome');
      setSplashTimedOut(false);
    } finally {
      setRetrying(false);
    }
  }, [runSessionInit]);

  if (!ready) {
    return null;
  }

  if (splashTimedOut) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.avisoWrap} edges={['top', 'bottom']}>
          <Text style={styles.avisoTitle}>Não foi possível conectar</Text>
          <Text style={styles.avisoMessage}>
            Verifique sua internet e tente novamente. O app precisa de conexão para funcionar.
          </Text>
          <TouchableOpacity
            style={[styles.avisoButton, retrying && styles.avisoButtonDisabled]}
            onPress={handleRetry}
            disabled={retrying}
            activeOpacity={0.8}
          >
            {retrying ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.avisoButtonText}>Tentar novamente</Text>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StripeProvider publishableKey={stripePublishableKey}>
        <SafeAreaProvider>
          <CurrentLocationProvider>
            <AppAlertProvider>
              <RootNavigator initialRouteName={initialRoute} />
            </AppAlertProvider>
          </CurrentLocationProvider>
        </SafeAreaProvider>
      </StripeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  avisoWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#fff',
  },
  avisoTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0d0d0d',
    marginBottom: 12,
    textAlign: 'center',
  },
  avisoMessage: {
    fontSize: 16,
    color: '#767676',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  avisoButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: '#0d0d0d',
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
  },
  avisoButtonDisabled: {
    opacity: 0.7,
  },
  avisoButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
