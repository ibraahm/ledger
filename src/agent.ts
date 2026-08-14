import { config } from "./config.js";
import { chat, type ChatMessage } from "./ollama.js";
import { checkOllamaHealth } from "./ollama.js";
import { runTool, toolSchemas } from "./tools.js";
import * as store from "./store.js";
import { zonedNowLabel } from "./time.js";
import { withTransaction } from "./db.js";
import {
  captureDataSnapshot,
  createActionRun,
  finishActionRun,
  idempotencyKey,
  priorToolResult,
  recordToolStep,
  rollbackActionRun,
  type ActionLabel,
} from "./actions.js";

export interface AgentReply {
  reply: string;
  actions: ActionLabel[];
  entryId: number;
  userMessageId?: number;
  assistantMessageId: number;
}

const CONSISTENCY_REVIEW_REQUIRED = new Set([
  "add_commitment",
  "add_event",
  "update_commitment",
  "update_goal",
  "update_event",
  "close_commitment",
  "archive_goal",
  "cancel_event",
]);

const MUTATING_TOOLS = new Set([
  "add_commitment", "add_event", "update_commitment", "update_goal", "update_event",
  "cancel_event", "upsert_entity", "record_fact", "close_commitment", "archive_goal", "clear_feed_and_calendar",
]);

function validateToolBatch(calls: any[]): void {
  if (calls.length > 12) throw new Error("The model proposed too many changes at once. Split the request into a smaller batch.");
  const supported = new Set(toolSchemas.map((schema) => schema.function.name));
  const seen = new Set<string>();
  for (const call of calls) {
    const name = String(call.function?.name || "");
    if (!supported.has(name)) throw new Error(`Unsupported Ledger operation: ${name || "unknown"}.`);
    const signature = JSON.stringify([name, call.function?.arguments || {}]);
    if (MUTATING_TOOLS.has(name) && seen.has(signature)) {
      throw new Error(`The model proposed the same ${name} operation twice.`);
    }
    seen.add(signature);
  }
}

function routedTools(message: string): typeof toolSchemas {
  const text = message.toLowerCase();
  const names = new Set<string>();
  const add = (...values: string[]) => values.forEach((value) => names.add(value));
  const prayerQuery = /\b(prayer|prayer times|salah|salat|fajr|sunrise|dhuhr|duhr|zuhr|asr|maghrib|isha)\b/.test(text);
  if (prayerQuery) add("get_prayer_times");
  if (/\b(clear|remove|delete|erase)\b/.test(text) && /\b(all|everything|feed|calendar|commitments|tasks|events)\b/.test(text)) {
    add("clear_feed_and_calendar");
  }
  if (/\b(task|commitment|promise|due|finish|done|complete|send|call|email|text|follow up|waiting|owe|review|approve|research|prepare|delegate|recap|decision|document|reminder|priority|reschedule|move)\b/.test(text)) {
    add("review_consistency", "get_agenda", "add_commitment", "update_commitment", "close_commitment", "search", "get_entity", "upsert_entity");
  }
  if (/\b(calendar|event|meeting|call|appointment|schedule|deadline|cancel|reschedule|move)\b/.test(text)) {
    add("review_consistency", "get_agenda", "add_event", "update_event", "cancel_event", "search", "get_entity", "upsert_entity");
  }
  if (/\b(goal|outcome|target|achieve|archive)\b/.test(text)) {
    add("review_consistency", "update_goal", "archive_goal", "list_goals", "search", "get_entity", "upsert_entity");
  }
  if (/\b(remember|note|learn|lesson|decision|preference|person|project|organization|memory|said|agreed|why|who)\b/.test(text)) {
    add("record_fact", "upsert_entity", "search", "get_entity", "list_entities");
  }
  if (!prayerQuery && /\b(review|risk|inconsisten|conflict|agenda|today|week|attention|forget|plan|decide|recommend|compare)\b/.test(text)) {
    add("review_consistency", "get_agenda", "list_goals", "search", "get_entity", "list_entities");
  }
  if (!names.size) return toolSchemas;
  return toolSchemas.filter((schema) => names.has(schema.function.name));
}

function routedModel(message: string): string {
  return /\b(review|risk|inconsisten|conflict|decide|recommend|analy[sz]e|compare|strategy)\b/i.test(message)
    ? config.reviewModel
    : config.fastModel;
}

