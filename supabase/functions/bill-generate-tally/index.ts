/**
 * Generates (and stores) a bill's Tally payload without sending anything.
 *
 * This used to hold its own 600-line copy of the XML templates and push
 * directly to Tally over HTTP. Both jobs moved out: job shape lives in
 * _shared/tally/jobs.ts, rendering in _shared/tally/serializer.ts, and delivery
 * belongs to the desktop agent via tally-enqueue. What's left is the preview.
 *
 * Pass `enqueue: true` to also drop it on the sync queue.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders, json, preflight, errorMessage } from "../_shared/http.ts";
import { serviceClient } from "../_shared/agent-auth.ts";
import { buildBillSyncJobs } from "../_shared/tally/jobs.ts";
import { serializeVoucherToXML } from "../_shared/tally/serializer.ts";
import { loadBillSyncOptions } from "../_shared/tally/context.ts";
import { TallyValidationError, TallyReviewRequired } from "../_shared/tally/types.ts";

import { requireUserOrService } from "../_shared/agent-auth.ts";
serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  // Security gate: reject anything that is not a signed-in user or an
  // internal service-role call. verify_jwt alone is satisfied by the public
  // anon key, so the token must resolve to a real user.
  try {
    await requireUserOrService(req);
  } catch {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  try {
    const { billId, enqueue = false } = await req.json();
    if (!billId) throw new Error("billId is required");

    const supabase = serviceClient();

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
      .select("item_description, quantity, unit_price, tax_rate, amount, hsn_code")
      .eq("bill_id", billId)
      .order("created_at", { ascending: true });

    if (lineItemsError) throw lineItemsError;

    // Rendered here only so the UI can preview/download it. The agent renders
    // its own copy at send time from the queued JSON.
    const { data: agent } = await supabase
      .from("tally_agents")
      .select("id, company_name")
      .is("revoked_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!agent?.id) {
      throw new TallyValidationError(
        "No Tally agent is registered. Install and register the desktop agent before generating Tally data.",
      );
    }

    const syncOptions = await loadBillSyncOptions(supabase, agent.id);
    const { masters, voucher } = buildBillSyncJobs(bill, lineItems ?? [], syncOptions);

    const companyName = agent?.company_name ?? "";
    const tallyXml = companyName ? serializeVoucherToXML(voucher, companyName) : null;

    const { data: updatedBill, error: updateError } = await supabase
      .from("bills")
      .update({
        tally_json: voucher,
        tally_xml: tallyXml,
        tally_status: "ready",
        tally_error: null,
      })
      .eq("id", billId)
      .select()
      .single();

    if (updateError) throw updateError;

    let queued = 0;
    if (enqueue) {
      const enqueueResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tally-enqueue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ billId }),
      });
      const enqueueResult = await enqueueResponse.json().catch(() => ({}));
      if (!enqueueResponse.ok) throw new Error(enqueueResult?.error ?? "Could not queue the bill");
      queued = enqueueResult.queued ?? 0;
    }

    return json({
      bill: updatedBill,
      tally_json: voucher,
      tally_xml: tallyXml,
      masters: masters.length,
      queued,
      tally_status: enqueue ? "queued" : "ready",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("bill-generate-tally failed:", message);
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

    return new Response(JSON.stringify({ error: message }), {
      status: error instanceof TallyValidationError ? 422 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
