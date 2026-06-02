import React from 'react';
import { View, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Text } from './Text';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral700: '#767676',
  neutral100: '#EFEFEF',
  danger: '#B24A44',
};

export type AppAlertModalProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  buttonLabel?: string;
  /** Modo confirmação (2 botões): define o rótulo do botão de confirmar. */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  destructive?: boolean;
};

export function AppAlertModal({
  visible,
  onClose,
  title,
  message,
  buttonLabel = 'OK',
  confirmLabel,
  cancelLabel = 'Cancelar',
  onConfirm,
  destructive,
}: AppAlertModalProps) {
  const isConfirm = !!confirmLabel || !!onConfirm;
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
          {isConfirm ? (
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.rowBtn, styles.cancelBtn]}
                activeOpacity={0.8}
                onPress={onClose}
              >
                <Text style={styles.cancelText}>{cancelLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rowBtn, destructive ? styles.confirmDanger : styles.confirmFill]}
                activeOpacity={0.8}
                onPress={onConfirm}
              >
                <Text style={styles.primaryText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.primary} activeOpacity={0.8} onPress={onClose}>
              <Text style={styles.primaryText}>{buttonLabel}</Text>
            </TouchableOpacity>
          )}
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
  row: { flexDirection: 'row', gap: 12 },
  rowBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtn: { backgroundColor: COLORS.neutral100 },
  cancelText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  confirmFill: { backgroundColor: COLORS.black },
  confirmDanger: { backgroundColor: COLORS.danger },
});
