import { getDb, withTransaction } from "./db.js";
import { decrypt, encrypt, tokenize } from "./crypto.js";
import { config, type EntityKind } from "./config.js";
import { legacyLocalStampToUtc } from "./time.js";
import {
  normalizeGoalArea,
  normalizeTaskType,
  sanitizeTaskFramework,
  type GoalArea,
  type TaskFramework,
  type TaskType,
} from "./task-framework.js";

export type { GoalArea, TaskFramework, TaskType } from "./task-framework.js";

/* Encryption is applied and reversed only in this file. Everything above it
   deals in plain objects; everything below it only ever sees ciphertext. */

/**
 * DATE and TIMESTAMPTZ come back as JS Date objects from both drivers, and
 * String(date) gives "Fri Aug 14 2026 …", not ISO. Everything crossing the DB
 * boundary goes through here.
 */
function isoDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoStamp(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function normalizedRecordTitle(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function commitmentTitleKey(input: string): string {
  return normalizedRecordTitle(input)
    .replace(/\bdue diligence\b/g, "dd")
    .replace(/^(create|complete|finish|perform|conduct|do)\s+/, "")
    .trim();
}

export function commitmentWorkstreamKey(input: string): string | null {
  const original = normalizedRecordTitle(input).replace(/\bdue diligence\b/g, "dd");
  const hasBatchSignal = /\b(all|each|every|batch|workstream|agents?|partners?|vendors?|files?|locations?|offices?|records?)\b/.test(original)
    || /\b[a-z]{2,}\d+[a-z0-9]*\b/.test(original)
    || /\b\d+\b/.test(original);
  if (!hasBatchSignal) return null;
  const verbMatch = original.match(/\b(create|complete|finish|perform|conduct|prepare|review|send|update|renew|audit|check|contact|collect|file)\b/);
  const verb = verbMatch?.[1]?.replace(/^(create|finish|perform|conduct)$/, "complete") || "complete";
  const core = original
    .replace(/\b[a-z]{2,}\d+[a-z0-9]*\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\b(create|complete|finish|perform|conduct|prepare|review|send|update|renew|audit|check|contact|collect|file)\b/g, " ")
    .replace(/\b(all|each|every|batch|workstream|agents?|partners?|vendors?|files?|locations?|offices?|records?|items?|for|to|the|our|my)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return core ? `${verb}|${core}` : null;
}

function workstreamTitle(key: string, fallback: string): string {
  const [verb, ...rest] = key.split("|");
  const core = rest.join(" ").replace(/\bdd\b/g, "due diligence").trim();
  if (!core) return fallback;
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${core} workstream`;
}

function mergeWorkstreamDetail(records: Array<{ title: string; detail?: string; entityName?: string | null }>): string {
  const marker = "Included work:\n";
  const notes = new Set<string>();
  const items = new Set<string>();
  for (const record of records) {
    const detail = (record.detail || "").trim();
    const markerAt = detail.indexOf(marker);
    if (markerAt >= 0) {
      const note = detail.slice(0, markerAt).trim();
      if (note) notes.add(note);
      for (const line of detail.slice(markerAt + marker.length).split("\n")) {
        const item = line.replace(/^\s*-\s*/, "").trim();
        if (item) items.add(item);
      }
    } else if (detail) {
      notes.add(detail);
    }
    items.add(`${record.title}${record.entityName ? ` [${record.entityName}]` : ""}`);
  }
  return [...notes, items.size ? `${marker}${[...items].map((item) => `- ${item}`).join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

export function goalTitleKey(input: string): string {
  return normalizedRecordTitle(input).replace(/\bfindings\b/g, "finding");
}

function earliestDate(...values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort()[0] || null;
}

function strongestPriority(...values: Array<string | null | undefined>): string {
  if (values.includes("high")) return "high";
  if (values.includes("normal")) return "normal";
  return values.find(Boolean) || "normal";
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 72) || "unnamed"
  );
}

/* ---------------------------------------------------------- entries */

export async function addEntry(body: string, source = "chat"): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO entries (body_enc, tokens, source) VALUES ($1, $2, $3) RETURNING id`,
    [encrypt(body), tokenize(body), source],
  );
  return Number(rows[0].id);
}

export async function markProcessed(id: number): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE entries SET processed = TRUE WHERE id = $1`, [id]);
}

export interface Entry {
  id: number;
  body: string;
  source: string;
  processed: boolean;
  createdAt: string;
}

function toEntry(row: any): Entry {
  return {
    id: Number(row.id),
    body: decrypt(row.body_enc),
    source: row.source,
    processed: Boolean(row.processed),
    createdAt: isoStamp(row.created_at),
  };
}

export async function getEntry(id: number): Promise<Entry | null> {
  const db = await getDb();
  const { rows } = await db.query(`SELECT * FROM entries WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? toEntry(rows[0]) : null;
}

export async function pendingEntries(limit = 50): Promise<Entry[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT * FROM entries WHERE processed = FALSE ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toEntry);
}

export async function upsertExternalEntry(body: string, source: string, observedAt: string): Promise<"created" | "updated"> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM entries WHERE source = $1 ORDER BY id LIMIT 1`,
    [source],
  );
  if (rows[0]) {
    await db.query(
      `UPDATE entries SET body_enc = $2, tokens = $3, processed = TRUE, created_at = $4 WHERE id = $1`,
      [rows[0].id, encrypt(body), tokenize(body), observedAt],
    );
    return "updated";
  }
  await db.query(
    `INSERT INTO entries (body_enc, tokens, source, processed, created_at) VALUES ($1, $2, $3, TRUE, $4)`,
    [encrypt(body), tokenize(body), source, observedAt],
  );
  return "created";
}

/* --------------------------------------------------------- entities */

export interface Entity {
  id: number;
  kind: EntityKind;
  name: string;
  slug: string;
  country: string | null;
  status: string;
  meta: Record<string, any>;
  notes: string;
}

function toEntity(row: any): Entity {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    country: row.country,
    status: row.status,
    meta: row.meta || {},
    notes: row.notes_enc ? decrypt(row.notes_enc) : "",
  };
}

/** Idempotent: same kind + name returns the existing row rather than duplicating. */
export async function upsertEntity(input: {
  kind: EntityKind;
  name: string;
  country?: string;
  status?: string;
  meta?: Record<string, any>;
  notes?: string;
}): Promise<Entity> {
  const db = await getDb();
  const slug = slugify(input.name);
  const { rows } = await db.query(
    `INSERT INTO entities (kind, name, slug, country, status, meta, notes_enc)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'active'), COALESCE($6, '{}'::jsonb), $7)
     ON CONFLICT (kind, slug) DO UPDATE SET
       country    = COALESCE(EXCLUDED.country, entities.country),
       status     = COALESCE($5, entities.status),
       meta       = entities.meta || EXCLUDED.meta,
       updated_at = now()
     RETURNING *`,
    [
      input.kind,
      input.name,
      slug,
      input.country || null,
      input.status || null,
      JSON.stringify(input.meta || {}),
      input.notes ? encrypt(input.notes) : null,
    ],
  );
  return toEntity(rows[0]);
}

export async function findEntity(name: string, kind?: EntityKind): Promise<Entity | null> {
  const db = await getDb();
  const slug = slugify(name);
  const { rows } = await db.query(
    `SELECT * FROM entities
     WHERE ($2::text IS NULL OR kind = $2)
       AND (slug = $1 OR lower(name) LIKE '%' || lower($3) || '%')
     ORDER BY (slug = $1) DESC, updated_at DESC LIMIT 1`,
    [slug, kind || null, name],
  );
  return rows[0] ? toEntity(rows[0]) : null;
}

export async function findEntityExact(name: string): Promise<Entity | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT * FROM entities WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1`,
    [slugify(name)],
  );
  return rows[0] ? toEntity(rows[0]) : null;
}

export async function listEntities(kind?: EntityKind, country?: string, limit = 50): Promise<Entity[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT * FROM entities
     WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR lower(country) = lower($2))
     ORDER BY updated_at DESC LIMIT $3`,
    [kind || null, country || null, limit],
  );
  return rows.map(toEntity);
}

