/**
 * Assembles the "what does Tally already know" context a bill needs before its
 * jobs can be built: the company's own state code (CGST/SGST vs IGST), the
 * masters this agent has actually delivered, and the human answers already
 * recorded for ambiguous names.
 */
import { knownMastersFromDelivered, type MatchResolution } from "./matching.ts";
import type { BillSyncOptions } from "./jobs.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export async function loadBillSyncOptions(
  supabase: Client,
  agentId: string,
): Promise<BillSyncOptions> {
  const { data: agent, error: agentError } = await supabase
    .from("tally_agents")
    .select("id, company_id, companies(state_code, gstin)")
    .eq("id", agentId)
    .maybeSingle();
  if (agentError) throw agentError;

  const company = agent?.companies as { state_code?: string | null; gstin?: string | null } | null;
  const companyStateCode = (company?.state_code ?? company?.gstin?.slice(0, 2) ?? "").trim();

  const { data: delivered, error: deliveredError } = await supabase
    .from("tally_sync_queue")
    .select("job_type, payload_json")
    .eq("agent_id", agentId)
    .eq("status", "success")
    .in("job_type", ["master_ledger", "master_stockitem"]);
  if (deliveredError) throw deliveredError;

  const { vendors, stockItems } = knownMastersFromDelivered(delivered ?? []);

  let matchResolutions: MatchResolution[] = [];
  if (agent?.company_id) {
    const { data: resolutions, error: resolutionError } = await supabase
      .from("item_match_resolutions")
      .select("raw_name_normalized, item_type, resolution, matched_to_guid")
      .eq("business_id", agent.company_id);
    if (resolutionError) throw resolutionError;
    matchResolutions = (resolutions ?? []).map((row: Record<string, unknown>) => ({
      rawNameNormalized: row.raw_name_normalized as string,
      itemType: row.item_type as MatchResolution["itemType"],
      resolution: row.resolution as MatchResolution["resolution"],
      matchedToGuid: (row.matched_to_guid as string | null) ?? null,
    }));
  }

  return {
    companyStateCode,
    knownVendorLedgers: vendors,
    knownStockItems: stockItems,
    matchResolutions,
  };
}
