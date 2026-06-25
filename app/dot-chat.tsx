import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, AlertTriangle, CheckCircle2, Paperclip, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { analyzeAssetAndSuggestTasks, SuggestedTask, AssetMimeType } from '../lib/ai';
import TaskPreviewModal from '../components/TaskPreviewModal';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthProvider';
import { buildDotSystemPrompt, runPlannerTurn, AnthropicMessage, AddTaskToolInput, UpdateTaskToolInput, DeleteTaskToolInput } from '../lib/ai';
import { detectConflicts, Conflict, TaskSlot } from '../lib/conflicts';
import { generateTasksForDate } from '../lib/recurring';
import { shouldShowMorningFlow, markMorningFlowShown } from '../lib/morningGate';
import { getVerseOfTheDay, Verse } from '../lib/verseOfTheDay';
import type { Database } from '../lib/database.types';
import { getTimePeriod } from '../lib/database.types';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
}

type Mode = 'morning' | 'anytime';
type Stage = 'loading' | 'chatting' | 'locked';

interface DisplayMessage { id: string; kind: 'user' | 'dot' | 'added'; text: string }

const UPCOMING_WINDOW_DAYS = 28; // 4 weeks, including today

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

async function fetchTodayState(userId: string, today: string): Promise<{ rows: TaskRow[]; conflicts: Conflict[] }> {
  await generateTasksForDate(userId, today);
  const { data: rows, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .order('scheduled_time', { ascending: true });
  if (error) { console.error(error); return { rows: [], conflicts: [] }; }

  const taskRows = (rows ?? []) as TaskRow[];
  const slots: TaskSlot[] = taskRows.map(r => ({
    id:               r.id,
    title:            r.title,
    scheduledTime:    r.scheduled_time ?? undefined,
    durationMinutes:  r.duration_minutes ?? undefined,
    timePeriod:       r.time_period,
  }));
  const isThursday = new Date().getDay() === 4;
  return { rows: taskRows, conflicts: detectConflicts(slots, isThursday) };
}

// Materializes recurring tasks for every day in the upcoming window, then
// returns every task (today through 4 weeks out) so Dot can plan ahead —
// not just react to what's already on today.
async function fetchUpcomingTasks(userId: string, today: string): Promise<TaskRow[]> {
  const start = new Date(`${today}T00:00:00`);
  for (let i = 0; i < UPCOMING_WINDOW_DAYS; i++) {
    await generateTasksForDate(userId, toISODate(addDays(start, i)));
  }
  const endDate = toISODate(addDays(start, UPCOMING_WINDOW_DAYS - 1));

  const { data: rows, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .gte('date', today)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('scheduled_time', { ascending: true });
  if (error) { console.error(error); return []; }
  return (rows ?? []) as TaskRow[];
}

export default function DotChat() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [mode, setMode] = useState<Mode>('anytime');
  const [stage, setStage] = useState<Stage>('loading');
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const systemPromptRef = useRef('');
  const historyRef = useRef<AnthropicMessage[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  interface AttachedFile { base64: string; mimeType: AssetMimeType; name: string }
  const [attachment,     setAttachment]     = useState<AttachedFile | null>(null);
  const [analyzing,      setAnalyzing]      = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState<SuggestedTask[]>([]);
  const [showPreview,    setShowPreview]    = useState(false);

  const executeAddTask = useCallback(async (taskInput: AddTaskToolInput): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };

    const matchedCategory = taskInput.categoryName
      ? categories.find(c => c.name.toLowerCase() === taskInput.categoryName!.toLowerCase())
      : undefined;
    const date = taskInput.date && /^\d{4}-\d{2}-\d{2}$/.test(taskInput.date) ? taskInput.date : toISODate(new Date());
    const scheduledTime = taskInput.scheduledTime ? `${taskInput.scheduledTime}:00` : null;

    const { error } = await supabase.from('tasks').insert({
      user_id:           userId,
      title:             taskInput.title,
      category_id:       matchedCategory?.id ?? null,
      date,
      scheduled_time:    scheduledTime,
      duration_minutes:  taskInput.durationMinutes ?? null,
      time_period:       getTimePeriod(scheduledTime),
    });

    if (error) {
      console.error(error);
      return { success: false, message: `Failed to add task: ${error.message}` };
    }
    setDisplay(prev => [...prev, { id: `added-${Date.now()}`, kind: 'added', text: `+ Added "${taskInput.title}"${date !== toISODate(new Date()) ? ` for ${date}` : ''}` }]);
    return { success: true, message: 'Task added successfully.' };
  }, [userId, categories]);

  const executeUpdateTask = useCallback(async (taskInput: UpdateTaskToolInput): Promise<{ success: boolean; message: string }> => {
    const patch: Database['public']['Tables']['tasks']['Update'] = {};
    if (taskInput.title !== undefined) patch.title = taskInput.title;
    if (taskInput.date !== undefined) patch.date = taskInput.date;
    if (taskInput.scheduledTime !== undefined) {
      patch.scheduled_time = `${taskInput.scheduledTime}:00`;
      patch.time_period = getTimePeriod(patch.scheduled_time);
    }
    if (taskInput.durationMinutes !== undefined) patch.duration_minutes = taskInput.durationMinutes;

    const { data: row, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', taskInput.taskId)
      .select('title')
      .single();

    if (error || !row) {
      console.error(error);
      return { success: false, message: `Failed to update task: ${error?.message ?? 'not found'}` };
    }
    setDisplay(prev => [...prev, { id: `updated-${Date.now()}`, kind: 'added', text: `✎ Updated "${row.title}"` }]);
    return { success: true, message: 'Task updated successfully.' };
  }, []);

  const executeDeleteTask = useCallback(async (taskInput: DeleteTaskToolInput): Promise<{ success: boolean; message: string }> => {
    const { data: row, error: fetchError } = await supabase
      .from('tasks')
      .select('title')
      .eq('id', taskInput.taskId)
      .single();
    if (fetchError || !row) {
      return { success: false, message: `Failed to delete task: ${fetchError?.message ?? 'not found'}` };
    }

    const { error } = await supabase.from('tasks').delete().eq('id', taskInput.taskId);
    if (error) {
      console.error(error);
      return { success: false, message: `Failed to delete task: ${error.message}` };
    }
    setDisplay(prev => [...prev, { id: `deleted-${Date.now()}`, kind: 'added', text: `- Removed "${row.title}"` }]);
    return { success: true, message: 'Task deleted successfully.' };
  }, []);

  const executeReviewSchedule = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    const { conflicts: fresh } = await fetchTodayState(userId, toISODate(new Date()));
    setConflicts(fresh);
    const message = fresh.length
      ? `Found ${fresh.length} conflict(s): ${fresh.map(c => c.message).join(' ')}`
      : 'No conflicts found — schedule looks clear.';
    return { success: true, message };
  }, [userId]);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access in Settings to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setAttachment({ base64: asset.base64!, mimeType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', name: asset.fileName ?? 'image.jpg' });
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as const });
    const rawMime = asset.mimeType ?? '';
    const mime: AssetMimeType = rawMime === 'application/pdf' ? 'application/pdf' : rawMime === 'image/png' ? 'image/png' : 'image/jpeg';
    setAttachment({ base64, mimeType: mime, name: asset.name });
  };

  const openPicker = () => {
    Alert.alert('Upload File', 'Choose a source', [
      { text: 'Photos', onPress: pickPhoto },
      { text: 'Files',  onPress: pickFile  },
      { text: 'Cancel', style: 'cancel'    },
    ]);
  };

  const analyzeAttachment = async () => {
    if (!attachment) return;
    setAnalyzing(true);
    try {
      const today = toISODate(new Date());
      const tasks = await analyzeAssetAndSuggestTasks({
        fileBase64:   attachment.base64,
        mimeType:     attachment.mimeType,
        description:  input.trim() || 'Extract all tasks from this document.',
        today,
        categoryNames: categories.map(c => c.name),
      });
      setSuggestedTasks(tasks);
      setShowPreview(true);
    } catch (e) {
      Alert.alert('Analysis failed', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmTasks = async (tasks: SuggestedTask[]) => {
    setShowPreview(false);
    setAttachment(null);
    setInput('');
    if (!userId) return;
    const today = toISODate(new Date());
    let created = 0;
    for (const t of tasks) {
      const matchedCat = categories.find(c => c.name.toLowerCase() === t.categoryName?.toLowerCase());
      const scheduledTime = t.scheduledTime ? `${t.scheduledTime}:00` : null;
      const { error } = await supabase.from('tasks').insert({
        user_id:           userId,
        title:             t.title,
        category_id:       matchedCat?.id ?? null,
        date:              t.date ?? today,
        scheduled_time:    scheduledTime,
        duration_minutes:  t.durationMinutes ?? null,
        time_period:       getTimePeriod(scheduledTime),
      });
      if (!error) created++;
    }
    setDisplay(prev => [...prev, { id: `added-${Date.now()}`, kind: 'added', text: `+ Created ${created} task${created !== 1 ? 's' : ''} from your upload` }]);
  };

  const greet = useCallback(async () => {
    if (!userId) return;
    setStage('loading');
    const now = new Date();
    const today = toISODate(now);

    const isMorning = await shouldShowMorningFlow();
    const sessionMode: Mode = isMorning ? 'morning' : 'anytime';
    setMode(sessionMode);
    if (isMorning) await markMorningFlowShown();

    const { data: catRows } = await supabase.from('categories').select('*').eq('user_id', userId);
    setCategories(catRows ?? []);

    const { conflicts: detected } = await fetchTodayState(userId, today);
    setConflicts(detected);

    const upcomingRows = await fetchUpcomingTasks(userId, today);
    const upcomingTasks = upcomingRows.length
      ? upcomingRows.map(r => {
          const when = r.scheduled_time ? fmt12(r.scheduled_time) : 'unscheduled';
          const dur = r.duration_minutes ? ` (${r.duration_minutes} min)` : '';
          return `- [${r.id}] ${r.date} — ${r.title} — ${when}${dur}`;
        }).join('\n')
      : 'Nothing scheduled yet.';

    let verse: Verse | undefined;
    if (sessionMode === 'morning') {
      verse = await getVerseOfTheDay();
    }

    const system = buildDotSystemPrompt({
      date:       now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      time:       now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      dayOfWeek:  now.toLocaleDateString('en-US', { weekday: 'long' }),
      isThursday: now.getDay() === 4,
      upcomingTasks,
      conflicts:  detected.length ? detected.map(c => c.message).join('\n') : 'None.',
      categoryNames: (catRows ?? []).map(c => c.name),
      mode: sessionMode,
      verse,
    });
    systemPromptRef.current = system;

    // Restore persisted chat from earlier today — skip the greeting if found.
    try {
      const persisted = await AsyncStorage.getItem(`dot_chat_${today}`);
      if (persisted) {
        const { history, display: savedDisplay } = JSON.parse(persisted);
        historyRef.current = history;
        setDisplay(savedDisplay);
        setStage('chatting');
        return;
      }
    } catch (e) {
      console.error('Failed to load chat history:', e);
    }

    const kickoff = sessionMode === 'morning'
      ? "Give me my morning greeting, share today's verse exactly as written, and a quick summary of today. Keep it short."
      : 'Just say a short casual hello and ask what\'s on my mind. Keep it to one sentence.';

    setSending(true);
    try {
      const result = await runPlannerTurn(system, [], kickoff, { executeAddTask, executeUpdateTask, executeDeleteTask, executeReviewSchedule });
      historyRef.current = result.history;
      setDisplay(prev => [...prev, { id: 'greet', kind: 'dot', text: result.replyText }]);
      setStage('chatting');
    } catch (e) {
      setDisplay(prev => [...prev, { id: 'err', kind: 'dot', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
      setStage('chatting');
    } finally {
      setSending(false);
    }
  }, [userId, executeAddTask, executeUpdateTask, executeDeleteTask, executeReviewSchedule]);

  useEffect(() => { greet(); }, [userId]);

  // Persist the full chat to AsyncStorage after each completed exchange so it
  // survives navigation. The key is date-scoped, so tomorrow starts fresh.
  useEffect(() => {
    if (stage !== 'chatting' || sending) return;
    AsyncStorage.setItem(
      `dot_chat_${toISODate(new Date())}`,
      JSON.stringify({ history: historyRef.current, display }),
    ).catch(console.error);
  }, [display, stage, sending]);

  const send = async () => {
    if (attachment) { analyzeAttachment(); return; }
    const text = input.trim();
    if (!text) return;
    setDisplay(prev => [...prev, { id: `u-${Date.now()}`, kind: 'user', text }]);
    setInput('');
    setSending(true);
    try {
      const result = await runPlannerTurn(systemPromptRef.current, historyRef.current, text, { executeAddTask, executeUpdateTask, executeDeleteTask, executeReviewSchedule });
      historyRef.current = result.history;
      setDisplay(prev => [...prev, { id: `a-${Date.now()}`, kind: 'dot', text: result.replyText }]);
    } catch (e) {
      setDisplay(prev => [...prev, { id: `e-${Date.now()}`, kind: 'dot', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const lockPlan = async () => {
    if (!userId) return;
    const { conflicts: fresh } = await fetchTodayState(userId, toISODate(new Date()));
    setConflicts(fresh);
    setStage('locked');
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <ChevronLeft size={16} color={INK} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{mode === 'morning' ? 'MORNING PLAN' : 'DOT'}</Text>
      </View>

      {stage === 'loading' && (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={INK} size="large" />
          <Text style={s.loadingTxt}>Dot is looking at your day…</Text>
        </View>
      )}

      {stage === 'chatting' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView ref={scrollRef} style={s.chat} contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
            {display.map(m => (
              m.kind === 'added' ? (
                <View key={m.id} style={s.addedRow}><Text style={s.addedTxt}>{m.text}</Text></View>
              ) : (
                <View key={m.id} style={[s.bubble, m.kind === 'user' ? s.bubbleUser : s.bubbleDot]}>
                  <Text style={s.bubbleLabel}>{m.kind === 'user' ? 'YOU' : 'DOT'}</Text>
                  <Text style={s.bubbleTxt}>{m.text}</Text>
                </View>
              )
            ))}
            {sending && <ActivityIndicator color={INK} style={{ marginTop: 4 }} />}
          </ScrollView>

          {attachment && (
            <View style={s.attachChip}>
              <Paperclip size={11} color={INK} strokeWidth={1.5} />
              <Text style={s.attachName} numberOfLines={1}>{attachment.name}</Text>
              <TouchableOpacity onPress={() => setAttachment(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <X size={11} color={MUTED} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          )}

          <View style={s.inputRow}>
            <TouchableOpacity style={s.clipBtn} onPress={openPicker} activeOpacity={0.7}>
              <Paperclip size={16} color={attachment ? INK : MUTED} strokeWidth={1.5} />
            </TouchableOpacity>
            <TextInput
              style={s.input}
              placeholder={attachment ? 'Describe what to do with this file…' : 'Tell Dot what\'s on your mind...'}
              placeholderTextColor={MUTED}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[s.sendBtn, (sending || analyzing || (!input.trim() && !attachment)) && { opacity: 0.4 }]}
              onPress={send}
              disabled={sending || analyzing || (!input.trim() && !attachment)}
              activeOpacity={0.8}
            >
              {analyzing ? <ActivityIndicator color={BG} size="small" /> : <Text style={s.sendBtnTxt}>SEND</Text>}
            </TouchableOpacity>
          </View>

          {mode === 'morning' && (
            <TouchableOpacity style={s.lockBtn} onPress={lockPlan} activeOpacity={0.8}>
              <Text style={s.lockBtnTxt}>LOCK PLAN</Text>
            </TouchableOpacity>
          )}
        </KeyboardAvoidingView>
      )}

      {stage === 'locked' && (
        <View style={s.lockedWrap}>
          {conflicts.length === 0 ? (
            <>
              <CheckCircle2 size={32} color={INK} strokeWidth={1.5} />
              <Text style={s.lockedHeadline}>No conflicts. Plan's locked.</Text>
            </>
          ) : (
            <>
              <AlertTriangle size={32} color={INK} strokeWidth={1.5} />
              <Text style={s.lockedHeadline}>{conflicts.length} thing{conflicts.length > 1 ? 's' : ''} to talk through:</Text>
              {conflicts.map((c, i) => (
                <View key={i} style={s.conflictRow}>
                  <Text style={s.conflictTxt}>{c.message}</Text>
                </View>
              ))}
            </>
          )}
          <TouchableOpacity style={s.doneBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={s.doneBtnTxt}>BACK TO HOME</Text>
          </TouchableOpacity>
        </View>
      )}
      <TaskPreviewModal
        visible={showPreview}
        tasks={suggestedTasks}
        loading={false}
        onConfirm={confirmTasks}
        onCancel={() => setShowPreview(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  backBtn:     { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'PressStart2P', fontSize: 10, color: INK },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt:  { fontFamily: 'PressStart2P', fontSize: 8, color: INK },

  chat:   { flex: 1, paddingHorizontal: 18 },
  bubble: { borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, padding: 12, maxWidth: '90%' },
  bubbleDot:  { alignSelf: 'flex-start', backgroundColor: BG },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#F0EEEA' },
  bubbleLabel:{ fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, marginBottom: 4 },
  bubbleTxt:  { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 20 },
  addedRow:   { alignSelf: 'center', paddingVertical: 4 },
  addedTxt:   { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED },

  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 18, marginBottom: 6,
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  attachName: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: INK },

  inputRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  clipBtn:  { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS },
  input:    { flex: 1, height: 42, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 12, fontFamily: 'VT323', fontSize: 16, color: INK },
  sendBtn:  { height: 42, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: INK, borderRadius: RADIUS },
  sendBtnTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: BG },

  lockBtn: { margin: 18, backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 13, alignItems: 'center' },
  lockBtnTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: BG },

  lockedWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  lockedHeadline:{ fontFamily: 'PressStart2P', fontSize: 10, color: INK, textAlign: 'center' },
  conflictRow:   { borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, padding: 12, width: '100%' },
  conflictTxt:   { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 20 },
  doneBtn:    { marginTop: 16, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 12, paddingHorizontal: 24 },
  doneBtnTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: INK },
});
