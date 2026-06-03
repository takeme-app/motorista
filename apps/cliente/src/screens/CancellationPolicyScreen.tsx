import { View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../components/Text';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackTypes';

type Props = NativeStackScreenProps<ProfileStackParamList, 'CancellationPolicy'>;

const POLICY = `POLÍTICA DE CANCELAMENTO — TAKE-ME

Versão: 3.0 (CDC/LGPD)
Vigência: 03/06/2026
Atendimento: suporte@takeme.app.br
Privacidade (LGPD): privacidade@takeme.app.br

1. Princípio: cancelar não tem multa
Cancelar uma solicitação na Take-Me NÃO gera multa nem taxa de cancelamento para você. O que pode variar é o reembolso do valor já pago, conforme o momento e o tipo de serviço, como explicado abaixo. As condições aplicáveis são exibidas no app antes da confirmação.

2. Corridas de passageiros (imediatas e agendadas)
• Antes de pagar ou antes de um motorista aceitar: cancelar é livre, sem qualquer cobrança.
• Reembolso integral: se você cancelar com pelo menos 2 horas de antecedência em relação ao horário da viagem, o valor pago é estornado integralmente, de forma automática.
• Com menos de 2 horas: não há estorno automático do valor pago. Se entender que houve algum problema, você pode solicitar revisão pelo suporte.
(A janela de reembolso vigente é sempre exibida no app, na tela de pagamento.)

3. Envios de encomendas e de dependentes
• O cancelamento é feito pelo próprio app, a qualquer momento antes da entrega.
• O reembolso de valores já pagos é tratado pelo suporte (não é automático). Fale com a gente pelo app para avaliarmos o estorno.

4. Excursões
• O cancelamento e a eventual realocação são tratados pelo suporte.
• O reembolso é avaliado caso a caso, conforme o estágio da excursão.

5. Quando o serviço não é realizado
Se a viagem ou o envio não for realizado até o dia agendado (por exemplo, nenhum motorista aceitou ou iniciou o serviço), o valor pago é estornado integralmente, de forma automática.

6. Cancelamento pelo motorista/parceiro
Se o cancelamento partir do motorista/parceiro, você não é cobrado e recebe o reembolso integral do que pagou. Nesses casos, pode haver penalidade ao motorista, conforme as regras da plataforma.

7. Reembolsos e estornos
• Quando o estorno é automático, ele é solicitado na hora ao seu meio de pagamento; o prazo de efetivação depende do banco/operadora/meio utilizado.
• Nos demais casos (encomendas, dependentes, excursões ou contestações), o reembolso é tratado pelo suporte após análise.
• Pagamentos em dinheiro são tratados pelo suporte, com devolução por crédito no app, cupom ou Pix (quando disponível).

8. Dúvidas e contestação
Se você não concordar com um estorno (ou com a ausência dele), fale com o suporte pelo app que avaliaremos o seu caso.

9. LGPD e uso de dados
Para operar o serviço, prevenir fraudes e resolver disputas, a Take-Me trata dados como eventos do app (aceite, início, cancelamento), registros de geolocalização/rotas e comunicações feitas dentro do app, observando os princípios de finalidade, necessidade e transparência, conforme a Política de Privacidade.`;

export function CancellationPolicyScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.body}>{POLICY}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f1f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginTop: 60,
    marginBottom: 16,
  },
  backArrow: { fontSize: 22, color: '#0d0d0d', fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 48 },
  body: { fontSize: 15, color: '#374151', lineHeight: 24 },
});
