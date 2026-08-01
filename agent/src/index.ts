/**
 * Agent entry point.
 *
 * Three triggers, per spec — none of them sufficient alone:
 *   A. interval          the workhorse
 *   B. on Tally launch   catches everything that piled up while it was closed
 *   C. cloud short-poll   gets a freshly processed bill in within seconds
 */

import { assertConfigured, loadConfig } from "./config.ts";
import { closeDb, openDb } from "./db.ts";
import { flush, state } from "./processor.ts";
import { isTallyRunning } from "./tally-process.ts";
import { startStatusServer } from "./status-server.ts";
import { log } from "./logger.ts";

const config = loadConfig();

try {
  assertConfigured(config);
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

openDb();
log.info("Reconza Tally agent starting", {
  company: config.companyName,
  tallyUrl: config.tallyUrl,
  flushIntervalMs: config.flushIntervalMs,
});

const timers: NodeJS.Timeout[] = [];
let tallyWasRunning = false;

function schedule(fn: () => void, intervalMs: number): void {
  const timer = setInterval(fn, intervalMs);
  // Don't hold the process open on this alone; the status server does that.
  timer.unref?.();
  timers.push(timer);
}

function requestFlush(reason: string): void {
  void flush(config, reason);
}

const server = startStatusServer(config, requestFlush);

// --- Trigger A: interval ----------------------------------------------------
schedule(() => requestFlush("interval"), config.flushIntervalMs);

// --- Trigger B: Tally just came up -----------------------------------------
schedule(() => {
  void (async () => {
    const running = await isTallyRunning();
    state.tallyRunning = running;

    if (running && !tallyWasRunning) {
      log.info("Tally started — flushing everything that queued up while it was closed");
      requestFlush("tally-launched");
    }
    tallyWasRunning = running;
  })();
}, config.processWatchIntervalMs);

// --- Trigger C: cloud short-poll --------------------------------------------
// A websocket would be lower latency, but short-polling survives sleep/resume
// and captive-portal wifi without a reconnect state machine.
schedule(() => requestFlush("cloud-poll"), config.cloudPollIntervalMs);

// Kick one off immediately so a restart doesn't wait a full interval.
requestFlush("startup");
state.running = true;

function shutdown(signal: string): void {
  log.info(`Received ${signal}, shutting down`);
  for (const timer of timers) clearInterval(timer);
  server.close();
  closeDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  // A dropped promise must never take the agent down; it just retries.
  log.error("Unhandled rejection", reason instanceof Error ? reason.message : String(reason));
});
