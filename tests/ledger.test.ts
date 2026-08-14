import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
process.env.DATA_DIR = path.join(sandbox, "data");
process.env.BACKUP_DIR = path.join(sandbox, "backups");
process.env.MASTER_KEY = crypto.randomBytes(32).toString("hex");
process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
process.env.PASSWORD_HASH = "test-only";
process.env.OLLAMA_MODEL = "test-model";

const dbModule = await import("../src/db.js");
const store = await import("../src/store.js");
const actions = await import("../src/actions.js");
const backup = await import("../src/backup.js");
const time = await import("../src/time.js");
const calendar = await import("../src/calendar.js");
const semantic = await import("../src/semantic.js");
const security = await import("../src/security.js");
const prayer = await import("../src/prayer.js");
const ledgerTools = await import("../src/tools.js");
const taskFramework = await import("../src/task-framework.js");
const recurrence = await import("../src/recurrence.js");

after(async () => {
  const db = await dbModule.getDb();
  await db.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("versioned migrations run once and include current schema", async () => {
  const db = await dbModule.getDb();
  const first = await db.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(first.rows.map((row) => Number(row.version)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await dbModule.getDb();
  const second = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM schema_migrations");
  assert.equal(Number(second.rows[0].count), 9);
});

test("captured text is encrypted at rest and decrypts through the store", async () => {
  const phrase = "private compliance lesson alpha";
  const id = await store.addEntry(phrase, "test");
  const db = await dbModule.getDb();
  const raw = await db.query<any>("SELECT body_enc FROM entries WHERE id = $1", [id]);
  assert.ok(!raw.rows[0].body_enc.includes(phrase));
  assert.equal((await store.getEntry(id))?.body, phrase);
});

test("transactions roll back every mutation when one operation fails", async () => {
  await assert.rejects(() => dbModule.withTransaction(async () => {
    await store.addCommitment({ title: "Send rollback proof" });
    throw new Error("forced failure");
  }), /forced failure/);
  assert.ok(!(await store.openCommitments()).some((item) => item.title === "Send rollback proof"));
});

test("general repeated work becomes one parent with structured batch items", async () => {
  await store.addCommitment({ title: "Complete agent DD for USMN01" });
  await store.addCommitment({ title: "Create vendor due diligence for USCO02" });
  await store.addCommitment({ title: "Complete partner DD for USMD03" });
  const parents = (await store.openCommitments()).filter((item) => /due diligence/i.test(item.title));
  assert.equal(parents.length, 1);
  assert.equal(parents[0].items.length, 3);
  assert.deepEqual(parents[0].items.map((item) => item.title).sort(), [
    "Complete agent DD for USMN01", "Create vendor due diligence for USCO02", "Complete partner DD for USMD03",
  ].sort());
});

test("each commitment has one goal area and one encrypted typed framework", async () => {
  const call = await store.addCommitment({
    title: "Call John about the payout partnership",
    taskType: "call",
    goalArea: "partners",
    dueOn: "2026-08-14",
    dueTime: "10:00",
    priority: "high",
    framework: {
      contact: { name: "John Smith", company: "Partner ABC", phone: "555-0100", email: "" },
      reason: "Discuss payout partnership",
      call_purpose: "Agree the payout partnership path",
      talking_points: ["Commercial terms", "Launch timing"],
      waiting_on: "John's availability",
      next_action: "Confirm the call time",
      ignored_field: "must not persist",
    },
  });
  const decision = await store.addCommitment({ title: "Choose the compliance vendor", taskType: "decision", goalArea: "compliance" });
  assert.equal(call.taskType, "call");
  assert.equal(call.goalArea, "partners");
  assert.equal(call.taskId.startsWith("TASK-"), true);
  assert.equal(call.dueTime, "10:00");
  assert.equal(call.waitingOn, "John's availability");
  assert.equal(call.nextAction, "Confirm the call time");
  assert.equal(call.taskData.goal_area, "partners");
  assert.equal(call.taskData.task_type, "call");
  assert.equal(call.taskData.due_date, "2026-08-14");
  assert.deepEqual(call.framework.talking_points, ["Commercial terms", "Launch timing"]);
  assert.equal(call.framework.ignored_field, undefined);
  const db = await dbModule.getDb();
  const encrypted = await db.query<any>("SELECT framework_enc FROM commitments WHERE id = $1", [call.id]);
  assert.ok(!String(encrypted.rows[0].framework_enc).includes("John Smith"));
  assert.ok(!ledgerTools.toolSchemas.some((schema) => ["add_goal", "convert_commitments_to_goal"].includes(schema.function.name)));
  const changed = await store.updateCommitmentById(call.id, {
    title: call.title, detail: call.detail, dueOn: call.dueOn, dueTime: call.dueTime,
    priority: call.priority, taskType: "email", goalArea: "banking", owner: "me",
    framework: { subject: "Payout partnership", next_action: "Send the proposal" },
  });
  assert.deepEqual([changed?.taskType, changed?.goalArea], ["email", "banking"]);
  assert.equal(changed?.framework.subject, "Payout partnership");
  assert.equal(changed?.framework.call_purpose, "Agree the payout partnership path");
  assert.equal(changed?.revision, call.revision + 1);
  const changedFamily = await store.updateCommitmentById(call.id, {
    title: call.title, detail: call.detail, dueOn: call.dueOn, dueTime: call.dueTime,
    priority: call.priority, taskType: "decision", goalArea: "banking", owner: "me",
    framework: { decision_needed: "Choose the payout path" },
  });
  assert.equal(changedFamily?.framework.decision_needed, "Choose the payout path");
  assert.equal(changedFamily?.framework.call_purpose, undefined);
  assert.equal(await store.mergeCommitments([call.id, decision.id]), null);
});

test("goal fields can be edited by id without exposing the success definition", async () => {
  const marker = `goal-detail-${crypto.randomBytes(4).toString("hex")}`;
  const goal = await store.addGoal({
    title: "Improve partner settlement reliability",
    detail: "Initial definition",
    targetOn: "2026-10-01",
    priority: "normal",
    goalArea: "partners",
  });
  const changed = await store.updateGoalById(goal.id, {
    title: "Eliminate partner settlement failures",
    detail: marker,
    targetOn: null,
    priority: "high",
    goalArea: "banking",
  });
  assert.deepEqual(
    [changed?.title, changed?.detail, changed?.targetOn, changed?.priority, changed?.goalArea],
    ["Eliminate partner settlement failures", marker, null, "high", "banking"],
  );
  const db = await dbModule.getDb();
  const raw = await db.query<any>("SELECT detail_enc FROM goals WHERE id = $1", [goal.id]);
  assert.ok(!String(raw.rows[0].detail_enc).includes(marker));
});

test("fifteen task labels reuse five server validation families", () => {
  assert.equal(Object.keys(taskFramework.TASK_GROUPS).length, 5);
  assert.equal(Object.keys(taskFramework.TASK_TYPE_GROUP).length, 15);
  assert.equal(taskFramework.TASK_TYPE_GROUP.call, "communication");
  assert.equal(taskFramework.TASK_TYPE_GROUP.delegate, "coordination");
  assert.equal(taskFramework.TASK_TYPE_GROUP.decision, "analysis");
  assert.equal(taskFramework.TASK_TYPE_GROUP.document, "production");
  assert.equal(taskFramework.TASK_TYPE_GROUP.personal, "personal_timing");
});

test("timezone conversion respects daylight saving time", () => {
  assert.equal(time.zonedDateTimeToUtc("2026-07-15T09:00", "America/New_York"), "2026-07-15T13:00:00.000Z");
  assert.equal(time.zonedDateTimeToUtc("2026-01-15T09:00", "America/New_York"), "2026-01-15T14:00:00.000Z");
});

test("recurrence advances daily, weekly, monthly, and quarterly dates", () => {
  assert.equal(recurrence.nextRecurrenceDate("2026-08-14", "daily"), "2026-08-15");
  assert.equal(recurrence.nextRecurrenceDate("2026-08-14", "weekly"), "2026-08-21");
  assert.equal(recurrence.nextRecurrenceDate("2027-01-31", "monthly"), "2027-02-28");
  assert.equal(recurrence.nextRecurrenceDate("2027-02-28", "monthly", "2027-01-31"), "2027-03-31");
  assert.equal(recurrence.nextRecurrenceDate("2026-11-30", "quarterly"), "2027-02-28");
});

test("completing a recurring task keeps history and creates its next occurrence", async () => {
  const marker = `Monthly close ${crypto.randomBytes(4).toString("hex")}`;
  const first = await store.addCommitment({
    title: marker,
    dueOn: "2027-01-31",
    dueTime: "09:30",
    recurrence: "monthly",
    items: [{ title: "Prepare the monthly packet", dueOn: "2027-01-30" }],
  });
  const completed = await store.closeCommitmentById(first.id);
  assert.equal(completed?.status, "done");
  assert.equal(completed?.nextDueOn, "2027-02-28");
  assert.equal((await store.commitmentDetail(first.id))?.status, "done");

  const second = (await store.openCommitments()).find((item) => item.title === marker);
  assert.deepEqual([second?.dueOn, second?.dueTime, second?.recurrence, second?.recurrenceAnchorOn],
    ["2027-02-28", "09:30", "monthly", "2027-01-31"]);
  assert.equal(second?.items[0]?.dueOn, "2027-02-28");
  const completedSecond = await store.closeCommitmentById(second!.id);
  assert.equal(completedSecond?.nextDueOn, "2027-03-31");
  assert.equal((await store.openCommitments()).filter((item) => item.title === marker).length, 1);
});

test("calendar export includes events and dated commitments", () => {
  const ics = calendar.buildCalendarIcs(
    [{ id: 1, title: "State exam", startsAt: "2026-09-14T13:00:00.000Z", endsAt: null, allDay: false, location: "Austin", entityName: null, updatedAt: "2026-08-13T12:00:00.000Z", revision: 3 }],
    [{ id: 2, title: "Submit evidence", detail: "", direction: "mine", taskType: "prepare", goalArea: "compliance", status: "open", dueOn: "2026-09-13", dueTime: "10:00", recurrence: "none", recurrenceAnchorOn: null, priority: "high", owner: "me", framework: {}, taskData: {}, waitingOn: "", nextAction: "Upload evidence", entityId: null, entityName: null, entryId: null, createdAt: "2026-08-13T12:00:00.000Z", updatedAt: "2026-08-13T13:00:00.000Z", revision: 2, completedAt: null, items: [] }],
  );
  assert.match(ics, /SUMMARY:State exam/);
  assert.match(ics, /SUMMARY:Submit evidence/);
  assert.match(ics, /X-WR-TIMEZONE:/);
  assert.match(ics, /DTSTART:20260913T140000Z/);
  assert.match(ics, /LAST-MODIFIED:20260813T130000Z/);
  assert.match(ics, /SEQUENCE:2/);
});

test("memory search includes encrypted task workflow fields", async () => {
  const marker = `bank-response-${crypto.randomBytes(4).toString("hex")}`;
  const task = await store.addCommitment({
    title: "Follow up on treasury setup",
    taskType: "follow_up",
    goalArea: "banking",
    framework: { waiting_on: marker, next_action: "Review the reply", recap: "The application is pending" },
  });
  const hits = await store.searchMemory(marker);
  assert.ok(hits.some((hit) => hit.kind === "task" && hit.id === task.id));
  assert.match(hits.find((hit) => hit.kind === "task" && hit.id === task.id)?.body || "", /Waiting on:/);
  const db = await dbModule.getDb();
  const encrypted = await db.query<any>("SELECT framework_enc FROM commitments WHERE id = $1", [task.id]);
  assert.ok(!String(encrypted.rows[0].framework_enc).includes(marker));
});

test("semantic ranking accepts only valid Ledger record ids", () => {
  assert.deepEqual(semantic.parseSemanticIds('Result: ["task:12", "fact:3", "bad", "task:12x"]'), ["task:12", "fact:3"]);
  assert.deepEqual(semantic.parseSemanticIds("not json"), []);
});

test("transport detection distinguishes insecure public addresses", () => {
  assert.equal(security.transportSecurity("http", "203.0.113.10:4321").warning, true);
  assert.equal(security.transportSecurity("http", "ledger.example.com").warning, true);
  assert.equal(security.transportSecurity("https", "203.0.113.10").warning, false);
  assert.equal(security.transportSecurity("http", "127.0.0.1:4321").warning, false);
  assert.equal(security.transportSecurity("http", "192.168.1.20").warning, false);
  assert.equal(security.transportSecurity("http", "172.20.1.4").warning, false);
});

test("secure responses include browser hardening and HSTS", () => {
  const secure = security.responseSecurityHeaders(true);
  assert.equal(secure["X-Frame-Options"], "DENY");
  assert.match(secure["Content-Security-Policy"], /script-src 'self'/);
  assert.equal(secure["Strict-Transport-Security"], "max-age=31536000");
  assert.equal(security.responseSecurityHeaders(false)["Strict-Transport-Security"], undefined);
});

test("prayer lookup builds a coordinate request and parses the six useful times", () => {
  const url = prayer.buildPrayerTimesUrl({
    date: "2026-08-13",
    latitude: 33.8082,
    longitude: -84.1702,
    method: 2,
  });
  assert.match(url, /timings\/13-08-2026/);
  assert.match(url, /latitude=33\.8082/);
  assert.match(url, /longitude=-84\.1702/);
  assert.match(url, /method=2/);

  const result = prayer.parsePrayerTimesResponse({
    code: 200,
    data: {
      timings: { Fajr: "05:12 (EDT)", Sunrise: "06:58", Dhuhr: "13:39", Asr: "17:24", Maghrib: "20:19", Isha: "22:04" },
      date: { readable: "13 Aug 2026", hijri: { day: "30", month: { en: "Safar" }, year: "1448" } },
      meta: { timezone: "America/New_York", method: { name: "ISNA" } },
    },
  }, { date: "2026-08-13", latitude: 33.8082, longitude: -84.1702 });
  assert.deepEqual(result.timings, {
    Fajr: "05:12", Sunrise: "06:58", Dhuhr: "13:39", Asr: "17:24", Maghrib: "20:19", Isha: "22:04",
  });
  assert.equal(result.method, "ISNA");
});

test("bulk Feed and Calendar clearing requires exact user confirmation and is undoable", async () => {
  const entryId = await store.addEntry("CLEAR FEED AND CALENDAR", "test");
  await store.addCommitment({ title: "Bulk clear test task", entryId });
  await store.addEvent({ title: "Bulk clear test event", startsAt: "2026-08-13T18:00:00.000Z", entryId });
  await store.addGoal({ title: "Goal survives bulk clear", entryId });

  const refused = await ledgerTools.runTool(
    "clear_feed_and_calendar",
    { confirmation: "CLEAR FEED AND CALENDAR" },
    entryId,
    { userMessage: "remove them all" },
  );
  assert.match(refused.output, /Nothing was removed/);
  assert.ok((await store.openCommitments()).some((item) => item.title === "Bulk clear test task"));

  const runId = await actions.createActionRun(entryId);
  const before = await actions.captureDataSnapshot();
  const result = await ledgerTools.runTool(
    "clear_feed_and_calendar",
    { confirmation: "CLEAR FEED AND CALENDAR" },
    entryId,
    { userMessage: "CLEAR FEED AND CALENDAR" },
  );
  await actions.recordToolStep(
    runId,
    "clear_feed_and_calendar",
    actions.idempotencyKey(entryId, "clear_feed_and_calendar", { confirmation: "CLEAR FEED AND CALENDAR" }),
    result,
    before,
  );
  await actions.finishActionRun(runId, "complete");
  assert.equal((await store.openCommitments()).length, 0);
  assert.equal((await store.allEvents()).length, 0);
  assert.ok((await store.listGoals("active", 100)).some((goal) => goal.title === "Goal survives bulk clear"));

  await actions.undoActionRun(runId);
  assert.ok((await store.openCommitments()).some((item) => item.title === "Bulk clear test task"));
  assert.ok((await store.allEvents()).some((item) => item.title === "Bulk clear test event"));
});

test("an assistant action run is idempotent and can be undone once", async () => {
  const entryId = await store.addEntry("Add one undoable task", "test");
  const runId = await actions.createActionRun(entryId);
  const key = actions.idempotencyKey(entryId, "add_commitment", { title: "Prepare undo evidence" });
  await dbModule.withTransaction(async () => {
    const before = await actions.captureDataSnapshot();
    const item = await store.addCommitment({ title: "Prepare undo evidence", entryId });
    const result = { output: `Commitment #${item.id}`, action: { label: item.title, undoRunId: runId } };
    await actions.recordToolStep(runId, "add_commitment", key, result, before);
  });
  assert.equal((await actions.priorToolResult(key))?.action?.label, "Prepare undo evidence");
  await actions.finishActionRun(runId, "complete", undefined, "Prepare undo evidence");
  assert.ok((await store.openCommitments()).some((item) => item.title === "Prepare undo evidence"));
  const undone = await actions.undoActionRun(runId);
  assert.ok(undone.changes >= 1);
  assert.ok(!(await store.openCommitments()).some((item) => item.title === "Prepare undo evidence"));
  await assert.rejects(() => actions.undoActionRun(runId), /completed|already undone/i);
});

test("undo collapses multiple changes to the same record into one safe chain", async () => {
  const entryId = await store.addEntry("Create and then reschedule one task", "test");
  const runId = await actions.createActionRun(entryId);
  let taskId = 0;
  await dbModule.withTransaction(async () => {
    let before = await actions.captureDataSnapshot();
    const item = await store.addCommitment({ title: "Chain test task", dueOn: "2026-08-20", entryId });
    taskId = item.id;
    await actions.recordToolStep(runId, "add_commitment", actions.idempotencyKey(entryId, "add_commitment", { n: 1 }), { output: "added" }, before);
    before = await actions.captureDataSnapshot();
    await store.updateCommitmentById(taskId, { title: "Renamed chain test", dueOn: "2026-08-21", priority: "high", direction: "mine" });
    await actions.recordToolStep(runId, "update_commitment", actions.idempotencyKey(entryId, "update_commitment", { n: 2 }), { output: "updated" }, before);
  });
  await actions.finishActionRun(runId, "complete");
  await actions.undoActionRun(runId);
  assert.equal(await store.commitmentDetail(taskId), null);
});

test("encrypted backup restores a verified database snapshot", async () => {
  const marker = `backup-marker-${crypto.randomBytes(4).toString("hex")}`;
  await store.addEntry(marker, "test");
  const made = await backup.createEncryptedBackup();
  assert.ok(fs.readFileSync(path.join(process.env.BACKUP_DIR!, made.name)).subarray(0, 16).toString().startsWith("LEDGER-BACKUP"));
  const extra = `after-backup-${crypto.randomBytes(4).toString("hex")}`;
  await store.addEntry(extra, "test");
  const restored = await backup.restoreEncryptedBackup(made.name);
  assert.ok(restored.records > 0);
  const restoredEntries = await store.pendingEntries(500);
  assert.ok(restoredEntries.some((entry) => entry.body === marker));
  assert.ok(!restoredEntries.some((entry) => entry.body === extra));
});