function systemPrompt(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: config.timezone });
  return `You are Ledger, the private memory assistant for ${config.ownerName}. This memory spans their personal and professional life: people, relationships, projects, lessons, ideas, decisions, goals, tasks, promises, and appointments. They dump raw, half-finished thoughts throughout the day. Your job is to catch what matters, connect it, and file it so it can be found and acted on later.

Right now it is ${weekday} ${zonedNowLabel(now, config.timezone)} (${config.timezone}).

The store has five shapes:
- Entities: people, organizations, projects, topics, and personal or professional areas. Business-specific partners, agents, countries, and corridors are supported too.
- Facts: durable knowledge, lessons, preferences, decisions, context, and insights attached to an entity.
- Commitments: every task has exactly one Goal Area, one Task Type, and an encrypted structured brief. Every task also has waiting_on, next_action, and an optional daily, weekly, monthly, or quarterly repeat schedule.
- Goals: manually created longer-term outcomes. Chat may review, update, or archive an existing goal, but it cannot create goals.
- Events: anything happening at a moment in time.

How to work:
1. Read the whole dump before acting. One message can contain several different things, but repetition is often context rather than a request for separate records.
2. Give each task exactly one Goal Area: company, digital, compliance, agents, partners, banking, growth, team, personal_finance, or personal_health_family. Give it exactly one Task Type: call, email, text, meeting, follow_up, review, approve, research, prepare, delegate, recap, decision, document, reminder, or personal. Never represent the same work in two types.
3. Whenever a person, organization, project, topic, or important life/work area is named, connect it to the existing entity when one exists. Do not create a second record for the same named person or subject. Attach related facts, goals, and commitments by name.
4. Resolve every relative date yourself against the current date above. Never pass words like "tomorrow" into a date field. A recurring task must have a first due date. Set recurrence to daily, weekly, monthly, or quarterly only when the user asks for repetition; completing an occurrence automatically creates the next dated occurrence.
5. Before answering any question about what was said, agreed or promised, call search or get_entity. Never answer from memory of the conversation alone. Search matches whole words only, so try a couple of distinct terms if the first misses.
6. Before creating or changing a task, goal, or event, check relevant Calendar and Feed records with review_consistency. Also search distinctive subject words when the request could refer to an existing record. Look for duplicates, conflicting dates or times, incompatible statuses, a task that already appears complete, and commitments that contradict an active goal. If you find a real inconsistency, explain it and ask for a choice before making the conflicting change.
7. Goals are manual. Never create a goal or convert tasks into a goal from chat. If the user asks to create one, tell them to open Feed, choose Goals, and use Add goal. You may review, update, or archive a goal that already exists.
8. Fill the task brief from facts the user supplied: contact, reason, type-specific details, waiting_on, and next_action. Never invent a phone, email, person, result, recap, decision, or follow-up date. waiting_on and next_action must always exist in the framework but may be blank when genuinely unknown.
Type-specific task fields:
- call: call_purpose, talking_points, call_recap, decision.
- email or text: subject/channel, purpose, message_needed, sent, response_received, response_recap.
- meeting: meeting_with, purpose, agenda, meeting_location, meeting_recap, decisions, action_items, next_meeting.
- follow_up: original_topic, last_contact_date, follow_up_method.
- review or approve: item_to_review/item_to_approve, document_link/approval_criteria, questions, findings, decision, reason_for_decision.
- research or prepare: research_question/deliverable, sources/inputs/requirements, findings, recommendation.
- delegate: delegated_task, assigned_to, expected_result, check_in_date, delegation_status.
- recap or decision: recap_subject/decision_needed, key_points/options/pros/cons, decisions/decision/reason_for_decision/action_items/deadline.
- document, reminder, or personal: document_name/audience/document_status, reminder_for/recurring/frequency, or personal_category/recurring/frequency.
9. Consolidate repetitive work into one useful parent commitment and put each code, location, agent, vendor, partner, file, or other member in the add_commitment items array. Never create one commitment per batch member. If a broad workstream already covers the listed items, update that commitment. Never create both a broad commitment and every implied subtask unless the user explicitly asks for separate independent tasks. Create at most five parent commitments from one capture.
10. A call, email, text, or meeting can be a typed task with a due date and time. Create a Calendar event only when the user explicitly asks to put or schedule it on the calendar; do not create both records by default.
11. Do not turn displayed reference schedules into calendar events unless the user explicitly asks to add them to their calendar. This especially applies to prayer-time boards, weather, timetables, screenshots, menus, and lists of times. Keep the original message as captured content and record only user-specific commitments or appointments.
12. Treat direct instructions as operations. If the user says move, change, reschedule, rename, reprioritize, complete, archive, cancel, or remove, use the matching management tool. Do not create a replacement record and do not merely save a note about the requested change.
13. Never claim that a change happened unless a tool confirmed it. If a management tool reports multiple matches, change nothing and ask one precise question naming the choices. If nothing matches, say so and ask for a distinctive title.
14. Do not create a vague commitment. A task must have a concrete action and a clear object or outcome, and its owner must be clear from context. A due date is optional unless timing is essential. If the action, object, outcome, owner, or intended existing record is unclear, create no task and ask one concise clarifying question first. The raw message is already safely captured, so it is acceptable to wait before creating the structured task.
15. Keep clarifying questions strictly necessary and operational. Ask at most one question at a time. Do not ask for personal background, feelings, family details, health, finances, identity, motives, or other sensitive context unless the user explicitly asks Ledger to manage that subject and the detail is essential. Prefer a concrete choice such as which record, who owns it, what result, or what date.
16. For prayer-time requests, call get_prayer_times immediately. Never respond that you could look them up later. If the tool reports that no location is configured, ask only for latitude and longitude. Report the timezone and calculation method, distinguish calculated prayer starts from mosque iqamah times, and never store the location or create calendar events unless the user explicitly asks.
17. Clearing all Feed commitments and Calendar events is a destructive bulk operation. On the initial request, explain that goals, memory, source notes, and chat will remain, then ask the user to send exactly: CLEAR FEED AND CALENDAR. Call clear_feed_and_calendar only when the latest user message is exactly that phrase. Never claim anything was cleared unless the tool reports exact removed counts.

Reasoning standard:
- Identify what decision or action the user is actually trying to make. Lead with that answer.
- Break important questions into claims that can be checked independently. Spend the most effort where being wrong would cost the most.
- Treat stored notes as the user's source material, not automatically verified fact. Say when a conclusion is sourced from a note, inferred, or externally verified.
- Test the strongest opposing case before recommending a decision. End with the main risk or condition that would change the recommendation.
- Prefer answer, then reasoning, then risk. Do not bury the decision under background.

Operating rhythm:
- Capture can be rough. Never demand formatting before saving a useful note.
- When the same process appears repeatedly, suggest documenting a playbook and naming who could run it.
- During a weekly review, surface what shipped, unprocessed notes, overdue commitments, active goals, and one priority for the next week.
- When asked to review for inconsistencies, inspect Calendar events, open tasks and promises in both directions, active goals, overdue work, and unscheduled work. Report only meaningful conflicts or gaps, not harmless wording differences.

Do not record passwords, authentication secrets, payment-card numbers, bank-account numbers, government ID numbers, or private customer transaction details. If a dump contains them, file only the useful context and leave the secret or regulated detail out.

How to reply:
Professional and plain, two or three sentences. Lead with what you completed or found, then mention anything that still needs a choice. Flag anything that clashes, is overdue, or that someone owes and has gone quiet on. Use a short list for an agenda or prayer times; otherwise avoid bullets. No preamble.`;
}

