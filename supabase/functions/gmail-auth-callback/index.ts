import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifyState(token: string, secret: string): Promise<{ uid: string; exp: number } | null> {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(body));
    if (!ok) return null;

    const payload = JSON.parse(atob(body));
    if (!payload.uid || !payload.exp) return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const appUrl = Deno.env.get("APP_URL") || "https://id-preview--d9e42d37-c9e3-4eaa-8d50-e3da268f97b7.lovable.app";
  const redirectPage = `${appUrl}/gmail-integration`;

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (oauthError) {
      return Response.redirect(
        `${redirectPage}?error=${encodeURIComponent(errorDescription || oauthError)}`,
        302,
      );
    }
    if (!code || !stateParam) {
      return Response.redirect(
        `${redirectPage}?error=${encodeURIComponent("Missing code or state")}`,
        302,
      );
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stateSecret = Deno.env.get("OAUTH_STATE_SECRET");

    if (!clientId || !clientSecret || !supabaseUrl || !supabaseServiceKey || !stateSecret) {
      return Response.redirect(
        `${redirectPage}?error=${encodeURIComponent("OAuth not configured")}`,
        302,
      );
    }

    // Verify state and extract user_id
    const verified = await verifyState(stateParam, stateSecret);
    if (!verified) {
      return Response.redirect(
        `${redirectPage}?error=${encodeURIComponent("Invalid or expired state")}`,
        302,
      );
    }
    const userId = verified.uid;

    const redirectUri = `${supabaseUrl}/functions/v1/gmail-auth-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return Response.redirect(
        `${redirectPage}?error=${encodeURIComponent("Failed to exchange code for tokens")}`,
        302,
      );
    }

    const tokens = await tokenResponse.json();

    // Get user email from Google
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfoResponse.ok) {
      return Response.redirect(
        `${redirectPage}?error=${encodeURIComponent("Failed to fetch user info")}`,
        302,
      );
    }
    const userInfo = await userInfoResponse.json();

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Upsert by (user_id, email_address)
    const { data: existing } = await supabase
      .from("gmail_integrations")
      .select("id, refresh_token")
      .eq("user_id", userId)
      .eq("email_address", userInfo.email)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("gmail_integrations")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || existing.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          is_active: true,
          sync_status: "active",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Update failed:", updateError);
        return Response.redirect(
          `${redirectPage}?error=${encodeURIComponent("Failed to update integration")}`,
          302,
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from("gmail_integrations")
        .insert({
          user_id: userId,
          email_address: userInfo.email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          is_active: true,
          sync_status: "active",
          subject_filters: ["invoice", "bill", "receipt", "payment", "purchase order", "PO"],
        });

      if (insertError) {
        console.error("Insert failed:", insertError);
        return Response.redirect(
          `${redirectPage}?error=${encodeURIComponent("Failed to save integration")}`,
          302,
        );
      }
    }

    // Audit log
    await supabase.from("agent_activity_feed").insert({
      agent_name: "gmail-oauth",
      action: "connect",
      summary: `Connected Gmail: ${userInfo.email}`,
      severity: "info",
      status: "completed",
      entity_type: "gmail_integration",
      metadata: { user_id: userId, email: userInfo.email },
    });

    return Response.redirect(
      `${redirectPage}?success=true&email=${encodeURIComponent(userInfo.email)}`,
      302,
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("gmail-auth-callback error:", errorMessage);
    return Response.redirect(
      `${redirectPage}?error=${encodeURIComponent(errorMessage)}`,
      302,
    );
  }
});
