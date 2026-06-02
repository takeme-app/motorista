import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';

type Props = NativeStackScreenProps<RootStackParamList, 'RegistrationSuccess'>;

export function RegistrationSuccessScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const bottomInset = useBottomSafeInset();
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: bottomInset + 24 }]}>
      <StatusBar style="dark" />
      <View style={styles.iconWrap}>
        <View style={styles.successIconCircle} accessibilityRole="image" accessibilityLabel="Sucesso">
          <MaterialIcons name="check" size={44} color="#FFFFFF" />
        </View>
      </View>
      <Text style={styles.title}>Cadastro enviado com sucesso!</Text>
      <Text style={styles.message}>
        Nossa equipe vai verificar seus documentos e você receberá uma notificação assim que estiver tudo validado.
      </Text>
      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Login')} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Voltar para o login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  iconWrap: { marginBottom: 28 },
  successIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 16 },
  message: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 32, maxWidth: 320 },
  button: { backgroundColor: '#000000', paddingVertical: 16, paddingHorizontal: 48, borderRadius: 12, alignSelf: 'stretch', alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
