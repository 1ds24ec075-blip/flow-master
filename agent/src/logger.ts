import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { dataDir } from "./config.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Rolling in-memory tail, surfaced on the local status page. */
const recent: string[] = [];
const RECENT_LIMIT = 200;

function logPath(): string {
  const dir = join(dataDir(), "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "agent.log");
}

function rotate(path: string): void {
  try {
    if (!existsSync(path) || statSync(path).size < MAX_BYTES) return;
    const oldest = `${path}.${KEEP}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${path}.${i}`;
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
    }
    renameSync(path, `${path}.1`);
  } catch {
    // Never let logging break the sync loop.
  }
}

function write(level: LogLevel, message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${
    detail === undefined ? "" : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
  }`;

  recent.push(line);
  if (recent.length > RECENT_LIMIT) recent.shift();

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  try {
    const path = logPath();
    rotate(path);
    appendFileSync(path, `${line}\n`, "utf8");
  } catch {
    // Disk full or permissions — console output already happened.
  }
}

export const log = {
  debug: (message: string, detail?: unknown) => {
    if (process.env.RECONZA_AGENT_DEBUG) write("debug", message, detail);
  },
  info: (message: string, detail?: unknown) => write("info", message, detail),
  warn: (message: string, detail?: unknown) => write("warn", message, detail),
  error: (message: string, detail?: unknown) => write("error", message, detail),
  tail: (limit = 50): string[] => recent.slice(-limit),
};
