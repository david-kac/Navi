import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_SHOWN_KEY = 'MORNING_FLOW_LAST_SHOWN_DATE';
const MORNING_CUTOFF_HOUR = 5;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/** True if it's after 5am and the automatic morning flow hasn't been shown yet today. */
export async function shouldShowMorningFlow(): Promise<boolean> {
  if (new Date().getHours() < MORNING_CUTOFF_HOUR) return false;
  const lastShown = await AsyncStorage.getItem(LAST_SHOWN_KEY);
  return lastShown !== todayKey();
}

export async function markMorningFlowShown(): Promise<void> {
  await AsyncStorage.setItem(LAST_SHOWN_KEY, todayKey());
}
