const stream = document.getElementById("stream");
const form = document.getElementById("dumpForm");
const input = document.getElementById("dump");
const send = document.getElementById("send");
const slashMenu = document.getElementById("slashMenu");
const slashTrigger = document.getElementById("slashTrigger");
const agendaEl = document.getElementById("agenda");
const metaEl = document.getElementById("meta");
const bannerEl = document.getElementById("banner");
const clearChat = document.getElementById("clearChat");
const memorySearchForm = document.getElementById("memorySearchForm");
const memorySearch = document.getElementById("memorySearch");
const memoryResults = document.getElementById("memoryResults");
const memoryResultsTitle = document.getElementById("memoryResultsTitle");
const memoryResultCount = document.getElementById("memoryResultCount");
const memoryDetail = document.getElementById("memoryDetail");
const recentMemory = document.getElementById("recentMemory");
const reviewMemory = document.getElementById("reviewMemory");
const pendingCount = document.getElementById("pendingCount");
const calendarConnectDialog = document.getElementById("calendarConnectDialog");
const closeCalendarConnect = document.getElementById("closeCalendarConnect");
const calendarSubscriptionUrl = document.getElementById("calendarSubscriptionUrl");
const calendarConnectStatus = document.getElementById("calendarConnectStatus");
const copyCalendarUrl = document.getElementById("copyCalendarUrl");
const rotateCalendarUrl = document.getElementById("rotateCalendarUrl");
const openAppleCalendar = document.getElementById("openAppleCalendar");
const taskEditorDialog = document.getElementById("taskEditorDialog");
const closeTaskEditor = document.getElementById("closeTaskEditor");
const taskEditorForm = document.getElementById("taskEditorForm");
const taskTitle = document.getElementById("taskTitle");
const taskDueOn = document.getElementById("taskDueOn");
const taskDueTime = document.getElementById("taskDueTime");
const taskRecurrence = document.getElementById("taskRecurrence");
const taskPriority = document.getElementById("taskPriority");
const taskGoalArea = document.getElementById("taskGoalArea");
const taskType = document.getElementById("taskType");
const taskOwner = document.getElementById("taskOwner");
const taskTypeHelp = document.getElementById("taskTypeHelp");
const taskOperationalFields = document.getElementById("taskOperationalFields");
const taskFrameworkFields = document.getElementById("taskFrameworkFields");
const taskAdvancedDetails = document.getElementById("taskAdvancedDetails");
const taskDetail = document.getElementById("taskDetail");
const taskEditorError = document.getElementById("taskEditorError");
const taskSourceSummary = document.getElementById("taskSourceSummary");
const taskSourceDetails = document.getElementById("taskSourceDetails");
const taskSourceNote = document.getElementById("taskSourceNote");
const taskItemsList = document.getElementById("taskItemsList");
const taskItemForm = document.getElementById("taskItemForm");
const taskItemTitle = document.getElementById("taskItemTitle");
const taskMergeSelect = document.getElementById("taskMergeSelect");
const mergeTaskButton = document.getElementById("mergeTask");

const settingsButton = document.getElementById("settings");
const settingsDialog = document.getElementById("settingsDialog");
const closeSettings = document.getElementById("closeSettings");
const settingsForm = document.getElementById("settingsForm");
const passwordForm = document.getElementById("passwordForm");
const vaultForm = document.getElementById("vaultForm");
const vaultPath = document.getElementById("vaultPath");
const vaultStatus = document.getElementById("vaultStatus");
const vaultError = document.getElementById("vaultError");
const syncVaultButton = document.getElementById("syncVault");
const consolidateDuplicatesButton = document.getElementById("consolidateDuplicates");
const maintenanceStatus = document.getElementById("maintenanceStatus");
const modelName = document.getElementById("modelName");
const modelDetails = document.getElementById("modelDetails");
const accessNote = document.getElementById("accessNote");
const modelHost = document.getElementById("modelHost");
const keyStatus = document.getElementById("keyStatus");
const keyHelp = document.getElementById("keyHelp");
const settingsError = document.getElementById("settingsError");
const saveSettings = document.getElementById("saveSettings");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const passwordError = document.getElementById("passwordError");
const changePassword = document.getElementById("changePassword");
const connectionSecurityStatus = document.getElementById("connectionSecurityStatus");
const connectionSecurityAddress = document.getElementById("connectionSecurityAddress");
const connectionSecurityDetail = document.getElementById("connectionSecurityDetail");
const createBackupButton = document.getElementById("createBackup");
const backupSelect = document.getElementById("backupSelect");
const downloadBackup = document.getElementById("downloadBackup");
const restoreBackupButton = document.getElementById("restoreBackup");
const backupPassword = document.getElementById("backupPassword");
const backupConfirmation = document.getElementById("backupConfirmation");
const backupError = document.getElementById("backupError");
const backupStatus = document.getElementById("backupStatus");
const backupRetention = document.getElementById("backupRetention");
const prayerSettingsForm = document.getElementById("prayerSettingsForm");
const prayerLatitude = document.getElementById("prayerLatitude");
const prayerLongitude = document.getElementById("prayerLongitude");
const prayerMethod = document.getElementById("prayerMethod");
const prayerSummary = document.getElementById("prayerSummary");
const prayerDate = document.getElementById("prayerDate");
const prayerMeta = document.getElementById("prayerMeta");
const prayerTimes = document.getElementById("prayerTimes");
const prayerStatus = document.getElementById("prayerStatus");
const prayerError = document.getElementById("prayerError");
const refreshPrayerTimesButton = document.getElementById("refreshPrayerTimes");
const savePrayerSettingsButton = document.getElementById("savePrayerSettings");

let view = "overview";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarDisplay = "month";
let selectedCalendarDate = "";
let refreshRequest = 0;
let activeArea = "capture";
let memoryLoaded = false;
let currentModel = "";
let bannerTimer;
let currentTaskId = null;
let taskFrameworkCatalogData = null;
let currentTaskFramework = {};
let slashMenuOpen = false;
let slashSelection = 0;

const GOAL_AREA_OPTIONS = [
  "company", "digital", "compliance", "agents", "partners", "banking", "growth", "team",
  "personal_finance", "personal_health_family",
].map((value) => ({
  value,
  label: value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
}));
const GOAL_PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

const slashCommands = [
  {
    command: "/today",
    label: "Plan today",
    description: "Order what needs your attention.",
    prompt: "Review today's calendar, open tasks, overdue work, and waiting-on commitments. Tell me the order to handle them.",
  },
  {
    command: "/task",
    label: "Draft a task",
    description: "Specify an action, outcome, owner, and date.",
    prompt: "Create a task to [action and outcome] by [date]. It is owned by [me or person] and relates to [project or subject].",
  },
  {
    command: "/goal",
    label: "Clarify a goal",
    description: "Shape an outcome before adding it manually.",
    prompt: "Help me clarify this goal without creating it: [outcome]. Define measurable success and a realistic target date.",
  },
  {
    command: "/remember",
    label: "Remember context",
    description: "File a fact, decision, preference, or lesson.",
    prompt: "Remember this about [person, project, or topic]: [fact, decision, lesson, or preference].",
  },
  {
    command: "/waiting",
    label: "Check waiting on",
    description: "Find promises owed to you.",
    prompt: "Show what other people owe me, what has gone quiet, and the next follow-up I should send.",
  },
  {
    command: "/review",
    label: "Find inconsistencies",
    description: "Check Calendar, Feed, and goals without changing them.",
    prompt: "Review my calendar, tasks, commitments, and active goals for inconsistencies. Do not change anything. Tell me what needs a decision.",
  },
  {
    command: "/accountability",
    label: "Accountability review",
    description: "Compare promises with evidence of execution.",
    prompt: "Give me an evidence-based accountability review for the last 7 days. Compare commitments with completions, separate facts from inferences, identify repeated delays and neglected goals, and end with one specific next action. Be direct and unbiased. Do not shame or speculate.",
  },
  {
    command: "/prayer",
    label: "Prayer times",
    description: "Fetch today's cached or live calculation.",
    prompt: "Fetch today's prayer times for my saved location. Show the calculation method and timezone. Do not add them to my calendar.",
  },
];

const pad = (number) => String(number).padStart(2, "0");
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const todayISO = () => isoOf(new Date());
selectedCalendarDate = todayISO();

