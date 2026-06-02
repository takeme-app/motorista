import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import { supabase } from '../../lib/supabase';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ExcursionPassengerList'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

type Passenger = {
  id: string;
  full_name: string;
  phone: string | null;
  status_departure: string;
  status_return: string;
};

function statusLabel(s: string): string {
  switch (s) {
    case 'embarked': return 'Embarcado';
    case 'disembarked': return 'Desembarcado';
    default: return 'Não embarcado';
  }
}

function getExcursionStatusMessage(status: string): { text: string; icon: 'celebration' | 'schedule' | 'check-circle' | 'cancel' } {
  switch (status) {
    case 'completed':
      return { text: 'Excursão concluída! Obrigado por viajar com a Take Me.', icon: 'check-circle' };
    case 'cancelled':
      return { text: 'Esta excursão foi cancelada.', icon: 'cancel' };
    case 'approved':
    case 'scheduled':
    case 'in_progress':
      return { text: 'Sua excursão foi confirmada! No dia da viagem, você poderá acompanhar o trajeto em tempo real.', icon: 'celebration' };
    default:
      return { text: 'Sua solicitação está em análise. Assim que a excursão for confirmada, você poderá acompanhar o trajeto em tempo real.', icon: 'schedule' };
  }
}

export function ExcursionPassengerListScreen({ navigation, route }: Props) {
  const excursionRequestId = route.params?.excursionRequestId ?? '';
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [excursionStatus, setExcursionStatus] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<'ida' | 'volta'>('ida');

  const loadPassengers = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !excursionRequestId) {
      setLoading(false);
      return;
    }
    const [passengersRes, requestRes] = await Promise.all([
      supabase
        .from('excursion_passengers')
        .select('id, full_name, phone, status_departure, status_return')
        .eq('excursion_request_id', excursionRequestId)
        .order('created_at', { ascending: true }),
      supabase
        .from('excursion_requests')
        .select('status')
        .eq('id', excursionRequestId)
        .eq('user_id', user.id)
        .single(),
    ]);
    if (passengersRes.error) {
      setLoading(false);
      return;
    }
    setPassengers((passengersRes.data ?? []) as Passenger[]);
    setExcursionStatus((requestRes.data as { status?: string } | null)?.status ?? 'pending');
    setLoading(false);
  }, [excursionRequestId]);

  // Recarrega sempre que a tela ganha foco (ex.: ao voltar do cadastro de
  // passageiro), garantindo que a lista reflita o passageiro recém-adicionado.
  useFocusEffect(
    useCallback(() => {
      loadPassengers();
    }, [loadPassengers]),
  );

  const statusForSegment = (p: Passenger) => segment === 'ida' ? p.status_departure : p.status_return;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Lista de Passageiros - {segment === 'ida' ? 'Ida' : 'Volta'}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Lista de Passageiros - {segment === 'ida' ? 'Ida' : 'Volta'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.segmentRow}>
        <TouchableOpacity
          style={[styles.segmentButton, segment === 'ida' && styles.segmentButtonActive]}
          onPress={() => setSegment('ida')}
        >
          <Text style={[styles.segmentText, segment === 'ida' && styles.segmentTextActive]}>Viagem de ida</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, segment === 'volta' && styles.segmentButtonActive]}
          onPress={() => setSegment('volta')}
        >
          <Text style={[styles.segmentText, segment === 'volta' && styles.segmentTextActive]}>Viagem de volta</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Passageiros da excursão</Text>
      <Text style={styles.sectionSubtitle}>Veja todos os participantes cadastrados e seus dados de contato.</Text>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {passengers.map((p) => (
          <View key={p.id} style={styles.passengerCard}>
            <MaterialIcons name="person-outline" size={24} color={COLORS.neutral700} />
            <View style={styles.passengerInfo}>
              <View style={styles.passengerRow}>
                <Text style={styles.passengerName}>{p.full_name}</Text>
                <View style={styles.statusTag}>
                  <MaterialIcons
                    name={statusForSegment(p) === 'embarked' || statusForSegment(p) === 'disembarked' ? 'check-circle' : 'schedule'}
                    size={14}
                    color={COLORS.neutral700}
                  />
                  <Text style={styles.statusTagText}>{statusLabel(statusForSegment(p))}</Text>
                </View>
              </View>
              {p.phone && <Text style={styles.passengerPhone}>Telefone: {p.phone}</Text>}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={styles.addRow}
          onPress={() => navigation.navigate('ExcursionPassengerForm', { excursionRequestId })}
        >
          <Text style={styles.addRowText}>+ Adicionar novo passageiro</Text>
        </TouchableOpacity>

        {(() => {
          const { text, icon } = getExcursionStatusMessage(excursionStatus);
          const isCancelled = excursionStatus === 'cancelled';
          return (
            <View style={[styles.confirmationCard, isCancelled && styles.confirmationCardCancelled]}>
              <MaterialIcons name={icon as any} size={32} color={isCancelled ? COLORS.neutral700 : COLORS.neutral700} />
              <Text style={styles.confirmationText}>{text}</Text>
            </View>
          );
        })()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  closeButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  segmentRow: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 12, gap: 10 },
  segmentButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.neutral300,
  },
  segmentButtonActive: { backgroundColor: COLORS.black },
  segmentText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  segmentTextActive: { color: '#FFFFFF' },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: COLORS.black, paddingHorizontal: 24, marginBottom: 4 },
  sectionSubtitle: { fontSize: 14, color: COLORS.neutral700, paddingHorizontal: 24, marginBottom: 16 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 48 },
  passengerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
    gap: 12,
  },
  passengerInfo: { flex: 1 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  passengerName: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  passengerPhone: { fontSize: 14, color: COLORS.neutral700, marginTop: 2 },
  statusTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.neutral300, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, gap: 4 },
  statusTagText: { fontSize: 12, color: COLORS.neutral700 },
  addRow: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.neutral400 },
  addRowText: { fontSize: 15, fontWeight: '600', color: COLORS.black },
  confirmationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEF9C3',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
  },
  confirmationCardCancelled: {
    backgroundColor: COLORS.neutral300,
  },
  confirmationText: { fontSize: 14, color: COLORS.black, flex: 1 },
});
