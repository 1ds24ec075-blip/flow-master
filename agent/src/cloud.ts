/** Agent side of the cloud contract: claim jobs, report outcomes. */

import type { AgentConfig } from "./config.ts";
import type { JobPayload, JobType } from "../../supabase/functions/_shared/tally/types.ts";
import { log } from "./logger.ts";

export interface ClaimedJob {
  id: string;
  jobType: JobType;
  payload: JobPayload;
  tallyGuid: string;
  dependsOnGuids: string[];
  attempts: number;
}

export interface PollResult {
  jobs: ClaimedJob[];
  pending: number;
  companyName: string;
  tallyUrl: string;
}

export interface JobResult {
  id: string;
  status: "success" | "failed";
  error: string | null;
  retryable: boolean;
}

async function callFunction<T>(
  config: AgentConfig,
  name: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Supabase requires an apikey even on functions with verify_jwt off.
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseAnonKey}`,
      "X-Agent-Token": config.agentToken,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${name} returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = (parsed as { error?: string })?.error ?? `HTTP ${response.status}`;
    throw new Error(`${name} failed: ${message}`);
  }

  return parsed as T;
}

export async function pollCloud(
  config: AgentConfig,
  state: { tallyRunning: boolean; companyLoaded: boolean; lastError: string | null },
  limit = 25,
): Promise<PollResult> {
  const data = await callFunction<{
    agent: { companyName: string; tallyUrl: string };
    jobs: ClaimedJob[];
    pending: number;
  }>(config, "tally-agent-poll", {
    limit,
    agentVersion: "1.0.0",
    tallyRunning: state.tallyRunning,
    companyLoaded: state.companyLoaded,
    lastError: state.lastError,
  });

  return {
    jobs: data.jobs ?? [],
    pending: data.pending ?? 0,
    // The cloud is authoritative for company name, so a correction made in the
    // dashboard reaches the agent without a reinstall.
    companyName: data.agent?.companyName || config.companyName,
    tallyUrl: data.agent?.tallyUrl || config.tallyUrl,
  };
}

export async function reportResults(config: AgentConfig, results: JobResult[]): Promise<number> {
  if (results.length === 0) return 0;
  const data = await callFunction<{ updated: number }>(config, "tally-agent-report", { results });
  log.debug("Reported results to cloud", { count: results.length, updated: data.updated });
  return data.updated ?? 0;
}
