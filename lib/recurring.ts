import { supabase } from './supabase';
import { getTimePeriod } from './database.types';

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
