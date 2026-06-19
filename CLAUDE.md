# Dot — AI-Powered Personal Life OS
## Context for Claude Code

---

## What Is Dot?

Dot is a personal productivity and life-management mobile app built exclusively for one user: David. It is **not** a commercial product. It is a deeply personalized daily OS that combines a pixel-art Tamagotchi-style AI companion character with a powerful backend that tracks every dimension of David's life — work, fitness, family, side projects, home maintenance, and faith.

The core interaction model: **Dot feels like a trusted friend who already knows you.** She is not a form to fill out. She doesn't ask for input David has already given. She surfaces what matters, flags conflicts, and adapts the day in real time through conversation.

---

## The Character: Dot

Dot is a pixel-art mushroom-cap girl (Toadette-inspired). She lives in the top-left corner of the screen — about 60×60px — and is the only non-monochrome element in the entire UI.

**Dot's mood states (affect animations + context):**
- `happy` — default, bobbing/waving
- `thinking` — gentle idle, used when processing
- `excited` — used when a plan is locked in or something great happens
- `sleeping` — end-of-day view
- `greeting` — morning planning entry

Dot speaks in first person, warmly and directly. She is proactive, not reactive. She speaks in short sentences. She remembers context. She doesn't over-explain.

**Dot's voice in UI copy (examples):**
- "Good morning! Here's what today looks like."
- "You've got a conflict at 2pm — want me to move the run?"
- "Marathon run is unscheduled today. Want to block time for it?"
- "All done. Nice work today."

---

## David's Life Context (Always-On Backend Knowledge)

This is the context Dot silently carries. She never asks David to re-explain these.

### Personal
- Lives in New York City with spouse and young child
- Manhattan commute daily (factor into morning/evening scheduling)
- Thursday evenings = date night with spouse (recurring, protected, never schedule over it)
- Faith-driven: daily Bible verse displayed prominently every morning

### Work
- Full-time job with Manhattan commute
- Professional contacts/clients: Red Ventures, Lunchbox Solutions, Vistra, Energy Creative

### Health & Fitness
- Active marathon training (current training plan should be stored and tracked)
- Workout regimen is recurring and time-blocked
- Training runs, strength work, rest days all tracked by category

### Side Projects (tracked as separate categories)
- **Gather** — app project (development work)
- **Freelance design** — client design work
- **Dot** — this app itself
- **Backyard / Home** — recurring maintenance tasks (watering plants, cleaning, yard work)

### Recurring Tasks (auto-populated, not manually entered each time)
- Marathon training runs (per training plan schedule)
- Workout sessions
- Plant watering (e.g., 2x/week)
- Weekly cleaning tasks
- Date night (Thursdays, protected)
- Morning meditation / devotional
- Evening wind-down / family time

---

## Architecture Overview

### Frontend (Mobile App)

**Tech stack:**
- React Native (Expo) — target iOS first
- Fonts: `Press Start 2P` (labels, UI chrome, pixel aesthetic) + `VT323` (task names, body text)
- Icons: Lucide React Native
- Design tokens (from Figma):
  - Background: `#FEFEFE` (warm paper cream)
  - Ink: `#2D2D2D` (charcoal, used for all borders/text)
  - Muted: `#8A8480` (timestamps, labels, secondary text)
  - Border style: `1.354px solid #2D2D2D` (task cards), `0.677px dashed #2D2D2D` (verse card)
  - Border radius: `4px` on cards/buttons
  - No gradients. No drop shadows. Flat, retro Game Boy aesthetic.

**Screens / Views (from Figma):**

1. **Home (Day View)** — Primary screen
   - Status bar: time (left) + "● DOT" status (right)
   - Dot pixel character (top-left, ~60px)
   - Action buttons: `+` (add task) and mic icon (voice input) — top-right
   - Daily Bible verse card (dashed border, corner olive decorations)
   - `TO-DO` header
   - Tab switcher: `DAY | WEEK | CATS`
   - Date navigation bar (← Today Tue, Jun 16 → + calendar icon)
   - Task list grouped by time period:
     - `MORNING` / `AFTERNOON` / `EVENING` / `UNSCHEDULED`
   - Each task card: category icon + checkbox + task name (VT323 18px) + time/duration (Press Start 2P 6px) + recurring icon + drag handle
   - Completed tasks: strikethrough, 50% opacity, filled checkbox
   - `THINGS TO FIGURE OUT` collapsible section (count badge)
   - Footer: task count + `END MY DAY` button + refresh button

