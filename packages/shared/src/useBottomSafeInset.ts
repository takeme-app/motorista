import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Options = {
  extra?: number;
  androidMin?: number;
  androidThreshold?: number;
};

// No Android edge-to-edge com navbar de 3 botões, `insets.bottom` vem 0 — força
// um mínimo pra CTAs/sheets não ficarem cobertos pela barra do sistema.
export function useBottomSafeInset(options: Options = {}): number {
  const { extra = 0, androidMin = 48, androidThreshold = 24 } = options;
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const raw = insets.bottom;
    const base =
      Platform.OS === 'android' && raw < androidThreshold
        ? Math.max(raw, androidMin)
        : raw;
    return base + extra;
  }, [insets.bottom, extra, androidMin, androidThreshold]);
}