export async function entityCounts(): Promise<{ kind: string; count: number }[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT kind, COUNT(*)::int AS count FROM entities WHERE status <> 'archived' GROUP BY kind ORDER BY count DESC`,
  );
  return rows;
}

/* ------------------------------------------------------------ facts */

export async function addFact(input: {
  entityId?: number | null;
  entryId?: number | null;
  label: string;
  body: string;
}): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO facts (entity_id, entry_id, label, body_enc, tokens)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.entityId || null, input.entryId || null, input.label, encrypt(input.body), tokenize(`${input.label} ${input.body}`)],
  );
  return Number(rows[0].id);
}

export interface Fact {
  id: number;
  label: string;
  body: string;
  entityName: string | null;
  createdAt: string;
}

export async function factsFor(entityId: number, limit = 20): Promise<Fact[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT f.*, e.name AS entity_name FROM facts f
     LEFT JOIN entities e ON e.id = f.entity_id
     WHERE f.entity_id = $1 ORDER BY f.created_at DESC LIMIT $2`,
    [entityId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.label,
    body: decrypt(r.body_enc),
    entityName: r.entity_name,
    createdAt: isoStamp(r.created_at),
  }));
}

export async function getFact(id: number): Promise<Fact | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT f.*, e.name AS entity_name FROM facts f
     LEFT JOIN entities e ON e.id = f.entity_id
     WHERE f.id = $1 LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    label: rows[0].label,
    body: decrypt(rows[0].body_enc),
    entityName: rows[0].entity_name || null,
    createdAt: isoStamp(rows[0].created_at),
  };
}

export async function updateFact(id: number, label: string, body: string): Promise<Fact | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `UPDATE facts SET label = $2, body_enc = $3, tokens = $4 WHERE id = $1 RETURNING *`,
    [id, label, encrypt(body), tokenize(`${label} ${body}`)],
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    label: rows[0].label,
    body: decrypt(rows[0].body_enc),
    entityName: null,
    createdAt: isoStamp(rows[0].created_at),
  };
}

export async function deleteFact(id: number): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(`DELETE FROM facts WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

/* ------------------------------------------------------ commitments */

export interface Commitment {
  id: number;
  taskId: string;
  title: string;
  detail: string;
  direction: "mine" | "theirs";
  taskType: TaskType;
  goalArea: GoalArea;
  status: string;
  dueOn: string | null;
  dueTime: string | null;
  priority: string;
  owner: string;
  framework: TaskFramework;
  taskData: Record<string, unknown>;
  waitingOn: string;
  nextAction: string;
  entityId: number | null;
  entityName: string | null;
  entryId: number | null;
  createdAt: string;
  completedAt: string | null;
  items: CommitmentItem[];
  duplicate?: boolean;
}

function parsedTaskFramework(row: any, taskType: TaskType): TaskFramework {
  if (!row.framework_enc) return sanitizeTaskFramework(taskType, {});
  try {
    return sanitizeTaskFramework(taskType, JSON.parse(decrypt(row.framework_enc)));
  } catch {
    return sanitizeTaskFramework(taskType, {});
  }
}

function mergedTaskFramework(taskType: TaskType, current: TaskFramework, incoming?: TaskFramework): TaskFramework {
  if (!incoming) return sanitizeTaskFramework(taskType, current);
  return sanitizeTaskFramework(taskType, {
    ...current,
    ...incoming,
    contact: {
      ...(current.contact || {}),
      ...(incoming.contact || {}),
    },
  });
}

export interface CommitmentItem {
  id: number;
  commitmentId: number;
  title: string;
  detail: string;
  status: string;
  dueOn: string | null;
  entityId: number | null;
  entityName: string | null;
  position: number;
}

function toCommitmentItem(row: any): CommitmentItem {
  return {
    id: Number(row.id), commitmentId: Number(row.commitment_id), title: row.title,
    detail: row.detail_enc ? decrypt(row.detail_enc) : "", status: row.status,
    dueOn: isoDate(row.due_on), entityId: row.entity_id ? Number(row.entity_id) : null,
    entityName: row.entity_name || null, position: Number(row.position || 0),
  };
}

function toCommitment(row: any): Commitment {
  const id = Number(row.id);
  const taskType = normalizeTaskType(row.task_type);
  const framework = parsedTaskFramework(row, taskType);
  const taskId = `TASK-${String(id).padStart(3, "0")}`;
  const createdAt = isoStamp(row.created_at);
  const completedAt = row.closed_at ? isoStamp(row.closed_at) : null;
  return {
    id,
    taskId,
    title: row.title,
    detail: row.detail_enc ? decrypt(row.detail_enc) : "",
    direction: row.direction,
    taskType,
    goalArea: normalizeGoalArea(row.goal_area),
    status: row.status,
    dueOn: isoDate(row.due_on),
    dueTime: row.due_time ? String(row.due_time).slice(0, 5) : null,
    priority: row.priority,
    owner: row.owner || "me",
    framework,
    taskData: {
      task_id: taskId,
      title: row.title,
      goal_area: normalizeGoalArea(row.goal_area),
      task_type: taskType,
      priority: row.priority,
      status: row.status,
      ...framework,
      due_date: isoDate(row.due_on) || "",
      due_time: row.due_time ? String(row.due_time).slice(0, 5) : "",
      owner: row.owner || "me",
      created_at: createdAt.slice(0, 10),
      completed_at: completedAt,
    },
    waitingOn: String(framework.waiting_on || ""),
    nextAction: String(framework.next_action || ""),
    entityId: row.entity_id ? Number(row.entity_id) : null,
    entityName: row.entity_name || null,
    entryId: row.entry_id ? Number(row.entry_id) : null,
    createdAt,
    completedAt,
    items: row.items || [],
  };
}

async function itemsForCommitments(ids: number[]): Promise<Map<number, CommitmentItem[]>> {
  const result = new Map<number, CommitmentItem[]>();
  if (!ids.length) return result;
  const db = await getDb();
  const { rows } = await db.query(
     `SELECT i.*, e.name AS entity_name FROM commitment_items i
     LEFT JOIN entities e ON e.id = i.entity_id
     WHERE i.commitment_id = ANY($1::bigint[]) AND i.status <> 'archived'
     ORDER BY i.position, i.created_at, i.id`,
    [ids],
  );
  for (const row of rows) {
    const item = toCommitmentItem(row);
    result.set(item.commitmentId, [...(result.get(item.commitmentId) || []), item]);
  }
  return result;
}

async function upsertCommitmentItems(
  commitmentId: number,
  items: Array<{ title: string; detail?: string; dueOn?: string; entityId?: number | null; entryId?: number | null }>,
): Promise<CommitmentItem[]> {
  const db = await getDb();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const title = item.title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    const key = normalizedRecordTitle(title);
    await db.query(
      `INSERT INTO commitment_items
         (commitment_id, item_key, title, detail_enc, due_on, entity_id, entry_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (commitment_id, item_key) DO UPDATE SET
         detail_enc = COALESCE(EXCLUDED.detail_enc, commitment_items.detail_enc),
         due_on = COALESCE(EXCLUDED.due_on, commitment_items.due_on),
         entity_id = COALESCE(EXCLUDED.entity_id, commitment_items.entity_id),
         position = LEAST(commitment_items.position, EXCLUDED.position)`,
      [commitmentId, key, title, item.detail ? encrypt(item.detail) : null, item.dueOn || null,
        item.entityId || null, item.entryId || null, index],
    );
  }
  return (await itemsForCommitments([commitmentId])).get(commitmentId) || [];
}

export async function addCommitment(input: {
  title: string;
  detail?: string;
  direction?: "mine" | "theirs";
  taskType?: TaskType;
  goalArea?: GoalArea;
  dueOn?: string;
  dueTime?: string;
  priority?: string;
  owner?: string;
  framework?: TaskFramework;
  entityId?: number | null;
  entryId?: number | null;
  items?: Array<{ title: string; detail?: string; dueOn?: string; entityId?: number | null; entryId?: number | null }>;
}): Promise<Commitment> {
  const db = await getDb();
  const title = input.title.replace(/\s+/g, " ").trim();
  const taskType = normalizeTaskType(input.taskType);
  const goalArea = normalizeGoalArea(input.goalArea);
  const owner = String(input.owner || "me").replace(/\s+/g, " ").trim().slice(0, 160) || "me";
  const direction = input.direction || (owner.toLowerCase() === "me" ? "mine" : "theirs");
  const framework = sanitizeTaskFramework(taskType, input.framework || {});
  const { rows: candidates } = await db.query(
    `SELECT c.*, e.name AS entity_name, e.slug AS entity_slug FROM commitments c
     LEFT JOIN entities e ON e.id = c.entity_id
     WHERE c.status = 'open'
       AND c.goal_area = $1
     ORDER BY (c.entity_id IS NOT NULL) DESC, c.created_at`,
    [goalArea],
  );
  const incomingEntityId = input.entityId || null;
  const incomingEntity = incomingEntityId
    ? await db.query<{ slug: string; name: string }>(`SELECT slug, name FROM entities WHERE id = $1 LIMIT 1`, [incomingEntityId])
    : { rows: [] };
  const incomingEntitySlug = incomingEntity.rows[0]?.slug || null;
  const existing = candidates.find((row: any) => {
    const sameTitle = commitmentTitleKey(row.title) === commitmentTitleKey(title);
    const samePortfolio = commitmentWorkstreamKey(row.title) && commitmentWorkstreamKey(row.title) === commitmentWorkstreamKey(title);
    const sameEntity = !row.entity_id
      || Number(row.entity_id) === incomingEntityId
      || Boolean(incomingEntitySlug && row.entity_slug === incomingEntitySlug);
    return sameTitle && sameEntity || samePortfolio && row.task_type === taskType;
  });
  if (existing) {
    const existingDetail = existing.detail_enc ? decrypt(existing.detail_enc) : "";
    const nextDetail = (input.detail || "").trim();
    const samePortfolio = commitmentWorkstreamKey(existing.title) && commitmentWorkstreamKey(existing.title) === commitmentWorkstreamKey(title);
    const detail = samePortfolio
      ? mergeWorkstreamDetail([
        { title: existing.title, detail: existingDetail, entityName: existing.entity_name },
        { title, detail: nextDetail, entityName: incomingEntity.rows[0]?.name || null },
      ])
      : nextDetail.length > existingDetail.length ? nextDetail : existingDetail;
    const existingEntityId = existing.entity_id ? Number(existing.entity_id) : null;
    const mergedEntityId = samePortfolio && existingEntityId && incomingEntityId && existingEntityId !== incomingEntityId
      ? null
      : existingEntityId || incomingEntityId;
    const nextFramework = mergedTaskFramework(taskType, parsedTaskFramework(existing, normalizeTaskType(existing.task_type)), framework);
    const { rows } = await db.query(
      `UPDATE commitments SET
         title = $2,
         detail_enc = COALESCE($3, detail_enc),
         due_on = $4,
         priority = $5,
         entity_id = $6,
         direction = $7,
         task_type = $8,
         goal_area = $9,
         due_time = $10,
         owner = $11,
         framework_enc = $12
       WHERE id = $1 RETURNING *`,
      [
        existing.id,
        samePortfolio
          ? workstreamTitle(commitmentWorkstreamKey(title)!, existing.title)
          : /^complete\b/i.test(title) && /^create\b/i.test(existing.title) ? title : existing.title,
        detail ? encrypt(detail) : null,
        earliestDate(isoDate(existing.due_on), input.dueOn),
        strongestPriority(existing.priority, input.priority),
        mergedEntityId,
        direction,
        taskType,
        goalArea,
        input.dueTime || existing.due_time || null,
        owner,
        encrypt(JSON.stringify(nextFramework)),
      ],
    );
    const commitment = { ...toCommitment({ ...rows[0], entity_name: mergedEntityId === existingEntityId ? existing.entity_name : null }), duplicate: true };
    commitment.items = await upsertCommitmentItems(commitment.id, [
      ...(input.items || []),
      ...(samePortfolio && existing.title !== commitment.title ? [{
        title: existing.title, detail: existingDetail, dueOn: isoDate(existing.due_on) || undefined,
        entityId: existingEntityId, entryId: existing.entry_id ? Number(existing.entry_id) : null,
      }] : []),
      ...(samePortfolio && title !== commitment.title ? [{ title, detail: input.detail, dueOn: input.dueOn, entityId: input.entityId, entryId: input.entryId }] : []),
    ]);
    return commitment;
  }
  const { rows } = await db.query(
    `INSERT INTO commitments
       (title, detail_enc, direction, task_type, goal_area, due_on, due_time, priority, owner, framework_enc, entity_id, entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8,'normal'), $9, $10, $11, $12) RETURNING *`,
    [
      title,
      input.detail ? encrypt(input.detail) : null,
      direction,
      taskType,
      goalArea,
      input.dueOn || null,
      input.dueTime || null,
      input.priority || null,
      owner,
      encrypt(JSON.stringify(framework)),
      input.entityId || null,
      input.entryId || null,
    ],
  );
  const commitment = toCommitment(rows[0]);
  commitment.items = await upsertCommitmentItems(commitment.id, input.items || []);
  return commitment;
}

export async function closeCommitment(query: string): Promise<Commitment | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT c.*, e.name AS entity_name FROM commitments c
     LEFT JOIN entities e ON e.id = c.entity_id
     WHERE c.status = 'open' AND lower(c.title) LIKE '%' || lower($1) || '%'
     ORDER BY c.due_on NULLS LAST LIMIT 1`,
    [query],
  );
  if (!rows[0]) return null;
  const { rows: updated } = await db.query(
    `UPDATE commitments SET status = 'done', closed_at = now() WHERE id = $1 RETURNING *`,
    [rows[0].id],
  );
  return toCommitment({ ...updated[0], entity_name: rows[0].entity_name });
}

