#!/usr/bin/env node
/**
 * Talligence Tally Bridge Agent
 * ------------------------------
 * Runs on the same machine as Tally (or on any machine on the same LAN as Tally).
 * Polls the cloud queue for pending vouchers and forwards them to the local
 * Tally HTTP XML endpoint (default http://localhost:9000).
 *
 * Configuration via environment variables or a `.env` file next to this script:
 *   SUPABASE_URL       - your Talligence Supabase URL
 *   BRIDGE_KEY         - the API key shown in the app's Tally Bridge page
 *   TALLY_URL          - Tally HTTP endpoint (default http://localhost:9000)
 *   POLL_INTERVAL_MS   - poll interval in ms (default 5000)
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

// Very small .env loader (no dependencies)
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const BRIDGE_KEY = process.env.BRIDGE_KEY;
const TALLY_URL = process.env.TALLY_URL || "http://localhost:9000";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

if (!SUPABASE_URL || !BRIDGE_KEY) {
  console.error("Missing SUPABASE_URL or BRIDGE_KEY. Create a .env file next to index.js.");
  process.exit(1);
}

const POLL_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/tally-bridge-poll`;
const REPORT_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/tally-bridge-report`;

function log(...args) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}]`, ...args);
}

async function pollOnce() {
  const res = await fetch(POLL_URL, {
    method: "POST",
    headers: { "x-bridge-key": BRIDGE_KEY, "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`poll failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function postToTally(xml) {
  return new Promise((resolve) => {
    try {
      const url = new URL(TALLY_URL);
      const req = http.request(
        {
          method: "POST",
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname || "/",
          headers: { "Content-Type": "text/xml", "Content-Length": Buffer.byteLength(xml) },
          timeout: 60_000,
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
        },
      );
      req.on("error", (err) => resolve({ ok: false, status: 0, body: err.message }));
      req.on("timeout", () => {
        req.destroy(new Error("Tally request timed out"));
      });
      req.write(xml);
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 0, body: e.message });
    }
  });
}

function extractLineError(xml) {
  if (!xml) return null;
  const m = xml.match(/<LINEERROR[^>]*>([\s\S]*?)<\/LINEERROR>/i);
  return m ? m[1].trim() : null;
}

async function report(jobId, status, tallyResponse, errorMessage) {
  const res = await fetch(REPORT_URL, {
    method: "POST",
    headers: { "x-bridge-key": BRIDGE_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      status,
      tally_response: tallyResponse,
      error_message: errorMessage,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    log("Report failed:", res.status, t);
  }
}

async function loop() {
  try {
    const { job, bridge } = await pollOnce();
    if (!job) return;
    log(`Job ${job.id.slice(0, 8)} (${job.source_type}) → ${bridge?.tally_url || TALLY_URL}`);
    const target = bridge?.tally_url || TALLY_URL;
    // Use bridge-provided URL if present
    const originalTallyUrl = process.env.TALLY_URL;
    process.env.TALLY_URL = target;
    const result = await postToTally(job.payload_xml);
    process.env.TALLY_URL = originalTallyUrl;

    const lineErr = extractLineError(result.body);
    if (!result.ok || lineErr) {
      await report(job.id, "failed", result.body?.slice(0, 4000), lineErr || `Tally returned ${result.status}`);
      log("  ✖ failed:", lineErr || `HTTP ${result.status}`);
    } else {
      await report(job.id, "sent", result.body?.slice(0, 4000), null);
      log("  ✔ sent to Tally");
    }
  } catch (e) {
    log("Poll error:", e.message);
  }
}

log(`Tally Bridge starting. Polling every ${POLL_INTERVAL_MS}ms → ${POLL_URL}`);
log(`Forwarding vouchers to ${TALLY_URL}`);
setInterval(loop, POLL_INTERVAL_MS);
loop();