2. **Week View** — Accessed via WEEK tab
   - Week-at-a-glance layout
   - Hours-per-category pixel bar chart visualization
   - Overview of all 7 days

3. **Categories View (CATS)** — Accessed via CATS tab
   - Category manager
   - Add/edit/delete categories
   - Category icon picker (Lucide icons)
   - Time allocation tracking per category

4. **Add Task — Type** (`Add task typing`)
   - Inline text input bar
   - Time picker
   - Number/duration input
   - Category dropdown

5. **Add Task — Voice** (`Add task speak` / `VoiceModal`)
   - Mic capture UI
   - States: `Capturing audio` → `Transcribing audio` → `Confirming plan based on audio`
   - Dot reacts with mood states during voice flow

6. **Calendar Expanded** (`InlineCalendar`)
   - Full month calendar inline view
   - Date selection

7. **End My Day View** (`End my day view`)
   - Evening wrap-up flow
   - Dot in `sleeping` mood
   - Summary of day's completions, misses, notes

8. **All Tasks Complete** (`All tasks complete`)
   - Celebration state
   - Dot in `excited` mood

---

### Backend / Data Layer

**Storage:** SQLite via Expo SQLite (local, on-device). No cloud sync for v1.

**Core data models:**

```typescript
// Task
{
  id: string
  title: string
  categoryId: string
  date: string // ISO date
  scheduledTime?: string // "HH:MM"
  durationMinutes?: number
  isRecurring: boolean
  recurrenceRule?: RecurrenceRule // daily/weekly/custom
  isCompleted: boolean
  timePeriod: 'morning' | 'afternoon' | 'evening' | 'unscheduled'
  isThingsToFigureOut: boolean
  createdAt: string
}

// Category
{
  id: string
  name: string
  icon: string // Lucide icon name
  color?: string
}

// DailyPlan
{
  date: string
  lockedAt?: string // timestamp when plan was confirmed
  dotGreetingShown: boolean
  dayEndedAt?: string
}

// TrainingPlan (marathon)
{
  weekNumber: number
  dayOfWeek: number // 0-6
  workoutType: 'easy run' | 'long run' | 'speed work' | 'rest' | 'cross-train'
  targetDistance?: number // miles
  targetDuration?: number // minutes
  notes?: string
}

// UserContext (singleton, Dot's always-on knowledge)
{
  marathonTrainingStartDate: string
  currentMarathonPlan: TrainingPlan[]
  thursdayDateNightEnabled: boolean
  commuteTimeMinutes: number
  wakeUpTime: string // "HH:MM"
  sleepTime: string // "HH:MM"
  preferredRunTime: 'morning' | 'evening'
}
```

**Recurring task engine:**
- On app open each day, auto-generate tasks from recurrence rules
- Marathon training: auto-insert today's workout based on training plan week/day
- Home tasks: water plants (Mon/Thu), cleaning (Sat), etc.
- Thursday date night: auto-block 6pm–10pm, protected from scheduling conflicts

---

### AI Layer: Dot as the Brains

Dot uses the **Anthropic Claude API** (`claude-sonnet-4-6`) as her intelligence layer. The API key is stored securely in Expo SecureStore — never hardcoded.

**How the AI integration works:**

Every time David speaks to Dot (via voice or text), the request goes to Claude with a rich system prompt that includes:
- Today's full schedule (all tasks, times, categories)
- David's life context (commute, marathon plan, date night, side projects)
- Current time and day of week
- Upcoming week overview
- Any conflicts or gaps detected
- Dot's personality guidelines

**Key AI interaction flows:**

1. **Morning Planning** — Dot greets David, summarizes today's auto-populated schedule, asks what's on his mind, fills in gaps, flags conflicts, and locks in the plan. The locked plan is saved to `DailyPlan`.

2. **Conversational Reschedule** — "Hey Dot, I need to move my run to the morning." → Dot processes, detects conflicts, proposes a new schedule, updates the DB.

3. **Voice Task Add** — David speaks a task, Dot transcribes (Web Speech API / Expo Speech), extracts task details via Claude (title, time, duration, category), confirms with David, writes to DB.

4. **Smart Conflict Detection** — Before locking any plan, Dot scans for: double-booking, commute conflicts, insufficient gaps between tasks, missed marathon workout days.

5. **End of Day** — Dot summarizes what was done, what was missed, and surfaces anything that should carry forward.

**System prompt template (injected fresh each call):**

