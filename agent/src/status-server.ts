/**
 * Minimal local status page — the "is it alive?" surface the spec asks for,
 * without pulling a native tray dependency into the install.
 *
 * Binds to loopback only. Nothing here should ever be reachable off-machine.
 */

import { createServer, type Server } from "node:http";

import type { AgentConfig } from "./config.ts";
import { queueStats } from "./db.ts";
import { log } from "./logger.ts";
import { state } from "./processor.ts";

function snapshot(config: AgentConfig) {
  return {
    status: state.lastError ? "attention" : state.running ? "ok" : "starting",
    tallyRunning: state.tallyRunning,
    companyLoaded: state.companyLoaded,
    company: config.companyName,
    tallyUrl: config.tallyUrl,
    lastFlushAt: state.lastFlushAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    pendingCloud: state.pendingCloud,
    queue: queueStats(config.maxAttempts),
  };
}

function page(data: ReturnType<typeof snapshot>, logLines: string[]): string {
  const badge = data.status === "ok" ? "#16a34a" : data.status === "attention" ? "#dc2626" : "#ca8a04";
  const row = (label: string, value: unknown) =>
    `<tr><th>${label}</th><td>${value === null || value === undefined || value === "" ? "&mdash;" : String(value)}</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Reconza Tally Agent</title>
<meta http-equiv="refresh" content="10">
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }
  h1 { font-size: 1.25rem; display: flex; align-items: center; gap: .5rem; }
  .dot { width: .7rem; height: .7rem; border-radius: 50%; background: ${badge}; display: inline-block; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid rgba(128,128,128,.25); }
  th { width: 12rem; font-weight: 600; opacity: .8; }
  pre { background: rgba(128,128,128,.12); padding: .75rem; border-radius: .4rem; overflow-x: auto; font-size: 12px; }
  .err { color: #dc2626; font-weight: 600; }
</style></head><body>
<h1><span class="dot"></span> Reconza Tally Agent</h1>
${data.lastError ? `<p class="err">${data.lastError}</p>` : ""}
<table>
  ${row("Company", data.company)}
  ${row("Tally endpoint", data.tallyUrl)}
  ${row("Tally running", data.tallyRunning ? "yes" : "no")}
  ${row("Company loaded", data.companyLoaded ? "yes" : "no")}
  ${row("Last sync attempt", data.lastFlushAt)}
  ${row("Last successful push", data.lastSuccessAt)}
  ${row("Pending (cloud)", data.pendingCloud)}
  ${row("Pending (local)", data.queue.pending)}
  ${row("Blocked on masters", data.queue.blocked)}
  ${row("Failed", data.queue.failed)}
  ${row("Delivered", data.queue.success)}
</table>
<h2 style="font-size:1rem">Recent activity</h2>
<pre>${logLines.map((line) => line.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)).join("\n")}</pre>
</body></html>`;
}

export function startStatusServer(config: AgentConfig, onFlushRequest: (reason: string) => void): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: !state.lastError }));
      return;
    }

    if (url.pathname === "/status.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshot(config), null, 2));
      return;
    }

    if (url.pathname === "/sync" && req.method === "POST") {
      onFlushRequest("manual");
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ queued: true }));
      return;
    }

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(snapshot(config), log.tail(40)));
      return;
    }

    res.writeHead(404).end();
  });

  // Loopback only — this is a local status surface, not a service.
  server.listen(config.statusPort, "127.0.0.1", () => {
    log.info(`Status page on http://localhost:${config.statusPort}`);
  });

  server.on("error", (error) => log.warn("Status server error", error.message));
  return server;
}
