# Ledger

Encrypted private memory for one person. Dump personal or professional thoughts into a chat box and Ledger connects them as people, organizations, projects, topics, lessons, goals, tasks, and calendar entries you can find later.

Built to help you remember, learn, grow, follow through, and keep work and life connected without forcing you to organize every thought first.

## Setup

```bash
npm install
npm run init      # generates keys, sets your password
npm run dev       # http://localhost:4321
```

`npm run init` writes `.env` with a `MASTER_KEY`. **Back that key up somewhere safe.** It decrypts everything and there is no recovery path. Lose it and the data is unreadable, by design.

## Production with PM2

PM2 runs Ledger as the process name `ledger` from `ecosystem.config.cjs`. It starts `dist/server.js` directly. Always compile successfully before asking PM2 to start or reload the process; this avoids deploying a missing or broken `dist/server.js`.

### First start

```bash
cd /opt/ledger
npm ci
npm run prepare:production
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
curl http://127.0.0.1:4321/api/health
```

Enable PM2 startup once so the saved Ledger process returns after a server reboot. Run the command printed by `pm2 startup`, then save again:

```bash
pm2 startup
pm2 save
```

### Deploy an update

Do not reload Ledger until the install and build have succeeded:

```bash
cd /opt/ledger
git pull
npm ci
npm run test:run
npm run prepare:production
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
curl http://127.0.0.1:4321/api/health
```

### PM2 operations

```bash
pm2 status ledger                         # process status, uptime, restarts, memory
pm2 logs ledger --lines 100 --nostream    # recent Ledger output and errors
pm2 restart ledger --update-env           # restart after changing .env
pm2 reload ledger --update-env            # normal zero-downtime-style reload
pm2 stop ledger                           # stop without deleting its PM2 definition
pm2 delete ledger                         # remove Ledger from PM2
```

For a clean process recreation, delete only the named Ledger process and immediately recreate it from the ecosystem file. This does not delete Ledger's database or `.env`:

```bash
cd /opt/ledger
npm run prepare:production
pm2 delete ledger
pm2 start ecosystem.config.cjs --only ledger --update-env
pm2 save
```

If PM2 says `online` but the site refuses the connection, confirm that Ledger is listening locally, inspect its logs, and then check the HTTPS reverse proxy:

```bash
curl -i http://127.0.0.1:4321/api/health
pm2 logs ledger --lines 100 --nostream
sudo nginx -t
sudo systemctl status nginx --no-pager
```

Ledger intentionally listens on `127.0.0.1:4321` in production. The public connection should go through Nginx on HTTPS port 443; port 4321 should not be exposed publicly.

Ledger resolves `.env`, `data`, `backups`, and `export` from the application directory even if PM2 was started elsewhere. On an existing server, do not run `npm run init` unless `/opt/ledger/.env` is genuinely missing: generating a new `MASTER_KEY` makes existing encrypted data unreadable.

Before reloading, verify that `/opt/ledger/.env` contains non-empty `MASTER_KEY`, `SESSION_SECRET`, and `PASSWORD_HASH`. If Ollama reports 401, replace `OLLAMA_API_KEY` with a valid key and reload with `--update-env`. An Ollama error does not discard the raw note; Ledger keeps it in Needs review for retry.

## Storage

No database to install. PGlite runs a real Postgres engine in-process against `./data`. When you outgrow it, set `DATABASE_URL` and point at a server. The same numbered migrations run on either storage engine.

```
DATABASE_URL=postgres://user:pass@host:5432/ledger
```

## The five shapes

| | What it holds |
|---|---|
| **Entities** | people, organizations, projects, topics, and personal or professional areas |
| **Facts** | lessons, preferences, decisions, insights, agreements, and useful context |
| **Commitments** | one Goal Area, one of 15 task frameworks, encrypted structured details, `waiting_on`, and `next_action` |
| **Goals** | longer-term outcomes assigned to a Goal Area and created manually in Feed > Goals |
| **Events** | anything happening at a moment in time |

Every raw dump is also stored verbatim as an `entry` before the model runs, so nothing is lost if inference is slow, wrong, or down.

## Assistant

The first screen is an action-oriented chat. Tell Ledger to remember context, plan the day, create or rename a task, change a due date or priority, reschedule or cancel an event, finish a commitment, update a goal, archive a goal, or review what needs attention. Every task receives one Goal Area (`company`, `digital`, `compliance`, `agents`, `partners`, `banking`, `growth`, `team`, `personal_finance`, or `personal_health_family`) and one task type (`call`, `email`, `text`, `meeting`, `follow_up`, `review`, `approve`, `research`, `prepare`, `delegate`, `recap`, `decision`, `document`, `reminder`, or `personal`). New goals are created only through the manual form in **Feed > Goals**. Confirmed mutations appear below the reply as **Changes made**. Every mutation batch is validated and executed in a database transaction. Repeated tool calls use an idempotency key, failed runs reverse earlier changes, and completed runs have one **Undo changes** control.