export async function closeCommitmentById(id: number): Promise<Commitment | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `UPDATE commitments SET status = 'done', closed_at = now()
     WHERE id = $1 AND status = 'open' RETURNING *`,
    [id],
  );
  return rows[0] ? toCommitment(rows[0]) : null;
}

export async function openCommitments(limit = 200): Promise<Commitment[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT c.*, e.name AS entity_name FROM commitments c
     LEFT JOIN entities e ON e.id = c.entity_id
     WHERE c.status = 'open' ORDER BY c.due_on NULLS LAST, c.created_at LIMIT $1`,
    [limit],
  );
  const commitments = rows.map(toCommitment);
  const itemMap = await itemsForCommitments(commitments.map((item) => item.id));
  for (const commitment of commitments) commitment.items = itemMap.get(commitment.id) || [];
  return commitments;
}

export async function commitmentDetail(id: number): Promise<(Commitment & { sourceNote: string; sourceAt: string | null }) | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT c.*, e.name AS entity_name, n.body_enc AS source_body_enc, n.created_at AS source_at
     FROM commitments c
     LEFT JOIN entities e ON e.id = c.entity_id
     LEFT JOIN entries n ON n.id = c.entry_id
     WHERE c.id = $1 LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  const commitment = toCommitment(rows[0]);
  commitment.items = (await itemsForCommitments([id])).get(id) || [];
  return {
    ...commitment,
    sourceNote: rows[0].source_body_enc ? decrypt(rows[0].source_body_enc) : "",
    sourceAt: rows[0].source_at ? isoStamp(rows[0].source_at) : null,
  };
}

export async function updateCommitmentById(
  id: number,
  changes: {
    title: string;
    detail?: string;
    dueOn?: string | null;
    dueTime?: string | null;
    priority: string;
    direction?: "mine" | "theirs";
    taskType?: TaskType;
    goalArea?: GoalArea;
    owner?: string;
    framework?: TaskFramework;
  },
): Promise<Commitment | null> {
  const db = await getDb();
  const current = await commitmentDetail(id);
  if (!current || current.status !== "open") return null;
  const taskType = normalizeTaskType(changes.taskType || current.taskType);
  const owner = String(changes.owner ?? current.owner).replace(/\s+/g, " ").trim().slice(0, 160) || "me";
  const direction = changes.direction || current.direction;
  const framework = mergedTaskFramework(taskType, current.framework, changes.framework);
  const { rows } = await db.query(
    `UPDATE commitments SET title = $2, detail_enc = $3, due_on = $4, priority = $5, direction = $6, task_type = $7,
       goal_area = $8, due_time = $9, owner = $10, framework_enc = $11
     WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, changes.title.replace(/\s+/g, " ").trim(), changes.detail ? encrypt(changes.detail) : null,
      changes.dueOn || null, changes.priority, direction, taskType, normalizeGoalArea(changes.goalArea || current.goalArea),
      changes.dueTime || null, owner, encrypt(JSON.stringify(framework))],
  );
  if (!rows[0]) return null;
  const result = toCommitment(rows[0]);
  result.items = (await itemsForCommitments([id])).get(id) || [];
  return result;
}

