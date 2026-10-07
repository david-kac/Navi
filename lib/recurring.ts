import { supabase } from './supabase';
import { getTimePeriod } from './database.types';
import type { Database } from './database.types';
import { RuleRow, ruleDays } from './cadence';

const UNIQUE_VIOLATION = '23505';

function isoWeekday(d: Date): number {
  return d.getDay(); // 0=Sun … 6=Sat, matches days_of_week storage
}

/**
 * Expands this user's active recurring_task_rules into concrete `tasks` rows
 * for the given date, if they don't already exist. Safe to call repeatedly —
 * relies on a unique (user_id, recurring_rule_id, date) index to no-op on
 * already-generated instances rather than checking first. Skips dates that
 * have a recurring_task_exceptions row (a single occurrence the user deleted).
 */
export async function generateTasksForDate(userId: string, isoDate: string): Promise<void> {
  const { data: rules, error } = await supabase
    .from('recurring_task_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (error || !rules) {
    if (error) console.error(error);
    return;
  }
  if (!rules.length) return;

  const { data: exceptions, error: exError } = await supabase
    .from('recurring_task_exceptions')
    .select('recurring_rule_id')
    .eq('user_id', userId)
    .eq('date', isoDate);
  if (exError) { console.error(exError); return; }
  const skippedRuleIds = new Set((exceptions ?? []).map(e => e.recurring_rule_id));

  const dow = isoWeekday(new Date(`${isoDate}T00:00:00`));

  const applicable = rules.filter(rule => {
    if (skippedRuleIds.has(rule.id)) return false;
    if (rule.rule_type === 'daily') return true;
    if (rule.rule_type === 'weekly') return rule.days_of_week?.includes(dow) ?? false;
    // 'custom' rules without days_of_week apply every day; with days_of_week, same check as weekly.
    return rule.days_of_week ? rule.days_of_week.includes(dow) : true;
  });

  for (const rule of applicable) {
    const { error: insertError } = await supabase.from('tasks').insert({
      user_id:            userId,
      title:              rule.title,
      category_id:        rule.category_id,
      goal_id:            rule.goal_id,
      recurring_rule_id:  rule.id,
      date:               isoDate,
      scheduled_time:     rule.scheduled_time,
      duration_minutes:   rule.duration_minutes,
      notes:              rule.notes,
      time_period:        getTimePeriod(rule.scheduled_time),
    });
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      console.error(insertError);
    }
  }
}

/** Deletes a single occurrence of a recurring task and records an exception
 * so the generator won't recreate it for that date. */
export async function deleteRecurringOccurrence(userId: string, taskId: string, recurringRuleId: string, date: string): Promise<void> {
  const { error: deleteError } = await supabase.from('tasks').delete().eq('id', taskId);
  if (deleteError) { console.error(deleteError); return; }

  const { error: exError } = await supabase.from('recurring_task_exceptions').insert({
    user_id:           userId,
    recurring_rule_id: recurringRuleId,
    date,
  });
  if (exError) console.error(exError);
}

/** Deletes the entire recurring series: every task instance tied to the rule
 * (past and future), then the rule itself. */
export async function deleteRecurringSeries(recurringRuleId: string): Promise<void> {
  const { error: tasksError } = await supabase.from('tasks').delete().eq('recurring_rule_id', recurringRuleId);
  if (tasksError) { console.error(tasksError); return; }

  const { error: ruleError } = await supabase.from('recurring_task_rules').delete().eq('id', recurringRuleId);
  if (ruleError) console.error(ruleError);
}

// ─── Lazy occurrences ─────────────────────────────────────────────────────────
// Only today + a couple of days ahead are materialized as real `tasks` rows
// (plus any day the user actually views). Further-out occurrences are computed
// from the rule on demand, as "virtual" rows, so a series never floods the
// tasks table or the Categories tab.
export const MATERIALIZE_AHEAD_DAYS = 2;
export const VIRTUAL_PREFIX = 'virtual:';

type TaskRowT = Database['public']['Tables']['tasks']['Row'];

function isoPlus(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/** Task-shaped rows (never written to the DB) for each date in [fromISO, toISO]
 * a rule applies on, skipping dates in `existing` ("ruleId|date") and deleted
 * occurrences. Ids look like `virtual:<ruleId>:<date>`. */
export async function virtualOccurrences(
  userId: string,
  rules: RuleRow[],
  fromISO: string,
  toISO: string,
  existing: Set<string>,
): Promise<TaskRowT[]> {
  if (!rules.length || fromISO > toISO) return [];
  const { data: ex } = await supabase
    .from('recurring_task_exceptions')
    .select('recurring_rule_id, date')
    .eq('user_id', userId)
    .gte('date', fromISO)
    .lte('date', toISO);
  const skipped = new Set((ex ?? []).map(e => `${e.recurring_rule_id}|${e.date}`));

  const out: TaskRowT[] = [];
  for (let d = fromISO; d <= toISO; d = isoPlus(d, 1)) {
    const dow = new Date(`${d}T00:00:00`).getDay();
    for (const rule of rules) {
      const key = `${rule.id}|${d}`;
      if (existing.has(key) || skipped.has(key) || !ruleDays(rule).includes(dow)) continue;
      out.push({
        id: `${VIRTUAL_PREFIX}${rule.id}:${d}`,
        user_id: userId, title: rule.title, category_id: rule.category_id, goal_id: rule.goal_id,
        recurring_rule_id: rule.id, date: d, scheduled_time: rule.scheduled_time,
        duration_minutes: rule.duration_minutes, time_period: getTimePeriod(rule.scheduled_time),
        is_completed: false, is_ttfo: false, notes: rule.notes ?? null, created_at: '',
      });
    }
  }
  return out;
}

/** Turns a `virtual:<ruleId>:<date>` id into the real task id, creating that
 * single occurrence on demand. Returns null if it doesn't apply. */
export async function materializeVirtual(userId: string, virtualId: string): Promise<string | null> {
  if (!virtualId.startsWith(VIRTUAL_PREFIX)) return null;
  const [ruleId, date] = [virtualId.slice(VIRTUAL_PREFIX.length, VIRTUAL_PREFIX.length + 36), virtualId.slice(-10)];
  await generateTasksForDate(userId, date);
  const { data } = await supabase
    .from('tasks').select('id').eq('user_id', userId).eq('recurring_rule_id', ruleId).eq('date', date).maybeSingle();
  return data?.id ?? null;
}
