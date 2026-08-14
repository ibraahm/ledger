import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";

export interface Db {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
  kind: "pglite" | "postgres";
}

interface RootDb extends Db {
  transaction<T>(callback: (tx: Db) => Promise<T>): Promise<T>;
}

const transactionScope = new AsyncLocalStorage<Db>();
let db: RootDb | null = null;
let dbPromise: Promise<RootDb> | null = null;

export async function getDb(): Promise<Db> {
  const scoped = transactionScope.getStore();
  if (scoped) return scoped;
  if (db) return db;
  if (!dbPromise) dbPromise = openDb();
  db = await dbPromise;
  return db;
}

export async function withTransaction<T>(callback: () => Promise<T>): Promise<T> {
  const existing = transactionScope.getStore();
  if (existing) return callback();
  const root = (await getDb()) as RootDb;
  return root.transaction((tx) => transactionScope.run(tx, callback));
}

async function openDb(): Promise<RootDb> {
  let root: RootDb;
  if (config.databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    root = {
      kind: "postgres",
      query: (sql, params) => pool.query(sql, params) as any,
      close: () => pool.end(),
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => {
        const client = await pool.connect();
        const tx: Db = {
          kind: "postgres",
          query: (sql, params) => client.query(sql, params) as any,
          close: async () => undefined,
        };
        try {
          await client.query("BEGIN");
          const result = await callback(tx);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite(config.dataDir);
    root = {
      kind: "pglite",
      query: (sql, params) => lite.query(sql, params) as any,
      close: () => lite.close(),
      transaction: <T>(callback: (tx: Db) => Promise<T>) => lite.transaction(async (nativeTx) => callback({
        kind: "pglite",
        query: (sql, params) => nativeTx.query(sql, params) as any,
        close: async () => undefined,
      })),
    };
  }

  await migrate(root);
  return root;
}

/* -------------------------------------------------------- migrations */

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial encrypted memory schema",
    sql: `
CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY, body_enc TEXT NOT NULL, tokens TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'chat', processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entries_created ON entries (created_at DESC);
CREATE INDEX IF NOT EXISTS entries_tokens ON entries USING GIN (tokens);
CREATE TABLE IF NOT EXISTS entities (
  id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
  country TEXT, status TEXT NOT NULL DEFAULT 'active', meta JSONB NOT NULL DEFAULT '{}', notes_enc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (kind, slug)
);
CREATE INDEX IF NOT EXISTS entities_kind ON entities (kind, status);
CREATE INDEX IF NOT EXISTS entities_country ON entities (country);
CREATE INDEX IF NOT EXISTS entities_name ON entities (lower(name));
CREATE TABLE IF NOT EXISTS commitments (
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, detail_enc TEXT, direction TEXT NOT NULL DEFAULT 'mine',
  status TEXT NOT NULL DEFAULT 'open', due_on DATE, priority TEXT NOT NULL DEFAULT 'normal',
  entity_id BIGINT REFERENCES entities(id) ON DELETE SET NULL, entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS commitments_open ON commitments (status, due_on);
CREATE INDEX IF NOT EXISTS commitments_entity ON commitments (entity_id);
CREATE TABLE IF NOT EXISTS goals (
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, detail_enc TEXT, status TEXT NOT NULL DEFAULT 'active',
  target_on DATE, priority TEXT NOT NULL DEFAULT 'normal', entity_id BIGINT REFERENCES entities(id) ON DELETE SET NULL,
  entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS goals_active ON goals (status, target_on);
CREATE INDEX IF NOT EXISTS goals_entity ON goals (entity_id);
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT FALSE, location TEXT, detail_enc TEXT,
  entity_id BIGINT REFERENCES entities(id) ON DELETE SET NULL, entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_when ON events (starts_at);
CREATE INDEX IF NOT EXISTS events_entity ON events (entity_id);
CREATE TABLE IF NOT EXISTS facts (
  id BIGSERIAL PRIMARY KEY, entity_id BIGINT REFERENCES entities(id) ON DELETE CASCADE,
  entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL, label TEXT NOT NULL, body_enc TEXT NOT NULL,
  tokens TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facts_entity ON facts (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS facts_tokens ON facts USING GIN (tokens);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY, role TEXT NOT NULL, body_enc TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_recent ON messages (created_at DESC);`,
  },
  {
    version: 2,
    name: "timezone-safe calendar events",
    sql: `ALTER TABLE events ADD COLUMN IF NOT EXISTS time_basis TEXT NOT NULL DEFAULT 'legacy-local';`,
  },
  {
    version: 3,
    name: "transactional assistant actions",
    sql: `
CREATE TABLE IF NOT EXISTS action_runs (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL,
  assistant_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  undone_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS action_runs_recent ON action_runs (created_at DESC);
CREATE TABLE IF NOT EXISTS action_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_steps_run ON action_steps (run_id, id);
CREATE TABLE IF NOT EXISTS action_changes (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  step_id BIGINT NOT NULL REFERENCES action_steps(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id BIGINT NOT NULL,
  before_row JSONB,
  after_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_changes_run ON action_changes (run_id, id);`,
  },
  {
    version: 4,
    name: "structured commitment workstreams",
    sql: `
CREATE TABLE IF NOT EXISTS commitment_items (
  id BIGSERIAL PRIMARY KEY,
  commitment_id BIGINT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  detail_enc TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  due_on DATE,
  entity_id BIGINT REFERENCES entities(id) ON DELETE SET NULL,
  entry_id BIGINT REFERENCES entries(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (commitment_id, item_key)
);
CREATE INDEX IF NOT EXISTS commitment_items_parent ON commitment_items (commitment_id, status, position);
CREATE INDEX IF NOT EXISTS commitment_items_due ON commitment_items (status, due_on);`,
  },
  {
    version: 5,
    name: "requeue falsely processed failed captures",
    sql: `
UPDATE entries e SET processed = FALSE
WHERE e.processed = TRUE
  AND EXISTS (
    SELECT 1 FROM action_runs r
    WHERE r.entry_id = e.id AND r.status = 'failed'
  )
  AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.entry_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM commitments c WHERE c.entry_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.entry_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM events ev WHERE ev.entry_id = e.id);`,
  },
  {
    version: 6,
    name: "one task framework type per commitment",
    sql: `
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'action';
UPDATE commitments SET task_type = 'waiting' WHERE direction = 'theirs';
CREATE INDEX IF NOT EXISTS commitments_type ON commitments (status, task_type, due_on);`,
  },
  {
    version: 7,
    name: "goal areas and encrypted typed task frameworks",
    sql: `
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS goal_area TEXT NOT NULL DEFAULT 'company';
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS due_time TEXT;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT 'me';
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS framework_enc TEXT;
ALTER TABLE commitments ALTER COLUMN task_type SET DEFAULT 'prepare';
UPDATE commitments SET task_type = CASE
  WHEN lower(title) ~ '(call|phone|ring)' THEN 'call'
  WHEN lower(title) ~ '(email|e-mail)' THEN 'email'
  WHEN lower(title) ~ '(text|message|whatsapp|signal)' THEN 'text'
  WHEN lower(title) ~ '(meet|meeting|appointment)' THEN 'meeting'
  WHEN task_type IN ('waiting', 'follow_up') OR lower(title) ~ 'follow[ -]?up' THEN 'follow_up'
  WHEN lower(title) ~ '(approve|approval)' THEN 'approve'
  WHEN lower(title) ~ '(review|check|inspect|audit)' THEN 'review'
  WHEN lower(title) ~ '(research|investigate|compare)' THEN 'research'
  WHEN lower(title) ~ '(delegate|assign)' THEN 'delegate'
  WHEN lower(title) ~ '(recap|summarize|summary)' THEN 'recap'
  WHEN lower(title) ~ '(decide|decision|choose)' THEN 'decision'
  WHEN lower(title) ~ '(document|write|draft|file)' THEN 'document'
  WHEN lower(title) ~ '(remind|reminder)' THEN 'reminder'
  WHEN lower(title) ~ '(health|family|doctor|exercise|home)' THEN 'personal'
  ELSE 'prepare'
END
WHERE task_type IN ('action', 'waiting', 'follow_up');
UPDATE commitments SET goal_area = CASE
  WHEN lower(title) ~ '(agent|agent file)' THEN 'agents'
  WHEN lower(title) ~ 'partner' THEN 'partners'
  WHEN lower(title) ~ '(compliance|regulat|due diligence|(^|[^a-z])dd([^a-z]|$)|audit)' THEN 'compliance'
  WHEN lower(title) ~ '(bank|banking|payment|treasury)' THEN 'banking'
  WHEN lower(title) ~ '(digital|software|website|system|technology|app)' THEN 'digital'
  WHEN lower(title) ~ '(growth|sales|revenue|marketing)' THEN 'growth'
  WHEN lower(title) ~ '(team|staff|employee|hire|hiring)' THEN 'team'
  WHEN lower(title) ~ '(budget|saving|investment|tax|personal finance)' THEN 'personal_finance'
  WHEN lower(title) ~ '(health|family|doctor|exercise|home)' THEN 'personal_health_family'
  ELSE 'company'
END;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS goal_area TEXT NOT NULL DEFAULT 'company';
UPDATE goals SET goal_area = CASE
  WHEN lower(title) ~ '(agent|agent file)' THEN 'agents'
  WHEN lower(title) ~ 'partner' THEN 'partners'
  WHEN lower(title) ~ '(compliance|regulat|due diligence|(^|[^a-z])dd([^a-z]|$)|audit)' THEN 'compliance'
  WHEN lower(title) ~ '(bank|banking|payment|treasury)' THEN 'banking'
  WHEN lower(title) ~ '(digital|software|website|system|technology|app)' THEN 'digital'
  WHEN lower(title) ~ '(growth|sales|revenue|marketing)' THEN 'growth'
  WHEN lower(title) ~ '(team|staff|employee|hire|hiring)' THEN 'team'
  WHEN lower(title) ~ '(budget|saving|investment|tax|personal finance)' THEN 'personal_finance'
  WHEN lower(title) ~ '(health|family|doctor|exercise|home)' THEN 'personal_health_family'
  ELSE 'company'
END;
CREATE INDEX IF NOT EXISTS commitments_goal_area ON commitments (status, goal_area, due_on);
CREATE INDEX IF NOT EXISTS goals_goal_area ON goals (status, goal_area, target_on);`,
  },
  {
    version: 8,
    name: "calendar component revisions",
    sql: `
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE events ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 9,
    name: "recurring commitments",
    sql: `
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS recurrence_anchor_on DATE;
CREATE INDEX IF NOT EXISTS commitments_recurrence ON commitments (status, recurrence, due_on);`,
  },
];

async function migrate(target: RootDb): Promise<void> {
  await target.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const applied = await target.query<{ version: number }>(`SELECT version FROM schema_migrations`);
  const seen = new Set(applied.rows.map((row) => Number(row.version)));
  for (const migration of MIGRATIONS) {
    if (seen.has(migration.version)) continue;
    await target.transaction(async (tx) => {
      for (const statement of migration.sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query(
        `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        [migration.version, migration.name],
      );
    });
  }
}
