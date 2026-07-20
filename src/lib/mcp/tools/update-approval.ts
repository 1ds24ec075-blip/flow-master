import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "update_approval_status",
  title: "Approve or reject",
  description: "Approve or reject a pending approval request.",
  inputSchema: {
    approval_id: z.string(),
    action: z.enum(["approved", "rejected"]),
    comment: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ approval_id, action, comment }, ctx) => {
    if (!requireAuth(ctx)) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("approvals")
      .update({
        status: action,
        comment: comment || `${action} via MCP`,
        approved_by: ctx.getUserEmail() || ctx.getUserId() || "mcp",
        updated_at: new Date().toISOString(),
      })
      .eq("id", approval_id)
      .select()
      .single();
    if (error) return { content: [{ type: "text" as const, text: error.message }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, approval: data }, null, 2) }] };
  },
});
