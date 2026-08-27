import React from 'react';
import { View, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import { AnimatedBottomSheet } from './AnimatedBottomSheet';
import {
  SUPPORT_PHONE_TEL_URL as SUPPORT_PHONE,
  SUPPORT_WHATSAPP_URL as SUPPORT_WHATSAPP,
} from '@take-me/shared';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral700: '#767676',
  yellowLight: '#FEF3C7',
  yellowCircle: '#FBBF24',
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onOpenSupportChat?: () => void;
  onOpenDriverChat?: () => void;
  showDriverChat?: boolean;
};

export function SupportSheet({ visible, onClose, onOpenSupportChat, onOpenDriverChat, showDriverChat }: Props) {
  const handleCall = () => {
    onClose();
    Linking.openURL(SUPPORT_PHONE);
  };

  const handleWhatsApp = () => {
    onClose();
    Linking.openURL(SUPPORT_WHATSAPP);
  };

  const handleSupportChat = () => {
    onClose();
    onOpenSupportChat?.();
  };

  const handleDriverChat = () => {
    onClose();
    onOpenDriverChat?.();
  };

  return (
    <AnimatedBottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Como podemos ajudar?</Text>
          <Text style={styles.subtitle}>Escolha uma das opções abaixo{'\n'}para entrar em contato</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.optionCard} onPress={handleCall} activeOpacity={0.8}>
        <View style={styles.optionIconCircle}>
          <MaterialIcons name="phone" size={22} color={COLORS.black} />
        </View>
        <Text style={styles.optionLabel}>Ligar para o suporte Take Me</Text>
      </TouchableOpacity>

      {showDriverChat && (
        <TouchableOpacity style={styles.optionCard} onPress={handleDriverChat} activeOpacity={0.8}>
          <View style={styles.optionIconCircle}>
            <MaterialIcons name="chat-bubble-outline" size={22} color={COLORS.black} />
          </View>
          <Text style={styles.optionLabel}>Chat com o motorista</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.optionCard} onPress={handleSupportChat} activeOpacity={0.8}>
        <View style={styles.optionIconCircle}>
          <MaterialIcons name="headset-mic" size={22} color={COLORS.black} />
        </View>
        <Text style={styles.optionLabel}>Chat com o suporte Take Me</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.optionCard} onPress={handleWhatsApp} activeOpacity={0.8}>
        <View style={styles.optionIconCircle}>
          <MaterialIcons name="chat" size={22} color={COLORS.black} />
        </View>
        <Text style={styles.optionLabel}>WhatsApp do Take Me</Text>
      </TouchableOpacity>
    </AnimatedBottomSheet>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerTextWrap: { flex: 1, marginRight: 16 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.black,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.neutral700,
    lineHeight: 20,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.yellowLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  optionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.yellowCircle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.black,
    flex: 1,
  },
});
