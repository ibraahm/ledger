import crypto from "node:crypto";
import { getDb, withTransaction } from "./db.js";

const TRACKED_TABLES = ["entities", "facts", "commitments", "commitment_items", "goals", "events"] as const;
type TrackedTable = (typeof TRACKED_TABLES)[number];
type Row = Record<string, any>;
export type ActionLabel = { label: string; undoRunId?: number };

export interface StoredToolResult {
  output: string;
  action?: ActionLabel;
}

export interface DataSnapshot {
  [table: string]: Map<string, Row>;
}

function stable(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function sameRow(a: Row | null | undefined, b: Row | null | undefined): boolean {
  return stable(a ?? null) === stable(b ?? null);
}

export function idempotencyKey(entryId: number, toolName: string, args: unknown): string {
  return crypto.createHash("sha256").update(stable({ entryId, toolName, args })).digest("hex");
}

export async function createActionRun(entryId: number): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO action_runs (entry_id) VALUES ($1) RETURNING id`,
    [entryId],
  );
  return Number(rows[0].id);
}

export async function finishActionRun(
  runId: number,
  status: "complete" | "failed",
  assistantMessageId?: number,
  summary?: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE action_runs SET status = $2, assistant_message_id = COALESCE($3, assistant_message_id),
       summary = COALESCE($4, summary), completed_at = now() WHERE id = $1`,
    [runId, status, assistantMessageId || null, summary || null],
  );
}

export async function priorToolResult(key: string): Promise<StoredToolResult | null> {
  const db = await getDb();
  const { rows } = await db.query<{ result: StoredToolResult }>(
    `SELECT result FROM action_steps WHERE idempotency_key = $1 LIMIT 1`,
    [key],
  );
  return rows[0]?.result || null;
}

export async function captureDataSnapshot(): Promise<DataSnapshot> {
  const db = await getDb();
  const snapshot: DataSnapshot = {};
  for (const table of TRACKED_TABLES) {
    const { rows } = await db.query<{ row: Row }>(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`);
    snapshot[table] = new Map(rows.map(({ row }) => [String(row.id), row]));
  }
  return snapshot;
}

export async function recordToolStep(
  runId: number,
  toolName: string,
  key: string,
  result: StoredToolResult,
  before: DataSnapshot,
): Promise<void> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO action_steps (run_id, tool_name, idempotency_key, result)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [runId, toolName, key, JSON.stringify(result)],
  );
  const stepId = Number(rows[0].id);
  const after = await captureDataSnapshot();
  for (const table of TRACKED_TABLES) {
    const ids = new Set([...(before[table]?.keys() || []), ...(after[table]?.keys() || [])]);
    for (const id of ids) {
      const beforeRow = before[table]?.get(id) || null;
      const afterRow = after[table]?.get(id) || null;
      if (sameRow(beforeRow, afterRow)) continue;
      await db.query(
        `INSERT INTO action_changes (run_id, step_id, table_name, record_id, before_row, after_row)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [runId, stepId, table, Number(id), beforeRow ? JSON.stringify(beforeRow) : null, afterRow ? JSON.stringify(afterRow) : null],
      );
    }
  }
}

function assertTrackedTable(value: string): asserts value is TrackedTable {
  if (!(TRACKED_TABLES as readonly string[]).includes(value)) throw new Error(`Unsupported undo table: ${value}`);
}

async function currentRow(table: TrackedTable, id: number): Promise<Row | null> {
  const db = await getDb();
  const { rows } = await db.query<{ row: Row }>(
    `SELECT row_to_json(t) AS row FROM ${table} t WHERE id = $1`,
    [id],
  );
  return rows[0]?.row || null;
}

async function restoreRow(table: TrackedTable, row: Row): Promise<void> {
  const db = await getDb();
  const columns = Object.keys(row);
  if (!columns.length || !columns.every((column) => /^[a-z_]+$/.test(column))) {
    throw new Error("The saved undo record is invalid.");
  }
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const updates = columns.filter((column) => column !== "id").map((column) => `${column} = EXCLUDED.${column}`);
  await db.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
    columns.map((column) => row[column]),
  );
}

async function restoreActionRun(runId: number, mode: "undo" | "rollback"): Promise<{ changes: number }> {
  return withTransaction(async () => {
    const db = await getDb();
    const { rows: runs } = await db.query<any>(`SELECT * FROM action_runs WHERE id = $1 FOR UPDATE`, [runId]);
    const run = runs[0];
    if (!run) throw new Error("Change set not found.");
    if (mode === "undo" && run.status !== "complete") throw new Error("Only a completed change set can be undone.");
    if (mode === "rollback" && !["pending", "failed"].includes(run.status)) throw new Error("This change set cannot be rolled back.");
    if (run.undone_at) throw new Error("This change set was already undone.");
    const { rows: rawRows } = await db.query<any>(
      `SELECT * FROM action_changes WHERE run_id = $1 ORDER BY id`,
      [runId],
    );

    const chains = new Map<string, any>();
    for (const change of rawRows) {
      const key = `${change.table_name}:${change.record_id}`;
      const existing = chains.get(key);
      if (!existing) chains.set(key, { ...change });
      else existing.after_row = change.after_row;
    }
    const rows = [...chains.values()];

    for (const change of rows) {
      assertTrackedTable(change.table_name);
      const current = await currentRow(change.table_name, Number(change.record_id));
      if (!sameRow(current, change.after_row)) {
        throw new Error(`Cannot undo because ${change.table_name} #${change.record_id} changed afterward.`);
      }
    }

    const inserted = rows.filter((change) => !change.before_row && change.after_row);
    const deleted = rows.filter((change) => change.before_row && !change.after_row);
    const updated = rows.filter((change) => change.before_row && change.after_row);
    const childFirst: TrackedTable[] = ["facts", "commitment_items", "commitments", "goals", "events", "entities"];
    const parentFirst: TrackedTable[] = ["entities", "commitments", "commitment_items", "facts", "goals", "events"];

    for (const table of childFirst) {
      for (const change of inserted.filter((item) => item.table_name === table)) {
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [change.record_id]);
      }
    }
    for (const table of parentFirst) {
      for (const change of deleted.filter((item) => item.table_name === table)) {
        await restoreRow(table, change.before_row);
      }
    }
    for (const change of updated) {
      assertTrackedTable(change.table_name);
      await restoreRow(change.table_name, change.before_row);
    }
    await db.query(
      `UPDATE action_runs SET undone_at = now(), status = $2, completed_at = COALESCE(completed_at, now()) WHERE id = $1`,
      [runId, mode === "undo" ? "undone" : "failed"],
    );
    return { changes: rows.length };
  });
}

export async function undoActionRun(runId: number): Promise<{ changes: number }> {
  return restoreActionRun(runId, "undo");
}

export async function rollbackActionRun(runId: number): Promise<{ changes: number }> {
  return restoreActionRun(runId, "rollback");
}

export async function recentActionRuns(limit = 20): Promise<any[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.summary, r.created_at, r.completed_at, r.undone_at,
       COUNT(c.id)::int AS change_count
     FROM action_runs r LEFT JOIN action_changes c ON c.run_id = r.id
     GROUP BY r.id ORDER BY r.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row: any) => ({
    id: Number(row.id), status: row.status, summary: row.summary || "",
    createdAt: new Date(row.created_at).toISOString(), changeCount: Number(row.change_count || 0),
    canUndo: row.status === "complete" && !row.undone_at,
  }));
}