async function processCapturedEntry(
  entryId: number,
  userMessage: string,
  history: store.Message[],
): Promise<Omit<AgentReply, "userMessageId" | "entryId">> {
  const contextHistory = history.at(-1)?.role === "user" && history.at(-1)?.content === userMessage
    ? history.slice(0, -1)
    : history;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...contextHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const actionRunId = await createActionRun(entryId);
  const actions: ActionLabel[] = [];
  let consistencyReviewed = false;
  const availableTools = routedTools(userMessage);
  const selectedModel = routedModel(userMessage);
  try {
    for (let round = 0; round < config.maxToolRounds; round++) {
      const assistant = await chat(messages, availableTools, { model: selectedModel });
      messages.push(assistant);

      const calls = assistant.tool_calls || [];
      if (!calls.length) {
        const reply =
          assistant.content.trim() || (actions.length ? "Filed." : "No record was created. Add more detail if you want this stored.");
        const assistantMessageId = await store.addMessage("assistant", reply, actions);
        await store.markProcessed(entryId);
        await finishActionRun(actionRunId, "complete", assistantMessageId, actions.map((action) => action.label).join("; "));
        return { reply, actions, assistantMessageId };
      }

      validateToolBatch(calls);
      try {
        const roundResults = await withTransaction(async () => {
          const completed: { toolName: string; result: any }[] = [];
          for (const call of calls) {
            const toolName = call.function?.name || "unknown";
            if (CONSISTENCY_REVIEW_REQUIRED.has(toolName) && !consistencyReviewed) {
              completed.push({
                toolName,
                result: { output: "No change was made. Call review_consistency first, inspect Calendar and Feed for duplicates or conflicts, then either ask one necessary question or retry this operation." },
              });
              continue;
            }
            if (!MUTATING_TOOLS.has(toolName)) {
              const result = await runTool(toolName, call.function?.arguments, entryId, { userMessage });
              if (toolName === "review_consistency") consistencyReviewed = true;
              completed.push({ toolName, result });
              continue;
            }
            const key = idempotencyKey(entryId, toolName, call.function?.arguments || {});
            const prior = await priorToolResult(key);
            if (prior) {
              completed.push({ toolName, result: prior });
              continue;
            }
            const before = await captureDataSnapshot();
            const result = await runTool(toolName, call.function?.arguments, entryId, { userMessage });
            if (result.action) result.action.undoRunId = actionRunId;
            await recordToolStep(actionRunId, toolName, key, result, before);
            completed.push({ toolName, result });
          }
          return completed;
        });
        for (const { toolName, result } of roundResults) {
          if (result.action && !actions.some((action) => action.label === result.action.label)) actions.push(result.action);
          messages.push({ role: "tool", tool_name: toolName, content: result.output });
        }
      } catch (error) {
        for (const call of calls) {
          messages.push({
            role: "tool",
            tool_name: call.function?.name || "unknown",
            content: `The entire change batch was rolled back: ${(error as Error).message}`,
          });
        }
      }
    }

    await rollbackActionRun(actionRunId);
    actions.splice(0, actions.length);
    const reply = "The note was saved, but no structured changes were kept because filing did not finish. It is queued for retry.";
    const assistantMessageId = await store.addMessage("assistant", reply, actions);
    // Keep the capture pending. The background queue can retry it once the
    // model is healthy or a newly deployed tool can complete the operation.
    return { reply, actions, assistantMessageId };
  } catch (error) {
    await finishActionRun(actionRunId, "failed", undefined, (error as Error).message).catch(() => undefined);
    await rollbackActionRun(actionRunId).catch(() => undefined);
    throw error;
  }
}

