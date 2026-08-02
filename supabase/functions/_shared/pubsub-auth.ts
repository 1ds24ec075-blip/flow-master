import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

/**
 * Google Pub/Sub push subscriptions authenticate themselves with an OIDC token
 * signed by Google. Verifying it is what keeps this endpoint from being an open,
 * unauthenticated write path — `verify_jwt` can't be used here because Google
 * signs the token, not this project.
 */
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export class PubSubAuthError extends Error {}

export async function verifyPubSubOidcToken(req: Request): Promise<{ email?: string }> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new PubSubAuthError("Missing Pub/Sub OIDC token");

  // Optional hardening: bind the token to the exact push endpoint audience and
  // to the service account configured on the subscription.
  const expectedAudience = Deno.env.get("GMAIL_PUBSUB_AUDIENCE")?.trim();
  const expectedEmail = Deno.env.get("GMAIL_PUBSUB_SERVICE_ACCOUNT")?.trim();

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      ...(expectedAudience ? { audience: expectedAudience } : {}),
      clockTolerance: 60,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    throw new PubSubAuthError(
      `Invalid Pub/Sub OIDC token: ${error instanceof Error ? error.message : "verification failed"}`,
    );
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;
  if (payload.email_verified === false) {
    throw new PubSubAuthError("Pub/Sub OIDC token email is not verified");
  }
  if (expectedEmail && email?.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new PubSubAuthError("Pub/Sub OIDC token was issued to an unexpected service account");
  }

  return { email };
}
