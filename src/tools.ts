import { config, ENTITY_KINDS, type EntityKind } from "./config.js";
import type { ToolSchema } from "./ollama.js";
import * as store from "./store.js";
import { zonedDateTimeToUtc, zonedNowLabel } from "./time.js";
import type { ActionLabel } from "./actions.js";
import { cachedOrFreshPrayerTimes, prayerTimesToolOutput } from "./prayer.js";
import {
  GOAL_AREAS,
  TASK_TYPES,
  normalizeGoalArea,
  normalizeTaskType,
  sanitizeTaskFramework,
  type TaskFramework,
} from "./task-framework.js";

export interface ToolResult {
  output: string;
  action?: ActionLabel;
}

export const toolSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_prayer_times",
      description:
        "Fetch live calculated prayer start times from AlAdhan. Use whenever the user asks for prayer, salah, salat, Fajr, Dhuhr, Asr, Maghrib, or Isha times. Omit coordinates to use Ledger's saved default. This is read-only and must not create calendar events.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date as YYYY-MM-DD. Omit to use today in Ledger's timezone." },
          latitude: { type: "number", description: "Optional latitude. Omit to use the saved default." },
          longitude: { type: "number", description: "Optional longitude. Omit to use the saved default." },
          method: { type: "number", description: "Optional AlAdhan calculation method ID. Omit to use the saved default." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_commitment",
      description:
        "Record a specific task only after review_consistency. Assign exactly one Goal Area and one Task Type. Fill the shared waiting_on and next_action fields whenever they are known, plus the fields appropriate to the chosen type. If action, outcome, owner, or intended existing record is vague, ask one concise operational question first.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Start with a verb: 'Send the signed MSA to Zenith Pay'." },
          task_type: {
            type: "string",
            enum: [...TASK_TYPES],
            description: "Exactly one task framework: call, email, text, meeting, follow_up, review, approve, research, prepare, delegate, recap, decision, document, reminder, or personal.",
          },
          goal_area: { type: "string", enum: [...GOAL_AREAS], description: "The single Goal Area this work advances." },
          due_on: { type: "string", description: "YYYY-MM-DD. Resolve relative dates against the current date given to you." },
          due_time: { type: "string", description: "Optional 24-hour time as HH:mm." },
          priority: { type: "string", enum: ["low", "normal", "high"] },
          owner: { type: "string", description: "Who owns completion. Use 'me' for the Ledger owner." },
          waiting_on: { type: "string", description: "Person, organization, approval, document, or response blocking progress. Empty when not blocked." },
          next_action: { type: "string", description: "The next concrete physical action." },
          contact: {
            type: "object",
            properties: {
              name: { type: "string" }, company: { type: "string" }, phone: { type: "string" }, email: { type: "string" },
            },
          },
          framework: {
            type: "object",
            description: "Type-specific JSON. Use only fields relevant to task_type, such as call_purpose/talking_points for calls, agenda/decisions/action_items for meetings, subject/message_needed for email, findings for review/research, or options/pros/cons for a decision.",
          },
          entity: { type: "string", description: "Person, organization, project, topic, or area this concerns, if named." },
          entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
          detail: { type: "string", description: "Context worth keeping." },
          items: {
            type: "array",
            description: "Structured members of one repeated-work batch. Use this instead of creating one commitment per agent, vendor, file, location, code, or other repeated item.",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Specific batch member or deliverable." },
                due_on: { type: "string", description: "Optional item date as YYYY-MM-DD." },
                detail: { type: "string" },
              },
              required: ["title"],
            },
          },
        },
        required: ["title", "task_type", "goal_area"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_event",
      description: "Put something on the calendar: a call, meeting, regulator deadline, travel, go-live date.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          starts_at: { type: "string", description: "YYYY-MM-DDTHH:mm, or YYYY-MM-DD for all day." },
          ends_at: { type: "string" },
          location: { type: "string" },
          entity: { type: "string", description: "Person, organization, project, topic, or area this concerns." },
          entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
          detail: { type: "string" },
        },
        required: ["title", "starts_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_commitment",
      description:
        "Change an existing open commitment: rename it, reschedule it, remove its due date, change priority, direction, context, or related subject. Use instead of creating a replacement.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Distinctive words from the current commitment title." },
          title: { type: "string" },
          due_on: { type: "string", description: "New due date as YYYY-MM-DD." },
          clear_due: { type: "boolean", description: "True only when the user explicitly removes the due date." },
          priority: { type: "string", enum: ["low", "normal", "high"] },
          task_type: { type: "string", enum: [...TASK_TYPES] },
          goal_area: { type: "string", enum: [...GOAL_AREAS] },
          due_time: { type: "string", description: "New 24-hour time as HH:mm." },
          clear_due_time: { type: "boolean" },
          owner: { type: "string" },
          waiting_on: { type: "string" },
          next_action: { type: "string" },
          contact: { type: "object", properties: { name: { type: "string" }, company: { type: "string" }, phone: { type: "string" }, email: { type: "string" } } },
          framework: { type: "object", description: "Fields for the selected task_type." },
          entity: { type: "string" },
          entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
          detail: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal",
      description:
        "Change an existing active goal: rename it, move its target date, remove its target date, change priority, definition of success, or related subject.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Distinctive words from the current goal title." },
          title: { type: "string" },
          target_on: { type: "string", description: "New target date as YYYY-MM-DD." },
          clear_target: { type: "boolean" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
          goal_area: { type: "string", enum: [...GOAL_AREAS] },
          entity: { type: "string" },
          entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
          detail: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "Change an existing calendar event: rename, reschedule, change its end, location, context, or related subject. Use instead of creating a second event.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Distinctive words from the current event title." },
          title: { type: "string" },
          starts_at: { type: "string", description: "New YYYY-MM-DDTHH:mm, or YYYY-MM-DD for all day." },
          ends_at: { type: "string" },
          location: { type: "string" },
          entity: { type: "string" },
          entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
          detail: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_event",
      description:
        "Remove a calendar event only when the user explicitly says to cancel, delete, or remove it. The original captured instruction remains in Ledger history.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Distinctive words from the event title." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_entity",
      description:
        "Create or update a connected memory subject: a person, organization, project, topic, personal/professional area, or supported business-specific entity. Safe to call repeatedly because it updates rather than duplicates. Call this whenever an important named subject appears.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ENTITY_KINDS] },
          name: { type: "string" },
          country: { type: "string", description: "ISO name or common country name." },
          status: {
            type: "string",
            enum: ["prospect", "negotiating", "contracted", "live", "paused", "archived", "active"],
          },
          meta: {
            type: "object",
            description: "Small structured extras: role, relationship, category, stage, course, skill level, or other useful context.",
          },
        },
        required: ["kind", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_fact",
      description:
        "Attach durable knowledge to a person, organization, project, topic, or area: a lesson, preference, decision, insight, agreement, reason, or useful context. Use whenever the information belongs to a named subject.",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", description: "Who or what this is about." },
          entity_kind: { type: "string", enum: [...ENTITY_KINDS] },
          label: { type: "string", description: "Short header, e.g. 'Lesson learned', 'Preference', or 'Decision'." },
          body: { type: "string", description: "The detail, cleaned up but complete." },
        },
        required: ["entity", "label", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Search past captures and recorded facts. Matches whole words only, since stored text is encrypted. Always search before answering a question about what was said, agreed or promised.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entity",
      description: "Pull everything known about a person, organization, project, topic, or area: status, metadata and recent facts.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, kind: { type: "string", enum: [...ENTITY_KINDS] } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_entities",
      description: "List connected memory subjects by kind and optionally country. Use for questions about people, organizations, projects, topics, or areas.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ENTITY_KINDS] },
          country: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "review_consistency",
      description:
        "Inspect Calendar and Feed records before creating or changing a task, goal, or event, and whenever the user asks for inconsistencies. Returns calendar events, open tasks and promises, active goals, overdue work, unscheduled work, and possible time overlaps. Call this before any add or update tool.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Relevant range start as YYYY-MM-DD. Defaults to today." },
          to: { type: "string", description: "Relevant range end as YYYY-MM-DD. Defaults to 14 days after from." },
          query: { type: "string", description: "Optional distinctive subject words used to narrow related tasks and goals. Calendar events in the date range are always included so time conflicts remain visible." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_agenda",
      description: "Calendar and open commitments for a date range, including overdue and what others owe. Use for 'what's today', 'what am I forgetting', 'what am I waiting on'.",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_commitment",
      description: "Mark a commitment done when the user says it is finished, sent, sorted or cancelled.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_goals",
      description: "List active goals. Use when the user asks about goals, outcomes, priorities, or what they are working toward.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_goal",
      description: "Archive a goal when the user says it is achieved, no longer relevant, or should be removed from the active goals feed.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_feed_and_calendar",
      description:
        "Permanently delete every commitment, including completed or archived commitments and their batch items, plus every calendar event. Goals, memory, source notes, and chat are preserved. Call only when the user's latest message is exactly 'CLEAR FEED AND CALENDAR'. The operation is transactional and can be undone from Changes made.",
      parameters: {
        type: "object",
        properties: {
          confirmation: { type: "string", description: "Must be exactly CLEAR FEED AND CALENDAR." },
        },
        required: ["confirmation"],
      },
    },
  },
];

