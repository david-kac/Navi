import { getAnthropicApiKey } from './secureSettings';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

// ─── System prompt ────────────────────────────────────────────────────────────

interface ScheduleContext {
  date: string;
  time: string;
  dayOfWeek: string;
  isThursday: boolean;
  todayTasks: string;
  conflicts: string;
  categoryNames?: string[];
  mode: 'morning' | 'anytime';
  verse?: { text: string; reference: string };
}

export function buildDotSystemPrompt(ctx: ScheduleContext): string {
  return `You are Dot, David's personal AI companion and life OS. You are warm, direct, and proactive. You already know everything about David's life — never ask for context he has already shared.

DAVID'S CONTEXT:
- Today is ${ctx.date}, ${ctx.time}
- It is ${ctx.dayOfWeek}.${ctx.isThursday ? ' Thursday — date night with spouse at 6pm is PROTECTED. Do not schedule over it.' : ''}
- Manhattan commute daily (~45 min each way)
- Active side projects: Gather (app), freelance design, Dot, backyard
- Available categories: ${ctx.categoryNames?.length ? ctx.categoryNames.join(', ') : '(none yet)'}
${ctx.mode === 'morning' && ctx.verse ? `\nTODAY'S VERSE (quote this EXACTLY, word-for-word, never paraphrase or alter it):\n"${ctx.verse.text}" — ${ctx.verse.reference}\n` : ''}
TODAY'S SCHEDULE (each task's id is in brackets — use it for update_task, never say the raw id out loud):
${ctx.todayTasks || 'No tasks scheduled yet.'}

CONFLICTS DETECTED AT SESSION START (may be stale if you've made changes since — use review_schedule for a fresh check):
${ctx.conflicts || 'None.'}

SESSION TYPE: ${ctx.mode === 'morning'
    ? 'This is the once-daily automatic morning session. Greet David, share TODAY\'S VERSE exactly as written, and give a short summary of today. End the conversation working toward a locked plan.'
    : 'This is an ad-hoc anytime chat (David tapped your avatar). Keep your opening line to one short casual line like "Hey, what\'s up?" — no verse, no full summary unless he asks for one.'}

PERSONALITY:
- Speak in short, warm sentences
- Be decisive — propose solutions, do not just list options
- Never re-ask for info David has already told you
- When a plan is locked, confirm it clearly and move on
- Use "I" not "we" — you are Dot, a singular companion
- Do not over-explain

TOOLS — add_task (new tasks):
- If David gives an explicit time or date for a task ("at 3pm", "tomorrow at 9am", "Thursday"), call add_task right away with that time. Confirm briefly afterward.
- If David does NOT give an explicit time, do NOT call add_task yet. Look at TODAY'S SCHEDULE above, find specific open slot(s) that fit the requested duration(s) — including short breaks between back-to-back items if it makes sense — and propose exact start/end times by name (e.g. "How about 3:30–4:00 for piano, a 5 min break, then 4:05–4:35 for cleaning?"). End with a clear yes/no question like "Want me to lock that in?"
- Only call add_task once David confirms a proposed time (e.g. "yes", "sounds good", "do it"). Use the exact times you proposed. If he asks for changes, propose again and wait for confirmation again.
- Never silently schedule something David didn't give a time for — always propose first and wait for a yes.
- If David gives an explicit time, the above wait-for-confirmation rule does not apply — go ahead and call add_task immediately.

TOOLS — update_task (moving/editing existing tasks):
- Use this when David asks to move, reschedule, rename, or change the duration of something already on TODAY'S SCHEDULE. Find the matching task by title and use its id.
- Same confirmation rule as add_task: if David gives an explicit new time ("move my run to 7am"), call update_task right away. If he's vague ("move my run to the morning", "push cleaning back a bit"), propose a specific new time first and wait for a yes before calling update_task.
- Only change the fields David actually wants changed — omit the rest.
- If multiple tasks could match what David said, ask which one he means instead of guessing.

TOOLS — review_schedule (on-demand conflict check):
- Call this whenever David asks you to check his schedule, review for conflicts, or "does my day look okay" — anytime, not just in the morning session.
- It returns a fresh, live conflict check (overlaps, commute windows, Thursday date night) — always trust its result over the possibly-stale CONFLICTS DETECTED section above.
- Summarize the result in plain language. Don't call it unless David asks.`;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export async function callDot(
  systemPrompt: string,
  messages: Message[],
  maxTokens = 1000
): Promise<string> {
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) throw new Error('No API key set. Long-press Dot to open settings.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':            'application/json',
      'x-api-key':               apiKey,
      'anthropic-version':       '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find(b => b.type === 'text')?.text ?? '';
}

// ─── Natural-language task extraction (voice/typed task add) ──────────────────

