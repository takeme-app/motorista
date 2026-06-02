import React, { useState } from 'react';
import { View, TouchableOpacity, TextInput, StyleSheet, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  instruction: string;
  inputPlaceholder?: string;
  submitLabel: string;
  /** Retorne `false` para manter o modal aberto (ex.: código inválido). */
  onSubmit: (code: string) => void | boolean;
  backLabel?: string;
};

export function CodeConfirmModal({
  visible,
  onClose,
  title,
  instruction,
  inputPlaceholder = 'Ex: 1234',
  submitLabel,
  onSubmit,
  backLabel = 'Voltar',
}: Props) {
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    const result = onSubmit(code);
    if (result === false) return;
    setCode('');
    onClose();
  };

  const handleClose = () => {
    setCode('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView style={styles.keyboardRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose} hitSlop={12}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.instruction}>{instruction}</Text>
          <TextInput
            style={styles.input}
            placeholder={inputPlaceholder}
            placeholderTextColor={COLORS.neutral700}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity style={styles.primary} activeOpacity={0.8} onPress={handleSubmit}>
            <Text style={styles.primaryText}>{submitLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} activeOpacity={0.8} onPress={handleClose}>
            <Text style={styles.secondaryText}>{backLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardRoot: { flex: 1 },
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
  closeButton: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.black,
    marginBottom: 8,
  },
  instruction: {
    fontSize: 14,
    color: COLORS.neutral700,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.neutral300,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.black,
    marginBottom: 24,
    textAlign: 'center',
  },
  primary: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: COLORS.black,
    alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondary: { marginTop: 12, paddingVertical: 14, alignItems: 'center' },
  secondaryText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },
});
