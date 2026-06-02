import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ShipmentStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ShipmentStackParamList, 'ShipmentSuccess'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral700: '#767676',
};

export function ShipmentSuccessScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { orderId, isLargePackage, paymentProcessed } = route.params;

  const goToActivities = () => {
    navigation.getParent()?.navigate('Main', { screen: 'Activities' });
  };

  const goToHome = () => {
    navigation.getParent()?.navigate('Main');
  };

  const openEncomendasChat = () => {
    navigation.getParent()?.navigate('Main', {
      screen: 'Activities',
      params: { screen: 'Chat', params: { contactName: 'Time de Encomendas' } },
    });
  };

  const isReviewVariant = isLargePackage || !paymentProcessed;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: bottomInset }]}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <MaterialIcons
            name={isReviewVariant ? 'inventory-2' : 'check'}
            size={48}
            color="#FFFFFF"
          />
        </View>
        {isReviewVariant ? (
          <>
            <Text style={styles.title}>Sua solicitação foi enviada</Text>
            {isLargePackage && (
              <>
                <Text style={styles.body}>
                  Como o pacote é grande, nossa equipe vai revisar as informações antes de confirmar o envio.
                </Text>
                <Text style={styles.body}>
                  Nosso time de encomendas entrará em contato por chat ou WhatsApp para avaliar sua solicitação.
                </Text>
              </>
            )}
            <Text style={styles.body}>
              {isLargePackage
                ? 'Você receberá uma notificação assim que for aprovado. '
                : ''}Enquanto isso, pode acompanhar o status em{' '}
              <Text style={styles.link} onPress={goToActivities}>Atividades</Text>.
            </Text>
            {isLargePackage && (
              <TouchableOpacity style={styles.chatButton} onPress={openEncomendasChat} activeOpacity={0.8}>
                <Text style={styles.chatButtonText}>Falar com o time</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>Envio confirmado com sucesso!</Text>
            <Text style={styles.body}>
              Seu pagamento foi processado e o motorista será notificado em breve. Você pode acompanhar todas as atualizações em{' '}
              <Text style={styles.link} onPress={goToActivities}>Atividades</Text>.
            </Text>
          </>
        )}
        <TouchableOpacity style={styles.primaryButton} onPress={goToActivities} activeOpacity={0.8}>
          <Text style={styles.primaryButtonText}>Ver em Atividades</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryLink} onPress={goToHome} activeOpacity={0.8}>
          <Text style={styles.secondaryLinkText}>
            {isReviewVariant ? 'Voltar ao início' : 'Voltar para Início'}
          </Text>
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: 16,
    color: COLORS.neutral700,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 12,
  },
  link: { color: COLORS.black, fontWeight: '600', textDecorationLine: 'underline' },
  chatButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.black,
    alignItems: 'center',
  },
  chatButtonText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
    alignSelf: 'stretch',
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondaryLink: { marginTop: 16, paddingVertical: 8 },
  secondaryLinkText: { fontSize: 16, fontWeight: '500', color: COLORS.neutral700 },
});
