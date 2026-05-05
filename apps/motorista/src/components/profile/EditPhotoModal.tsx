import { View, Modal, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Text } from '../Text';
import { MaterialIcons } from '@expo/vector-icons';

type Props = {
  visible: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onChoosePhoto: () => void;
  onRemove: () => void;
  hasPhoto: boolean;
};

export function EditPhotoModal({ visible, onClose, onTakePhoto, onChoosePhoto, onRemove, hasPhoto }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Editar foto</Text>
          <TouchableOpacity style={styles.closeCircle} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeX}>×</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            onClose();
            setTimeout(() => onTakePhoto(), 120);
          }}
          activeOpacity={0.7}
        >
          <MaterialIcons name="photo-camera" size={24} color="#6B7280" />
          <Text style={styles.rowLabel}>Tirar foto</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            onClose();
            setTimeout(() => onChoosePhoto(), 120);
          }}
          activeOpacity={0.7}
        >
          <MaterialIcons name="image" size={24} color="#6B7280" />
          <Text style={styles.rowLabel}>Escolher foto</Text>
        </TouchableOpacity>
        {hasPhoto ? (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              onRemove();
              onClose();
            }}
            activeOpacity={0.7}
          >
            <MaterialIcons name="delete-outline" size={24} color="#B91C1C" />
            <Text style={styles.rowLabelDanger}>Remover foto atual</Text>
          </TouchableOpacity>
        ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: { fontSize: 22, color: '#111827', fontWeight: '300', marginTop: -2 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  rowLabel: { fontSize: 16, color: '#6B7280', fontWeight: '500' },
  rowLabelDanger: { fontSize: 16, color: '#B91C1C', fontWeight: '500' },
});
