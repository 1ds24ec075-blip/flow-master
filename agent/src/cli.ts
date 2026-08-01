/**
 * Setup / diagnostics CLI.
 *
 * `setup`  writes the config (including the token) to the per-user config dir
 * `doctor` checks every precondition and says which one is broken
 * `flush`  runs exactly one sync cycle and exits — useful from Task Scheduler
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { assertConfigured, configPath, loadConfig, saveConfig, type AgentConfig } from "./config.ts";
import { closeDb, openDb, queueStats } from "./db.ts";
import { flush } from "./processor.ts";
import { findTallyExecutable, isTallyReachable, isTallyRunning } from "./tally-process.ts";
import { verifyCompanyLoaded } from "./tally-client.ts";
import { pollCloud } from "./cloud.ts";
import { log } from "./logger.ts";

const command = process.argv[2] ?? "doctor";

async function setup(): Promise<void> {
  const existing = loadConfig();
  const rl = createInterface({ input: stdin, output: stdout });

  const ask = async (question: string, fallback?: string): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback || "";
  };

  console.log("\nReconza Tally Agent setup\n" + "-".repeat(30));
  console.log("Create an agent in the Reconza dashboard first — it gives you a token shown only once.\n");

  const config: AgentConfig = {
    ...existing,
    supabaseUrl: await ask("Supabase project URL", existing.supabaseUrl),
    supabaseAnonKey: await ask("Supabase anon key", existing.supabaseAnonKey),
    agentToken: await ask("Agent token (rcz_agent_...)", existing.agentToken),
    companyName: await ask("Tally company name (EXACT, case-sensitive)", existing.companyName),
    tallyUrl: await ask("Tally HTTP endpoint", existing.tallyUrl),
  };

  const detected = await findTallyExecutable(existing.tallyExePath);
  config.tallyExePath = await ask("Path to tally.exe (blank to auto-detect)", detected ?? "");
  if (!config.tallyExePath) delete config.tallyExePath;

  rl.close();

  saveConfig(config);
  console.log(`\nSaved to ${configPath()}`);
  console.log("The company name must match Tally exactly — a mismatch silently breaks every sync.");
  console.log("Next: run `npm run doctor` to verify, then `npm start`.\n");
}

async function doctor(): Promise<void> {
  const config = loadConfig();
  const checks: Array<[string, boolean, string]> = [];

  let configured = true;
  try {
    assertConfigured(config);
  } catch (error) {
    configured = false;
    checks.push(["Config complete", false, error instanceof Error ? error.message : ""]);
  }
  if (configured) checks.push(["Config complete", true, configPath()]);

  const exePath = await findTallyExecutable(config.tallyExePath);
  checks.push(["tally.exe located", Boolean(exePath), exePath ?? "not found — set tallyExePath"]);

  const running = await isTallyRunning();
  checks.push(["Tally process running", running, running ? "" : "start Tally, or let the agent auto-launch it"]);

  const reachable = await isTallyReachable(config.tallyUrl);
  checks.push([
    "Tally HTTP reachable",
    reachable,
    reachable ? config.tallyUrl : `no answer on ${config.tallyUrl} — enable the HTTP-XML server in F1 > Features`,
  ]);

  if (reachable && config.companyName) {
    const problem = await verifyCompanyLoaded(config.tallyUrl, config.companyName);
    checks.push(["Correct company loaded", !problem, problem ?? config.companyName]);
  }

  if (configured) {
    try {
      const poll = await pollCloud(config, { tallyRunning: running, companyLoaded: true, lastError: null }, 0);
      checks.push(["Cloud reachable", true, `${poll.pending} job(s) pending for this agent`]);
    } catch (error) {
      checks.push(["Cloud reachable", false, error instanceof Error ? error.message : String(error)]);
    }
  }

  openDb();
  const stats = queueStats(config.maxAttempts);
  checks.push([
    "Local queue",
    stats.failed === 0,
    `${stats.pending} pending, ${stats.blocked} blocked on masters, ${stats.failed} failed, ${stats.success} delivered`,
  ]);

  console.log("");
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "  OK  " : " FAIL "} ${label.padEnd(26)} ${detail}`);
  }
  console.log("");

  closeDb();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

async function once(): Promise<void> {
  const config = loadConfig();
  assertConfigured(config);
  openDb();
  await flush(config, "cli");
  closeDb();
}

const commands: Record<string, () => Promise<void>> = { setup, doctor, flush: once };

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

handler().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