function dayLabel(iso) {
  const today = todayISO();
  if (iso === today) return "Today";
  const delta = Math.round((new Date(`${iso}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendSelectOptions(select, options, selectedValue = "") {
  for (const { value, label } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue;
    select.append(option);
  }
}

function labeledGoalControl(labelText, control) {
  const label = el("label", "settings__label", labelText);
  label.append(control);
  return label;
}

function showBanner(message, tone = "success") {
  bannerEl.textContent = message;
  bannerEl.dataset.tone = tone;
  bannerEl.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    bannerEl.hidden = true;
  }, 4500);
}

function switchSettingsView(name) {
  for (const button of document.querySelectorAll("[data-settings-view]")) {
    const selected = button.dataset.settingsView === name;
    button.classList.toggle("is-on", selected);
    button.setAttribute("aria-selected", String(selected));
  }
  for (const panel of document.querySelectorAll("[data-settings-panel]")) {
    panel.hidden = panel.dataset.settingsPanel !== name;
  }
  if (name === "backup") void loadBackups();
}

const readableBytes = (value) => value < 1024 * 1024
  ? `${Math.max(1, Math.round(value / 1024))} KB`
  : `${(value / 1024 / 1024).toFixed(1)} MB`;

async function loadBackups() {
  backupError.textContent = "";
  try {
    const response = await fetch("/api/backups");
    const data = await response.json();
    if (response.status === 401) return (location.href = "/");
    if (!response.ok) throw new Error(data.error || "Could not load backups.");
    backupSelect.textContent = "";
    for (const backup of data.backups) {
      const option = document.createElement("option");
      option.value = backup.name;
      option.textContent = `${readableDate(backup.createdAt)} at ${new Date(backup.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${readableBytes(backup.size)})`;
      backupSelect.append(option);
    }
    if (!data.backups.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No backups yet";
      backupSelect.append(option);
    }
    backupRetention.textContent = `Keeps the latest ${data.retention} backups on this server.`;
    updateBackupDownload();
  } catch (error) {
    backupError.textContent = error.message;
  }
}

function updateBackupDownload() {
  const name = backupSelect.value;
  downloadBackup.href = name ? `/api/backups/${encodeURIComponent(name)}/download` : "#";
  downloadBackup.setAttribute("aria-disabled", String(!name));
}

backupSelect.addEventListener("change", updateBackupDownload);

createBackupButton.addEventListener("click", async () => {
  createBackupButton.disabled = true;
  backupError.textContent = "";
  try {
    const response = await fetch("/api/backups", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create a backup.");
    backupStatus.textContent = `Created ${data.name} (${readableBytes(data.size)}).`;
    await loadBackups();
  } catch (error) {
    backupError.textContent = error.message;
  } finally {
    createBackupButton.disabled = false;
  }
});

restoreBackupButton.addEventListener("click", async () => {
  const name = backupSelect.value;
  if (!name) return (backupError.textContent = "Choose a backup first.");
  if (!confirm("Restore this backup and replace the current Ledger database?")) return;
  restoreBackupButton.disabled = true;
  backupError.textContent = "";
  try {
    const response = await fetch(`/api/backups/${encodeURIComponent(name)}/restore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: backupPassword.value, confirmation: backupConfirmation.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not restore the backup.");
    backupPassword.value = "";
    backupConfirmation.value = "";
    backupStatus.textContent = `Restored ${data.records} records. Reloading Ledger.`;
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    backupError.textContent = error.message;
    restoreBackupButton.disabled = false;
  }
});

function showSelectedModelDetails() {
  const option = modelName.selectedOptions[0];
  modelDetails.textContent = option?.dataset.details || "";
  modelDetails.classList.toggle("is-retired", option?.dataset.status === "retired");
}

function renderPrayerSettings(prayer) {
  prayerLatitude.value = prayer?.latitude ?? "";
  prayerLongitude.value = prayer?.longitude ?? "";
  prayerMethod.value = prayer?.method ?? "";
  const snapshot = prayer?.snapshot;
  prayerSummary.hidden = !snapshot;
  prayerTimes.textContent = "";
  if (!snapshot) {
    prayerStatus.textContent = prayer?.configured
      ? "Configured. Select Refresh now to fetch today's times."
      : "Enter coordinates, then save to start the daily refresh.";
    return;
  }
  const result = snapshot.result;
  prayerDate.textContent = `${result.readableDate}${result.hijriDate ? ` | ${result.hijriDate}` : ""}`;
  prayerMeta.textContent = `${result.timezone} | ${result.method}`;
  for (const name of ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]) {
    prayerTimes.append(el("div", "prayer-time", undefined));
    const row = prayerTimes.lastElementChild;
    row.append(el("dt", null, name), el("dd", null, result.timings[name]));
  }
  const fetched = new Date(snapshot.fetchedAt);
  prayerStatus.textContent = `Last refreshed ${fetched.toLocaleDateString()} at ${fetched.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Ledger checks hourly and fetches once per day.`;
}

function renderConnectionSecurity(status) {
  if (!status) {
    connectionSecurityStatus.textContent = "Unavailable";
    connectionSecurityStatus.dataset.tone = "neutral";
    connectionSecurityAddress.textContent = "Connection status could not be loaded.";
    connectionSecurityDetail.textContent = "Reload Settings to check again.";
    return;
  }
  connectionSecurityAddress.textContent = status.host ? `Connected through ${status.host}.` : "Connection address unavailable.";
  if (status.secure) {
    connectionSecurityStatus.textContent = "Secure HTTPS";
    connectionSecurityStatus.dataset.tone = "secure";
    connectionSecurityDetail.textContent = "Your password and Ledger traffic are encrypted between this browser and the server.";
  } else if (status.publicAddress) {
    connectionSecurityStatus.textContent = "Public HTTP";
    connectionSecurityStatus.dataset.tone = "warning";
    connectionSecurityDetail.textContent = "Traffic is not encrypted in transit. Avoid sensitive entries until HTTPS is configured.";
  } else {
    connectionSecurityStatus.textContent = "Private/local HTTP";
    connectionSecurityStatus.dataset.tone = "neutral";
    connectionSecurityDetail.textContent = "Traffic is not encrypted, but this address is on a local or private network.";
  }
}

async function openSettings() {
  switchSettingsView("model");
  settingsError.textContent = "";
  passwordError.textContent = "";
  vaultError.textContent = "";
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  modelDetails.textContent = "";
  accessNote.textContent = "";
  modelName.textContent = "";
  modelName.disabled = true;
  saveSettings.disabled = true;
  renderConnectionSecurity(null);
  settingsDialog.showModal();

  try {
    const securityRequest = fetch("/api/security", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
    const response = await fetch("/api/settings");
    if (response.status === 401) return (location.href = "/");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load settings.");

    currentModel = data.model;
    modelHost.textContent = data.host;
    keyStatus.textContent = data.hasApiKey ? "Configured" : "Missing";
    keyStatus.classList.toggle("is-missing", !data.hasApiKey);
    keyHelp.textContent = data.hasApiKey
      ? `${data.models.length} available models loaded from Ollama.`
      : "Add OLLAMA_API_KEY to .env and restart Ledger before filing notes.";
    vaultPath.value = data.vaultDir || "";
    vaultStatus.textContent = data.vaultSync
      ? `${data.vaultSync.files} Markdown files synchronized. Last sync ${readableDate(data.vaultSync.syncedAt)}.`
      : data.vaultDir
        ? "Vault configured. Synchronize to refresh its files."
        : "No vault synchronized.";
    renderPrayerSettings(data.prayer);
    renderConnectionSecurity(await securityRequest);

    const activeModels = data.models || [];
    const currentIsActive = activeModels.some((model) => model.name === data.model);
    if (!currentIsActive) {
      const option = document.createElement("option");
      option.value = data.model;
      option.textContent = `${data.model} | Current, unavailable`;
      option.dataset.details = "This model is not in the host's live catalog. Choose an active model below.";
      option.dataset.status = "retired";
      modelName.append(option);
    }

    const activeGroup = document.createElement("optgroup");
    activeGroup.label = activeModels[0]?.location === "Local" ? "Installed local models" : "Active cloud models";
    for (const model of activeModels) {
      const option = document.createElement("option");
      option.value = model.name;
      option.textContent = `${model.name} | ${model.location}, ${model.status}, ${model.access}, ${model.usage} usage`;
      option.dataset.details = `${model.location} | ${model.status} | ${model.access} | ${model.usage} usage`;
      option.dataset.status = "active";
      activeGroup.append(option);
    }
    modelName.append(activeGroup);

    if (data.retiredModels?.length) {
      const retiredGroup = document.createElement("optgroup");
      retiredGroup.label = "Retired cloud models, unavailable";
      for (const model of data.retiredModels) {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = `${model.name} | Retired ${model.retiredOn}${model.replacement ? `, use ${model.replacement}` : ""}`;
        option.disabled = true;
        option.dataset.status = "retired";
        retiredGroup.append(option);
      }
      modelName.append(retiredGroup);
    }

    modelName.value = data.model;
    accessNote.textContent = data.accessNote || "";
    showSelectedModelDetails();
    modelName.disabled = false;
    saveSettings.disabled = false;
  } catch (error) {
    settingsError.textContent = error.message;
  }
}

settingsButton.addEventListener("click", openSettings);
closeSettings.addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
modelName.addEventListener("change", showSelectedModelDetails);

for (const button of document.querySelectorAll("[data-settings-view]")) {
  button.addEventListener("click", () => switchSettingsView(button.dataset.settingsView));
}

document.querySelector("[data-model='gpt-oss:120b']").addEventListener("click", () => {
  const recommended = [...modelName.options].find((option) => option.value === "gpt-oss:120b");
  if (recommended) {
    modelName.value = recommended.value;
    showSelectedModelDetails();
  }
  modelName.focus();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsError.textContent = "";
  saveSettings.disabled = true;
  saveSettings.textContent = "Saving";
  try {
    const response = await fetch("/api/settings/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save the model.");
    const previousModel = currentModel;
    currentModel = data.model;
    metaEl.title = currentModel;
    if (!metaEl.textContent || metaEl.textContent === "Offline" || metaEl.textContent === previousModel) {
      metaEl.textContent = currentModel;
    }
    settingsDialog.close();
    showBanner(`Model changed to ${currentModel}. New notes use it immediately.`);
  } catch (error) {
    settingsError.textContent = error.message;
  } finally {
    saveSettings.disabled = false;
    saveSettings.textContent = "Save model";
  }
});

prayerSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  prayerError.textContent = "";
  savePrayerSettingsButton.disabled = true;
  refreshPrayerTimesButton.disabled = true;
  savePrayerSettingsButton.textContent = "Fetching";
  try {
    const response = await fetch("/api/settings/prayer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: prayerLatitude.value,
        longitude: prayerLongitude.value,
        method: prayerMethod.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save prayer settings.");
    renderPrayerSettings(data);
    showBanner("Prayer settings saved and today's times refreshed.");
  } catch (error) {
    prayerError.textContent = error.message;
  } finally {
    savePrayerSettingsButton.disabled = false;
    refreshPrayerTimesButton.disabled = false;
    savePrayerSettingsButton.textContent = "Save and fetch";
  }
});

refreshPrayerTimesButton.addEventListener("click", async () => {
  prayerError.textContent = "";
  refreshPrayerTimesButton.disabled = true;
  refreshPrayerTimesButton.textContent = "Fetching";
  try {
    const response = await fetch("/api/prayer-times/refresh", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not refresh prayer times.");
    renderPrayerSettings(data);
    showBanner("Today's prayer times refreshed.");
  } catch (error) {
    prayerError.textContent = error.message;
  } finally {
    refreshPrayerTimesButton.disabled = false;
    refreshPrayerTimesButton.textContent = "Refresh now";
  }
});

vaultForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  vaultError.textContent = "";
  syncVaultButton.disabled = true;
  syncVaultButton.textContent = "Synchronizing";
  try {
    const response = await fetch("/api/settings/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: vaultPath.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not synchronize the vault.");
    vaultPath.value = data.vaultDir;
    vaultStatus.textContent = `${data.vaultSync.files} Markdown files synchronized. ${data.vaultSync.created} added, ${data.vaultSync.updated} refreshed, ${data.vaultSync.skipped} skipped.`;
    memoryLoaded = false;
    showBanner(`Vault synchronized: ${data.vaultSync.files} Markdown files are searchable.`);
  } catch (error) {
    vaultError.textContent = error.message;
  } finally {
    syncVaultButton.disabled = false;
    syncVaultButton.textContent = "Sync vault";
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordError.textContent = "";
  if (newPassword.value.length < 10) {
    passwordError.textContent = "New password must be at least 10 characters.";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.textContent = "New passwords do not match.";
    return;
  }

  changePassword.disabled = true;
  changePassword.textContent = "Changing";
  try {
    const response = await fetch("/api/settings/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
        confirmation: confirmPassword.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not change the password.");
    passwordForm.reset();
    settingsDialog.close();
    showBanner(`Password saved. This browser stays signed in for ${data.sessionDays} days.`);
  } catch (error) {
    passwordError.textContent = error.message;
  } finally {
    changePassword.disabled = false;
    changePassword.textContent = "Change password";
  }
});

function trackViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const apply = () => {
    document.documentElement.style.setProperty("--vh", `${Math.round(viewport.height)}px`);
  };
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  apply();
}

function setArea(name, updateHash = true) {
  if (!document.querySelector(`[data-area="${name}"]`)) name = "capture";
  activeArea = name;
  for (const section of document.querySelectorAll("[data-area]")) section.hidden = section.dataset.area !== name;
  for (const button of document.querySelectorAll("[data-area-target]")) {
    const selected = button.dataset.areaTarget === name;
    button.classList.toggle("is-on", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (updateHash) history.replaceState(null, "", `#${name}`);
  if (name === "memory" && !memoryLoaded) loadMemory();
  if (name === "feed") refresh();
  if (name === "capture") requestAnimationFrame(() => input.focus());
}

for (const button of document.querySelectorAll("[data-area-target]")) {
  button.addEventListener("click", () => setArea(button.dataset.areaTarget));
}

function showEmptyState() {
  if (stream.querySelector(".msg")) return;
  const empty = el("section", "empty");
  empty.append(
    el("h3", null, "What should Ledger handle?"),
    el("p", null, "Give it an instruction or ask a question. Ledger will use your memory and show every change."),
  );
  const examples = el("div", "empty__examples");
  examples.setAttribute("aria-label", "Example instructions");
  const prompts = [
    ["Plan my day", "What needs my attention today? Give me the order to handle it."],
    ["Change a task", "Move the Texas exam preparation task to Friday and make it high priority"],
    ["Remember context", "Remember that Dana prefers due diligence updates by email"],
    ["Review progress", "Review my active goals and tell me what is at risk"],
  ];
  for (const [label, prompt] of prompts) {
    const button = el("button", null, label);
    button.type = "button";
    button.addEventListener("click", () => fillPrompt(prompt));
    examples.append(button);
  }
  empty.append(examples);
  stream.append(empty);
  clearChat.hidden = true;
}

function syncChatControls() {
  clearChat.hidden = !stream.querySelector(".msg[data-message-id]");
}

function attachDeleteControl(card, id) {
  if (!id || card.querySelector(".msg__delete")) return;
  card.dataset.messageId = String(id);
  const button = el("button", "msg__delete", "Delete");
  button.type = "button";
  button.setAttribute("aria-label", "Delete this chat item");
  button.addEventListener("click", async () => {
    if (!confirm("Delete this chat item? Ledger's structured records will remain.")) return;
    button.disabled = true;
    try {
      const response = await fetch(`/api/messages/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (response.status === 401) return (location.href = "/");
      if (!response.ok) throw new Error(data.error || "Could not delete this chat item.");
      card.remove();
      syncChatControls();
      showEmptyState();
      showBanner("Chat item deleted. Structured memory was kept.");
    } catch (error) {
      button.disabled = false;
      showBanner(error.message, "error");
    }
  });
  card.querySelector(".msg__tools").append(button);
  syncChatControls();
}

function setCaptureStatus(card, text, tone = "saved") {
  let status = card.querySelector(".msg__status");
  if (!status) {
    status = el("span", "msg__status");
    card.querySelector(".msg__tools").prepend(status);
  }
  status.textContent = text;
  status.dataset.tone = tone;
}

function addMessage({ id, role, content, actions = [], at, status }) {
  stream.querySelector(".empty")?.remove();
  const isUser = role === "user";
  const card = el("article", `msg msg--${isUser ? "you" : "ledger"}`);
  const header = el("header", "msg__head");
  header.append(el("span", "msg__who", isUser ? "You" : "Ledger"));
  const tools = el("div", "msg__tools");
  if (at) tools.append(el("time", "msg__time", at.slice(11, 16)));
  header.append(tools);
  card.append(header, el("div", "msg__text", content));

  if (actions.length) {
    const strip = el("div", "stamps");
    strip.append(el("span", "stamps__label", "Changes made"));
    for (const action of actions) strip.append(el("span", "stamp", action.label));
    const undoRunId = actions.find((action) => action.undoRunId)?.undoRunId;
    if (undoRunId) {
      const undo = el("button", "stamps__undo", "Undo changes");
      undo.type = "button";
      undo.addEventListener("click", async () => {
        if (!confirm("Undo every change Ledger made from this instruction?")) return;
        undo.disabled = true;
        try {
          const response = await fetch(`/api/actions/${undoRunId}/undo`, { method: "POST" });
          const data = await response.json();
          if (response.status === 401) return (location.href = "/");
          if (!response.ok) throw new Error(data.error || "Could not undo those changes.");
          undo.textContent = "Undone";
          showBanner(`${data.changes} record changes undone.`);
          refresh();
          if (memoryLoaded) loadRecentMemory();
        } catch (error) {
          undo.disabled = false;
          showBanner(error.message, "error");
        }
      });
      strip.append(undo);
    }
    card.append(strip);
  }

  stream.append(card);
  attachDeleteControl(card, id);
  if (status) setCaptureStatus(card, status, status === "Done" ? "filed" : "saved");
  stream.scrollTop = stream.scrollHeight;
  return card;
}

clearChat.addEventListener("click", async () => {
  if (!confirm("Clear the entire chat history? Ledger's structured records will remain.")) return;
  clearChat.disabled = true;
  try {
    const response = await fetch("/api/messages", { method: "DELETE" });
    const data = await response.json();
    if (response.status === 401) return (location.href = "/");
    if (!response.ok) throw new Error(data.error || "Could not clear chat history.");
    stream.querySelectorAll(".msg, .thinking").forEach((node) => node.remove());
    showEmptyState();
    showBanner(`Chat cleared (${data.deleted} items). Structured records were kept.`);
  } catch (error) {
    showBanner(error.message, "error");
  } finally {
    clearChat.disabled = false;
  }
});

const memoryKindLabels = {
  entry: "Original note",
  fact: "Knowledge",
  entity: "Person or project",
  task: "Commitment",
  goal: "Goal",
  event: "Event",
};
let currentMemoryHit = null;

function readableDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function setMemoryFilter(mode) {
  recentMemory.classList.toggle("is-on", mode === "recent");
  reviewMemory.classList.toggle("is-on", mode === "review");
}

function renderMemoryLoading() {
  memoryResults.textContent = "";
  for (let index = 0; index < 4; index += 1) {
    const row = el("div", "memory-skeleton");
    row.append(el("span"), el("span"), el("span"));
    memoryResults.append(row);
  }
  memoryResultCount.textContent = "";
}

function renderMemoryEmpty(title, text) {
  memoryResults.textContent = "";
  const empty = el("div", "memory-results__empty");
  empty.append(el("h4", null, title), el("p", null, text));
  memoryResults.append(empty);
  memoryResultCount.textContent = "0";
}

function memoryHitButton(hit) {
  const button = el("button", "memory-hit");
  button.type = "button";
  const top = el("span", "memory-hit__top");
  const kind = el("span", "memory-hit__kind", memoryKindLabels[hit.kind] || hit.kind);
  if (hit.match === "related") kind.append(el("span", "memory-hit__match", "Related"));
  top.append(kind, el("time", null, readableDate(hit.createdAt)));
  button.append(top, el("strong", null, hit.title));
  if (hit.body) button.append(el("span", "memory-hit__body", hit.body));
  if (hit.context) button.append(el("span", "memory-hit__context", hit.context));
  button.addEventListener("click", () => openMemoryHit(hit, button));
  return button;
}

function renderMemoryHits(hits) {
  memoryResults.textContent = "";
  memoryResultCount.textContent = String(hits.length);
  if (!hits.length) return renderMemoryEmpty("Nothing found", "Try a person, project, commitment, or idea from a note.");
  for (const hit of hits) memoryResults.append(memoryHitButton(hit));
}

async function refreshPendingCount() {
  try {
    const response = await fetch("/api/memory/inbox");
    if (!response.ok) return;
    const pending = await response.json();
    pendingCount.textContent = String(pending.length);
    pendingCount.hidden = !pending.length;
  } catch {
    // The main connection state already communicates server failures.
  }
}

async function loadMemory(query = "") {
  memoryLoaded = true;
  setMemoryFilter("recent");
  memoryResultsTitle.textContent = query ? `Results for “${query}”` : "Recent memory";
  renderMemoryLoading();
  try {
    const response = await fetch(`/api/memory/search?q=${encodeURIComponent(query)}`);
    if (response.status === 401) return (location.href = "/");
    if (!response.ok) throw new Error("Could not search memory.");
    renderMemoryHits(await response.json());
  } catch (error) {
    renderMemoryEmpty("Memory is unavailable", error.message);
  }
  refreshPendingCount();
}

async function loadInbox() {
  setMemoryFilter("review");
  memoryResultsTitle.textContent = "Needs review";
  renderMemoryLoading();
  try {
    const response = await fetch("/api/memory/inbox");
    if (response.status === 401) return (location.href = "/");
    if (!response.ok) throw new Error("Could not load notes that need review.");
    const entries = await response.json();
    renderMemoryHits(entries.map((entry) => ({
      kind: "entry",
      id: entry.id,
      title: "Saved, not filed",
      body: entry.body,
      context: "Retry when the model is available",
      createdAt: entry.createdAt,
    })));
    pendingCount.textContent = String(entries.length);
    pendingCount.hidden = !entries.length;
  } catch (error) {
    renderMemoryEmpty("Inbox is unavailable", error.message);
  }
}

function detailHeading(label, title, context) {
  const header = el("header", "memory-detail__head");
  header.append(el("p", null, label), el("h3", null, title));
  if (context) header.append(el("span", null, context));
  return header;
}

function detailSection(title, items, renderer) {
  if (!items?.length) return null;
  const section = el("section", "memory-detail__section");
  section.append(el("h4", null, `${title} (${items.length})`));
  const list = el("div", "memory-detail__list");
  for (const item of items) list.append(renderer(item));
  section.append(list);
  return section;
}

function compactRecord(title, body, meta) {
  const record = el("article", "memory-record");
  record.append(el("strong", null, title));
  if (body) record.append(el("p", null, body));
  if (meta) record.append(el("span", null, meta));
  return record;
}

function editableFact(fact, reload) {
  const record = compactRecord(fact.label, fact.body, fact.entityName || "Stored knowledge");
  record.classList.add("memory-record--editable");
  const actions = el("div", "memory-record__actions");
  const edit = el("button", null, "Edit");
  const remove = el("button", null, "Delete");
  edit.type = remove.type = "button";

  edit.addEventListener("click", () => {
    const form = el("form", "fact-editor");
    const label = el("input");
    label.value = fact.label;
    label.setAttribute("aria-label", "Memory label");
    const body = el("textarea");
    body.value = fact.body;
    body.rows = 4;
    body.setAttribute("aria-label", "Memory detail");
    const controls = el("div", "fact-editor__actions");
    const save = el("button", null, "Save");
    const cancel = el("button", null, "Cancel");
    save.type = "submit";
    cancel.type = "button";
    controls.append(cancel, save);
    form.append(label, body, controls);
    cancel.addEventListener("click", () => reload("refresh"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      const response = await fetch(`/api/memory/fact/${fact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.value, body: body.value }),
      });
      const data = await response.json();
      if (!response.ok) {
        save.disabled = false;
        return showBanner(data.error || "Could not update that memory.", "error");
      }
      showBanner("Memory updated.");
      reload("refresh", data);
      loadMemory(memorySearch.value.trim());
    });
    record.replaceChildren(form);
    label.focus();
  });

  remove.addEventListener("click", async () => {
    if (!confirm("Delete this stored memory? The original note will remain.")) return;
    remove.disabled = true;
    const response = await fetch(`/api/memory/fact/${fact.id}`, { method: "DELETE" });
    if (!response.ok) {
      remove.disabled = false;
      return showBanner("Could not delete that memory.", "error");
    }
    showBanner("Stored memory deleted. Original note kept.");
    reload("deleted");
    loadMemory(memorySearch.value.trim());
  });
  actions.append(edit, remove);
  record.append(actions);
  return record;
}

