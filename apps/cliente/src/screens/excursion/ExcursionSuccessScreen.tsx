import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ExcursionStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ExcursionStackParamList, 'ExcursionSuccess'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral700: '#767676',
};

export function ExcursionSuccessScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const bottomInset = useBottomSafeInset();
  const goToActivities = () => {
    navigation.getParent()?.navigate('Main', { screen: 'Activities' });
  };

  const goToHome = () => {
    navigation.getParent()?.navigate('Main');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: bottomInset }]}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="check" size={48} color="#FFFFFF" />
        </View>
        <Text style={styles.title}>Solicitação enviada com sucesso!</Text>
        <Text style={styles.body}>
          Sua solicitação foi recebida e nossa equipe entrará em contato em breve com o orçamento da excursão.
        </Text>
        <Text style={styles.body}>
          Enquanto isso, você pode acompanhar os detalhes da sua solicitação em{' '}
          <Text style={styles.link} onPress={goToActivities}>Atividades</Text>.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={goToActivities} activeOpacity={0.8}>
          <Text style={styles.primaryButtonText}>Ver em Atividades</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryLink} onPress={goToHome} activeOpacity={0.8}>
          <Text style={styles.secondaryLinkText}>Voltar para Início</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 24 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.black,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.black, textAlign: 'center', marginBottom: 16 },
  body: { fontSize: 14, color: COLORS.neutral700, textAlign: 'center', marginBottom: 12 },
  link: { fontSize: 14, color: COLORS.black, fontWeight: '600', textDecorationLine: 'underline' },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondaryLink: {},
  secondaryLinkText: { fontSize: 15, color: COLORS.black, fontWeight: '500' },
});