export async function addCommitmentItem(
  commitmentId: number,
  input: { title: string; detail?: string; dueOn?: string; entityId?: number | null; entryId?: number | null },
): Promise<CommitmentItem | null> {
  const parent = await commitmentDetail(commitmentId);
  if (!parent || parent.status !== "open") return null;
  const items = await upsertCommitmentItems(commitmentId, [input]);
  return items.find((item) => normalizedRecordTitle(item.title) === normalizedRecordTitle(input.title)) || null;
}

export async function updateCommitmentItem(
  id: number,
  changes: { title: string; detail?: string; dueOn?: string | null; status: "open" | "done" },
): Promise<CommitmentItem | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `UPDATE commitment_items SET item_key = $2, title = $3, detail_enc = $4, due_on = $5,
       status = $6, closed_at = CASE WHEN $6 = 'done' THEN COALESCE(closed_at, now()) ELSE NULL END
     WHERE id = $1 RETURNING *`,
    [id, normalizedRecordTitle(changes.title), changes.title.replace(/\s+/g, " ").trim(),
      changes.detail ? encrypt(changes.detail) : null, changes.dueOn || null, changes.status],
  );
  return rows[0] ? toCommitmentItem(rows[0]) : null;
}

export async function deleteCommitmentItem(id: number): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(`DELETE FROM commitment_items WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function splitCommitmentItem(id: number): Promise<Commitment | null> {
  return withTransaction(async () => {
    const db = await getDb();
    const { rows } = await db.query<any>(
      `SELECT i.*, c.direction, c.task_type, c.goal_area, c.owner, c.priority, c.entry_id AS parent_entry_id
       FROM commitment_items i JOIN commitments c ON c.id = i.commitment_id
       WHERE i.id = $1 AND c.status = 'open'`,
      [id],
    );
    const item = rows[0];
    if (!item) return null;
    const commitment = await addCommitment({
      title: item.title, detail: item.detail_enc ? decrypt(item.detail_enc) : undefined,
      direction: item.direction, taskType: normalizeTaskType(item.task_type), goalArea: normalizeGoalArea(item.goal_area),
      dueOn: isoDate(item.due_on) || undefined, priority: item.priority,
      owner: item.owner || "me",
      entityId: item.entity_id ? Number(item.entity_id) : null,
      entryId: item.entry_id ? Number(item.entry_id) : item.parent_entry_id ? Number(item.parent_entry_id) : null,
    });
    await db.query(`DELETE FROM commitment_items WHERE id = $1`, [id]);
    return commitment;
  });
}

export async function mergeCommitments(ids: number[], title?: string): Promise<Commitment | null> {
  return withTransaction(async () => {
    const db = await getDb();
    const cleanIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (cleanIds.length < 2) return null;
    const { rows } = await db.query<any>(
      `SELECT * FROM commitments WHERE id = ANY($1::bigint[]) AND status = 'open' ORDER BY created_at, id`,
      [cleanIds],
    );
    if (rows.length !== cleanIds.length) return null;
    if (new Set(rows.map((row) => normalizeTaskType(row.task_type))).size !== 1) return null;
    if (new Set(rows.map((row) => normalizeGoalArea(row.goal_area))).size !== 1) return null;
    const survivor = rows[0];
    const parentTitle = title?.trim() || workstreamTitle(commitmentWorkstreamKey(rows.map((row) => row.title).join(" ")) || "complete|workstream", survivor.title);
    await db.query(
      `UPDATE commitments SET title = $2, due_on = $3, priority = $4, entity_id = NULL WHERE id = $1`,
      [survivor.id, parentTitle, earliestDate(...rows.map((row) => isoDate(row.due_on))), strongestPriority(...rows.map((row) => row.priority))],
    );
    await upsertCommitmentItems(Number(survivor.id), rows.map((row) => ({
      title: row.title, detail: row.detail_enc ? decrypt(row.detail_enc) : undefined,
      dueOn: isoDate(row.due_on) || undefined, entityId: row.entity_id ? Number(row.entity_id) : null,
      entryId: row.entry_id ? Number(row.entry_id) : null,
    })));
    for (const row of rows.slice(1)) {
      const { rows: children } = await db.query<any>(`SELECT * FROM commitment_items WHERE commitment_id = $1`, [row.id]);
      await upsertCommitmentItems(Number(survivor.id), children.map((child) => ({
        title: child.title, detail: child.detail_enc ? decrypt(child.detail_enc) : undefined,
        dueOn: isoDate(child.due_on) || undefined, entityId: child.entity_id ? Number(child.entity_id) : null,
        entryId: child.entry_id ? Number(child.entry_id) : null,
      })));
      await db.query(`UPDATE commitments SET status = 'archived', closed_at = now() WHERE id = $1`, [row.id]);
    }
    return commitmentDetail(Number(survivor.id));
  });
}

export interface RecordMutation<T> {
  item: T | null;
  matches: string[];
}

function matchingRows<T extends { title: string }>(rows: T[], query: string, keyOf: (title: string) => string): T[] {
  const key = keyOf(query);
  const exact = rows.filter((row) => keyOf(row.title) === key);
  if (exact.length) return exact;
  return rows.filter((row) => {
    const candidate = keyOf(row.title);
    return candidate.includes(key) || key.includes(candidate);
  });
}

export async function updateCommitment(
  query: string,
  changes: {
    title?: string;
    detail?: string;
    dueOn?: string;
    clearDue?: boolean;
    dueTime?: string;
    clearDueTime?: boolean;
    priority?: string;
    direction?: "mine" | "theirs";
    taskType?: TaskType;
    goalArea?: GoalArea;
    owner?: string;
    framework?: TaskFramework;
    entityId?: number | null;
  },
): Promise<RecordMutation<Commitment>> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT c.*, e.name AS entity_name FROM commitments c
     LEFT JOIN entities e ON e.id = c.entity_id
     WHERE c.status = 'open' ORDER BY c.due_on NULLS LAST, c.created_at`,
  );
  const matches = matchingRows(rows, query, commitmentTitleKey);
  if (matches.length !== 1) return { item: null, matches: matches.slice(0, 6).map((row) => row.title) };
  const current = matches[0];
  const taskType = normalizeTaskType(changes.taskType || current.task_type);
  const direction = changes.direction || current.direction;
  const owner = String(changes.owner ?? current.owner ?? "me").replace(/\s+/g, " ").trim().slice(0, 160) || "me";
  const framework = mergedTaskFramework(taskType, parsedTaskFramework(current, normalizeTaskType(current.task_type)), changes.framework);
  const detailEnc = changes.detail !== undefined ? (changes.detail ? encrypt(changes.detail) : null) : current.detail_enc;
  const dueOn = changes.clearDue ? null : changes.dueOn !== undefined ? changes.dueOn || null : isoDate(current.due_on);
  const dueTime = changes.clearDueTime ? null : changes.dueTime !== undefined ? changes.dueTime || null : current.due_time;
  const { rows: updated } = await db.query(
    `UPDATE commitments SET title = $2, detail_enc = $3, due_on = $4, priority = $5,
       direction = $6, entity_id = $7, task_type = $8, goal_area = $9, due_time = $10,
       owner = $11, framework_enc = $12 WHERE id = $1 RETURNING *`,
    [
      current.id,
      changes.title?.replace(/\s+/g, " ").trim() || current.title,
      detailEnc,
      dueOn,
      changes.priority || current.priority,
      direction,
      changes.entityId !== undefined ? changes.entityId : current.entity_id,
      taskType,
      normalizeGoalArea(changes.goalArea || current.goal_area),
      dueTime,
      owner,
      encrypt(JSON.stringify(framework)),
    ],
  );
  const entityId = updated[0].entity_id ? Number(updated[0].entity_id) : null;
  const entityName = entityId
    ? (await db.query<{ name: string }>(`SELECT name FROM entities WHERE id = $1`, [entityId])).rows[0]?.name || null
    : null;
  return { item: toCommitment({ ...updated[0], entity_name: entityName }), matches: [] };
}

