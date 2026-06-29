import { useRef } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useBottomSafeInset } from '@take-me/shared';
import { Text } from '../Text';
import { useBottomSheetDrag } from '../../hooks/useBottomSheetDrag';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  primaryDisabled?: boolean;
};

export function ProfileModalShell({
  visible,
  onClose,
  title,
  subtitle,
  children,
  primaryLabel = 'Atualizar',
  onPrimaryPress,
  primaryDisabled,
}: Props) {
  const { dragY, panHandlers, resetDrag } = useBottomSheetDrag(onClose);
  const prevVisible = useRef(false);
  if (visible && !prevVisible.current) { resetDrag(); }
  prevVisible.current = visible;
  const bottomInset = useBottomSafeInset({ extra: Platform.OS === 'ios' ? 8 : 16 });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="height"
      >
        <Pressable style={styles.overlay} onPress={onClose} />
        <Animated.View style={[styles.sheet, { paddingBottom: bottomInset, transform: [{ translateY: dragY }] }]}>
          <View style={styles.handleArea} {...panHandlers}>
            <View style={styles.sheetHandle} />
          </View>
          <View style={styles.sheetHeader}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity style={styles.closeCircle} onPress={onClose} hitSlop={12}>
              <Text style={styles.closeX}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            {children}
          </ScrollView>
          {onPrimaryPress ? (
            <TouchableOpacity
              style={[styles.primaryBtn, primaryDisabled && styles.primaryBtnDisabled]}
              onPress={onPrimaryPress}
              disabled={primaryDisabled}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 0,
    maxHeight: '88%',
  },
  handleArea: { paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  titleBlock: { flex: 1, paddingRight: 8 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B7280', lineHeight: 20 },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: { fontSize: 22, color: '#111827', fontWeight: '300', marginTop: -2 },
  scrollBody: { paddingBottom: 16 },
  primaryBtn: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
