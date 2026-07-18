// Bridge agent polls this endpoint to claim the next pending job.
// Auth: header `x-bridge-key: <api_key>` (no user JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-bridge-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = req.headers.get("x-bridge-key");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing x-bridge-key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Look up bridge by api_key
    const { data: bridge } = await admin
      .from("tally_bridges")
      .select("*")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .maybeSingle();

    if (!bridge) {
      return new Response(JSON.stringify({ error: "Invalid or inactive bridge key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Heartbeat
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    await admin
      .from("tally_bridges")
      .update({ last_seen_at: new Date().toISOString(), last_ip: ip })
      .eq("id", bridge.id);

    // Claim one pending job (find + update atomically-ish)
    const { data: candidate } = await admin
      .from("tally_push_jobs")
      .select("id")
      .eq("bridge_id", bridge.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!candidate) {
      return new Response(JSON.stringify({ job: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: claimed, error: claimErr } = await admin
      .from("tally_push_jobs")
      .update({
        status: "processing",
        picked_at: new Date().toISOString(),
        attempts: (candidate as any).attempts != null ? (candidate as any).attempts + 1 : 1,
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (claimErr) throw claimErr;
    if (!claimed) {
      return new Response(JSON.stringify({ job: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        job: {
          id: claimed.id,
          source_type: claimed.source_type,
          source_id: claimed.source_id,
          label: claimed.label,
          payload_xml: claimed.payload_xml,
        },
        bridge: { id: bridge.id, name: bridge.name, tally_url: bridge.tally_url },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