Ledger changes an existing record instead of creating a replacement. If a title matches more than one task, goal, or event, it changes nothing and asks which record you meant.

To remove every commitment and calendar event, ask Ledger to clear the Feed and Calendar, review the stated scope, then send exactly `CLEAR FEED AND CALENDAR`. Goals, memory, source notes, and chat remain. Ledger reports the deleted counts and provides one undo action.

Before any task, goal, or calendar mutation, Ledger reviews the relevant Calendar and Feed records for duplicates, time overlaps, conflicting statuses, and goal conflicts. Vague tasks remain only as captured chat until one concise, operational clarification makes the action and outcome clear; Ledger avoids unrelated personal questions.

Repeated work is stored as one parent commitment with structured batch items instead of one task per code, agent, vendor, partner, file, location, or deliverable. Open any commitment to rename it, reschedule it, change priority or owner, inspect its source, edit its batch, split an item into a task, or merge another task into the workstream. **Settings > Vault > Consolidate repeated work** converts older repeated rows and archives the redundant parents. Undated Feed items say **No date**, while dated items show their actual day instead of the generic label **Due**.

### Assistant action rules

1. Save the original note before calling a model.
2. Review Calendar and Feed before creating or changing a task, goal, or event.
3. Ask one operational question when the action, owner, outcome, date, or target record is unclear.
4. Do not ask for unrelated personal or sensitive context.
5. Validate the whole tool batch before execution and cap a batch at 12 operations.
6. Execute a mutation batch atomically. One failure rolls back the batch.
7. Use idempotency keys so a retry cannot apply the same operation twice.
8. Keep repeated work in one parent task with structured batch items.
9. Never claim a change happened unless the tool confirmed it.
10. Provide one undo action for the complete assistant instruction.

## Calendar

Feed > Overview has Month and Day views containing scheduled events and every open commitment with a due date. Open a date for its full schedule, then use **Add to this day** for a dated capture. Timed events are converted from the configured `TIMEZONE` to a real UTC instant, so Ledger, browsers, and Apple Calendar show the same clock time. **Apple Calendar** creates a private, read-only subscription that refreshes automatically. Set Ledger's public HTTPS origin in production so the subscription works from Apple devices:

```env
PUBLIC_URL=https://ledger.example.com
```

The subscription address contains a 256-bit secret. Anyone with that address can read the calendar, so keep it private and replace it from the connection dialog if it is exposed. A one-time `Ledger.ics` download remains available as a fallback.

**Dependencies stay visible.** Every task has `waiting_on` and `next_action`. "Maya said she'd send the reading list Friday" records Maya in `waiting_on`, while the next action can remain blank until a follow-up is needed; the Waiting on feed surfaces blocked work without duplicating it as another task.

## What one dump produces

> Goal: finish the leadership course by December. Task: register this week. I learned that I focus better when I plan tomorrow before ending work. Dinner with Maya Thursday at 7.

Ledger can create a goal, a concrete task, a durable lesson attached to a topic, an event, and a connected person from that one rough note.

## Encryption

Note bodies, facts, commitment details and chat history are encrypted with AES-256-GCM before they touch the database. Verified: nothing readable on disk, and a wrong key fails authentication rather than returning garbage.

**The tradeoff this forces.** Encrypted text can't be full-text indexed. Exact search works on deterministic blind tokens, an HMAC of each word. When exact results are sparse, Ledger asks the configured fast model to rank a bounded set of recent records by meaning and labels those results **Related**. If Ollama is offline, search falls back to exact results. Structured fields (names, countries, statuses, dates) stay indexable and fast.

Blind tokens leak word *frequency* to anyone who dumps the database. Acceptable for a single-user tool; not acceptable for shared multi-tenant data.

## Scale

Measured on PGlite (wasm; server Postgres is faster) with 3,205 entities, 20k entries, 20k facts, 5k commitments, 5k events:

| Query | |
|---|---|
| search, two terms | 127ms |
| search, three terms | 174ms |
| 14-day agenda | 50ms |
| list one entity type | 6ms |
| entity lookup by name | 10ms |
| facts for one subject | 2ms |

Entities are the bounded index. Notes can grow without limit and are never scanned directly.

## Obsidian export

```bash
npm run export
```

