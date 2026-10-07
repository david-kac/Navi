import type { Database } from './database.types';

export type RuleRow = Database['public']['Tables']['recurring_task_rules']['Row'];

const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function fmt12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
}

/** Days (0=Sun…6=Sat) a rule applies on. Mirrors lib/recurring.ts's filter. */
export function ruleDays(rule: Pick<RuleRow, 'rule_type' | 'days_of_week'>): number[] {
  if (rule.rule_type === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  return rule.days_of_week && rule.days_of_week.length ? [...rule.days_of_week].sort() : [0, 1, 2, 3, 4, 5, 6];
}

/** "REPEATS DAILY · 4:00 PM", "EVERY SAT · 9:00 AM", "WEEKDAYS", "EVERY MON, WED". */
export function cadenceLabel(rule: Pick<RuleRow, 'rule_type' | 'days_of_week' | 'scheduled_time'>): string {
  const days = ruleDays(rule);
  let base: string;
  if (days.length === 7) base = 'REPEATS DAILY';
  else if (days.join() === '1,2,3,4,5') base = 'WEEKDAYS';
  else if (days.join() === '0,6') base = 'WEEKENDS';
  else base = `EVERY ${days.map(d => DAY_ABBR[d]).join(', ')}`;
  return rule.scheduled_time ? `${base} · ${fmt12(rule.scheduled_time)}` : base;
}

/** First date (YYYY-MM-DD) on/after `fromISO` the rule applies on, optionally
 * skipping `skipISO` (e.g. today when today's instance is already done). */
export function nextOccurrence(
  rule: Pick<RuleRow, 'rule_type' | 'days_of_week'>,
  fromISO: string,
  skipISO?: string,
): string {
  const days = new Set(ruleDays(rule));
  const d = new Date(`${fromISO}T00:00:00`);
  for (let i = 0; i < 8; i++) {
    const iso = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    if (days.has(d.getDay()) && iso !== skipISO) return iso;
    d.setDate(d.getDate() + 1);
  }
  return fromISO;
}

/** Average actual minutes for a series, or null if never logged. */
export function avgActualMinutes(rule: Pick<RuleRow, 'total_actual_seconds' | 'run_count'>): number | null {
  return rule.run_count > 0 ? rule.total_actual_seconds / rule.run_count / 60 : null;
}
