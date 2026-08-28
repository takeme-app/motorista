import { useState, useEffect } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { Text } from '../Text';
import { ProfileModalShell } from './ProfileModalShell';
import { onlyDigits } from '../../utils/formatCpf';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  onSave: (value: string) => Promise<void> | void;
  /** Guarda só dígitos (idade, telefone, anos). */
  digitsOnly?: boolean;
  /** Ex.: formatPhoneBR para telefone. */
  formatDisplay?: (stored: string) => string;
  /**
   * Desliga autocorreção/capitalização. Obrigatório em campos onde o valor é
   * um identificador exato (ex.: chave Pix) — o autocorretor do iOS altera o
   * texto e o motorista salvaria uma chave inválida sem perceber.
   */
  rawText?: boolean;
};

export function SingleFieldModal({
  visible,
  onClose,
  title,
  subtitle,
  label,
  initialValue,
  placeholder,
  keyboardType = 'default',
  onSave,
  digitsOnly,
  formatDisplay,
  rawText,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setValue(digitsOnly ? onlyDigits(initialValue) : initialValue);
  }, [visible, initialValue, digitsOnly]);

  const handleChange = (t: string) => {
    if (digitsOnly) setValue(onlyDigits(t));
    else setValue(t);
  };

  const shown = formatDisplay ? formatDisplay(value) : value;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileModalShell
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      primaryLabel="Atualizar"
      onPrimaryPress={handleSave}
      primaryDisabled={saving}
    >
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={shown}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        autoCapitalize={rawText || keyboardType === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={rawText || keyboardType === 'email-address' ? false : true}
      />
    </ProfileModalShell>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 8 },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
});
