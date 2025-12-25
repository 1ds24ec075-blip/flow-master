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

    // Get the app URL to redirect back to
    // This should be the frontend URL
    const appUrl = Deno.env.get("APP_URL") || "https://id-preview--d9e42d37-c9e3-4eaa-8d50-e3da268f97b7.lovable.app";
    const redirectPage = `${appUrl}/gmail-integration`;

    console.log("Gmail OAuth callback received");
    console.log("Code present:", !!code);
    console.log("Error:", error);

    if (error) {
      console.error("OAuth error:", error, errorDescription);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirectPage}?error=${encodeURIComponent(errorDescription || error)}`,
        },
      });
    }

    if (!code) {
      console.error("No authorization code received");
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirectPage}?error=${encodeURIComponent("No authorization code received")}`,
        },
      });
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!clientId || !clientSecret) {
      console.error("Google OAuth credentials not configured");
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirectPage}?error=${encodeURIComponent("OAuth not configured")}`,
        },
      });
    }

    const redirectUri = `${supabaseUrl}/functions/v1/gmail-auth-callback`;

    // Exchange the authorization code for tokens
    console.log("Exchanging code for tokens...");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirectPage}?error=${encodeURIComponent("Failed to exchange code for tokens")}`,
        },
      });
    }

    const tokens = await tokenResponse.json();
    console.log("Tokens received successfully");
    console.log("Access token present:", !!tokens.access_token);
    console.log("Refresh token present:", !!tokens.refresh_token);

    // Get user info from Google
    console.log("Fetching user info...");
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      console.error("Failed to fetch user info:", errorText);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirectPage}?error=${encodeURIComponent("Failed to fetch user information")}`,
        },
      });
    }

    const userInfo = await userInfoResponse.json();
    console.log("User email:", userInfo.email);

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();

    // Save the integration to the database
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Check if this email is already connected
    const { data: existingIntegration } = await supabase
      .from("gmail_integrations")
      .select("id")
      .eq("email_address", userInfo.email)
      .single();

    if (existingIntegration) {
      // Update existing integration
      console.log("Updating existing integration for:", userInfo.email);
      const { error: updateError } = await supabase
        .from("gmail_integrations")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          is_active: true,
          sync_status: "active",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingIntegration.id);

      if (updateError) {
        console.error("Failed to update integration:", updateError);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${redirectPage}?error=${encodeURIComponent("Failed to update integration")}`,
          },
        });
      }
    } else {
      // Create new integration
      console.log("Creating new integration for:", userInfo.email);
      const { error: insertError } = await supabase
        .from("gmail_integrations")
        .insert({
          email_address: userInfo.email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          is_active: true,
          sync_status: "active",
          subject_filters: ["invoice", "bill", "receipt", "payment"],
        });

      if (insertError) {
        console.error("Failed to create integration:", insertError);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${redirectPage}?error=${encodeURIComponent("Failed to save integration")}`,
          },
        });
      }
    }

    console.log("Gmail integration saved successfully");

    // Redirect back to the app with success
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectPage}?success=true&email=${encodeURIComponent(userInfo.email)}`,
      },
    });
  } catch (error: unknown) {
    console.error("Error in Gmail OAuth callback:", error);
    const appUrl = Deno.env.get("APP_URL") || "https://id-preview--d9e42d37-c9e3-4eaa-8d50-e3da268f97b7.lovable.app";
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${appUrl}/gmail-integration?error=${encodeURIComponent(errorMessage)}`,
      },
    });
  }
});
