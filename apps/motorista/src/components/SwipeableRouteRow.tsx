import { useRef, useCallback, useEffect, type ReactNode } from 'react';
import { View, Animated, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';

const DELETE_WIDTH = 56;

type Props = {
  children: ReactNode;
  /** Conteúdo do botão excluir (ícone + hit area) */
  deleteAction: ReactNode;
  /** true = linha aberta (só uma por vez no pai) */
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/**
 * Deslize para a **esquerda** revela a ação à **direita** (lixeira).
 */
export function SwipeableRouteRow({ children, deleteAction, isOpen, onOpen, onClose }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  /** Largura fixa a partir da janela — evita `onLayout` + `setState` que em RN pode entrar em loop e travar a lista. */
  const effectiveClip = Math.max(200, windowWidth - 40);
  const translateX = useRef(new Animated.Value(0)).current;
  const startX = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      translateX.stopAnimation();
      translateX.setValue(0);
      startX.current = 0;
    }
  }, [isOpen, translateX]);

  const snapTo = useCallback(
    (to: number) => {
      if (to === -DELETE_WIDTH) onOpen();
      else onClose();
      Animated.spring(translateX, {
        toValue: to,
        useNativeDriver: true,
        friction: 8,
        tension: 80,
      }).start();
      startX.current = to;
    },
    [onClose, onOpen, translateX],
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      // iOS: dentro de um ScrollView, o default (true) faz o ScrollView reivindicar
      // o gesto e disparar onPanResponderTerminate → a linha fechava sozinha e a
      // lixeira "não segurava" na tela. Negar a tomada de posse mantém a linha aberta.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        translateX.stopAnimation((v: number) => {
          startX.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.min(0, Math.max(-DELETE_WIDTH, startX.current + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const current = Math.min(0, Math.max(-DELETE_WIDTH, startX.current + g.dx));
        const threshold = -DELETE_WIDTH / 2;
        const vx = g.vx ?? 0;
        if (current < threshold || vx < -0.45) snapTo(-DELETE_WIDTH);
        else snapTo(0);
      },
      onPanResponderTerminate: (_, g) => {
        // Só chega aqui numa interrupção forçada do SO. Respeita a intenção do
        // gesto (se já passou do limite, mantém aberto) em vez de fechar sempre.
        const current = Math.min(0, Math.max(-DELETE_WIDTH, startX.current + (g?.dx ?? 0)));
        snapTo(current < -DELETE_WIDTH / 2 ? -DELETE_WIDTH : 0);
      },
    }),
  ).current;

  const rowW = effectiveClip + DELETE_WIDTH;

  return (
    <View style={styles.clip}>
      <Animated.View
        style={[styles.row, { width: rowW, transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <View style={{ width: effectiveClip }}>{children}</View>
        <View style={[styles.deleteSlot, { width: DELETE_WIDTH }]}>{deleteAction}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  deleteSlot: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#FECACA',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
});
