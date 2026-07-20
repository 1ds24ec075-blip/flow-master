import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_inventory_status",
  title: "Inventory status",
  description: "List inventory items, optionally filtered to low-stock items only.",
  inputSchema: {
    low_stock_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ low_stock_only = false, limit = 50 }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("inventory_items")
      .select("*")
      .eq("is_active", true)
      .order("current_quantity")
      .limit(limit);
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    const items = data || [];
    const low = items.filter((i: any) => i.current_quantity <= i.minimum_threshold);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ items: low_stock_only ? low : items, low_stock_count: low.length }, null, 2),
      }],
    };
  },
});
