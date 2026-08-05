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

      // The increment and the "is this the last attempt?" decision live in one
      // SQL statement so they cannot interleave with another report.
      const { data: rows, error } = await supabase.rpc("record_tally_job_result", {
        p_id: result.id,
        p_agent_id: agent.id,
        p_success: succeeded,
        p_error: succeeded ? null : (result.error ?? "Unknown Tally error"),
        p_retryable: retryable,
      });

      if (error) throw error;
      const row = Array.isArray(rows) ? rows[0] : rows;
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
                  // Follow the row's real outcome: a job that has run out of
                  // attempts is 'failed' in the queue and must not keep
                  // claiming to be queued on the bill.
                  tally_status: row.status === "pending" ? "queued" : "failed",
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
