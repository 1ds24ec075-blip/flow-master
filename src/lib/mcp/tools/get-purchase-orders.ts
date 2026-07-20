import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_purchase_orders",
  title: "Get purchase orders",
  description: "List purchase orders from the PO intake pipeline.",
  inputSchema: {
    status: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ status, limit = 20 }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    let q = sb.from("po_orders").select("*").order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q.limit(limit);
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ orders: data || [] }, null, 2) }] };
  },
});