Writes a plaintext markdown mirror to `./export`, including connected memory, open tasks, active goals, and history. It's an export, not a backup. It is decrypted by definition, and the database stays the source of truth.

## Encrypted backup and restore

Ledger creates one AES-256-GCM encrypted logical backup each day and keeps the latest 14 by default. The same portable `.lgr` format works for PGlite and PostgreSQL. Use **Settings > Backups** to create, download, or restore a backup. Restore verifies the encryption tag and required tables before replacing current data, then performs the replacement in one transaction.

```env
BACKUP_DIR=./backups
BACKUP_RETENTION=14
```

Keep the `MASTER_KEY` with your recovery records. A backup cannot be decrypted without the key that created it.

## Ollama reliability and routing

Model calls have a bounded timeout, cancellation, and up to two retries for temporary network, rate-limit, and server failures. Offline notes remain unprocessed and a background queue retries one note when health recovers. Simple capture and extraction can use `OLLAMA_FAST_MODEL`; reviews and decisions can use `OLLAMA_REVIEW_MODEL`. If those are unset, both use `OLLAMA_MODEL`. Ledger also sends only the tool schemas relevant to the instruction.

Prayer-time questions use AlAdhan's live coordinate endpoint and do not depend on Ollama's stored knowledge. Configure coordinates and the method under **Settings > Prayer** (or with `PRAYER_LATITUDE`, `PRAYER_LONGITUDE`, and `PRAYER_METHOD` in `.env`). Ledger refreshes a disk-backed cache once each day, also offers **Refresh now**, and reports the returned timezone and method. It does not treat calculated starts as local mosque iqamah times or add them to Calendar unless asked.

```env
OLLAMA_FAST_MODEL=gpt-oss:20b
OLLAMA_REVIEW_MODEL=gpt-oss:120b
OLLAMA_TIMEOUT_MS=45000
OLLAMA_RETRIES=2
```

## Tests

```bash
npm test
```

The isolated test database covers versioned migrations, encryption at rest, transaction rollback, generalized workstream grouping, daylight-saving conversion, calendar export, idempotent multi-step undo, and encrypted backup restore.

## Scope: read this

Ledger is a personal memory and action tool, not a password manager, medical record, financial vault, or compliance system.

Do not enter passwords, authentication secrets, payment-card numbers, bank-account numbers, government ID numbers, or private customer transaction records. The model is instructed to omit such details, but a prompt instruction is not a security control.

Every note is sent to the configured Ollama host for structuring. When using Ollama Cloud, the content leaves your infrastructure. Use a local model when notes must remain on your machine.

## Files

```
src/
  server.ts   routes + auth gate
  agent.ts    system prompt + tool loop
  actions.ts  transactional action audit + undo
  backup.ts   encrypted logical backup + restore
  semantic.ts hybrid exact + related Memory retrieval
  tools.ts    tool schemas and handlers
  store.ts    all data access; the encryption boundary
  db.ts       PGlite/Postgres adapter + numbered migrations
  crypto.ts   AES-GCM, scrypt, sessions
  init.ts     first-run setup
  export.ts   Obsidian mirror
public/       login + mobile-first chat and agenda
```

## Security posture

Password login with scrypt, HttpOnly SameSite=Strict session cookie, rate limiting after 8 failed attempts. Single user, no roles.

Encryption protects a stolen disk or a database dump. It does **not** protect against someone who compromises the running server, since the key is in the process environment. In production, expose only the Nginx HTTPS proxy and keep Ledger bound to `127.0.0.1`.

Ledger reports the current transport state under **Settings > Security** as Secure HTTPS, Public HTTP, or Private/local HTTP. This status is informational; only HTTPS protects passwords and memory while they travel between the browser and server.

### Trusted HTTPS on the public IP

Let’s Encrypt now issues trusted, short-lived certificates for public IPv4 addresses. The included installer configures Nginx, obtains a certificate for the address supplied in `LEDGER_IP`, redirects HTTP to HTTPS, binds Ledger only to loopback, and installs an eight-hour renewal check. `LEDGER_IP` is required and must be an address assigned exclusively to the Ledger server; the script intentionally has no default address.

```bash
cd /opt/ledger
sudo LEDGER_IP=203.0.113.10 LETSENCRYPT_EMAIL=you@example.com bash scripts/secure-public-ip.sh
```

Replace `203.0.113.10` with Ledger's actual dedicated public IPv4 address; it is a documentation-only example and will not work as a deployment target. Before running the installer, allow inbound TCP ports 80 and 443 in the hosting firewall. After it succeeds, use `https://<LEDGER_IP>` and remove any provider-level rule that exposes port 4321. The script does not modify SSH or firewall rules.