export interface ExtractedTask {
  title: string;
  categoryName: string | null;
  date: string | null;          // "YYYY-MM-DD"
  scheduledTime: string | null; // "HH:MM" 24-hour
  durationMinutes: number | null;
  isRecurring: boolean;
  ruleType: 'daily' | 'weekly' | null;
  daysOfWeek: number[] | null;  // 0=Sun … 6=Sat, only for weekly
}

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export async function extractTaskFromText(text: string, categoryNames: string[], now: Date): Promise<ExtractedTask> {
  const today = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  const system = `You convert a short spoken or typed request into a single structured task for a personal task app. Today is ${today} (${weekday}).

Available categories: ${categoryNames.length ? categoryNames.join(', ') : '(none yet)'}.

Respond with ONLY a JSON object — no prose, no markdown code fences. Exact shape:
{"title": string, "categoryName": string or null, "date": "YYYY-MM-DD" or null, "scheduledTime": "HH:MM" (24-hour) or null, "durationMinutes": number or null, "isRecurring": boolean, "ruleType": "daily" or "weekly" or null, "daysOfWeek": array of integers (0=Sunday...6=Saturday) or null}

Rules:
- categoryName must exactly match one of the available categories, or be null if none fit.
- Resolve relative dates ("Thursday", "tomorrow") to an actual date using today's date above. If no date is mentioned, use null.
- If no duration is mentioned, use null. If no time is mentioned, use null.
- isRecurring is true if the request implies repetition: "every day", "daily", "recurring", "every Monday", "each weekday", etc. Otherwise false.
- If isRecurring is true and it's a daily cadence ("every day", "daily"), set ruleType to "daily" and daysOfWeek to null.
- If isRecurring is true and specific days are implied ("every Monday and Wednesday", "weekdays", "every Thursday"), set ruleType to "weekly" and daysOfWeek to the matching integers ("weekdays" = [1,2,3,4,5]).
- If isRecurring is false, ruleType and daysOfWeek must both be null.`;

  const reply = await callDot(system, [{ role: 'user', content: text }], 300);
  const json = stripCodeFences(reply);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Dot couldn't parse a task from that. Raw reply: ${reply}`);
  }

  const p = parsed as Partial<ExtractedTask>;
  if (typeof p.title !== 'string' || !p.title.trim()) {
    throw new Error("Dot couldn't figure out a task title from that.");
  }

  const isRecurring = p.isRecurring === true;
  const ruleType = isRecurring && (p.ruleType === 'daily' || p.ruleType === 'weekly') ? p.ruleType : null;
  const daysOfWeek = ruleType === 'weekly' && Array.isArray(p.daysOfWeek)
    ? p.daysOfWeek.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : null;

  return {
    title:            p.title.trim(),
    categoryName:     typeof p.categoryName === 'string' ? p.categoryName : null,
    date:             typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
    scheduledTime:    typeof p.scheduledTime === 'string' && /^\d{2}:\d{2}$/.test(p.scheduledTime) ? p.scheduledTime : null,
    durationMinutes:  typeof p.durationMinutes === 'number' ? p.durationMinutes : null,
    isRecurring,
    ruleType,
    daysOfWeek,
  };
}

// ─── Planner conversation with tool use (morning planning chat) ───────────────
// Lets Dot actually create tasks mid-conversation instead of just describing them.

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

const ADD_TASK_TOOL = {
  name: 'add_task',
  description: "Add a new task to the user's schedule. Call this whenever the user asks you to add, schedule, or block time for something.",
  input_schema: {
    type: 'object',
    properties: {
      title:            { type: 'string', description: 'Short task title.' },
      categoryName:     { type: 'string', description: 'Must exactly match one of the available categories. Omit if none fit.' },
      date:             { type: 'string', description: 'YYYY-MM-DD. Omit to default to today.' },
      scheduledTime:    { type: 'string', description: 'HH:MM 24-hour. Omit if no specific time was mentioned.' },
      durationMinutes:  { type: 'number', description: 'Omit if no duration was mentioned.' },
    },
    required: ['title'],
  },
};

export interface AddTaskToolInput {
  title: string;
  categoryName?: string;
  date?: string;
  scheduledTime?: string;
  durationMinutes?: number;
}

const UPDATE_TASK_TOOL = {
  name: 'update_task',
  description: "Move or edit an existing task on the user's schedule. Use the task's id from TODAY'S SCHEDULE.",
  input_schema: {
    type: 'object',
    properties: {
      taskId:           { type: 'string', description: "The task's id, copied exactly from TODAY'S SCHEDULE." },
      title:            { type: 'string', description: 'New title. Omit if not changing.' },
      date:             { type: 'string', description: 'New YYYY-MM-DD if moving to a different day. Omit if not changing.' },
      scheduledTime:    { type: 'string', description: 'New HH:MM 24-hour start time. Omit if not changing.' },
      durationMinutes:  { type: 'number', description: 'New duration in minutes. Omit if not changing.' },
    },
    required: ['taskId'],
  },
};

