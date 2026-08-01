import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_invoices",
  title: "Get invoices",
  description: "Fetch client or raw-material invoices with optional status filter.",
  inputSchema: {
    invoice_type: z.enum(["client", "raw_material"]),
    status: z.enum(["pending", "awaiting_approval", "approved", "rejected", "all"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ invoice_type, status = "all", limit = 20 }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const table = invoice_type === "client" ? "client_invoices" : "raw_material_invoices";
    let q = sb.from(table).select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q.limit(limit);
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ invoices: data || [] }, null, 2) }] };
  },
});
