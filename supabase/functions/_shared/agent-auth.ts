import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "./http.ts";

export interface TallyAgentRow {
  id: string;
  name: string;
  company_name: string;
  tally_url: string;
  revoked_at: string | null;
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service credentials are not configured");
  return createClient(url, key);
}

/**
 * Authenticates a local agent by its per-installation token.
 *
 * Only the sha256 of the token is stored, so a database leak doesn't hand an
 * attacker working agent credentials.
 */
export async function authenticateAgent(
  req: Request,
  supabase: SupabaseClient,
): Promise<TallyAgentRow> {
  const token = req.headers.get("x-agent-token")?.trim();
  if (!token) throw new Error("Missing X-Agent-Token header");

  const { data, error } = await supabase
    .from("tally_agents")
    .select("id, name, company_name, tally_url, revoked_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Unknown agent token");
  if (data.revoked_at) throw new Error("This agent token has been revoked");

  return data as TallyAgentRow;
}
