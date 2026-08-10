/**
 * Records a human's answer to one ambiguous master match, then lets the bill
 * that asked the question proceed.
 *
 * This is the ONLY writer of item_match_resolutions, and it is only reachable
 * from the review flow — which is what keeps the table down to judgment calls.
 * Confident auto-matches are recomputed on every enqueue and never persisted.
 *
 * The name is normalized here, server-side, with the same functions the
 * matcher uses. Accepting a pre-normalized string from the client would let a
 * drifting client write keys the matcher can never hit.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/agent-auth.ts";
import { normalizeStockItemName, normalizeVendorName } from "../_shared/tally/matching.ts";

class ValidationError extends Error {}

interface ResolveRequest {
  businessId?: string;
  /** The name exactly as it appeared on the bill; normalized here. */
  rawName?: string;
  itemType?: "vendor" | "stock_item";
  resolution?: "matched" | "distinct";
  matchedToGuid?: string | null;
  sourceBillId?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    // A resolution is a human judgment, so it needs a human: no service-role
    // bypass here — resolved_by has to be a real user.
    const user = await requireUser(req);

    const body = (await req.json()) as ResolveRequest;
    const { businessId, rawName, itemType, resolution, sourceBillId } = body;

    if (!businessId) throw new ValidationError("businessId is required");
    if (!rawName?.trim()) throw new ValidationError("rawName is required");
    if (itemType !== "vendor" && itemType !== "stock_item") {
      throw new ValidationError('itemType must be "vendor" or "stock_item"');
    }
    if (resolution !== "matched" && resolution !== "distinct") {
      throw new ValidationError('resolution must be "matched" or "distinct"');
    }

    const matchedToGuid = resolution === "matched" ? body.matchedToGuid?.trim() || null : null;
    if (resolution === "matched" && !matchedToGuid) {
      throw new ValidationError('resolution "matched" requires matchedToGuid');
    }

    const normalized = itemType === "vendor" ? normalizeVendorName(rawName) : normalizeStockItemName(rawName);
    if (!normalized) throw new ValidationError("rawName normalizes to nothing — cannot key a resolution on it");

    const supabase = serviceClient();

    // A 'matched' answer has to point at a master this business's agent has
    // actually delivered — otherwise a typo'd GUID becomes a permanent answer
    // that silently matches nothing.
    if (matchedToGuid) {
      const { data: master, error: masterError } = await supabase
        .from("tally_sync_queue")
        .select("tally_guid, tally_agents!inner(company_id)")
        .eq("tally_guid", matchedToGuid)
        .eq("status", "success")
        .in("job_type", ["master_ledger", "master_stockitem"])
        .eq("tally_agents.company_id", businessId)
        .limit(1)
        .maybeSingle();
      if (masterError) throw masterError;
      if (!master) {
        throw new ValidationError(
          "matchedToGuid does not correspond to a delivered master for this business",
        );
      }
    }

    // Upsert: a person is allowed to change their mind, and the newest answer
    // wins — resolved_at/resolved_by record who said so last.
    const { data: saved, error: saveError } = await supabase
      .from("item_match_resolutions")
      .upsert(
        {
          business_id: businessId,
          raw_name_normalized: normalized,
          item_type: itemType,
          resolution,
          matched_to_guid: matchedToGuid,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
          source_bill_id: sourceBillId ?? null,
        },
        { onConflict: "business_id,raw_name_normalized,item_type" },
      )
      .select()
      .single();
    if (saveError) throw saveError;

    // Let the bill that triggered the question try again with the answer in
    // place. Its outcome is passed through untouched: it may queue cleanly, or
    // park again on the NEXT ambiguity, and the client needs to see which.
    let enqueue: { status: number; body: unknown } | null = null;
    if (sourceBillId) {
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tally-enqueue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ billId: sourceBillId }),
      });
      enqueue = { status: response.status, body: await response.json().catch(() => ({})) };
    }

    return json({ resolution: saved, enqueue });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("resolve-item-match failed:", message);
    const status = error instanceof ValidationError
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