```
You are Dot, David's personal AI companion and life OS. You are warm, direct, and proactive. You already know everything about David's life — never ask for context he's already shared.

DAVID'S CONTEXT:
- Today is [DATE], [TIME]
- It is [DAY_OF_WEEK]. [THURSDAY_NOTE if applicable]
- Manhattan commute daily (~45 min each way)
- Marathon training: Week [N] of plan. Today's workout: [WORKOUT]
- Active side projects: Gather (app), freelance design, Dot, backyard

TODAY'S SCHEDULE:
[Full task list with times, categories, durations]

CONFLICTS DETECTED:
[List any scheduling conflicts]

PERSONALITY:
- Speak in short, warm sentences
- Be decisive — propose solutions, don't just list options
- Never re-ask for info David has already told you
- When a plan is locked, confirm it clearly and move on
- Use "I" not "we" — you are Dot, a singular companion
```

**API call pattern:**
```typescript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: buildDotSystemPrompt(userContext, todaySchedule),
    messages: conversationHistory
  })
})
```

The API key is injected at runtime from `SecureStore` — it is set once during app setup in a hidden settings screen and never displayed again.

---

## File / Folder Structure (React Native / Expo)

```
dot/
├── app/                        # Expo Router screens
│   ├── index.tsx               # Home / Day View
│   ├── week.tsx                # Week View
│   ├── categories.tsx          # CATS View
│   ├── end-of-day.tsx          # End My Day
│   └── _layout.tsx
├── components/
│   ├── DotCharacter.tsx        # Pixel sprite + mood animations
│   ├── TaskCard.tsx            # Individual task row
│   ├── VerseCard.tsx           # Daily Bible verse widget
│   ├── TabSwitcher.tsx         # DAY / WEEK / CATS tabs
│   ├── DateNav.tsx             # ← date → navigation bar
│   ├── VoiceModal.tsx          # Mic capture + transcription UI
│   ├── AddTaskModal.tsx        # Typed task entry
│   ├── CategoryManager.tsx     # Category CRUD
│   └── InlineCalendar.tsx      # Expanded date picker
├── lib/
│   ├── ai.ts                   # Claude API calls + system prompt builder
│   ├── db.ts                   # SQLite schema + queries
│   ├── recurring.ts            # Recurrence engine
│   ├── conflicts.ts            # Conflict detection logic
│   ├── marathon.ts             # Training plan data + lookup
│   └── userContext.ts          # UserContext singleton + SecureStore
├── constants/
│   ├── categories.ts           # Default categories + icons
│   ├── verses.ts               # Daily verse rotation (or API)
│   └── theme.ts                # Design tokens
├── assets/
│   └── dot-sprite/             # Pixel art sprite frames per mood
└── CLAUDE.md                   # This file
```

---

## Key UX Principles

1. **A locked-in plan is the goal.** The morning planning flow ends when the day is confirmed — not when a list is shown. Dot pushes toward commitment.

2. **Dot already knows.** She never asks David who he is, what his job is, or what his marathon plan is. That's all in the system prompt.

3. **Front end is simple; backend is rich.** The UI is calm, minimal, retro. The intelligence lives in Claude and the data layer.

4. **Thursday is sacred.** Date night is auto-blocked. Dot will never suggest scheduling something over it without explicit override from David.

5. **Marathon training is non-negotiable.** If a training run is on the plan, Dot flags it if it's not scheduled. She proposes when to fit it in.

6. **Recurring ≠ rigid.** Recurring tasks are suggestions with history. David can skip them, Dot notes it but doesn't nag.

7. **Voice-first feel, touch-also works.** The mic button is prominent. Dot is designed to be talked to.

---

## Development Priorities (Build Order)

1. **Data layer** — SQLite schema, seed data, recurring task engine
2. **Home screen** — Day view with static tasks, Dot character, tabs
3. **Task CRUD** — Add/complete/delete tasks (typed)
4. **Claude integration** — System prompt builder, API call wrapper, SecureStore key setup
5. **Voice input** — Expo Speech / Web Speech API → Claude → task creation
6. **Morning planning flow** — Conversational planning → lock plan
7. **Week view** — 7-day overview + category chart
8. **Categories view** — Category manager
9. **End of day flow** — Summary + Dot sleeping state
10. **Recurring engine** — Marathon plan auto-insert, repeating tasks
11. **Conflict detection** — Proactive flagging in Dot's responses

---

## Environment Setup Notes

- Expo SDK 51+
- Target: iOS (iPhone, portrait only)
- `expo-secure-store` for API key storage
- `expo-speech` for voice transcription (or Web Speech API in Expo web)
- `expo-sqlite` for local DB
- `expo-font` for Press Start 2P + VT323
- Lucide React Native for icons
- No Tailwind — use StyleSheet or NativeWind if styling becomes complex

