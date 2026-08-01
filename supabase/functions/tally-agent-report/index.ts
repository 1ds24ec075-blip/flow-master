/**
 * The agent's write side: per-job outcomes come back here so the dashboard can
 * show what actually happened instead of the failure dying in a local log.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { json, preflight } from "../_shared/http.ts";
import { authenticateAgent, serviceClient } from "../_shared/agent-auth.ts";

interface ReportedResult {
  id: string;
  status: "success" | "failed";
  error?: string | null;
  /** False for logic errors that will never succeed on retry. */
  retryable?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const supabase = serviceClient();
    const agent = await authenticateAgent(req, supabase);

    const body = await req.json();
    const results: ReportedResult[] = Array.isArray(body?.results) ? body.results : [];
    if (results.length === 0) return json({ updated: 0 });

    const now = new Date().toISOString();
    let updated = 0;

    for (const result of results) {
      if (!result?.id) continue;

      const succeeded = result.status === "success";
      const retryable = result.retryable !== false;

      const { data: row, error } = await supabase
        .from("tally_sync_queue")
        .update({
          // A retryable failure goes back to 'pending' so the next flush picks
          // it up; attempts is already incremented at claim time, and
          // claim_tally_jobs stops handing it out past max_attempts.
          status: succeeded ? "success" : retryable ? "pending" : "failed",
          last_error: succeeded ? null : (result.error ?? "Unknown Tally error"),
          retryable,
          synced_at: succeeded ? now : null,
          claimed_at: null,
        })
        .eq("id", result.id)
        .eq("agent_id", agent.id)
        .select("id, job_type, source_table, source_id, status, last_error")
        .maybeSingle();

      if (error) throw error;
      if (!row) continue;
      updated += 1;

      // Mirror the voucher's fate onto the bill so the Bills page reflects it.
      if (row.job_type === "voucher" && row.source_table === "bills" && row.source_id) {
        await supabase
          .from("bills")
          .update(
            succeeded
              ? { tally_status: "sent", tally_uploaded_at: now, tally_error: null }
              : {
                  tally_status: retryable ? "queued" : "failed",
                  tally_error: row.last_error,
                },
          )
          .eq("id", row.source_id);
      }
    }

    await supabase
      .from("tally_agents")
      .update({ last_seen_at: now, last_error: body?.lastError ?? null })
      .eq("id", agent.id);

    return json({ updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const unauthorized = /token|agent/i.test(message);
    console.error("tally-agent-report failed:", message);
    return json({ error: message }, unauthorized ? 401 : 500);
  }
});