export async function completeCommitment(query: string): Promise<RecordMutation<Commitment>> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT c.*, e.name AS entity_name FROM commitments c
     LEFT JOIN entities e ON e.id = c.entity_id
     WHERE c.status = 'open' ORDER BY c.due_on NULLS LAST, c.created_at`,
  );
  const matches = matchingRows(rows, query, commitmentTitleKey);
  if (matches.length !== 1) return { item: null, matches: matches.slice(0, 6).map((row) => row.title) };
  const { rows: updated } = await db.query(
    `UPDATE commitments SET status = 'done', closed_at = now() WHERE id = $1 RETURNING *`,
    [matches[0].id],
  );
  return { item: toCommitment({ ...updated[0], entity_name: matches[0].entity_name }), matches: [] };
}

/* ------------------------------------------------------------ goals */

export interface Goal {
  id: number;
  title: string;
  detail: string;
  goalArea: GoalArea;
  status: string;
  targetOn: string | null;
  priority: string;
  entityId: number | null;
  entityName: string | null;
  duplicate?: boolean;
}

function toGoal(row: any): Goal {
  return {
    id: Number(row.id),
    title: row.title,
    detail: row.detail_enc ? decrypt(row.detail_enc) : "",
    goalArea: normalizeGoalArea(row.goal_area),
    status: row.status,
    targetOn: isoDate(row.target_on),
    priority: row.priority,
    entityId: row.entity_id ? Number(row.entity_id) : null,
    entityName: row.entity_name || null,
  };
}

export async function addGoal(input: {
  title: string;
  detail?: string;
  targetOn?: string;
  priority?: string;
  goalArea?: GoalArea;
  entityId?: number | null;
  entryId?: number | null;
}): Promise<Goal> {
  const db = await getDb();
  const title = input.title.replace(/\s+/g, " ").trim();
  const { rows: candidates } = await db.query(
    `SELECT g.*, e.name AS entity_name FROM goals g
     LEFT JOIN entities e ON e.id = g.entity_id
     WHERE g.status = 'active'
     ORDER BY g.created_at`,
  );
  const existing = candidates.find((row: any) => goalTitleKey(row.title) === goalTitleKey(title));
  if (existing) {
    const existingDetail = existing.detail_enc ? decrypt(existing.detail_enc) : "";
    const nextDetail = (input.detail || "").trim();
    const detail = nextDetail.length > existingDetail.length ? nextDetail : existingDetail;
    const incomingEntityId = input.entityId || null;
    const existingEntityId = existing.entity_id ? Number(existing.entity_id) : null;
    const entityId = existingEntityId && incomingEntityId && existingEntityId !== incomingEntityId
      ? null
      : existingEntityId || incomingEntityId;
    const { rows } = await db.query(
      `UPDATE goals SET
         detail_enc = COALESCE($2, detail_enc),
         target_on = $3,
         priority = $4,
         entity_id = $5,
         goal_area = $6
       WHERE id = $1 RETURNING *`,
      [
        existing.id,
        detail ? encrypt(detail) : null,
        earliestDate(isoDate(existing.target_on), input.targetOn),
        strongestPriority(existing.priority, input.priority),
        entityId,
        normalizeGoalArea(input.goalArea || existing.goal_area),
      ],
    );
    const entityName = entityId === existingEntityId ? existing.entity_name : null;
    return { ...toGoal({ ...rows[0], entity_name: entityName }), duplicate: true };
  }
  const { rows } = await db.query(
    `INSERT INTO goals (title, detail_enc, target_on, priority, goal_area, entity_id, entry_id)
     VALUES ($1, $2, $3, COALESCE($4, 'normal'), $5, $6, $7) RETURNING *`,
    [
      title,
      input.detail ? encrypt(input.detail) : null,
      input.targetOn || null,
      input.priority || null,
      normalizeGoalArea(input.goalArea),
      input.entityId || null,
      input.entryId || null,
    ],
  );
  return toGoal(rows[0]);
}

export async function listGoals(status = "active", limit = 200): Promise<Goal[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT g.*, e.name AS entity_name FROM goals g
     LEFT JOIN entities e ON e.id = g.entity_id
     WHERE ($1::text IS NULL OR g.status = $1)
     ORDER BY g.target_on NULLS LAST, g.created_at DESC LIMIT $2`,
    [status || null, limit],
  );
  return rows.map(toGoal);
}

export async function archiveGoal(query: string): Promise<Goal | null> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT g.*, e.name AS entity_name FROM goals g
     LEFT JOIN entities e ON e.id = g.entity_id
     WHERE g.status = 'active' AND lower(g.title) LIKE '%' || lower($1) || '%'
     ORDER BY g.target_on NULLS LAST, g.created_at LIMIT 1`,
    [query],
  );
  if (!rows[0]) return null;
  const { rows: updated } = await db.query(
    `UPDATE goals SET status = 'archived', closed_at = now() WHERE id = $1 RETURNING *`,
    [rows[0].id],
  );
  return toGoal({ ...updated[0], entity_name: rows[0].entity_name });
}

export async function archiveGoalById(id: number): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `UPDATE goals SET status = 'archived', closed_at = now()
     WHERE id = $1 AND status = 'active' RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export async function restoreGoalById(id: number): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `UPDATE goals SET status = 'active', closed_at = NULL
     WHERE id = $1 AND status = 'archived' RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export async function updateGoal(
  query: string,
  changes: {
    title?: string;
    detail?: string;
    targetOn?: string;
    clearTarget?: boolean;
    priority?: string;
    goalArea?: GoalArea;
    entityId?: number | null;
  },
): Promise<RecordMutation<Goal>> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT g.*, e.name AS entity_name FROM goals g
     LEFT JOIN entities e ON e.id = g.entity_id
     WHERE g.status = 'active' ORDER BY g.target_on NULLS LAST, g.created_at`,
  );
  const matches = matchingRows(rows, query, goalTitleKey);
  if (matches.length !== 1) return { item: null, matches: matches.slice(0, 6).map((row) => row.title) };
  const current = matches[0];
  const detailEnc = changes.detail !== undefined ? (changes.detail ? encrypt(changes.detail) : null) : current.detail_enc;
  const targetOn = changes.clearTarget
    ? null
    : changes.targetOn !== undefined ? changes.targetOn || null : isoDate(current.target_on);
  const { rows: updated } = await db.query(
    `UPDATE goals SET title = $2, detail_enc = $3, target_on = $4, priority = $5,
       entity_id = $6, goal_area = $7 WHERE id = $1 RETURNING *`,
    [
      current.id,
      changes.title?.replace(/\s+/g, " ").trim() || current.title,
      detailEnc,
      targetOn,
      changes.priority || current.priority,
      changes.entityId !== undefined ? changes.entityId : current.entity_id,
      normalizeGoalArea(changes.goalArea || current.goal_area),
    ],
  );
  const entityId = updated[0].entity_id ? Number(updated[0].entity_id) : null;
  const entityName = entityId
    ? (await db.query<{ name: string }>(`SELECT name FROM entities WHERE id = $1`, [entityId])).rows[0]?.name || null
    : null;
  return { item: toGoal({ ...updated[0], entity_name: entityName }), matches: [] };
}

