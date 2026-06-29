import { useState } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import { supabase } from '../../lib/supabase';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ShipmentRating'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral700: '#767676',
};

export function ShipmentRatingScreen({ navigation, route }: Props) {
  const shipmentId = route.params?.shipmentId ?? '';
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating < 1) {
      Alert.alert('Avaliação', 'Selecione de 1 a 5 estrelas.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('shipment_ratings').upsert(
      { shipment_id: shipmentId, rating, comment: comment.trim() || null },
      { onConflict: 'shipment_id' }
    );
    setSubmitting(false);
    if (error) {
      Alert.alert('Erro', 'Não foi possível enviar a avaliação. Tente novamente.');
      return;
    }
    navigation.goBack();
  };

  const canSubmit = rating >= 1 && !submitting;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Avaliar envio</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoid} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>Como foi o envio?</Text>
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
          placeholder="Descreva algum comentário sobre o envio..."
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
        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()} disabled={submitting}>
          <Text style={styles.secondaryButtonText}>Agora não</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardAvoid: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f1f1',
  },
  closeButton: { padding: 4, width: 32 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: '600', color: COLORS.black, marginTop: 24, marginBottom: 4 },
  hint: { fontSize: 14, color: COLORS.neutral700, marginBottom: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  starButton: { padding: 4 },
  commentLabel: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 8 },
  optional: { fontWeight: '400', color: COLORS.neutral700 },
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
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { fontSize: 16, fontWeight: '500', color: COLORS.neutral700 },
});
