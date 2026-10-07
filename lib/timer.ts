import AsyncStorage from '@react-native-async-storage/async-storage';

const TIMER_KEY = 'dot:timer';

/** One active task timer at a time. Elapsed time is always derived from
 * timestamps (never an interval counter), so it survives the phone locking
 * or the app being closed. */
export interface TimerState {
  taskId:          string;
  title:           string;
  ruleId:          string | null; // recurring series, if any — stats attach here
  accumulatedMs:   number;        // time banked from earlier run segments
  startedAt:       number | null; // epoch ms of the current segment, null while stopped
}

export function elapsedMs(t: TimerState, now = Date.now()): number {
  return t.accumulatedMs + (t.startedAt ? Math.max(0, now - t.startedAt) : 0);
}

export const isRunning = (t: TimerState | null): boolean => !!t && t.startedAt !== null;

export function newTimer(task: { id: string; title: string; ruleId: string | null }): TimerState {
  return { taskId: task.id, title: task.title, ruleId: task.ruleId, accumulatedMs: 0, startedAt: Date.now() };
}

export function stopTimer(t: TimerState): TimerState {
  return { ...t, accumulatedMs: elapsedMs(t), startedAt: null };
}

export function resumeTimer(t: TimerState): TimerState {
  return { ...t, startedAt: Date.now() };
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = sec.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export async function loadTimer(): Promise<TimerState | null> {
  try {
    const raw = await AsyncStorage.getItem(TIMER_KEY);
    return raw ? (JSON.parse(raw) as TimerState) : null;
  } catch { return null; }
}

export async function saveTimer(t: TimerState | null): Promise<void> {
  try {
    if (t) await AsyncStorage.setItem(TIMER_KEY, JSON.stringify(t));
    else await AsyncStorage.removeItem(TIMER_KEY);
  } catch (e) { console.error('Failed to persist timer:', e); }
}
