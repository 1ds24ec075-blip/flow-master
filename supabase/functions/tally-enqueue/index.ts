/**
 * Turns a bill into queued sync jobs.
 *
 * Produces JSON only — no XML is rendered here. The agent renders it through
 * the shared serializer at send time, so a serializer fix reaches jobs that are
 * already sitting in the queue.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders, json, preflight, errorMessage } from "../_shared/http.ts";
import { serviceClient } from "../_shared/agent-auth.ts";
import {
  authenticateCaller,
  requireCompanyMembership,
  resolveResourceCompany,
  CompanyAccessError,
  COMPANY_ACCESS_DENIED,
} from "../_shared/company-auth.ts";
import { buildBillSyncJobs } from "../_shared/tally/jobs.ts";
import { loadBillSyncOptions } from "../_shared/tally/context.ts";
import { TallyValidationError, TallyReviewRequired, isVoucherJob, isLedgerMaster } from "../_shared/tally/types.ts";
import type { JobPayload, JobType } from "../_shared/tally/types.ts";

function jobTypeFor(payload: JobPayload): JobType {
  if (isVoucherJob(payload)) return "voucher";
  return isLedgerMaster(payload) ? "master_ledger" : "master_stockitem";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const caller = await authenticateCaller(req);

    const { billId, agentId, companyId: claimedCompanyId } = await req.json();
    if (!billId) throw new Error("billId is required");

    const supabase = serviceClient();

    // The bill is loaded before anything else because it, not the request body,
    // decides which company this call is operating on. maybeSingle rather than
    // single so a missing bill reads as "not found" instead of a raw
    // Postgrest error surfacing as a 500.
    const { data: bill, error: billError } = await supabase
      .from("bills")
      .select("*, expense_categories(name)")
      .eq("id", billId)
      .maybeSingle();

    if (billError) throw billError;
    if (!bill) throw new Error("Bill not found");

    // Authorization gate. The company comes from the bill; the companyId in the
    // body is only cross-checked against it. Trusting the body alone would let
    // someone pair another company's billId with their own companyId and pass.
    const companyId = resolveResourceCompany(bill.company_id, claimedCompanyId, `bill ${billId}`);
    await requireCompanyMembership(supabase, caller, companyId);

    if (bill.is_duplicate) throw new Error("Duplicate bills cannot be sent to Tally");

    // Pick the target agent, always within this company. An agent belonging to
    // another company would deliver this voucher into that company's Tally —
    // a cross-tenant write that no amount of row filtering downstream undoes.
    let targetAgentId = agentId as string | undefined;
    if (targetAgentId) {
      const { data: namedAgent, error: namedAgentError } = await supabase
        .from("tally_agents")
        .select("id")
        .eq("id", targetAgentId)
        .eq("company_id", companyId)
        .is("revoked_at", null)
        .maybeSingle();
      if (namedAgentError) throw namedAgentError;
      // Same message whether the agent is missing, revoked, or another
      // company's — naming which would confirm that someone else's agent id
      // exists.
      if (!namedAgent) throw new CompanyAccessError(COMPANY_ACCESS_DENIED);
    } else {
      const { data: agents, error: agentError } = await supabase
        .from("tally_agents")
        .select("id")
        .eq("company_id", companyId)
        .is("revoked_at", null)
        .order("created_at", { ascending: true })
        .limit(2);
      if (agentError) throw agentError;
      if (!agents?.length) {
        throw new Error("No Tally agent is registered for this company. Install the desktop agent and register it first.");
      }
      if (agents.length > 1) {
        throw new Error("Multiple Tally agents are registered for this company — pass agentId to choose one.");
      }
      targetAgentId = agents[0].id;
    }

    const { data: lineItems, error: lineItemsError } = await supabase
      .from("expense_line_items")
      .select("item_description, quantity, unit_price, tax_rate, amount, hsn_code")
      .eq("bill_id", billId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (lineItemsError) throw lineItemsError;

    const syncOptions = await loadBillSyncOptions(supabase, targetAgentId!);
    const { masters, voucher } = buildBillSyncJobs(bill, lineItems ?? [], syncOptions);

    const rows = [...masters, voucher].map((payload) => ({
      agent_id: targetAgentId,
      // Explicit, not left to the fill_company_id trigger. This runs on the
      // service-role client, where auth.uid() is NULL, so the trigger cannot
      // resolve a membership at all — it only succeeds today by falling back to
      // "there is exactly one company", and raises the moment a second exists.
      company_id: companyId,
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
      .eq("id", bill.id)
      .eq("company_id", companyId);

    return json({
      agent_id: targetAgentId,
      queued: queued?.length ?? 0,
      masters: masters.length,
      voucher_guid: voucher.guid,
      jobs: queued,
    });
  } catch (error) {
    const message = errorMessage(error);
    console.error("tally-enqueue failed:", message, error);

    // A validation failure is the user's data problem, not a server fault, and
    // an auth failure must not read as one either — clients retry 5xx.
    if (error instanceof TallyReviewRequired) {
      return new Response(
        JSON.stringify({
          error: message,
          needs_review: true,
          item_type: error.itemType,
          raw_name: error.rawName,
          candidates: error.candidates,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const status = error instanceof CompanyAccessError
      ? 403
      : error instanceof TallyValidationError
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
