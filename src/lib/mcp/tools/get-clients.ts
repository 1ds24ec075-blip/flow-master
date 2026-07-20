import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_clients",
  title: "Get clients",
  description: "List or search clients. Optionally fetch a single client by ID.",
  inputSchema: {
    client_id: z.string().optional().describe("Fetch a single client by UUID."),
    search: z.string().optional().describe("Case-insensitive name search."),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ client_id, search, limit = 20 }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    if (client_id) {
      const { data, error } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
      if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify({ client: data }, null, 2) }] };
    }
    let q = sb.from("clients").select("*").order("created_at", { ascending: false });
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q.limit(limit);
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ clients: data || [] }, null, 2) }] };
  },
});
