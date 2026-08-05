# Tally attempts migration + agent function deploy

Ordered, verified rollout against the live backend. Step 1 is already done and its results are recorded below.

## Waiting on you

Paste the contents of `20260804120000_tally_attempts_count_deliveries.sql`. It is not present in this project (`supabase/migrations/` ends at `20260801174908_…`), so there is nothing for me to apply yet. I will run exactly what you paste — no additions, no reordering.

The other two files you named are also absent, so `add_companies_and_igst` and `index_delivered_masters` stay unapplied by default. I will not author or apply them.

## Step 1 — Pre-flight verification (complete)

Read-only queries against production:

- **Jobs holding burned attempts with no recorded error:** 3
- **Exhausted pending job carrying an error:** one row — `5031b02e-b01c-4604-8690-3d5d1c4057ff`, `voucher`, attempts 3 of 3, `The date 1-3-2026 is Out of Range!`
- **Bill blocked behind it:** one row — `1d6c6795-9ec7-4e9c-9434-391785e2295e`, `SO-2026-001`, `tally_status = 'queued'`

Confirmations you asked for:

- **Queries 2 and 3 describe the same set.** Queue row `5031b02e` carries `source_table = 'bills'` and `source_id = 1d6c6795…`, which is precisely the bill returned by query 3. One job, one bill.
- **No `success` row is in scope.** The queue holds 16 rows: 11 `success` (max attempts 1) and 5 `pending`. Every filter is restricted to `pending`/`in_progress`.

## Step 2 — Apply the one migration

Submit the pasted SQL, unmodified, as a single migration for your approval. After it runs I report the actual affected-row counts per statement and check them against the Step 1 preview:

- A backfill of the 3 silent-attempt jobs should report 3.
- A release of the exhausted job should report 1.
- A corresponding bill status correction should report 1.

If any count diverges from the preview, I stop and show you the discrepancy rather than continuing to Step 3.

## Step 3 — Deploy the two edge functions, in order

1. `tally-agent-poll`
2. `tally-agent-report`

Sequential, not batched, with the migration already live — `tally-agent-report` writes the columns the migration governs, so it must land last. I confirm each deploy succeeded before starting the next.

Not deployed this round: `tally-enqueue`, `bill-generate-tally`.

## Step 4 — Post-deploy queue state

Run and show every row:

```sql
SELECT id, job_type, status, attempts, last_error, source_id
FROM tally_sync_queue
WHERE status IN ('pending', 'in_progress')
ORDER BY created_at;
```

I will not restart or otherwise touch the local Tally agent — that stays your manual step.

## Technical notes

- Migrations here run through the Lovable migration tool, which surfaces the SQL for your approval before execution; there is no file-based apply path, which is why the SQL text itself is needed.
- I pause for your confirmation between Step 2, Step 3, and Step 4.
