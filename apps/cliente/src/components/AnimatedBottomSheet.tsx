import React, { useRef, useEffect, useCallback } from 'react';
import { View, Modal, Pressable, Animated, StyleSheet } from 'react-native';
import { useBottomSafeInset } from '@take-me/shared';

const SLIDE_DISTANCE = 500;
const ANIM_DURATION_OVERLAY = 200;
const ANIM_DURATION_SHEET = 280;

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function AnimatedBottomSheet({ visible, onClose, children }: Props) {
  const bottomInset = useBottomSafeInset({ extra: 16 });
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(SLIDE_DISTANCE)).current;

  useEffect(() => {
    if (!visible) return;
    overlayOpacity.setValue(0);
    sheetTranslateY.setValue(SLIDE_DISTANCE);
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: ANIM_DURATION_OVERLAY,
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: ANIM_DURATION_SHEET,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: SLIDE_DISTANCE,
        duration: ANIM_DURATION_SHEET,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: ANIM_DURATION_OVERLAY,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <View style={styles.container} pointerEvents="box-none">
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} pointerEvents="none" />
        <Pressable style={styles.touchable} onPress={handleClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: bottomInset }, { transform: [{ translateY: sheetTranslateY }] }]}
        >
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  touchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 20,
  },
});
