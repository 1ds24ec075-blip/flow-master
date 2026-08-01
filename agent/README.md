# Reconza Tally Auto-Sync Agent

A small always-on background process that lives on the same Windows machine as
Tally and pushes queued vouchers into it over Tally's local HTTP-XML interface.

```
[Reconza Cloud]  <--- HTTPS --->  [this agent]  <--- HTTP --->  [tally.exe :9000]
  builds JSON jobs                 owns the queue,               only answers while
  (tally-enqueue)                  renders XML, pushes           running with a company open
```

## Why the queue stores JSON, not XML

The queue holds structured business data. XML is rendered by
`supabase/functions/_shared/tally/serializer.ts` at the moment a job is
transmitted — never when it's created.

That's deliberate. Every Tally bug this project hit (wrong tag name
`ALLLEDGERENTRIES.LIST` vs `LEDGERENTRIES.LIST`, inverted debit/credit signs,
duplicated purchase entries) came from XML generation being written more than
once and drifting. There is now exactly one serializer, shared by the edge
functions, the web app and this agent. A fix there also repairs jobs already
sitting in the queue, because their XML hasn't been generated yet.

**If you are about to write a template literal containing `<ENVELOPE>`, stop
and add it to the serializer instead.**

## Requirements

- Windows (the process detection and installer are Windows-specific; the sync
  loop itself is portable)
- Node.js **22.6+** — uses built-in `node:sqlite` and native TypeScript
  execution, so there is nothing to compile and no native module to rebuild
- Tally with its HTTP-XML server enabled: `F1 > Features > Enable HTTP/XML`,
  port 9000

## Setup

1. **Create an agent in the Reconza dashboard.** It mints a token that is shown
   exactly once — only its SHA-256 is stored server-side.

   ```bash
   curl -X POST "$SUPABASE_URL/functions/v1/tally-agents" \
     -H "Authorization: Bearer $USER_JWT" \
     -H "Content-Type: application/json" \
     -d '{"action":"create","name":"Front desk PC","companyName":"Guhanesh"}'
   ```

   `companyName` must match the Tally company **exactly, case-sensitive**. A
   mismatch silently breaks every sync afterwards, so the agent checks it on
   every cycle and refuses to push when it doesn't line up.

2. **Configure the agent.**

   ```bash
   cd agent
   npm run setup     # interactive; writes %APPDATA%\ReconzaTallyAgent\config.json
   npm run doctor    # verifies every precondition and names the broken one
   ```

3. **Install it to start at login.**

   ```powershell
   powershell -ExecutionPolicy Bypass -File install-windows.ps1
   Start-ScheduledTask -TaskName ReconzaTallyAgent
   ```

   A Scheduled Task, not a Windows Service — the agent has to launch Tally into
   an interactive desktop session, which a Session-0 service cannot do.

## Running it

| Command | What it does |
| --- | --- |
| `npm start` | Runs the agent in the foreground |
| `npm run doctor` | Checks config, Tally, cloud and queue; exits non-zero if anything is broken |
| `npm run once` | Runs exactly one sync cycle and exits (handy from Task Scheduler) |
| `npm run build` | Bundles to `dist/agent.mjs` for distribution |
| `npm test` | Unit tests |

Status page: **http://localhost:9700** (loopback only) — last sync, pending
count, blocked/failed jobs, recent log. `POST /sync` triggers a flush;
`/status.json` is the machine-readable version.

Logs rotate at 2 MB, 3 kept, in `%APPDATA%\ReconzaTallyAgent\logs\`.

## Sync triggers

All three, because none is sufficient alone:

- **Interval** (default 3 min) — the workhorse.
- **On Tally launch** — the process watcher notices `tally.exe` appear and
  immediately flushes everything that queued up while it was closed.
- **Cloud short-poll** (default 20 s) — gets a freshly processed bill into Tally
  within seconds rather than waiting for the interval. Short-polling rather than
  a websocket so it survives sleep/resume and captive-portal wifi without a
  reconnect state machine.

Overlapping triggers are safe: flushes are mutually exclusive, claims are atomic
(`FOR UPDATE SKIP LOCKED`), and every GUID confirmed delivered is recorded
locally before the cloud is told, so a crash mid-report cannot double-book.

## Ordering: masters before vouchers

A voucher referencing a ledger or stock item Tally doesn't have will be
rejected. Each voucher job carries `dependsOnMasterGuids`, and neither the cloud
claim query nor the local queue will release a voucher until every one of those
masters has reached `success`. Before creating masters, the agent reads back
Tally's existing ledgers and stock items and skips the ones already there —
Tally rejects duplicate creates.

## Failure handling

Failures are classified, not blindly retried:

- **Transient** (Tally busy, not reachable, HTTP 5xx) — retried up to
  `maxAttempts` (default 3).
- **Permanent** (unbalanced voucher, unknown ledger name, invalid data) — marked
  `failed` immediately and surfaced with the exact Tally message. These need a
  human, not a retry loop.
- **"Already exists"** on a master is treated as success — the precondition is
  satisfied, which is all we wanted.

Every outcome is reported back to the cloud and shown on the bill, so nothing
disappears into a local log.

## Configuration

`%APPDATA%\ReconzaTallyAgent\config.json`, or environment variables which take
precedence (so a service wrapper can inject secrets without writing them to
disk):

| Key | Env | Default |
| --- | --- | --- |
| `agentToken` | `RECONZA_AGENT_TOKEN` | — |
| `supabaseUrl` | `RECONZA_SUPABASE_URL` | — |
| `supabaseAnonKey` | `RECONZA_SUPABASE_ANON_KEY` | — |
| `companyName` | `RECONZA_TALLY_COMPANY` | — |
| `tallyUrl` | `RECONZA_TALLY_URL` | `http://localhost:9000` |
| `tallyExePath` | `RECONZA_TALLY_EXE` | auto-detected from the registry |
| `flushIntervalMs` | — | `180000` |
| `cloudPollIntervalMs` | — | `20000` |
| `autoLaunchTally` | — | `true` |
| `statusPort` | — | `9700` |

## Security

- The token is per-installation, not shared across customers; revoke one without
  touching the others.
- Only its SHA-256 reaches the database.
- `install-windows.ps1` strips ACL inheritance from `config.json` so other local
  accounts can't read the token.
- The status server binds `127.0.0.1` only.
- Agent-to-Tally traffic is loopback. Don't expose Tally's port to the network
  unless you're deliberately running a Tally Prime Server on the LAN.

## Company auto-load

Tally must already have the right company open — `SVCURRENTCOMPANY` in the XML
selects a company, it does not open or create one. Set a startup company either
in `tally.ini` or via Tally's "Load Company at Startup" setting.

The agent detects a mismatch by asking Tally for the company's ledger list: a
company that isn't loaded returns HTTP 200 with an empty collection and *no
error*, and since every Tally company ships with default ledgers, zero ledgers
back means the name doesn't match what's open.

## Known gaps

- **No native tray icon.** The status page covers "is it alive and working"
  without pulling a GUI dependency into the install. A tray shell would be a
  wrapper around `/status.json`.
- **The installer isn't signed.** Signing needs a certificate you'll have to
  supply; until then Windows SmartScreen will warn on first run.