export interface UpdateTaskToolInput {
  taskId: string;
  title?: string;
  date?: string;
  scheduledTime?: string;
  durationMinutes?: number;
}

const REVIEW_SCHEDULE_TOOL = {
  name: 'review_schedule',
  description: "Runs a fresh conflict check (overlaps, commute windows, Thursday date night) against the user's current schedule. Call only when the user explicitly asks for a review.",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

async function callClaudeRaw(
  systemPrompt: string,
  messages: AnthropicMessage[],
  maxTokens: number
): Promise<{ content: AnthropicContentBlock[]; stop_reason: string }> {
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) throw new Error('No API key set. Long-press Dot to open settings.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages,
      tools:      [ADD_TASK_TOOL, UPDATE_TASK_TOOL, REVIEW_SCHEDULE_TOOL],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  return res.json();
}

export interface PlannerTurnResult {
  history: AnthropicMessage[];
  replyText: string;
  addedTasks: AddTaskToolInput[];
  updatedTasks: UpdateTaskToolInput[];
}

export interface PlannerToolExecutors {
  executeAddTask:      (input: AddTaskToolInput) => Promise<{ success: boolean; message: string }>;
  executeUpdateTask:   (input: UpdateTaskToolInput) => Promise<{ success: boolean; message: string }>;
  executeReviewSchedule: () => Promise<{ success: boolean; message: string }>;
}

export async function runPlannerTurn(
  systemPrompt: string,
  history: AnthropicMessage[],
  userText: string,
  executors: PlannerToolExecutors,
): Promise<PlannerTurnResult> {
  let messages: AnthropicMessage[] = [...history, { role: 'user', content: userText }];
  const addedTasks: AddTaskToolInput[] = [];
  const updatedTasks: UpdateTaskToolInput[] = [];
  let replyText = '';

  for (let i = 0; i < 5; i++) {
    const response = await callClaudeRaw(systemPrompt, messages, 1500);
    messages = [...messages, { role: 'assistant', content: response.content }];

    const textBlocks = response.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[];
    replyText = textBlocks.map(b => b.text).join('\n').trim();

    const toolUses = response.content.filter(b => b.type === 'tool_use') as
      { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }[];

    // Resolve any tool_use blocks present, regardless of stop_reason — Claude can be
    // cut off by max_tokens after emitting complete tool calls, and an unresolved
    // tool_use left dangling in history breaks every subsequent request with a 400.
    if (toolUses.length === 0) break;

    const toolResults: AnthropicContentBlock[] = [];
    for (const call of toolUses) {
      if (call.name === 'add_task') {
        const input = call.input as unknown as AddTaskToolInput;
        const result = await executors.executeAddTask(input);
        if (result.success) addedTasks.push(input);
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result.message });
      } else if (call.name === 'update_task') {
        const input = call.input as unknown as UpdateTaskToolInput;
        const result = await executors.executeUpdateTask(input);
        if (result.success) updatedTasks.push(input);
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result.message });
      } else if (call.name === 'review_schedule') {
        const result = await executors.executeReviewSchedule();
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result.message });
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: `Unknown tool: ${call.name}` });
      }
    }
    messages = [...messages, { role: 'user', content: toolResults }];
  }

  return { history: messages, replyText, addedTasks, updatedTasks };
}

// ─── End-of-day summary ────────────────────────────────────────────────────────

export interface EndOfDayTask {
  title: string;
  isCompleted: boolean;
  isTTFO: boolean;
}

export async function generateEndOfDaySummary(tasks: EndOfDayTask[], dateLabel: string): Promise<string> {
  const done   = tasks.filter(t => !t.isTTFO && t.isCompleted).map(t => t.title);
  const missed = tasks.filter(t => !t.isTTFO && !t.isCompleted).map(t => t.title);
  const ttfo   = tasks.filter(t => t.isTTFO).map(t => t.title);

  const system = `You are Dot, David's warm, direct personal companion. It's the end of the day (${dateLabel}). Write a short end-of-day recap in your voice: 2-4 short sentences, plain prose, no bullet points or markdown.

Mention what got done (briefly celebrate), what got missed and should carry forward to tomorrow (gently, no guilt), and anything still undecided ("things to figure out"). If everything was done and nothing is undecided, just celebrate — don't invent problems to mention.`;

  const userMsg = [
    `DONE:\n${done.length ? done.map(t => `- ${t}`).join('\n') : 'Nothing'}`,
    `MISSED:\n${missed.length ? missed.map(t => `- ${t}`).join('\n') : 'Nothing'}`,
    `STILL UNDECIDED:\n${ttfo.length ? ttfo.map(t => `- ${t}`).join('\n') : 'Nothing'}`,
  ].join('\n\n');

  return callDot(system, [{ role: 'user', content: userMsg }], 300);
}
