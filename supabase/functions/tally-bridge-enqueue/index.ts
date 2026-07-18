// Enqueue a Tally push job from the app to the user's local bridge queue.
// Called by the authenticated user via the frontend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const {
      source_type,
      source_id,
      label,
      payload_xml,
      bridge_id,
    }: {
      source_type?: string;
      source_id?: string;
      label?: string;
      payload_xml?: string;
      bridge_id?: string;
    } = body || {};

    if (!source_type || !payload_xml) {
      return new Response(JSON.stringify({ error: "source_type and payload_xml required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Pick bridge: explicit id, or first active bridge for this user
    let targetBridgeId = bridge_id || null;
    if (!targetBridgeId) {
      const { data: b } = await admin
        .from("tally_bridges")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetBridgeId = b?.id || null;
    }

    if (!targetBridgeId) {
      return new Response(
        JSON.stringify({ error: "No active Tally bridge registered. Register one in Tally Bridge settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: job, error } = await admin
      .from("tally_push_jobs")
      .insert({
        user_id: userId,
        bridge_id: targetBridgeId,
        source_type,
        source_id: source_id || null,
        label: label || null,
        payload_xml,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ job }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
