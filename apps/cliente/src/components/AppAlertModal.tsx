import React from 'react';
import { View, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Text } from './Text';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

export type AppAlertModalProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  buttonLabel?: string;
  /** Botão secundário opcional (ex.: "Falar com suporte"). */
  secondaryButton?: { label: string; onPress: () => void };
};

export function AppAlertModal({
  visible,
  onClose,
  title,
  message,
  buttonLabel = 'OK',
  secondaryButton,
}: AppAlertModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {secondaryButton ? (
            <TouchableOpacity
              style={styles.secondary}
              activeOpacity={0.8}
              onPress={() => {
                onClose();
                secondaryButton.onPress();
              }}
            >
              <Text style={styles.secondaryText}>{secondaryButton.label}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.primary} activeOpacity={0.8} onPress={onClose}>
            <Text style={styles.primaryText}>{buttonLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.black,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: COLORS.neutral700,
    textAlign: 'center',
    marginBottom: 24,
  },
  primary: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: COLORS.black,
    alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondary: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryText: { fontSize: 15, fontWeight: '600', color: COLORS.black },
});