function renderEntityDetail(data) {
  memoryDetail.textContent = "";
  const { entity } = data;
  memoryDetail.append(detailHeading(entity.kind, entity.name, [entity.status, entity.country].filter(Boolean).join(" / ")));
  if (entity.notes) memoryDetail.append(el("p", "memory-detail__summary", entity.notes));
  const reload = () => openMemoryHit(currentMemoryHit);
  const sections = [
    detailSection("Knowledge", data.facts, (fact) => editableFact(fact, reload)),
    detailSection("Tasks and promises", data.tasks, (task) => compactRecord(task.title, task.detail, [task.status, task.dueOn].filter(Boolean).join(" / "))),
    detailSection("Goals", data.goals, (goal) => compactRecord(goal.title, goal.detail, [goal.status, goal.targetOn].filter(Boolean).join(" / "))),
    detailSection("Dates", data.events, (event) => compactRecord(event.title, "", [event.startsAt?.slice(0, 16).replace("T", " "), event.location].filter(Boolean).join(" / "))),
  ].filter(Boolean);
  if (sections.length) memoryDetail.append(...sections);
  else memoryDetail.append(el("p", "memory-detail__empty-copy", "Nothing is attached to this subject yet."));
}

function extractedCount(data) {
  return [data.facts, data.tasks, data.goals, data.events].reduce((sum, items) => sum + (items?.length || 0), 0);
}

