import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Image,
  Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ShipmentStackParamList } from '../../navigation/types';
import { useAppAlert } from '../../contexts/AppAlertContext';
import * as ImagePicker from 'expo-image-picker';

type Props = NativeStackScreenProps<ShipmentStackParamList, 'Recipient'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

const MAX_ENCOMENDA_PHOTOS = 8;

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function RecipientScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset({ extra: 16 });
  const { showAlert } = useAppAlert();
  const {
    origin,
    destination,
    whenOption,
    whenLabel,
    scheduledDateId,
    scheduledTimeSlot,
    packageSize,
    packageSizeLabel,
    amountCents,
    pricingSubtotalCents,
    platformFeeCents,
    priceRouteBaseCents,
    pricingRouteId,
    adminPctApplied,
    preparerPayoutCents,
    resolvedBaseId,
    clientPreferredDriverId,
    scheduledTripDepartureAt,
    scheduledTripId,
  } = route.params;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [instructions, setInstructions] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const handlePhoneChange = (text: string) => setPhone(formatPhone(text));

  const pickImages = async () => {
    const remaining = MAX_ENCOMENDA_PHOTOS - photoUris.length;
    if (remaining <= 0) {
      showAlert('Fotos', `Máximo de ${MAX_ENCOMENDA_PHOTOS} fotos.`);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permissão', 'Precisamos de acesso à galeria para adicionar fotos da encomenda.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets?.length) {
      setPhotoUris((prev) =>
        [...prev, ...result.assets.map((a) => a.uri)].slice(0, MAX_ENCOMENDA_PHOTOS)
      );
    }
  };

  const removePhotoAt = (index: number) => {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFazerPedido = () => {
    const nameTrim = name.trim();
    const phoneDigits = phone.replace(/\D/g, '');
    if (!nameTrim) {
      showAlert('Atenção', 'Preencha o nome do destinatário.');
      return;
    }
    if (phoneDigits.length < 10) {
      showAlert('Atenção', 'Preencha o telefone do destinatário com DDD e número.');
      return;
    }
    const recipientPayload = {
      name: nameTrim,
      phone: phoneDigits,
      instructions: instructions.trim() || undefined,
      ...(photoUris.length ? { photoUris } : {}),
    };
    navigation.navigate('ConfirmShipment', {
      origin,
      destination,
      whenOption,
      whenLabel,
      ...(scheduledDateId ? { scheduledDateId } : {}),
      ...(scheduledTimeSlot ? { scheduledTimeSlot } : {}),
      packageSize,
      packageSizeLabel,
      recipient: recipientPayload,
      amountCents,
      pricingSubtotalCents,
      platformFeeCents,
      priceRouteBaseCents,
      pricingRouteId,
      adminPctApplied,
      preparerPayoutCents,
      resolvedBaseId,
      clientPreferredDriverId,
      scheduledTripDepartureAt,
      scheduledTripId,
    });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: bottomInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.title}>Quem vai receber a encomenda?</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.label}>Nome do destinatário</Text>
        <TextInput
          style={styles.input}
          placeholder="Nome completo"
          placeholderTextColor={COLORS.neutral700}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Telefone do destinatário</Text>
        <TextInput
          style={styles.input}
          placeholder="(00) 00000-0000"
          placeholderTextColor={COLORS.neutral700}
          value={phone}
          onChangeText={handlePhoneChange}
          keyboardType="phone-pad"
          maxLength={16}
        />

        <Text style={styles.label}>Instruções para o entregador (opcional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Ex: deixar na portaria..."
          placeholderTextColor={COLORS.neutral700}
          value={instructions}
          onChangeText={setInstructions}
          multiline
          numberOfLines={3}
        />

        <Text style={styles.label}>Fotos da encomenda (opcional, até {MAX_ENCOMENDA_PHOTOS})</Text>
        {photoUris.length === 0 ? (
          <TouchableOpacity style={styles.photoBox} onPress={pickImages} activeOpacity={0.8}>
            <MaterialIcons name="camera-alt" size={32} color={COLORS.neutral700} />
            <Text style={styles.photoPlaceholderText}>Toque para adicionar uma ou mais fotos</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.photoGallery}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoGalleryRow}
            >
              {photoUris.map((uri, idx) => (
                <View key={`${uri}-${idx}`} style={styles.photoThumbWrap}>
                  <Image source={{ uri }} style={styles.photoThumbSmall} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.photoThumbRemove}
                    onPress={() => removePhotoAt(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Remover foto"
                  >
                    <MaterialIcons name="close" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {photoUris.length < MAX_ENCOMENDA_PHOTOS ? (
                <TouchableOpacity style={styles.photoAddTile} onPress={pickImages} activeOpacity={0.85}>
                  <MaterialIcons name="add-a-photo" size={28} color={COLORS.neutral700} />
                </TouchableOpacity>
              ) : null}
            </ScrollView>
            <Text style={styles.photoHint}>Toque em + para incluir mais · ✕ remove a foto</Text>
          </View>
        )}

        <Text style={styles.quoteHint}>
          Valor estimado: R$ {(amountCents / 100).toFixed(2).replace('.', ',')} (subtotal + taxa da plataforma)
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleFazerPedido}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Fazer pedido</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 24 },
  backButton: { marginRight: 12 },
  title: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.black,
    marginBottom: 16,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  photoBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  photoGallery: { marginBottom: 24 },
  photoGalleryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  photoThumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 10,
  },
  photoThumbSmall: { width: '100%', height: '100%', backgroundColor: COLORS.neutral300 },
  photoThumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddTile: {
    width: 88,
    height: 88,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.neutral400,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.neutral300,
    marginRight: 0,
  },
  photoHint: { fontSize: 12, color: COLORS.neutral700, marginTop: 10 },
  photoPlaceholderText: { fontSize: 14, color: COLORS.neutral700, marginTop: 8 },
  quoteHint: { fontSize: 13, color: COLORS.neutral700, marginBottom: 16 },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
