import { View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';

type Props = NativeStackScreenProps<ProfileStackParamList, 'CancellationPolicy'>;

const POLICY = `POLÍTICA DE CANCELAMENTO — TAKE-ME

Versão: 3.0 (CDC/LGPD)
Vigência: 03/06/2026
Atendimento: suporte@takeme.app.br
Privacidade (LGPD): privacidade@takeme.app.br

1. Princípio: cancelar não tem taxa para o cliente
O cancelamento não gera taxa de cancelamento ao cliente. O que pode variar é o reembolso do valor já pago, conforme o tipo de serviço e o momento, e — no caso de cancelamento pelo motorista — a aplicação de penalidade ao motorista (seção 4).

2. Reembolso ao cliente, por tipo de serviço
• Corridas (imediatas e agendadas): se o cliente cancelar com pelo menos 2 horas de antecedência do horário, o valor pago é estornado integralmente, de forma automática. Com menos de 2 horas, não há estorno automático.
• Encomendas e envios de dependentes: o reembolso de valores pagos é tratado pelo suporte (não é automático).
• Excursões: cancelamento/realocação e reembolso são tratados pelo suporte, caso a caso.

3. Quando o serviço não é realizado
Se a viagem/envio não for realizado até o dia agendado (motorista não aceitou ou não iniciou), o valor pago ao cliente é estornado integralmente, de forma automática.

4. Cancelamento pelo motorista — penalidade
Quando o cancelamento parte do motorista, o cliente não é cobrado e recebe reembolso integral. Para CORRIDAS, ao cancelar uma viagem já paga, pode ser aplicada penalidade ao motorista: um percentual configurável do valor (atualmente 10%) somado à comissão da plataforma, registrada como pendência e descontada no repasse. Não há penalidade automática para encomenda, dependente ou excursão.
A penalidade pode ser dispensada pela administração mediante justificativa.

5. Reembolsos e estornos
• Quando o estorno é automático, ele é solicitado na hora ao meio de pagamento do cliente; o prazo de efetivação depende do banco/operadora.
• Demais casos (encomendas, dependentes, excursões, contestações) são tratados pelo suporte após análise.
• Pagamentos em dinheiro são tratados pelo suporte.

6. Dúvidas e contestação
Dúvidas sobre cancelamento/penalidade podem ser tratadas pelo suporte.

7. LGPD e uso de dados
Para operar o serviço, prevenir fraudes e resolver disputas, a Take-Me trata dados como eventos do app (aceite, início, cancelamento), registros de geolocalização/rotas e comunicações feitas dentro do app, observando os princípios de finalidade, necessidade e transparência.`;

export function CancellationPolicyScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Política de cancelamento</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.body}>{POLICY}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING, paddingBottom: 12,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  scroll: { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 8 },
  body: { fontSize: 15, color: '#374151', lineHeight: 24 },
});
