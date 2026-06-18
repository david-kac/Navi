export interface TaskSlot {
  id: string;
  title: string;
  scheduledTime?: string; // "HH:MM"
  durationMinutes?: number;
  timePeriod: string;
}

export interface Conflict {
  type: 'overlap' | 'commute' | 'date-night';
  message: string;
  taskIds: string[];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function detectConflicts(tasks: TaskSlot[], isThursday: boolean): Conflict[] {
  const conflicts: Conflict[] = [];
  const timed = tasks
    .filter(t => t.scheduledTime && t.durationMinutes)
    .sort((a, b) => toMinutes(a.scheduledTime!) - toMinutes(b.scheduledTime!));

  // Overlap detection
  for (let i = 0; i < timed.length - 1; i++) {
    const a   = timed[i];
    const aEnd = toMinutes(a.scheduledTime!) + (a.durationMinutes ?? 0);
    const b   = timed[i + 1];
    const bStart = toMinutes(b.scheduledTime!);

    if (aEnd > bStart) {
      conflicts.push({
        type:    'overlap',
        message: `"${a.title}" and "${b.title}" overlap.`,
        taskIds: [a.id, b.id],
      });
    }
  }

  // Commute buffer (7–8:30am and 5–6:30pm blocked for 45-min commute)
  for (const t of timed) {
    const start = toMinutes(t.scheduledTime!);
    const end   = start + (t.durationMinutes ?? 0);
    const amCommute = [toMinutes('07:00'), toMinutes('08:30')];
    const pmCommute = [toMinutes('17:00'), toMinutes('18:30')];

    const overlapsWindow = (ws: number, we: number) =>
      start < we && end > ws;

    if (overlapsWindow(amCommute[0], amCommute[1])) {
      conflicts.push({
        type:    'commute',
        message: `"${t.title}" overlaps with the morning commute window.`,
        taskIds: [t.id],
      });
    }
    if (overlapsWindow(pmCommute[0], pmCommute[1])) {
      conflicts.push({
        type:    'commute',
        message: `"${t.title}" overlaps with the evening commute window.`,
        taskIds: [t.id],
      });
    }
  }

  // Thursday date night protection (6pm–10pm)
  if (isThursday) {
    for (const t of timed) {
      const start = toMinutes(t.scheduledTime!);
      const end   = start + (t.durationMinutes ?? 0);
      if (start < toMinutes('22:00') && end > toMinutes('18:00')) {
        conflicts.push({
          type:    'date-night',
          message: `"${t.title}" conflicts with Thursday date night (6–10pm).`,
          taskIds: [t.id],
        });
      }
    }
  }

  return conflicts;
}
