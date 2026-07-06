import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Image, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import DotCharacter, { DotMood } from '../components/DotCharacter';
import PartyView from '../components/PartyView';
import AddTaskModal, { NewTask, EditableTask, DayTaskSlot } from '../components/AddTaskModal';
import type { SuggestedTask } from '../lib/ai';
import TaskActionSheet from '../components/TaskActionSheet';
import CategoryActionSheet from '../components/CategoryActionSheet';
import InlineCalendar from '../components/InlineCalendar';
import { DEFAULT_CATEGORIES, OPEN_CATEGORY, OPEN_CATEGORY_ID } from '../constants/categories';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthProvider';
import type { Database } from '../lib/database.types';
import { getTimePeriod } from '../lib/database.types';
import { generateTasksForDate, deleteRecurringOccurrence, deleteRecurringSeries } from '../lib/recurring';
import { shouldShowMorningFlow } from '../lib/morningGate';
import { getVerseOfTheDay, Verse } from '../lib/verseOfTheDay';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
import {
  BookOpen, Briefcase, Calendar, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Circle, ClipboardList, Dumbbell,
  Heart, Home as HomeIcon, Layers, Pencil, Plus,
  RefreshCw, Repeat, Sparkles, Star, Sun, X, Zap,
} from 'lucide-react-native';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const OLIVE  = '#7A8B5A';
const GREEN  = '#4DB860';
const BORDER = 1.354;
const DASH   = 0.677;
const RADIUS = 4;
const MARGIN = 18;