export async function archiveMatchingGoal(query: string): Promise<RecordMutation<Goal>> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT g.*, e.name AS entity_name FROM goals g
     LEFT JOIN entities e ON e.id = g.entity_id
     WHERE g.status = 'active' ORDER BY g.target_on NULLS LAST, g.created_at`,
  );
  const matches = matchingRows(rows, query, goalTitleKey);
  if (matches.length !== 1) return { item: null, matches: matches.slice(0, 6).map((row) => row.title) };
  const { rows: updated } = await db.query(
    `UPDATE goals SET status = 'archived', closed_at = now() WHERE id = $1 RETURNING *`,
    [matches[0].id],
  );
  return { item: toGoal({ ...updated[0], entity_name: matches[0].entity_name }), matches: [] };
}

export interface ConsolidationResult {
  goalsArchived: number;
  commitmentsArchived: number;
  goalGroups: number;
  commitmentGroups: number;
}

export async function consolidateDuplicates(): Promise<ConsolidationResult> {
  const db = await getDb();
  const [{ rows: goalRows }, { rows: commitmentRows }] = await Promise.all([
    db.query(`SELECT * FROM goals WHERE status = 'active' ORDER BY created_at, id`),
    db.query(
      `SELECT c.*, e.slug AS entity_slug, e.name AS entity_name FROM commitments c
       LEFT JOIN entities e ON e.id = c.entity_id
       WHERE c.status = 'open' ORDER BY c.created_at, c.id`,
    ),
  ]);

  let goalsArchived = 0;
  let commitmentsArchived = 0;
  let goalGroups = 0;
  let commitmentGroups = 0;

  const goalsByKey = new Map<string, any[]>();
  for (const row of goalRows) {
    const key = goalTitleKey(row.title);
    if (!key) continue;
    goalsByKey.set(key, [...(goalsByKey.get(key) || []), row]);
  }
  for (const group of goalsByKey.values()) {
    if (group.length < 2) continue;
    goalGroups += 1;
    const survivor = group[0];
    const details = group.map((row) => (row.detail_enc ? decrypt(row.detail_enc) : ""));
    const detail = details.sort((a, b) => b.length - a.length)[0] || "";
    const entityIds = [...new Set(group.map((row) => (row.entity_id ? Number(row.entity_id) : null)).filter(Boolean))];
    await db.query(
      `UPDATE goals SET detail_enc = COALESCE($2, detail_enc), target_on = $3, priority = $4, entity_id = $5
       WHERE id = $1`,
      [
        survivor.id,
        detail ? encrypt(detail) : null,
        earliestDate(...group.map((row) => isoDate(row.target_on))),
        strongestPriority(...group.map((row) => row.priority)),
        entityIds.length === 1 ? entityIds[0] : null,
      ],
    );
    for (const duplicate of group.slice(1)) {
      await db.query(`UPDATE goals SET status = 'archived', closed_at = now() WHERE id = $1`, [duplicate.id]);
      goalsArchived += 1;
    }
  }

  const commitmentsByKey = new Map<string, any[]>();
  for (const row of commitmentRows) {
    const titleKey = commitmentTitleKey(row.title);
    if (!titleKey) continue;
    const portfolioKey = commitmentWorkstreamKey(row.title);
    const key = portfolioKey
      ? `${row.direction}|portfolio|${portfolioKey}`
      : `${row.direction}|${row.entity_slug || "none"}|${titleKey}`;
    commitmentsByKey.set(key, [...(commitmentsByKey.get(key) || []), row]);
  }
  for (const group of commitmentsByKey.values()) {
    if (group.length < 2) continue;
    commitmentGroups += 1;
    const survivor = group[0];
    const portfolioKey = commitmentWorkstreamKey(survivor.title);
    const details = group.map((row) => (row.detail_enc ? decrypt(row.detail_enc) : ""));
    const detail = portfolioKey
      ? mergeWorkstreamDetail(group.map((row, index) => ({
        title: row.title,
        detail: details[index],
        entityName: row.entity_name,
      })))
      : details.sort((a, b) => b.length - a.length)[0] || "";
    const entityIds = [...new Set(group.map((row) => (row.entity_id ? Number(row.entity_id) : null)).filter(Boolean))];
    await db.query(
      `UPDATE commitments SET title = $2, detail_enc = COALESCE($3, detail_enc), due_on = $4, priority = $5, entity_id = $6
       WHERE id = $1`,
      [
        survivor.id,
        portfolioKey
          ? workstreamTitle(portfolioKey, survivor.title)
          : group.find((row) => /^complete\b/i.test(row.title))?.title || survivor.title,
        detail ? encrypt(detail) : null,
        earliestDate(...group.map((row) => isoDate(row.due_on))),
        strongestPriority(...group.map((row) => row.priority)),
        portfolioKey ? null : entityIds.length === 1 ? entityIds[0] : null,
      ],
    );
    if (portfolioKey) {
      await upsertCommitmentItems(Number(survivor.id), group.map((row, index) => ({
        title: row.title,
        detail: details[index],
        dueOn: isoDate(row.due_on) || undefined,
        entityId: row.entity_id ? Number(row.entity_id) : null,
        entryId: row.entry_id ? Number(row.entry_id) : null,
      })));
    }
    for (const duplicate of group.slice(1)) {
      await db.query(`UPDATE commitments SET status = 'archived', closed_at = now() WHERE id = $1`, [duplicate.id]);
      commitmentsArchived += 1;
    }
  }

  return { goalsArchived, commitmentsArchived, goalGroups, commitmentGroups };
}

/* ----------------------------------------------------------- events */

export interface CalEvent {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  entityName: string | null;
}

function toEvent(row: any): CalEvent {
  const allDayStamp = (value: unknown): string => {
    const date = isoDate(value) || new Date().toISOString().slice(0, 10);
    return `${date}T12:00:00.000Z`;
  };
  const timedStamp = (value: unknown): string => row.time_basis === "legacy-local"
    ? legacyLocalStampToUtc(value, config.timezone)
    : isoStamp(value);
  return {
    id: Number(row.id),
    title: row.title,
    startsAt: row.all_day ? allDayStamp(row.starts_at) : timedStamp(row.starts_at),
    endsAt: row.ends_at ? (row.all_day ? allDayStamp(row.ends_at) : timedStamp(row.ends_at)) : null,
    allDay: row.all_day,
    location: row.location,
    entityName: row.entity_name || null,
  };
}

export async function addEvent(input: {
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  location?: string;
  detail?: string;
  entityId?: number | null;
  entryId?: number | null;
}): Promise<CalEvent> {
  const db = await getDb();
  const { rows } = await db.query(
    `INSERT INTO events (title, starts_at, ends_at, all_day, location, detail_enc, entity_id, entry_id, time_basis)
     VALUES ($1, $2, $3, COALESCE($4,false), $5, $6, $7, $8, 'utc') RETURNING *`,
    [
      input.title,
      input.startsAt,
      input.endsAt || null,
      input.allDay ?? null,
      input.location || null,
      input.detail ? encrypt(input.detail) : null,
      input.entityId || null,
      input.entryId || null,
    ],
  );
  return toEvent(rows[0]);
}

export async function eventsBetween(fromISO: string, toISO: string): Promise<CalEvent[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT ev.*, e.name AS entity_name FROM events ev
     LEFT JOIN entities e ON e.id = ev.entity_id
     WHERE ev.starts_at >= $1 AND ev.starts_at < $2 ORDER BY ev.starts_at LIMIT 300`,
    [fromISO, toISO],
  );
  return rows.map(toEvent);
}

