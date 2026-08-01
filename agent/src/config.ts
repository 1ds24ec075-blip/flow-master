import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface AgentConfig {
  /** Per-installation token minted by the tally-agents edge function. */
  agentToken: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Must match the company name inside Tally exactly, case-sensitive. */
  companyName: string;
  tallyUrl: string;
  /** Full path to tally.exe. Resolved from the registry when omitted. */
  tallyExePath?: string;
  /** Primary flush cadence, milliseconds. Spec calls for 2-5 minutes. */
  flushIntervalMs: number;
  /** How often we ask the cloud whether new work arrived. */
  cloudPollIntervalMs: number;
  /** How often we check whether tally.exe came up. */
  processWatchIntervalMs: number;
  /** Start Tally ourselves when it isn't running. */
  autoLaunchTally: boolean;
  statusPort: number;
  maxAttempts: number;
}

const DEFAULTS: Omit<AgentConfig, "agentToken" | "supabaseUrl" | "supabaseAnonKey" | "companyName"> = {
  tallyUrl: "http://localhost:9000",
  flushIntervalMs: 3 * 60_000,
  cloudPollIntervalMs: 20_000,
  processWatchIntervalMs: 15_000,
  autoLaunchTally: true,
  statusPort: 9700,
  maxAttempts: 3,
};

export function configDir(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "ReconzaTallyAgent");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "reconza-tally-agent");
}

export function configPath(): string {
  return process.env.RECONZA_AGENT_CONFIG || join(configDir(), "config.json");
}

export function dataDir(): string {
  return process.env.RECONZA_AGENT_DATA || configDir();
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function saveConfig(config: AgentConfig): void {
  const path = configPath();
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  // The token lives in here, so keep it off other local accounts where the
  // platform lets us say so.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ACLs don't map onto chmod; the installer handles it there.
  }
}

export function loadConfig(): AgentConfig {
  const path = configPath();
  const fileConfig = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};

  const config: AgentConfig = {
    ...DEFAULTS,
    ...fileConfig,
    // Environment wins, so a service wrapper can inject secrets without
    // writing them to disk at all.
    agentToken: process.env.RECONZA_AGENT_TOKEN || fileConfig.agentToken || "",
    supabaseUrl: process.env.RECONZA_SUPABASE_URL || fileConfig.supabaseUrl || "",
    supabaseAnonKey: process.env.RECONZA_SUPABASE_ANON_KEY || fileConfig.supabaseAnonKey || "",
    companyName: process.env.RECONZA_TALLY_COMPANY || fileConfig.companyName || "",
    tallyUrl: process.env.RECONZA_TALLY_URL || fileConfig.tallyUrl || DEFAULTS.tallyUrl,
    tallyExePath: process.env.RECONZA_TALLY_EXE || fileConfig.tallyExePath,
  };

  return config;
}

export function assertConfigured(config: AgentConfig): void {
  const missing: string[] = [];
  if (!config.agentToken) missing.push("agentToken");
  if (!config.supabaseUrl) missing.push("supabaseUrl");
  if (!config.supabaseAnonKey) missing.push("supabaseAnonKey");
  if (!config.companyName) missing.push("companyName");

  if (missing.length) {
    throw new Error(
      `Agent is not configured — missing ${missing.join(", ")}. Run \`npm run setup\` or edit ${configPath()}.`,
    );
  }
}
