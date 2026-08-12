export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Agent-Token",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Best-effort human message for anything thrown. Supabase/Postgrest errors are
 * plain objects, not Error instances, so `instanceof Error` alone collapses
 * them into a useless "Unknown error".
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      // fall through
    }
  }
  return "Unknown error";
}
