import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_CLEANUP_KEY = 'COMPLETED_TASKS_LAST_CLEANUP_DATE';

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
