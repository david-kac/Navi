import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Image, TextInput, Alert, AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import DotCharacter, { DotMood } from '../components/DotCharacter';
import PartyView from '../components/PartyView';
import BattleView from '../components/BattleView';
import AddTaskModal, { NewTask, EditableTask, DayTaskSlot } from '../components/AddTaskModal';
import type { SuggestedTask } from '../lib/ai';
import TaskActionSheet from '../components/TaskActionSheet';
import CategoryActionSheet from '../components/CategoryActionSheet';
import InlineCalendar from '../components/InlineCalendar';
import TaskDetailModal from '../components/TaskDetailModal';
import TimerPickerModal, { TimerPickOption } from '../components/TimerPickerModal';
import { pickFreeSprite } from '../components/FreeSprites';
import { TimerState, loadTimer, saveTimer, newTimer, stopTimer, resumeTimer, elapsedMs, isRunning } from '../lib/timer';
import { RuleRow, cadenceLabel, nextOccurrence } from '../lib/cadence';
import { DEFAULT_CATEGORIES, OPEN_CATEGORY, OPEN_CATEGORY_ID } from '../constants/categories';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthProvider';
import type { Database } from '../lib/database.types';
import { getTimePeriod } from '../lib/database.types';
import { generateTasksForDate, deleteRecurringOccurrence, deleteRecurringSeries } from '../lib/recurring';
import { shouldRunDailyCleanup, markDailyCleanupRun, shouldRunStaleDateSweep, markStaleDateSweepRun } from '../lib/taskCleanup';
import { getVerseOfTheDay, Verse } from '../lib/verseOfTheDay';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
import {
  Book, BookOpen, Briefcase, Calendar, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Circle, ClipboardList, Dumbbell,
  Heart, Home as HomeIcon, Layers, Pencil, Plus,
  RefreshCw, Repeat, Sparkles, Star, Sun, Timer, X, Zap,
} from 'lucide-react-native';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const OLIVE  = '#7A8B5A';
const GREEN  = '#4DB860';
const RED    = '#C0392B';
const BORDER = 1.354;
const DASH   = 0.677;
const RADIUS = 4;
const MARGIN = 18;

// ─── Types ─────────────────────────────────────────────────────────────────────
type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'unscheduled';
type ActiveTab  = 'DAY' | 'CATS';
type ActiveView = 'home' | 'party' | 'battle';

interface Task {
  id:             string;
  title:          string;
  categoryId:     string | null;
  date:           string | null;
  recurringRuleId: string | null;
  scheduledTime?: string;
  durationMins?:  number;
  isRecurring:    boolean;
  isCompleted:    boolean;
  timePeriod:     TimePeriod;
  isTTFO:         boolean;
  details?:       string;
}

// ─── DB row to UI model ─────────────────────────────────────────────────────
function rowToTask(row: TaskRow): Task {
  return {
    id:              row.id,
    title:           row.title,
    categoryId:      row.category_id,
    date:            row.date,
    recurringRuleId: row.recurring_rule_id,
    scheduledTime:   row.scheduled_time ?? undefined,
    durationMins:    row.duration_minutes ?? undefined,
    isRecurring:     row.recurring_rule_id !== null,
    isCompleted:     row.is_completed,
    timePeriod:      getTimePeriod(row.scheduled_time),
    isTTFO:          row.is_ttfo,
    details:         row.notes ?? undefined,
  };
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sentinel that sorts after every real "HH:MM:SS" string, so unscheduled
// tasks (no start time) always land last within their group.
const timeSortKey = (t?: string) => t ?? '99:99:99';

// Keeps the Day view's task list chronological by start time immediately
// after an add/edit, instead of waiting for the next full reload to re-sort.
function sortByTime(list: Task[]): Task[] {
  return [...list].sort((a, b) => timeSortKey(a.scheduledTime).localeCompare(timeSortKey(b.scheduledTime)));
}

// Same idea for the Categories tab's 30-day window, which is grouped by
// date first (dateless tasks sort last), then by start time within a date.
function sortByDateThenTime(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    const ad = a.date ?? '9999-99-99';
    const bd = b.date ?? '9999-99-99';
    return ad !== bd ? ad.localeCompare(bd) : timeSortKey(a.scheduledTime).localeCompare(timeSortKey(b.scheduledTime));
  });
}

