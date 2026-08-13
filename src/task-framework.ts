export const GOAL_AREAS = [
  "company",
  "digital",
  "compliance",
  "agents",
  "partners",
  "banking",
  "growth",
  "team",
  "personal_finance",
  "personal_health_family",
] as const;

export type GoalArea = typeof GOAL_AREAS[number];

export const TASK_TYPES = [
  "call",
  "email",
  "text",
  "meeting",
  "follow_up",
  "review",
  "approve",
  "research",
  "prepare",
  "delegate",
  "recap",
  "decision",
  "document",
  "reminder",
  "personal",
] as const;

export type TaskType = typeof TASK_TYPES[number];
export type TaskFieldKind = "text" | "textarea" | "date" | "time" | "boolean" | "list" | "select";

export interface TaskFieldDefinition {
  key: string;
  label: string;
  kind: TaskFieldKind;
  placeholder?: string;
  options?: string[];
}

export type TaskFramework = Record<string, unknown> & {
  contact?: { name?: string; company?: string; phone?: string; email?: string };
  waiting_on?: string;
  next_action?: string;
};

const field = (
  key: string,
  label: string,
  kind: TaskFieldKind = "text",
  placeholder?: string,
  options?: string[],
): TaskFieldDefinition => ({ key, label, kind, ...(placeholder ? { placeholder } : {}), ...(options ? { options } : {}) });

export const COMMON_TASK_FIELDS: TaskFieldDefinition[] = [
  field("contact.name", "Contact name"),
  field("contact.company", "Company"),
  field("contact.phone", "Phone"),
  field("contact.email", "Email"),
  field("reason", "Reason", "textarea", "Why this task matters"),
  field("waiting_on", "Waiting on", "text", "Person, company, approval, document, or response"),
  field("next_action", "Next action", "text", "The next physical action"),
  field("follow_up_date", "Follow-up date", "date"),
  field("notes", "Notes", "textarea"),
  field("result", "Result", "textarea"),
  field("recap", "Recap", "textarea"),
];

