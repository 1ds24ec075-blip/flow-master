/**
 * Agent onboarding: mint, list and revoke per-installation tokens.
 *
 * Requires a signed-in user (verify_jwt). The plaintext token is returned
 * exactly once, at creation — only its sha256 is stored, so a lost token has to
 * be replaced rather than recovered.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { json, preflight, sha256Hex } from "../_shared/http.ts";
import { serviceClient } from "../_shared/agent-auth.ts";

function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `rcz_agent_${body}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const supabase = serviceClient();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action ?? (req.method === "GET" ? "list" : "create");

    if (action === "list") {
      const { data, error } = await supabase
        .from("tally_agents")
        .select("id, name, company_name, tally_url, agent_version, last_seen_at, last_error, tally_running, company_loaded, revoked_at, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ agents: data ?? [] });
    }

    if (action === "create") {
      const name = String(body.name ?? "").trim();
      const companyName = String(body.companyName ?? "").trim();
      if (!name) throw new Error("name is required");
      if (!companyName) {
        throw new Error("companyName is required and must match the Tally company name exactly (case-sensitive)");
      }

      const token = mintToken();
      const { data, error } = await supabase
        .from("tally_agents")
        .insert({
          name,
          company_name: companyName,
          tally_url: String(body.tallyUrl ?? "http://localhost:9000"),
          token_hash: await sha256Hex(token),
        })
        .select("id, name, company_name, tally_url, created_at")
        .single();
      if (error) throw error;

      return json({
        agent: data,
        // Shown once. Store it in the agent's config and never anywhere else.
        token,
        warning: "Copy this token now — it cannot be retrieved again.",
      }, 201);
    }

    if (action === "revoke") {
      const agentId = String(body.agentId ?? "").trim();
      if (!agentId) throw new Error("agentId is required");
      const { error } = await supabase
        .from("tally_agents")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", agentId);
      if (error) throw error;
      return json({ revoked: agentId });
    }

    throw new Error(`Unknown action "${action}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("tally-agents failed:", message);
    return json({ error: message }, 400);
  }
});
