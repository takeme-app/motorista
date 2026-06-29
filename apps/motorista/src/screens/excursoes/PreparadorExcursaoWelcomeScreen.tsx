import {
  View,
  StyleSheet,
  ImageBackground,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';

const WELCOME_IMAGE = require('../../../assets/20251016_1011_Organized Travel Preparation_simple_compose_01k7pj8ng1fpwtvbw04vme6m1r 1.png');

type Props = {
  onContinue: () => void;
};

export function PreparadorExcursaoWelcomeScreen({ onContinue }: Props) {
  const insets = useSafeAreaInsets();

  const bottomInset = useBottomSafeInset();
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ImageBackground
        source={WELCOME_IMAGE}
        style={styles.bg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.82)']}
          locations={[0.35, 0.55, 1]}
          style={[styles.gradient, { paddingBottom: bottomInset + 8 }]}
        >
          <Text style={styles.title}>Bem-vindo!</Text>
          <Text style={styles.subtitle}>
            Organize e acompanhe todas as suas excursões em um só lugar
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={onContinue}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Ver excursões"
          >
            <Text style={styles.ctaText}>Ver excursões</Text>
          </TouchableOpacity>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

/** Splash mínimo enquanto decide welcome vs tabs */
export function MainExcursoesBootPlaceholder({ height }: { height: number }) {
  return (
    <View style={[styles.boot, { minHeight: height }]}>
      <ActivityIndicator size="large" color="#111827" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bg: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  gradient: {
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 120,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 24,
    marginBottom: 28,
    maxWidth: 340,
  },
  cta: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
    }),
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  boot: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
