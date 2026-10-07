import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Paperclip, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { analyzeAssetAndSuggestTasks, SuggestedTask, AssetMimeType } from '../lib/ai';
import TaskPreviewModal from '../components/TaskPreviewModal';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthProvider';
import { buildDotSystemPrompt, runPlannerTurn, AnthropicMessage, AddTaskToolInput, UpdateTaskToolInput, DeleteTaskToolInput, AddCategoryToolInput, GetTasksByDateRangeToolInput, GetTasksByCategoryToolInput } from '../lib/ai';
import { detectConflicts, Conflict, TaskSlot } from '../lib/conflicts';
import { generateTasksForDate, virtualOccurrences, materializeVirtual, MATERIALIZE_AHEAD_DAYS, VIRTUAL_PREFIX } from '../lib/recurring';
import { fmt12, formatTaskLine, formatCollapsed, seriesStats } from '../lib/chatFormat';
import { RuleRow, cadenceLabel } from '../lib/cadence';
import type { Database } from '../lib/database.types';
import { getTimePeriod } from '../lib/database.types';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}


type Mode = 'anytime' | 'evening';
type Stage = 'loading' | 'chatting';

interface DisplayMessage { id: string; kind: 'user' | 'dot' | 'added'; text: string }

const UPCOMING_WINDOW_DAYS = 28; // 4 weeks, including today

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

