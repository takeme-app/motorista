import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from '../../navigation/ColetasExcursoesStack';
import { useCallback } from 'react';

type Props = NativeStackScreenProps<ColetasExcursoesStackParamList, 'EmbarqueConcluido'>;

function formatBRL(cents: number | null | undefined): string {
  const v = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  return (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function EmbarqueConcluidoScreen({ navigation, route }: Props) {
  const { boarded, justified, totalExcursion, excursionId, totalAmountCents } = route.params;
  const isVolta = (route.params.phase ?? 'ida') === 'volta';

  const openDetalhes = useCallback(() => {
    navigation.navigate('DetalhesExcursao', { excursionId });
  }, [navigation, excursionId]);

  const goHome = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  const goVolta = useCallback(() => {
    navigation.navigate('RealizarEmbarques', { excursionId, phase: 'volta' });
  }, [navigation, excursionId]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.flex}>
        <View style={styles.cardWrap}>
          <View style={styles.iconOverlap}>
            <View style={styles.checkCircle}>
              <MaterialIcons name="check" size={28} color="#FFFFFF" />
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>
              {isVolta ? 'Embarque de volta concluído!' : 'Embarque concluído com sucesso!'}
            </Text>
            <Text style={styles.subtitle}>
              {isVolta
                ? 'Todos os passageiros do retorno foram registrados.'
                : 'Todos os passageiros foram registrados. A excursão está pronta para partir.'}
            </Text>
            <View style={styles.stats}>
              <StatRow label="Passageiros embarcados" value={String(boarded)} />
              <StatRow label="Ausentes justificados" value={String(justified)} />
              <StatRow label="Passageiros cadastrados" value={String(totalExcursion)} />
              {typeof totalAmountCents === 'number' && totalAmountCents > 0 ? (
                <StatRow label="Total da excursão" value={formatBRL(totalAmountCents)} />
              ) : null}
            </View>
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        {!isVolta && (
          <TouchableOpacity style={styles.btnBlack} onPress={goVolta} activeOpacity={0.88}>
            <Text style={styles.btnBlackText}>Iniciar embarque de volta</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={isVolta ? styles.btnBlack : styles.btnOutline}
          onPress={openDetalhes}
          activeOpacity={0.88}
        >
          <Text style={isVolta ? styles.btnBlackText : styles.btnOutlineText}>Acompanhar excursão</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goHome} activeOpacity={0.7} style={styles.linkWrap}>
          <Text style={styles.linkText}>Voltar ao início</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  cardWrap: { position: 'relative', marginTop: 36 },
  iconOverlap: {
    position: 'absolute',
    top: -28,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#F5F5F5',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 44,
    paddingBottom: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  stats: { gap: 16 },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: { fontSize: 15, color: '#374151' },
  statValue: { fontSize: 15, fontWeight: '700', color: '#111827' },
  footer: { paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  btnBlack: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBlackText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  btnOutline: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#111827',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlineText: { fontSize: 16, fontWeight: '700', color: '#111827' },
  linkWrap: { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 16, fontWeight: '600', color: '#111827' },
});
