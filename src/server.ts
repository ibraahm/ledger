import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  config, ensureCalendarFeedToken, rotateCalendarFeedToken, setModel, setPasswordCredentials,
  setPrayerSettings, setVaultDir,
} from "./config.js";
import { respond, retryEntry, startProcessingQueue } from "./agent.js";
import { hashPassword, randomHex, signSession, verifyPassword, verifySession } from "./crypto.js";
import { getDb, withTransaction } from "./db.js";
import * as store from "./store.js";
import { syncVault, type VaultSyncResult } from "./vault.js";
import { buildCalendarIcs } from "./calendar.js";
import { recentActionRuns, undoActionRun } from "./actions.js";
import { getOllamaStatus } from "./ollama.js";
import { hybridMemorySearch } from "./semantic.js";
import { requestTransportSecurity, responseSecurityHeaders } from "./security.js";
import {
  createEncryptedBackup, encryptedBackupFile, listEncryptedBackups, restoreEncryptedBackup, startBackupScheduler,
} from "./backup.js";
import { prayerTimesSettings, refreshPrayerTimes, startPrayerTimesScheduler } from "./prayer.js";
import {
  GOAL_AREAS,
  TASK_TYPES,
  normalizeGoalArea,
  normalizeTaskType,
  sanitizeTaskFramework,
  taskFrameworkCatalog,
} from "./task-framework.js";
import { RECURRENCE_FREQUENCIES, normalizeRecurrence } from "./recurrence.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");

const COOKIE = "ledger_session";
let lastVaultSync: VaultSyncResult | null = null;

const CLOUD_USAGE: Record<string, "low" | "medium" | "high" | "extra high" | "metered"> = {
  "deepseek-v4-pro": "extra high",
  "gemma4:31b": "low",
  "glm-5.1": "high",
  "glm-5.2": "high",
  "nemotron-3-super": "medium",
  "gpt-oss:20b": "low",
  "gpt-oss:120b": "medium",
  "nemotron-3-nano:30b": "low",
  "minimax-m2.7": "medium",
  "qwen3.5:397b": "medium",
  "deepseek-v4-flash:preview": "medium",
  "deepseek-v4-flash:0731": "medium",
  "nemotron-3-ultra": "high",
  "minimax-m3": "high",
  "kimi-k2.6": "high",
  "kimi-k2.7-code": "high",
  "kimi-k3": "metered",
  "mistral-large-3:675b": "medium",
};

const RETIRED_CLOUD_MODELS = [
  { name: "minimax-m2.5", retiredOn: "2026-07-31", replacement: "minimax-m2.7" },
  { name: "kimi-k2.5", retiredOn: "2026-07-31", replacement: "kimi-k2.6" },
  { name: "deepseek-v3.1:671b", retiredOn: "2026-07-15", replacement: "deepseek-v4-flash:0731" },
  { name: "deepseek-v3.2", retiredOn: "2026-07-15", replacement: "deepseek-v4-flash:0731" },
  { name: "devstral-2:123b", retiredOn: "2026-07-15", replacement: "mistral-large-3:675b" },
  { name: "devstral-small-2:24b", retiredOn: "2026-07-15", replacement: "" },
  { name: "ministral-3:14b", retiredOn: "2026-07-15", replacement: "" },
  { name: "ministral-3:3b", retiredOn: "2026-07-15", replacement: "" },
  { name: "ministral-3:8b", retiredOn: "2026-07-15", replacement: "" },
  { name: "gemini-3-flash-preview", retiredOn: "2026-07-15", replacement: "minimax-m3" },
  { name: "gemma3:12b", retiredOn: "2026-07-15", replacement: "gemma4:31b" },
  { name: "gemma3:27b", retiredOn: "2026-07-15", replacement: "gemma4:31b" },
  { name: "gemma3:4b", retiredOn: "2026-07-15", replacement: "gemma4:31b" },
  { name: "glm-4.7", retiredOn: "2026-07-15", replacement: "glm-5.2" },
  { name: "glm-5", retiredOn: "2026-07-15", replacement: "glm-5.2" },
  { name: "minimax-m2.1", retiredOn: "2026-07-15", replacement: "minimax-m3" },
  { name: "qwen3-coder-next", retiredOn: "2026-07-15", replacement: "qwen3.5:397b" },
  { name: "qwen3-coder:480b", retiredOn: "2026-07-15", replacement: "qwen3.5:397b" },
  { name: "rnj-1:8b", retiredOn: "2026-06-30", replacement: "" },
  { name: "kimi-k2-thinking", retiredOn: "2026-06-16", replacement: "kimi-k2.6" },
  { name: "kimi-k2:1t", retiredOn: "2026-06-16", replacement: "kimi-k2.6" },
  { name: "minimax-m2", retiredOn: "2026-06-16", replacement: "minimax-m3" },
  { name: "glm-4.6", retiredOn: "2026-06-16", replacement: "glm-5.1" },
  { name: "qwen3-next:80b", retiredOn: "2026-06-16", replacement: "qwen3.5:397b" },
  { name: "qwen3-vl:235b", retiredOn: "2026-06-16", replacement: "qwen3.5:397b" },
  { name: "qwen3-vl:235b-instruct", retiredOn: "2026-06-16", replacement: "qwen3.5:397b" },
  { name: "cogito-2.1:671b", retiredOn: "2026-06-16", replacement: "deepseek-v4-flash:0731" },
];