async function fetchTodayState(userId: string, today: string): Promise<{ rows: TaskRow[]; conflicts: Conflict[] }> {
  await generateTasksForDate(userId, today);
  const { data: rows, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .order('scheduled_time', { ascending: true });
  if (error) { console.error(error); return { rows: [], conflicts: [] }; }

  const taskRows = (rows ?? []) as TaskRow[];
  const slots: TaskSlot[] = taskRows.map(r => ({
    id:               r.id,
    title:            r.title,
    scheduledTime:    r.scheduled_time ?? undefined,
    durationMinutes:  r.duration_minutes ?? undefined,
    timePeriod:       r.time_period,
  }));
  const isThursday = new Date().getDay() === 4;
  return { rows: taskRows, conflicts: detectConflicts(slots, isThursday) };
}

// Returns every task from today through 4 weeks out so Dot can plan ahead.
// Only today + MATERIALIZE_AHEAD_DAYS are written as real rows; later
// occurrences of recurring series are computed from their rules (virtual rows,
// ids `virtual:<ruleId>:<date>`) so opening chat doesn't flood the tasks table.
async function fetchUpcomingTasks(userId: string, today: string): Promise<TaskRow[]> {
  const start = new Date(`${today}T00:00:00`);
  for (let i = 0; i <= MATERIALIZE_AHEAD_DAYS; i++) {
    await generateTasksForDate(userId, toISODate(addDays(start, i)));
  }
  const endDate = toISODate(addDays(start, UPCOMING_WINDOW_DAYS - 1));

  const { data: rows, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .gte('date', today)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('scheduled_time', { ascending: true });
  if (error) { console.error(error); return []; }
  const real = (rows ?? []) as TaskRow[];

  const rules = Object.values(await fetchRules(userId));
  const existing = new Set(real.filter(r => r.recurring_rule_id).map(r => `${r.recurring_rule_id}|${r.date}`));
  const virtual = await virtualOccurrences(userId, rules, toISODate(addDays(start, MATERIALIZE_AHEAD_DAYS + 1)), endDate, existing);
  return [...real, ...virtual].sort((a, b) =>
    (a.date ?? '').localeCompare(b.date ?? '') || (a.scheduled_time ?? '99').localeCompare(b.scheduled_time ?? '99'));
}

// Plain-language done/missed/undecided breakdown fed into the evening
// wrap-up system prompt (mirrors generateEndOfDaySummary's grouping, but as
// data for the conversational flow rather than a one-shot generated recap).
function formatEodBreakdown(rows: TaskRow[]): string {
  const real   = rows.filter(r => !r.is_ttfo);
  const done   = real.filter(r => r.is_completed).map(r => r.title);
  const missed = real.filter(r => !r.is_completed).map(r => r.title);
  const ttfo   = rows.filter(r => r.is_ttfo).map(r => r.title);
  return [
    `DONE:\n${done.length ? done.map(t => `- ${t}`).join('\n') : 'Nothing'}`,
    `MISSED:\n${missed.length ? missed.map(t => `- ${t}`).join('\n') : 'Nothing'}`,
    `STILL UNDECIDED:\n${ttfo.length ? ttfo.map(t => `- ${t}`).join('\n') : 'Nothing'}`,
  ].join('\n\n');
}

async function fetchRules(userId: string): Promise<Record<string, RuleRow>> {
  const { data, error } = await supabase.from('recurring_task_rules').select('*').eq('user_id', userId).eq('is_active', true);
  if (error) { console.error(error); return {}; }
  return Object.fromEntries((data ?? []).map(r => [r.id, r as RuleRow]));
}

export default function DotChat() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [mode, setMode] = useState<Mode>('anytime');
  const [stage, setStage] = useState<Stage>('loading');
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  // Mirrors `categories` but updated synchronously (not just on next render)
  // so a category created earlier in the same tool-call round is
  // immediately matchable by add_task/update_task later in that same round.
  const categoriesRef = useRef<CategoryRow[]>([]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const systemPromptRef = useRef('');
  const historyRef = useRef<AnthropicMessage[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  interface AttachedFile { base64: string; mimeType: AssetMimeType; name: string }
  const [attachment,     setAttachment]     = useState<AttachedFile | null>(null);
  const [analyzing,      setAnalyzing]      = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState<SuggestedTask[]>([]);
  const [showPreview,    setShowPreview]    = useState(false);

  // Claude occasionally mistypes a character or two when copying a long uuid
  // into a tool call. Before giving up, fall back to matching this user's
  // tasks by title (+ date, if given) so a near-miss id doesn't silently
  // fail move/delete requests.
  const resolveTaskId = useCallback(async (taskId: string, currentTitle?: string, currentDate?: string): Promise<string | null> => {
    if (taskId.startsWith(VIRTUAL_PREFIX) && userId) {
      const real = await materializeVirtual(userId, taskId);
      if (real) return real;
    }
    const { data: direct } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
    if (direct) return direct.id;
    if (!currentTitle || !userId) return null;

    let query = supabase.from('tasks').select('id').eq('user_id', userId).ilike('title', currentTitle.trim());
    if (currentDate) query = query.eq('date', currentDate);
    const { data: matches } = await query;
    if (matches && matches.length === 1) return matches[0].id;
    return null;
  }, [userId]);

  const executeAddTask = useCallback(async (taskInput: AddTaskToolInput): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };

    const matchedCategory = taskInput.categoryName
      ? categoriesRef.current.find(c => c.name.toLowerCase() === taskInput.categoryName!.toLowerCase())
      : undefined;
    const date = taskInput.date && /^\d{4}-\d{2}-\d{2}$/.test(taskInput.date) ? taskInput.date : toISODate(new Date());
    const scheduledTime = taskInput.scheduledTime ? `${taskInput.scheduledTime}:00` : null;

    let recurringRuleId: string | null = null;
    if (taskInput.isRecurring) {
      const ruleType = taskInput.ruleType ?? 'daily';
      const { data: rule, error: ruleError } = await supabase
        .from('recurring_task_rules')
        .insert({
          user_id:           userId,
          title:             taskInput.title,
          category_id:       matchedCategory?.id ?? null,
          rule_type:         ruleType,
          days_of_week:      ruleType === 'weekly' ? taskInput.daysOfWeek ?? null : null,
          scheduled_time:    scheduledTime,
          duration_minutes:  taskInput.durationMinutes ?? null,
          time_period:       getTimePeriod(scheduledTime),
          ...(taskInput.details?.trim() ? { notes: taskInput.details.trim() } : {}),
        })
        .select('id')
        .single();
      if (ruleError) {
        console.error(ruleError);
        return { success: false, message: `Failed to add recurring task: ${ruleError.message}` };
      }
      recurringRuleId = rule.id;
    }

    const { error } = await supabase.from('tasks').insert({
      user_id:           userId,
      title:             taskInput.title,
      category_id:       matchedCategory?.id ?? null,
      recurring_rule_id: recurringRuleId,
      date,
      scheduled_time:    scheduledTime,
      duration_minutes:  taskInput.durationMinutes ?? null,
      time_period:       getTimePeriod(scheduledTime),
      notes:             taskInput.details?.trim() || null,
    });

    if (error) {
      console.error(error);
      return { success: false, message: `Failed to add task: ${error.message}` };
    }
    setDisplay(prev => [...prev, { id: `added-${Date.now()}`, kind: 'added', text: `+ Added "${taskInput.title}"${date !== toISODate(new Date()) ? ` for ${date}` : ''}${recurringRuleId ? ' (recurring)' : ''}` }]);
    return { success: true, message: 'Task added successfully.' };
  }, [userId]);

  const executeUpdateTask = useCallback(async (taskInput: UpdateTaskToolInput): Promise<{ success: boolean; message: string }> => {
    const realId = await resolveTaskId(taskInput.taskId, taskInput.currentTitle, taskInput.currentDate);
    if (!realId) {
      return { success: false, message: "Failed to update task: couldn't find a task matching that id or title." };
    }

    const { data: current, error: currentError } = await supabase
      .from('tasks')
      .select('title, date, scheduled_time, duration_minutes, recurring_rule_id')
      .eq('id', realId)
      .single();
    if (currentError || !current) {
      return { success: false, message: `Failed to update task: ${currentError?.message ?? 'not found'}` };
    }

    const patch: Database['public']['Tables']['tasks']['Update'] = {};
    if (taskInput.title !== undefined) patch.title = taskInput.title;
    if (taskInput.clearDate) {
      patch.date = null;
    } else if (taskInput.date !== undefined) {
      patch.date = taskInput.date;
    }
    if (taskInput.clearScheduledTime) {
      patch.scheduled_time = null;
      patch.time_period = 'unscheduled';
    } else if (taskInput.scheduledTime !== undefined) {
      patch.scheduled_time = `${taskInput.scheduledTime}:00`;
      patch.time_period = getTimePeriod(patch.scheduled_time);
    }
    if (taskInput.durationMinutes !== undefined) patch.duration_minutes = taskInput.durationMinutes;
    if (taskInput.details !== undefined) patch.notes = taskInput.details.trim() || null;
    if (taskInput.categoryName !== undefined) {
      const matched = categoriesRef.current.find(c => c.name.toLowerCase() === taskInput.categoryName!.toLowerCase());
      patch.category_id = matched?.id ?? null;
    }

    // Moving to a different day — check the destination day's existing
    // schedule for overlaps before writing, instead of silently double
    // booking it. Only relevant if the moved task ends up with both a time
    // and a duration (carried over from the current row if not also changing).
    const movingToNewDay = patch.date !== undefined && patch.date !== null && patch.date !== current.date;
    if (movingToNewDay && userId) {
      const destTime     = patch.scheduled_time !== undefined ? patch.scheduled_time : current.scheduled_time;
      const destDuration = patch.duration_minutes !== undefined ? patch.duration_minutes : current.duration_minutes;
      if (destTime && destDuration) {
        const { data: destRows } = await supabase
          .from('tasks')
          .select('id, title, scheduled_time, duration_minutes, time_period')
          .eq('user_id', userId)
          .eq('date', patch.date as string)
          .neq('id', realId);

        const slots: TaskSlot[] = [
          ...(destRows ?? []).map(r => ({
            id: r.id, title: r.title,
            scheduledTime: r.scheduled_time ?? undefined,
            durationMinutes: r.duration_minutes ?? undefined,
            timePeriod: r.time_period,
          })),
          { id: realId, title: patch.title ?? current.title, scheduledTime: destTime, durationMinutes: destDuration, timePeriod: getTimePeriod(destTime) },
        ];
        const destIsThursday = new Date(`${patch.date}T00:00:00`).getDay() === 4;
        const overlaps = detectConflicts(slots, destIsThursday).filter(c => c.type === 'overlap' && c.taskIds.includes(realId));

        if (overlaps.length) {
          const otherTitles = overlaps
            .flatMap(o => o.taskIds)
            .filter(id => id !== realId)
            .map(id => (destRows ?? []).find(r => r.id === id)?.title)
            .filter((t): t is string => !!t);
          return {
            success: false,
            message: `Can't move "${patch.title ?? current.title}" to ${patch.date} at ${fmt12(destTime)} — it overlaps with ${otherTitles.join(' and ')} already scheduled that day. Do not move it. Instead propose a different open time on ${patch.date} and wait for David to confirm before calling update_task again.`,
          };
        }
      }
    }

    const { data: row, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', realId)
      .select('title')
      .single();

    if (error || !row) {
      console.error(error);
      return { success: false, message: `Failed to update task: ${error?.message ?? 'not found'}` };
    }
    // Changing the estimate for a whole series: update the rule (so future
    // instances inherit it) and every upcoming incomplete instance.
    let seriesNote = '';
    if (taskInput.applyToSeries && current.recurring_rule_id) {
      const seriesPatch: Database['public']['Tables']['recurring_task_rules']['Update'] = {};
      if (taskInput.durationMinutes !== undefined) seriesPatch.duration_minutes = taskInput.durationMinutes;
      if (taskInput.details !== undefined) seriesPatch.notes = taskInput.details.trim() || null;
      if (Object.keys(seriesPatch).length) {
        const { error: ruleError } = await supabase.from('recurring_task_rules').update(seriesPatch).eq('id', current.recurring_rule_id);
        if (ruleError) return { success: false, message: `Updated this occurrence, but failed to update the series: ${ruleError.message}` };
        const instancePatch: Database['public']['Tables']['tasks']['Update'] = {};
        if (seriesPatch.duration_minutes !== undefined) instancePatch.duration_minutes = seriesPatch.duration_minutes;
        if (seriesPatch.notes !== undefined) instancePatch.notes = seriesPatch.notes;
        await supabase.from('tasks').update(instancePatch).eq('recurring_rule_id', current.recurring_rule_id).eq('is_completed', false).gte('date', toISODate(new Date()));
        seriesNote = ' The whole series (and its upcoming instances) was updated too.';
      }
    }
    setDisplay(prev => [...prev, { id: `updated-${Date.now()}`, kind: 'added', text: `✎ Updated "${row.title}"${seriesNote ? ' (series)' : ''}` }]);
    return { success: true, message: `Task updated successfully.${seriesNote}` };
  }, [resolveTaskId, userId]);

  const executeDeleteTask = useCallback(async (taskInput: DeleteTaskToolInput): Promise<{ success: boolean; message: string }> => {
    const realId = await resolveTaskId(taskInput.taskId, taskInput.currentTitle, taskInput.currentDate);
    if (!realId) {
      return { success: false, message: "Failed to delete task: couldn't find a task matching that id or title." };
    }

    const { data: row, error: fetchError } = await supabase
      .from('tasks')
      .select('title')
      .eq('id', realId)
      .single();
    if (fetchError || !row) {
      return { success: false, message: `Failed to delete task: ${fetchError?.message ?? 'not found'}` };
    }

    const { error } = await supabase.from('tasks').delete().eq('id', realId);
    if (error) {
      console.error(error);
      return { success: false, message: `Failed to delete task: ${error.message}` };
    }
    setDisplay(prev => [...prev, { id: `deleted-${Date.now()}`, kind: 'added', text: `- Removed "${row.title}"` }]);
    return { success: true, message: 'Task deleted successfully.' };
  }, [resolveTaskId]);

  const executeReviewSchedule = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    const { conflicts: fresh } = await fetchTodayState(userId, toISODate(new Date()));
    const message = fresh.length
      ? `Found ${fresh.length} conflict(s): ${fresh.map(c => c.message).join(' ')}`
      : 'No conflicts found — schedule looks clear.';
    return { success: true, message };
  }, [userId]);

  const executeAddCategory = useCallback(async (input: AddCategoryToolInput): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    const name = input.name.trim();
    if (!name) return { success: false, message: 'Category name cannot be empty.' };

    const existing = categoriesRef.current.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return { success: true, message: `A category named "${name}" already exists — using that one.` };

    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: userId, name, icon: 'Circle' })
      .select('*')
      .single();
    if (error || !data) {
      console.error(error);
      return { success: false, message: error?.code === '23505' ? `A category named "${name}" already exists.` : `Failed to create category: ${error?.message ?? 'unknown error'}` };
    }
    categoriesRef.current = [...categoriesRef.current, data];
    setCategories(prev => [...prev, data]);
    setDisplay(prev => [...prev, { id: `cat-${Date.now()}`, kind: 'added', text: `+ Created category "${name}"` }]);
    return { success: true, message: 'Category created successfully.' };
  }, [userId]);

  const catNameOf = useCallback((id: string | null) => categoriesRef.current.find(c => c.id === id)?.name, []);

  const executeGetTasksByDateRange = useCallback(async (input: GetTasksByDateRangeToolInput): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
      return { success: false, message: 'Invalid startDate — must be YYYY-MM-DD.' };
    }
    const endDate = input.endDate && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ? input.endDate : input.startDate;

    const today = toISODate(new Date());
    const nearEnd = toISODate(addDays(new Date(`${today}T00:00:00`), MATERIALIZE_AHEAD_DAYS));
    // Only the near-term days are materialized as rows; anything further out
    // is computed from the rules below.
    for (let d = input.startDate > today ? input.startDate : today; d <= endDate && d <= nearEnd; d = toISODate(addDays(new Date(`${d}T00:00:00`), 1))) {
      await generateTasksForDate(userId, d);
    }

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .gte('date', input.startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('scheduled_time', { ascending: true });
    if (error) {
      console.error(error);
      return { success: false, message: `Failed to look up tasks: ${error.message}` };
    }

    const realRows = (data ?? []) as TaskRow[];
    const rules = await fetchRules(userId);
    const futureFrom = input.startDate > nearEnd ? input.startDate : toISODate(addDays(new Date(`${nearEnd}T00:00:00`), 1));
    const virtual = await virtualOccurrences(
      userId, Object.values(rules), futureFrom, endDate,
      new Set(realRows.filter(r => r.recurring_rule_id).map(r => `${r.recurring_rule_id}|${r.date}`)),
    );
    const rows = [...realRows, ...virtual].sort((a, b) =>
      (a.date ?? '').localeCompare(b.date ?? '') || (a.scheduled_time ?? '99').localeCompare(b.scheduled_time ?? '99'));
    if (!rows.length) return { success: true, message: `No tasks found between ${input.startDate} and ${endDate}.` };

    // A single day lists each task as-is (completion is per-day). A multi-day
    // range shows each recurring series once, summarizing its occurrences.
    if (input.startDate === endDate) {
      return { success: true, message: rows.map(r => formatTaskLine(r, { catName: catNameOf(r.category_id) ?? 'Open', rule: r.recurring_rule_id ? rules[r.recurring_rule_id] : undefined })).join('\n') };
    }
    const lines: string[] = [];
    const bySeries = new Map<string, TaskRow[]>();
    for (const r of rows) {
      const rule = r.recurring_rule_id ? rules[r.recurring_rule_id] : undefined;
      if (!rule) { lines.push(formatTaskLine(r, { catName: catNameOf(r.category_id) ?? 'Open' })); continue; }
      bySeries.set(rule.id, [...(bySeries.get(rule.id) ?? []), r]);
    }
    bySeries.forEach((inst, ruleId) => {
      const rule = rules[ruleId];
      const done = inst.filter(i => i.is_completed).length;
      const openDates = inst.filter(i => !i.is_completed).map(i => i.date).join(', ');
      lines.push(`- [seriesId: ${rule.id}] RECURRING [${catNameOf(inst[0].category_id) ?? 'Open'}] ${rule.title} — ${cadenceLabel(rule)} — ${seriesStats(rule)} — ${inst.length} occurrences in range, ${done} done${openDates ? `; still open: ${openDates}` : ''}`);
    });
    return { success: true, message: lines.join('\n') };
  }, [userId, catNameOf]);

  const executeGetUnscheduledTasks = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    // Every task with no date at all — any category or none, completed or not
    // (completed tasks stay until the daily cleanup deletes them).
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .is('date', null)
      .order('title', { ascending: true });
    if (error) {
      console.error(error);
      return { success: false, message: `Failed to look up unscheduled tasks: ${error.message}` };
    }

    const rows = (data ?? []) as TaskRow[];
    if (!rows.length) return { success: true, message: 'No dateless tasks.' };
    const rules = await fetchRules(userId);
    return { success: true, message: formatCollapsed(rows, rules, catNameOf, toISODate(new Date()), { showCategory: true }).join('\n') };
  }, [userId, catNameOf]);

  const executeGetTasksByCategory = useCallback(async (input: GetTasksByCategoryToolInput): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    const name = input.categoryName.trim();
    const isOpen = name.toLowerCase() === 'open';
    const cat = isOpen ? null : categoriesRef.current.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!isOpen && !cat) {
      return { success: false, message: `No category named "${name}" — check the available categories and try again.` };
    }

    let query = supabase.from('tasks').select('*').eq('user_id', userId);
    query = cat ? query.eq('category_id', cat.id) : query.is('category_id', null);
    if (input.includeCompleted === false) query = query.eq('is_completed', false);
    const { data, error } = await query
      .order('date', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true });
    if (error) {
      console.error(error);
      return { success: false, message: `Failed to look up category tasks: ${error.message}` };
    }

    const rows = (data ?? []) as TaskRow[];
    if (!rows.length) return { success: true, message: `No tasks in "${name}".` };
    const rules = await fetchRules(userId);
    return { success: true, message: formatCollapsed(rows, rules, catNameOf, toISODate(new Date())).join('\n') };
  }, [userId, catNameOf]);

  const executeGetAllTasks = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true });
    if (error) {
      console.error(error);
      return { success: false, message: `Failed to look up tasks: ${error.message}` };
    }
    const rows = (data ?? []) as TaskRow[];
    if (!rows.length) return { success: true, message: 'No tasks exist.' };
    const rules = await fetchRules(userId);
    const lines = formatCollapsed(rows, rules, catNameOf, toISODate(new Date()), { showCategory: true });
    return { success: true, message: `${lines.length} items (each recurring series listed once):\n${lines.join('\n')}` };
  }, [userId, catNameOf]);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access in Settings to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setAttachment({ base64: asset.base64!, mimeType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', name: asset.fileName ?? 'image.jpg' });
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as const });
    const rawMime = asset.mimeType ?? '';
    const mime: AssetMimeType = rawMime === 'application/pdf' ? 'application/pdf' : rawMime === 'image/png' ? 'image/png' : 'image/jpeg';
    setAttachment({ base64, mimeType: mime, name: asset.name });
  };

  const openPicker = () => {
    Alert.alert('Upload File', 'Choose a source', [
      { text: 'Photos', onPress: pickPhoto },
      { text: 'Files',  onPress: pickFile  },
      { text: 'Cancel', style: 'cancel'    },
    ]);
  };

  const analyzeAttachment = async () => {
    if (!attachment) return;
    setAnalyzing(true);
    try {
      const today = toISODate(new Date());
      const tasks = await analyzeAssetAndSuggestTasks({
        fileBase64:   attachment.base64,
        mimeType:     attachment.mimeType,
        description:  input.trim() || 'Extract all tasks from this document.',
        today,
        categoryNames: categories.map(c => c.name),
      });
      setSuggestedTasks(tasks);
      setShowPreview(true);
    } catch (e) {
      Alert.alert('Analysis failed', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmTasks = async (tasks: SuggestedTask[]) => {
    setShowPreview(false);
    setAttachment(null);
    setInput('');
    if (!userId) return;
    const today = toISODate(new Date());
    let created = 0;
    for (const t of tasks) {
      const matchedCat = categories.find(c => c.name.toLowerCase() === t.categoryName?.toLowerCase());
      const scheduledTime = t.scheduledTime ? `${t.scheduledTime}:00` : null;
      const { error } = await supabase.from('tasks').insert({
        user_id:           userId,
        title:             t.title,
        category_id:       matchedCat?.id ?? null,
        date:              t.date ?? today,
        scheduled_time:    scheduledTime,
        duration_minutes:  t.durationMinutes ?? null,
        time_period:       getTimePeriod(scheduledTime),
      });
      if (!error) created++;
    }
    setDisplay(prev => [...prev, { id: `added-${Date.now()}`, kind: 'added', text: `+ Created ${created} task${created !== 1 ? 's' : ''} from your upload` }]);
  };

  const greet = useCallback(async () => {
    if (!userId) return;
    setStage('loading');
    const now = new Date();
    const today = toISODate(now);

    const sessionMode: Mode = modeParam === 'evening' ? 'evening' : 'anytime';
    setMode(sessionMode);

    const { data: catRows } = await supabase.from('categories').select('*').eq('user_id', userId);
    categoriesRef.current = catRows ?? [];
    setCategories(catRows ?? []);

    const { rows: todayRows, conflicts: detected } = await fetchTodayState(userId, today);

    const upcomingRows = await fetchUpcomingTasks(userId, today);
    const rules = await fetchRules(userId);
    const upcomingTasks = upcomingRows.length
      ? upcomingRows.map(r => formatTaskLine(r) + (r.recurring_rule_id ? ' ↻' : '')).join('\n')
      : 'Nothing scheduled yet.';
    const seriesSummary = Object.values(rules).length
      ? Object.values(rules).map(rule => `- ${rule.title} — ${cadenceLabel(rule)} — ${seriesStats(rule)} [seriesId: ${rule.id}]`).join('\n')
      : '';

    const system = buildDotSystemPrompt({
      date:       now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      time:       now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      dayOfWeek:  now.toLocaleDateString('en-US', { weekday: 'long' }),
      isThursday: now.getDay() === 4,
      upcomingTasks,
      seriesSummary,
      conflicts:  detected.length ? detected.map(c => c.message).join('\n') : 'None.',
      categoryNames: (catRows ?? []).map(c => c.name),
      mode: sessionMode,
      eodBreakdown: sessionMode === 'evening' ? formatEodBreakdown(todayRows) : undefined,
    });
    systemPromptRef.current = system;

    // Evening wrap-up is a distinct session from the morning/anytime chat —
    // give it its own storage key so opening it doesn't restore (and skip
    // the greeting for) whatever David already chatted about earlier today.
    const storageKey = `dot_chat_${today}${sessionMode === 'evening' ? '_evening' : ''}`;

    // Restore persisted chat from earlier today — skip the greeting if found.
    try {
      const persisted = await AsyncStorage.getItem(storageKey);
      if (persisted) {
        const { history, display: savedDisplay } = JSON.parse(persisted);
        historyRef.current = history;
        setDisplay(savedDisplay);
        setStage('chatting');
        return;
      }
    } catch (e) {
      console.error('Failed to load chat history:', e);
    }

    const kickoff = sessionMode === 'evening'
      ? "Give me my end-of-day wrap-up: summarize what I finished, what I missed, and anything still undecided today, then ask what I want to do with anything unfinished. Keep it warm and brief."
      : 'Just say a short casual hello and ask what\'s on my mind. Keep it to one sentence.';

    setSending(true);
    try {
      const result = await runPlannerTurn(system, [], kickoff, { executeAddTask, executeUpdateTask, executeDeleteTask, executeReviewSchedule, executeAddCategory, executeGetTasksByDateRange, executeGetUnscheduledTasks, executeGetTasksByCategory, executeGetAllTasks });
      historyRef.current = result.history;
      setDisplay(prev => [...prev, { id: 'greet', kind: 'dot', text: result.replyText }]);
      setStage('chatting');
    } catch (e) {
      setDisplay(prev => [...prev, { id: 'err', kind: 'dot', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
      setStage('chatting');
    } finally {
      setSending(false);
    }
  }, [userId, modeParam, executeAddTask, executeUpdateTask, executeDeleteTask, executeReviewSchedule, executeAddCategory, executeGetTasksByDateRange, executeGetUnscheduledTasks, executeGetTasksByCategory, executeGetAllTasks]);

  useEffect(() => { greet(); }, [userId, modeParam]);

  // Persist the full chat to AsyncStorage after each completed exchange so it
  // survives navigation. The key is date- and mode-scoped (evening wrap-up
  // gets its own key — see greet()), so tomorrow starts fresh and opening
  // the wrap-up doesn't clobber or get clobbered by the daily chat.
  useEffect(() => {
    if (stage !== 'chatting' || sending) return;
    const storageKey = `dot_chat_${toISODate(new Date())}${mode === 'evening' ? '_evening' : ''}`;
    AsyncStorage.setItem(
      storageKey,
      JSON.stringify({ history: historyRef.current, display }),
    ).catch(console.error);
  }, [display, stage, sending, mode]);

  const send = async () => {
    if (attachment) { analyzeAttachment(); return; }
    const text = input.trim();
    if (!text) return;
    setDisplay(prev => [...prev, { id: `u-${Date.now()}`, kind: 'user', text }]);
    setInput('');
    setSending(true);
    try {
      const result = await runPlannerTurn(systemPromptRef.current, historyRef.current, text, { executeAddTask, executeUpdateTask, executeDeleteTask, executeReviewSchedule, executeAddCategory, executeGetTasksByDateRange, executeGetUnscheduledTasks, executeGetTasksByCategory, executeGetAllTasks });
      historyRef.current = result.history;
      setDisplay(prev => [...prev, { id: `a-${Date.now()}`, kind: 'dot', text: result.replyText }]);
    } catch (e) {
      setDisplay(prev => [...prev, { id: `e-${Date.now()}`, kind: 'dot', text: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <ChevronLeft size={16} color={INK} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{mode === 'evening' ? 'END OF DAY' : 'DOT'}</Text>
      </View>

      {stage === 'loading' && (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={INK} size="large" />
          <Text style={s.loadingTxt}>Dot is looking at your day…</Text>
        </View>
      )}

      {stage === 'chatting' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={s.chat}
            contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {display.map(m => (
              m.kind === 'added' ? (
                <View key={m.id} style={s.addedRow}><Text style={s.addedTxt}>{m.text}</Text></View>
              ) : (
                <View key={m.id} style={[s.bubble, m.kind === 'user' ? s.bubbleUser : s.bubbleDot]}>
                  <Text style={s.bubbleLabel}>{m.kind === 'user' ? 'YOU' : 'DOT'}</Text>
                  <Text style={s.bubbleTxt}>{m.text}</Text>
                </View>
              )
            ))}
            {sending && <ActivityIndicator color={INK} style={{ marginTop: 4 }} />}
          </ScrollView>

          {attachment && (
            <View style={s.attachChip}>
              <Paperclip size={11} color={INK} strokeWidth={1.5} />
              <Text style={s.attachName} numberOfLines={1}>{attachment.name}</Text>
              <TouchableOpacity onPress={() => setAttachment(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <X size={11} color={MUTED} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          )}

          <View style={s.inputRow}>
            <TouchableOpacity style={s.clipBtn} onPress={openPicker} activeOpacity={0.7}>
              <Paperclip size={16} color={attachment ? INK : MUTED} strokeWidth={1.5} />
            </TouchableOpacity>
            <TextInput
              style={s.input}
              placeholder={attachment ? 'Describe what to do with this file…' : 'Tell Dot what\'s on your mind...'}
              placeholderTextColor={MUTED}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[s.sendBtn, (sending || analyzing || (!input.trim() && !attachment)) && { opacity: 0.4 }]}
              onPress={send}
              disabled={sending || analyzing || (!input.trim() && !attachment)}
              activeOpacity={0.8}
            >
              {analyzing ? <ActivityIndicator color={BG} size="small" /> : <Text style={s.sendBtnTxt}>SEND</Text>}
            </TouchableOpacity>
          </View>

          {mode === 'evening' && (
            <TouchableOpacity style={s.lockBtn} onPress={() => router.back()} activeOpacity={0.8}>
              <Text style={s.lockBtnTxt}>DONE FOR TODAY</Text>
            </TouchableOpacity>
          )}
        </KeyboardAvoidingView>
      )}

      <TaskPreviewModal
        visible={showPreview}
        tasks={suggestedTasks}
        loading={false}
        onConfirm={confirmTasks}
        onCancel={() => setShowPreview(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  backBtn:     { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'PressStart2P', fontSize: 10, color: INK },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt:  { fontFamily: 'PressStart2P', fontSize: 8, color: INK },

  chat:   { flex: 1, paddingHorizontal: 18 },
  bubble: { borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, padding: 12, maxWidth: '90%' },
  bubbleDot:  { alignSelf: 'flex-start', backgroundColor: BG },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#F0EEEA' },
  bubbleLabel:{ fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, marginBottom: 4 },
  bubbleTxt:  { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 20 },
  addedRow:   { alignSelf: 'center', paddingVertical: 4 },
  addedTxt:   { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED },

  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 18, marginBottom: 6,
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  attachName: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: INK },

  inputRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  clipBtn:  { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS },
  input:    { flex: 1, height: 42, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 12, fontFamily: 'VT323', fontSize: 16, color: INK },
  sendBtn:  { height: 42, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: INK, borderRadius: RADIUS },
  sendBtnTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: BG },

  lockBtn: { margin: 18, backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 13, alignItems: 'center' },
  lockBtnTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: BG },
});
