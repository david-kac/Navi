import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_CLEANUP_KEY = 'COMPLETED_TASKS_LAST_CLEANUP_DATE';
const LAST_STALE_DATE_SWEEP_KEY = 'STALE_TASK_DATES_LAST_SWEEP_DATE';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/** True if the daily completed-task sweep hasn't run yet today. */
export async function shouldRunDailyCleanup(): Promise<boolean> {
  const last = await AsyncStorage.getItem(LAST_CLEANUP_KEY);
  return last !== todayKey();
}

export async function markDailyCleanupRun(): Promise<void> {
  await AsyncStorage.setItem(LAST_CLEANUP_KEY, todayKey());
}

/** True if today's sweep of stale-dated incomplete tasks hasn't run yet.
 * Covers the case where a day ends without "End My Day" being run — any
 * task left incomplete with a date in the past should have its date
 * cleared (become a dateless backlog item) the next time the app opens on
 * a new day, so it stays visible in its category instead of vanishing. */
export async function shouldRunStaleDateSweep(): Promise<boolean> {
  const last = await AsyncStorage.getItem(LAST_STALE_DATE_SWEEP_KEY);
  return last !== todayKey();
}

export async function markStaleDateSweepRun(): Promise<void> {
  await AsyncStorage.setItem(LAST_STALE_DATE_SWEEP_KEY, todayKey());
}
