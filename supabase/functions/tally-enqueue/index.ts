/**
 * Turns a bill into queued sync jobs.
 *
 * Produces JSON only — no XML is rendered here. The agent renders it through
 * the shared serializer at send time, so a serializer fix reaches jobs that are
 * already sitting in the queue.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { serviceClient, requireUserOrService } from "../_shared/agent-auth.ts";
import { buildBillSyncJobs } from "../_shared/tally/jobs.ts";
import { TallyValidationError, isVoucherJob, isLedgerMaster } from "../_shared/tally/types.ts";
import type { JobPayload, JobType } from "../_shared/tally/types.ts";

function jobTypeFor(payload: JobPayload): JobType {
  if (isVoucherJob(payload)) return "voucher";
  return isLedgerMaster(payload) ? "master_ledger" : "master_stockitem";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    await requireUserOrService(req);

    const { billId, agentId } = await req.json();
    if (!billId) throw new Error("billId is required");

    const supabase = serviceClient();

    // Pick the target agent: explicit, or the single active installation.
    let targetAgentId = agentId as string | undefined;
    if (!targetAgentId) {
      const { data: agents, error: agentError } = await supabase
        .from("tally_agents")
        .select("id")
        .is("revoked_at", null)
        .order("created_at", { ascending: true })
        .limit(2);
      if (agentError) throw agentError;
      if (!agents?.length) {
        throw new Error("No Tally agent is registered. Install the desktop agent and register it first.");
      }
      if (agents.length > 1) {
        throw new Error("Multiple Tally agents are registered — pass agentId to choose one.");
      }
      targetAgentId = agents[0].id;
    }

    const { data: bill, error: billError } = await supabase
      .from("bills")
      .select("*, expense_categories(name)")
      .eq("id", billId)
      .single();

    if (billError) throw billError;
    if (!bill) throw new Error("Bill not found");
    if (bill.is_duplicate) throw new Error("Duplicate bills cannot be sent to Tally");

    const { data: lineItems, error: lineItemsError } = await supabase
      .from("expense_line_items")
      .select("item_description, quantity, unit_price, tax_rate, amount")
      .eq("bill_id", billId)
      .order("created_at", { ascending: true });

    if (lineItemsError) throw lineItemsError;

    const { masters, voucher } = buildBillSyncJobs(bill, lineItems ?? []);

    const rows = [...masters, voucher].map((payload) => ({
      agent_id: targetAgentId,
      job_type: jobTypeFor(payload),
      payload_json: payload,
      tally_guid: payload.guid,
      depends_on_guids: isVoucherJob(payload) ? (payload.dependsOnMasterGuids ?? []) : [],
      // Masters ahead of vouchers even before the dependency check kicks in.
      priority: isVoucherJob(payload) ? 200 : 100,
      source_table: "bills",
      source_id: bill.id,
      status: "pending",
      attempts: 0,
      last_error: null,
      retryable: true,
      claimed_at: null,
      synced_at: null,
    }));

    // Deterministic GUIDs mean re-enqueuing the same bill re-arms the existing
    // rows instead of creating a second voucher.
    const { data: queued, error: queueError } = await supabase
      .from("tally_sync_queue")
      .upsert(rows, { onConflict: "tally_guid,agent_id" })
      .select("id, job_type, tally_guid, status");

    if (queueError) throw queueError;

    await supabase
      .from("bills")
      .update({
        tally_json: voucher,
        tally_status: "queued",
        tally_queued_at: new Date().toISOString(),
        tally_error: null,
      })
      .eq("id", bill.id);

    return json({
      agent_id: targetAgentId,
      queued: queued?.length ?? 0,
      masters: masters.length,
      voucher_guid: voucher.guid,
      jobs: queued,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("tally-enqueue failed:", message);

    // A validation failure is the user's data problem, not a server fault, and
    // an auth failure must not read as one either — clients retry 5xx.
    const status = error instanceof TallyValidationError
      ? 422
      : message === "Authentication required"
        ? 401
        : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