// Converts AddTaskModal's "08:00 AM" label to a Postgres `time` literal.
function to24Hour(label: string): string | null {
  const match = label.match(/^(\d{2}):(\d{2}) (AM|PM)$/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  if (match[3] === 'PM' && h !== 12) h += 12;
  if (match[3] === 'AM' && h === 12) h = 0;
  return `${h.toString().padStart(2, '0')}:${match[2]}:00`;
}

// ─── Free time ─────────────────────────────────────────────────────────────────
const FREE_MIN_GAP = 15;      // smallest gap (min) worth showing as a FREE TIME block
const DEFAULT_TASK_MINS = 30; // timed tasks with no duration are assumed this long (same as AddTaskModal's open slots)

interface FreeBlock { startMin: number; endMin: number }

const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// For each gap between consecutive timed tasks, returns the block keyed by the
// id of the task that precedes it (blocks render right after that task).
function computeFreeBlocks(dayTasks: Task[]): Map<string, FreeBlock> {
  const timed = dayTasks
    .filter(t => t.scheduledTime && !t.isTTFO)
    .map(t => ({ id: t.id, start: toMinutes(t.scheduledTime!), dur: t.durationMins ?? DEFAULT_TASK_MINS }))
    .sort((a, b) => a.start - b.start);
  const out = new Map<string, FreeBlock>();
  let ownerId: string | null = null;
  let maxEnd = -1;
  for (const t of timed) {
    if (ownerId && t.start - maxEnd >= FREE_MIN_GAP) out.set(ownerId, { startMin: maxEnd, endMin: t.start });
    if (t.start + t.dur > maxEnd) { maxEnd = t.start + t.dur; ownerId = t.id; }
  }
  return out;
}

const minLabel = (m: number) => fmt12(`${Math.floor(m / 60) % 24}:${(m % 60).toString().padStart(2, '0')}`);

// Sunday-start week containing `d`, as YYYY-MM-DD strings.
function weekDatesSunday(d: Date): string[] {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

// ─── Icon grid for new category ─────────────────────────────────────────────────
const CAT_ICON_GRID = [
  'Sun','Heart','Briefcase','Dumbbell',
  'Pencil','Star','Home','Layers',
  'Circle','BookOpen','Zap','Calendar',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt12(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2,'0')} ${ap}`;
}

// When a task has both a start time and a duration, show the computed end
// time ("7:00 AM - 7:30 AM") instead of a separate duration chip. Falls back
// to just the start time, or just the duration, when only one is set.
function timeLabel(scheduledTime?: string, durationMins?: number): string | null {
  if (!scheduledTime) return durationMins ? `${durationMins}m` : null;
  if (!durationMins) return fmt12(scheduledTime);
  const [h, m] = scheduledTime.split(':').map(Number);
  const endTotal = (h * 60 + m + durationMins) % (24 * 60);
  const endH = Math.floor(endTotal / 60);
  const endM = endTotal % 60;
  const endStr = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  return `${fmt12(scheduledTime)} - ${fmt12(endStr)} · ${durationMins}m`;
}

function nowStr() {
  const d = new Date(), h = d.getHours(), m = d.getMinutes().toString().padStart(2,'0');
  const ap = h >= 12 ? 'PM' : 'AM', h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12.toString().padStart(2,'0')}:${m} ${ap}`;
}

// ─── Lucide icon by name ────────────────────────────────────────────────────────
function NamedIcon({ name, size = 14, color = INK }: { name: string; size?: number; color?: string }) {
  const p = { size, color, strokeWidth: 1.5 } as const;
  switch (name) {
    case 'Sun':          return <Sun          {...p} />;
    case 'Heart':        return <Heart        {...p} />;
    case 'Briefcase':    return <Briefcase    {...p} />;
    case 'Dumbbell':     return <Dumbbell     {...p} />;
    case 'Pencil':       return <Pencil       {...p} />;
    case 'Star':         return <Star         {...p} />;
    case 'Home':         return <HomeIcon     {...p} />;
    case 'Layers':       return <Layers       {...p} />;
    case 'Circle':       return <Circle       {...p} />;
    case 'BookOpen':     return <BookOpen     {...p} />;
    case 'Zap':          return <Zap          {...p} />;
    case 'Calendar':     return <Calendar     {...p} />;
    case 'Sparkles':     return <Sparkles     {...p} />;
    case 'ClipboardList':return <ClipboardList {...p} />;
    default:             return <Star         {...p} />;
  }
}

// ─── Status row ────────────────────────────────────────────────────────────────
function StatusRow({ time }: { time: string }) {
  return (
    <View style={s.statusRow}>
      <Text style={s.statusTime}>{time}</Text>
      <Text style={s.statusDot}><Text style={{ color: GREEN }}>●</Text>{' DOT'}</Text>
    </View>
  );
}

const BANNER_ACTIVE   = require('../assets/Party Active.png');
const BANNER_INACTIVE = require('../assets/Party inactive.png');
const SWORD_ACTIVE    = require('../assets/Battle active.png');
const SWORD_INACTIVE  = require('../assets/Battle inactive.png');

// ─── Dot + action buttons ──────────────────────────────────────────────────────
function DotHeader({ mood, onAdd, onOpenChat, onLongPressDot, activeView, onToggleParty, onToggleBattle, timerActive, timerRunning, onPressTimer }: {
  mood: DotMood; onAdd: () => void; onOpenChat: () => void; onLongPressDot: () => void;
  activeView: ActiveView; onToggleParty: () => void; onToggleBattle: () => void;
  timerActive: boolean; timerRunning: boolean; onPressTimer: () => void;
}) {
  return (
    <View style={s.dotHeader}>
      <TouchableOpacity onPress={onOpenChat} onLongPress={onLongPressDot} delayLongPress={600} activeOpacity={0.8}>
        <DotCharacter mood={mood} />
      </TouchableOpacity>
      <View style={s.dotBtns}>
        <TouchableOpacity style={[s.timerBtn, timerActive && s.timerBtnOn]} onPress={onPressTimer} activeOpacity={0.7}>
          <Timer size={16} color={timerActive ? BG : INK} strokeWidth={1.5} />
          {timerRunning && <Text style={s.timerDot}>●</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.bannerBtn} onPress={onToggleBattle} activeOpacity={0.7}>
          <Image source={activeView === 'battle' ? SWORD_ACTIVE : SWORD_INACTIVE} style={[s.bannerIcon, { marginLeft: 4 }]} resizeMode="contain" />
        </TouchableOpacity>
        <TouchableOpacity style={[s.bannerBtn, { marginRight: 4 }]} onPress={onToggleParty} activeOpacity={0.7}>
          <Image source={activeView === 'party' ? BANNER_ACTIVE : BANNER_INACTIVE} style={s.bannerIcon} resizeMode="contain" />
        </TouchableOpacity>
        <TouchableOpacity style={s.dotBtn} onPress={onAdd} activeOpacity={0.7}><Plus size={15} color={INK} strokeWidth={2} /></TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Tab bar ───────────────────────────────────────────────────────────────────
const TABS: ActiveTab[] = ['DAY', 'CATS'];

function TabBar({ active, onChange }: { active: ActiveTab; onChange: (t: ActiveTab) => void }) {
  return (
    <View style={s.tabWrap}>
      <View style={s.tabBar}>
        {TABS.map((t, i) => (
          <TouchableOpacity key={t} style={[s.tab, i > 0 && s.tabDiv, active === t && s.tabOn]} onPress={() => onChange(t)} activeOpacity={0.8}>
            <Text style={[s.tabTxt, active === t && s.tabTxtOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Verse card ────────────────────────────────────────────────────────────────
function VerseCard({ verse }: { verse: Verse | null }) {
  return (
    <View style={s.verse}>
      <Text style={[s.corner, s.cTL]}>✦</Text><Text style={[s.corner, s.cTR]}>✦</Text>
      <Text style={[s.corner, s.cBL]}>✦</Text><Text style={[s.corner, s.cBR]}>✦</Text>
      <View style={s.verseBody}>
        <Text style={s.verseLabel}>VERSE</Text>
        <Text style={s.verseText}>"{verse?.text ?? 'Loading…'}"</Text>
        {verse ? <Text style={s.verseRef}>— {verse.reference}</Text> : null}
      </View>
    </View>
  );
}

// ─── Date nav ──────────────────────────────────────────────────────────────────
function DateNavRow({
  date, calOpen, onToggleCal, onPrev, onNext,
}: { date: Date; calOpen: boolean; onToggleCal: () => void; onPrev: () => void; onNext: () => void }) {
  const todayStr = new Date().toDateString();
  const isToday  = date.toDateString() === todayStr;
  const dayDate  = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const label    = isToday ? `Today  ${dayDate}` : dayDate;

  return (
    <View style={s.dateBar}>
      {/* Previous */}
      <TouchableOpacity style={s.dateSeg} onPress={onPrev} activeOpacity={0.7}>
        <ChevronLeft size={14} color={INK} strokeWidth={2} />
      </TouchableOpacity>

      {/* Date label — expands to fill */}
      <View style={[s.dateSeg, s.dateSegFlex, s.dateSegDivL]}>
        <Text style={s.dateLabel}>{label}</Text>
      </View>

      {/* Calendar toggle — fills black when open */}
      <TouchableOpacity
        style={[s.dateSeg, s.dateSegDivL, calOpen && s.dateSegActive]}
        onPress={onToggleCal}
        activeOpacity={0.7}
      >
        <Calendar size={13} color={calOpen ? BG : INK} strokeWidth={1.5} />
      </TouchableOpacity>

      {/* Next */}
      <TouchableOpacity style={[s.dateSeg, s.dateSegDivL]} onPress={onNext} activeOpacity={0.7}>
        <ChevronRight size={14} color={INK} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return <View style={s.sectionRow}><Text style={s.sectionTxt}>{title}</Text></View>;
}

// ─── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, icon, onToggle, onLongPress, onOpen }: { task: Task; icon: string; onToggle: (id: string) => void; onLongPress: (task: Task) => void; onOpen: (task: Task) => void }) {
  const sub = timeLabel(task.scheduledTime, task.durationMins);
  return (
    <TouchableOpacity
      style={[s.card, task.isCompleted && s.cardFaded]}
      onPress={() => onOpen(task)}
      onLongPress={() => onLongPress(task)}
      delayLongPress={400}
      activeOpacity={0.85}
    >
      <View style={s.cardIconWrap}><NamedIcon name={icon} size={14} color={INK} /></View>
      <TouchableOpacity onPress={() => onToggle(task.id)} style={s.checkHit}>
        <View style={[s.checkbox, task.isCompleted && s.checkboxOn]}>
          {task.isCompleted && <Text style={s.checkmark}>✓</Text>}
        </View>
      </TouchableOpacity>
      <View style={s.cardContent}>
        <View style={s.titleRow}>
          <Text style={[s.cardTitle, s.titleFlex, task.isCompleted && s.cardTitleDone]} numberOfLines={1}>{task.title}</Text>
          {task.details ? <Book size={12} color={MUTED} strokeWidth={1.5} /> : null}
        </View>
        {sub ? <Text style={s.cardSub}>{sub}</Text> : null}
      </View>
      {task.isRecurring && <Repeat size={12} color={MUTED} strokeWidth={1.5} />}
    </TouchableOpacity>
  );
}

// ─── Period group ──────────────────────────────────────────────────────────────
function FreeBlockCard({ block }: { block: FreeBlock }) {
  const sprite = pickFreeSprite(block.startMin);
  return (
    <View style={s.freeCard}>
      <View style={s.freeIcon}>{sprite.render()}</View>
      <View style={{ flex: 1 }}>
        <Text style={s.freeTitle}>FREE TIME</Text>
        <Text style={s.cardSub}>{minLabel(block.startMin)} - {minLabel(block.endMin)} · {block.endMin - block.startMin}m</Text>
      </View>
    </View>
  );
}

function PeriodGroup({ period, tasks, categoryIconMap, onToggle, onLongPress, onOpen, freeBlocks }: { period: TimePeriod; tasks: Task[]; categoryIconMap: Record<string, string>; onToggle: (id:string)=>void; onLongPress: (task: Task)=>void; onOpen: (task: Task)=>void; freeBlocks?: Map<string, FreeBlock> }) {
  if (!tasks.length) return null;
  return (
    <View style={s.periodGroup}>
      <SectionHeader title={period.toUpperCase()} />
      {tasks.map(t => (
        <React.Fragment key={t.id}>
          <TaskCard task={t} icon={categoryIconMap[t.categoryId ?? ''] ?? 'ClipboardList'} onToggle={onToggle} onLongPress={onLongPress} onOpen={onOpen} />
          {freeBlocks?.has(t.id) ? <FreeBlockCard block={freeBlocks.get(t.id)!} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── TTFO ─────────────────────────────────────────────────────────────────────
function TTFOSection({ tasks, categoryIconMap, onToggle, onLongPress, onOpen }: { tasks: Task[]; categoryIconMap: Record<string, string>; onToggle: (id:string)=>void; onLongPress: (task: Task)=>void; onOpen: (task: Task)=>void }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <View style={s.ttfoWrap}>
      <View style={s.ttfoLine} />
      <TouchableOpacity style={s.ttfoRow} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
        <ChevronRight size={12} color={MUTED} strokeWidth={2}
          style={open ? ({ transform: [{ rotate: '90deg' }] } as any) : undefined} />
        <Text style={s.ttfoTitle}>THINGS TO FIGURE OUT</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.ttfoCount}>{tasks.length}</Text>
      </TouchableOpacity>
      {open && tasks.map(t => <TaskCard key={t.id} task={t} icon={categoryIconMap[t.categoryId ?? ''] ?? 'ClipboardList'} onToggle={onToggle} onLongPress={onLongPress} onOpen={onOpen} />)}
    </View>
  );
}

// ─── All-complete celebration row ──────────────────────────────────────────────
function RelaxRow() {
  return (
    <View style={s.relaxRow}>
      <Text style={s.relaxTxt}>TIME TO RELAX.</Text>
      {/* Negative margin cancels DotCharacter's hardcoded marginLeft: 16 */}
      <View style={{ marginLeft: -20, marginTop: -8 }}>
        <DotCharacter mood="sleeping" size={80} animated={false} />
      </View>
    </View>
  );
}

// ─── Footer ────────────────────────────────────────────────────────────────────
function Footer({ tasks, onEndDay }: { tasks: Task[]; onEndDay: () => void }) {
  const left = tasks.filter(t => !t.isTTFO && !t.isCompleted).length;
  return (
    <View style={s.footer}>
      <Text style={s.footerCount}>{left} TASKS LEFT</Text>
      <TouchableOpacity style={s.endBtn} onPress={onEndDay} activeOpacity={0.8}>
        <Text style={s.endBtnTxt}>END MY DAY</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Categories / CATS View ────────────────────────────────────────────────────
interface CatsViewProps {
  tab: ActiveTab;
  onTabChange: (t: ActiveTab) => void;
  categories: Pick<CategoryRow, 'id' | 'name' | 'icon'>[];
  tasks: Task[];
  onToggleTask: (id: string) => void;
  onLongPressTask: (task: Task) => void;
  onAddTask: (categoryId: string, title: string) => void;
  onAddCategory: (name: string, icon: string) => Promise<{ success: boolean; message?: string }>;
  onEditCategory: (id: string, name: string, icon: string) => void;
  onDeleteCategory: (id: string) => void;
  onDeleteCompleted: () => void;
  rules: Record<string, RuleRow>;
  onOpenTask: (task: Task) => void;
}

// One row per recurring series instead of one per generated instance. The row
// is represented by the series' next incomplete occurrence (falling back to the
// latest instance when everything is done), so toggle/edit/delete act on a real task.
interface CatEntry { task: Task; rule?: RuleRow; next?: string }

function collapseSeries(list: Task[], rules: Record<string, RuleRow>, todayISO: string): CatEntry[] {
  const entries: CatEntry[] = [];
  const bySeries = new Map<string, Task[]>();
  for (const t of list) {
    const rule = t.recurringRuleId ? rules[t.recurringRuleId] : undefined;
    if (!t.recurringRuleId || !rule) { entries.push({ task: t }); continue; }
    bySeries.set(t.recurringRuleId, [...(bySeries.get(t.recurringRuleId) ?? []), t]);
  }
  bySeries.forEach((instances, ruleId) => {
    const rule = rules[ruleId];
    const ordered = sortByDateThenTime(instances);
    const upcoming = ordered.find(t => !t.isCompleted && (!t.date || t.date >= todayISO));
    const rep = upcoming ?? ordered.find(t => !t.isCompleted) ?? ordered[ordered.length - 1];
    const doneToday = ordered.some(t => t.date === todayISO && t.isCompleted);
    entries.push({ task: rep, rule, next: nextOccurrence(rule, todayISO, doneToday ? todayISO : undefined) });
  });
  return entries.sort((a, b) => {
    const ad = a.next ?? a.task.date ?? '9999-99-99';
    const bd = b.next ?? b.task.date ?? '9999-99-99';
    return ad !== bd ? ad.localeCompare(bd) : timeSortKey(a.task.scheduledTime).localeCompare(timeSortKey(b.task.scheduledTime));
  });
}

function relDateLabel(iso: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + 'T00:00:00');
  return d.getTime() === today.getTime()
    ? 'Today'
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function CatsView({
  tab, onTabChange, categories, tasks, rules, onOpenTask,
  onToggleTask, onLongPressTask, onAddTask, onAddCategory, onEditCategory, onDeleteCategory, onDeleteCompleted,
}: CatsViewProps) {
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [showNew,     setShowNew]     = useState(false);
  const [newName,     setNewName]     = useState('');
  const [selIcon,     setSelIcon]     = useState(0);
  const [savingCat,   setSavingCat]   = useState(false);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [categoryActionId, setCategoryActionId] = useState<string | null>(null);
  const categoryAction = categories.find(c => c.id === categoryActionId) ?? null;

  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editName,     setEditName]     = useState('');
  const [editIcon,     setEditIcon]     = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  // The edit form renders near the bottom of the list — jump the scroll
  // there when it opens so it's actually visible instead of requiring a
  // manual scroll down from wherever the list happened to be.
  useEffect(() => {
    if (editingCatId) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [editingCatId]);

  const toggleExpanded = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const submitDraft = (categoryId: string) => {
    const title = (draftTitles[categoryId] ?? '').trim();
    if (!title) return;
    onAddTask(categoryId, title);
    setDraftTitles(prev => ({ ...prev, [categoryId]: '' }));
  };

  const submitNewCategory = async () => {
    const name = newName.trim();
    if (!name || savingCat) return;
    setSavingCat(true);
    const result = await onAddCategory(name, CAT_ICON_GRID[selIcon]);
    setSavingCat(false);
    if (!result.success) {
      Alert.alert('Could not create category', result.message ?? 'Something went wrong.');
      return;
    }
    setShowNew(false); setNewName(''); setSelIcon(0);
  };

  const confirmDeleteCompleted = () => {
    Alert.alert('Delete all completed tasks?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDeleteCompleted },
    ]);
  };

  return (
    <ScrollView ref={scrollRef} style={s.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.todoWrap}><Text style={s.todoText}>TO-DO</Text></View>
      <TabBar active={tab} onChange={onTabChange} />
      <View style={s.catsHead}><Text style={s.catsHeadLabel}>CATEGORIES</Text></View>

      {categories.map(cat => {
        const isExp    = expanded.has(cat.id);
        const catTasks = collapseSeries(
          tasks.filter(t => cat.id === OPEN_CATEGORY_ID ? t.categoryId === null : t.categoryId === cat.id),
          rules, toISODate(new Date()),
        );
        return (
          <View key={cat.id} style={s.accordion}>
            {/* Header */}
            <TouchableOpacity
              style={[s.accHeader, isExp && s.accHeaderExp]}
              onPress={() => toggleExpanded(cat.id)}
              onLongPress={() => setCategoryActionId(cat.id)}
              delayLongPress={400}
              activeOpacity={0.8}
            >
              <NamedIcon name={cat.icon} size={13} color={isExp ? BG : INK} />
              <Text style={[s.accName, isExp && s.accNameExp]}>{cat.name.toUpperCase()}</Text>
              <View style={{ flex: 1 }} />
              <Text style={[s.accCount, isExp && s.accCountExp]}>{catTasks.length}</Text>
              {isExp
                ? <ChevronUp   size={11} color={BG}  strokeWidth={2} />
                : <ChevronDown size={11} color={INK} strokeWidth={2} />}
            </TouchableOpacity>

            {/* Body */}
            {isExp && (
              <View style={s.accBody}>
                {catTasks.map(({ task: t, rule, next }) => (
                  <TouchableOpacity
                    key={rule ? `series-${rule.id}` : t.id}
                    style={s.accTask}
                    onPress={() => onOpenTask(t)}
                    onLongPress={() => onLongPressTask(t)}
                    delayLongPress={400}
                    activeOpacity={0.85}
                  >
                    <TouchableOpacity onPress={() => onToggleTask(t.id)}>
                      <View style={[s.accCheckbox, t.isCompleted && s.checkboxOn]}>
                        {t.isCompleted && <Text style={s.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                    <View style={s.accTaskContent}>
                      <View style={s.titleRow}>
                        <Text style={[s.accTaskName, s.titleFlex, t.isCompleted && s.cardTitleDone]} numberOfLines={1}>{t.title}</Text>
                        {t.details ? <Book size={11} color={MUTED} strokeWidth={1.5} /> : null}
                      </View>
                      {(() => {
                        const parts = rule
                          ? [cadenceLabel(rule), `Next: ${relDateLabel(next!)}`, t.durationMins ? `${t.durationMins}m` : null]
                          : [t.date ? relDateLabel(t.date) : 'No date', timeLabel(t.scheduledTime, t.durationMins)];
                        const shown = parts.filter(Boolean);
                        return shown.length ? <Text style={s.accTaskSub}>{shown.join(' · ')}</Text> : null;
                      })()}
                    </View>
                    {t.isRecurring && <Repeat size={11} color={MUTED} strokeWidth={1.5} />}
                  </TouchableOpacity>
                ))}
                {/* Inline add */}
                <View style={s.accAddRow}>
                  <TextInput
                    style={s.accAddInput}
                    placeholder="Add task..."
                    placeholderTextColor={MUTED}
                    value={draftTitles[cat.id] ?? ''}
                    onChangeText={v => setDraftTitles(prev => ({ ...prev, [cat.id]: v }))}
                    onSubmitEditing={() => submitDraft(cat.id)}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={s.accAddBtn} onPress={() => submitDraft(cat.id)}>
                    <Plus size={11} color={BG} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}

      {/* + NEW CATEGORY */}
      {!editingCatId && (
        <TouchableOpacity style={s.newCatTrigger} onPress={() => setShowNew(!showNew)} activeOpacity={0.7}>
          <Plus size={12} color={INK} strokeWidth={2} />
          <Text style={s.newCatTriggerTxt}>NEW CATEGORY</Text>
        </TouchableOpacity>
      )}

      {/* DELETE ALL COMPLETED TASKS */}
      {!editingCatId && (
        <TouchableOpacity style={s.deleteCompletedTrigger} onPress={confirmDeleteCompleted} activeOpacity={0.7}>
          <Text style={s.deleteCompletedTxt}>DELETE ALL COMPLETED TASKS</Text>
        </TouchableOpacity>
      )}

      {/* New category form */}
      {showNew && !editingCatId && (
        <View style={s.newCatCard}>
          <Text style={s.newCatLabel}>NEW CATEGORY</Text>
          <TextInput
            style={s.newCatInput}
            placeholder="Category name..."
            placeholderTextColor={MUTED}
            value={newName}
            onChangeText={setNewName}
          />
          <Text style={s.newCatIconLabel}>CHOOSE ICON</Text>
          <View style={s.iconGrid}>
            {CAT_ICON_GRID.map((icon, i) => (
              <TouchableOpacity
                key={icon}
                style={[s.iconGridBtn, selIcon === i && s.iconGridBtnOn]}
                onPress={() => setSelIcon(i)}
                activeOpacity={0.7}
              >
                <NamedIcon name={icon} size={16} color={selIcon === i ? BG : INK} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.newCatActions}>
            <TouchableOpacity
              style={[s.newCatAdd, savingCat && { opacity: 0.5 }]}
              onPress={submitNewCategory}
              disabled={savingCat}
              activeOpacity={0.8}
            >
              <Text style={s.newCatAddTxt}>{savingCat ? 'SAVING…' : 'ADD'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.newCatClose} onPress={() => setShowNew(false)} activeOpacity={0.7}>
              <X size={14} color={INK} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Edit category form */}
      {editingCatId && (
        <View style={s.newCatCard}>
          <Text style={s.newCatLabel}>EDIT CATEGORY</Text>
          <TextInput
            style={s.newCatInput}
            placeholder="Category name..."
            placeholderTextColor={MUTED}
            value={editName}
            onChangeText={setEditName}
          />
          <Text style={s.newCatIconLabel}>CHOOSE ICON</Text>
          <View style={s.iconGrid}>
            {CAT_ICON_GRID.map((icon, i) => (
              <TouchableOpacity
                key={icon}
                style={[s.iconGridBtn, editIcon === i && s.iconGridBtnOn]}
                onPress={() => setEditIcon(i)}
                activeOpacity={0.7}
              >
                <NamedIcon name={icon} size={16} color={editIcon === i ? BG : INK} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.newCatActions}>
            <TouchableOpacity
              style={s.newCatAdd}
              onPress={() => {
                if (!editName.trim() || !editingCatId) return;
                onEditCategory(editingCatId, editName.trim(), CAT_ICON_GRID[editIcon]);
                setEditingCatId(null);
              }}
              activeOpacity={0.8}
            >
              <Text style={s.newCatAddTxt}>SAVE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.newCatClose} onPress={() => setEditingCatId(null)} activeOpacity={0.7}>
              <X size={14} color={INK} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={{ height: 32 }} />

      <CategoryActionSheet
        visible={!!categoryAction}
        categoryName={categoryAction?.name ?? ''}
        canModify={categoryActionId !== OPEN_CATEGORY_ID}
        onClose={() => setCategoryActionId(null)}
        onEdit={() => {
          if (categoryAction) {
            setEditingCatId(categoryAction.id);
            setEditName(categoryAction.name);
            setEditIcon(Math.max(0, CAT_ICON_GRID.indexOf(categoryAction.icon)));
            setShowNew(false);
          }
          setCategoryActionId(null);
        }}
        onDelete={() => {
          if (categoryActionId) onDeleteCategory(categoryActionId);
          setCategoryActionId(null);
        }}
      />
    </ScrollView>
  );
}

// ─── Home Screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [time,         setTime]        = useState(nowStr);
  const [tab,          setTab]         = useState<ActiveTab>('DAY');
  const [tasks,        setTasks]       = useState<Task[]>([]);
  const [catTasks,     setCatTasks]    = useState<Task[]>([]);
  const [categories,   setCategories]  = useState<CategoryRow[]>([]);
  const [verse,        setVerse]       = useState<Verse | null>(null);
  const [showCal,      setShowCal]     = useState(false);
  const [showAddTask,  setShowAddTask] = useState(false);
  const [selectedDate, setSelectedDate]= useState(new Date());
  const [actionTask,   setActionTask]  = useState<Task | null>(null);
  const [editingTask,  setEditingTask] = useState<Task | null>(null);
  const [activeView,   setActiveView]  = useState<ActiveView>('home');
  const [rules,        setRules]       = useState<Record<string, RuleRow>>({});
  const [showFree,     setShowFree]    = useState(false);
  const [timer,        setTimer]       = useState<TimerState | null>(null);
  const [detailTaskId, setDetailTaskId]= useState<string | null>(null);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [pickerTasks,  setPickerTasks] = useState<Task[]>([]);

  useEffect(() => {
    loadTimer().then(setTimer);
    AsyncStorage.getItem('dot:showFreeTime').then(v => setShowFree(v === '1')).catch(() => {});
  }, []);

  const updateTimer = useCallback((t: TimerState | null) => { setTimer(t); saveTimer(t); }, []);
  const toggleFree = useCallback(() => {
    setShowFree(v => {
      AsyncStorage.setItem('dot:showFreeTime', v ? '0' : '1').catch(() => {});
      return !v;
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTime(nowStr()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load (and lazily seed) this user's categories once.
  const loadCategories = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) { console.error(error); return; }

    if (!data || data.length === 0) {
      // Upsert with ignoreDuplicates rather than a plain insert: a concurrent
      // call to loadCategories (e.g. a second focus event firing before this
      // one resolves) could see zero rows too and race to seed the same
      // defaults. The (user_id, name) unique index makes that race a no-op
      // instead of producing duplicate categories.
      const { error: seedError } = await supabase
        .from('categories')
        .upsert(
          DEFAULT_CATEGORIES.map(c => ({ user_id: userId, name: c.name, icon: c.icon, color: c.color ?? null })),
          { onConflict: 'user_id,name', ignoreDuplicates: true }
        );
      if (seedError) { console.error(seedError); return; }
      const { data: seeded, error: refetchError } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (refetchError) { console.error(refetchError); return; }
      setCategories(seeded ?? []);
      return;
    }
    setCategories(data);
  }, [userId]);


  const addCategory = useCallback(async (name: string, icon: string): Promise<{ success: boolean; message?: string }> => {
    if (!userId) return { success: false, message: 'Not signed in.' };
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: userId, name, icon })
      .select('*')
      .single();
    if (error || !data) {
      console.error(error);
      return { success: false, message: error?.code === '23505' ? `A category named "${name}" already exists.` : (error?.message ?? 'Failed to create category.') };
    }
    setCategories(prev => [...prev, data]);
    return { success: true };
  }, [userId]);

  const updateCategory = useCallback(async (id: string, name: string, icon: string) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name, icon } : c));
    const { error } = await supabase.from('categories').update({ name, icon }).eq('id', id);
    if (error) console.error(error);
  }, []);

  const removeCategory = useCallback(async (id: string) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    setTasks(prev => prev.map(t => t.categoryId === id ? { ...t, categoryId: null } : t));
    setCatTasks(prev => prev.map(t => t.categoryId === id ? { ...t, categoryId: null } : t));
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) console.error(error);
  }, []);

  // Shared by the manual "Delete all completed tasks" button and the
  // once-per-day auto-cleanup effect below — deletes every completed task
  // for this user regardless of date, not just what's currently loaded.
  const deleteCompletedTasks = useCallback(async () => {
    if (!userId) return;
    const { error } = await supabase.from('tasks').delete().eq('user_id', userId).eq('is_completed', true);
    if (error) { console.error(error); return; }
    setTasks(prev => prev.filter(t => !t.isCompleted));
    setCatTasks(prev => prev.filter(t => !t.isCompleted));
  }, [userId]);

  // Once per calendar day (checked on app open, gated via AsyncStorage), sweep any tasks left
  // marked complete from a previous day so they don't pile up indefinitely.
  // Gated so a task checked off today stays visible (with strikethrough)
  // for the rest of today — it's only swept the next time the app opens.
  useEffect(() => {
    if (!userId) return;
    shouldRunDailyCleanup().then(async should => {
      if (!should) return;
      await deleteCompletedTasks();
      await markDailyCleanupRun();
    });
  }, [userId, deleteCompletedTasks]);

  const categoriesWithOpen = useMemo(() => [...categories, OPEN_CATEGORY], [categories]);

  const categoryIconMap = useMemo(
    () => ({ '': OPEN_CATEGORY.icon, ...Object.fromEntries(categories.map(c => [c.id, c.icon])) }),
    [categories]
  );

  // Slim view of the 30-day task window for AddTaskModal's open-slots
  // display — covers any date the modal's own date picker can reach.
  const existingTaskSlots: DayTaskSlot[] = useMemo(
    () => catTasks.map(t => ({ id: t.id, date: t.date, scheduledTime: t.scheduledTime, durationMinutes: t.durationMins })),
    [catTasks]
  );

  // Load this user's tasks for the selected date.
  const loadTasks = useCallback(async () => {
    if (!userId) return;
    await generateTasksForDate(userId, toISODate(selectedDate));
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('date', toISODate(selectedDate))
      .order('scheduled_time', { ascending: true });
    if (error) { console.error(error); return; }
    setTasks((data ?? []).map(rowToTask));
  }, [userId, selectedDate]);

  // Loads every task for this user — used by the Categories tab so a
  // category shows all of its tasks (past, present, future, or dateless),
  // not just what falls in some window. Day view is still per-date; this is
  // the only place past-due and fully dateless tasks are ever visible.
  const loadCatTasks = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('scheduled_time', { ascending: true });
    if (error) { console.error(error); return; }
    setCatTasks((data ?? []).map(rowToTask));
  }, [userId]);

  // Active recurring series, keyed by id — drives cadence text, next occurrence
  // and time-tracking stats on the Categories tab and in Dot's tools.
  const loadRules = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from('recurring_task_rules').select('*').eq('user_id', userId).eq('is_active', true);
    if (error) { console.error(error); return; }
    setRules(Object.fromEntries((data ?? []).map(r => [r.id, r])));
  }, [userId]);

  // One refresh for everything that reads tasks, so Day and Categories can't
  // drift apart after an add/edit/date change.
  const refreshAll = useCallback(async () => {
    await Promise.all([loadTasks(), loadCatTasks(), loadRules()]);
  }, [loadTasks, loadCatTasks, loadRules]);

  // Coming back from the background doesn't fire a navigation focus event, so
  // the lists would otherwise stay stale until the app was fully relaunched.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      refreshAll();
      getVerseOfTheDay().then(setVerse);
      loadTimer().then(setTimer);
    });
    return () => sub.remove();
  }, [refreshAll]);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
      loadTasks();
      loadCatTasks();
      loadRules();
      // Re-checked on every focus (not just app mount) so a day rollover
      // while the app stayed backgrounded, or a network blip that skipped
      // caching, both self-heal next time the screen is seen.
      getVerseOfTheDay().then(setVerse);
    }, [loadCategories, loadTasks, loadCatTasks, loadRules])
  );

  // Once per calendar day, clear the date (not the task) off anything left
  // incomplete from a previous day — the safety net for when "End My Day"
  // wasn't run to explicitly reschedule/drop unfinished items. The task
  // stays in its category as a dateless backlog item instead of quietly
  // sitting on a day view that's already passed.
  useEffect(() => {
    if (!userId) return;
    shouldRunStaleDateSweep().then(async should => {
      if (!should) return;
      const today = toISODate(new Date());
      const { error } = await supabase
        .from('tasks')
        .update({ date: null })
        .eq('user_id', userId)
        .eq('is_completed', false)
        .lt('date', today);
      if (error) { console.error(error); return; }
      await markStaleDateSweepRun();
      loadTasks();
      loadCatTasks();
    });
  }, [userId, loadTasks, loadCatTasks]);

  const setTaskCompleted = useCallback(async (id: string, completed: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isCompleted: completed } : t));
    setCatTasks(prev => prev.map(t => t.id === id ? { ...t, isCompleted: completed } : t));
    const { error } = await supabase.from('tasks').update({ is_completed: completed }).eq('id', id);
    if (error) console.error(error);
  }, []);

  const toggle = useCallback(async (id: string) => {
    const target = tasks.find(t => t.id === id) ?? catTasks.find(t => t.id === id);
    if (!target) return;
    await setTaskCompleted(id, !target.isCompleted);
  }, [tasks, catTasks, setTaskCompleted]);

  const remove = useCallback(async (id: string) => {
    if (timer?.taskId === id) updateTimer(null);
    setTasks(prev => prev.filter(t => t.id !== id));
    setCatTasks(prev => prev.filter(t => t.id !== id));
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) console.error(error);
  }, [timer, updateTimer]);

  const removeOccurrence = useCallback(async (task: Task) => {
    if (!userId || !task.recurringRuleId) return;
    if (timer?.taskId === task.id) updateTimer(null);
    setTasks(prev => prev.filter(t => t.id !== task.id));
    setCatTasks(prev => prev.filter(t => t.id !== task.id));
    await deleteRecurringOccurrence(userId, task.id, task.recurringRuleId, task.date!);
  }, [userId, timer, updateTimer]);

  const removeSeries = useCallback(async (task: Task) => {
    if (!task.recurringRuleId) return;
    const ruleId = task.recurringRuleId;
    if (timer?.ruleId === ruleId) updateTimer(null);
    setTasks(prev => prev.filter(t => t.recurringRuleId !== ruleId));
    setCatTasks(prev => prev.filter(t => t.recurringRuleId !== ruleId));
    await deleteRecurringSeries(ruleId);
    setRules(prev => { const next = { ...prev }; delete next[ruleId]; return next; });
  }, [timer, updateTimer]);

  const updateTask = useCallback(async (id: string, nt: NewTask) => {
    const scheduledTime   = nt.startTime ? to24Hour(nt.startTime) : null;
    const durationMinutes = nt.duration ? parseInt(nt.duration, 10) : null;
    const categoryId      = (!nt.categoryId || nt.categoryId === OPEN_CATEGORY_ID) ? null : nt.categoryId;
    const details         = nt.details?.trim() ? nt.details.trim() : null;

    const { data: row, error } = await supabase
      .from('tasks')
      .update({ title: nt.title, category_id: categoryId, date: nt.date || null, scheduled_time: scheduledTime, duration_minutes: durationMinutes, time_period: getTimePeriod(scheduledTime), notes: details })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !row) { console.error(error); return; }

    // Details on a recurring task also live on its series so future instances inherit them.
    if (row.recurring_rule_id) {
      const { error: ruleError } = await supabase.from('recurring_task_rules').update({ notes: details }).eq('id', row.recurring_rule_id);
      if (ruleError) console.error(ruleError);
    }

    // Single source of truth: re-read from the DB rather than patching local
    // arrays (patching missed tasks that newly entered the selected day).
    await refreshAll();
  }, [refreshAll]);

  const addTask = useCallback(async (nt: NewTask) => {
    if (!userId) return;
    const scheduledTime    = nt.startTime ? to24Hour(nt.startTime) : null;
    const durationMinutes  = nt.duration ? parseInt(nt.duration, 10) : null;
    const categoryId       = (!nt.categoryId || nt.categoryId === OPEN_CATEGORY_ID) ? null : nt.categoryId;
    const date              = nt.date || null;
    const details           = nt.details?.trim() ? nt.details.trim() : null;

    let recurringRuleId: string | null = null;
    if (nt.isRecurring) {
      const ruleType = nt.ruleType ?? 'daily';
      const { data: rule, error: ruleError } = await supabase
        .from('recurring_task_rules')
        .insert({
          user_id:          userId,
          title:            nt.title,
          category_id:      categoryId,
          rule_type:        ruleType,
          days_of_week:     ruleType === 'weekly' ? (nt.daysOfWeek ?? null) : null,
          scheduled_time:   scheduledTime,
          duration_minutes: durationMinutes,
          time_period:      getTimePeriod(scheduledTime),
          // Only sent when set, so creating recurring tasks keeps working even
          // before the details migration (rules.notes) has been applied.
          ...(details ? { notes: details } : {}),
        })
        .select('id')
        .single();
      if (ruleError) { console.error(ruleError); return; }
      recurringRuleId = rule.id;
    }

    const { error } = await supabase
      .from('tasks')
      .insert({
        user_id:           userId,
        title:             nt.title,
        category_id:       categoryId,
        recurring_rule_id: recurringRuleId,
        date,
        scheduled_time:    scheduledTime,
        duration_minutes:  durationMinutes,
        time_period:       getTimePeriod(scheduledTime),
        notes:             details,
      });
    if (error) { console.error(error); return; }

    await refreshAll();
  }, [userId, refreshAll]);

  const addTasks = useCallback(async (suggested: SuggestedTask[]) => {
    if (!userId) return;
    const today = toISODate(new Date());
    for (const s of suggested) {
      const matchedCat = categories.find(c => c.name.toLowerCase() === s.categoryName?.toLowerCase());
      const scheduledTime = s.scheduledTime ? `${s.scheduledTime}:00` : null;
      const date = s.date ?? today;
      const { error } = await supabase
        .from('tasks')
        .insert({
          user_id:           userId,
          title:             s.title,
          category_id:       matchedCat?.id ?? null,
          date,
          scheduled_time:    scheduledTime,
          duration_minutes:  s.durationMinutes ?? null,
          time_period:       getTimePeriod(scheduledTime),
        });
      if (error) console.error(error);
    }
    await refreshAll();
  }, [userId, categories, refreshAll]);

  // ── Task details modal + timer ──────────────────────────────────────────────
  const findTask = useCallback((id: string | null): Task | null =>
    id ? (tasks.find(t => t.id === id) ?? catTasks.find(t => t.id === id) ?? null) : null, [tasks, catTasks]);
  const detailTask = findTask(detailTaskId);

  const startTimerFor = useCallback((task: Task) => {
    const begin = () => updateTimer(newTimer({ id: task.id, title: task.title, ruleId: task.recurringRuleId }));
    if (timer && timer.taskId !== task.id) {
      Alert.alert('Replace running timer?', `This will discard the timer on "${timer.title}".`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: begin },
      ]);
    } else {
      begin();
    }
  }, [timer, updateTimer]);

  // Same completion path as the checkbox; recurring series also get the
  // elapsed time logged (one-offs are completed but nothing is logged).
  const completeFromTimer = useCallback(async () => {
    if (!timer) return;
    const task = findTask(timer.taskId);
    const seconds = Math.round(elapsedMs(timer) / 1000);
    await setTaskCompleted(timer.taskId, true);
    const ruleId = task?.recurringRuleId ?? timer.ruleId;
    if (ruleId) {
      const { error } = await supabase.rpc('log_recurring_run', { p_rule_id: ruleId, p_seconds: seconds });
      if (error) { console.error(error); Alert.alert('Completed, but time not logged', error.message); }
      loadRules();
    }
    updateTimer(null);
    setDetailTaskId(null);
  }, [timer, findTask, setTaskCompleted, loadRules, updateTimer]);

  const openTimerPicker = useCallback(async () => {
    if (timer) { setDetailTaskId(timer.taskId); return; }
    if (!userId) return;
    const week = weekDatesSunday(new Date());
    // Recurring instances are generated lazily per day; make sure the whole week exists first.
    for (const iso of week) await generateTasksForDate(userId, iso);
    const { data, error } = await supabase
      .from('tasks').select('*').eq('user_id', userId)
      .gte('date', week[0]).lte('date', week[6]).eq('is_completed', false)
      .order('date', { ascending: true }).order('scheduled_time', { ascending: true });
    if (error) { console.error(error); return; }
    setPickerTasks((data ?? []).map(rowToTask));
    setShowTimerPicker(true);
  }, [timer, userId]);

  const pickerOptions: TimerPickOption[] = useMemo(() => pickerTasks.map(t => ({
    id: t.id, label: t.title,
    dayLabel: t.date === toISODate(new Date()) ? 'Today' : new Date(`${t.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
  })), [pickerTasks]);

  const startFromPicker = useCallback(async (pick: { taskId: string } | { newTaskTitle: string }) => {
    if (!userId) return;
    if ('taskId' in pick) {
      const t = pickerTasks.find(x => x.id === pick.taskId);
      if (t) updateTimer(newTimer({ id: t.id, title: t.title, ruleId: t.recurringRuleId }));
    } else {
      const today = toISODate(new Date());
      const { data: row, error } = await supabase.from('tasks')
        .insert({ user_id: userId, title: pick.newTaskTitle, category_id: null, date: today, time_period: 'unscheduled' })
        .select('*').single();
      if (error || !row) { console.error(error); return; }
      updateTimer(newTimer({ id: row.id, title: row.title, ruleId: null }));
      await refreshAll();
    }
    setShowTimerPicker(false);
  }, [userId, pickerTasks, updateTimer, refreshAll]);

  const byPeriod = (p: TimePeriod) => tasks.filter(t => t.timePeriod === p && !t.isTTFO);
  const ttfo        = tasks.filter(t => t.isTTFO);
  const freeBlocks  = useMemo(() => showFree ? computeFreeBlocks(tasks) : undefined, [showFree, tasks]);
  const allComplete = tasks.length > 0 && tasks.filter(t => !t.isTTFO).every(t => t.isCompleted);

  return (
    <SafeAreaView style={s.root}>
      {/* ── Fixed header ── */}
      <DotHeader
        mood="happy"
        onAdd={() => setShowAddTask(true)}
        onOpenChat={() => router.push('/dot-chat')}
        onLongPressDot={() => router.push('/settings')}
        activeView={activeView}
        onToggleParty={() => setActiveView(v => v === 'party' ? 'home' : 'party')}
        onToggleBattle={() => setActiveView(v => v === 'battle' ? 'home' : 'battle')}
        timerActive={!!timer}
        timerRunning={isRunning(timer)}
        onPressTimer={openTimerPicker}
      />
      <View style={s.divider} />
      <VerseCard verse={verse} />

      {/* ── Content ── */}
      {activeView === 'party' ? (
        <PartyView userId={userId} />
      ) : activeView === 'battle' ? (
        <BattleView />
      ) : tab === 'DAY' && (
        <ScrollView style={s.tabContent} showsVerticalScrollIndicator={false}>
          <View style={s.todoWrap}><Text style={s.todoText}>TO-DO</Text></View>
          <TabBar active={tab} onChange={t => { setTab(t); setShowCal(false); }} />
          <DateNavRow
            date={selectedDate}
            calOpen={showCal}
            onToggleCal={() => setShowCal(c => !c)}
            onPrev={() => { const d = new Date(selectedDate); d.setDate(d.getDate()-1); setSelectedDate(d); }}
            onNext={() => { const d = new Date(selectedDate); d.setDate(d.getDate()+1); setSelectedDate(d); }}
          />

          {/* Inline calendar */}
          {showCal && (
            <InlineCalendar
              selectedDate={selectedDate}
              onSelectDate={d => { setSelectedDate(d); }}
            />
          )}

          {/* FREE TIME toggle */}
          <TouchableOpacity style={s.freeToggleRow} onPress={toggleFree} activeOpacity={0.7}>
            <Text style={s.freeToggleTxt}>FREE TIME</Text>
            <View style={[s.freeToggleBox, showFree && s.freeToggleBoxOn]}>
              {showFree && <Text style={[s.checkmark, { fontSize: 7, marginTop: 0 }]}>✓</Text>}
            </View>
          </TouchableOpacity>

          <PeriodGroup period="morning"     tasks={byPeriod('morning')}     categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} onOpen={t => setDetailTaskId(t.id)} freeBlocks={freeBlocks} />
          <PeriodGroup period="afternoon"   tasks={byPeriod('afternoon')}   categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} onOpen={t => setDetailTaskId(t.id)} freeBlocks={freeBlocks} />
          <PeriodGroup period="evening"     tasks={byPeriod('evening')}     categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} onOpen={t => setDetailTaskId(t.id)} freeBlocks={freeBlocks} />
          <PeriodGroup period="unscheduled" tasks={byPeriod('unscheduled')} categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} onOpen={t => setDetailTaskId(t.id)} />

          {allComplete && <RelaxRow />}

          <TTFOSection tasks={ttfo} categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} onOpen={t => setDetailTaskId(t.id)} />
          <Footer
            tasks={tasks}
            onEndDay={() => router.push({ pathname: '/dot-chat', params: { mode: 'evening' } })}
          />
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
      {activeView === 'home' && tab === 'CATS' && (
        <CatsView
          tab={tab}
          onTabChange={t => { setTab(t); setShowCal(false); }}
          categories={categoriesWithOpen}
          tasks={catTasks}
          onToggleTask={toggle}
          onLongPressTask={setActionTask}
          onAddTask={(categoryId, title) => addTask({ title, categoryId, date: '', startTime: '', duration: '', isRecurring: false })}
          onAddCategory={addCategory}
          onEditCategory={updateCategory}
          onDeleteCategory={removeCategory}
          onDeleteCompleted={deleteCompletedTasks}
          rules={rules}
          onOpenTask={t => setDetailTaskId(t.id)}
        />
      )}

      {/* ── Modals ── */}
      <AddTaskModal
        visible={showAddTask}
        onClose={() => { setShowAddTask(false); setEditingTask(null); }}
        onAdd={addTask}
        onSave={(id, nt) => updateTask(id, nt)}
        onAddMany={addTasks}
        categories={categoriesWithOpen}
        initialDate={toISODate(selectedDate)}
        existingTasks={existingTaskSlots}
        editingTask={editingTask ? {
          id: editingTask.id,
          title: editingTask.title,
          categoryId: editingTask.categoryId,
          date: editingTask.date,
          scheduledTime: editingTask.scheduledTime,
          durationMinutes: editingTask.durationMins,
          details: editingTask.details ?? null,
        } as EditableTask : null}
      />
      <TaskDetailModal
        visible={!!detailTaskId}
        title={detailTask?.title ?? timer?.title ?? ''}
        details={detailTask?.details}
        isRecurring={!!(detailTask?.isRecurring ?? timer?.ruleId)}
        timer={timer && timer.taskId === detailTaskId ? timer : null}
        onClose={() => setDetailTaskId(null)}
        onEdit={() => {
          if (detailTask) { setEditingTask(detailTask); setDetailTaskId(null); setShowAddTask(true); }
        }}
        onStart={() => { if (detailTask) startTimerFor(detailTask); }}
        onStop={() => { if (timer) updateTimer(stopTimer(timer)); }}
        onResume={() => { if (timer) updateTimer(resumeTimer(timer)); }}
        onComplete={completeFromTimer}
      />
      <TimerPickerModal
        visible={showTimerPicker}
        options={pickerOptions}
        onClose={() => setShowTimerPicker(false)}
        onStart={startFromPicker}
      />
      <TaskActionSheet
        visible={!!actionTask}
        taskTitle={actionTask?.title ?? ''}
        isRecurring={!!actionTask?.isRecurring}
        onClose={() => setActionTask(null)}
        onEdit={() => {
          setEditingTask(actionTask);
          setActionTask(null);
          setShowAddTask(true);
        }}
        onDeleteOccurrence={() => {
          if (actionTask) {
            actionTask.isRecurring ? removeOccurrence(actionTask) : remove(actionTask.id);
          }
          setActionTask(null);
        }}
        onDeleteSeries={() => {
          if (actionTask) removeSeries(actionTask);
          setActionTask(null);
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG },
  tabContent: { flex: 1 },

  statusRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: MARGIN, paddingVertical: 9, borderBottomWidth: DASH, borderBottomColor: INK },
  statusTime: { fontFamily: 'PressStart2P', fontSize: 7, color: INK,  lineHeight: 11 },
  statusDot:  { fontFamily: 'PressStart2P', fontSize: 7, color: INK,  lineHeight: 11 },

  dotHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: MARGIN, paddingTop: 6, paddingBottom: 6 },
  dotBtns:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dotBtn:    { width: 36, height: 36, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  bannerIcon: { width: 30, height: 30 },
  bannerBtn:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  divider:     { height: DASH, backgroundColor: INK },
  tabUnderline:{ height: DASH, backgroundColor: INK, marginTop: 10 },

  tabWrap: { paddingHorizontal: MARGIN, paddingTop: 10, paddingBottom: 18 },
  tabBar:  { flexDirection: 'row', borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, overflow: 'hidden' },
  tab:     { flex: 1, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  tabDiv:  { borderLeftWidth: BORDER, borderLeftColor: INK },
  tabOn:   { backgroundColor: INK },
  tabTxt:  { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 10 },
  tabTxtOn:{ color: BG },

  verse:      { marginHorizontal: MARGIN, marginTop: 14, marginBottom: 6, borderWidth: DASH, borderStyle: 'dashed', borderColor: INK, borderRadius: RADIUS, paddingHorizontal: MARGIN, paddingVertical: 16 },
  corner:     { position: 'absolute', fontFamily: 'PressStart2P', fontSize: 8, color: OLIVE, lineHeight: 10 },
  cTL:{ top:6, left:8 }, cTR:{ top:6, right:8 }, cBL:{ bottom:6, left:8 }, cBR:{ bottom:6, right:8 },
  verseBody:  { paddingHorizontal: 6, paddingVertical: 4 },
  verseLabel: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 10, letterSpacing: 0.5, marginBottom: 8 },
  verseText:  { fontFamily: 'VT323', fontSize: 17, color: INK, lineHeight: 22, marginBottom: 6 },
  verseRef:   { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 10 },

  todoWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 12 },
  todoText: { fontFamily: 'PressStart2P', fontSize: 14, color: INK, lineHeight: 21 },

  // Date nav — segmented bar (mirrors tab bar pattern)
  dateBar:       {
    flexDirection: 'row', alignItems: 'stretch',
    marginHorizontal: MARGIN, marginBottom: 10,
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, overflow: 'hidden',
  },
  dateSeg:       { paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  dateSegFlex:   { flex: 1 },
  dateSegDivL:   { borderLeftWidth: BORDER, borderLeftColor: INK },
  dateSegActive: { backgroundColor: INK },
  dateLabel:     { fontFamily: 'PressStart2P', fontSize: 9, color: INK, lineHeight: 13 },

  periodGroup: { marginBottom: 4 },
  sectionRow:  { paddingHorizontal: MARGIN, paddingTop: 14, paddingBottom: 6 },
  sectionTxt:  { fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, lineHeight: 11, letterSpacing: 2 },

  card:         { flexDirection: 'row', alignItems: 'center', marginHorizontal: MARGIN, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 10, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, backgroundColor: BG, gap: 10 },
  cardFaded:    { opacity: 0.5 },
  cardIconWrap: { width: 14, alignItems: 'center', justifyContent: 'center' },
  checkHit:     { padding: 1 },
  checkbox:     { width: 18, height: 18, borderWidth: BORDER, borderColor: INK, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:   { backgroundColor: INK },
  checkmark:    { fontFamily: 'PressStart2P', fontSize: 8, color: BG, lineHeight: 10, marginTop: 1 },
  cardContent:  { flex: 1 },
  cardTitle:    { fontFamily: 'VT323', fontSize: 18, color: INK, lineHeight: 20 },
  cardTitleDone:{ textDecorationLine: 'line-through' },
  titleRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleFlex:    { flexShrink: 1 },

  timerBtn:     { width: 36, height: 36, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  timerBtnOn:   { backgroundColor: INK },
  timerDot:     { position: 'absolute', top: 1, right: 3, fontFamily: 'PressStart2P', fontSize: 6, color: GREEN, lineHeight: 8 },

  freeToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingHorizontal: MARGIN, paddingBottom: 4 },
  freeToggleBox: { width: 12, height: 12, borderWidth: BORDER, borderColor: INK, alignItems: 'center', justifyContent: 'center' },
  freeToggleBoxOn: { backgroundColor: INK },
  freeToggleTxt: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9 },

  freeCard:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: MARGIN, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: BORDER, borderStyle: 'dotted', borderColor: MUTED, borderRadius: RADIUS, gap: 12 },
  freeIcon:  { width: 52, height: 48, alignItems: 'center', justifyContent: 'center' },
  freeTitle: { fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, lineHeight: 11, letterSpacing: 1 },
  cardSub:      { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9, marginTop: 2 },

  ttfoWrap:  { marginTop: 4 },
  ttfoLine:  { height: DASH, backgroundColor: MUTED, marginHorizontal: MARGIN },
  ttfoRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: MARGIN, paddingVertical: 12, gap: 8 },
  ttfoTitle: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9, letterSpacing: 1 },
  ttfoCount: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9 },

  // All-complete
  relaxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 8 },
  relaxTxt: { fontFamily: 'PressStart2P', fontSize: 8, color: INK, lineHeight: 14 },

  footer:     { paddingHorizontal: MARGIN, paddingTop: 24, paddingBottom: 8 },
  footerCount:{ fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11, textAlign: 'center', marginBottom: 10 },
  footerRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  endBtn:     { flex: 1, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 11, alignItems: 'center' },
  endBtnTxt:  { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  refreshBtn: { width: 40, height: 40, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },

  // ── CATS view ──
  catsHead:     { paddingHorizontal: MARGIN, paddingTop: 16, paddingBottom: 12 },
  catsHeadLabel:{ fontFamily: 'PressStart2P', fontSize: 9, color: INK, letterSpacing: 2 },

  accordion:     { marginHorizontal: MARGIN, marginBottom: 6 },
  accHeader:     { flexDirection: 'row', alignItems: 'center', borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: BG, gap: 10 },
  accHeaderExp:  { backgroundColor: INK, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  accName:       { fontFamily: 'PressStart2P', fontSize: 6, color: INK, lineHeight: 10 },
  accNameExp:    { color: BG },
  accCount:      { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9, marginRight: 4 },
  accCountExp:   { color: BG },
  accBody: {
    borderWidth: BORDER, borderTopWidth: 0, borderColor: INK,
    borderBottomLeftRadius: RADIUS, borderBottomRightRadius: RADIUS,
    overflow: 'hidden',
  },
  accTask:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: DASH, borderBottomColor: INK, gap: 8 },
  accCheckbox: { width: 15, height: 15, borderWidth: BORDER, borderColor: INK },
  accTaskContent: { flex: 1 },
  accTaskName: { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 18 },
  accTaskSub:  { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9, marginTop: 2 },
  accAddRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  accAddPlaceholder: { flex: 1, fontFamily: 'VT323', fontSize: 15, color: MUTED, lineHeight: 18 },
  accAddInput: { flex: 1, fontFamily: 'VT323', fontSize: 15, color: INK, lineHeight: 18, padding: 0 },
  accAddBtn: { width: 26, height: 26, backgroundColor: INK, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },

  newCatTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: MARGIN, marginTop: 8, paddingVertical: 13,
    borderWidth: DASH, borderStyle: 'dashed', borderColor: INK, borderRadius: RADIUS, gap: 8,
  },
  newCatTriggerTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },

  deleteCompletedTrigger: {
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: MARGIN, marginTop: 8, paddingVertical: 13,
    borderWidth: DASH, borderStyle: 'dashed', borderColor: RED, borderRadius: RADIUS,
  },
  deleteCompletedTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: RED, lineHeight: 11 },

  newCatCard:      { marginHorizontal: MARGIN, marginTop: 10, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, padding: 14, gap: 12 },
  newCatLabel:     { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9 },
  newCatInput:     { height: 38, borderWidth: BORDER, borderColor: INK, borderRadius: 2, paddingHorizontal: 10, fontFamily: 'VT323', fontSize: 16, color: INK },
  newCatIconLabel: { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },
  iconGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconGridBtn:     { width: 52, height: 52, borderWidth: BORDER, borderColor: INK, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  iconGridBtnOn:   { backgroundColor: INK },
  newCatActions:   { flexDirection: 'row', gap: 10 },
  newCatAdd:       { flex: 1, backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 11, alignItems: 'center' },
  newCatAddTxt:    { fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },
  newCatClose:     { width: 42, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center' },
});