/* ------------------------------------------------------------ coercion */

function asObject(args: unknown): Record<string, any> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return (args as Record<string, any>) || {};
}

function frameworkFromArgs(args: Record<string, any>): TaskFramework {
  const framework = args.framework && typeof args.framework === "object" && !Array.isArray(args.framework)
    ? { ...args.framework }
    : {};
  if (args.contact && typeof args.contact === "object" && !Array.isArray(args.contact)) framework.contact = args.contact;
  if (Object.hasOwn(args, "waiting_on")) framework.waiting_on = String(args.waiting_on || "");
  if (Object.hasOwn(args, "next_action")) framework.next_action = String(args.next_action || "");
  return framework;
}

function vagueCommitmentTitle(value: unknown): boolean {
  const title = String(value || "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
  if (!title || title.split(" ").length < 2) return true;
  if (/^(follow up|handle this|handle it|do this|do it|take care of it|work on it|review it|check it|task|todo)$/.test(title)) return true;
  return /\b(it|this|that|thing|things|stuff|something)$/.test(title);
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fallback for when the model passes a relative date despite instructions. */
function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const localStamp = raw.match(/^(\d{4}-\d{2}-\d{2})[ t](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (localStamp) {
    const hour = Number(localStamp[2]);
    const minute = Number(localStamp[3]);
    if (hour <= 23 && minute <= 59) {
      return `${localStamp[1]}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(raw)) return value.trim().slice(0, 16);
  if (raw === "today") return todayISO();
  if (raw === "tomorrow") return addDays(todayISO(), 1);
  const inDays = raw.match(/^in (\d+) days?$/);
  if (inDays) return addDays(todayISO(), Number(inDays[1]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 16);
}

function eventInstant(value: string, allDay: boolean): string {
  return allDay ? `${value.slice(0, 10)}T12:00:00.000Z` : zonedDateTimeToUtc(value, config.timezone);
}

function eventTimeLabel(event: store.CalEvent): string {
  return event.allDay ? event.startsAt.slice(0, 10) : zonedNowLabel(new Date(event.startsAt), config.timezone);
}

const PRAYER_EVENT_TITLE = /\b(fajr|sunrise|dhuhr|duhr|zuhr|zohar|asr|maghrib|isha|jum'?ah|jumu'?ah|khutbah)\b/i;
const PRAYER_BOARD_TITLE = /\b(fajr|sunrise|dhuhr|duhr|zuhr|zohar|asr|maghrib|isha)\s+(?:adhan|athan|iqamah|prayer)\b/i;

function adjustedPrayerEventStart(title: string, startsAt: string): string {
  const match = startsAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return startsAt;
  let hour = Number(match[2]);
  const lower = title.toLowerCase();
  if (/\b(dhuhr|duhr|zuhr|zohar)\b/.test(lower) && hour >= 1 && hour <= 10) hour += 12;
  if (/\basr\b/.test(lower) && hour >= 1 && hour <= 11) hour += 12;
  if (/\b(maghrib|isha)\b/.test(lower) && hour >= 1 && hour <= 11) hour += 12;
  return `${match[1]}T${String(hour).padStart(2, "0")}:${match[3]}`;
}

function looksLikeReferencePrayerBoard(title: string, detail: unknown, location: unknown): boolean {
  const text = [title, detail, location].filter(Boolean).join(" ");
  return PRAYER_BOARD_TITLE.test(text) || /\b(adhan|athan|iqamah|calculation method|masjid|prayer times)\b/i.test(text) && PRAYER_EVENT_TITLE.test(text);
}

function mutationMiss(kind: string, query: unknown, matches: string[]): ToolResult {
  if (!matches.length) return { output: `No ${kind} matched "${String(query || "")}". Ask for a different title.` };
  return {
    output: `More than one ${kind} matched "${String(query || "")}": ${matches.join("; ")}. Ask which one before changing anything.`,
  };
}

/** Entity references arrive as bare names; resolve to an id, creating if new. */
async function resolveEntity(name: unknown, kindHint?: EntityKind): Promise<store.Entity | null> {
  if (typeof name !== "string" || !name.trim()) return null;
  const safeKind = (ENTITY_KINDS as readonly string[]).includes(String(kindHint)) ? kindHint : undefined;
  const exact = await store.findEntityExact(name.trim());
  if (exact) return exact;
  const existing = await store.findEntity(name.trim(), safeKind);
  if (existing) return existing;
  return store.upsertEntity({ kind: safeKind || "person", name: name.trim() });
}

/* ------------------------------------------------------------ dispatch */

export async function runTool(
  name: string,
  rawArgs: unknown,
  entryId: number | null,
  context: { userMessage?: string } = {},
): Promise<ToolResult> {
  const args = asObject(rawArgs);

  switch (name) {
    case "clear_feed_and_calendar": {
      const confirmation = String(args.confirmation || "").trim();
      const userConfirmation = String(context.userMessage || "").trim();
      if (confirmation !== "CLEAR FEED AND CALENDAR" || userConfirmation !== "CLEAR FEED AND CALENDAR") {
        return {
          output: "Nothing was removed. Ask the user to send exactly: CLEAR FEED AND CALENDAR. Explain that this deletes all commitments and calendar events but preserves goals, memory, source notes, and chat.",
        };
      }
      const removed = await store.clearFeedAndCalendar();
      return {
        output: `Removed ${removed.commitments} commitments and ${removed.events} calendar events. Goals, memory, source notes, and chat were preserved. The removal can be undone from Changes made.`,
        action: { label: `Cleared Feed (${removed.commitments}) and Calendar (${removed.events})` },
      };
    }

    case "get_prayer_times": {
      try {
        const snapshot = await cachedOrFreshPrayerTimes({
          date: typeof args.date === "string" ? args.date : undefined,
          latitude: typeof args.latitude === "number" ? args.latitude : undefined,
          longitude: typeof args.longitude === "number" ? args.longitude : undefined,
          method: typeof args.method === "number" ? args.method : undefined,
        });
        return { output: prayerTimesToolOutput(snapshot.result, snapshot.fetchedAt) };
      } catch (error) {
        return { output: `Prayer-time lookup failed: ${(error as Error).message}` };
      }
    }

    case "add_commitment": {
      if (vagueCommitmentTitle(args.title)) {
        return {
          output: "No task was created because the request is too vague. Ask one concise operational question for the missing action or object, such as what should be reviewed, sent, completed, or followed up.",
        };
      }
      const entity = await resolveEntity(args.entity, args.entity_kind as EntityKind);
      const dueOn = normalizeDate(args.due_on)?.slice(0, 10);
      const taskType = normalizeTaskType(args.task_type);
      const goalArea = normalizeGoalArea(args.goal_area);
      const dueTime = /^\d{2}:\d{2}$/.test(String(args.due_time || "")) ? String(args.due_time) : undefined;
      const owner = String(args.owner || "me").trim() || "me";
      const items = Array.isArray(args.items) ? args.items.slice(0, 100).map((item: any) => ({
        title: String(item?.title || "").trim(),
        detail: item?.detail ? String(item.detail) : undefined,
        dueOn: normalizeDate(item?.due_on)?.slice(0, 10),
        entryId,
      })).filter((item: any) => item.title) : [];
      const c = await store.addCommitment({
        title: String(args.title || "Untitled"),
        detail: args.detail ? String(args.detail) : undefined,
        direction: owner.toLowerCase() === "me" ? "mine" : "theirs",
        taskType,
        goalArea,
        dueOn,
        dueTime,
        priority: args.priority ? String(args.priority) : undefined,
        owner,
        framework: sanitizeTaskFramework(taskType, frameworkFromArgs(args)),
        entityId: entity?.id ?? null,
        entryId,
        items,
      });
      const taskClass = `${c.goalArea} / ${c.taskType}`;
      return {
        output: c.duplicate
          ? `Commitment #${c.id} was already open. Its details were updated: ${c.title}`
          : `${c.taskId} recorded as ${taskClass}: ${c.title}${dueOn ? ` due ${dueOn}${dueTime ? ` at ${dueTime}` : ""}` : ""}${c.waitingOn ? `; waiting on ${c.waitingOn}` : ""}${c.items.length ? ` with ${c.items.length} batch items` : ""}`,
        action: { label: `${c.duplicate ? "Task updated" : c.taskType}: ${c.title}${dueOn ? ` (${dueOn})` : ""}` },
      };
    }

    case "add_event": {
      let startsAt = normalizeDate(args.starts_at);
      if (!startsAt) return { output: "Could not read that start time. Ask for the date." };
      const title = String(args.title || "Untitled");
      startsAt = adjustedPrayerEventStart(title, startsAt);
      const entity = await resolveEntity(args.entity, args.entity_kind as EntityKind);
      const allDay = startsAt.length <= 10;
      const normalizedEnd = normalizeDate(args.ends_at);
      if (normalizedEnd && !allDay && normalizedEnd.length <= 10) {
        return { output: "Could not read the event end time. Ask for a clock time as well as the date." };
      }
      const ev = await store.addEvent({
        title,
        startsAt: eventInstant(startsAt, allDay),
        endsAt: normalizedEnd ? eventInstant(normalizedEnd, allDay) : undefined,
        allDay,
        location: args.location ? String(args.location) : undefined,
        detail: args.detail ? String(args.detail) : undefined,
        entityId: entity?.id ?? null,
        entryId,
      });
      return {
        output: `Event #${ev.id}: ${ev.title} at ${startsAt}`,
        action: { label: `Calendar: ${ev.title} (${startsAt.replace("T", " ")})` },
      };
    }

    case "update_commitment": {
      const entity = args.entity ? await resolveEntity(args.entity, args.entity_kind as EntityKind) : undefined;
      const taskType = args.task_type !== undefined ? normalizeTaskType(args.task_type) : undefined;
      const result = await store.updateCommitment(String(args.query || ""), {
        title: args.title ? String(args.title) : undefined,
        detail: args.detail !== undefined ? String(args.detail) : undefined,
        dueOn: args.due_on !== undefined ? normalizeDate(args.due_on)?.slice(0, 10) : undefined,
        clearDue: args.clear_due === true,
        dueTime: args.due_time !== undefined && /^\d{2}:\d{2}$/.test(String(args.due_time)) ? String(args.due_time) : undefined,
        clearDueTime: args.clear_due_time === true,
        priority: args.priority ? String(args.priority) : undefined,
        direction: args.direction === "theirs" ? "theirs" : args.direction === "mine" ? "mine" : undefined,
        taskType,
        goalArea: args.goal_area !== undefined ? normalizeGoalArea(args.goal_area) : undefined,
        owner: args.owner !== undefined ? String(args.owner) : undefined,
        framework: taskType || args.framework || args.contact || Object.hasOwn(args, "waiting_on") || Object.hasOwn(args, "next_action")
          ? frameworkFromArgs(args)
          : undefined,
        entityId: entity?.id,
      });
      if (!result.item) return mutationMiss("open commitment", args.query, result.matches);
      const item = result.item;
      return {
        output: `Commitment updated: ${item.title}${item.dueOn ? ` due ${item.dueOn}` : ", no due date"}`,
        action: { label: `Commitment updated: ${item.title}` },
      };
    }

    case "update_goal": {
      const entity = args.entity ? await resolveEntity(args.entity, args.entity_kind as EntityKind) : undefined;
      const result = await store.updateGoal(String(args.query || ""), {
        title: args.title ? String(args.title) : undefined,
        detail: args.detail !== undefined ? String(args.detail) : undefined,
        targetOn: args.target_on !== undefined ? normalizeDate(args.target_on)?.slice(0, 10) : undefined,
        clearTarget: args.clear_target === true,
        priority: args.priority ? String(args.priority) : undefined,
        goalArea: args.goal_area !== undefined ? normalizeGoalArea(args.goal_area) : undefined,
        entityId: entity?.id,
      });
      if (!result.item) return mutationMiss("active goal", args.query, result.matches);
      const item = result.item;
      return {
        output: `Goal updated: ${item.title}${item.targetOn ? ` target ${item.targetOn}` : ", ongoing"}`,
        action: { label: `Goal updated: ${item.title}` },
      };
    }

    case "update_event": {
      const start = args.starts_at !== undefined ? normalizeDate(args.starts_at) : undefined;
      if (args.starts_at !== undefined && !start) return { output: "Could not read the new event time. Ask for a date." };
      const entity = args.entity ? await resolveEntity(args.entity, args.entity_kind as EntityKind) : undefined;
      const allDay = start !== undefined ? start.length <= 10 : undefined;
      const normalizedEnd = args.ends_at !== undefined ? normalizeDate(args.ends_at) : undefined;
      if (args.ends_at !== undefined && args.ends_at && !normalizedEnd) {
        return { output: "Could not read the new event end time. Ask for a date and clock time." };
      }
      if (normalizedEnd && allDay === false && normalizedEnd.length <= 10) {
        return { output: "Could not read the new event end time. Ask for a clock time as well as the date." };
      }
      const result = await store.updateEvent(String(args.query || ""), {
        title: args.title ? String(args.title) : undefined,
        startsAt: start ? eventInstant(start, Boolean(allDay)) : undefined,
        endsAt: args.ends_at !== undefined ? (normalizedEnd ? eventInstant(normalizedEnd, normalizedEnd.length <= 10) : null) : undefined,
        allDay,
        location: args.location !== undefined ? String(args.location) : undefined,
        detail: args.detail !== undefined ? String(args.detail) : undefined,
        entityId: entity?.id,
      });
      if (!result.item) return mutationMiss("calendar event", args.query, result.matches);
      return {
        output: `Event updated: ${result.item.title} at ${eventTimeLabel(result.item)}`,
        action: { label: `Event updated: ${result.item.title}` },
      };
    }

    case "cancel_event": {
      const result = await store.cancelEvent(String(args.query || ""));
      if (!result.item) return mutationMiss("calendar event", args.query, result.matches);
      return {
        output: `Event cancelled: ${result.item.title}`,
        action: { label: `Event cancelled: ${result.item.title}` },
      };
    }

    case "upsert_entity": {
      const kind = (ENTITY_KINDS as readonly string[]).includes(String(args.kind))
        ? (args.kind as EntityKind)
        : "person";
      const entityName = String(args.name || "Unnamed");
      const exact = await store.findEntityExact(entityName);
      const e = exact && exact.kind !== kind
        ? exact
        : await store.upsertEntity({
          kind,
          name: entityName,
          country: args.country ? String(args.country) : undefined,
          status: args.status ? String(args.status) : undefined,
          meta: typeof args.meta === "object" && args.meta ? args.meta : undefined,
        });
      return {
        output: `Entity #${e.id}: ${e.kind} "${e.name}"${e.country ? ` in ${e.country}` : ""}, ${e.status}`,
        action: { label: `${e.kind}: ${e.name}${e.status !== "active" ? ` (${e.status})` : ""}` },
      };
    }

    case "record_fact": {
      const entity = await resolveEntity(args.entity, args.entity_kind as EntityKind);
      if (!entity) return { output: "No entity named, so nothing to attach the fact to." };
      await store.addFact({
        entityId: entity.id,
        entryId,
        label: String(args.label || "Note"),
        body: String(args.body || ""),
      });
      return {
        output: `Fact recorded against ${entity.name}: ${args.label}`,
        action: { label: `Noted for ${entity.name}: ${args.label}` },
      };
    }

    case "search": {
      const hits = await store.search(String(args.query || ""), Number(args.limit) || 8);
      if (!hits.length) return { output: `Nothing stored matches "${args.query}". Search is whole-word only.` };
      return {
        output: hits
          .map((h) => `### ${h.label} (${String(h.createdAt).slice(0, 10)})\n${h.body.slice(0, 700)}`)
          .join("\n\n"),
      };
    }

    case "get_entity": {
      const entity = await store.findEntity(String(args.name || ""), args.kind as EntityKind);
      if (!entity) return { output: `Nobody called "${args.name}" is on file yet.` };
      const facts = await store.factsFor(entity.id, 12);
      const meta = Object.keys(entity.meta).length ? `\nDetails: ${JSON.stringify(entity.meta)}` : "";
      const body = facts.length
        ? facts.map((f) => `- ${f.label} (${String(f.createdAt).slice(0, 10)}): ${f.body.slice(0, 400)}`).join("\n")
        : "No facts recorded yet.";
      return {
        output: `${entity.name}: ${entity.kind}, ${entity.status}${entity.country ? `, ${entity.country}` : ""}${meta}\n\n${body}`,
      };
    }

    case "list_entities": {
      const list = await store.listEntities(
        args.kind as EntityKind,
        args.country ? String(args.country) : undefined,
        Number(args.limit) || 40,
      );
      if (!list.length) return { output: "Nothing on file matching that." };
      return {
        output: list
          .map((e) => `- ${e.name} (${e.kind}, ${e.status}${e.country ? `, ${e.country}` : ""})`)
          .join("\n"),
      };
    }

    case "review_consistency": {
      const from = normalizeDate(args.from)?.slice(0, 10) || todayISO();
      const to = normalizeDate(args.to)?.slice(0, 10) || addDays(from, 14);
      const query = String(args.query || "").trim().toLowerCase();
      const terms = query.split(/\s+/).filter((term) => term.length > 2);
      const related = (text: string) => !terms.length || terms.some((term) => text.toLowerCase().includes(term));
      const [agenda, commitments, goals] = await Promise.all([
        store.agenda(from, to),
        store.openCommitments(300),
        store.listGoals("active", 200),
      ]);
      const relatedCommitments = commitments.filter((item) => related(
        `${item.title} ${item.detail} ${item.goalArea} ${item.taskType} ${item.waitingOn} ${item.nextAction} ${item.entityName || ""} ${item.items.map((child) => child.title).join(" ")}`,
      ));
      const relatedGoals = goals.filter((item) => related(`${item.title} ${item.detail} ${item.entityName || ""}`));
      const timedEvents = agenda.events.filter((event) => !event.allDay);
      const overlaps: string[] = [];
      for (let index = 0; index < timedEvents.length; index += 1) {
        const left = timedEvents[index];
        const leftStart = new Date(left.startsAt).getTime();
        const leftEnd = left.endsAt ? new Date(left.endsAt).getTime() : leftStart + 60 * 60 * 1000;
        for (const right of timedEvents.slice(index + 1)) {
          const rightStart = new Date(right.startsAt).getTime();
          const rightEnd = right.endsAt ? new Date(right.endsAt).getTime() : rightStart + 60 * 60 * 1000;
          if (leftStart < rightEnd && rightStart < leftEnd) overlaps.push(`${left.title} overlaps ${right.title}`);
        }
      }
      const taskLine = (item: store.Commitment) =>
        `- ${item.taskId} ${item.title} [${item.goalArea} / ${item.taskType}]${item.entityName ? ` [${item.entityName}]` : ""}${item.dueOn ? ` due ${item.dueOn}${item.dueTime ? ` ${item.dueTime}` : ""}` : " no date"}${item.priority !== "normal" ? ` ${item.priority} priority` : ""}${item.waitingOn ? `; waiting on ${item.waitingOn}` : ""}${item.nextAction ? `; next: ${item.nextAction}` : ""}${item.items.length ? `; items: ${item.items.slice(0, 12).map((child) => child.title).join(" | ")}` : ""}`;
      const eventLine = (item: store.CalEvent) =>
        `- ${item.title}${item.entityName ? ` [${item.entityName}]` : ""} at ${item.startsAt.slice(0, 16).replace("T", " ")}${item.endsAt ? ` to ${item.endsAt.slice(0, 16).replace("T", " ")}` : ""}`;
      const goalLine = (item: store.Goal) =>
        `- ${item.title} [${item.goalArea}]${item.entityName ? ` [${item.entityName}]` : ""}${item.targetOn ? ` target ${item.targetOn}` : " ongoing"}${item.priority !== "normal" ? ` ${item.priority} priority` : ""}`;
      const section = (label: string, lines: string[]) => lines.length ? `${label}:\n${lines.join("\n")}` : `${label}: none`;
      return {
        output: [
          `Consistency review ${from} to ${to}${query ? ` for "${query}"` : ""}`,
          section("Possible calendar overlaps", overlaps.slice(0, 20).map((item) => `- ${item}`)),
          section("Calendar", agenda.events.slice(0, 80).map(eventLine)),
          section("Related open tasks and promises", relatedCommitments.slice(0, 80).map(taskLine)),
          section("Related active goals", relatedGoals.slice(0, 60).map(goalLine)),
          section("Overdue", agenda.overdue.slice(0, 60).map(taskLine)),
          section("Unscheduled", agenda.unscheduled.slice(0, 60).map(taskLine)),
        ].join("\n\n"),
      };
    }

    case "get_agenda": {
      const from = normalizeDate(args.from)?.slice(0, 10) || todayISO();
      const to = normalizeDate(args.to)?.slice(0, 10) || addDays(from, 7);
      const data = await store.agenda(from, to);
      const line = (c: store.Commitment) =>
        `- ${c.taskId} ${c.title} [${c.goalArea} / ${c.taskType}]${c.entityName ? ` [${c.entityName}]` : ""}${c.dueOn ? ` due ${c.dueOn}${c.dueTime ? ` ${c.dueTime}` : ""}` : ""}${c.waitingOn ? ` (waiting on ${c.waitingOn})` : c.direction === "theirs" ? " (they owe)" : ""}${c.nextAction ? `; next: ${c.nextAction}` : ""}`;
      const section = (label: string, items: string[]) =>
        items.length ? `${label}:\n${items.join("\n")}` : `${label}: none`;
      return {
        output: [
          `Agenda ${from} → ${to}`,
          section(
            "Events",
            data.events.map(
              (e) => `- ${e.title}${e.entityName ? ` [${e.entityName}]` : ""} at ${e.startsAt.slice(0, 16).replace("T", " ")}`,
            ),
          ),
          section("Due", data.due.map(line)),
          section("Overdue", data.overdue.map(line)),
          section("Open, no date", data.unscheduled.slice(0, 20).map(line)),
        ].join("\n\n"),
      };
    }

    case "close_commitment": {
      const result = await store.completeCommitment(String(args.query || ""));
      if (!result.item) return mutationMiss("open commitment", args.query, result.matches);
      return { output: `Closed: ${result.item.title}`, action: { label: `Done: ${result.item.title}` } };
    }

    case "list_goals": {
      const goals = await store.listGoals("active", 100);
      if (!goals.length) return { output: "No active goals are on file." };
      return {
        output: goals
          .map((goal) => `- ${goal.title} [${goal.goalArea}]${goal.targetOn ? ` target ${goal.targetOn}` : ""}${goal.entityName ? ` [${goal.entityName}]` : ""}`)
          .join("\n"),
      };
    }

    case "archive_goal": {
      const result = await store.archiveMatchingGoal(String(args.query || ""));
      if (!result.item) return mutationMiss("active goal", args.query, result.matches);
      return { output: `Goal archived: ${result.item.title}`, action: { label: `Goal archived: ${result.item.title}` } };
    }

    default:
      return { output: `Unknown tool: ${name}` };
  }
}
