import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const RED = '#C0392B';
const BORDER = 1.354;
const RADIUS = 4;

interface Props {
  visible:           boolean;
  taskTitle:         string;
  isRecurring:       boolean;
  onClose:           () => void;
  onEdit:            () => void;
  onDeleteOccurrence: () => void;
  onDeleteSeries:    () => void;
}

export default function TaskActionSheet({ visible, taskTitle, isRecurring, onClose, onEdit, onDeleteOccurrence, onDeleteSeries }: Props) {
  const [mode, setMode] = useState<'main' | 'confirmDelete'>('main');

  useEffect(() => { if (!visible) setMode('main'); }, [visible]);

  const handleDeletePress = () => {
    if (isRecurring) {
      setMode('confirmDelete');
    } else {
      onDeleteOccurrence();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <Text style={s.title} numberOfLines={1}>{taskTitle}</Text>

        {mode === 'main' ? (
          <>
            <TouchableOpacity style={s.row} onPress={onEdit} activeOpacity={0.7}>
              <Pencil size={16} color={INK} strokeWidth={1.5} />
              <Text style={s.rowTxt}>EDIT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.row} onPress={handleDeletePress} activeOpacity={0.7}>
              <Trash2 size={16} color={RED} strokeWidth={1.5} />
              <Text style={[s.rowTxt, s.deleteTxt]}>DELETE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={s.cancelTxt}>CANCEL</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.subLabel}>THIS IS A RECURRING TASK</Text>
            <TouchableOpacity style={s.row} onPress={onDeleteOccurrence} activeOpacity={0.7}>
              <Text style={[s.rowTxt, s.deleteTxt]}>DELETE THIS ONE ONLY</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.row} onPress={onDeleteSeries} activeOpacity={0.7}>
              <Text style={[s.rowTxt, s.deleteTxt]}>DELETE ALL IN SERIES</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setMode('main')} activeOpacity={0.7}>
              <Text style={s.cancelTxt}>BACK</Text>
            </TouchableOpacity>
          </>
        )}
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
  subLabel: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 14, paddingVertical: 13 },
  rowTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: INK },
  deleteTxt: { color: RED },
  cancelBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 4 },
  cancelTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: MUTED },
});
