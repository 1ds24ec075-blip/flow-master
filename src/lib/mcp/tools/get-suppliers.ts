import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_suppliers",
  title: "Get suppliers",
  description: "List or search suppliers. Optionally fetch a single supplier by ID.",
  inputSchema: {
    supplier_id: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ supplier_id, search, limit = 20 }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    if (supplier_id) {
      const { data, error } = await sb.from("suppliers").select("*").eq("id", supplier_id).maybeSingle();
      if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify({ supplier: data }, null, 2) }] };
    }
    let q = sb.from("suppliers").select("*").order("created_at", { ascending: false });
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q.limit(limit);
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ suppliers: data || [] }, null, 2) }] };
  },
});