function cloudAccess(name: string, usage: string): string {
  if (name === "kimi-k3") return "Paid only";
  if (usage === "low") return "Free-friendly";
  if (usage === "medium") return "Free / paid";
  return "Paid recommended";
}

function requireSecrets(): void {
  const missing = ["MASTER_KEY", "SESSION_SECRET", "PASSWORD_HASH"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(`\n  Missing ${missing.join(", ")}. Expected configuration in ${config.envPath}.`);
    console.error("  Run npm run init only for a new installation. Do not replace the key for an existing database.\n");
    process.exit(1);
  }
}

function readCookie(req: Request, name: string): string {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

function authed(req: Request, res: Response, next: NextFunction) {
  if (verifySession(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: "Not signed in." });
}

function publicOrigin(req: Request): string {
  return config.publicUrl || `${req.protocol}://${req.get("host")}`;
}

function calendarSubscription(req: Request): { url: string; webcalUrl: string; secure: boolean } {
  const token = ensureCalendarFeedToken();
  const origin = publicOrigin(req).replace(/\/+$/, "");
  const url = `${origin}/calendar/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:/i, "webcal:"), secure: origin.startsWith("https://") };
}

function validCalendarFeedToken(value: string): boolean {
  const expected = config.calendarFeedToken;
  if (!/^[a-f0-9]{64}$/.test(value) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

async function sendCalendar(_req: Request, res: Response): Promise<void> {
  const [events, commitments] = await Promise.all([store.allEvents(), store.openCommitments(5000)]);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(buildCalendarIcs(events, commitments));
}

async function main() {
  requireSecrets();
  await getDb();
  if (config.vaultDir) {
    try {
      lastVaultSync = await syncVault(config.vaultDir);
    } catch (error) {
      console.error(`  Vault   ${(error as Error).message}`);
    }
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    for (const [name, value] of Object.entries(responseSecurityHeaders(req.secure))) res.setHeader(name, value);
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  // Login page and its assets are public; everything else needs a session.
  app.use(express.static(publicDir, { index: false }));

  app.get("/", (req, res) => {
    const file = verifySession(readCookie(req, COOKIE)) ? "index.html" : "login.html";
    res.sendFile(path.join(publicDir, file));
  });

  let attempts: { at: number }[] = [];

  app.post("/api/login", (req, res) => {
    const now = Date.now();
    attempts = attempts.filter((a) => now - a.at < 15 * 60_000);
    if (attempts.length >= 8) {
      return res.status(429).json({ error: "Too many attempts. Wait 15 minutes." });
    }
    const password = String(req.body?.password || "");
    if (!verifyPassword(password, config.passwordHash)) {
      attempts.push({ at: now });
      return res.status(401).json({ error: "Wrong password." });
    }
    attempts = [];
    const expires = now + config.sessionDays * 86400_000;
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(signSession(expires))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${
        config.sessionDays * 86400
      }${req.secure ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/security", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(requestTransportSecurity(req));
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, storage: config.databaseUrl ? "postgres" : "pglite", ollama: getOllamaStatus() });
  });

  app.get("/api/state", authed, async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date();
    to.setDate(to.getDate() + 13);
    const [agenda, history, counts] = await Promise.all([
      store.agenda(today, to.toISOString().slice(0, 10)),
      store.recentMessages(40),
      store.entityCounts(),
    ]);
    res.json({ today, model: config.model, agenda, history, counts });
  });

  app.get("/api/settings", authed, async (_req, res) => {
    const headers: Record<string, string> = {};
    if (config.ollamaApiKey) headers.Authorization = `Bearer ${config.ollamaApiKey}`;
    const isCloud = /^https:\/\/(?:www\.)?ollama\.com$/i.test(config.ollamaHost);
    let models: { name: string; location: string; status: string; access: string; usage: string }[] = [];
    try {
      const response = await fetch(`${config.ollamaHost}/api/tags`, { headers });
      if (response.ok) {
        const data = (await response.json()) as { models?: { name?: string; model?: string }[] };
        models = (data.models || [])
          .map((item) => item.name || item.model || "")
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => {
            const usage = isCloud ? CLOUD_USAGE[name] || "varies" : "local hardware";
            return {
              name,
              location: isCloud ? "Cloud" : "Local",
              status: "Active",
              access: isCloud ? cloudAccess(name, usage) : "Free / unlimited",
              usage,
            };
          });
      }
    } catch {
      // Custom model IDs remain usable while the configured host is offline.
    }
    res.json({
      model: config.model,
      host: config.ollamaHost,
      hasApiKey: Boolean(config.ollamaApiKey),
      models,
      retiredModels: isCloud ? RETIRED_CLOUD_MODELS : [],
      accessNote: isCloud
        ? "Free-friendly and paid-recommended labels are guidance based on Ollama usage levels. Account access and limits are enforced by Ollama. Retirement list checked August 11, 2026."
        : "Local models are free and unlimited; usage depends on your hardware.",
      vaultDir: config.vaultDir,
      vaultSync: lastVaultSync,
      ollamaStatus: getOllamaStatus(),
      prayer: prayerTimesSettings(),
    });
  });

  app.put("/api/settings/model", authed, (req, res) => {
    try {
      res.json({ ok: true, model: setModel(String(req.body?.model || "")) });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/settings/vault", authed, async (req, res) => {
    try {
      const requested = String(req.body?.path || config.vaultDir || "").trim();
      if (!requested) return res.status(400).json({ error: "Enter a Markdown vault folder." });
      lastVaultSync = await syncVault(requested);
      const vaultDir = setVaultDir(requested);
      res.json({ ok: true, vaultDir, vaultSync: lastVaultSync });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.put("/api/settings/prayer", authed, async (req, res) => {
    try {
      const methodValue = req.body?.method;
      setPrayerSettings({
        latitude: Number(req.body?.latitude),
        longitude: Number(req.body?.longitude),
        method: methodValue === undefined || methodValue === null || methodValue === "" ? undefined : Number(methodValue),
      });
      const snapshot = await refreshPrayerTimes();
      res.json({ ok: true, ...prayerTimesSettings(), snapshot });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/prayer-times/refresh", authed, async (_req, res) => {
    try {
      const snapshot = await refreshPrayerTimes();
      res.json({ ok: true, ...prayerTimesSettings(), snapshot });
    } catch (error) {
      res.status(502).json({ error: (error as Error).message });
    }
  });

  app.put("/api/settings/password", authed, (req, res) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmation = String(req.body?.confirmation || "");

    if (!verifyPassword(currentPassword, config.passwordHash)) {
      return res.status(403).json({ error: "Current password is incorrect." });
    }
    if (newPassword.length < 10) {
      return res.status(400).json({ error: "New password must be at least 10 characters." });
    }
    if (newPassword !== confirmation) {
      return res.status(400).json({ error: "New passwords do not match." });
    }
    if (verifyPassword(newPassword, config.passwordHash)) {
      return res.status(400).json({ error: "Choose a password different from the current one." });
    }

    try {
      setPasswordCredentials(hashPassword(newPassword), randomHex(32));
      const expires = Date.now() + config.sessionDays * 86400_000;
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=${encodeURIComponent(signSession(expires))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${
          config.sessionDays * 86400
        }${req.secure ? "; Secure" : ""}`,
      );
      res.json({ ok: true, sessionDays: config.sessionDays });
    } catch (error) {
      res.status(500).json({ error: `Could not save the password: ${(error as Error).message}` });
    }
  });

  app.get("/api/backups", authed, (_req, res) => {
    res.json({ backups: listEncryptedBackups(), retention: config.backupRetention });
  });

  app.post("/api/backups", authed, async (_req, res) => {
    try {
      res.status(201).json(await createEncryptedBackup());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/backups/:name/download", authed, (req, res) => {
    try {
      const file = encryptedBackupFile(String(req.params.name));
      res.download(file, path.basename(file));
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.post("/api/backups/:name/restore", authed, async (req, res) => {
    if (String(req.body?.confirmation || "") !== "RESTORE") {
      return res.status(400).json({ error: "Type RESTORE to confirm replacement of current Ledger data." });
    }
    if (!verifyPassword(String(req.body?.password || ""), config.passwordHash)) {
      return res.status(403).json({ error: "Current password is incorrect." });
    }
    try {
      res.json({ ok: true, ...(await restoreEncryptedBackup(String(req.params.name))) });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.get("/api/agenda", authed, async (req, res) => {
    const from = String(req.query.from || new Date().toISOString().slice(0, 10));
    const to = String(req.query.to || from);
    res.json(await store.agenda(from, to));
  });

  app.get("/api/calendar", authed, async (req, res) => {
    const from = String(req.query.from || new Date().toISOString().slice(0, 10));
    const to = String(req.query.to || from);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ error: "Enter a valid calendar date range." });
    }
    res.json(await store.calendarRange(from, to));
  });

  app.get("/api/calendar.ics", authed, async (req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="Ledger.ics"');
    await sendCalendar(req, res);
  });

  app.post("/api/calendar/subscription", authed, async (req, res) => {
    res.json(calendarSubscription(req));
  });

  app.post("/api/calendar/subscription/rotate", authed, async (req, res) => {
    rotateCalendarFeedToken();
    res.json(calendarSubscription(req));
  });

  app.get("/calendar/:token.ics", async (req, res) => {
    if (!validCalendarFeedToken(String(req.params.token || ""))) {
      return res.status(404).type("text/plain").send("Calendar not found.");
    }
    res.setHeader("Content-Disposition", 'inline; filename="Ledger.ics"');
    await sendCalendar(req, res);
  });

  app.get("/api/review", authed, async (_req, res) => {
    res.json(await store.weeklyReview());
  });

  app.get("/api/memory/search", authed, async (req, res) => {
    const query = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit) || 60, 100);
    res.json(req.query.exact === "1" ? await store.searchMemory(query, limit) : await hybridMemorySearch(query, limit));
  });

  app.get("/api/memory/inbox", authed, async (_req, res) => {
    res.json(await store.pendingEntries(100));
  });

  app.get("/api/memory/entry/:id", authed, async (req, res) => {
    const detail = await store.entryDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: "Captured note not found." });
    res.json(detail);
  });

  app.post("/api/memory/entry/:id/retry", authed, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const detail = await store.entryDetail(id);
      if (!detail) return res.status(404).json({ error: "Captured note not found." });
      const partialCount = detail.facts.length + detail.tasks.length + detail.goals.length + detail.events.length;
      if (partialCount > 0) {
        return res.status(409).json({
          error: "This note has partial filing. Undo the filing before retrying to prevent duplicates.",
        });
      }
      res.json(await retryEntry(id));
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/memory/entry/:id/extractions", authed, async (req, res) => {
    const entry = await store.getEntry(Number(req.params.id));
    if (!entry) return res.status(404).json({ error: "Captured note not found." });
    const deleted = await store.clearEntryExtractions(entry.id);
    res.json({ ok: true, deleted });
  });

  app.put("/api/memory/fact/:id", authed, async (req, res) => {
    const label = String(req.body?.label || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!label || !body) return res.status(400).json({ error: "A label and memory are required." });
    const fact = await store.updateFact(Number(req.params.id), label, body);
    if (!fact) return res.status(404).json({ error: "Memory not found." });
    res.json(fact);
  });

  app.get("/api/memory/fact/:id", authed, async (req, res) => {
    const fact = await store.getFact(Number(req.params.id));
    if (!fact) return res.status(404).json({ error: "Stored memory not found." });
    res.json(fact);
  });

  app.delete("/api/memory/fact/:id", authed, async (req, res) => {
    const deleted = await store.deleteFact(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: "Memory not found." });
    res.json({ ok: true });
  });

  app.get("/api/tasks", authed, async (_req, res) => {
    res.json(await store.openCommitments(300));
  });

  app.get("/api/task-framework", authed, (_req, res) => {
    res.json(taskFrameworkCatalog());
  });

  app.get("/api/task/:id", authed, async (req, res) => {
    const task = await store.commitmentDetail(Number(req.params.id));
    if (!task) return res.status(404).json({ error: "Task not found." });
    res.json(task);
  });

  app.put("/api/task/:id", authed, async (req, res) => {
    const originalTask = await store.commitmentDetail(Number(req.params.id));
    if (!originalTask) return res.status(404).json({ error: "Open task not found." });
    const title = String(req.body?.title || "").trim();
    const dueOn = req.body?.dueOn === null || req.body?.dueOn === "" ? null : String(req.body?.dueOn || "");
    const dueTime = req.body?.dueTime === null || req.body?.dueTime === "" ? null : String(req.body?.dueTime || "");
    const priority = ["low", "normal", "high"].includes(String(req.body?.priority)) ? String(req.body.priority) : "normal";
    if (!(TASK_TYPES as readonly string[]).includes(String(req.body?.taskType))) {
      return res.status(400).json({ error: "Choose a valid task type." });
    }
    if (!(GOAL_AREAS as readonly string[]).includes(String(req.body?.goalArea))) {
      return res.status(400).json({ error: "Choose a valid goal area." });
    }
    if (req.body?.recurrence !== undefined
      && !(RECURRENCE_FREQUENCIES as readonly string[]).includes(String(req.body.recurrence))) {
      return res.status(400).json({ error: "Choose a valid repeat frequency." });
    }
    const taskType = normalizeTaskType(req.body.taskType);
    const goalArea = normalizeGoalArea(req.body.goalArea);
    const recurrence = req.body?.recurrence === undefined ? undefined : normalizeRecurrence(req.body.recurrence);
    if (!title) return res.status(400).json({ error: "Task title is required." });
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return res.status(400).json({ error: "Use a valid due date." });
    if (dueTime && !/^\d{2}:\d{2}$/.test(dueTime)) return res.status(400).json({ error: "Use a valid due time." });
    if (recurrence && recurrence !== "none" && !dueOn) {
      return res.status(400).json({ error: "Recurring tasks need a due date." });
    }
    let task;
    try {
      task = await withTransaction(async () => {
        const updated = await store.updateCommitmentById(Number(req.params.id), {
          title,
          detail: String(req.body?.detail || ""),
          dueOn,
          dueTime,
          priority,
          taskType,
          goalArea,
          recurrence,
          owner: String(req.body?.owner || "me"),
          framework: sanitizeTaskFramework(taskType, req.body?.framework),
        });
        if (!updated) return null;
        const corrections = [
          originalTask.goalArea !== updated.goalArea ? `use Goal Area "${updated.goalArea}"` : "",
          originalTask.taskType !== updated.taskType ? `use Task Type "${updated.taskType}"` : "",
        ].filter(Boolean);
        if (corrections.length) {
          await store.saveAssistantRule(`For the task "${updated.title}", ${corrections.join(" and ")}.`, "manual-task-edit");
        }
        return updated;
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Could not update task." });
    }
    if (!task) return res.status(404).json({ error: "Open task not found." });
    res.json(task);
  });

  app.post("/api/task/:id/items", authed, async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const dueOn = String(req.body?.dueOn || "");
    if (!title) return res.status(400).json({ error: "Item title is required." });
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return res.status(400).json({ error: "Use a valid item date." });
    const item = await store.addCommitmentItem(Number(req.params.id), {
      title, detail: String(req.body?.detail || ""), dueOn: dueOn || undefined,
    });
    if (!item) return res.status(404).json({ error: "Open parent task not found." });
    res.status(201).json(item);
  });

  app.put("/api/task-item/:id", authed, async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const dueOn = req.body?.dueOn === null || req.body?.dueOn === "" ? null : String(req.body?.dueOn || "");
    if (!title) return res.status(400).json({ error: "Item title is required." });
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return res.status(400).json({ error: "Use a valid item date." });
    const item = await store.updateCommitmentItem(Number(req.params.id), {
      title, detail: String(req.body?.detail || ""), dueOn, status: req.body?.status === "done" ? "done" : "open",
    });
    if (!item) return res.status(404).json({ error: "Batch item not found." });
    res.json(item);
  });

  app.delete("/api/task-item/:id", authed, async (req, res) => {
    const deleted = await store.deleteCommitmentItem(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: "Batch item not found." });
    res.json({ ok: true });
  });

  app.post("/api/task-item/:id/split", authed, async (req, res) => {
    const task = await store.splitCommitmentItem(Number(req.params.id));
    if (!task) return res.status(404).json({ error: "Batch item not found." });
    res.json(task);
  });

  app.post("/api/tasks/merge", authed, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const task = await store.mergeCommitments(ids, req.body?.title ? String(req.body.title) : undefined);
    if (!task) return res.status(400).json({ error: "Select at least two open tasks that still exist." });
    res.json(task);
  });

  app.get("/api/actions", authed, async (_req, res) => {
    res.json(await recentActionRuns(30));
  });

  app.post("/api/actions/:id/undo", authed, async (req, res) => {
    try {
      res.json({ ok: true, ...(await undoActionRun(Number(req.params.id))) });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.get("/api/goals", authed, async (req, res) => {
    const requested = String(req.query.status || "active");
    const status = requested === "all" ? "" : requested === "archived" ? "archived" : "active";
    res.json(await store.listGoals(status, 200));
  });

  app.post("/api/goals", authed, async (req, res) => {
    const title = String(req.body?.title || "").replace(/\s+/g, " ").trim();
    const detail = String(req.body?.detail || "").trim();
    const targetOn = String(req.body?.targetOn || "").trim();
    const priority = ["low", "normal", "high"].includes(String(req.body?.priority))
      ? String(req.body.priority)
      : "normal";
    if (!(GOAL_AREAS as readonly string[]).includes(String(req.body?.goalArea))) {
      return res.status(400).json({ error: "Choose a Goal Area." });
    }
    if (title.split(" ").filter(Boolean).length < 2) {
      return res.status(400).json({ error: "Write a clear outcome for this goal." });
    }
    if (targetOn && !/^\d{4}-\d{2}-\d{2}$/.test(targetOn)) {
      return res.status(400).json({ error: "Use a valid target date." });
    }
    const goal = await store.addGoal({
      title,
      detail: detail || undefined,
      targetOn: targetOn || undefined,
      priority,
      goalArea: normalizeGoalArea(req.body.goalArea),
    });
    res.status(goal.duplicate ? 200 : 201).json(goal);
  });

  app.put("/api/goals/:id", authed, async (req, res) => {
    const id = Number(req.params.id);
    const title = String(req.body?.title || "").replace(/\s+/g, " ").trim();
    const detail = String(req.body?.detail || "").trim();
    const targetOn = String(req.body?.targetOn || "").trim();
    const priority = String(req.body?.priority || "normal");
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid goal ID." });
    }
    if (!(GOAL_AREAS as readonly string[]).includes(String(req.body?.goalArea))) {
      return res.status(400).json({ error: "Choose a Goal Area." });
    }
    if (title.split(" ").filter(Boolean).length < 2) {
      return res.status(400).json({ error: "Write a clear outcome for this goal." });
    }
    if (targetOn && !/^\d{4}-\d{2}-\d{2}$/.test(targetOn)) {
      return res.status(400).json({ error: "Use a valid target date." });
    }
    if (!["low", "normal", "high"].includes(priority)) {
      return res.status(400).json({ error: "Choose a valid priority." });
    }
    const goal = await store.updateGoalById(id, {
      title,
      detail,
      targetOn: targetOn || null,
      priority,
      goalArea: normalizeGoalArea(req.body.goalArea),
    });
    if (!goal) return res.status(404).json({ error: "Active goal not found." });
    res.json(goal);
  });

  app.post("/api/maintenance/consolidate", authed, async (_req, res) => {
    res.json({ ok: true, ...(await store.consolidateDuplicates()) });
  });

  app.post("/api/goal/archive", authed, async (req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid goal ID." });
    }
    const archived = await store.archiveGoalById(id);
    if (!archived) return res.status(404).json({ error: "Active goal not found." });
    res.json({ ok: true });
  });

  app.post("/api/goal/restore", authed, async (req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid goal ID." });
    }
    const restored = await store.restoreGoalById(id);
    if (!restored) return res.status(404).json({ error: "Archived goal not found." });
    res.json({ ok: true });
  });

  app.get("/api/entities", authed, async (req, res) => {
    res.json(
      await store.listEntities(
        req.query.kind as any,
        req.query.country ? String(req.query.country) : undefined,
        Number(req.query.limit) || 100,
      ),
    );
  });

  app.get("/api/stakeholders", authed, async (req, res) => {
    res.json(await store.listStakeholders(String(req.query.q || ""), Number(req.query.limit) || 200));
  });

  app.post("/api/stakeholders/:id/contacts", authed, async (req, res) => {
    const entityId = Number(req.params.id);
    if (!Number.isSafeInteger(entityId) || entityId < 1) return res.status(400).json({ error: "Invalid stakeholder ID." });
    try {
      res.status(201).json(await store.addContactLog({
        entityId,
        contactedAt: req.body?.contactedAt ? String(req.body.contactedAt) : undefined,
        channel: req.body?.channel ? String(req.body.channel) : undefined,
        note: req.body?.note ? String(req.body.note) : undefined,
      }));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get("/api/entity/:id", authed, async (req, res) => {
    const detail = await store.entityDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: "Memory subject not found." });
    res.json(detail);
  });

  app.post("/api/chat", authed, async (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Say something first." });
    try {
      res.json(await respond(message));
    } catch (error) {
      console.error(error);
      const capture = error as Error & { entryId?: number; userMessageId?: number };
      res.status(502).json({ error: capture.message, entryId: capture.entryId, userMessageId: capture.userMessageId });
    }
  });

  app.delete("/api/messages", authed, async (_req, res) => {
    const deleted = await store.clearMessages();
    res.json({ ok: true, deleted });
  });

  app.delete("/api/messages/:id", authed, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid message ID." });
    }
    const deleted = await store.deleteMessage(id);
    if (!deleted) return res.status(404).json({ error: "Chat item not found." });
    res.json({ ok: true });
  });

  app.post("/api/commitment/close", authed, async (req, res) => {
    const id = Number(req.body?.id);
    const c = Number.isSafeInteger(id) && id > 0
      ? await store.closeCommitmentById(id)
      : await store.closeCommitment(String(req.body?.query || ""));
    if (!c) return res.status(404).json({ error: "Open task not found." });
    res.json({ ok: true, nextDueOn: c.nextDueOn || null });
  });

  app.listen(config.port, config.bindHost, () => {
    console.log(`\n  Running → http://${config.bindHost}:${config.port}`);
    console.log(`  Store   ${config.databaseUrl ? "Postgres" : `PGlite (${config.dataDir})`}`);
    console.log(`  Model   ${config.model} via ${config.ollamaHost}\n`);
  });
  startProcessingQueue();
  startBackupScheduler();
  startPrayerTimesScheduler();
}

main();
