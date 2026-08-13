import type { CalEvent, Commitment } from "./store.js";
import { config } from "./config.js";

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function compactDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, "");
}

function nextDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function compactUtc(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line: string): string[] {
  const result: string[] = [];
  let remaining = line;
  while (Buffer.byteLength(remaining, "utf8") > 73) {
    let cut = Math.min(73, remaining.length);
    while (cut > 1 && Buffer.byteLength(remaining.slice(0, cut), "utf8") > 73) cut -= 1;
    result.push(remaining.slice(0, cut));
    remaining = ` ${remaining.slice(cut)}`;
  }
  result.push(remaining);
  return result;
}

function eventLines(event: CalEvent, stamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:event-${event.id}@ledger.local`, `DTSTAMP:${stamp}`];
  if (event.allDay) {
    const start = event.startsAt.slice(0, 10);
    const end = event.endsAt?.slice(0, 10) || nextDate(start);
    lines.push(`DTSTART;VALUE=DATE:${compactDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(end <= start ? nextDate(start) : end)}`);
  } else {
    lines.push(`DTSTART:${compactUtc(event.startsAt)}`);
    if (event.endsAt) lines.push(`DTEND:${compactUtc(event.endsAt)}`);
  }
  lines.push(`SUMMARY:${escapeIcs(event.title)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
  if (event.entityName) lines.push(`DESCRIPTION:${escapeIcs(`Ledger memory: ${event.entityName}`)}`);
  lines.push("CATEGORIES:Ledger Event", "STATUS:CONFIRMED", "END:VEVENT");
  return lines;
}

function commitmentLines(commitment: Commitment, stamp: string): string[] {
  const due = commitment.dueOn!;
  const description = [
    commitment.detail,
    commitment.entityName ? `Related to: ${commitment.entityName}` : "",
    commitment.waitingOn ? `Waiting on: ${commitment.waitingOn}` : commitment.direction === "theirs" ? "Waiting on someone else" : "Open Ledger commitment",
  ].filter(Boolean).join("\n");
  return [
    "BEGIN:VEVENT",
    `UID:commitment-${commitment.id}@ledger.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(due)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDate(due))}`,
    `SUMMARY:${escapeIcs(commitment.title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "CATEGORIES:Ledger Commitment",
    "TRANSP:TRANSPARENT",
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ];
}

export function buildCalendarIcs(events: CalEvent[], commitments: Commitment[]): string {
  const stamp = compactUtc(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ledger//Private Memory Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Ledger",
    `X-WR-TIMEZONE:${escapeIcs(config.timezone)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((event) => eventLines(event, stamp)),
    ...commitments.filter((item) => item.dueOn).flatMap((item) => commitmentLines(item, stamp)),
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}
