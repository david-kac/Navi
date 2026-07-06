import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { Trash2, Pencil } from 'lucide-react-native';

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const RED = '#C0392B';
const BORDER = 1.354;
const RADIUS = 4;

interface Props {
  visible: boolean;
  categoryName: string;
  canModify: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function CategoryActionSheet({ visible, categoryName, canModify, onClose, onEdit, onDelete }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <Text style={s.title} numberOfLines={1}>{categoryName.toUpperCase()}</Text>

        {canModify ? (
          <>
            <TouchableOpacity style={s.row} onPress={onEdit} activeOpacity={0.7}>
              <Pencil size={16} color={INK} strokeWidth={1.5} />
              <Text style={s.rowTxt}>EDIT CATEGORY</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.row} onPress={onDelete} activeOpacity={0.7}>
              <Trash2 size={16} color={RED} strokeWidth={1.5} />
              <Text style={[s.rowTxt, s.deleteTxt]}>DELETE CATEGORY</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={s.subLabel}>THIS CATEGORY CAN'T BE EDITED</Text>
        )}
        <TouchableOpacity style={s.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={s.cancelTxt}>CANCEL</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: BG,
    borderTopWidth: BORDER, borderLeftWidth: BORDER, borderRightWidth: BORDER, borderColor: INK,
    borderTopLeftRadius: 6, borderTopRightRadius: 6,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 36,
    gap: 10,
  },
  title: { fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, marginBottom: 6 },
  subLabel: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, marginBottom: 2, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 14, paddingVertical: 13 },
  rowTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: INK },
  deleteTxt: { color: RED },
  cancelBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 4 },
  cancelTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: MUTED },
});