function renderEntryDetail(data) {
  memoryDetail.textContent = "";
  const fromVault = data.entry.source?.startsWith("vault:");
  const sourcePath = fromVault ? data.entry.source.slice(6) : "";
  const title = fromVault ? sourcePath.split("/").at(-1).replace(/\.md$/i, "") : readableDate(data.entry.createdAt);
  const status = fromVault ? sourcePath : data.entry.processed ? "Filed" : "Needs review";
  memoryDetail.append(detailHeading(fromVault ? "Vault note" : "Original note", title, status));
  memoryDetail.append(el("p", "memory-detail__source", data.entry.body));

  const controls = el("div", "memory-detail__actions");
  if (!data.entry.processed) {
    const retry = el("button", "memory-detail__primary", "Retry filing");
    retry.type = "button";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      retry.textContent = "Filing";
      const response = await fetch(`/api/memory/entry/${data.entry.id}/retry`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        retry.disabled = false;
        retry.textContent = "Retry filing";
        return showBanner(result.error || "Could not file this note.", "error");
      }
      addMessage({ id: result.assistantMessageId, role: "assistant", content: result.reply, actions: result.actions, at: new Date().toISOString() });
      showBanner("Saved note filed successfully.");
      await refreshPendingCount();
      await openMemoryHit(currentMemoryHit);
    });
    controls.append(retry);
  }
  if (extractedCount(data)) {
    const undo = el("button", "memory-detail__danger", "Undo filing");
    undo.type = "button";
    undo.addEventListener("click", async () => {
      if (!confirm("Remove the facts, tasks, goals, and dates filed from this note? The original note will remain.")) return;
      undo.disabled = true;
      const response = await fetch(`/api/memory/entry/${data.entry.id}/extractions`, { method: "DELETE" });
      if (!response.ok) {
        undo.disabled = false;
        return showBanner("Could not undo this filing.", "error");
      }
      showBanner("Filing undone. Original note kept for review.");
      await refreshPendingCount();
      await openMemoryHit(currentMemoryHit);
      loadMemory(memorySearch.value.trim());
    });
    controls.append(undo);
  }
  if (controls.children.length) memoryDetail.append(controls);

  const reload = () => openMemoryHit(currentMemoryHit);
  const sections = [
    detailSection("Knowledge", data.facts, (fact) => editableFact(fact, reload)),
    detailSection("Tasks and promises", data.tasks, (task) => compactRecord(task.title, task.detail, [task.direction, task.dueOn].filter(Boolean).join(" / "))),
    detailSection("Goals", data.goals, (goal) => compactRecord(goal.title, goal.detail, [goal.status, goal.targetOn].filter(Boolean).join(" / "))),
    detailSection("Dates", data.events, (event) => compactRecord(event.title, "", [event.startsAt?.slice(0, 16).replace("T", " "), event.location].filter(Boolean).join(" / "))),
  ].filter(Boolean);
  if (sections.length) memoryDetail.append(...sections);
  else memoryDetail.append(el("p", "memory-detail__empty-copy", data.entry.processed ? "No structured records were created from this note." : "This note is safely stored and waiting to be filed."));
}

function renderGenericDetail(hit) {
  memoryDetail.textContent = "";
  memoryDetail.append(detailHeading(memoryKindLabels[hit.kind] || hit.kind, hit.title, hit.context));
  if (hit.body) memoryDetail.append(el("p", "memory-detail__source", hit.body));
}

function renderFactDetail(fact) {
  memoryDetail.textContent = "";
  memoryDetail.append(detailHeading("Stored knowledge", fact.label, fact.entityName || "Private memory"));
  const reload = async (action) => {
    if (action === "deleted") {
      currentMemoryHit = null;
      memoryDetail.textContent = "";
      memoryDetail.append(detailHeading("Stored knowledge", "Memory deleted", "The original note remains available."));
      return;
    }
    await openMemoryHit(currentMemoryHit);
  };
  memoryDetail.append(editableFact(fact, reload));
}

async function openMemoryHit(hit, selectedButton) {
  currentMemoryHit = hit;
  for (const button of memoryResults.querySelectorAll(".memory-hit")) button.classList.toggle("is-on", button === selectedButton);
  memoryDetail.textContent = "";
  memoryDetail.append(el("div", "memory-detail__loading", "Loading memory"));
  if (window.innerWidth <= 699) requestAnimationFrame(() => memoryDetail.scrollIntoView({ behavior: "smooth", block: "start" }));
  try {
    if (hit.kind === "entity") {
      const response = await fetch(`/api/entity/${hit.id}`);
      if (!response.ok) throw new Error("Could not load this memory subject.");
      return renderEntityDetail(await response.json());
    }
    if (hit.kind === "entry") {
      const response = await fetch(`/api/memory/entry/${hit.id}`);
      if (!response.ok) throw new Error("Could not load this original note.");
      return renderEntryDetail(await response.json());
    }
    if (hit.kind === "fact") {
      const response = await fetch(`/api/memory/fact/${hit.id}`);
      if (!response.ok) throw new Error("Could not load this stored memory.");
      return renderFactDetail(await response.json());
    }
    renderGenericDetail(hit);
  } catch (error) {
    memoryDetail.textContent = "";
    memoryDetail.append(detailHeading("Unavailable", "Could not open this memory", error.message));
  }
}

memorySearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadMemory(memorySearch.value.trim());
});
recentMemory.addEventListener("click", () => {
  memorySearch.value = "";
  loadMemory();
});
reviewMemory.addEventListener("click", loadInbox);

function addError(text) {
  const card = el("div", "msg msg--error");
  card.append(el("strong", null, "Ledger could not finish"), el("span", null, text));
  stream.append(card);
  stream.scrollTop = stream.scrollHeight;
}

function renderAgenda(agenda) {
  agendaEl.classList.remove("agenda--calendar");
  agendaEl.textContent = "";
  const today = todayISO();
  const days = new Map();
  const push = (date, row) => {
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(row);
  };

  if (agenda.overdue.length) {
    const block = el("section", "day day--late");
    block.append(el("h3", "day__label", `Overdue (${agenda.overdue.length})`));
    for (const commitment of agenda.overdue) block.append(commitmentRow(commitment, true));
    agendaEl.append(block);
  }

  for (const event of agenda.events) push(event.startsAt.slice(0, 10), eventRow(event));
  for (const commitment of agenda.due) push(commitment.dueOn, commitmentRow(commitment, false));

  for (const date of [...days.keys()].sort()) {
    if (date < today) continue;
    const block = el("section", "day");
    block.append(el("h3", "day__label", dayLabel(date)));
    for (const row of days.get(date)) block.append(row);
    agendaEl.append(block);
  }

  if (agenda.unscheduled.length) {
    const block = el("section", "day");
    block.append(el("h3", "day__label", "Needs a date"));
    for (const commitment of agenda.unscheduled.slice(0, 15)) {
      block.append(commitmentRow(commitment, false, true));
    }
    agendaEl.append(block);
  }

  if (!agendaEl.children.length) {
    agendaEl.append(el("p", "clear", "Nothing needs attention in this period."));
  }
}

function renderOwed(agenda) {
  agendaEl.textContent = "";
  const owed = [...agenda.overdue, ...agenda.due, ...agenda.unscheduled].filter((item) => item.waitingOn || item.direction === "theirs");
  if (!owed.length) {
    agendaEl.append(el("p", "clear", "Nothing is currently waiting on someone else."));
    return;
  }
  const block = el("section", "day");
  block.append(el("h3", "day__label", `Waiting on (${owed.length})`));
  for (const commitment of owed) {
    block.append(commitmentRow(commitment, commitment.dueOn && commitment.dueOn < todayISO(), !commitment.dueOn));
  }
  agendaEl.append(block);
}

function calendarBounds(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const from = new Date(first);
  from.setDate(from.getDate() - from.getDay());
  const to = new Date(from);
  to.setDate(to.getDate() + 41);
  return { from: isoOf(from), to: isoOf(to) };
}

