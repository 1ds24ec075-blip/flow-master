import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_system_summary",
  title: "System summary",
  description: "Get counts across the main business entities (clients, suppliers, invoices, POs, bills, bank statements, inventory).",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const tables = [
      "clients","suppliers","client_invoices","raw_material_invoices",
      "purchase_orders","po_intake_documents","approvals","quotations",
      "bank_statements","inventory_items","bills",
    ];
    const counts: Record<string, number> = {};
    await Promise.all(tables.map(async (t) => {
      const { count } = await sb.from(t).select("*", { count: "exact", head: true });
      counts[t] = count || 0;
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify({ counts }, null, 2) }] };
  },
});
