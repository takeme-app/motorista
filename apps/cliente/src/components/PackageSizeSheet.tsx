import {
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
} from 'react-native';
import { useRef, useEffect } from 'react';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useBottomSafeInset } from '@take-me/shared';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

const SLIDE = 400;

export type PackageSize = 'pequeno' | 'medio' | 'grande';

const OPTIONS: { value: PackageSize; label: string; subtitle: string }[] = [
  { value: 'pequeno', label: 'Pequeno', subtitle: 'Cabe em uma mochila' },
  { value: 'medio', label: 'Médio', subtitle: 'Cabe em uma mala de mão' },
  { value: 'grande', label: 'Grande', subtitle: 'Precisa de avaliação do nosso time' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  selectedSize: PackageSize;
  onSelectSize: (size: PackageSize, label: string) => void;
};

export function PackageSizeSheet({ visible, onClose, selectedSize, onSelectSize }: Props) {
  const bottomInset = useBottomSafeInset({ extra: 16 });
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(SLIDE)).current;

  useEffect(() => {
    if (!visible) return;
    overlayOpacity.setValue(0);
    translateY.setValue(SLIDE);
    Animated.sequence([
      Animated.timing(overlayOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlayContainer} pointerEvents="box-none">
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} pointerEvents="none" />
        <Pressable style={styles.overlayTouchable} onPress={onClose} />
        <Animated.View
          style={[styles.sheetContent, { paddingBottom: bottomInset }, { transform: [{ translateY }] }]}
          pointerEvents="box-none"
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Tamanho do pacote</Text>
          {OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.option, selectedSize === opt.value && styles.optionSelected]}
              onPress={() => {
                onSelectSize(opt.value, opt.label);
                onClose();
              }}
              activeOpacity={0.8}
            >
              <View style={styles.optionIcon}>
                <MaterialIcons name="inventory-2" size={28} color={COLORS.black} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel}>{opt.label}</Text>
                <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
              </View>
              <View style={[styles.radio, selectedSize === opt.value && styles.radioSelected]}>
                {selectedSize === opt.value && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayContainer: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  overlayTouchable: { ...StyleSheet.absoluteFillObject },
  sheetContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.neutral400,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.black, marginBottom: 20 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: COLORS.neutral300,
  },
  optionSelected: { backgroundColor: '#E8E8E8' },
  optionIcon: { marginRight: 16 },
  optionTextWrap: { flex: 1 },
  optionLabel: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  optionSubtitle: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.neutral700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: COLORS.black },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.black },
});
