import { useEffect } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { checkMotoristaCanAccessApp, subtypeToMainRoute } from '../lib/motoristaAccess';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

const SPLASH_MIN_MS = 500;

export function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    let mounted = true;
    const start = Date.now();

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const elapsed = Date.now() - start;
      const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
      await new Promise((r) => setTimeout(r, wait));

      if (!mounted) return;
      if (!session?.user) {
        navigation.replace('Welcome');
        return;
      }

      const gate = await checkMotoristaCanAccessApp(session.user.id);
      if (!mounted) return;
      if (gate.kind === 'active') {
        navigation.replace(subtypeToMainRoute(gate.subtype, gate.role));
      } else if (gate.kind === 'needs_stripe_connect') {
        navigation.replace('StripeConnectSetup', { subtype: gate.subtype });
      } else if (gate.kind === 'needs_profile_completion') {
        const rt = gate.registrationType;
        if (rt === 'preparador_excursões') navigation.replace('CompletePreparadorExcursoes');
        else if (rt === 'preparador_encomendas') navigation.replace('CompletePreparadorEncomendas');
        else navigation.replace('CompleteDriverRegistration', {
          driverType: rt === 'parceiro' ? 'parceiro' : 'take_me',
        });
      } else if (gate.kind === 'pending') {
        navigation.replace('MotoristaPendingApproval');
      } else {
        navigation.replace('Welcome');
      }
    })();

    return () => { mounted = false; };
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Image
        source={require('../../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 280,
    height: 112,
  },
});
