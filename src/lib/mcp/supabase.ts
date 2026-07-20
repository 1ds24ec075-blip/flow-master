import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

// The MCP entry is bundled into a Deno Edge Function at build time; `process.env`
// is available at runtime there. Declare it here so Vite's typecheck passes.
declare const process: { env: Record<string, string | undefined> };

export function supabaseForUser(ctx: ToolContext): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function requireAuth(ctx: ToolContext) {
  return ctx.isAuthenticated();
}

export function unauthenticated() {
  return {
    content: [{ type: "text" as const, text: "Not authenticated. Please sign in via the MCP OAuth flow." }],
    isError: true,
  };
}
