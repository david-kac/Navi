import { getDb } from './db';

export interface UserContext {
  thursdayDateNightEnabled:  boolean;
  commuteTimeMinutes:        number;
  wakeUpTime:                string; // "HH:MM"
  sleepTime:                 string; // "HH:MM"
  preferredRunTime:          'morning' | 'evening';
}

const DEFAULTS: UserContext = {
  thursdayDateNightEnabled:  true,
  commuteTimeMinutes:        45,
  wakeUpTime:                '06:00',
  sleepTime:                 '22:30',
  preferredRunTime:          'morning',
};

export async function getUserContext(): Promise<UserContext> {
  const db   = getDb();
  const rows = db.getAllSync<{ key: string; value: string }>('SELECT key, value FROM user_context');
  const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return {
    thursdayDateNightEnabled:  (map.thursdayDateNightEnabled ?? '1') === '1',
    commuteTimeMinutes:        Number(map.commuteTimeMinutes  ?? DEFAULTS.commuteTimeMinutes),
    wakeUpTime:                map.wakeUpTime    ?? DEFAULTS.wakeUpTime,
    sleepTime:                 map.sleepTime     ?? DEFAULTS.sleepTime,
    preferredRunTime:          (map.preferredRunTime ?? DEFAULTS.preferredRunTime) as UserContext['preferredRunTime'],
  };
}

export async function saveUserContext(ctx: Partial<UserContext>): Promise<void> {
  const db = getDb();
  for (const [key, value] of Object.entries(ctx)) {
    db.runSync(
      'INSERT OR REPLACE INTO user_context (key, value) VALUES (?, ?)',
      [key, String(value)]
    );
  }
}
