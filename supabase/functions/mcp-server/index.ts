import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "npm:@supabase/supabase-js@2.86.0";
import { z } from "npm:zod@3.25.76";
import zodToJsonSchema from "zod-to-json-schema";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function getDateRange(timeRange: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let s: Date;
  switch (timeRange) {
    case "last_hour": s = new Date(now.getTime() - 3600000); break;
    case "today": s = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "this_week": s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); break;
    case "this_month": s = new Date(now.getFullYear(), now.getMonth(), 1); break;
    default: s = new Date(0);
  }
  return { start: s.toISOString(), end };
}

const mcp = new McpServer({
  name: "talligence-mcp",
  version: "1.0.0",
  schemaAdapter: (schema) => zodToJsonSchema(schema as z.ZodType),
});

mcp.tool("get_system_summary", {
  description: "Get a complete overview of all entities and today's activity.",
  inputSchema: z.object({ include_today: z.boolean().optional() }),
  handler: async ({ include_today }) => {
    const sb = getSupabase();
    const tables = ["clients","suppliers","client_invoices","raw_material_invoices","purchase_orders","po_intake_documents","approvals","quotations","bank_statements","inventory_items"];
    const counts: Record<string,number> = {};
    await Promise.all(tables.map(async t => { const { count } = await sb.from(t).select("*",{count:"exact",head:true}); counts[t]=count||0; }));
    let today = null;
    if (include_today !== false) {
      const ts = new Date(new Date().setHours(0,0,0,0)).toISOString();
      const tt = ["clients","client_invoices","raw_material_invoices","po_intake_documents","activity_log"];
      const tc: Record<string,number> = {};
      await Promise.all(tt.map(async t => { const { count } = await sb.from(t).select("*",{count:"exact",head:true}).gte("created_at",ts); tc[t]=count||0; }));
      today = tc;
    }
    return { content: [{ type: "text" as const, text: JSON.stringify({ counts, today }, null, 2) }] };
  },
});

