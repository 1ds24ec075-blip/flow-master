/**
 * The flush cycle.
 *
 * One at a time, in dependency order, with a hard guarantee that a GUID already
 * confirmed delivered is never sent again — that's what stops an interval tick
 * and an on-Tally-launch flush from booking the same voucher twice.
 */

import type { AgentConfig } from "./config.ts";
import {
  isDelivered,
  markDelivered,
  markFailure,
  markReported,
  markSuccess,
  queueStats,
  readyJobs,
  unreportedResults,
  upsertJobs,
  type LocalJob,
} from "./db.ts";
import { pollCloud, reportResults } from "./cloud.ts";
import { ensureStockPrerequisites, fetchExistingMasterNames, pushJob, verifyCompanyLoaded } from "./tally-client.ts";
import { ensureTallyReady, isTallyReachable, isTallyRunning } from "./tally-process.ts";
import { log } from "./logger.ts";
import {
  BILL_STOCK_GROUP_NAME,
  DEFAULT_STOCK_UNIT,
} from "../../supabase/functions/_shared/tally/jobs.ts";
import { isStockItemMaster, isVoucherJob } from "../../supabase/functions/_shared/tally/types.ts";

export interface AgentState {
  running: boolean;
  lastFlushAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  tallyRunning: boolean;
  companyLoaded: boolean;
  pendingCloud: number;
}

export const state: AgentState = {
  running: false,
  lastFlushAt: null,
  lastSuccessAt: null,
  lastError: null,
  tallyRunning: false,
  companyLoaded: false,
  pendingCloud: 0,
};

let flushing = false;

/** Pushes any outcomes the cloud hasn't acknowledged yet. */
async function drainReports(config: AgentConfig): Promise<void> {
  const pending = unreportedResults();
  if (pending.length === 0) return;

  try {
    await reportResults(config, pending);
    markReported(pending.map((result) => result.id));
  } catch (error) {
    // Keep them unreported; the next cycle tries again. Never let a reporting
    // failure look like a sync failure.
    log.warn("Could not report results to cloud", error instanceof Error ? error.message : error);
  }
}

async function deliver(job: LocalJob, tallyUrl: string, companyName: string): Promise<boolean> {
  // Idempotency gate: the queue may hand this back after a crash between
  // "Tally accepted it" and "we recorded that".
  if (isDelivered(job.tallyGuid)) {
    log.info("Skipping already-delivered job", { guid: job.tallyGuid, type: job.jobType });
    markSuccess(job);
    return true;
  }

  const result = await pushJob(tallyUrl, job.payload, companyName);

  if (!result.error) {
    markSuccess(job);
    state.lastSuccessAt = new Date().toISOString();
    log.info("Delivered to Tally", {
      type: job.jobType,
      name: isVoucherJob(job.payload) ? job.payload.voucherNumber : job.payload.name,
      created: result.created,
    });
    return true;
  }

  markFailure(job, result.error, result.retryable);
  log.error("Job failed", { type: job.jobType, guid: job.tallyGuid, error: result.error, retryable: result.retryable });
  return false;
}

/**
 * One full cycle: claim from cloud -> ensure Tally is up -> push in order ->
 * report back. Safe to call from every trigger; overlapping calls no-op.
 */
export async function flush(config: AgentConfig, reason: string): Promise<void> {
  if (flushing) {
    log.debug("Flush already in progress, skipping", reason);
    return;
  }
  flushing = true;
  state.lastFlushAt = new Date().toISOString();

  try {
    state.tallyRunning = await isTallyRunning();

    // Claim first: even if Tally is down we want the cloud to know we're alive,
    // and the jobs land in the local queue ready for the moment it comes up.
    let companyName = config.companyName;
    let tallyUrl = config.tallyUrl;
    // Held separately so a successful local flush doesn't erase the fact that
    // we can't reach the cloud — that has to stay visible on the status page.
    let cloudError: string | null = null;

    try {
      const poll = await pollCloud(config, {
        tallyRunning: state.tallyRunning,
        companyLoaded: state.companyLoaded,
        lastError: state.lastError,
      });
      companyName = poll.companyName;
      tallyUrl = poll.tallyUrl;
      state.pendingCloud = poll.pending;

      if (poll.jobs.length > 0) {
        upsertJobs(poll.jobs);
        log.info(`Claimed ${poll.jobs.length} job(s) from cloud`, { reason });
      }
    } catch (error) {
      cloudError = error instanceof Error ? error.message : String(error);
      state.lastError = cloudError;
      log.warn("Could not reach the cloud queue", cloudError);
      // Fall through — locally queued work can still be delivered offline.
    }

    const pending = readyJobs(config.maxAttempts);
    if (pending.length === 0) {
      // An idle queue is the normal state, and it used to leave companyLoaded
      // stuck at its initial false — the status page then reported a company
      // problem that did not exist. Refresh it while Tally is already up, but
      // never launch Tally just to answer a status question.
      if (state.tallyRunning && (await isTallyReachable(tallyUrl))) {
        state.companyLoaded = !(await verifyCompanyLoaded(tallyUrl, companyName));
      }
      await drainReports(config);
      state.lastError = cloudError;
      return;
    }

    const blocker = await ensureTallyReady({
      tallyUrl,
      autoLaunch: config.autoLaunchTally,
      tallyExePath: config.tallyExePath,
    });
    if (blocker) {
      state.lastError = blocker;
      state.companyLoaded = false;
      log.warn("Tally is not ready", blocker);
      await drainReports(config);
      return;
    }

    const companyProblem = await verifyCompanyLoaded(tallyUrl, companyName);
    if (companyProblem) {
      // Not fatal to the process, but every push will fail until it's fixed, so
      // surface it rather than burning retry attempts.
      state.lastError = companyProblem;
      state.companyLoaded = false;
      log.error("Wrong company loaded", companyProblem);
      await drainReports(config);
      return;
    }
    state.companyLoaded = true;

    // Skip create jobs for masters Tally already has — it rejects duplicates.
    const needsStockItems = pending.some((job) => job.jobType === "master_stockitem");
    if (needsStockItems) {
      await ensureStockPrerequisites(tallyUrl, companyName, DEFAULT_STOCK_UNIT, BILL_STOCK_GROUP_NAME);
    }

    const existingLedgers = pending.some((job) => job.jobType === "master_ledger")
      ? await fetchExistingMasterNames(tallyUrl, companyName, "Ledger")
      : new Set<string>();
    const existingStockItems = needsStockItems
      ? await fetchExistingMasterNames(tallyUrl, companyName, "StockItem")
      : new Set<string>();

    let delivered = 0;
    for (const job of pending) {
      if (!isVoucherJob(job.payload)) {
        const name = job.payload.name.toLowerCase();
        const alreadyThere = isStockItemMaster(job.payload)
          ? existingStockItems.has(name)
          : existingLedgers.has(name);

        if (alreadyThere) {
          log.debug("Master already exists in Tally, skipping create", job.payload.name);
          markDelivered(job.tallyGuid);
          markSuccess(job);
          delivered += 1;
          continue;
        }
      }

      const ok = await deliver(job, tallyUrl, companyName);
      if (ok) delivered += 1;
    }

    log.info(`Flush complete (${reason})`, { attempted: pending.length, delivered, ...queueStats(config.maxAttempts) });
    state.lastError = cloudError;
    await drainReports(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    log.error("Flush cycle crashed", message);
  } finally {
    flushing = false;
  }
}
