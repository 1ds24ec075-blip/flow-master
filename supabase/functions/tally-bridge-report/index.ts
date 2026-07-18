// Bridge agent reports job result: sent | failed, plus Tally response/error text.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const { data: bridge } = await admin
      .from("tally_bridges")
      .select("id, user_id")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .maybeSingle();

    if (!bridge) {
      return new Response(JSON.stringify({ error: "Invalid bridge key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { job_id, status, tally_response, error_message } = await req.json();
    if (!job_id || !status) {
      return new Response(JSON.stringify({ error: "job_id and status required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalized = status === "sent" ? "sent" : "failed";
    const patch: Record<string, unknown> = {
      status: normalized,
      tally_response: tally_response || null,
      last_error: normalized === "failed" ? (error_message || "Unknown Tally error") : null,
      completed_at: new Date().toISOString(),
    };

    const { data: job, error } = await admin
      .from("tally_push_jobs")
      .update(patch)
      .eq("id", job_id)
      .eq("bridge_id", bridge.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found for this bridge" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mirror status back to source records so app pages reflect Tally outcome.
    try {
      if (job.source_type === "bill" && job.source_id) {
        await admin
          .from("bills")
          .update({
            tally_status: normalized === "sent" ? "sent" : "failed",
            tally_uploaded_at: normalized === "sent" ? new Date().toISOString() : null,
            tally_error: normalized === "failed" ? (error_message || null) : null,
          })
          .eq("id", job.source_id);
      } else if (job.source_type === "po_intake" && job.source_id) {
        await admin
          .from("po_intake_documents")
          .update({
            status: normalized === "sent" ? "sent_to_tally" : "tally_failed",
          })
          .eq("id", job.source_id);
      }
    } catch (mirrorErr) {
      console.warn("Source mirror update failed", mirrorErr);
    }

    return new Response(JSON.stringify({ ok: true, job }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
