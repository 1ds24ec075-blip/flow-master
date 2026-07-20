import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "create_reorder_request",
  title: "Create reorder request",
  description: "Create a reorder request for a low-stock inventory item.",
  inputSchema: {
    inventory_item_id: z.string(),
    quantity: z.number().positive(),
    supplier_id: z.string().optional(),
    note: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: async ({ inventory_item_id, quantity, supplier_id, note }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const { data: item } = await sb.from("inventory_items").select("*").eq("id", inventory_item_id).maybeSingle();
    if (!item) return { content: [{ type: "text" as const, text: "Item not found" }], isError: true };
    const { data, error } = await sb
      .from("reorder_requests")
      .insert({
        inventory_item_id,
        quantity_requested: quantity,
        supplier_id: supplier_id || item.preferred_supplier_id,
        quantity_at_trigger: item.current_quantity,
        minimum_threshold_at_trigger: item.minimum_threshold,
        internal_note: note || "Reorder via MCP",
        status: "sent",
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, reorder: data }, null, 2) }] };
  },
});