mcp.tool("get_invoice_stats", {
  description: "Get invoice statistics with filters for type, time, and status.",
  inputSchema: z.object({
    invoice_type: z.enum(["client","raw_material","all"]),
    time_range: z.enum(["last_hour","today","this_week","this_month","all_time"]).optional(),
    status_filter: z.enum(["pending","awaiting_approval","approved","rejected","all"]).optional(),
    limit: z.number().optional(),
  }),
  handler: async ({ invoice_type, time_range="all_time", status_filter="all", limit=5 }) => {
    const sb = getSupabase(); const { start } = getDateRange(time_range); const result: any = {};
    if (invoice_type==="client"||invoice_type==="all") {
      let q = sb.from("client_invoices").select("*, clients(name)").order("created_at",{ascending:false});
      if (time_range!=="all_time") q=q.gte("created_at",start); if (status_filter!=="all") q=q.eq("status",status_filter);
      const { data } = await q.limit(limit);
      const { count:total } = await sb.from("client_invoices").select("*",{count:"exact",head:true});
      const { count:pending } = await sb.from("client_invoices").select("*",{count:"exact",head:true}).eq("status","pending");
      result.client_invoices = { total:total||0, pending:pending||0, recent:data||[] };
    }
    if (invoice_type==="raw_material"||invoice_type==="all") {
      let q = sb.from("raw_material_invoices").select("*, suppliers(name)").order("created_at",{ascending:false});
      if (time_range!=="all_time") q=q.gte("created_at",start); if (status_filter!=="all") q=q.eq("status",status_filter);
      const { data } = await q.limit(limit);
      const { count:total } = await sb.from("raw_material_invoices").select("*",{count:"exact",head:true});
      const { count:pending } = await sb.from("raw_material_invoices").select("*",{count:"exact",head:true}).eq("status","pending");
      result.raw_material_invoices = { total:total||0, pending:pending||0, recent:data||[] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});

mcp.tool("get_clients", {
  description: "Get client information. List, search, or get by ID.",
  inputSchema: z.object({ client_id: z.string().optional(), search: z.string().optional(), limit: z.number().optional() }),
  handler: async ({ client_id, search, limit=10 }) => {
    const sb = getSupabase();
    if (client_id) { const { data } = await sb.from("clients").select("*").eq("id",client_id).maybeSingle(); return { content:[{type:"text" as const,text:JSON.stringify({client:data})}] }; }
    let q = sb.from("clients").select("*").order("created_at",{ascending:false});
    if (search) q=q.ilike("name",`%${search}%`);
    const { data } = await q.limit(limit); const { count } = await sb.from("clients").select("*",{count:"exact",head:true});
    return { content: [{ type:"text" as const, text:JSON.stringify({clients:data||[],total:count||0}) }] };
  },
});

mcp.tool("get_suppliers", {
  description: "Get supplier/vendor records.",
  inputSchema: z.object({ supplier_id: z.string().optional(), search: z.string().optional(), limit: z.number().optional() }),
  handler: async ({ supplier_id, search, limit=10 }) => {
    const sb = getSupabase();
    if (supplier_id) { const { data } = await sb.from("suppliers").select("*").eq("id",supplier_id).maybeSingle(); return { content:[{type:"text" as const,text:JSON.stringify({supplier:data})}] }; }
    let q = sb.from("suppliers").select("*").order("created_at",{ascending:false});
    if (search) q=q.ilike("name",`%${search}%`);
    const { data } = await q.limit(limit); const { count } = await sb.from("suppliers").select("*",{count:"exact",head:true});
    return { content: [{ type:"text" as const, text:JSON.stringify({suppliers:data||[],total:count||0}) }] };
  },
});

mcp.tool("get_purchase_orders", {
  description: "Get purchase order stats from PO intake pipeline.",
  inputSchema: z.object({ status: z.enum(["pending","processed","converted","all"]).optional(), time_range: z.enum(["today","this_week","this_month","all_time"]).optional(), limit: z.number().optional() }),
  handler: async ({ status="all", time_range="all_time", limit=10 }) => {
    const sb = getSupabase(); const { start } = getDateRange(time_range);
    let q = sb.from("po_orders").select("*").order("created_at",{ascending:false});
    if (status!=="all") q=q.eq("status",status); if (time_range!=="all_time") q=q.gte("created_at",start);
    const { data } = await q.limit(limit); const { count } = await sb.from("po_orders").select("*",{count:"exact",head:true});
    return { content: [{ type:"text" as const, text:JSON.stringify({orders:data||[],total:count||0}) }] };
  },
});

mcp.tool("get_inventory_status", {
  description: "Get inventory levels, low stock alerts, reorder history.",
  inputSchema: z.object({ low_stock_only: z.boolean().optional(), limit: z.number().optional() }),
  handler: async ({ low_stock_only=false, limit=20 }) => {
    const sb = getSupabase();
    const { data:items } = await sb.from("inventory_items").select("*, suppliers:preferred_supplier_id(name)").eq("is_active",true).order("current_quantity").limit(limit);
    const low = (items||[]).filter((i:any)=>i.current_quantity<=i.minimum_threshold);
    const { data:reorders } = await sb.from("reorder_requests").select("*, inventory_items(item_name)").order("created_at",{ascending:false}).limit(5);
    return { content:[{type:"text" as const,text:JSON.stringify({items:low_stock_only?low:items||[],low_stock_count:low.length,recent_reorders:reorders||[]})}] };
  },
});

mcp.tool("get_approvals", {
  description: "Get approval requests and statuses.",
  inputSchema: z.object({ status: z.enum(["pending","approved","rejected","all"]).optional(), limit: z.number().optional() }),
  handler: async ({ status="all", limit=10 }) => {
    const sb = getSupabase();
    let q = sb.from("approvals").select("*").order("created_at",{ascending:false});
    if (status!=="all") q=q.eq("status",status);
    const { data } = await q.limit(limit);
    return { content:[{type:"text" as const,text:JSON.stringify({approvals:data||[]})}] };
  },
});

mcp.tool("get_liquidity_overview", {
  description: "Get weekly liquidity/cash flow data.",
  inputSchema: z.object({ weeks: z.number().optional() }),
  handler: async ({ weeks=4 }) => {
    const sb = getSupabase();
    const { data } = await sb.from("weekly_liquidity").select("*, liquidity_line_items(*)").order("week_start_date",{ascending:false}).limit(weeks);
    return { content:[{type:"text" as const,text:JSON.stringify({weeks:data||[]})}] };
  },
});

mcp.tool("get_products", {
  description: "Get product master data with HSN codes and GST rates.",
  inputSchema: z.object({ search: z.string().optional(), limit: z.number().optional() }),
  handler: async ({ search, limit=20 }) => {
    const sb = getSupabase();
    let q = sb.from("product_master").select("*").eq("is_active",true).order("name");
    if (search) q=q.ilike("name",`%${search}%`);
    const { data } = await q.limit(limit);
    return { content:[{type:"text" as const,text:JSON.stringify({products:data||[]})}] };
  },
});

mcp.tool("get_recent_activity", {
  description: "Get system activity log for audit trail.",
  inputSchema: z.object({ activity_type: z.string().optional(), time_range: z.enum(["last_hour","today","this_week","all_time"]).optional(), limit: z.number().optional() }),
  handler: async ({ activity_type, time_range="today", limit=20 }) => {
    const sb = getSupabase(); const { start } = getDateRange(time_range);
    let q = sb.from("activity_log").select("*").order("created_at",{ascending:false});
    if (time_range!=="all_time") q=q.gte("created_at",start); if (activity_type) q=q.eq("activity_type",activity_type);
    const { data } = await q.limit(limit);
    return { content:[{type:"text" as const,text:JSON.stringify({activities:data||[]})}] };
  },
});

mcp.tool("create_reorder_request", {
  description: "Create a reorder request for low-stock inventory.",
  inputSchema: z.object({ inventory_item_id: z.string(), quantity: z.number(), supplier_id: z.string().optional(), note: z.string().optional() }),
  handler: async ({ inventory_item_id, quantity, supplier_id, note }) => {
    const sb = getSupabase();
    const { data:item } = await sb.from("inventory_items").select("*").eq("id",inventory_item_id).maybeSingle();
    if (!item) return { content:[{type:"text" as const,text:JSON.stringify({error:"Item not found"})}] };
    const { data, error } = await sb.from("reorder_requests").insert({ inventory_item_id, quantity_requested:quantity, supplier_id:supplier_id||item.preferred_supplier_id, quantity_at_trigger:item.current_quantity, minimum_threshold_at_trigger:item.minimum_threshold, internal_note:note||"Reorder via MCP", status:"sent" }).select().single();
    if (error) return { content:[{type:"text" as const,text:JSON.stringify({error:error.message})}] };
    await sb.from("activity_log").insert({ activity_type:"mcp_reorder", entity_type:"inventory", entity_id:inventory_item_id, status:"success", metadata:{quantity,item_name:item.item_name} });
    return { content:[{type:"text" as const,text:JSON.stringify({success:true,reorder:data})}] };
  },
});

mcp.tool("update_approval_status", {
  description: "Approve or reject a pending approval.",
  inputSchema: z.object({ approval_id: z.string(), action: z.enum(["approved","rejected"]), comment: z.string().optional() }),
  handler: async ({ approval_id, action, comment }) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("approvals").update({ status:action, comment:comment||`${action} via MCP`, approved_by:"mcp-agent", updated_at:new Date().toISOString() }).eq("id",approval_id).select().single();
    if (error) return { content:[{type:"text" as const,text:JSON.stringify({error:error.message})}] };
    await sb.from("activity_log").insert({ activity_type:`mcp_${action}`, entity_type:"approval", entity_id:approval_id, status:"success", metadata:{action,comment} });
    return { content:[{type:"text" as const,text:JSON.stringify({success:true,approval:data})}] };
  },
});

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);

const app = new Hono();
app.all("/*", async (c) => {
  return await httpHandler(c.req.raw);
});

Deno.serve(app.fetch);
