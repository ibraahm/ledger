import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getDb, withTransaction } from "./db.js";

const MAGIC = Buffer.from("LEDGER-BACKUP-1\n", "utf8");
const TABLES = [
  "schema_migrations", "entries", "entities", "entity_contacts", "messages", "commitments", "commitment_items",
  "goals", "events", "facts", "action_runs", "action_steps", "action_changes", "assistant_state", "assistant_rules",
  "habit_checkins",
] as const;
const OPTIONAL_LEGACY_TABLES = new Set<string>(["assistant_state", "assistant_rules", "entity_contacts", "habit_checkins"]);
const DELETE_ORDER = [
  "habit_checkins", "assistant_rules", "assistant_state", "action_changes", "action_steps", "action_runs", "commitment_items", "facts", "events", "entity_contacts",
  "goals", "commitments", "messages", "entities", "entries", "schema_migrations",
] as const;
const FILE_PATTERN = /^ledger-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.lgr$/;

interface BackupPayload {
  format: 1;
  createdAt: string;
  storage: string;
  tables: Record<string, Record<string, any>[]>;
}

function key(): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(config.masterKey)) throw new Error("MASTER_KEY is invalid; encrypted backup is unavailable.");
  return Buffer.from(config.masterKey, "hex");
}

function encryptPayload(payload: BackupPayload): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptPayload(input: Buffer): BackupPayload {
  if (!input.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("This is not a Ledger encrypted backup.");
  const iv = input.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = input.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = input.subarray(MAGIC.length + 28);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    if (payload?.format !== 1 || !payload.tables || typeof payload.tables !== "object") throw new Error("Invalid payload.");
    return payload;
  } catch {
    throw new Error("The backup could not be decrypted with this Ledger installation key.");
  }
}

function filename(at = new Date()): string {
  return `ledger-backup-${at.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z")}.lgr`;
}

function backupPath(name: string): string {
  if (!FILE_PATTERN.test(name)) throw new Error("Invalid backup name.");
  return path.join(config.backupDir, name);
}

export async function createEncryptedBackup(): Promise<{ name: string; size: number; createdAt: string }> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  const payload: BackupPayload = { format: 1, createdAt, storage: db.kind, tables: {} };
  for (const table of TABLES) {
    const orderColumn = table === "schema_migrations" ? "version" : table === "assistant_state" ? "key" : "id";
    const { rows } = await db.query<{ row: Record<string, any> }>(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY ${orderColumn}`);
    payload.tables[table] = rows.map(({ row }) => row);
  }
  fs.mkdirSync(config.backupDir, { recursive: true });
  const name = filename(new Date(createdAt));
  const target = backupPath(name);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, encryptPayload(payload), { mode: 0o600 });
  fs.renameSync(temporary, target);
  pruneBackups();
  return { name, size: fs.statSync(target).size, createdAt };
}

export function listEncryptedBackups(): Array<{ name: string; size: number; createdAt: string }> {
  fs.mkdirSync(config.backupDir, { recursive: true });
  return fs.readdirSync(config.backupDir)
    .filter((name) => FILE_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(backupPath(name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function encryptedBackupFile(name: string): string {
  const target = backupPath(name);
  if (!fs.existsSync(target)) throw new Error("Backup not found.");
  return target;
}

function pruneBackups(): void {
  for (const backup of listEncryptedBackups().slice(config.backupRetention)) fs.unlinkSync(backupPath(backup.name));
}

async function insertRow(table: string, row: Record<string, any>): Promise<void> {
  const db = await getDb();
  const columns = Object.keys(row);
  if (!columns.length || !columns.every((column) => /^[a-z_]+$/.test(column))) throw new Error(`Invalid ${table} row.`);
  await db.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    columns.map((column) => row[column]),
  );
}

export async function restoreEncryptedBackup(name: string): Promise<{ restoredAt: string; records: number }> {
  const input = fs.readFileSync(encryptedBackupFile(name));
  const payload = decryptPayload(input);
  for (const table of TABLES) {
    if (!Array.isArray(payload.tables[table])) {
      if (OPTIONAL_LEGACY_TABLES.has(table)) payload.tables[table] = [];
      else throw new Error(`Backup is missing ${table}.`);
    }
  }
  return withTransaction(async () => {
    const db = await getDb();
    for (const table of DELETE_ORDER) await db.query(`DELETE FROM ${table}`);
    let records = 0;
    for (const table of TABLES) {
      for (const row of payload.tables[table]) {
        await insertRow(table, row);
        records += 1;
      }
    }
    for (const table of TABLES.filter((table) => table !== "schema_migrations" && table !== "assistant_state")) {
      await db.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE(MAX(id), 0), 1), COALESCE(MAX(id), 0) > 0) FROM ${table}`,
      );
    }
    return { restoredAt: new Date().toISOString(), records };
  });
}

let lastScheduledDay = "";

export function startBackupScheduler(): void {
  const run = async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (day === lastScheduledDay || listEncryptedBackups().some((backup) => backup.name.startsWith(`ledger-backup-${day}`))) return;
    await createEncryptedBackup();
    lastScheduledDay = day;
  };
  const timer = setInterval(() => void run().catch((error) => console.error(`  Backup  ${(error as Error).message}`)), 60 * 60_000);
  timer.unref();
  void run().catch((error) => console.error(`  Backup  ${(error as Error).message}`));
}