export async function allEvents(limit = 5000): Promise<CalEvent[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT ev.*, e.name AS entity_name FROM events ev
     LEFT JOIN entities e ON e.id = ev.entity_id
     ORDER BY ev.starts_at LIMIT $1`,
    [limit],
  );
  return rows.map(toEvent);
}

/** Permanently clear task/promise rows and calendar events. Source notes, goals, memory, and chat remain. */
export async function clearFeedAndCalendar(): Promise<{ commitments: number; events: number }> {
  const db = await getDb();
  const [{ rows: commitmentRows }, { rows: eventRows }] = await Promise.all([
    db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM commitments`),
    db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM events`),
  ]);
  await db.query(`DELETE FROM commitment_items`);
  await db.query(`DELETE FROM commitments`);
  await db.query(`DELETE FROM events`);
  return {
    commitments: Number(commitmentRows[0]?.count || 0),
    events: Number(eventRows[0]?.count || 0),
  };
}

export async function updateEvent(
  query: string,
  changes: {
    title?: string;
    startsAt?: string;
    endsAt?: string | null;
    allDay?: boolean;
    location?: string;
    detail?: string;
    entityId?: number | null;
  },
): Promise<RecordMutation<CalEvent>> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT ev.*, e.name AS entity_name FROM events ev
     LEFT JOIN entities e ON e.id = ev.entity_id
     ORDER BY ev.starts_at DESC LIMIT 1000`,
  );
  const matches = matchingRows(rows, query, normalizedRecordTitle);
  if (matches.length !== 1) return { item: null, matches: matches.slice(0, 6).map((row) => row.title) };
  const current = matches[0];
  const changesTime = changes.startsAt !== undefined || changes.endsAt !== undefined || changes.allDay !== undefined;
  const migrateLegacy = current.time_basis === "legacy-local" && changesTime;
  const migratedStart = migrateLegacy
    ? (current.all_day ? `${isoDate(current.starts_at)}T12:00:00.000Z` : legacyLocalStampToUtc(current.starts_at, config.timezone))
    : current.starts_at;
  const migratedEnd = migrateLegacy && current.ends_at
    ? (current.all_day ? `${isoDate(current.ends_at)}T12:00:00.000Z` : legacyLocalStampToUtc(current.ends_at, config.timezone))
    : current.ends_at;
  const { rows: updated } = await db.query(
    `UPDATE events SET title = $2, starts_at = $3, ends_at = $4, all_day = $5,
       location = $6, detail_enc = $7, entity_id = $8, time_basis = $9 WHERE id = $1 RETURNING *`,
    [
      current.id,
      changes.title?.replace(/\s+/g, " ").trim() || current.title,
      changes.startsAt || migratedStart,
      changes.endsAt !== undefined ? changes.endsAt : migratedEnd,
      changes.allDay !== undefined ? changes.allDay : current.all_day,
      changes.location !== undefined ? changes.location || null : current.location,
      changes.detail !== undefined ? (changes.detail ? encrypt(changes.detail) : null) : current.detail_enc,
      changes.entityId !== undefined ? changes.entityId : current.entity_id,
      changesTime ? "utc" : current.time_basis,
    ],
  );
  const entityId = updated[0].entity_id ? Number(updated[0].entity_id) : null;
  const entityName = entityId
    ? (await db.query<{ name: string }>(`SELECT name FROM entities WHERE id = $1`, [entityId])).rows[0]?.name || null
    : null;
  return { item: toEvent({ ...updated[0], entity_name: entityName }), matches: [] };
}

export async function cancelEvent(query: string): Promise<RecordMutation<CalEvent>> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT ev.*, e.name AS entity_name FROM events ev
     LEFT JOIN entities e ON e.id = ev.entity_id
     ORDER BY ev.starts_at DESC LIMIT 1000`,
  );
  const matches = matchingRows(rows, query, normalizedRecordTitle);
  if (matches.length !== 1) return { item: null, matches: matches.slice(0, 6).map((row) => row.title) };
  await db.query(`DELETE FROM events WHERE id = $1`, [matches[0].id]);
  return { item: toEvent(matches[0]), matches: [] };
}

export interface CalendarRange {
  from: string;
  to: string;
  events: CalEvent[];
  commitments: Commitment[];
}

export async function calendarRange(fromDate: string, toDate: string): Promise<CalendarRange> {
  const [events, commitments] = await Promise.all([
    eventsBetween(`${shiftDate(fromDate, -1)}T00:00:00Z`, `${shiftDate(toDate, 2)}T00:00:00Z`),
    openCommitments(5000),
  ]);
  return {
    from: fromDate,
    to: toDate,
    events,
    commitments: commitments.filter((item) => item.dueOn && item.dueOn >= fromDate && item.dueOn <= toDate),
  };
}

/* ----------------------------------------------------------- agenda */

export interface Agenda {
  from: string;
  to: string;
  events: CalEvent[];
  due: Commitment[];
  overdue: Commitment[];
  unscheduled: Commitment[];
}

export async function agenda(fromDate: string, toDate: string): Promise<Agenda> {
  const [events, open] = await Promise.all([
    eventsBetween(`${fromDate}T00:00:00`, `${toDate}T23:59:59`),
    openCommitments(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: fromDate,
    to: toDate,
    events,
    due: open.filter((c) => c.dueOn && c.dueOn >= fromDate && c.dueOn <= toDate && c.dueOn >= today),
    overdue: open.filter((c) => c.dueOn && c.dueOn < today),
    unscheduled: open.filter((c) => !c.dueOn),
  };
}

export async function weeklyReview(): Promise<{
  since: string;
  captures: number;
  completed: number;
  pending: Entry[];
  overdue: Commitment[];
  waiting: Commitment[];
  goals: Goal[];
  recentKnowledge: Fact[];
  focus: Commitment | null;
}> {
  const db = await getDb();
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 7);
  const since = sinceDate.toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const [captureCount, completedCount, pending, commitments, goals, facts] = await Promise.all([
    db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM entries WHERE created_at >= $1 AND source NOT LIKE 'vault:%'`,
      [since],
    ),
    db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM commitments WHERE closed_at >= $1`, [since]),
    pendingEntries(100),
    openCommitments(300),
    listGoals("active", 100),
    db.query(
      `SELECT f.*, e.name AS entity_name FROM facts f
       LEFT JOIN entities e ON e.id = f.entity_id
       WHERE f.created_at >= $1 ORDER BY f.created_at DESC LIMIT 12`,
      [since],
    ),
  ]);
  const overdue = commitments.filter((item) => item.dueOn && item.dueOn < today);
  const waiting = commitments.filter((item) => item.waitingOn || item.direction === "theirs");
  const focus = [...commitments].sort((a, b) => {
    const priority = Number(b.priority === "high") - Number(a.priority === "high");
    if (priority) return priority;
    return (a.dueOn || "9999-12-31").localeCompare(b.dueOn || "9999-12-31");
  })[0] || null;
  return {
    since,
    captures: Number(captureCount.rows[0]?.count || 0),
    completed: Number(completedCount.rows[0]?.count || 0),
    pending,
    overdue,
    waiting,
    goals,
    recentKnowledge: facts.rows.map((row: any) => ({
      id: Number(row.id),
      label: row.label,
      body: decrypt(row.body_enc),
      entityName: row.entity_name || null,
      createdAt: isoStamp(row.created_at),
    })),
    focus,
  };
}

/* ----------------------------------------------------------- search */

export interface SearchHit {
  kind: "entry" | "fact";
  id: number;
  label: string;
  body: string;
  createdAt: string;
  source?: string;
}

function externalEntryLabel(source: string): string {
  if (!source.startsWith("vault:")) return "raw capture";
  const relative = source.slice(6);
  return relative.split("/").at(-1)?.replace(/\.md$/i, "") || "Vault note";
}

/**
 * Bodies are encrypted, so this matches on blind tokens rather than text.
 * Exact words only: no stemming, no fuzzy match, no ranking by relevance.
 */
export async function search(query: string, limit = 10): Promise<SearchHit[]> {
  const db = await getDb();
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const [facts, entries] = await Promise.all([
    db.query(
      `SELECT f.id, f.label, f.body_enc, f.created_at, e.name AS entity_name
       FROM facts f LEFT JOIN entities e ON e.id = f.entity_id
       WHERE f.tokens && $1
       ORDER BY cardinality(ARRAY(SELECT unnest(f.tokens) INTERSECT SELECT unnest($1::text[]))) DESC,
                f.created_at DESC LIMIT $2`,
      [tokens, limit],
    ),
    db.query(
      `SELECT id, body_enc, source, created_at FROM entries
       WHERE tokens && $1
       ORDER BY cardinality(ARRAY(SELECT unnest(tokens) INTERSECT SELECT unnest($1::text[]))) DESC,
                created_at DESC LIMIT $2`,
      [tokens, limit],
    ),
  ]);

  return [
    ...facts.rows.map((r: any) => ({
      kind: "fact" as const,
      id: Number(r.id),
      label: r.entity_name ? `${r.entity_name}: ${r.label}` : r.label,
      body: decrypt(r.body_enc),
      createdAt: isoStamp(r.created_at),
    })),
    ...entries.rows.map((r: any) => ({
      kind: "entry" as const,
      id: Number(r.id),
      label: externalEntryLabel(r.source),
      body: decrypt(r.body_enc),
      createdAt: isoStamp(r.created_at),
      source: r.source,
    })),
  ].slice(0, limit);
}

export interface MemoryHit {
  kind: "entry" | "fact" | "entity" | "task" | "goal" | "event";
  id: number;
  title: string;
  body: string;
  context: string;
  createdAt: string;
}

export async function searchMemory(query: string, limit = 50): Promise<MemoryHit[]> {
  const db = await getDb();
  const term = query.trim();
  const like = `%${term}%`;
  const perKind = Math.max(5, Math.min(limit, 30));

  const [entities, commitments, goals, events, textHits] = await Promise.all([
    db.query(
      `SELECT * FROM entities
       WHERE ($1 = '' OR lower(name) LIKE lower($2) OR lower(COALESCE(country, '')) LIKE lower($2))
       ORDER BY updated_at DESC LIMIT $3`,
      [term, like, perKind],
    ),
    db.query(
      `SELECT c.*, e.name AS entity_name FROM commitments c
       LEFT JOIN entities e ON e.id = c.entity_id
       WHERE ($1 = '' OR lower(c.title) LIKE lower($2))
       ORDER BY c.created_at DESC LIMIT $3`,
      [term, like, perKind],
    ),
    db.query(
      `SELECT g.*, e.name AS entity_name FROM goals g
       LEFT JOIN entities e ON e.id = g.entity_id
       WHERE ($1 = '' OR lower(g.title) LIKE lower($2))
       ORDER BY g.created_at DESC LIMIT $3`,
      [term, like, perKind],
    ),
    db.query(
      `SELECT ev.*, e.name AS entity_name FROM events ev
       LEFT JOIN entities e ON e.id = ev.entity_id
       WHERE ($1 = '' OR lower(ev.title) LIKE lower($2) OR lower(COALESCE(ev.location, '')) LIKE lower($2))
       ORDER BY ev.created_at DESC LIMIT $3`,
      [term, like, perKind],
    ),
    term
      ? search(term, perKind)
      : db.query(`SELECT * FROM entries ORDER BY created_at DESC LIMIT $1`, [perKind]).then(({ rows }) =>
          rows.map((row: any) => ({
            kind: "entry" as const,
            id: Number(row.id),
            label: row.source.startsWith("vault:") ? externalEntryLabel(row.source) : row.processed ? "Filed note" : "Needs review",
            body: decrypt(row.body_enc),
            createdAt: isoStamp(row.created_at),
            source: row.source,
          })),
        ),
  ]);

  const hits: MemoryHit[] = [
    ...entities.rows.map((row: any) => ({
      kind: "entity" as const,
      id: Number(row.id),
      title: row.name,
      body: row.notes_enc ? decrypt(row.notes_enc) : "",
      context: [row.kind, row.country, row.status].filter(Boolean).join(" / "),
      createdAt: isoStamp(row.updated_at),
    })),
    ...commitments.rows.map((row: any) => ({
      kind: "task" as const,
      id: Number(row.id),
      title: row.title,
      body: row.detail_enc ? decrypt(row.detail_enc) : "",
      context: [row.direction === "theirs" ? "Waiting on" : "Task", row.entity_name, isoDate(row.due_on)].filter(Boolean).join(" / "),
      createdAt: isoStamp(row.created_at),
    })),
    ...goals.rows.map((row: any) => ({
      kind: "goal" as const,
      id: Number(row.id),
      title: row.title,
      body: row.detail_enc ? decrypt(row.detail_enc) : "",
      context: [row.status, row.entity_name, isoDate(row.target_on)].filter(Boolean).join(" / "),
      createdAt: isoStamp(row.created_at),
    })),
    ...events.rows.map((row: any) => ({
      kind: "event" as const,
      id: Number(row.id),
      title: row.title,
      body: row.detail_enc ? decrypt(row.detail_enc) : "",
      context: [row.entity_name, row.location, isoStamp(row.starts_at).slice(0, 16).replace("T", " ")].filter(Boolean).join(" / "),
      createdAt: isoStamp(row.created_at),
    })),
    ...textHits.map((hit: SearchHit) => ({
      kind: hit.kind,
      id: hit.id,
      title: hit.label === "raw capture" ? "Captured note" : hit.label,
      body: hit.body,
      context: hit.kind === "entry" ? (hit.source?.startsWith("vault:") ? `Vault / ${hit.source.slice(6)}` : "Original note") : "Stored knowledge",
      createdAt: hit.createdAt,
    })),
  ];

  return hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function entityDetail(id: number): Promise<{
  entity: Entity;
  facts: Fact[];
  tasks: Commitment[];
  goals: Goal[];
  events: CalEvent[];
} | null> {
  const db = await getDb();
  const { rows } = await db.query(`SELECT * FROM entities WHERE id = $1 LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const entity = toEntity(rows[0]);
  const [facts, tasksResult, goalsResult, eventsResult] = await Promise.all([
    factsFor(id, 100),
    db.query(
      `SELECT c.*, e.name AS entity_name FROM commitments c LEFT JOIN entities e ON e.id = c.entity_id
       WHERE c.entity_id = $1 ORDER BY c.created_at DESC LIMIT 100`,
      [id],
    ),
    db.query(
      `SELECT g.*, e.name AS entity_name FROM goals g LEFT JOIN entities e ON e.id = g.entity_id
       WHERE g.entity_id = $1 ORDER BY g.created_at DESC LIMIT 100`,
      [id],
    ),
    db.query(
      `SELECT ev.*, e.name AS entity_name FROM events ev LEFT JOIN entities e ON e.id = ev.entity_id
       WHERE ev.entity_id = $1 ORDER BY ev.starts_at DESC LIMIT 100`,
      [id],
    ),
  ]);
  return {
    entity,
    facts,
    tasks: tasksResult.rows.map(toCommitment),
    goals: goalsResult.rows.map(toGoal),
    events: eventsResult.rows.map(toEvent),
  };
}

