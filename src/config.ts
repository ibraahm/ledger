import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// PM2 may launch the process from a directory other than the application root.
// Resolve all local paths from this module so secrets and data never depend on cwd.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");
loadEnv({ path: envPath });

function projectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/**
 * DATABASE_URL unset -> embedded PGlite at DATA_DIR (zero setup, single user).
 * DATABASE_URL set    -> real Postgres. Same SQL either way.
 */
export const config = {
  envPath,
  databaseUrl: process.env.DATABASE_URL || "",
  dataDir: projectPath(process.env.DATA_DIR || "./data"),

  ollamaHost: (process.env.OLLAMA_HOST || "https://ollama.com").replace(/\/+$/, ""),
  ollamaApiKey: process.env.OLLAMA_API_KEY || "",
  model: process.env.OLLAMA_MODEL || "gpt-oss:120b",
  fastModel: process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_MODEL || "gpt-oss:120b",
  reviewModel: process.env.OLLAMA_REVIEW_MODEL || process.env.OLLAMA_MODEL || "gpt-oss:120b",
  ollamaTimeoutMs: Math.max(5_000, Number(process.env.OLLAMA_TIMEOUT_MS || 45_000)),
  ollamaRetries: Math.min(3, Math.max(0, Number(process.env.OLLAMA_RETRIES || 2))),

  /** 32-byte hex. Encrypts note bodies at rest. No key, no read. */
  masterKey: process.env.MASTER_KEY || "",
  /** scrypt hash of your password, created at setup or changed in Settings. */
  passwordHash: process.env.PASSWORD_HASH || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  sessionDays: Number(process.env.SESSION_DAYS || 30),

  port: Number(process.env.PORT || 4321),
  bindHost: process.env.BIND_HOST || "127.0.0.1",
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  calendarFeedToken: process.env.CALENDAR_FEED_TOKEN || "",
  ownerName: process.env.OWNER_NAME || "you",
  timezone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  prayerLatitude: optionalNumber(process.env.PRAYER_LATITUDE),
  prayerLongitude: optionalNumber(process.env.PRAYER_LONGITUDE),
  prayerMethod: optionalNumber(process.env.PRAYER_METHOD),
  /** Where `npm run export` writes the Obsidian mirror. */
  exportDir: projectPath(process.env.EXPORT_DIR || "./export"),
  backupDir: projectPath(process.env.BACKUP_DIR || "./backups"),
  backupRetention: Math.max(3, Number(process.env.BACKUP_RETENTION || 14)),
  /** Optional read-only Markdown vault synchronized into encrypted entries. */
  vaultDir: process.env.VAULT_DIR ? projectPath(process.env.VAULT_DIR) : "",

  maxToolRounds: Number(process.env.MAX_TOOL_ROUNDS || 8),
  historyTurns: Number(process.env.HISTORY_TURNS || 20),
};

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/;

function persistEnv(values: Record<string, string>): void {
  let next = fs.readFileSync(envPath, "utf8");
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    const line = `${name}=${value}`;
    next = pattern.test(next)
      ? next.replace(pattern, line)
      : `${next.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(envPath, next, { mode: 0o600 });
}

/** Update the active model immediately and keep it across restarts. */
export function setModel(value: string): string {
  const model = value.trim();
  if (!MODEL_ID.test(model) || model.length > 160) {
    throw new Error("Enter a valid Ollama model ID, such as gpt-oss:120b.");
  }

  persistEnv({ OLLAMA_MODEL: model });
  process.env.OLLAMA_MODEL = model;
  config.model = model;
  if (!process.env.OLLAMA_FAST_MODEL) config.fastModel = model;
  if (!process.env.OLLAMA_REVIEW_MODEL) config.reviewModel = model;
  return model;
}

/** Persist new login credentials and invalidate every previously issued session. */
export function setPasswordCredentials(passwordHash: string, sessionSecret: string): void {
  persistEnv({ PASSWORD_HASH: passwordHash, SESSION_SECRET: sessionSecret });
  process.env.PASSWORD_HASH = passwordHash;
  process.env.SESSION_SECRET = sessionSecret;
  config.passwordHash = passwordHash;
  config.sessionSecret = sessionSecret;
}

/** Update the Markdown source folder immediately and keep it across restarts. */
export function setVaultDir(value: string): string {
  const vaultDir = projectPath(value.trim());
  if (!value.trim() || !fs.existsSync(vaultDir) || !fs.statSync(vaultDir).isDirectory()) {
    throw new Error("Choose an existing Markdown vault folder.");
  }
  persistEnv({ VAULT_DIR: vaultDir });
  process.env.VAULT_DIR = vaultDir;
  config.vaultDir = vaultDir;
  return vaultDir;
}

export interface PrayerSettings {
  latitude: number;
  longitude: number;
  method?: number;
}

/** Save the coordinate-based prayer calculation settings used by chat and the daily refresh. */
export function setPrayerSettings(values: PrayerSettings): PrayerSettings {
  const latitude = Number(values.latitude);
  const longitude = Number(values.longitude);
  const method = values.method === undefined ? undefined : Number(values.method);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be a number from -90 to 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be a number from -180 to 180.");
  }
  if (method !== undefined && (!Number.isInteger(method) || method < 0 || method > 99)) {
    throw new Error("Calculation method must be a whole number from 0 to 99.");
  }

  persistEnv({
    PRAYER_LATITUDE: String(latitude),
    PRAYER_LONGITUDE: String(longitude),
    PRAYER_METHOD: method === undefined ? "" : String(method),
  });
  process.env.PRAYER_LATITUDE = String(latitude);
  process.env.PRAYER_LONGITUDE = String(longitude);
  process.env.PRAYER_METHOD = method === undefined ? "" : String(method);
  config.prayerLatitude = latitude;
  config.prayerLongitude = longitude;
  config.prayerMethod = method;
  return { latitude, longitude, method };
}

/** Create or rotate the read-only calendar subscription credential. */
export function rotateCalendarFeedToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  persistEnv({ CALENDAR_FEED_TOKEN: token });
  process.env.CALENDAR_FEED_TOKEN = token;
  config.calendarFeedToken = token;
  return token;
}

export function ensureCalendarFeedToken(): string {
  return /^[a-f0-9]{64}$/.test(config.calendarFeedToken) ? config.calendarFeedToken : rotateCalendarFeedToken();
}

export const ENTITY_KINDS = [
  "person",
  "organization",
  "project",
  "topic",
  "area",
  "partner",
  "agent",
  "country",
  "corridor",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