export const TASK_TYPE_FIELDS: Record<TaskType, TaskFieldDefinition[]> = {
  call: [
    field("call_purpose", "Call purpose", "textarea"),
    field("talking_points", "Talking points", "list", "One point per line"),
    field("call_recap", "Call recap", "textarea"),
    field("decision", "Decision", "textarea"),
  ],
  email: [
    field("subject", "Subject"),
    field("purpose", "Purpose", "textarea"),
    field("message_needed", "Message needed", "textarea"),
    field("sent", "Sent", "boolean"),
    field("response_received", "Response received", "boolean"),
    field("response_recap", "Response recap", "textarea"),
  ],
  text: [
    field("channel", "Channel", "select", undefined, ["SMS", "WhatsApp", "Signal", "Teams", "Slack", "Other"]),
    field("purpose", "Purpose", "textarea"),
    field("message_needed", "Message needed", "textarea"),
    field("sent", "Sent", "boolean"),
    field("response_received", "Response received", "boolean"),
    field("response_recap", "Response recap", "textarea"),
  ],
  meeting: [
    field("meeting_with", "Meeting with", "list", "One person per line"),
    field("purpose", "Purpose", "textarea"),
    field("agenda", "Agenda", "list", "One item per line"),
    field("meeting_location", "Location or link"),
    field("meeting_recap", "Meeting recap", "textarea"),
    field("decisions", "Decisions", "list", "One decision per line"),
    field("action_items", "Action items", "list", "One action per line"),
    field("next_meeting", "Next meeting", "date"),
  ],
  follow_up: [
    field("original_topic", "Original topic", "textarea"),
    field("last_contact_date", "Last contact date", "date"),
    field("follow_up_method", "Method", "select", undefined, ["call", "email", "text", "meeting"]),
  ],
  review: [
    field("item_to_review", "Item to review"),
    field("document_link", "Document link"),
    field("questions", "Questions", "list", "One question per line"),
    field("findings", "Findings", "list", "One finding per line"),
    field("decision", "Decision", "textarea"),
  ],
  approve: [
    field("item_to_approve", "Item to approve"),
    field("approval_criteria", "Approval criteria", "list", "One criterion per line"),
    field("decision", "Approval decision", "textarea"),
    field("reason_for_decision", "Reason for decision", "textarea"),
  ],
  research: [
    field("research_question", "Research question", "textarea"),
    field("sources", "Sources", "list", "One source per line"),
    field("findings", "Findings", "list", "One finding per line"),
    field("recommendation", "Recommendation", "textarea"),
  ],
  prepare: [
    field("deliverable", "Deliverable"),
    field("requirements", "Requirements", "list", "One requirement per line"),
    field("inputs", "Inputs needed", "list", "One input per line"),
  ],
  delegate: [
    field("delegated_task", "Delegated task", "textarea"),
    field("assigned_to", "Assigned to"),
    field("expected_result", "Expected result", "textarea"),
    field("check_in_date", "Check-in date", "date"),
    field("delegation_status", "Delegation status", "select", undefined, ["not_assigned", "assigned", "in_progress", "blocked", "done"]),
  ],
  recap: [
    field("recap_subject", "Recap subject"),
    field("key_points", "Key points", "list", "One point per line"),
    field("decisions", "Decisions", "list", "One decision per line"),
    field("action_items", "Action items", "list", "One action per line"),
  ],
  decision: [
    field("decision_needed", "Decision needed", "textarea"),
    field("options", "Options", "list", "One option per line"),
    field("pros", "Pros", "list", "One advantage per line"),
    field("cons", "Cons", "list", "One disadvantage per line"),
    field("deadline", "Decision deadline", "date"),
    field("decision", "Decision", "textarea"),
    field("reason_for_decision", "Reason for decision", "textarea"),
  ],
  document: [
    field("document_name", "Document name"),
    field("audience", "Audience"),
    field("purpose", "Purpose", "textarea"),
    field("document_link", "Document link"),
    field("document_status", "Document status", "select", undefined, ["not_started", "draft", "review", "final", "sent"]),
  ],
  reminder: [
    field("reminder_for", "Reminder for", "textarea"),
    field("recurring", "Recurring", "boolean"),
    field("frequency", "Frequency"),
  ],
  personal: [
    field("personal_category", "Personal category", "select", undefined, ["health", "family", "finance", "home", "faith", "learning", "other"]),
    field("recurring", "Recurring", "boolean"),
    field("frequency", "Frequency"),
  ],
};

const titleLabel = (value: string): string => value
  .split("_")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

export function normalizeGoalArea(value: unknown): GoalArea {
  return (GOAL_AREAS as readonly unknown[]).includes(value) ? value as GoalArea : "company";
}

export function normalizeTaskType(value: unknown): TaskType {
  if ((TASK_TYPES as readonly unknown[]).includes(value)) return value as TaskType;
  if (value === "waiting") return "follow_up";
  if (value === "action") return "prepare";
  return "prepare";
}

function getPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, input);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function cleanField(fieldDef: TaskFieldDefinition, value: unknown): unknown {
  if (fieldDef.kind === "boolean") return value === true;
  if (fieldDef.kind === "list") {
    const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|\s*;\s*/) : [];
    return values.map((item) => String(item).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 100);
  }
  const text = String(value || "").trim().slice(0, fieldDef.kind === "textarea" ? 10000 : 1000);
  if (fieldDef.kind === "date" && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  if (fieldDef.kind === "time" && text && !/^\d{2}:\d{2}$/.test(text)) return "";
  if (fieldDef.kind === "select" && text && fieldDef.options && !fieldDef.options.includes(text)) return "";
  return text;
}

export function sanitizeTaskFramework(taskType: TaskType, raw: unknown): TaskFramework {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  for (const fieldDef of [...COMMON_TASK_FIELDS, ...TASK_TYPE_FIELDS[taskType]]) {
    setPath(result, fieldDef.key, cleanField(fieldDef, getPath(source, fieldDef.key)));
  }
  return result as TaskFramework;
}

export function taskFrameworkCatalog(): object {
  return {
    goalAreas: GOAL_AREAS.map((value) => ({ value, label: titleLabel(value) })),
    taskTypes: TASK_TYPES.map((value) => ({ value, label: titleLabel(value) })),
    commonFields: COMMON_TASK_FIELDS,
    typeFields: TASK_TYPE_FIELDS,
  };
}
