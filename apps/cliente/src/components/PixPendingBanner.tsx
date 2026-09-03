import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Text } from './Text';

/**
 * Faixa exibida no detalhe de um pedido cujo Pix real ainda não foi pago, com
 * o caminho de volta ao QR.
 *
 * Sem ela o cliente ficava sem saída: fechar a tela do Pix levava ao detalhe, e
 * do detalhe não havia como voltar ao código — só restava esperar expirar.
 * A tela do Pix está registrada na ActivitiesStack, então navigate direto
 * resolve para as quatro modalidades.
 */
export function PixPendingBanner({ pixChargeId }: { pixChargeId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  if (!pixChargeId) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <MaterialIcons name="schedule" size={18} color="#92400e" />
        <Text style={styles.title}>Aguardando pagamento</Text>
      </View>
      <Text style={styles.body}>
        Este pedido só avança depois que o Pix for identificado.
      </Text>
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('PixPayment', { reopen: true, pixChargeId })}
      >
        <MaterialIcons name="qr-code-2" size={18} color="#FFFFFF" />
        <Text style={styles.buttonText}>Ver código Pix</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fef3c7',
    borderRadius: 14,
    padding: 14,
    // Respira do selo de status logo acima e do conteúdo abaixo.
    marginTop: 10,
    marginBottom: 14,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15, fontWeight: '700', color: '#92400e' },
  body: { fontSize: 13, color: '#92400e' },
  button: {
    marginTop: 6,
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