export async function entryDetail(id: number): Promise<any | null> {
  const entry = await getEntry(id);
  if (!entry) return null;
  const db = await getDb();
  const [facts, tasks, goals, events] = await Promise.all([
    db.query(`SELECT f.*, e.name AS entity_name FROM facts f LEFT JOIN entities e ON e.id = f.entity_id WHERE f.entry_id = $1 ORDER BY f.created_at`, [id]),
    db.query(`SELECT c.*, e.name AS entity_name FROM commitments c LEFT JOIN entities e ON e.id = c.entity_id WHERE c.entry_id = $1 ORDER BY c.created_at`, [id]),
    db.query(`SELECT g.*, e.name AS entity_name FROM goals g LEFT JOIN entities e ON e.id = g.entity_id WHERE g.entry_id = $1 ORDER BY g.created_at`, [id]),
    db.query(`SELECT ev.*, e.name AS entity_name FROM events ev LEFT JOIN entities e ON e.id = ev.entity_id WHERE ev.entry_id = $1 ORDER BY ev.created_at`, [id]),
  ]);
  return {
    entry,
    facts: facts.rows.map((row: any) => ({
      id: Number(row.id), label: row.label, body: decrypt(row.body_enc), entityName: row.entity_name || null, createdAt: isoStamp(row.created_at),
    })),
    tasks: tasks.rows.map(toCommitment),
    goals: goals.rows.map(toGoal),
    events: events.rows.map(toEvent),
  };
}

export async function clearEntryExtractions(id: number): Promise<number> {
  const db = await getDb();
  let deleted = 0;
  for (const table of ["facts", "commitments", "goals", "events"]) {
    const { rows } = await db.query<{ id: string }>(`DELETE FROM ${table} WHERE entry_id = $1 RETURNING id`, [id]);
    deleted += rows.length;
  }
  await db.query(`UPDATE entries SET processed = FALSE WHERE id = $1`, [id]);
  return deleted;
}

/* --------------------------------------------------------- messages */

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  actions: { label: string }[];
  at: string;
}

export async function addMessage(role: "user" | "assistant", content: string, actions: any[] = []): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (role, body_enc, actions) VALUES ($1, $2, $3) RETURNING id`,
    [role, encrypt(content), JSON.stringify(actions)],
  );
  return Number(rows[0].id);
}

export async function recentMessages(limit = 40): Promise<Message[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT $1) t ORDER BY created_at ASC`,
    [limit],
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    role: r.role,
    content: decrypt(r.body_enc),
    actions: r.actions || [],
    at: isoStamp(r.created_at),
  }));
}

export async function deleteMessage(id: number): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(`DELETE FROM messages WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function clearMessages(): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(`DELETE FROM messages RETURNING id`);
  return rows.length;
}