export async function respond(userMessage: string): Promise<AgentReply> {
  const history = await store.recentMessages(config.historyTurns);

  // Capture is independent of inference: the raw entry lands before the model runs,
  // so nothing is lost if the model is slow, wrong or unreachable.
  const entryId = await store.addEntry(userMessage, "chat");
  const userMessageId = await store.addMessage("user", userMessage);
  try {
    return { ...(await processCapturedEntry(entryId, userMessage, history)), entryId, userMessageId };
  } catch (error) {
    Object.assign(error as object, { entryId, userMessageId });
    throw error;
  }
}

export async function retryEntry(id: number): Promise<AgentReply> {
  const entry = await store.getEntry(id);
  if (!entry) throw new Error("Captured note not found.");
  if (entry.processed) throw new Error("This note has already been filed.");
  const history = await store.recentMessages(config.historyTurns);
  return { ...(await processCapturedEntry(entry.id, entry.body, history)), entryId: entry.id };
}

let queueBusy = false;

export async function processQueuedEntry(): Promise<boolean> {
  if (queueBusy) return false;
  queueBusy = true;
  try {
    const health = await checkOllamaHealth();
    if (health.state !== "online") return false;
    const queued = await store.pendingEntries(20);
    for (const entry of queued) {
      const detail = await store.entryDetail(entry.id);
      const partialCount = detail ? detail.facts.length + detail.tasks.length + detail.goals.length + detail.events.length : 0;
      if (partialCount > 0) continue;
      await retryEntry(entry.id);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    queueBusy = false;
  }
}

export function startProcessingQueue(): void {
  const timer = setInterval(() => void processQueuedEntry(), 60_000);
  timer.unref();
}
