import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, TouchableWithoutFeedback, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

export interface TimerPickOption { id: string; label: string; dayLabel: string }

interface Props {
  visible:  boolean;
  options:  TimerPickOption[];      // this week's incomplete tasks
  onClose:  () => void;
  /** Exactly one of taskId / newTaskTitle is set. */
  onStart:  (pick: { taskId: string } | { newTaskTitle: string }) => void;
}

const NEW_TASK = '__new__';

export default function TimerPickerModal({ visible, options, onClose, onStart }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    if (!visible) { setOpen(false); setSelected(null); setNewTitle(''); }
  }, [visible]);

  const selectedLabel = selected === NEW_TASK
    ? 'New task'
    : options.find(o => o.id === selected)
      ? `${options.find(o => o.id === selected)!.label} · ${options.find(o => o.id === selected)!.dayLabel}`
      : 'Select a task…';

  const canStart = selected === NEW_TASK ? newTitle.trim().length > 0 : !!selected;
  const start = () => {
    if (!canStart) return;
    onStart(selected === NEW_TASK ? { newTaskTitle: newTitle.trim() } : { taskId: selected! });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView style={s.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
        <View style={s.sheet}>
          <Text style={s.title}>Which task do you want to begin?</Text>

          <TouchableOpacity style={s.dropdown} onPress={() => setOpen(o => !o)} activeOpacity={0.8}>
            <Text style={[s.dropdownTxt, !selected && { color: MUTED }]} numberOfLines={1}>{selectedLabel}</Text>
            <ChevronDown size={12} color={INK} strokeWidth={2} />
          </TouchableOpacity>

          {open && (
            <ScrollView style={s.list} nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={s.option} onPress={() => { setSelected(NEW_TASK); setOpen(false); }} activeOpacity={0.7}>
                <Text style={s.optionTxt}>+ New task</Text>
              </TouchableOpacity>
              {options.map(o => (
                <TouchableOpacity key={o.id} style={s.option} onPress={() => { setSelected(o.id); setOpen(false); }} activeOpacity={0.7}>
                  <Text style={s.optionTxt} numberOfLines={1}>{o.label}</Text>
                  <Text style={s.optionDay}>{o.dayLabel}</Text>
                </TouchableOpacity>
              ))}
              {options.length === 0 && <Text style={s.empty}>No incomplete tasks this week.</Text>}
            </ScrollView>
          )}

          {selected === NEW_TASK && (
            <TextInput
              style={s.input}
              placeholder="What are you starting?"
              placeholderTextColor={MUTED}
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={start}
            />
          )}

          <View style={s.btnRow}>
            <TouchableOpacity style={[s.btn, s.btnPrimary, !canStart && { opacity: 0.4 }]} onPress={start} disabled={!canStart} activeOpacity={0.8}>
              <Text style={s.btnPrimaryTxt}>START</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={onClose} activeOpacity={0.7}>
              <Text style={s.btnTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  kav:      { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopWidth: BORDER, borderLeftWidth: BORDER, borderRightWidth: BORDER, borderColor: INK,
    borderTopLeftRadius: 6, borderTopRightRadius: 6,
    paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 12,
  },
  title:       { fontFamily: 'PressStart2P', fontSize: 8, color: INK, lineHeight: 13 },
  dropdown:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 14, paddingVertical: 13, gap: 8 },
  dropdownTxt: { flex: 1, fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 20 },
  list:        { maxHeight: 240, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS },
  option:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 0.677, borderBottomColor: INK },
  optionTxt:   { flex: 1, fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 20 },
  optionDay:   { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9 },
  empty:       { fontFamily: 'VT323', fontSize: 16, color: MUTED, padding: 14 },
  input:       { height: 40, borderWidth: BORDER, borderColor: INK, borderRadius: 2, paddingHorizontal: 10, fontFamily: 'VT323', fontSize: 16, color: INK },
  btnRow:      { flexDirection: 'row', gap: 10 },
  btn:         { flex: 1, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  btnPrimary:  { backgroundColor: INK },
  btnTxt:      { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  btnPrimaryTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },
});
