import {
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  ScrollView,
} from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useBottomSafeInset } from '@take-me/shared';
import { getDateCarouselOptions } from '../lib/dateTimeSlots';
import type { useWhenTimeSelection } from '../hooks/useWhenTimeSelection';

type WhenTimeState = ReturnType<typeof useWhenTimeSelection>;

type Props = {
  state: WhenTimeState;
  whenTitle?: string;
  nowSubtitle?: string;
  laterSubtitle?: string;
};

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

const DAY_OPTIONS = getDateCarouselOptions();

export function WhenTimeSheets({
  state,
  whenTitle = 'Para quando?',
  nowSubtitle = 'Solicitar imediatamente',
  laterSubtitle = 'Agende escolhendo o dia',
}: Props) {
  const bottomInset = useBottomSafeInset({ extra: 16 });
  return (
    <>
      <Modal
        visible={state.whenSheetVisible}
        transparent
        animationType="none"
        onRequestClose={state.closeWhenSheet}
        statusBarTranslucent
      >
        <View style={styles.overlayContainer} pointerEvents="box-none">
          <Animated.View
            style={[styles.overlay, { opacity: state.whenOverlayOpacity }]}
            pointerEvents="none"
          />
          <Pressable style={styles.overlayTouchable} onPress={state.closeWhenSheet} />
          <Animated.View
            style={[styles.sheetContent, { paddingBottom: bottomInset }, { transform: [{ translateY: state.whenSheetTranslateY }] }]}
            pointerEvents="box-none"
          >
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{whenTitle}</Text>

            <TouchableOpacity
              style={[styles.option, state.whenOption === 'now' && styles.optionSelected]}
              onPress={() => state.setWhenOption('now')}
              activeOpacity={0.8}
            >
              <View style={styles.optionIcon}>
                <MaterialIcons name="schedule" size={28} color={COLORS.black} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel}>Agora</Text>
                <Text style={styles.optionSubtitle}>{nowSubtitle}</Text>
              </View>
              <View style={[styles.radio, state.whenOption === 'now' && styles.radioSelected]}>
                {state.whenOption === 'now' && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.option, state.whenOption === 'later' && styles.optionSelected]}
              onPress={() => state.setWhenOption('later')}
              activeOpacity={0.8}
            >
              <View style={styles.optionIcon}>
                <MaterialIcons name="event" size={28} color={COLORS.black} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel}>Mais tarde</Text>
                <Text style={styles.optionSubtitle}>{laterSubtitle}</Text>
              </View>
              <View style={[styles.radio, state.whenOption === 'later' && styles.radioSelected]}>
                {state.whenOption === 'later' && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.continueButton, !state.whenOption && styles.continueButtonDisabled]}
              onPress={state.handleWhenContinue}
              disabled={!state.whenOption}
              activeOpacity={0.8}
            >
              <Text style={styles.continueButtonText}>Continuar</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={state.timeSheetVisible}
        transparent
        animationType="none"
        onRequestClose={state.closeTimeSheet}
        statusBarTranslucent
      >
        <View style={styles.overlayContainer} pointerEvents="box-none">
          <Animated.View
            style={[styles.overlay, { opacity: state.timeSheetOverlayOpacity }]}
            pointerEvents="none"
          />
          <Pressable style={styles.overlayTouchable} onPress={state.closeTimeSheet} />
          <Animated.View
            style={[styles.sheetContent, { paddingBottom: bottomInset }, { transform: [{ translateY: state.timeSheetTranslateY }] }]}
            pointerEvents="box-none"
          >
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Escolha o dia</Text>
            <ScrollView
              style={styles.timeSlotsScroll}
              contentContainerStyle={styles.timeSlotsContent}
            >
              {DAY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={styles.timeSlotRow}
                  onPress={() => state.setSelectedDay(opt.id)}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={styles.timeSlotText}>{opt.dayLabel}</Text>
                    <Text style={styles.daySubLabel}>{opt.dateLabel}</Text>
                  </View>
                  <View
                    style={[styles.radio, state.selectedDay === opt.id && styles.radioSelected]}
                  >
                    {state.selectedDay === opt.id && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.timeFooter}>
              <TouchableOpacity
                style={styles.continueButton}
                onPress={state.handleSelectTime}
                activeOpacity={0.8}
              >
                <Text style={styles.continueButtonText}>Selecionar dia</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={state.closeTimeSheet}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlayContainer: { flex: 1, justifyContent: 'flex-end' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  overlayTouchable: { ...StyleSheet.absoluteFillObject },
  sheetContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.neutral400,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.black,
    marginBottom: 20,
  },
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
  continueButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  continueButtonDisabled: { opacity: 0.4 },
  continueButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  timeSlotsScroll: { maxHeight: 320 },
  timeSlotsContent: { paddingBottom: 8 },
  timeSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  timeSlotText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  daySubLabel: { fontSize: 13, color: COLORS.neutral700, marginTop: 2 },
  timeFooter: { marginTop: 12 },
  cancelButton: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelButtonText: { fontSize: 15, color: COLORS.neutral700, fontWeight: '500' },
});
