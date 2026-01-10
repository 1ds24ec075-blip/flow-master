import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID") || "common";
    
    if (!clientId) {
      console.error("MICROSOFT_CLIENT_ID not configured");
      return new Response(
        JSON.stringify({ error: "Microsoft OAuth not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the redirect URI for the callback function
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const redirectUri = `${supabaseUrl}/functions/v1/excel-auth-callback`;
    
    console.log("Starting Microsoft Excel OAuth flow");
    console.log("Redirect URI:", redirectUri);
    console.log("Tenant ID:", tenantId);

    // Define required scopes for Excel/OneDrive access
    const scopes = [
      "https://graph.microsoft.com/Files.ReadWrite",
      "https://graph.microsoft.com/User.Read",
      "offline_access",
    ].join(" ");

    // Generate a random state for CSRF protection
    const state = crypto.randomUUID();

    // Build the Microsoft OAuth URL
    const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);

    console.log("Redirecting to Microsoft OAuth:", authUrl.toString());

    // Redirect user to Microsoft OAuth consent screen
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        "Location": authUrl.toString(),
      },
    });
  } catch (error: unknown) {
    console.error("Error starting Microsoft OAuth:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
