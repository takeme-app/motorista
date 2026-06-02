import { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TripFollowStackParamList } from '../../navigation/types';
import { supabase } from '../../lib/supabase';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { loadBookingTripLiveContext } from '../../lib/clientBookingTripLive';
import { getRouteWithDuration, formatDuration, formatDistanceKmLabel } from '../../lib/route';

type Props = NativeStackScreenProps<TripFollowStackParamList, 'RateTrip'>;

export function RateTripScreen({ navigation, route }: Props) {
  const bookingId = route.params?.bookingId;
  const initialRating = route.params?.initialRating;
  const { showAlert } = useAppAlert();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [durationLabel, setDurationLabel] = useState('—');
  const [distanceLabel, setDistanceLabel] = useState('—');
  const [totalPaidLabel, setTotalPaidLabel] = useState('—');

  useEffect(() => {
    if (!bookingId) {
      setDurationLabel('—');
      setDistanceLabel('—');
      setTotalPaidLabel('—');
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await loadBookingTripLiveContext(bookingId);
      if (cancelled) return;
      if (error || !data) {
        setDurationLabel('—');
        setDistanceLabel('—');
        setTotalPaidLabel('—');
        return;
      }
      const { booking } = data;
      setTotalPaidLabel(`R$ ${(booking.amount_cents / 100).toFixed(2).replace('.', ',')}`);
      const o = { latitude: booking.origin_lat, longitude: booking.origin_lng };
      const d = { latitude: booking.destination_lat, longitude: booking.destination_lng };
      const rt = await getRouteWithDuration(o, d);
      if (cancelled) return;
      if (rt && rt.durationSeconds > 0) {
        setDurationLabel(formatDuration(rt.durationSeconds));
      } else {
        setDurationLabel('—');
      }
      setDistanceLabel(formatDistanceKmLabel(rt?.distanceMeters));
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('booking_ratings')
        .select('rating, comment')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setRating(Number(data.rating));
        setComment(data.comment ?? '');
        return;
      }
      if (initialRating != null && initialRating >= 1 && initialRating <= 5) {
        setRating(initialRating);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, initialRating]);

  const goToMain = () => {
    const nav = navigation as { getState?: () => { routeNames?: string[] }; navigate: (name: string) => void; getParent?: () => { navigate: (name: string) => void; getParent?: () => { navigate: (name: string) => void } } };
    const routeNames = nav.getState?.()?.routeNames;
    if (routeNames?.includes('ActivitiesList')) {
      nav.navigate('ActivitiesList');
      return;
    }
    const tripStack = nav.getParent?.();
    const root = tripStack?.getParent?.();
    if (root?.navigate) {
      root.navigate('Main');
      return;
    }
    tripStack?.navigate?.('Main');
  };

  const handleSubmit = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    try {
      if (bookingId) {
        const { error } = await supabase.from('booking_ratings').upsert(
          { booking_id: bookingId, rating, comment: comment.trim() || null },
          { onConflict: 'booking_id' }
        );
        if (error) throw error;
      }
      showAlert('Avaliação enviada!', 'Obrigado por avaliar sua viagem.', { onClose: goToMain });
    } catch (e) {
      showAlert('Erro', 'Não foi possível enviar a avaliação. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = rating >= 1 && !submitting;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.keyboardAvoid} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      <Text style={styles.title}>Viagem Concluída!</Text>
      <Text style={styles.subtitle}>Obrigado por utilizar o Take Me. Avalie sua experiência.</Text>
      <View style={styles.resumoBox}>
        <View style={styles.resumoRow}>
          <Text style={styles.resumoLabel}>Tempo estimado (rota)</Text>
          <Text style={styles.resumoValue}>{durationLabel}</Text>
        </View>
        <View style={styles.resumoRow}>
          <Text style={styles.resumoLabel}>Distância (rota)</Text>
          <Text style={styles.resumoValue}>{distanceLabel}</Text>
        </View>
        <View style={styles.resumoRow}>
          <Text style={styles.resumoLabel}>Total pago</Text>
          <Text style={styles.resumoValue}>{totalPaidLabel}</Text>
        </View>
      </View>
      <Text style={styles.ratingTitle}>Como foi a sua viagem?</Text>
      <Text style={styles.hint}>(1 = muito insatisfeito, 5 = muito satisfeito)</Text>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => setRating(n)}
            style={styles.starButton}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={n <= rating ? 'star' : 'star-border'}
              size={40}
              color={n <= rating ? '#EAB308' : '#e2e2e2'}
            />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.commentLabel}>Comentário <Text style={styles.optional}>(Opcional)</Text></Text>
      <TextInput
        style={styles.commentInput}
        placeholder="Conte como foi a viagem (opcional)…"
        placeholderTextColor="#767676"
        value={comment}
        onChangeText={setComment}
        multiline
        numberOfLines={3}
      />
      <TouchableOpacity
        style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Enviar avaliação</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={goToMain} disabled={submitting}>
        <Text style={styles.secondaryButtonText}>Agora não</Text>
      </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardAvoid: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#0d0d0d', marginTop: 24, marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#767676', marginBottom: 20, textAlign: 'center' },
  resumoBox: {
    backgroundColor: '#f1f1f1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  resumoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  resumoLabel: { fontSize: 14, color: '#767676' },
  resumoValue: { fontSize: 14, fontWeight: '600', color: '#0d0d0d' },
  ratingTitle: { fontSize: 16, fontWeight: '600', color: '#0d0d0d', marginBottom: 4 },
  hint: { fontSize: 14, color: '#767676', marginBottom: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  starButton: { padding: 4 },
  commentLabel: { fontSize: 14, fontWeight: '600', color: '#0d0d0d', marginBottom: 8 },
  optional: { fontWeight: '400', color: '#767676' },
  commentInput: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#0d0d0d',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  primaryButtonDisabled: { opacity: 0.5 },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { fontSize: 16, fontWeight: '500', color: '#0d0d0d' },
});
