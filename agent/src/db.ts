/**
 * The agent's durable local queue.
 *
 * The cloud queue is authoritative, but jobs are mirrored here the moment they
 * are claimed so a machine that loses its network (or gets rebooted mid-flush)
 * still knows exactly what it owes Tally and what it already delivered.
 *
 * Stores payload JSON, never XML — see the note at the top of the serializer.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { dataDir } from "./config.ts";
import type { JobPayload, JobStatus, JobType } from "../../supabase/functions/_shared/tally/types.ts";

export interface LocalJob {
  id: string;
  jobType: JobType;
  payload: JobPayload;
  tallyGuid: string;
  dependsOnGuids: string[];
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  retryable: boolean;
  reported: boolean;
}

interface JobRow {
  id: string;
  job_type: string;
  payload_json: string;
  tally_guid: string;
  depends_on_guids: string;
  status: string;
  attempts: number;
  last_error: string | null;
  retryable: number;
  reported: number;
}

let db: DatabaseSync | null = null;

export function openDb(): DatabaseSync {
  if (db) return db;

  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(join(dir, "queue.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      tally_guid TEXT NOT NULL UNIQUE,
      depends_on_guids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      retryable INTEGER NOT NULL DEFAULT 1,
      reported INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_reported ON sync_queue(reported);

    -- Every GUID we have ever confirmed. Checked before pushing so a job that
    -- succeeded but failed to report can't be delivered to Tally twice.
    CREATE TABLE IF NOT EXISTS delivered_guids (
      tally_guid TEXT PRIMARY KEY,
      delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function toJob(row: JobRow): LocalJob {
  return {
    id: row.id,
    jobType: row.job_type as JobType,
    payload: JSON.parse(row.payload_json) as JobPayload,
    tallyGuid: row.tally_guid,
    dependsOnGuids: JSON.parse(row.depends_on_guids) as string[],
    status: row.status as JobStatus,
    attempts: row.attempts,
    lastError: row.last_error,
    retryable: row.retryable === 1,
    reported: row.reported === 1,
  };
}

/** Mirrors cloud-claimed jobs locally. Existing GUIDs are re-armed, not duplicated. */
export function upsertJobs(jobs: Array<Omit<LocalJob, "status" | "reported" | "retryable" | "lastError">>): number {
  const database = openDb();
  const statement = database.prepare(`
    INSERT INTO sync_queue (id, job_type, payload_json, tally_guid, depends_on_guids, attempts, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(tally_guid) DO UPDATE SET
      id = excluded.id,
      payload_json = excluded.payload_json,
      depends_on_guids = excluded.depends_on_guids,
      attempts = excluded.attempts,
      status = CASE WHEN sync_queue.status = 'success' THEN 'success' ELSE 'pending' END,
      -- Being handed a job we have already delivered means the cloud does not
      -- know that yet -- re-enqueueing a bill re-arms every master it depends
      -- on, including ones already in Tally. Such a job is never pushed again
      -- (readyJobs skips 'success'), so unless the reported flag is cleared
      -- here nothing ever tells the cloud, it reaps the claim back to
      -- 'pending', and hands it out again every cycle forever. Clearing it
      -- queues one more success report, after which the cloud marks the row
      -- done and stops offering it.
      reported = CASE WHEN sync_queue.status = 'success' THEN 0 ELSE sync_queue.reported END
  `);

  let written = 0;
  for (const job of jobs) {
    statement.run(
      job.id,
      job.jobType,
      JSON.stringify(job.payload),
      job.tallyGuid,
      JSON.stringify(job.dependsOnGuids ?? []),
      job.attempts ?? 0,
    );
    written += 1;
  }
  return written;
}

/**
 * Jobs ready to push: masters ahead of vouchers, and no voucher whose masters
 * haven't been confirmed delivered.
 */
export function readyJobs(maxAttempts: number): LocalJob[] {
  const database = openDb();
  const rows = database
    .prepare(
      `SELECT * FROM sync_queue
       WHERE status = 'pending' AND attempts < ?
       ORDER BY CASE WHEN job_type = 'voucher' THEN 1 ELSE 0 END, created_at`,
    )
    .all(maxAttempts) as unknown as JobRow[];

  const jobs = rows.map(toJob);
  return jobs.filter((job) => job.dependsOnGuids.every((guid) => isDelivered(guid)));
}

export function isDelivered(guid: string): boolean {
  const database = openDb();
  const row = database.prepare("SELECT 1 AS hit FROM delivered_guids WHERE tally_guid = ?").get(guid);
  return Boolean(row);
}

export function markDelivered(guid: string): void {
  openDb()
    .prepare("INSERT OR IGNORE INTO delivered_guids (tally_guid) VALUES (?)")
    .run(guid);
}

export function markSuccess(job: LocalJob): void {
  const database = openDb();
  database
    .prepare(
      "UPDATE sync_queue SET status = 'success', last_error = NULL, reported = 0, synced_at = datetime('now') WHERE id = ?",
    )
    .run(job.id);
  markDelivered(job.tallyGuid);
}

export function markFailure(job: LocalJob, error: string, retryable: boolean): void {
  openDb()
    .prepare(
      `UPDATE sync_queue
       SET status = ?, attempts = attempts + 1, last_error = ?, retryable = ?, reported = 0
       WHERE id = ?`,
    )
    .run(retryable ? "pending" : "failed", error, retryable ? 1 : 0, job.id);
}

/** Outcomes the cloud hasn't acknowledged yet. */
export function unreportedResults(): Array<{ id: string; status: "success" | "failed"; error: string | null; retryable: boolean }> {
  const database = openDb();
  const rows = database
    .prepare(
      `SELECT id, status, last_error, retryable FROM sync_queue
       WHERE reported = 0 AND status IN ('success', 'failed', 'pending') AND (status <> 'pending' OR last_error IS NOT NULL)`,
    )
    .all() as unknown as Array<{ id: string; status: string; last_error: string | null; retryable: number }>;

  return rows.map((row) => ({
    id: row.id,
    status: row.status === "success" ? "success" : "failed",
    error: row.last_error,
    retryable: row.retryable === 1,
  }));
}

export function markReported(ids: string[]): void {
  if (ids.length === 0) return;
  const database = openDb();
  const statement = database.prepare("UPDATE sync_queue SET reported = 1 WHERE id = ?");
  for (const id of ids) statement.run(id);
}

export interface QueueStats {
  pending: number;
  failed: number;
  success: number;
  blocked: number;
}

export function queueStats(maxAttempts: number): QueueStats {
  const database = openDb();
  const counts = database
    .prepare("SELECT status, COUNT(*) AS n FROM sync_queue GROUP BY status")
    .all() as unknown as Array<{ status: string; n: number }>;

  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row.n]));
  const pending = byStatus.pending ?? 0;
  const ready = readyJobs(maxAttempts).length;

  return {
    pending,
    failed: byStatus.failed ?? 0,
    success: byStatus.success ?? 0,
    // Pending but waiting on a master that hasn't landed yet.
    blocked: Math.max(0, pending - ready),
  };
}

export function closeDb(): void {
  db?.close();
  db = null;
}
