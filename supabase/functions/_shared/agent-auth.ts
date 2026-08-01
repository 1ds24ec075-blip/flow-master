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
 * Requires a genuinely signed-in user.
 *
 * `verify_jwt` is not enough on its own: it only proves the bearer token was
 * signed by this project, and the anon key satisfies that. Since the anon key
 * ships in the browser bundle, a verify_jwt-only endpoint is effectively public.
 * Resolving the token to a user is what actually distinguishes the two.
 */
export async function requireUser(req: Request): Promise<{ id: string; email?: string }> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Authentication required");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("Supabase credentials are not configured");

  const { data, error } = await createClient(url, anonKey).auth.getUser(token);
  // The anon key is a valid JWT with no user behind it, so it lands here.
  if (error || !data?.user) throw new Error("Authentication required");

  return { id: data.user.id, email: data.user.email ?? undefined };
}

/**
 * Accepts either a signed-in user or a server-to-server call carrying the
 * service-role key — bill-generate-tally enqueues on the user's behalf and has
 * no session to forward.
 */
export async function requireUserOrService(req: Request): Promise<void> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return;
  await requireUser(req);
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