function calendarTime(stamp) {
  return new Date(stamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function changeCalendarPeriod(offset) {
  if (calendarDisplay === "day") {
    const date = new Date(`${selectedCalendarDate}T12:00:00`);
    date.setDate(date.getDate() + offset);
    selectedCalendarDate = isoOf(date);
    calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1);
  } else {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1);
  }
  refresh();
}

function showCalendarToday() {
  const now = new Date();
  selectedCalendarDate = isoOf(now);
  calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  refresh();
}

function setCalendarDisplay(display, date = selectedCalendarDate) {
  calendarDisplay = display;
  selectedCalendarDate = date;
  const selected = new Date(`${selectedCalendarDate}T12:00:00`);
  calendarCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
  refresh();
}

function captureForDate(date) {
  setArea("capture");
  const fullDate = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  input.value = `Schedule on ${fullDate}: `;
  input.dispatchEvent(new Event("input"));
  input.focus();
}

function applyCalendarSubscription(data) {
  calendarSubscriptionUrl.value = data.url;
  openAppleCalendar.href = data.webcalUrl;
  calendarConnectStatus.textContent = data.secure
    ? "Anyone with this address can read the calendar. Keep it private."
    : "Set PUBLIC_URL to Ledger's public HTTPS address before subscribing from another device.";
}

async function showCalendarConnection() {
  calendarConnectStatus.textContent = "Preparing your private calendar address";
  calendarSubscriptionUrl.value = "";
  openAppleCalendar.href = "#";
  calendarConnectDialog.showModal();
  try {
    const response = await fetch("/api/calendar/subscription", { method: "POST" });
    if (response.status === 401) return (location.href = "/");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create the calendar subscription.");
    applyCalendarSubscription(data);
  } catch (error) {
    calendarConnectStatus.textContent = error.message;
  }
}

function calendarRecordMaps(data) {
  const eventsByDate = new Map();
  const commitmentsByDate = new Map();
  for (const event of data.events) {
    const date = event.allDay ? event.startsAt.slice(0, 10) : isoOf(new Date(event.startsAt));
    eventsByDate.set(date, [...(eventsByDate.get(date) || []), event]);
  }
  for (const commitment of data.commitments) {
    commitmentsByDate.set(commitment.dueOn, [...(commitmentsByDate.get(commitment.dueOn) || []), commitment]);
  }
  return { eventsByDate, commitmentsByDate };
}

function recordsForCalendarDate(maps, date) {
  const items = [
    ...(maps.eventsByDate.get(date) || []).map((item) => ({ kind: "event", item })),
    ...(maps.commitmentsByDate.get(date) || []).map((item) => ({ kind: item.waitingOn || item.direction === "theirs" ? "waiting" : "commitment", item })),
  ];
  const timeKey = (record) => record.kind === "event" ? record.item.startsAt || "99" : `${date}T${record.item.dueTime || "99:99"}`;
  return items.sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
}

