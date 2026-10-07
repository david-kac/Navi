import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TouchableWithoutFeedback, ScrollView } from 'react-native';
import { Pencil, Play, Square, Check } from 'lucide-react-native';
import { TimerState, elapsedMs, formatElapsed, isRunning } from '../lib/timer';
import { useNow } from '../lib/useNow';

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

interface Props {
  visible:     boolean;
  title:       string;
  details?:    string;
  isRecurring: boolean;
  /** The app-wide timer, only passed through if it belongs to this task. */
  timer:       TimerState | null;
  onClose:     () => void;
  onEdit:      () => void;
  onStart:     () => void;
  onStop:      () => void;
  onResume:    () => void;
  onComplete:  () => void;
}

export default function TaskDetailModal({
  visible, title, details, isRecurring, timer, onClose, onEdit, onStart, onStop, onResume, onComplete,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (!visible) setConfirming(false); }, [visible]);

  const running = isRunning(timer);
  const now = useNow(visible && running);
  const showClock = !!timer;
  const stopped = !!timer && !running;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        {confirming ? (
          <>
            <Text style={s.confirmTitle}>Complete this task and log this?</Text>
            <Text style={s.confirmSub}>
              {isRecurring
                ? `${formatElapsed(timer ? elapsedMs(timer, now) : 0)} will be added to this series' average.`
                : "One-off task — it'll be completed, nothing is logged."}
            </Text>
            <View style={s.btnRow}>
              <TouchableOpacity style={[s.btn, s.btnFlex, s.btnPrimary]} onPress={onComplete} activeOpacity={0.8}>
                <Text style={s.btnPrimaryTxt}>YES</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnFlex]} onPress={() => setConfirming(false)} activeOpacity={0.7}>
                <Text style={s.btnTxt}>NO</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={s.title}>{title}</Text>
            <ScrollView style={s.detailsWrap} showsVerticalScrollIndicator={false}>
              <Text style={[s.details, !details && s.detailsEmpty]}>{details || 'No details.'}</Text>
            </ScrollView>

            {showClock && <Text style={s.clock}>{formatElapsed(elapsedMs(timer!, now))}</Text>}

            {!timer && (
              <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={onStart} activeOpacity={0.8}>
                <Play size={13} color={BG} strokeWidth={1.5} />
                <Text style={s.btnPrimaryTxt}>START TIMER</Text>
              </TouchableOpacity>
            )}
            {running && (
              <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={onStop} activeOpacity={0.8}>
                <Square size={13} color={BG} strokeWidth={1.5} />
                <Text style={s.btnPrimaryTxt}>STOP</Text>
              </TouchableOpacity>
            )}
            {stopped && (
              <>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={onResume} activeOpacity={0.8}>
                  <Play size={13} color={BG} strokeWidth={1.5} />
                  <Text style={s.btnPrimaryTxt}>RESUME</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={() => setConfirming(true)} activeOpacity={0.7}>
                  <Check size={13} color={INK} strokeWidth={1.5} />
                  <Text style={s.btnTxt}>COMPLETE TASK</Text>
                </TouchableOpacity>
              </>
            )}

            <View style={s.footerRow}>
              <TouchableOpacity style={s.footerBtn} onPress={onEdit} activeOpacity={0.7}>
                <Pencil size={12} color={INK} strokeWidth={1.5} />
                <Text style={s.footerTxt}>EDIT</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.footerBtn} onPress={onClose} activeOpacity={0.7}>
                <Text style={[s.footerTxt, { color: MUTED }]}>CLOSE</Text>
              </TouchableOpacity>
            </View>
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
    paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 12,
  },
  title:        { fontFamily: 'PressStart2P', fontSize: 10, color: INK, lineHeight: 16 },
  detailsWrap:  { maxHeight: 180 },
  details:      { fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 21 },
  detailsEmpty: { color: MUTED },
  clock:        { fontFamily: 'PressStart2P', fontSize: 18, color: INK, lineHeight: 26, textAlign: 'center', marginVertical: 4 },

  btnRow:     { flexDirection: 'row', gap: 10 },
  btn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 13 },
  btnFlex:    { flex: 1 },
  btnPrimary: { backgroundColor: INK },
  btnTxt:     { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  btnPrimaryTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },

  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 },
  footerTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },

  confirmTitle: { fontFamily: 'PressStart2P', fontSize: 9, color: INK, lineHeight: 15 },
  confirmSub:   { fontFamily: 'VT323', fontSize: 18, color: MUTED, lineHeight: 21 },
});
