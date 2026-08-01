/**
 * The agent's read side: heartbeat in, claimed jobs out.
 *
 * Claiming is atomic (claim_tally_jobs uses FOR UPDATE SKIP LOCKED) so an
 * interval tick and an on-Tally-launch flush firing together can't hand the
 * same job to two workers.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { json, preflight } from "../_shared/http.ts";
import { authenticateAgent, serviceClient } from "../_shared/agent-auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const supabase = serviceClient();
    const agent = await authenticateAgent(req, supabase);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 25, 100);

    await supabase
      .from("tally_agents")
      .update({
        last_seen_at: new Date().toISOString(),
        agent_version: body.agentVersion ?? null,
        tally_running: Boolean(body.tallyRunning),
        company_loaded: Boolean(body.companyLoaded),
        last_error: body.lastError ?? null,
      })
      .eq("id", agent.id);

    // Hand back anything a previous run claimed but never reported on.
    await supabase.rpc("reap_stale_tally_jobs", { p_older_than: "10 minutes" });

    const { data: jobs, error } = await supabase.rpc("claim_tally_jobs", {
      p_agent_id: agent.id,
      p_limit: limit,
    });
    if (error) throw error;

    const { count: pendingCount } = await supabase
      .from("tally_sync_queue")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agent.id)
      .eq("status", "pending");

    return json({
      agent: { id: agent.id, name: agent.name, companyName: agent.company_name, tallyUrl: agent.tally_url },
      jobs: (jobs ?? []).map((job: Record<string, unknown>) => ({
        id: job.id,
        jobType: job.job_type,
        payload: job.payload_json,
        tallyGuid: job.tally_guid,
        dependsOnGuids: job.depends_on_guids ?? [],
        attempts: job.attempts,
        schemaVersion: job.schema_version,
      })),
      pending: pendingCount ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const unauthorized = /token|agent/i.test(message);
    console.error("tally-agent-poll failed:", message);
    return json({ error: message }, unauthorized ? 401 : 500);
  }
});
