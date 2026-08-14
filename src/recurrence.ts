export const RECURRENCE_FREQUENCIES = ["none", "daily", "weekly", "monthly", "quarterly"] as const;

export type RecurrenceFrequency = typeof RECURRENCE_FREQUENCIES[number];

export function normalizeRecurrence(value: unknown): RecurrenceFrequency {
  const candidate = String(value || "none").toLowerCase();
  return (RECURRENCE_FREQUENCIES as readonly string[]).includes(candidate)
    ? candidate as RecurrenceFrequency
    : "none";
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid due date for a recurring task.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Use a valid due date for a recurring task.");
  }
  return date;
}

function isoDate(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function nextRecurrenceDate(
  dueOn: string,
  recurrence: Exclude<RecurrenceFrequency, "none">,
  anchorOn = dueOn,
): string {
  const due = parseIsoDate(dueOn);
  if (recurrence === "daily" || recurrence === "weekly") {
    due.setUTCDate(due.getUTCDate() + (recurrence === "daily" ? 1 : 7));
    return due.toISOString().slice(0, 10);
  }

  const anchor = parseIsoDate(anchorOn);
  const months = recurrence === "monthly" ? 1 : 3;
  const targetMonth = due.getUTCMonth() + months;
  const targetYear = due.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  return isoDate(targetYear, normalizedMonth, anchor.getUTCDate());
}
