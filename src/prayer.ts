import { config } from "./config.js";
import { zonedNowLabel } from "./time.js";
import fs from "node:fs";
import path from "node:path";

const PRAYER_API = "https://api.aladhan.com/v1/timings";
const TIME_NAMES = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;

export interface PrayerTimesRequest {
  date?: string;
  latitude?: number;
  longitude?: number;
  method?: number;
}

export interface PrayerTimes {
  date: string;
  readableDate: string;
  hijriDate: string;
  timezone: string;
  method: string;
  methodId?: number;
  latitude: number;
  longitude: number;
  timings: Record<(typeof TIME_NAMES)[number], string>;
}

export interface PrayerTimesSnapshot {
  fetchedAt: string;
  result: PrayerTimes;
}

function todayInLedgerTimezone(): string {
  return zonedNowLabel(new Date(), config.timezone).slice(0, 10);
}

function cacheFile(): string {
  return path.join(config.dataDir, "prayer-times.json");
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function apiDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

function cleanTime(value: unknown): string {
  const match = String(value || "").match(/\b([01]\d|2[0-3]):[0-5]\d\b/);
  if (!match) throw new Error("The prayer-time service returned an unreadable time.");
  return match[0];
}

export function buildPrayerTimesUrl(request: Required<Pick<PrayerTimesRequest, "date" | "latitude" | "longitude">> & Pick<PrayerTimesRequest, "method">): string {
  const url = new URL(`${PRAYER_API}/${apiDate(request.date)}`);
  url.searchParams.set("latitude", String(request.latitude));
  url.searchParams.set("longitude", String(request.longitude));
  if (request.method !== undefined) url.searchParams.set("method", String(request.method));
  return url.toString();
}

export function parsePrayerTimesResponse(
  payload: any,
  request: Required<Pick<PrayerTimesRequest, "date" | "latitude" | "longitude">> & Pick<PrayerTimesRequest, "method">,
): PrayerTimes {
  if (Number(payload?.code) !== 200 || !payload?.data?.timings) {
    const message = typeof payload?.data === "string" ? payload.data : payload?.status;
    throw new Error(message || "Prayer times were not available for that location and date.");
  }
  const data = payload.data;
  const timings = Object.fromEntries(TIME_NAMES.map((name) => [name, cleanTime(data.timings[name])])) as PrayerTimes["timings"];
  const hijri = data.date?.hijri;
  const hijriDate = [hijri?.day, hijri?.month?.en, hijri?.year].filter(Boolean).join(" ");
  return {
    date: request.date,
    readableDate: String(data.date?.readable || request.date),
    hijriDate,
    timezone: String(data.meta?.timezone || "local time"),
    method: String(data.meta?.method?.name || "service default"),
    methodId: finiteNumber(data.meta?.method?.id) ?? request.method,
    latitude: request.latitude,
    longitude: request.longitude,
    timings,
  };
}

export async function getPrayerTimes(request: PrayerTimesRequest = {}): Promise<PrayerTimes> {
  const date = request.date || todayInLedgerTimezone();
  if (!validIsoDate(date)) throw new Error("Use a valid prayer date in YYYY-MM-DD format.");

  const latitude = finiteNumber(request.latitude ?? config.prayerLatitude);
  const longitude = finiteNumber(request.longitude ?? config.prayerLongitude);
  const method = finiteNumber(request.method ?? config.prayerMethod);
  if (latitude === undefined || longitude === undefined) {
    throw new Error("No default prayer location is configured. Ask for latitude and longitude, or set PRAYER_LATITUDE and PRAYER_LONGITUDE in Ledger settings.");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("Prayer coordinates are outside the valid latitude or longitude range.");
  }
  if (method !== undefined && (!Number.isInteger(method) || method < 0 || method > 99)) {
    throw new Error("Prayer calculation method must be a whole number from 0 to 99.");
  }

  const normalized = { date, latitude, longitude, method };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(buildPrayerTimesUrl(normalized), {
      headers: { Accept: "application/json", "User-Agent": "Ledger/2.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Prayer-time service returned HTTP ${response.status}.`);
    return parsePrayerTimesResponse(await response.json(), normalized);
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("The prayer-time service did not answer within 10 seconds. No Ledger data was changed.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getCachedPrayerTimes(): PrayerTimesSnapshot | null {
  try {
    const snapshot = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as PrayerTimesSnapshot;
    if (!snapshot?.fetchedAt || !snapshot?.result?.date || !snapshot.result.timings) return null;
    for (const name of TIME_NAMES) cleanTime(snapshot.result.timings[name]);
    return snapshot;
  } catch {
    return null;
  }
}

function cacheMatches(snapshot: PrayerTimesSnapshot, request: PrayerTimesRequest): boolean {
  const date = request.date || todayInLedgerTimezone();
  const latitude = finiteNumber(request.latitude ?? config.prayerLatitude);
  const longitude = finiteNumber(request.longitude ?? config.prayerLongitude);
  const method = finiteNumber(request.method ?? config.prayerMethod);
  return snapshot.result.date === date
    && snapshot.result.latitude === latitude
    && snapshot.result.longitude === longitude
    && (method === undefined || snapshot.result.methodId === method);
}

export async function refreshPrayerTimes(request: PrayerTimesRequest = {}): Promise<PrayerTimesSnapshot> {
  const result = await getPrayerTimes(request);
  const snapshot = { fetchedAt: new Date().toISOString(), result };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(cacheFile(), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  return snapshot;
}

export async function cachedOrFreshPrayerTimes(request: PrayerTimesRequest = {}): Promise<PrayerTimesSnapshot> {
  const cached = getCachedPrayerTimes();
  return cached && cacheMatches(cached, request) ? cached : refreshPrayerTimes(request);
}

export function prayerTimesSettings(): {
  configured: boolean;
  latitude?: number;
  longitude?: number;
  method?: number;
  snapshot: PrayerTimesSnapshot | null;
} {
  return {
    configured: config.prayerLatitude !== undefined && config.prayerLongitude !== undefined,
    latitude: config.prayerLatitude,
    longitude: config.prayerLongitude,
    method: config.prayerMethod,
    snapshot: getCachedPrayerTimes(),
  };
}

let schedulerStarted = false;

/** Refresh once per Ledger-local day. The hourly check survives restarts without relying on system cron. */
export function startPrayerTimesScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const run = async () => {
    if (config.prayerLatitude === undefined || config.prayerLongitude === undefined) return;
    const cached = getCachedPrayerTimes();
    if (cached?.result.date === todayInLedgerTimezone()) return;
    await refreshPrayerTimes();
  };
  const timer = setInterval(
    () => void run().catch((error) => console.error(`  Prayer ${(error as Error).message}`)),
    60 * 60_000,
  );
  timer.unref();
  void run().catch((error) => console.error(`  Prayer ${(error as Error).message}`));
}

export function prayerTimesToolOutput(result: PrayerTimes, fetchedAt?: string): string {
  const lines = TIME_NAMES.map((name) => `${name}: ${result.timings[name]}`);
  return [
    `Prayer times for the saved location on ${result.readableDate}${result.hijriDate ? ` (${result.hijriDate})` : ""}:`,
    ...lines,
    `Timezone: ${result.timezone}. Calculation method: ${result.method}.`,
    fetchedAt ? `Refreshed: ${fetchedAt}.` : "",
    "These are calculated prayer start times, not a local mosque's iqamah times. No calendar events were created.",
  ].filter(Boolean).join("\n");
}
