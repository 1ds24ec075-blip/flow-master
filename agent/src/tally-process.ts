/**
 * Finding, launching and waiting for Tally.
 *
 * Tally has no background service — it only answers HTTP while tally.exe is up
 * with a company loaded, so the agent has to babysit the process itself.
 */

import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { promisify } from "node:util";

import { log } from "./logger.ts";

const execFileAsync = promisify(execFile);

const PROCESS_NAMES = ["tally.exe", "tallyprime.exe"];

/** Common install locations, checked only after the registry lookup fails. */
const FALLBACK_PATHS = [
  "C:\\Program Files\\TallyPrime\\tally.exe",
  "C:\\Program Files\\Tally\\TallyPrime\\tally.exe",
  "C:\\Program Files (x86)\\TallyPrime\\tally.exe",
  "C:\\Tally.ERP9\\tally.exe",
  "C:\\Program Files\\Tally.ERP9\\tally.exe",
];

export async function isTallyRunning(): Promise<boolean> {
  if (platform() !== "win32") {
    // Non-Windows dev boxes talk to a Tally elsewhere on the network; the HTTP
    // reachability check is the real gate there.
    return true;
  }

  try {
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true });
    const haystack = stdout.toLowerCase();
    return PROCESS_NAMES.some((name) => haystack.includes(name));
  } catch (error) {
    log.warn("Could not read the process list", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Reads Tally's install path out of the registry rather than assuming one. */
export async function findTallyExecutable(configured?: string): Promise<string | null> {
  if (configured && existsSync(configured)) return configured;
  if (platform() !== "win32") return null;

  const registryKeys = [
    "HKLM\\SOFTWARE\\Tally Solutions\\TallyPrime",
    "HKLM\\SOFTWARE\\WOW6432Node\\Tally Solutions\\TallyPrime",
    "HKCU\\SOFTWARE\\Tally Solutions\\TallyPrime",
    "HKLM\\SOFTWARE\\Tally Solutions\\Tally.ERP9",
  ];

  for (const key of registryKeys) {
    try {
      const { stdout } = await execFileAsync("reg", ["query", key, "/s"], { windowsHide: true });
      const match = stdout.match(/REG_SZ\s+([A-Za-z]:\\[^\r\n]*?)(?:\r?\n|$)/);
      if (!match) continue;

      const base = match[1].trim().replace(/\\tally\.exe$/i, "");
      for (const candidate of [base, `${base}\\tally.exe`]) {
        if (candidate.toLowerCase().endsWith("tally.exe") && existsSync(candidate)) return candidate;
      }
    } catch {
      // Key absent — try the next one.
    }
  }

  return FALLBACK_PATHS.find((path) => existsSync(path)) ?? null;
}

export async function launchTally(exePath: string): Promise<void> {
  log.info("Launching Tally", exePath);
  const child = spawn(exePath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false, // Tally refuses to initialise its HTTP server headless.
  });
  child.unref();
}

/** Polls the HTTP endpoint until Tally answers, or gives up. */
export async function waitForTallyHttp(tallyUrl: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isTallyReachable(tallyUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  return false;
}

export async function isTallyReachable(tallyUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    // Tally answers any well-formed POST; a bare GET is enough to prove the
    // listener is up.
    const response = await fetch(tallyUrl, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * Brings Tally to a state where it can accept jobs.
 * Returns null on success, or the reason it couldn't.
 */
export async function ensureTallyReady(options: {
  tallyUrl: string;
  autoLaunch: boolean;
  tallyExePath?: string;
}): Promise<string | null> {
  if (await isTallyReachable(options.tallyUrl)) return null;

  const running = await isTallyRunning();
  if (running) {
    // Process is up but the HTTP server isn't — usually still starting, or the
    // gateway is switched off in F1 > Features.
    const ready = await waitForTallyHttp(options.tallyUrl, 15_000);
    return ready ? null : "Tally is running but its HTTP-XML server is not responding (enable it in F1 > Features).";
  }

  if (!options.autoLaunch) return "Tally is not running and auto-launch is disabled.";

  const exePath = await findTallyExecutable(options.tallyExePath);
  if (!exePath) {
    return "Tally is not running and its executable could not be located — set tallyExePath in the agent config.";
  }

  await launchTally(exePath);
  const ready = await waitForTallyHttp(options.tallyUrl, 45_000);
  return ready ? null : "Tally was launched but never started answering on its HTTP port.";
}