function buildCalendarToolbar(title) {
  const toolbar = el("div", "calendar-toolbar");
  const heading = el("h3", "calendar-title", title);
  const controls = el("div", "calendar-controls");
  const display = el("div", "calendar-display");
  display.setAttribute("aria-label", "Calendar view");
  for (const mode of ["month", "day"]) {
    const label = mode === "month" ? "Month" : "Day";
    const button = el("button", `calendar-display__button${calendarDisplay === mode ? " is-on" : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(calendarDisplay === mode));
    button.addEventListener("click", () => setCalendarDisplay(mode));
    display.append(button);
  }
  const actions = el("div", "calendar-actions");
  for (const [label, action] of [
    ["Previous", () => changeCalendarPeriod(-1)],
    ["Today", showCalendarToday],
    ["Next", () => changeCalendarPeriod(1)],
  ]) {
    const button = el("button", "calendar-action", label);
    button.type = "button";
    button.addEventListener("click", action);
    actions.append(button);
  }
  if (calendarDisplay === "day") {
    const add = el("button", "calendar-add", "Add to this day");
    add.type = "button";
    add.addEventListener("click", () => captureForDate(selectedCalendarDate));
    actions.append(add);
  }
  const apple = el("button", "calendar-export", "Apple Calendar");
  apple.type = "button";
  apple.title = "Create a private read-only calendar subscription";
  apple.addEventListener("click", showCalendarConnection);
  actions.append(apple);
  controls.append(display, actions);
  toolbar.append(heading, controls);
  return toolbar;
}

function calendarLegend() {
  const legend = el("div", "calendar-legend");
  legend.append(
    el("span", "calendar-legend__event", "Events"),
    el("span", "calendar-legend__commitment", "Your commitments"),
    el("span", "calendar-legend__waiting", "Waiting on"),
  );
  return legend;
}

function renderMonthCalendar(data) {
  const heading = calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const maps = calendarRecordMaps(data);
  const scroll = el("div", "calendar-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", `${heading} calendar`);
  const grid = el("div", "calendar-grid");
  for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) grid.append(el("div", "calendar-weekday", weekday));

  const { from } = calendarBounds(calendarCursor);
  const firstVisible = new Date(`${from}T12:00:00`);
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(firstVisible);
    day.setDate(firstVisible.getDate() + index);
    const date = isoOf(day);
    const currentMonth = day.getMonth() === calendarCursor.getMonth();
    const dayCell = el("section", `calendar-day${currentMonth ? "" : " calendar-day--outside"}${date === todayISO() ? " calendar-day--today" : ""}`);
    dayCell.setAttribute("aria-label", day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }));

    const dateButton = el("button", "calendar-date", String(day.getDate()));
    dateButton.type = "button";
    dateButton.title = `Open ${dayLabel(date)}`;
    dateButton.addEventListener("click", () => setCalendarDisplay("day", date));
    dayCell.append(dateButton);

    const items = recordsForCalendarDate(maps, date);
    for (const record of items.slice(0, 4)) {
      const prefix = record.kind === "event" && !record.item.allDay
        ? `${calendarTime(record.item.startsAt)} `
        : record.kind !== "event" && record.item.dueTime ? `${record.item.dueTime} ` : "";
      const item = el("button", `calendar-item calendar-item--${record.kind}`, `${prefix}${record.item.title}`);
      item.type = "button";
      item.title = [record.item.title, record.item.entityName, record.item.location].filter(Boolean).join(" / ");
      item.addEventListener("click", () => setCalendarDisplay("day", date));
      dayCell.append(item);
    }
    if (items.length > 4) dayCell.append(el("div", "calendar-more", `+${items.length - 4} more`));
    grid.append(dayCell);
  }
  scroll.append(grid);
  agendaEl.append(
    buildCalendarToolbar(heading),
    calendarLegend(),
    scroll,
    el("p", "calendar-help", "Open a date to see its full day. Apple Calendar includes events and every open dated commitment."),
  );
}

function renderDayCalendar(data) {
  const date = new Date(`${selectedCalendarDate}T12:00:00`);
  const heading = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const records = recordsForCalendarDate(calendarRecordMaps(data), selectedCalendarDate);
  const dayView = el("section", "calendar-day-view");
  dayView.setAttribute("aria-label", `${heading} schedule`);
  if (!records.length) {
    const empty = el("div", "calendar-day-empty");
    empty.append(el("h4", null, "Nothing scheduled"), el("p", null, "No events or dated commitments are on this day."));
    const add = el("button", "calendar-add calendar-add--empty", "Add something");
    add.type = "button";
    add.addEventListener("click", () => captureForDate(selectedCalendarDate));
    empty.append(add);
    dayView.append(empty);
  } else {
    const allDay = records.filter((record) => record.kind === "event" ? record.item.allDay : !record.item.dueTime);
    const timed = records.filter((record) => record.kind === "event" ? !record.item.allDay : Boolean(record.item.dueTime));
    const appendGroup = (label, group) => {
      if (!group.length) return;
      const section = el("section", "calendar-day-group");
      section.append(el("h4", "calendar-day-group__title", label));
      for (const record of group) {
        const row = el("article", `calendar-day-record calendar-day-record--${record.kind}`);
        const when = record.kind === "event"
          ? (record.item.allDay ? "All day" : calendarTime(record.item.startsAt))
          : record.item.dueTime || (record.kind === "waiting" ? "Waiting" : "Due");
        const end = record.kind === "event" && !record.item.allDay && record.item.endsAt ? ` to ${calendarTime(record.item.endsAt)}` : "";
        const time = el("div", "calendar-day-record__time", `${when}${end}`);
        const copy = el("div", "calendar-day-record__copy");
        copy.append(el("strong", null, record.item.title));
        const context = [record.item.entityName, record.item.location].filter(Boolean).join(" / ");
        if (context) copy.append(el("span", null, context));
        row.append(time, copy);
        section.append(row);
      }
      dayView.append(section);
    };
    appendGroup("All day and due", allDay);
    appendGroup("Schedule", timed);
  }
  agendaEl.append(
    buildCalendarToolbar(heading),
    calendarLegend(),
    dayView,
    el("p", "calendar-help", "Use Add to this day for a new item. Ask Ledger in Assistant to move, change, finish, or cancel an existing item."),
  );
}

function renderCalendar(data) {
  agendaEl.classList.add("agenda--calendar");
  agendaEl.textContent = "";
  if (calendarDisplay === "day") renderDayCalendar(data);
  else renderMonthCalendar(data);
}

function taskItemEditor(item) {
  const row = el("form", "task-item-row");
  row.dataset.itemId = item.id;
  const done = document.createElement("input");
  done.type = "checkbox";
  done.checked = item.status === "done";
  done.setAttribute("aria-label", `Completed: ${item.title}`);
  const title = el("input", "task-item-row__title");
  title.value = item.title;
  title.required = true;
  title.setAttribute("aria-label", "Batch item title");
  const due = el("input", "task-item-row__date");
  due.type = "date";
  due.value = item.dueOn || "";
  due.setAttribute("aria-label", "Batch item due date");
  const save = el("button", "task-item-row__action", "Save");
  save.type = "submit";
  const split = el("button", "task-item-row__action", "Make task");
  split.type = "button";
  const remove = el("button", "task-item-row__remove", "Remove");
  remove.type = "button";
  row.append(done, title, due, save, split, remove);

  row.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const response = await fetch(`/api/task-item/${item.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.value, dueOn: due.value || null, status: done.checked ? "done" : "open" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the batch item.");
      showBanner("Batch item saved.");
      await openTaskEditor(currentTaskId, false);
    } catch (error) {
      taskEditorError.textContent = error.message;
      save.disabled = false;
    }
  });
  split.addEventListener("click", async () => {
    if (!confirm(`Turn "${title.value}" into its own task?`)) return;
    split.disabled = true;
    try {
      const response = await fetch(`/api/task-item/${item.id}/split`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not split that item.");
      showBanner("Batch item is now its own task.");
      await openTaskEditor(currentTaskId, false);
      refresh();
    } catch (error) {
      taskEditorError.textContent = error.message;
      split.disabled = false;
    }
  });
  remove.addEventListener("click", async () => {
    if (!confirm(`Remove "${title.value}" from this batch?`)) return;
    remove.disabled = true;
    try {
      const response = await fetch(`/api/task-item/${item.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove that item.");
      await openTaskEditor(currentTaskId, false);
    } catch (error) {
      taskEditorError.textContent = error.message;
      remove.disabled = false;
    }
  });
  return row;
}

async function loadTaskFrameworkCatalog() {
  if (taskFrameworkCatalogData) return taskFrameworkCatalogData;
  const response = await fetch("/api/task-framework");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load task frameworks.");
  taskFrameworkCatalogData = data;
  taskGoalArea.textContent = "";
  for (const area of data.goalAreas) {
    const option = document.createElement("option");
    option.value = area.value;
    option.textContent = area.label;
    taskGoalArea.append(option);
  }
  taskType.textContent = "";
  for (const type of data.taskTypes) {
    const option = document.createElement("option");
    option.value = type.value;
    option.textContent = type.label;
    taskType.append(option);
  }
  return data;
}

function frameworkValue(record, path) {
  return path.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, record);
}

function setFrameworkValue(record, path, value) {
  const keys = path.split(".");
  let cursor = record;
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}

function taskFrameworkControl(definition, value) {
  const wrap = el("label", `task-framework__field task-framework__field--${definition.kind}`);
  wrap.append(el("span", "settings__label", definition.label));
  let control;
  if (definition.kind === "textarea" || definition.kind === "list") {
    control = el("textarea", "settings__input");
    control.rows = definition.kind === "list" ? 3 : 2;
    control.value = definition.kind === "list" && Array.isArray(value) ? value.join("\n") : value || "";
  } else if (definition.kind === "select") {
    control = el("select", "settings__input");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose";
    control.append(empty);
    for (const item of definition.options || []) {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item.replaceAll("_", " ");
      control.append(option);
    }
    control.value = value || "";
  } else {
    control = document.createElement("input");
    control.className = "settings__input";
    control.type = definition.kind === "boolean" ? "checkbox" : definition.kind;
    if (definition.kind === "boolean") control.checked = value === true;
    else control.value = value || "";
  }
  control.dataset.frameworkKey = definition.key;
  control.dataset.frameworkKind = definition.kind;
  if (definition.placeholder) control.placeholder = definition.placeholder;
  wrap.append(control);
  return wrap;
}

function collectTaskFramework() {
  const result = {};
  for (const control of [...taskOperationalFields.querySelectorAll("[data-framework-key]"), ...taskFrameworkFields.querySelectorAll("[data-framework-key]")]) {
    let value;
    if (control.dataset.frameworkKind === "boolean") value = control.checked;
    else if (control.dataset.frameworkKind === "list") value = control.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    else value = control.value.trim();
    setFrameworkValue(result, control.dataset.frameworkKey, value);
  }
  return result;
}

function renderTaskFrameworkFields() {
  if (!taskFrameworkCatalogData) return;
  taskOperationalFields.textContent = "";
  taskFrameworkFields.textContent = "";
  for (const definition of taskFrameworkCatalogData.operationalFields || []) {
    taskOperationalFields.append(taskFrameworkControl(definition, frameworkValue(currentTaskFramework, definition.key)));
  }
  const common = el("div", "task-framework__group");
  common.append(el("h4", null, "Shared task fields"));
  const commonGrid = el("div", "task-framework__grid");
  for (const definition of taskFrameworkCatalogData.commonFields) {
    commonGrid.append(taskFrameworkControl(definition, frameworkValue(currentTaskFramework, definition.key)));
  }
  common.append(commonGrid);
  const specific = el("div", "task-framework__group");
  const typeLabel = taskFrameworkCatalogData.taskTypes.find((item) => item.value === taskType.value)?.label || "Task";
  specific.append(el("h4", null, `${typeLabel} fields`));
  const specificGrid = el("div", "task-framework__grid");
  for (const definition of taskFrameworkCatalogData.typeFields[taskType.value] || []) {
    specificGrid.append(taskFrameworkControl(definition, frameworkValue(currentTaskFramework, definition.key)));
  }
  specific.append(specificGrid);
  taskFrameworkFields.append(common, specific);
}

async function openTaskEditor(id, show = true) {
  currentTaskId = Number(id);
  taskEditorError.textContent = "";
  taskItemsList.textContent = "";
  taskItemsList.append(el("p", "task-editor__loading", "Loading task"));
  if (show) {
    taskAdvancedDetails.open = false;
    taskEditorDialog.showModal();
  }
  try {
    const [, response] = await Promise.all([loadTaskFrameworkCatalog(), fetch(`/api/task/${currentTaskId}`)]);
    const data = await response.json();
    if (response.status === 401) return (location.href = "/");
    if (!response.ok) throw new Error(data.error || "Could not open that task.");
    taskTitle.value = data.title;
    taskDueOn.value = data.dueOn || "";
    taskDueTime.value = data.dueTime || "";
    taskRecurrence.value = data.recurrence || "none";
    taskPriority.value = data.priority;
    taskGoalArea.value = data.goalArea || "company";
    taskType.value = data.taskType || "prepare";
    taskOwner.value = data.owner || "me";
    currentTaskFramework = data.framework || {};
    updateTaskTypeHelp();
    renderTaskFrameworkFields();
    taskDetail.value = data.detail || "";
    taskSourceSummary.textContent = data.sourceAt ? `Captured ${readableDate(data.sourceAt)}` : "No linked source note";
    taskSourceNote.textContent = data.sourceNote || "This task has no linked source note.";
    taskSourceDetails.hidden = !data.sourceNote;
    const tasksResponse = await fetch("/api/tasks");
    const allTasks = tasksResponse.ok ? await tasksResponse.json() : [];
    taskMergeSelect.textContent = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Choose another task";
    taskMergeSelect.append(emptyOption);
    for (const task of allTasks.filter((task) => task.id !== currentTaskId && task.taskType === data.taskType && task.goalArea === data.goalArea)) {
      const option = document.createElement("option");
      option.value = task.id;
      option.textContent = task.title;
      taskMergeSelect.append(option);
    }
    taskItemsList.textContent = "";
    if (!data.items.length) taskItemsList.append(el("p", "task-editor__empty", "No batch items. Add repeated work here instead of creating duplicate tasks."));
    else for (const item of data.items) taskItemsList.append(taskItemEditor(item));
  } catch (error) {
    taskEditorError.textContent = error.message;
    taskItemsList.textContent = "";
  }
}

closeTaskEditor.addEventListener("click", () => taskEditorDialog.close());

function updateTaskTypeHelp() {
  taskTypeHelp.textContent = {
    call: "Plan the purpose and talking points, then capture the recap and next action.",
    email: "Track the message, response, and follow-up.",
    text: "Track a short message and response across the right channel.",
    meeting: "Prepare an agenda and record decisions and action items.",
    follow_up: "Reconnect on an earlier topic or something you are waiting for.",
    review: "Inspect an item, record findings, and decide the next action.",
    approve: "Apply clear criteria and record the approval decision.",
    research: "Answer a specific question using sources and findings.",
    prepare: "Produce a defined deliverable from known inputs and requirements.",
    delegate: "Assign a result, due date, and check-in without losing accountability.",
    recap: "Summarize key points, decisions, and actions.",
    decision: "Compare options and record the choice and its reason.",
    document: "Create, review, or send a named document.",
    reminder: "Remember a specific action, including recurrence when needed.",
    personal: "Track personal work without forcing business fields.",
  }[taskType.value] || "Choose the one framework that matches the work.";
}

taskType.addEventListener("change", () => {
  currentTaskFramework = collectTaskFramework();
  updateTaskTypeHelp();
  renderTaskFrameworkFields();
});

taskEditorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  taskEditorError.textContent = "";
  const button = document.getElementById("saveTask");
  button.disabled = true;
  try {
    if (taskRecurrence.value !== "none" && !taskDueOn.value) {
      taskDueOn.focus();
      throw new Error("Choose the first due date for this recurring task.");
    }
    const response = await fetch(`/api/task/${currentTaskId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskTitle.value,
        detail: taskDetail.value,
        dueOn: taskDueOn.value || null,
        dueTime: taskDueTime.value || null,
        recurrence: taskRecurrence.value,
        priority: taskPriority.value,
        goalArea: taskGoalArea.value,
        taskType: taskType.value,
        owner: taskOwner.value,
        framework: collectTaskFramework(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save the task.");
    showBanner("Task saved.");
    refresh();
  } catch (error) {
    taskEditorError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

taskItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = taskItemTitle.value.trim();
  if (!title) return taskItemTitle.focus();
  const button = taskItemForm.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch(`/api/task/${currentTaskId}/items`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not add the batch item.");
    taskItemTitle.value = "";
    await openTaskEditor(currentTaskId, false);
  } catch (error) {
    taskEditorError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

mergeTaskButton.addEventListener("click", async () => {
  const otherId = Number(taskMergeSelect.value);
  if (!otherId) return (taskEditorError.textContent = "Choose another open task to merge.");
  if (!confirm("Merge the selected task into this workstream? The other task will be archived.")) return;
  mergeTaskButton.disabled = true;
  try {
    const response = await fetch("/api/tasks/merge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [currentTaskId, otherId], title: taskTitle.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not merge those tasks.");
    currentTaskId = data.id;
    showBanner("Tasks merged into one workstream.");
    await openTaskEditor(currentTaskId, false);
    refresh();
  } catch (error) {
    taskEditorError.textContent = error.message;
  } finally {
    mergeTaskButton.disabled = false;
  }
});

function renderTasks(tasks) {
  agendaEl.classList.remove("agenda--calendar");
  agendaEl.textContent = "";
  if (!tasks.length) {
    agendaEl.append(el("p", "clear", "No open commitments."));
    return;
  }

  if (!taskFrameworkCatalogData) void loadTaskFrameworkCatalog().then(() => refresh()).catch(() => undefined);

  const areas = taskFrameworkCatalogData?.goalAreas || [...new Set(tasks.map((task) => task.goalArea || "company"))].map((value) => ({ value, label: value.replaceAll("_", " ") }));
  for (const area of areas) {
    const items = tasks.filter((task) => (task.goalArea || "company") === area.value);
    if (!items.length) continue;
    const block = el("section", "day");
    const heading = el("div", "task-group__head");
    heading.append(el("h3", "day__label", `${area.label} (${items.length})`), el("p", null, "Work grouped by the outcome area it advances."));
    block.append(heading);
    for (const task of items.sort((left, right) => (left.dueOn || "9999").localeCompare(right.dueOn || "9999"))) {
      const late = Boolean(task.dueOn && task.dueOn < todayISO());
      block.append(commitmentRow(task, late, !task.dueOn));
    }
    agendaEl.append(block);
  }
}

function manualGoalForm() {
  const section = el("section", "goal-create");
  const heading = el("div", "goal-create__head");
  heading.append(el("h3", null, "Add goal"), el("p", null, "Goals are created here, not extracted from chat."));
  const form = el("form", "goal-create__form");
  const titleLabel = el("label", "settings__label", "Outcome");
  const title = el("input", "settings__input");
  title.type = "text";
  title.required = true;
  title.placeholder = "Achieve zero open regulatory findings";
  titleLabel.append(title);
  const detailLabel = el("label", "settings__label", "Success means");
  const detail = el("textarea", "settings__input");
  detail.rows = 2;
  detail.placeholder = "Describe the result, not a task list";
  detailLabel.append(detail);
  const areaLabel = el("label", "settings__label", "Goal Area");
  const area = el("select", "settings__input");
  appendSelectOptions(area, GOAL_AREA_OPTIONS, "company");
  areaLabel.append(area);
  const targetLabel = el("label", "settings__label", "Target date");
  const target = el("input", "settings__input");
  target.type = "date";
  targetLabel.append(target);
  const priorityLabel = el("label", "settings__label", "Priority");
  const priority = el("select", "settings__input");
  appendSelectOptions(priority, GOAL_PRIORITY_OPTIONS, "normal");
  priorityLabel.append(priority);
  const error = el("p", "settings__error");
  error.setAttribute("role", "alert");
  const submit = el("button", "settings__save", "Add goal");
  submit.type = "submit";
  form.append(titleLabel, detailLabel, areaLabel, targetLabel, priorityLabel, error, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.value, detail: detail.value, goalArea: area.value, targetOn: target.value, priority: priority.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add that goal.");
      showBanner(data.duplicate ? "Existing goal updated." : "Goal added.");
      refresh();
    } catch (reason) {
      error.textContent = reason.message;
      submit.disabled = false;
    }
  });
  section.append(heading, form);
  return section;
}

function goalEditForm(goal) {
  const form = el("form", "goal-edit");
  form.id = `goalEdit-${goal.id}`;
  form.hidden = true;
  const fields = el("div", "goal-edit__fields");

  const title = el("input", "settings__input");
  title.type = "text";
  title.required = true;
  title.value = goal.title;

  const detail = el("textarea", "settings__input");
  detail.rows = 2;
  detail.value = goal.detail || "";

  const area = el("select", "settings__input");
  appendSelectOptions(area, GOAL_AREA_OPTIONS, goal.goalArea || "company");

  const target = el("input", "settings__input");
  target.type = "date";
  target.value = goal.targetOn || "";

  const priority = el("select", "settings__input");
  appendSelectOptions(priority, GOAL_PRIORITY_OPTIONS, goal.priority || "normal");

  fields.append(
    labeledGoalControl("Outcome", title),
    labeledGoalControl("Success means", detail),
    labeledGoalControl("Goal Area", area),
    labeledGoalControl("Target date", target),
    labeledGoalControl("Priority", priority),
  );

  const error = el("p", "settings__error");
  error.setAttribute("role", "alert");
  const actions = el("div", "goal-edit__actions");
  const cancel = el("button", "settings__secondary", "Cancel");
  cancel.type = "button";
  const save = el("button", "settings__save", "Save changes");
  save.type = "submit";
  actions.append(cancel, save);
  form.append(fields, error, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    save.disabled = true;
    try {
      const response = await fetch(`/api/goals/${goal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.value,
          detail: detail.value,
          goalArea: area.value,
          targetOn: target.value,
          priority: priority.value,
        }),
      });
      if (response.status === 401) return (location.href = "/");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update that goal.");
      showBanner("Goal updated.");
      refresh();
    } catch (reason) {
      error.textContent = reason.message;
      save.disabled = false;
    }
  });

  return { form, title, cancel };
}

function goalRow(goal, isArchived = false) {
  const item = el("div", "goal-item");
  const row = el("div", `row row--goal${isArchived ? " row--archived" : ""}${goal.priority === "high" ? " row--priority" : ""}`);
  row.append(el("div", "row__when", goal.targetOn ? dayLabel(goal.targetOn) : "Ongoing"));
  const what = el("div", "row__what");
  const copy = el("div", "goal__copy");
  const label = el("span", null, goal.title);
  const context = [goal.goalArea?.replaceAll("_", " "), goal.entityName, goal.detail].filter(Boolean).join(" / ");
  if (context) label.append(el("span", "row__where", context));
  copy.append(label);
  const actions = el("div", "goal__actions");
  let editor = null;
  let edit = null;
  if (!isArchived) {
    editor = goalEditForm(goal);
    edit = el("button", "goal__edit", "Edit");
    edit.type = "button";
    edit.setAttribute("aria-controls", editor.form.id);
    edit.setAttribute("aria-expanded", "false");
    edit.setAttribute("aria-label", `Edit goal: ${goal.title}`);
    const closeEditor = () => {
      editor.form.hidden = true;
      edit.textContent = "Edit";
      edit.setAttribute("aria-expanded", "false");
    };
    edit.addEventListener("click", () => {
      const opening = editor.form.hidden;
      editor.form.hidden = !opening;
      edit.textContent = opening ? "Close edit" : "Edit";
      edit.setAttribute("aria-expanded", String(opening));
      if (opening) editor.title.focus();
    });
    editor.cancel.addEventListener("click", closeEditor);
    actions.append(edit);
  }
  const action = el("button", "goal__archive", isArchived ? "Restore" : "Archive");
  action.type = "button";
  action.setAttribute("aria-label", `${isArchived ? "Restore" : "Archive"} goal: ${goal.title}`);
  action.addEventListener("click", async () => {
    if (!isArchived && !confirm(`Archive “${goal.title}”?`)) return;
    action.disabled = true;
    try {
      const response = await fetch(`/api/goal/${isArchived ? "restore" : "archive"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goal.id }),
      });
      if (response.status === 401) return (location.href = "/");
      if (!response.ok) throw new Error(`Could not ${isArchived ? "restore" : "archive"} that goal.`);
      showBanner(`Goal ${isArchived ? "restored" : "archived"}.`);
      refresh();
    } catch (error) {
      action.disabled = false;
      showBanner(error.message, "error");
    }
  });
  actions.append(action);
  what.append(copy, actions);
  row.append(what);
  item.append(row);
  if (editor) item.append(editor.form);
  return item;
}

function renderGoals(goals) {
  agendaEl.classList.remove("agenda--calendar");
  agendaEl.textContent = "";
  agendaEl.append(manualGoalForm());
  const active = goals.filter((goal) => goal.status === "active");
  const archived = goals.filter((goal) => goal.status === "archived");
  if (active.length) {
    const block = el("section", "day");
    block.append(el("h3", "day__label", `Active goals (${active.length})`));
    for (const goal of active) block.append(goalRow(goal));
    agendaEl.append(block);
  } else {
    agendaEl.append(el("p", "clear", "No active goals."));
  }
  if (archived.length) {
    const archive = el("details", "goals-archive");
    archive.append(el("summary", null, `Archived (${archived.length})`));
    const list = el("div", "goals-archive__list");
    for (const goal of archived) list.append(goalRow(goal, true));
    archive.append(list);
    agendaEl.append(archive);
  }
}

function eventRow(event) {
  const row = el("div", "row");
  row.append(el("div", "row__when", event.allDay ? "All day" : event.startsAt.slice(11, 16)));
  const what = el("div", "row__what");
  const label = el("span", null, event.title);
  const context = [event.entityName, event.location].filter(Boolean).join(" / ");
  if (context) label.append(el("span", "row__where", context));
  what.append(label);
  row.append(what);
  return row;
}

function commitmentRow(commitment, late, undated) {
  const type = commitment.taskType || "prepare";
  const row = el("div", `row row--task row--type-${type}${late ? " row--late" : ""}`);
  row.append(el("div", "row__when", undated ? "No date" : `${dayLabel(commitment.dueOn)}${commitment.dueTime ? ` ${commitment.dueTime}` : ""}`));

  const what = el("div", "row__what");
  const tick = el("button", "row__tick");
  tick.type = "button";
  tick.setAttribute("aria-label", `Mark complete: ${commitment.title}`);
  tick.addEventListener("click", async () => {
    tick.disabled = true;
    try {
      const response = await fetch("/api/commitment/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: commitment.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not complete the task.");
      showBanner(data.nextDueOn ? `Task completed. Next occurrence: ${dayLabel(data.nextDueOn)}.` : "Task completed.");
      refresh();
    } catch (error) {
      tick.disabled = false;
      showBanner(error.message, "error");
    }
  });
  const label = el("button", "row__task-open", commitment.title);
  label.type = "button";
  label.setAttribute("aria-label", `Open task: ${commitment.title}`);
  label.addEventListener("click", () => openTaskEditor(commitment.id));
  const repeat = commitment.recurrence && commitment.recurrence !== "none" ? `Repeats ${commitment.recurrence}` : null;
  const context = [commitment.taskId, type.replaceAll("_", " "), repeat, commitment.waitingOn ? `Waiting: ${commitment.waitingOn}` : null, commitment.nextAction ? `Next: ${commitment.nextAction}` : null, commitment.entityName].filter(Boolean).join(" / ");
  const itemCount = commitment.items?.length || 0;
  if (context || itemCount) label.append(el("span", "row__where", [context, itemCount ? `${itemCount} batch items` : null].filter(Boolean).join(" / ")));
  what.append(tick, label);
  row.append(what);
  return row;
}

function renderReview(data) {
  agendaEl.textContent = "";

  const summary = el("section", "review-summary");
  for (const [value, label] of [
    [data.captures, "Notes captured"],
    [data.completed, "Commitments completed"],
    [data.pending.length, "Notes to review"],
    [data.goals.length, "Active goals"],
  ]) {
    const metric = el("div", "review-metric");
    metric.append(el("strong", null, String(value)), el("span", null, label));
    summary.append(metric);
  }
  agendaEl.append(summary);

  if (data.focus) {
    const block = el("section", "day review-block");
    block.append(el("h3", "day__label", "Current priority"));
    block.append(compactRecord(data.focus.title, data.focus.detail, [data.focus.entityName, data.focus.dueOn].filter(Boolean).join(" / ")));
    agendaEl.append(block);
  }

  if (data.overdue.length) {
    const block = el("section", "day day--late review-block");
    block.append(el("h3", "day__label", `Overdue (${data.overdue.length})`));
    for (const item of data.overdue.slice(0, 8)) block.append(commitmentRow(item, true, false));
    agendaEl.append(block);
  }

  if (data.recentKnowledge.length) {
    const block = el("section", "day review-block");
    block.append(el("h3", "day__label", "Knowledge added"));
    for (const fact of data.recentKnowledge.slice(0, 6)) {
      block.append(compactRecord(fact.label, fact.body, fact.entityName));
    }
    agendaEl.append(block);
  }

  const prompts = el("section", "review-prompts");
  prompts.append(el("h3", null, "Close the week"));
  const promptActions = el("div", "review-prompts__actions");
  for (const [label, prompt] of [
    ["Record outcomes", "Weekly review: This week I shipped and learned..."],
    ["Set next priority", "Next week's single priority is..."],
    ["Document a process", "A recurring process I should document is..."],
  ]) {
    const button = el("button", null, label);
    button.type = "button";
    button.addEventListener("click", () => {
      setArea("capture");
      input.value = prompt;
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
    promptActions.append(button);
  }
  prompts.append(promptActions);
  agendaEl.append(prompts);
}

async function refresh() {
  const requestId = ++refreshRequest;
  agendaEl.setAttribute("aria-busy", "true");
  try {
    if (view === "tasks") {
      const response = await fetch("/api/tasks");
      if (response.status === 401) return (location.href = "/");
      if (!response.ok) throw new Error("Could not load tasks.");
      const data = await response.json();
      if (requestId !== refreshRequest) return;
      return renderTasks(data);
    }
    if (view === "goals") {
      const response = await fetch("/api/goals?status=all");
      if (response.status === 401) return (location.href = "/");
      if (!response.ok) throw new Error("Could not load goals.");
      const data = await response.json();
      if (requestId !== refreshRequest) return;
      return renderGoals(data);
    }
    const { from, to } = calendarDisplay === "day"
      ? { from: selectedCalendarDate, to: selectedCalendarDate }
      : calendarBounds(calendarCursor);
    const response = await fetch(`/api/calendar?from=${from}&to=${to}`);
    if (response.status === 401) return (location.href = "/");
    if (!response.ok) throw new Error("Could not refresh the calendar.");
    const data = await response.json();
    if (requestId !== refreshRequest) return;
    renderCalendar(data);
  } catch (error) {
    if (requestId !== refreshRequest) return;
    agendaEl.textContent = "";
    agendaEl.append(el("p", "clear clear--error", error.message));
  } finally {
    if (requestId === refreshRequest) agendaEl.removeAttribute("aria-busy");
  }
}

async function boot() {
  trackViewport();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("/api/state");
      if (response.status === 401) return (location.href = "/");
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const state = await response.json();
      currentModel = state.model;
      const totalRecords = (state.counts || []).reduce((sum, item) => sum + Number(item.count), 0);
      metaEl.textContent = totalRecords ? `${totalRecords} records` : state.model;
      metaEl.title = `Current model: ${state.model}`;
      for (const message of state.history) addMessage(message);
      await refreshPendingCount();
      setArea(location.hash.slice(1) || "capture", false);
      await refresh();
      return;
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  metaEl.textContent = "Offline";
  addError("Ledger could not reach the server. Restart it and reload this page.");
}

function slashMatches() {
  const match = input.value.trim().match(/^\/([a-z]*)$/i);
  const query = match ? match[1].toLowerCase() : "";
  return slashCommands.filter((item) =>
    !query
      || item.command.slice(1).includes(query)
      || item.label.toLowerCase().includes(query)
      || item.description.toLowerCase().includes(query),
  );
}

function setSlashExpanded(expanded) {
  slashMenuOpen = expanded;
  slashMenu.hidden = !expanded;
  slashTrigger.setAttribute("aria-expanded", String(expanded));
  input.setAttribute("aria-expanded", String(expanded));
  if (!expanded) input.removeAttribute("aria-activedescendant");
}

function selectSlashItem(index) {
  const items = [...slashMenu.querySelectorAll("[role='option']")];
  if (!items.length) return;
  slashSelection = (index + items.length) % items.length;
  items.forEach((item, itemIndex) => {
    const selected = itemIndex === slashSelection;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-selected", String(selected));
    if (selected) {
      input.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    }
  });
}

function applySlashCommand(item) {
  const isSlashQuery = /^\/[a-z]*$/i.test(input.value.trim());
  input.value = isSlashQuery || !input.value.trim()
    ? item.prompt
    : `${input.value.trimEnd()}\n${item.prompt}`;
  setSlashExpanded(false);
  input.dispatchEvent(new Event("input"));
  input.focus();
  const firstPlaceholder = input.value.indexOf("[");
  const placeholderEnd = firstPlaceholder < 0 ? -1 : input.value.indexOf("]", firstPlaceholder);
  if (firstPlaceholder >= 0 && placeholderEnd > firstPlaceholder) {
    input.setSelectionRange(firstPlaceholder, placeholderEnd + 1);
  } else {
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function renderSlashMenu(forceAll = false) {
  const matches = forceAll ? slashCommands : slashMatches();
  slashMenu.textContent = "";
  if (!matches.length) {
    setSlashExpanded(false);
    return;
  }
  matches.forEach((item, index) => {
    const option = el("button", "slash-menu__item");
    option.id = `slash-option-${item.command.slice(1)}`;
    option.type = "button";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    const copy = el("span", "slash-menu__copy");
    copy.append(el("strong", null, item.label), el("span", null, item.description));
    option.append(el("code", null, item.command), copy);
    option.addEventListener("pointermove", () => selectSlashItem(index));
    option.addEventListener("click", () => applySlashCommand(item));
    slashMenu.append(option);
  });
  slashSelection = 0;
  setSlashExpanded(true);
  selectSlashItem(0);
}

slashTrigger.addEventListener("click", () => {
  if (slashMenuOpen) {
    setSlashExpanded(false);
  } else {
    renderSlashMenu(true);
    input.focus();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (slashMenuOpen && !slashMenu.contains(event.target) && event.target !== slashTrigger && event.target !== input) {
    setSlashExpanded(false);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  const userCard = addMessage({ role: "user", content: text, at: new Date().toISOString(), status: "Working" });
  input.value = "";
  input.style.height = "auto";
  send.disabled = true;
  send.textContent = "Working";

  const pending = el("div", "thinking", "Checking memory and carrying that out");
  stream.append(pending);
  stream.scrollTop = stream.scrollHeight;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await response.json();
    pending.remove();
    if (!response.ok) {
      attachDeleteControl(userCard, data.userMessageId);
      setCaptureStatus(userCard, data.entryId ? "Needs review" : "Check inbox", "review");
      addError(data.error || "Your message was saved, but Ledger could not finish the instruction.");
      refreshPendingCount();
    } else {
      attachDeleteControl(userCard, data.userMessageId);
      setCaptureStatus(userCard, "Done", "filed");
      addMessage({ id: data.assistantMessageId, role: "assistant", content: data.reply, actions: data.actions });
      memoryLoaded = false;
      refreshPendingCount();
    }
    refresh();
  } catch {
    pending.remove();
    setCaptureStatus(userCard, "Check inbox", "review");
    addError("The connection stopped while Ledger was working. Your message remains saved.");
  } finally {
    send.disabled = false;
    send.textContent = "Ask Ledger";
    input.focus();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.32)}px`;
  if (/^\/[a-z]*$/i.test(input.value.trim())) renderSlashMenu();
  else if (slashMenuOpen) setSlashExpanded(false);
});
input.addEventListener("keydown", (event) => {
  if (slashMenuOpen) {
    const items = [...slashMenu.querySelectorAll("[role='option']")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selectSlashItem(slashSelection + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashExpanded(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && items[slashSelection]) {
      event.preventDefault();
      items[slashSelection].click();
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function fillPrompt(prompt) {
  input.value = prompt;
  input.dispatchEvent(new Event("input"));
  input.focus();
}

for (const example of document.querySelectorAll("[data-prompt]")) {
  example.addEventListener("click", () => fillPrompt(example.dataset.prompt));
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tab")) {
      const selected = other === tab;
      other.classList.toggle("is-on", selected);
      other.setAttribute("aria-selected", String(selected));
    }
    view = tab.dataset.view;
    refresh();
  });
}

consolidateDuplicatesButton.addEventListener("click", async () => {
  if (!confirm("Consolidate repeated goals and batch work? Redundant records will be archived, not deleted.")) return;
  consolidateDuplicatesButton.disabled = true;
  maintenanceStatus.textContent = "Checking active records";
  try {
    const response = await fetch("/api/maintenance/consolidate", { method: "POST" });
    if (response.status === 401) return (location.href = "/");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not consolidate duplicates.");
    const total = data.goalsArchived + data.commitmentsArchived;
    maintenanceStatus.textContent = total
      ? `${total} redundant record${total === 1 ? "" : "s"} archived. No history was erased.`
      : "No duplicate active goals or open commitments found.";
    showBanner(total ? `${total} repeated record${total === 1 ? "" : "s"} archived.` : "No repeated work found.");
    await refresh();
  } catch (error) {
    maintenanceStatus.textContent = error.message;
    showBanner(error.message, "error");
  } finally {
    consolidateDuplicatesButton.disabled = false;
  }
});

closeCalendarConnect.addEventListener("click", () => calendarConnectDialog.close());
calendarConnectDialog.addEventListener("click", (event) => {
  if (event.target === calendarConnectDialog) calendarConnectDialog.close();
});
copyCalendarUrl.addEventListener("click", async () => {
  if (!calendarSubscriptionUrl.value) return;
  try {
    await navigator.clipboard.writeText(calendarSubscriptionUrl.value);
  } catch {
    calendarSubscriptionUrl.select();
    document.execCommand("copy");
  }
  copyCalendarUrl.textContent = "Copied";
  setTimeout(() => { copyCalendarUrl.textContent = "Copy"; }, 1600);
});
rotateCalendarUrl.addEventListener("click", async () => {
  if (!confirm("Replace the private calendar address? The existing Apple Calendar subscription will stop updating.")) return;
  rotateCalendarUrl.disabled = true;
  calendarConnectStatus.textContent = "Replacing private address";
  try {
    const response = await fetch("/api/calendar/subscription/rotate", { method: "POST" });
    if (response.status === 401) return (location.href = "/");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not replace the calendar address.");
    applyCalendarSubscription(data);
    showBanner("Private calendar address replaced.");
  } catch (error) {
    calendarConnectStatus.textContent = error.message;
  } finally {
    rotateCalendarUrl.disabled = false;
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/";
});

boot();
setInterval(refresh, 60000);
