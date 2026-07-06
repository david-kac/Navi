import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  ScrollView, NativeSyntheticEvent, NativeScrollEvent, Alert, ActivityIndicator,
} from 'react-native';
import { ChevronDown, RefreshCw, Calendar, Paperclip, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { DEFAULT_CATEGORIES, Category, OPEN_CATEGORY_ID } from '../constants/categories';
import InlineCalendar from './InlineCalendar';
import { analyzeAssetAndSuggestTasks, SuggestedTask, AssetMimeType } from '../lib/ai';
import TaskPreviewModal from './TaskPreviewModal';

const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const BORDER = 1.354;
const DASH   = 0.677;
const RADIUS = 4;
const MARGIN = 18;

const HOURS   = ['12','01','02','03','04','05','06','07','08','09','10','11'];
const MINUTES = ['00','05','10','15','20','25','30','35','40','45','50','55'];
const PERIODS = ['AM','PM'];
const ITEM_H  = 44;
const WEEK_DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

type RepeatType = 'daily' | 'weekly' | 'monthly';
type Panel = 'main' | 'category' | 'time' | 'endTime' | 'date' | 'upload';

interface AttachedFile {
  base64: string;
  mimeType: AssetMimeType;
  name: string;
}

export interface NewTask {
  title:       string;
  categoryId:  string;
  date:        string; // "YYYY-MM-DD"
  startTime:   string;
  duration:    string;
  isRecurring: boolean;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateLabel(d: Date | null): string {
  if (!d) return 'No date';
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (toISODate(d) === toISODate(today)) return 'Today';
  if (toISODate(d) === toISODate(tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Minutes since midnight for a 12-hour picker triple, used to compute
// duration from a start + end time pair.
function minutesOfDay(hour12: string, minute: string, period: 'AM' | 'PM'): number {
  let h = parseInt(hour12, 10) % 12;
  if (period === 'PM') h += 12;
  return h * 60 + parseInt(minute, 10);
}

// ─── Open time slots (informational — shows the selected date's free gaps) ───
export interface DayTaskSlot {
  id: string;
  date: string | null;
  scheduledTime?: string;
  durationMinutes?: number;
}

const OPEN_SLOTS_DAY_START = 6 * 60;   // 6:00 AM
const OPEN_SLOTS_DAY_END   = 23 * 60;  // 11:00 PM
const OPEN_SLOTS_MIN_GAP   = 15;       // ignore slivers shorter than this

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToLabel(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

// Tasks with a time but no duration still occupy the calendar — assume a
// default 30 min block for gap purposes rather than ignoring them.
function computeOpenSlots(dayTasks: DayTaskSlot[]): { start: number; end: number }[] {
  const occupied = dayTasks
    .filter(t => t.scheduledTime)
    .map(t => {
      const start = hhmmToMinutes(t.scheduledTime!);
      return { start, end: start + (t.durationMinutes ?? 30) };
    })
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const seg of occupied) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }

  const gaps: { start: number; end: number }[] = [];
  let cursor = OPEN_SLOTS_DAY_START;
  for (const seg of merged) {
    const start = Math.max(seg.start, OPEN_SLOTS_DAY_START);
    const end   = Math.min(seg.end, OPEN_SLOTS_DAY_END);
    if (start > cursor && start - cursor >= OPEN_SLOTS_MIN_GAP) {
      gaps.push({ start: cursor, end: start });
    }
    cursor = Math.max(cursor, end);
  }
  if (OPEN_SLOTS_DAY_END - cursor >= OPEN_SLOTS_MIN_GAP) {
    gaps.push({ start: cursor, end: OPEN_SLOTS_DAY_END });
  }
  return gaps;
}

interface CategoryOption {
  id:    string;
  name:  string;
  icon:  string;
  color?: string | null;
}

export interface EditableTask {
  id:               string;
  title:            string;
  categoryId:       string | null;
  date:             string | null; // "YYYY-MM-DD", null = no date set
  scheduledTime?:   string; // "HH:MM" or "HH:MM:SS", 24-hour
  durationMinutes?: number;
}

interface Props {
  visible:      boolean;
  onClose:      () => void;
  onAdd?:       (task: NewTask) => void;
  onSave?:      (id: string, task: NewTask) => void;
  onAddMany?:   (tasks: SuggestedTask[]) => void;
  categories?:  CategoryOption[];
  editingTask?: EditableTask | null;
  initialDate?: string; // "YYYY-MM-DD", defaults to today when adding
  existingTasks?: DayTaskSlot[]; // used to show open time slots for the selected date
}

// ─── Scroll column for time picker ───────────────────────────────────────────
interface ColProps {
  items:    string[];
  selected: string;
  onSettle: (val: string) => void;
}

function ScrollCol({ items, selected, onSettle }: ColProps) {
  const ref = useRef<ScrollView>(null);
  const idx = items.indexOf(selected);

  const handleMomentum = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw     = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
      const clamped = Math.max(0, Math.min(raw, items.length - 1));
      onSettle(items[clamped]);
    },
    [items, onSettle],
  );

  return (
    <ScrollView
      ref={ref}
      style={col.wrap}
      contentOffset={{ x: 0, y: Math.max(0, idx) * ITEM_H }}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      onMomentumScrollEnd={handleMomentum}
    >
      <View style={{ height: ITEM_H }} />
      {items.map((item, i) => (
        <View key={i} style={col.item}>
          <Text style={[col.txt, item === selected && col.txtSel]}>{item}</Text>
        </View>
      ))}
      <View style={{ height: ITEM_H }} />
    </ScrollView>
  );
}

const col = StyleSheet.create({
  wrap:   { height: ITEM_H * 3, flex: 1 },
  item:   { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  txt:    { fontFamily: 'VT323', fontSize: 28, color: MUTED, lineHeight: 32 },
  txtSel: { color: INK, fontSize: 32 },
});

// ─── Inline repeat section ────────────────────────────────────────────────────
interface RepeatProps {
  repeatType:    RepeatType;
  onRepeatType:  (t: RepeatType) => void;
  interval:      string;
  onInterval:    (v: string) => void;
  selectedDays:  Set<number>;
  onToggleDay:   (d: number) => void;
}

function RepeatSection({ repeatType, onRepeatType, interval, onInterval, selectedDays, onToggleDay }: RepeatProps) {
  return (
    <View style={r.wrap}>
      {/* DAILY / WEEKLY / MONTHLY tab bar */}
      <View style={r.tabs}>
        {(['daily','weekly','monthly'] as RepeatType[]).map((t, i) => (
          <TouchableOpacity
            key={t}
            style={[r.tab, i > 0 && r.tabDiv, t === repeatType && r.tabOn]}
            onPress={() => onRepeatType(t)}
            activeOpacity={0.8}
          >
            <Text style={[r.tabTxt, t === repeatType && r.tabTxtOn]}>
              {t.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* DAILY sub-options */}
      {repeatType === 'daily' && (
        <View style={r.subRow}>
          <Text style={r.subLabel}>REPEAT EVERY</Text>
          <TextInput
            style={r.intervalInput}
            value={interval}
            onChangeText={onInterval}
            keyboardType="numeric"
            maxLength={2}
          />
          <Text style={r.subLabel}>DAY(S)</Text>
        </View>
      )}

      {/* WEEKLY sub-options */}
      {repeatType === 'weekly' && (
        <View style={r.subCol}>
          <Text style={r.subLabel}>REPEAT ON</Text>
          <View style={r.dayGrid}>
            {WEEK_DAYS.map((d, i) => (
              <TouchableOpacity
                key={d}
                style={[r.dayCell, i > 0 && r.dayCellDiv, selectedDays.has(i) && r.dayCellOn]}
                onPress={() => onToggleDay(i)}
                activeOpacity={0.8}
              >
                <Text style={[r.dayTxt, selectedDays.has(i) && r.dayTxtOn]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* MONTHLY sub-options */}
      {repeatType === 'monthly' && (
        <View style={r.subRow}>
          <Text style={r.subLabel}>REPEAT ON DAY</Text>
          <TextInput
            style={r.intervalInput}
            value={interval}
            onChangeText={onInterval}
            keyboardType="numeric"
            maxLength={2}
          />
          <Text style={r.subLabel}>OF EACH MONTH</Text>
        </View>
      )}
    </View>
  );
}

const r = StyleSheet.create({
  wrap: {
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    overflow: 'hidden',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: BORDER, borderBottomColor: INK,
  },
  tab:      { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: BG },
  tabDiv:   { borderLeftWidth: BORDER, borderLeftColor: INK },
  tabOn:    { backgroundColor: INK },
  tabTxt:   { fontFamily: 'PressStart2P', fontSize: 6, color: INK, lineHeight: 9 },
  tabTxtOn: { color: BG },

  subRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  subCol: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  subLabel: { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },
  intervalInput: {
    width: 40, height: 32, borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    textAlign: 'center', fontFamily: 'VT323', fontSize: 18, color: INK,
  },

  dayGrid:    { flexDirection: 'row', borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, overflow: 'hidden' },
  dayCell:    { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: BG },
  dayCellDiv: { borderLeftWidth: BORDER, borderLeftColor: INK },
  dayCellOn:  { backgroundColor: INK },
  dayTxt:     { fontFamily: 'PressStart2P', fontSize: 5, color: INK, lineHeight: 8 },
  dayTxtOn:   { color: BG },
});

// ─── Main component ───────────────────────────────────────────────────────────
export default function AddTaskModal({ visible, onClose, onAdd, onSave, onAddMany, categories, editingTask, initialDate, existingTasks }: Props) {
  const options = categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;

  const [title,       setTitle]       = useState('');
  const [categoryId,  setCategoryId]  = useState(options[0]?.id ?? '');
  const [date,        setDate]        = useState<Date | null>(new Date());
  const [duration,    setDuration]    = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [repeatType,  setRepeatType]  = useState<RepeatType>('daily');
  const [interval,    setInterval]    = useState('1');
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [panel,       setPanel]       = useState<Panel>('main');

  // Time picker state
  const [hour,    setHour]    = useState('08');
  const [minute,  setMinute]  = useState('00');
  const [period,  setPeriod]  = useState<'AM' | 'PM'>('AM');
  const [timeSet, setTimeSet] = useState(false);

  // End time picker state — optional; used only to auto-compute duration.
  const [endHour,    setEndHour]    = useState('08');
  const [endMinute,  setEndMinute]  = useState('30');
  const [endPeriod,  setEndPeriod]  = useState<'AM' | 'PM'>('AM');
  const [endTimeSet, setEndTimeSet] = useState(false);

  // Upload state
  const [attachment,       setAttachment]       = useState<AttachedFile | null>(null);
  const [uploadDesc,       setUploadDesc]       = useState('');
  const [analyzing,        setAnalyzing]        = useState(false);
  const [suggestedTasks,   setSuggestedTasks]   = useState<SuggestedTask[]>([]);
  const [showPreview,      setShowPreview]      = useState(false);

  const selectedCat    = options.find(c => c.id === categoryId) ?? options[0];
  const startTimeLabel = timeSet ? `${hour}:${minute} ${period}` : '--:-- --';
  const endTimeLabel   = endTimeSet ? `${endHour}:${endMinute} ${endPeriod}` : '--:-- --';

  // Informational only — shows the selected date's free gaps so David can
  // see at a glance what's open before picking a time. Excludes the task
  // currently being edited so it doesn't count its own slot as occupied.
  const openSlots = useMemo(() => {
    if (!date || !existingTasks) return [];
    const iso = toISODate(date);
    const dayTasks = existingTasks.filter(t => t.date === iso && t.id !== editingTask?.id);
    return computeOpenSlots(dayTasks);
  }, [date, existingTasks, editingTask]);

  useEffect(() => {
    if (!options.some(c => c.id === categoryId)) setCategoryId(options[0]?.id ?? '');
  }, [options]);

  // Only populate fields the moment the modal transitions to visible — not on
  // every re-render — otherwise a parent re-render (e.g. a clock tick) would
  // wipe out whatever the user is actively typing.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    const justOpened = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!justOpened) return;

    if (editingTask) {
      setTitle(editingTask.title);
      setCategoryId(editingTask.categoryId ?? OPEN_CATEGORY_ID);
      setDuration(editingTask.durationMinutes ? String(editingTask.durationMinutes) : '');
      setDate(editingTask.date ? new Date(`${editingTask.date}T00:00:00`) : null);
      if (editingTask.scheduledTime) {
        const [hh, mm] = editingTask.scheduledTime.split(':');
        const h24 = parseInt(hh, 10);
        const ap: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        setHour(h12.toString().padStart(2, '0'));
        setMinute(mm);
        setPeriod(ap);
        setTimeSet(true);

        // Pre-fill the end time from start + duration so editing shows the
        // same range that was used to set the duration in the first place.
        if (editingTask.durationMinutes) {
          const endTotal = (h24 * 60 + parseInt(mm, 10) + editingTask.durationMinutes) % (24 * 60);
          const endH24 = Math.floor(endTotal / 60);
          const endM = endTotal % 60;
          const endAp: 'AM' | 'PM' = endH24 >= 12 ? 'PM' : 'AM';
          const endH12 = endH24 % 12 === 0 ? 12 : endH24 % 12;
          setEndHour(endH12.toString().padStart(2, '0'));
          setEndMinute(endM.toString().padStart(2, '0'));
          setEndPeriod(endAp);
          setEndTimeSet(true);
        } else {
          setEndTimeSet(false);
        }
      } else {
        setTimeSet(false);
        setEndTimeSet(false);
      }
    } else {
      setDate(initialDate ? new Date(`${initialDate}T00:00:00`) : new Date());
    }
  }, [visible]);

  const toggleDay = (d: number) => {
    setSelectedDays(prev => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  };

  const reset = () => {
    setTitle(''); setDuration(''); setIsRecurring(false);
    setRepeatType('daily'); setInterval('1'); setSelectedDays(new Set());
    setHour('08'); setMinute('00'); setPeriod('AM'); setTimeSet(false);
    setEndHour('08'); setEndMinute('30'); setEndPeriod('AM'); setEndTimeSet(false);
    setPanel('main');
    setAttachment(null); setUploadDesc(''); setSuggestedTasks([]);
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access in Settings to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime: AssetMimeType = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    setAttachment({ base64: asset.base64!, mimeType: mime, name: asset.fileName ?? 'image.jpg' });
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri  = asset.uri;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as const });
    const rawMime = asset.mimeType ?? '';
    const mime: AssetMimeType = rawMime === 'application/pdf' ? 'application/pdf'
      : rawMime === 'image/png' ? 'image/png' : 'image/jpeg';
    setAttachment({ base64, mimeType: mime, name: asset.name });
  };

  const openPicker = () => {
    Alert.alert('Upload File', 'Choose a source', [
      { text: 'Photos',    onPress: pickPhoto },
      { text: 'Files',     onPress: pickFile  },
      { text: 'Cancel',    style: 'cancel'    },
    ]);
  };

  const analyzeUpload = async () => {
    if (!attachment) return;
    setAnalyzing(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const catNames = options.filter(c => c.id !== OPEN_CATEGORY_ID).map(c => c.name);
      const tasks = await analyzeAssetAndSuggestTasks({
        fileBase64: attachment.base64,
        mimeType:   attachment.mimeType,
        description: uploadDesc.trim() || 'Extract all tasks from this document.',
        today,
        categoryNames: catNames,
      });
      setSuggestedTasks(tasks);
      setShowPreview(true);
    } catch (e) {
      Alert.alert('Analysis failed', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmTasks = (tasks: SuggestedTask[]) => {
    setShowPreview(false);
    onAddMany?.(tasks);
    reset();
    onClose();
  };

  const handleClose = () => { reset(); onClose(); };

  const handleAdd = () => {
    if (!title.trim()) return;
    const payload: NewTask = {
      title:       title.trim(),
      categoryId,
      date:        date ? toISODate(date) : '',
      startTime:   timeSet ? `${hour}:${minute} ${period}` : '',
      duration,
      isRecurring,
    };
    if (editingTask) {
      onSave?.(editingTask.id, payload);
    } else {
      onAdd?.(payload);
    }
    reset(); onClose();
  };

  const confirmTime = () => { setTimeSet(true);  setPanel('main'); };
  const clearTime   = () => { setTimeSet(false); setEndTimeSet(false); setPanel('main'); };
  const clearDate   = () => { setDate(null); setPanel('main'); };

  // Sets the end time and, if a start time is also set, derives duration
  // from the gap between them (wrapping past midnight if needed).
  const confirmEndTime = () => {
    setEndTimeSet(true);
    if (timeSet) {
      const startMins = minutesOfDay(hour, minute, period);
      const endMins   = minutesOfDay(endHour, endMinute, endPeriod);
      const diff = ((endMins - startMins) % (24 * 60) + 24 * 60) % (24 * 60);
      setDuration(String(diff || 24 * 60));
    }
    setPanel('main');
  };
  const clearEndTime = () => { setEndTimeSet(false); setPanel('main'); };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <TouchableWithoutFeedback onPress={panel === 'main' ? handleClose : undefined}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>
      <View style={s.backdrop} pointerEvents="none" />

      <KeyboardAvoidingView style={s.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>

          {/* ── MAIN PANEL ── */}
          {panel === 'main' && (
            <>
              <Text style={s.header}>{editingTask ? 'EDIT TASK' : 'ADD TASK'}</Text>

              {/* Category dropdown */}
              <TouchableOpacity style={s.catDropdown} onPress={() => setPanel('category')} activeOpacity={0.8}>
                <Text style={s.catText}>{selectedCat?.name.toUpperCase() ?? 'NO CATEGORY'}</Text>
                <ChevronDown size={12} color={INK} strokeWidth={2} />
              </TouchableOpacity>

              {/* Name + repeat toggle */}
              <View style={s.inputRow}>
                <TextInput
                  style={s.textInput}
                  placeholder="What needs to happen..."
                  placeholderTextColor={MUTED}
                  value={title}
                  onChangeText={setTitle}
                  returnKeyType="done"
                  onSubmitEditing={handleAdd}
                  autoFocus
                />
                {!editingTask && (
                  <TouchableOpacity
                    style={[s.iconBtn, isRecurring && s.iconBtnActive]}
                    onPress={() => setIsRecurring(v => !v)}
                    activeOpacity={0.8}
                  >
                    <RefreshCw size={14} color={isRecurring ? BG : INK} strokeWidth={1.5} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Inline repeat section */}
              {!editingTask && isRecurring && (
                <RepeatSection
                  repeatType={repeatType}
                  onRepeatType={setRepeatType}
                  interval={interval}
                  onInterval={setInterval}
                  selectedDays={selectedDays}
                  onToggleDay={toggleDay}
                />
              )}

              {/* DATE */}
              <View style={s.dateRow}>
                <TouchableOpacity style={[s.dateField, { flex: 1 }]} onPress={() => setPanel('date')} activeOpacity={0.8}>
                  <Text style={[s.dateFieldTxt, !date && s.startTimePlaceholder]}>{dateLabel(date)}</Text>
                  <Calendar size={13} color={MUTED} strokeWidth={1.5} />
                </TouchableOpacity>
                {date && (
                  <TouchableOpacity style={s.iconBtn} onPress={clearDate} activeOpacity={0.7}>
                    <X size={14} color={INK} strokeWidth={1.5} />
                  </TouchableOpacity>
                )}
              </View>

              {/* OPEN SLOTS — informational, not tappable */}
              {date && openSlots.length > 0 && (
                <View style={{ gap: 6 }}>
                  <Text style={s.fieldLabel}>OPEN ON {dateLabel(date).toUpperCase()}</Text>
                  <View style={s.slotWrap}>
                    {openSlots.map((slot, i) => (
                      <View key={i} style={s.slotChip}>
                        <Text style={s.slotChipTxt}>{minutesToLabel(slot.start)} – {minutesToLabel(slot.end)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* START TIME + END TIME + DURATION */}
              <View style={s.timeRow}>
                <TouchableOpacity style={s.startTimeField} onPress={() => setPanel('time')} activeOpacity={0.8}>
                  <Text style={s.fieldLabel}>START</Text>
                  <Text style={[s.startTimeTxt, !timeSet && s.startTimePlaceholder]}>
                    {startTimeLabel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.startTimeField} onPress={() => setPanel('endTime')} activeOpacity={0.8}>
                  <Text style={s.fieldLabel}>END</Text>
                  <Text style={[s.startTimeTxt, !endTimeSet && s.startTimePlaceholder]}>
                    {endTimeLabel}
                  </Text>
                </TouchableOpacity>
                <View style={s.durationWrap}>
                  <Text style={s.fieldLabel}>MINS</Text>
                  <TextInput
                    style={s.durationInput}
                    placeholder="45"
                    placeholderTextColor={MUTED}
                    keyboardType="numeric"
                    value={duration}
                    onChangeText={setDuration}
                  />
                </View>
              </View>

              {/* SAVE/ADD + CANCEL */}
              <View style={s.btnRow}>
                <TouchableOpacity style={s.addBtn} onPress={handleAdd} activeOpacity={0.8}>
                  <Text style={s.addBtnTxt}>{editingTask ? 'SAVE' : 'ADD'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
                  <Text style={s.cancelBtnTxt}>CANCEL</Text>
                </TouchableOpacity>
              </View>

              {!editingTask && (
                <>
                  {/* — OR — */}
                  <View style={s.orRow}>
                    <View style={s.orLine} />
                    <Text style={s.orTxt}>— OR —</Text>
                    <View style={s.orLine} />
                  </View>

                  {/* Upload */}
                  <TouchableOpacity style={s.uploadBtn} onPress={() => setPanel('upload')} activeOpacity={0.7}>
                    <Paperclip size={13} color={INK} strokeWidth={1.5} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.uploadTitle}>Upload file to extract tasks</Text>
                      <Text style={s.uploadSub}>PDF, JPG, PNG — workout plans, schedules, docs</Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {/* ── CATEGORY PANEL ── */}
          {panel === 'category' && (
            <>
              <View style={s.panelHeader}>
                <Text style={s.header}>CATEGORY</Text>
                <TouchableOpacity onPress={() => setPanel('main')} activeOpacity={0.7}>
                  <Text style={s.backTxt}>← BACK</Text>
                </TouchableOpacity>
              </View>
              {options.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[s.catOption, cat.id === categoryId && s.catOptionActive]}
                  onPress={() => { setCategoryId(cat.id); setPanel('main'); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.catOptionTxt, cat.id === categoryId && s.catOptionTxtActive]}>
                    {cat.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {/* ── TIME PICKER PANEL ── */}
          {panel === 'time' && (
            <>
              <View style={s.panelHeader}>
                <Text style={s.header}>START TIME</Text>
                <TouchableOpacity onPress={() => setPanel('main')} activeOpacity={0.7}>
                  <Text style={s.backTxt}>← BACK</Text>
                </TouchableOpacity>
              </View>

              <View style={s.pickerWrap}>
                <View style={s.selHighlight} pointerEvents="none" />
                <ScrollCol items={HOURS}   selected={hour}   onSettle={setHour} />
                <Text style={s.colon}>:</Text>
                <ScrollCol items={MINUTES} selected={minute} onSettle={setMinute} />
                <ScrollCol items={PERIODS} selected={period} onSettle={v => setPeriod(v as 'AM' | 'PM')} />
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity style={s.addBtn} onPress={confirmTime} activeOpacity={0.8}>
                  <Text style={s.addBtnTxt}>SET TIME</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={clearTime} activeOpacity={0.7}>
                  <Text style={s.cancelBtnTxt}>CLEAR</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── END TIME PICKER PANEL ── */}
          {panel === 'endTime' && (
            <>
              <View style={s.panelHeader}>
                <Text style={s.header}>END TIME</Text>
                <TouchableOpacity onPress={() => setPanel('main')} activeOpacity={0.7}>
                  <Text style={s.backTxt}>← BACK</Text>
                </TouchableOpacity>
              </View>

              {timeSet && (
                <Text style={s.endTimeHint}>Sets duration from {startTimeLabel} to the time you pick.</Text>
              )}

              <View style={s.pickerWrap}>
                <View style={s.selHighlight} pointerEvents="none" />
                <ScrollCol items={HOURS}   selected={endHour}   onSettle={setEndHour} />
                <Text style={s.colon}>:</Text>
                <ScrollCol items={MINUTES} selected={endMinute} onSettle={setEndMinute} />
                <ScrollCol items={PERIODS} selected={endPeriod} onSettle={v => setEndPeriod(v as 'AM' | 'PM')} />
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity style={s.addBtn} onPress={confirmEndTime} activeOpacity={0.8}>
                  <Text style={s.addBtnTxt}>SET END TIME</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={clearEndTime} activeOpacity={0.7}>
                  <Text style={s.cancelBtnTxt}>CLEAR</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── DATE PICKER PANEL ── */}
          {panel === 'date' && (
            <>
              <View style={s.panelHeader}>
                <Text style={s.header}>DATE</Text>
                <TouchableOpacity onPress={() => setPanel('main')} activeOpacity={0.7}>
                  <Text style={s.backTxt}>← BACK</Text>
                </TouchableOpacity>
              </View>
              <InlineCalendar
                selectedDate={date ?? new Date()}
                onSelectDate={d => { setDate(d); setPanel('main'); }}
              />
              {/* InlineCalendar has its own marginHorizontal on top of the sheet's
                  padding — match that extra inset here so this button lines up
                  with the calendar's edges instead of the wider sheet edges. */}
              <View style={[s.btnRow, { marginHorizontal: MARGIN }]}>
                <TouchableOpacity style={s.cancelBtn} onPress={clearDate} activeOpacity={0.7}>
                  <Text style={s.cancelBtnTxt}>CLEAR DATE</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── UPLOAD PANEL ── */}
          {panel === 'upload' && (
            <>
              <View style={s.panelHeader}>
                <Text style={s.header}>UPLOAD FILE</Text>
                <TouchableOpacity onPress={() => { setPanel('main'); setAttachment(null); setUploadDesc(''); }} activeOpacity={0.7}>
                  <Text style={s.backTxt}>← BACK</Text>
                </TouchableOpacity>
              </View>

              {/* File picker area */}
              <TouchableOpacity style={[s.uploadBtn, s.uploadBtnLg]} onPress={openPicker} activeOpacity={0.7}>
                <Paperclip size={16} color={INK} strokeWidth={1.5} />
                <View style={{ flex: 1 }}>
                  {attachment
                    ? <Text style={s.uploadTitle}>{attachment.name}</Text>
                    : <Text style={s.uploadTitle}>Tap to choose a file</Text>}
                  <Text style={s.uploadSub}>PDF, JPG, PNG</Text>
                </View>
                {attachment && (
                  <TouchableOpacity onPress={() => setAttachment(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={13} color={MUTED} strokeWidth={1.5} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              {/* Description */}
              <View style={{ gap: 6 }}>
                <Text style={s.fieldLabel}>WHAT SHOULD DOT DO WITH IT?</Text>
                <TextInput
                  style={s.descInput}
                  placeholder="e.g. Extract all tasks from this marathon training plan and schedule them starting next Monday"
                  placeholderTextColor={MUTED}
                  value={uploadDesc}
                  onChangeText={setUploadDesc}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity
                  style={[s.addBtn, (!attachment || analyzing) && { opacity: 0.4 }]}
                  onPress={analyzeUpload}
                  disabled={!attachment || analyzing}
                  activeOpacity={0.8}
                >
                  {analyzing
                    ? <ActivityIndicator color={BG} size="small" />
                    : <Text style={s.addBtnTxt}>ANALYZE WITH DOT</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setPanel('main'); setAttachment(null); setUploadDesc(''); }} activeOpacity={0.7}>
                  <Text style={s.cancelBtnTxt}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

        </View>
      </KeyboardAvoidingView>

      <TaskPreviewModal
        visible={showPreview}
        tasks={suggestedTasks}
        loading={false}
        onConfirm={confirmTasks}
        onCancel={() => setShowPreview(false)}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  kav:   { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopWidth: BORDER, borderLeftWidth: BORDER, borderRightWidth: BORDER, borderColor: INK,
    borderTopLeftRadius: 6, borderTopRightRadius: 6,
    paddingHorizontal: MARGIN, paddingTop: 20, paddingBottom: 36,
    gap: 14,
  },
  header: { fontFamily: 'PressStart2P', fontSize: 8, color: INK, lineHeight: 12 },

  catDropdown: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  catText: { fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 20 },

  inputRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textInput: {
    flex: 1, height: 40, borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 10, fontFamily: 'VT323', fontSize: 16, color: INK,
  },
  iconBtn:       { width: 40, height: 40, borderWidth: BORDER, borderColor: INK, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { backgroundColor: INK },

  dateRow:   { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dateField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 10, height: 44,
  },
  dateFieldTxt: { fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 22 },

  timeRow:     { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  startTimeField: {
    flex: 1, gap: 4, justifyContent: 'center',
    borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 10, height: 44,
  },
  startTimeTxt:         { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 19 },
  startTimePlaceholder: { color: MUTED },
  durationWrap:  { width: 64, gap: 5 },
  fieldLabel:    { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },
  durationInput: {
    height: 44, borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 6, fontFamily: 'VT323', fontSize: 18, color: INK, textAlign: 'center',
  },

  btnRow:       { flexDirection: 'row', gap: 10 },
  addBtn:       { flex: 1, backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  addBtnTxt:    { fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },
  cancelBtn:    { flex: 1, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 12, alignItems: 'center' },
  cancelBtnTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },

  orRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orLine: { flex: 1, height: DASH, backgroundColor: MUTED },
  orTxt:  { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: DASH, borderStyle: 'dashed', borderColor: INK,
    borderRadius: RADIUS, paddingHorizontal: 14, paddingVertical: 14,
  },
  uploadBtnLg: { paddingVertical: 18 },
  descInput: {
    height: 120,
    borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 10, paddingTop: 10,
    fontFamily: 'VT323', fontSize: 16, color: INK,
  },
  uploadTitle: { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 18 },
  uploadSub:   { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8, marginTop: 2 },

  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backTxt:     { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9 },

  catOption:        { borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 14, paddingVertical: 13 },
  catOptionActive:  { backgroundColor: INK },
  catOptionTxt:     { fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 20 },
  catOptionTxtActive: { color: BG },

  endTimeHint: { fontFamily: 'VT323', fontSize: 15, color: MUTED, lineHeight: 18 },

  slotWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotChip:    { borderWidth: BORDER, borderColor: MUTED, borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5 },
  slotChipTxt: { fontFamily: 'VT323', fontSize: 14, color: INK, lineHeight: 16 },

  pickerWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    overflow: 'hidden', paddingHorizontal: 8,
  },
  selHighlight: {
    position: 'absolute', top: ITEM_H, left: 0, right: 0, height: ITEM_H,
    borderTopWidth: BORDER, borderBottomWidth: BORDER, borderColor: INK,
  },
  colon: { fontFamily: 'VT323', fontSize: 28, color: INK, lineHeight: 32, paddingHorizontal: 4, paddingBottom: 4 },
});
