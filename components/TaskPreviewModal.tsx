import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SuggestedTask } from '../lib/ai';

const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

interface Props {
  visible:   boolean;
  tasks:     SuggestedTask[];
  loading:   boolean;
  onConfirm: (tasks: SuggestedTask[]) => void;
  onCancel:  () => void;
}

export default function TaskPreviewModal({ visible, tasks, loading, onConfirm, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.header}>SUGGESTED TASKS</Text>
          <Text style={s.sub}>{tasks.length} task{tasks.length !== 1 ? 's' : ''} found — review and confirm</Text>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={INK} />
              <Text style={s.loadingTxt}>Dot is reading your file…</Text>
            </View>
          ) : (
            <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
              {tasks.map((t, i) => {
                const parts: string[] = [];
                if (t.date) parts.push(fmtDate(t.date));
                if (t.scheduledTime) parts.push(fmt12(t.scheduledTime));
                if (t.durationMinutes) parts.push(`${t.durationMinutes}m`);
                if (t.categoryName) parts.push(t.categoryName);
                return (
                  <View key={i} style={s.row}>
                    <View style={s.bullet} />
                    <View style={s.rowContent}>
                      <Text style={s.taskTitle}>{t.title}</Text>
                      {parts.length > 0 && (
                        <Text style={s.taskMeta}>{parts.join(' · ')}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={s.btnRow}>
            <TouchableOpacity
              style={[s.confirmBtn, (loading || tasks.length === 0) && s.btnDisabled]}
              onPress={() => onConfirm(tasks)}
              disabled={loading || tasks.length === 0}
              activeOpacity={0.8}
            >
              <Text style={s.confirmBtnTxt}>CREATE {tasks.length} TASK{tasks.length !== 1 ? 'S' : ''}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={s.cancelBtnTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: BG,
    borderTopWidth: BORDER, borderLeftWidth: BORDER, borderRightWidth: BORDER, borderColor: INK,
    borderTopLeftRadius: 6, borderTopRightRadius: 6,
    paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36,
    gap: 14,
    maxHeight: '80%',
  },
  header: { fontFamily: 'PressStart2P', fontSize: 8, color: INK, lineHeight: 12 },
  sub:    { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },

  loadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  loadingTxt:  { fontFamily: 'VT323', fontSize: 16, color: MUTED },

  list: { flexGrow: 0 },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  bullet: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: INK, marginTop: 6,
  },
  rowContent:  { flex: 1, gap: 2 },
  taskTitle:   { fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 20 },
  taskMeta:    { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },

  btnRow:       { flexDirection: 'row', gap: 10 },
  confirmBtn:   { flex: 1, backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  confirmBtnTxt:{ fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },
  cancelBtn:    { flex: 1, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  cancelBtnTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  btnDisabled:  { opacity: 0.4 },
});
