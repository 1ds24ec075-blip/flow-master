/**
 * Run with:  npm test   (from agent/)
 *
 * Covers the two properties the queue exists to guarantee: a voucher never
 * goes out before its masters, and a confirmed delivery never goes out twice.
 */

import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "reconza-agent-test-"));
process.env.RECONZA_AGENT_DATA = scratch;

const {
  closeDb,
  isDelivered,
  markDelivered,
  markFailure,
  markReported,
  markSuccess,
  openDb,
  queueStats,
  readyJobs,
  unreportedResults,
  upsertJobs,
} = await import("./db.ts");

const MASTER_GUID = "11111111-1111-1111-1111-111111111111";
const VOUCHER_GUID = "22222222-2222-2222-2222-222222222222";

const masterJob = {
  id: "job-master",
  jobType: "master_ledger" as const,
  tallyGuid: MASTER_GUID,
  dependsOnGuids: [],
  attempts: 0,
  payload: { guid: MASTER_GUID, masterType: "ledger" as const, name: "Acme Ltd", parentGroup: "Sundry Creditors" },
};

const voucherJob = {
  id: "job-voucher",
  jobType: "voucher" as const,
  tallyGuid: VOUCHER_GUID,
  dependsOnGuids: [MASTER_GUID],
  attempts: 0,
  payload: {
    guid: VOUCHER_GUID,
    voucherType: "Purchase" as const,
    date: "2026-04-29",
    voucherNumber: "A-1",
    reference: "A-1",
    party: { ledgerName: "Acme Ltd" },
    lineItems: [],
    taxLines: [],
    totalAmount: 100,
  },
};

beforeEach(() => {
  const db = openDb();
  db.exec("DELETE FROM sync_queue; DELETE FROM delivered_guids;");
});

after(() => {
  closeDb();
  rmSync(scratch, { recursive: true, force: true });
});

test("a voucher stays blocked until its masters are delivered", () => {
  upsertJobs([masterJob, voucherJob]);

  let ready = readyJobs(3);
  assert.equal(ready.length, 1, "only the master should be releasable");
  assert.equal(ready[0].jobType, "master_ledger");
  assert.equal(queueStats(3).blocked, 1);

  markSuccess(ready[0]);

  ready = readyJobs(3);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].jobType, "voucher", "voucher releases once its master lands");
  assert.equal(queueStats(3).blocked, 0);
});

test("masters are ordered ahead of vouchers", () => {
  upsertJobs([voucherJob, { ...masterJob, dependsOnGuids: [] }]);
  markDelivered(MASTER_GUID);

  const ready = readyJobs(3);
  assert.deepEqual(
    ready.map((job) => job.jobType),
    ["master_ledger", "voucher"],
  );
});

test("a delivered GUID is never handed out again", () => {
  upsertJobs([masterJob]);
  assert.equal(isDelivered(MASTER_GUID), false);

  markSuccess(readyJobs(3)[0]);
  assert.equal(isDelivered(MASTER_GUID), true);
  assert.equal(readyJobs(3).length, 0);

  // Re-claiming the same job from the cloud must not resurrect it.
  upsertJobs([masterJob]);
  assert.equal(readyJobs(3).length, 0, "an already-succeeded job stays succeeded");
});

test("retryable failures come back, permanent ones don't", () => {
  upsertJobs([masterJob]);
  markFailure(readyJobs(3)[0], "Tally busy", true);
  assert.equal(readyJobs(3).length, 1, "retryable failure is re-offered");

  markFailure(readyJobs(3)[0], "Ledger does not exist", false);
  assert.equal(readyJobs(3).length, 0, "permanent failure is not re-offered");
  assert.equal(queueStats(3).failed, 1);
});

test("jobs stop being offered once attempts are exhausted", () => {
  upsertJobs([masterJob]);
  for (let i = 0; i < 3; i++) {
    const ready = readyJobs(3);
    if (ready.length === 0) break;
    markFailure(ready[0], "Tally busy", true);
  }
  assert.equal(readyJobs(3).length, 0, "capped at maxAttempts");
});

test("outcomes stay unreported until the cloud acknowledges them", () => {
  upsertJobs([masterJob]);
  markSuccess(readyJobs(3)[0]);

  const pending = unreportedResults();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, "success");

  markReported(pending.map((result) => result.id));
  assert.equal(unreportedResults().length, 0);
});

test("re-claiming a pending job updates it rather than duplicating", () => {
  upsertJobs([masterJob]);
  upsertJobs([{ ...masterJob, id: "job-master-reclaimed", attempts: 1 }]);

  const ready = readyJobs(3);
  assert.equal(ready.length, 1, "one row per GUID");
  assert.equal(ready[0].id, "job-master-reclaimed");
});

test("an already-delivered job handed back by the cloud is re-reported, not re-pushed", () => {
  upsertJobs([masterJob]);
  markSuccess(readyJobs(3)[0]);
  markReported(unreportedResults().map((result) => result.id));
  assert.equal(unreportedResults().length, 0, "settled after the first report");

  // Re-enqueueing a bill re-arms every master it depends on, so the cloud
  // offers this one again even though Tally already has it.
  upsertJobs([{ ...masterJob, id: "job-master-reoffered", attempts: 1 }]);

  assert.equal(readyJobs(3).length, 0, "still must not be pushed to Tally twice");
  const pending = unreportedResults();
  assert.equal(pending.length, 1, "but the cloud has to be told again");
  assert.equal(pending[0].status, "success");
  assert.equal(pending[0].id, "job-master-reoffered", "reported against the row the cloud handed us");

  // Once acknowledged it settles again instead of looping.
  markReported(pending.map((result) => result.id));
  assert.equal(unreportedResults().length, 0);
});
