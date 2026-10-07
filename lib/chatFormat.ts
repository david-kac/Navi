import type { Database } from './database.types';
import { RuleRow, cadenceLabel, nextOccurrence, avgActualMinutes } from './cadence';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ap}`;
}

/** Every task Dot sees carries an explicit completion flag. */
export function statusTag(r: Pick<TaskRow, 'is_completed' | 'is_ttfo'>): string {
  return r.is_completed ? '[DONE]' : r.is_ttfo ? '[UNDECIDED]' : '[OPEN]';
}

function detailsSuffix(notes: string | null, max = 160): string {
  if (!notes?.trim()) return '';
  const flat = notes.trim().replace(/\s+/g, ' ');
  return ` — details: ${flat.length > max ? flat.slice(0, max) + '…' : flat}`;
}

/** "assigned 10 min; avg actual 14.2 min over 5 runs" */
export function seriesStats(rule: RuleRow): string {
  const assigned = rule.duration_minutes ? `${rule.duration_minutes} min` : 'not set';
  const avg = avgActualMinutes(rule);
  return avg === null
    ? `assigned ${assigned}; no timed runs logged yet`
    : `assigned ${assigned}; avg actual ${avg.toFixed(1)} min over ${rule.run_count} run${rule.run_count === 1 ? '' : 's'}`;
}

/** One line for a single task row (id included so Dot can update/delete it). */
export function formatTaskLine(r: TaskRow, opts: { catName?: string; rule?: RuleRow; showDate?: boolean } = {}): string {
  const parts = [
    `[${r.id}]`,
    statusTag(r),
    opts.catName ? `[${opts.catName}]` : '',
    r.title,
    opts.showDate === false ? '' : `— ${r.date ?? 'no date'}`,
    `— ${r.scheduled_time ? fmt12(r.scheduled_time) : 'no time'}`,
    r.duration_minutes ? `(${r.duration_minutes} min)` : '',
  ].filter(Boolean);
  let line = `- ${parts.join(' ')}`;
  if (opts.rule) line += ` — recurring: ${cadenceLabel(opts.rule)}; ${seriesStats(opts.rule)} [seriesId: ${opts.rule.id}]`;
  return line + detailsSuffix(r.notes);
}

/** One line for a whole recurring series. */
export function formatSeriesLine(rule: RuleRow, instances: TaskRow[], catName: string | undefined, todayISO: string): string {
  const doneToday = instances.some(i => i.date === todayISO && i.is_completed);
  const next = nextOccurrence(rule, todayISO, doneToday ? todayISO : undefined);
  const rep = instances.find(i => !i.is_completed) ?? instances[0];
  const open = instances.filter(i => !i.is_completed).length;
  return `- [seriesId: ${rule.id}] RECURRING ${catName ? `[${catName}] ` : ''}${rule.title} — ${cadenceLabel(rule)} — next: ${next} — ${seriesStats(rule)} — ${instances.length} scheduled instance${instances.length === 1 ? '' : 's'} (${open} open)`
    + (rep ? ` [example instance id: ${rep.id}]` : '')
    + detailsSuffix(rule.notes ?? rep?.notes ?? null);
}

/** Non-recurring tasks individually; each recurring series once. */
export function formatCollapsed(
  rows: TaskRow[],
  rules: Record<string, RuleRow>,
  catName: (id: string | null) => string | undefined,
  todayISO: string,
  opts: { showCategory?: boolean } = {},
): string[] {
  const lines: string[] = [];
  const seen = new Map<string, TaskRow[]>();
  for (const r of rows) {
    const rule = r.recurring_rule_id ? rules[r.recurring_rule_id] : undefined;
    if (!r.recurring_rule_id || !rule) {
      lines.push(formatTaskLine(r, { catName: opts.showCategory ? (catName(r.category_id) ?? 'Open') : undefined }));
    } else {
      seen.set(r.recurring_rule_id, [...(seen.get(r.recurring_rule_id) ?? []), r]);
    }
  }
  seen.forEach((instances, ruleId) => {
    lines.push(formatSeriesLine(rules[ruleId], instances, opts.showCategory ? (catName(instances[0].category_id) ?? 'Open') : undefined, todayISO));
  });
  return lines;
}
