import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
} from 'react-native';

const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;
const MARGIN = 18;

interface Props {
  visible:  boolean;
  onClose:  () => void;
  onAdd:    (name: string) => Promise<void>;
}

export default function AddFriendModal({ visible, onClose, onAdd }: Props) {
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    try {
      await onAdd(trimmed);
      setName('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { setName(''); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>
      <View style={s.backdrop} pointerEvents="none" />

      <KeyboardAvoidingView style={s.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <Text style={s.header}>ADD PARTY MEMBER</Text>

          <TextInput
            style={s.input}
            placeholder="Name..."
            placeholderTextColor={MUTED}
            value={name}
            onChangeText={setName}
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={handleAdd}
            autoFocus
          />

          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.addBtn, (!name.trim() || loading) && { opacity: 0.4 }]}
              onPress={handleAdd}
              disabled={!name.trim() || loading}
              activeOpacity={0.8}
            >
              <Text style={s.addBtnTxt}>ADD</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={s.cancelBtnTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  kav:      { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopWidth: BORDER, borderLeftWidth: BORDER, borderRightWidth: BORDER, borderColor: INK,
    borderTopLeftRadius: 6, borderTopRightRadius: 6,
    paddingHorizontal: MARGIN, paddingTop: 20, paddingBottom: 36,
    gap: 14,
  },
  header: { fontFamily: 'PressStart2P', fontSize: 8, color: INK, lineHeight: 12 },
  input: {
    height: 44, borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 10, fontFamily: 'VT323', fontSize: 20, color: INK,
  },
  btnRow:       { flexDirection: 'row', gap: 10 },
  addBtn:       { flex: 1, backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  addBtnTxt:    { fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },
  cancelBtn:    { flex: 1, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  cancelBtnTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
});
