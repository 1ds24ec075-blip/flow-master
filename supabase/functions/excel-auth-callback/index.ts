import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Get frontend URL for redirect
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://pskuxhpfohmxlhmupeoz.lovableproject.com";

    if (error) {
      console.error("OAuth error:", error, errorDescription);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/excel-integration?error=${encodeURIComponent(errorDescription || error)}`,
        },
      });
    }

    if (!code) {
      console.error("No authorization code received");
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/excel-integration?error=No authorization code received`,
        },
      });
    }

    console.log("Received authorization code, exchanging for tokens...");

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID") || "common";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const redirectUri = `${supabaseUrl}/functions/v1/excel-auth-callback`;

    if (!clientId || !clientSecret || !supabaseUrl || !supabaseServiceKey) {
      console.error("Missing required environment variables");
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/excel-integration?error=Server configuration error`,
        },
      });
    }

    // Exchange code for tokens
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access",
    });

    console.log("Exchanging code for tokens at:", tokenUrl);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", tokenResponse.status, errorText);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/excel-integration?error=Failed to exchange authorization code`,
        },
      });
    }

    const tokens = await tokenResponse.json();
    console.log("Successfully obtained tokens");

    // Get user info from Microsoft Graph
    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!userResponse.ok) {
      console.error("Failed to get user info:", userResponse.status);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/excel-integration?error=Failed to get user information`,
        },
      });
    }

    const userInfo = await userResponse.json();
    console.log("Got user info for:", userInfo.mail || userInfo.userPrincipalName);

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Store the integration in database
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const integrationData = {
      email_address: userInfo.mail || userInfo.userPrincipalName,
      display_name: userInfo.displayName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
      is_active: true,
      sync_status: "connected",
      last_sync_at: null,
      error_message: null,
    };

    // Upsert integration (update if email exists, insert if not)
    const { data, error: dbError } = await supabase
      .from("excel_integrations")
      .upsert(integrationData, { onConflict: "email_address" })
      .select()
      .single();

    if (dbError) {
      console.error("Failed to save integration:", dbError);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${frontendUrl}/excel-integration?error=Failed to save integration`,
        },
      });
    }

    console.log("Integration saved successfully for:", userInfo.mail || userInfo.userPrincipalName);

    // Redirect back to frontend with success
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${frontendUrl}/excel-integration?success=true`,
      },
    });
  } catch (error: unknown) {
    console.error("Error in OAuth callback:", error);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://pskuxhpfohmxlhmupeoz.lovableproject.com";
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${frontendUrl}/excel-integration?error=${encodeURIComponent(errorMessage)}`,
      },
    });
  }
});
