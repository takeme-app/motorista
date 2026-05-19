import React from 'react';
import { View, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { Text } from './Text';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
  danger: '#dc2626',
};

export type AppConfirmModalProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AppConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  loading = false,
  destructive = false,
  onConfirm,
  onCancel,
}: AppConfirmModalProps) {
  // Em fluxos destrutivos, a ação destrutiva (onConfirm) vai para o slot secundário com
  // texto vermelho; o slot primário (preto) fica com a saída segura (onCancel). Espelha o
  // padrão do app cliente e do iOS HIG: o "default" do diálogo nunca é a ação irreversível.
  const primaryAction = destructive ? onCancel : onConfirm;
  const primaryLabel = destructive ? cancelLabel : confirmLabel;
  const secondaryAction = destructive ? onConfirm : onCancel;
  const secondaryLabel = destructive ? confirmLabel : cancelLabel;
  const primaryShowsSpinner = !destructive && loading;
  const secondaryShowsSpinner = destructive && loading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={loading ? undefined : onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <TouchableOpacity
            style={styles.primary}
            activeOpacity={0.8}
            onPress={primaryAction}
            disabled={loading}
          >
            {primaryShowsSpinner ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryText}>{primaryLabel}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondary}
            activeOpacity={0.8}
            onPress={secondaryAction}
            disabled={loading}
          >
            {secondaryShowsSpinner ? (
              <ActivityIndicator size="small" color={destructive ? '#dc2626' : '#0d0d0d'} />
            ) : (
              <Text style={[styles.secondaryText, destructive && styles.secondaryTextDestructive]}>
                {secondaryLabel}
              </Text>
            )}
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
    marginTop: 12,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
  },
  secondaryText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  secondaryTextDestructive: { color: COLORS.danger },
});