**API Key Setup:**
On first launch, a hidden settings screen (accessible via long-press on Dot) prompts David to enter his Anthropic API key. It is stored via `SecureStore.setItemAsync('ANTHROPIC_API_KEY', key)` and retrieved on each AI call. Never logged, never exposed in UI.

---

## Design System Quick Reference

| Token | Value |
|---|---|
| Background | `#FEFEFE` |
| Ink | `#2D2D2D` |
| Muted | `#8A8480` |
| Border (cards) | `1.354px solid #2D2D2D` |
| Border (verse) | `0.677px dashed #2D2D2D` |
| Border radius | `4px` |
| Font (UI) | `Press Start 2P` |
| Font (content) | `VT323` |
| Task name size | `18px` VT323 |
| Label size | `6–9px` Press Start 2P |
| Section header | `7px` Press Start 2P, `#8A8480`, `letter-spacing: 2px` |
| No gradients | ✓ |
| No shadows | ✓ |
| Dot sprite | 60×60px, top-left, only color element |

---

## Session Log

### 2026-06-19 — Dead code cleanup + EAS build setup

**Current app state (as of this session):**
- Stack is actually Expo SDK 54 (not 56 as earlier docs/duplicate files claimed) with a real Supabase backend (auth, tasks, categories, recurring rules) — no longer local SQLite.
- `app/index.tsx` carries Day/Week/Categories views as in-file tab states (not separate routes as originally spec'd).
- `app/dot-chat.tsx` has a working Claude tool-use loop (add_task/update_task/review_schedule) with conflict detection wired in via `lib/conflicts.ts`.
- `lib/ai.ts` and `lib/recurring.ts` are real and complete; `lib/conflicts.ts` covers overlap/commute/Thursday-date-night protection.
- **Still missing:** no `VoiceModal` component exists at all (voice input is unbuilt despite `expo-speech` being installed); no dedicated Week/Categories/End-of-Day/Calendar screens (all inline); no "All Tasks Complete" celebration screen (just a small `RelaxRow`); `DotCharacter` only has `happy`/`sleeping` sprites — `thinking`/`excited` silently fall back to `happy`; no marathon-training-plan-specific auto-insert logic (recurring engine is generic only).

**Completed this session:**
1. Diagnosed and deleted dead code: `lib/db.ts` (leftover local SQLite schema, fully superseded by Supabase) and `lib/userContext.ts` (its only consumer, itself unused anywhere in the app).
2. Uninstalled the now-unused `expo-sqlite` dependency from `package.json`/`package-lock.json`.
3. Diagnosed and deleted three stale duplicate snapshot files cluttering the repo root: `AGENTS 2.md`, `CLAUDE 2.md`, `package-lock 2.json` — leftover copies from an earlier SDK-56-vs-54 migration point, not referenced anywhere.
4. Committed and pushed pending in-progress work that had been sitting uncommitted:
   - `eas.json` + `.npmrc` — new EAS build configuration (project ID `465326ec-efd7-4a8d-a00c-ae0628dbd0ef`, owner `dkacinski`).
   - `app.json` — added `ITSAppUsesNonExemptEncryption: false` to iOS `infoPlist`, added `extra.eas.projectId` and `extra.router`, added `owner` field.
   - `assets/adaptive-icon.png` / `assets/icon.png` — updated icon assets.
   - `lib/ai.ts` — fixed a bug in `runPlannerTurn`: tool calls were being dropped when Claude's response was cut off by `max_tokens` before reaching a `tool_use` stop reason, leaving dangling unresolved `tool_use` blocks that broke every subsequent request with a 400. Now resolves any `tool_use` blocks present regardless of `stop_reason`, and raised the token budget for that call from 600 to 1500.
   - Pushed as commit `1a3d0f3` ("EAS build setup and cleanup") to `origin/master`.

**Unresolved / open items for next session:**
- Voice input (`VoiceModal`, `expo-speech` wiring) — biggest gap versus the original spec, not started.
- No separate route files for Week/Categories/End-of-Day/Calendar — currently fine functionally, but worth deciding whether to keep as in-file tabs or split into real routes per the original architecture doc.
- `DotCharacter` missing `thinking`/`excited` sprite assets.
- No marathon-training-plan-specific recurring logic or Supabase table (only existed in the now-deleted `lib/db.ts`).
- EAS build config (`eas.json`) was just added but not yet tested with an actual `eas build` run.