// ─── Types ─────────────────────────────────────────────────────────────────────
type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'unscheduled';
type ActiveTab  = 'DAY' | 'CATS';

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
  };
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A dateless task always belongs in the Categories tab's 30-day window (it
// has no date to fall outside of); a dated task only belongs if it falls
// within the window.
function inCatWindow(date: string | null, todayISO: string, catEndISO: string): boolean {
  return date === null || (date >= todayISO && date <= catEndISO);
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

// ─── Dot + action buttons ──────────────────────────────────────────────────────
function DotHeader({ mood, onAdd, onOpenChat, onLongPressDot, showParty, onToggleParty }: {
  mood: DotMood; onAdd: () => void; onOpenChat: () => void; onLongPressDot: () => void;
  showParty: boolean; onToggleParty: () => void;
}) {
  return (
    <View style={s.dotHeader}>
      <TouchableOpacity onPress={onOpenChat} onLongPress={onLongPressDot} delayLongPress={600} activeOpacity={0.8}>
        <DotCharacter mood={mood} />
      </TouchableOpacity>
      <View style={s.dotBtns}>
        <TouchableOpacity style={s.bannerBtn} onPress={onToggleParty} activeOpacity={0.7}>
          <Image source={showParty ? BANNER_ACTIVE : BANNER_INACTIVE} style={s.bannerIcon} resizeMode="contain" />
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
function TaskCard({ task, icon, onToggle, onLongPress }: { task: Task; icon: string; onToggle: (id: string) => void; onLongPress: (task: Task) => void }) {
  const sub = timeLabel(task.scheduledTime, task.durationMins);
  return (
    <TouchableOpacity
      style={[s.card, task.isCompleted && s.cardFaded]}
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
        <Text style={[s.cardTitle, task.isCompleted && s.cardTitleDone]} numberOfLines={1}>{task.title}</Text>
        {sub ? <Text style={s.cardSub}>{sub}</Text> : null}
      </View>
      {task.isRecurring && <Repeat size={12} color={MUTED} strokeWidth={1.5} />}
    </TouchableOpacity>
  );
}

// ─── Period group ──────────────────────────────────────────────────────────────
function PeriodGroup({ period, tasks, categoryIconMap, onToggle, onLongPress }: { period: TimePeriod; tasks: Task[]; categoryIconMap: Record<string, string>; onToggle: (id:string)=>void; onLongPress: (task: Task)=>void }) {
  if (!tasks.length) return null;
  return (
    <View style={s.periodGroup}>
      <SectionHeader title={period.toUpperCase()} />
      {tasks.map(t => <TaskCard key={t.id} task={t} icon={categoryIconMap[t.categoryId ?? ''] ?? 'ClipboardList'} onToggle={onToggle} onLongPress={onLongPress} />)}
    </View>
  );
}

// ─── TTFO ─────────────────────────────────────────────────────────────────────
function TTFOSection({ tasks, categoryIconMap, onToggle, onLongPress }: { tasks: Task[]; categoryIconMap: Record<string, string>; onToggle: (id:string)=>void; onLongPress: (task: Task)=>void }) {
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
      {open && tasks.map(t => <TaskCard key={t.id} task={t} icon={categoryIconMap[t.categoryId ?? ''] ?? 'ClipboardList'} onToggle={onToggle} onLongPress={onLongPress} />)}
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
  onAddCategory: (name: string, icon: string) => void;
  onEditCategory: (id: string, name: string, icon: string) => void;
  onDeleteCategory: (id: string) => void;
}

function CatsView({
  tab, onTabChange, categories, tasks,
  onToggleTask, onLongPressTask, onAddTask, onAddCategory, onEditCategory, onDeleteCategory,
}: CatsViewProps) {
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [showNew,     setShowNew]     = useState(false);
  const [newName,     setNewName]     = useState('');
  const [selIcon,     setSelIcon]     = useState(0);
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

  return (
    <ScrollView ref={scrollRef} style={s.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.todoWrap}><Text style={s.todoText}>TO-DO</Text></View>
      <TabBar active={tab} onChange={onTabChange} />
      <View style={s.catsHead}><Text style={s.catsHeadLabel}>CATEGORIES</Text></View>

      {categories.map(cat => {
        const isExp    = expanded.has(cat.id);
        const catTasks = tasks.filter(t => cat.id === OPEN_CATEGORY_ID ? t.categoryId === null : t.categoryId === cat.id);
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
                {catTasks.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={s.accTask}
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
                      <Text style={[s.accTaskName, t.isCompleted && s.cardTitleDone]}>{t.title}</Text>
                      {(() => {
                        let dateLabel: string | null = null;
                        if (t.date) {
                          const today = new Date(); today.setHours(0,0,0,0);
                          const taskDate = new Date(t.date + 'T00:00:00');
                          dateLabel = taskDate.getTime() === today.getTime()
                            ? 'Today'
                            : taskDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }
                        const parts = [
                          dateLabel ?? 'No date',
                          timeLabel(t.scheduledTime, t.durationMins),
                        ].filter(Boolean);
                        return parts.length ? <Text style={s.accTaskSub}>{parts.join(' · ')}</Text> : null;
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
          <Text style={s.newCatTriggerTxt}>+ NEW CATEGORY</Text>
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
              style={s.newCatAdd}
              onPress={() => {
                if (!newName.trim()) return;
                onAddCategory(newName.trim(), CAT_ICON_GRID[selIcon]);
                setShowNew(false); setNewName(''); setSelIcon(0);
              }}
              activeOpacity={0.8}
            >
              <Text style={s.newCatAddTxt}>ADD</Text>
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
  const [showParty,    setShowParty]   = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTime(nowStr()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getVerseOfTheDay().then(setVerse);
  }, []);

  // First thing each morning (after 5am), jump straight into Dot's morning
  // greeting/verse/summary flow instead of waiting for a tap.
  useEffect(() => {
    if (!userId) return;
    shouldShowMorningFlow().then(should => {
      if (should) router.push('/dot-chat');
    });
  }, [userId]);

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


  const addCategory = useCallback(async (name: string, icon: string) => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: userId, name, icon })
      .select('*')
      .single();
    if (error || !data) { console.error(error); return; }
    setCategories(prev => [...prev, data]);
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

  // Load tasks for the next 30 days — used by the Categories tab so it shows
  // upcoming tasks across all dates, not just the selected day. Also pulls in
  // fully dateless tasks (cleared via edit) so they don't disappear from the
  // app entirely — Categories is their only home since Day view is per-date.
  const loadCatTasks = useCallback(async () => {
    if (!userId) return;
    const today = toISODate(new Date());
    const end = new Date(); end.setDate(end.getDate() + 30);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .or(`date.is.null,and(date.gte.${today},date.lte.${toISODate(end)})`)
      .order('date', { ascending: true })
      .order('scheduled_time', { ascending: true });
    if (error) { console.error(error); return; }
    setCatTasks((data ?? []).map(rowToTask));
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
      loadTasks();
      loadCatTasks();
    }, [loadCategories, loadTasks, loadCatTasks])
  );

  const toggle = useCallback(async (id: string) => {
    const target = tasks.find(t => t.id === id) ?? catTasks.find(t => t.id === id);
    if (!target) return;
    const nextCompleted = !target.isCompleted;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isCompleted: nextCompleted } : t));
    setCatTasks(prev => prev.map(t => t.id === id ? { ...t, isCompleted: nextCompleted } : t));
    const { error } = await supabase.from('tasks').update({ is_completed: nextCompleted }).eq('id', id);
    if (error) console.error(error);
  }, [tasks, catTasks]);

  const remove = useCallback(async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    setCatTasks(prev => prev.filter(t => t.id !== id));
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) console.error(error);
  }, []);

  const removeOccurrence = useCallback(async (task: Task) => {
    if (!userId || !task.recurringRuleId) return;
    setTasks(prev => prev.filter(t => t.id !== task.id));
    setCatTasks(prev => prev.filter(t => t.id !== task.id));
    await deleteRecurringOccurrence(userId, task.id, task.recurringRuleId, task.date!);
  }, [userId]);

  const removeSeries = useCallback(async (task: Task) => {
    if (!task.recurringRuleId) return;
    const ruleId = task.recurringRuleId;
    setTasks(prev => prev.filter(t => t.recurringRuleId !== ruleId));
    setCatTasks(prev => prev.filter(t => t.recurringRuleId !== ruleId));
    await deleteRecurringSeries(ruleId);
  }, []);

  const updateTask = useCallback(async (id: string, nt: NewTask) => {
    const scheduledTime   = nt.startTime ? to24Hour(nt.startTime) : null;
    const durationMinutes = nt.duration ? parseInt(nt.duration, 10) : null;
    const categoryId      = (!nt.categoryId || nt.categoryId === OPEN_CATEGORY_ID) ? null : nt.categoryId;

    const { data: row, error } = await supabase
      .from('tasks')
      .update({ title: nt.title, category_id: categoryId, date: nt.date || null, scheduled_time: scheduledTime, duration_minutes: durationMinutes, time_period: getTimePeriod(scheduledTime) })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !row) { console.error(error); return; }

    if (row.date === toISODate(selectedDate)) {
      setTasks(prev => prev.map(t => t.id === id ? rowToTask(row) : t));
    } else {
      setTasks(prev => prev.filter(t => t.id !== id));
    }
    const today = toISODate(new Date());
    const catEnd = new Date(); catEnd.setDate(catEnd.getDate() + 30);
    if (inCatWindow(row.date, today, toISODate(catEnd))) {
      setCatTasks(prev =>
        prev.some(t => t.id === id)
          ? prev.map(t => t.id === id ? rowToTask(row) : t)
          : [...prev, rowToTask(row)]
      );
    } else {
      setCatTasks(prev => prev.filter(t => t.id !== id));
    }
  }, [selectedDate]);

  const addTask = useCallback(async (nt: NewTask) => {
    if (!userId) return;
    const scheduledTime    = nt.startTime ? to24Hour(nt.startTime) : null;
    const durationMinutes  = nt.duration ? parseInt(nt.duration, 10) : null;
    const categoryId       = (!nt.categoryId || nt.categoryId === OPEN_CATEGORY_ID) ? null : nt.categoryId;
    const date              = nt.date || null;

    let recurringRuleId: string | null = null;
    if (nt.isRecurring) {
      const { data: rule, error: ruleError } = await supabase
        .from('recurring_task_rules')
        .insert({
          user_id:          userId,
          title:            nt.title,
          category_id:      categoryId,
          rule_type:        'daily',
          scheduled_time:   scheduledTime,
          duration_minutes: durationMinutes,
          time_period:      getTimePeriod(scheduledTime),
        })
        .select('id')
        .single();
      if (ruleError) { console.error(ruleError); return; }
      recurringRuleId = rule.id;
    }

    const { data: row, error } = await supabase
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
      })
      .select('*')
      .single();
    if (error || !row) { console.error(error); return; }

    if (row.date === toISODate(selectedDate)) {
      setTasks(prev => [...prev, rowToTask(row)]);
    }
    const today = toISODate(new Date());
    const catEnd = new Date(); catEnd.setDate(catEnd.getDate() + 30);
    if (inCatWindow(row.date, today, toISODate(catEnd))) {
      setCatTasks(prev => [...prev, rowToTask(row)]);
    }
  }, [userId, selectedDate]);

  const addTasks = useCallback(async (suggested: SuggestedTask[]) => {
    if (!userId) return;
    const today = toISODate(new Date());
    const catEnd = new Date(); catEnd.setDate(catEnd.getDate() + 30);
    for (const s of suggested) {
      const matchedCat = categories.find(c => c.name.toLowerCase() === s.categoryName?.toLowerCase());
      const scheduledTime = s.scheduledTime ? `${s.scheduledTime}:00` : null;
      const date = s.date ?? today;
      const { data: row, error } = await supabase
        .from('tasks')
        .insert({
          user_id:           userId,
          title:             s.title,
          category_id:       matchedCat?.id ?? null,
          date,
          scheduled_time:    scheduledTime,
          duration_minutes:  s.durationMinutes ?? null,
          time_period:       getTimePeriod(scheduledTime),
        })
        .select('*')
        .single();
      if (error || !row) { console.error(error); continue; }
      if (row.date === toISODate(selectedDate)) {
        setTasks(prev => [...prev, rowToTask(row)]);
      }
      if (inCatWindow(row.date, today, toISODate(catEnd))) {
        setCatTasks(prev => [...prev, rowToTask(row)]);
      }
    }
  }, [userId, categories, selectedDate]);

  const byPeriod = (p: TimePeriod) => tasks.filter(t => t.timePeriod === p && !t.isTTFO);
  const ttfo        = tasks.filter(t => t.isTTFO);
  const allComplete = tasks.length > 0 && tasks.filter(t => !t.isTTFO).every(t => t.isCompleted);

  return (
    <SafeAreaView style={s.root}>
      {/* ── Fixed header ── */}
      <DotHeader
        mood="happy"
        onAdd={() => setShowAddTask(true)}
        onOpenChat={() => router.push('/dot-chat')}
        onLongPressDot={() => router.push('/settings')}
        showParty={showParty}
        onToggleParty={() => setShowParty(v => !v)}
      />
      <View style={s.divider} />
      <VerseCard verse={verse} />

      {/* ── Content ── */}
      {showParty ? (
        <PartyView userId={userId} />
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

          <PeriodGroup period="morning"     tasks={byPeriod('morning')}     categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} />
          <PeriodGroup period="afternoon"   tasks={byPeriod('afternoon')}   categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} />
          <PeriodGroup period="evening"     tasks={byPeriod('evening')}     categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} />
          <PeriodGroup period="unscheduled" tasks={byPeriod('unscheduled')} categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} />

          {allComplete && <RelaxRow />}

          <TTFOSection tasks={ttfo} categoryIconMap={categoryIconMap} onToggle={toggle} onLongPress={setActionTask} />
          <Footer
            tasks={tasks}
            onEndDay={() => router.push({ pathname: '/dot-chat', params: { mode: 'evening' } })}
          />
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
      {!showParty && tab === 'CATS' && (
        <CatsView
          tab={tab}
          onTabChange={t => { setTab(t); setShowCal(false); }}
          categories={categoriesWithOpen}
          tasks={catTasks}
          onToggleTask={toggle}
          onLongPressTask={setActionTask}
          onAddTask={(categoryId, title) => addTask({ title, categoryId, date: toISODate(selectedDate), startTime: '', duration: '', isRecurring: false })}
          onAddCategory={addCategory}
          onEditCategory={updateCategory}
          onDeleteCategory={removeCategory}
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
        } as EditableTask : null}
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
  dotBtns:   { flexDirection: 'row', gap: 6 },
  dotBtn:    { width: 36, height: 36, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  bannerIcon: { width: 30, height: 30 },
  bannerBtn:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 },

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
