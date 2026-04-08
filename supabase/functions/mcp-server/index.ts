import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "npm:@supabase/supabase-js@2.86.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function getDateRange(timeRange: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;
  switch (timeRange) {
    case "last_hour": start = new Date(now.getTime() - 3600000); break;
    case "today": start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "this_week": start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); break;
    case "this_month": start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "last_3_months": start = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
    case "this_year": start = new Date(now.getFullYear(), 0, 1); break;
    default: start = new Date(0);
  }
  return { start: start.toISOString(), end };
}

const app = new Hono();
const mcpServer = new McpServer({ name: "talligence-mcp", version: "1.0.0" });

// Register tools using positional args: name, description, schema, handler
mcpServer.tool(
  "get_system_summary",
  "Get a complete overview of all entities: clients, suppliers, invoices, POs, documents, approvals, quotations, inventory, and today's activity.",
  { type: "object" as const, properties: { include_today: { type: "boolean" as const } } },
  async ({ include_today = true }: { include_today?: boolean }) => {
    const sb = getSupabase();
    const tables = ["clients", "suppliers", "client_invoices", "raw_material_invoices", "purchase_orders", "po_intake_documents", "approvals", "quotations", "bank_statements", "inventory_items"];
    const counts: Record<string, number> = {};
    await Promise.all(tables.map(async (t) => {
      const { count } = await sb.from(t).select("*", { count: "exact", head: true });
      counts[t] = count || 0;
    }));
    let todaySummary = null;
    if (include_today) {
      const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const tt = ["clients", "client_invoices", "raw_material_invoices", "po_intake_documents", "activity_log"];
      const tc: Record<string, number> = {};
      await Promise.all(tt.map(async (t) => {
        const { count } = await sb.from(t).select("*", { count: "exact", head: true }).gte("created_at", todayStart);
        tc[t] = count || 0;
      }));
      todaySummary = tc;
    }
    return { content: [{ type: "text" as const, text: JSON.stringify({ counts, today: todaySummary }, null, 2) }] };
  }
);

mcpServer.tool(
  "get_invoice_stats",
  "Get invoice statistics with filters. Covers both client invoices and raw material (supplier) invoices.",
  {
    type: "object" as const,
    properties: {
      invoice_type: { type: "string" as const, enum: ["client", "raw_material", "all"] },
      time_range: { type: "string" as const, enum: ["last_hour", "today", "this_week", "this_month", "all_time"] },
      status_filter: { type: "string" as const, enum: ["pending", "awaiting_approval", "approved", "rejected", "all"] },
      limit: { type: "number" as const }
    },
    required: ["invoice_type"]
  },
  async (args: any) => {
    const { invoice_type, time_range = "all_time", status_filter = "all", limit = 5 } = args;
    const sb = getSupabase();
    const { start } = getDateRange(time_range);
    const result: any = {};
    if (invoice_type === "client" || invoice_type === "all") {
      let q = sb.from("client_invoices").select("*, clients(name)").order("created_at", { ascending: false });
      if (time_range !== "all_time") q = q.gte("created_at", start);
      if (status_filter !== "all") q = q.eq("status", status_filter);
      const { data } = await q.limit(limit);
      const { count: total } = await sb.from("client_invoices").select("*", { count: "exact", head: true });
      const { count: pending } = await sb.from("client_invoices").select("*", { count: "exact", head: true }).eq("status", "pending");
      result.client_invoices = { total: total || 0, pending: pending || 0, recent: data || [] };
    }
    if (invoice_type === "raw_material" || invoice_type === "all") {
      let q = sb.from("raw_material_invoices").select("*, suppliers(name)").order("created_at", { ascending: false });
      if (time_range !== "all_time") q = q.gte("created_at", start);
      if (status_filter !== "all") q = q.eq("status", status_filter);
      const { data } = await q.limit(limit);
      const { count: total } = await sb.from("raw_material_invoices").select("*", { count: "exact", head: true });
      const { count: pending } = await sb.from("raw_material_invoices").select("*", { count: "exact", head: true }).eq("status", "pending");
      result.raw_material_invoices = { total: total || 0, pending: pending || 0, recent: data || [] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

mcpServer.tool(
  "get_clients",
  "Get client information. List clients, search by name, or get a specific client by ID.",
  { type: "object" as const, properties: { client_id: { type: "string" as const }, search: { type: "string" as const }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { client_id, search, limit = 10 } = args;
    const sb = getSupabase();
    if (client_id) {
      const { data } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
      const { count } = await sb.from("client_invoices").select("*", { count: "exact", head: true }).eq("client_id", client_id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ client: data, invoice_count: count || 0 }) }] };
    }
    let q = sb.from("clients").select("*").order("created_at", { ascending: false });
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q.limit(limit);
    const { count } = await sb.from("clients").select("*", { count: "exact", head: true });
    return { content: [{ type: "text" as const, text: JSON.stringify({ clients: data || [], total: count || 0 }) }] };
  }
);

mcpServer.tool(
  "get_suppliers",
  "Get supplier/vendor records. List, search, or get details.",
  { type: "object" as const, properties: { supplier_id: { type: "string" as const }, search: { type: "string" as const }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { supplier_id, search, limit = 10 } = args;
    const sb = getSupabase();
    if (supplier_id) {
      const { data } = await sb.from("suppliers").select("*").eq("id", supplier_id).maybeSingle();
      return { content: [{ type: "text" as const, text: JSON.stringify({ supplier: data }) }] };
    }
    let q = sb.from("suppliers").select("*").order("created_at", { ascending: false });
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q.limit(limit);
    const { count } = await sb.from("suppliers").select("*", { count: "exact", head: true });
    return { content: [{ type: "text" as const, text: JSON.stringify({ suppliers: data || [], total: count || 0 }) }] };
  }
);

mcpServer.tool(
  "get_purchase_orders",
  "Get purchase order stats and data from the PO intake pipeline.",
  {
    type: "object" as const,
    properties: {
      status: { type: "string" as const, enum: ["pending", "processed", "converted", "draft", "sent", "all"] },
      time_range: { type: "string" as const, enum: ["today", "this_week", "this_month", "all_time"] },
      limit: { type: "number" as const }
    }
  },
  async (args: any) => {
    const { status = "all", time_range = "all_time", limit = 10 } = args;
    const sb = getSupabase();
    const { start } = getDateRange(time_range);
    let q = sb.from("po_orders").select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    if (time_range !== "all_time") q = q.gte("created_at", start);
    const { data } = await q.limit(limit);
    const { count: total } = await sb.from("po_orders").select("*", { count: "exact", head: true });
    return { content: [{ type: "text" as const, text: JSON.stringify({ orders: data || [], total: total || 0 }) }] };
  }
);

mcpServer.tool(
  "get_inventory_status",
  "Get inventory items, low stock alerts, and reorder history.",
  { type: "object" as const, properties: { low_stock_only: { type: "boolean" as const }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { low_stock_only = false, limit = 20 } = args;
    const sb = getSupabase();
    const { data: items } = await sb.from("inventory_items").select("*, suppliers:preferred_supplier_id(name)").eq("is_active", true).order("current_quantity").limit(limit);
    const lowStock = (items || []).filter((i: any) => i.current_quantity <= i.minimum_threshold);
    const { data: reorders } = await sb.from("reorder_requests").select("*, inventory_items(item_name), suppliers(name)").order("created_at", { ascending: false }).limit(5);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        items: low_stock_only ? lowStock : items || [],
        low_stock_count: lowStock.length,
        low_stock_items: lowStock.map((i: any) => ({ name: i.item_name, qty: i.current_quantity, threshold: i.minimum_threshold })),
        recent_reorders: reorders || [],
      }) }],
    };
  }
);

mcpServer.tool(
  "get_approvals",
  "Get approval requests and their statuses.",
  { type: "object" as const, properties: { status: { type: "string" as const, enum: ["pending", "approved", "rejected", "all"] }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { status = "all", limit = 10 } = args;
    const sb = getSupabase();
    let q = sb.from("approvals").select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q.limit(limit);
    const { count: pending } = await sb.from("approvals").select("*", { count: "exact", head: true }).eq("status", "pending");
    return { content: [{ type: "text" as const, text: JSON.stringify({ approvals: data || [], pending: pending || 0 }) }] };
  }
);

mcpServer.tool(
  "get_bank_statements",
  "Get bank statement and transaction reconciliation data.",
  { type: "object" as const, properties: { include_transactions: { type: "boolean" as const }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { include_transactions = false, limit = 10 } = args;
    const sb = getSupabase();
    const { data } = await sb.from("bank_statements").select("*").order("created_at", { ascending: false }).limit(limit);
    const result: any = { statements: data || [] };
    if (include_transactions) {
      const { data: txns } = await sb.from("bank_transactions").select("*").order("transaction_date", { ascending: false }).limit(20);
      result.transactions = txns || [];
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

mcpServer.tool(
  "get_liquidity_overview",
  "Get weekly liquidity dashboard data with cash flow details.",
  { type: "object" as const, properties: { weeks: { type: "number" as const } } },
  async (args: any) => {
    const { weeks = 4 } = args;
    const sb = getSupabase();
    const { data } = await sb.from("weekly_liquidity").select("*, liquidity_line_items(*)").order("week_start_date", { ascending: false }).limit(weeks);
    return { content: [{ type: "text" as const, text: JSON.stringify({ weeks: data || [] }) }] };
  }
);

mcpServer.tool(
  "get_products",
  "Get product master data including HSN codes, GST rates, and pricing.",
  { type: "object" as const, properties: { search: { type: "string" as const }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { search, limit = 20 } = args;
    const sb = getSupabase();
    let q = sb.from("product_master").select("*").eq("is_active", true).order("name");
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text" as const, text: JSON.stringify({ products: data || [] }) }] };
  }
);

mcpServer.tool(
  "get_customer_master",
  "Get customer master records with credit limits, payment terms, outstanding amounts.",
  { type: "object" as const, properties: { search: { type: "string" as const }, overdue_only: { type: "boolean" as const }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { search, overdue_only = false, limit = 20 } = args;
    const sb = getSupabase();
    let q = sb.from("customer_master").select("*").order("customer_name");
    if (search) q = q.ilike("customer_name", `%${search}%`);
    if (overdue_only) q = q.eq("has_overdue_invoices", true);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text" as const, text: JSON.stringify({ customers: data || [] }) }] };
  }
);

mcpServer.tool(
  "get_recent_activity",
  "Get recent system activity log entries for audit trail and monitoring.",
  { type: "object" as const, properties: { activity_type: { type: "string" as const }, time_range: { type: "string" as const, enum: ["last_hour", "today", "this_week", "all_time"] }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { activity_type, time_range = "today", limit = 20 } = args;
    const sb = getSupabase();
    const { start } = getDateRange(time_range);
    let q = sb.from("activity_log").select("*").order("created_at", { ascending: false });
    if (time_range !== "all_time") q = q.gte("created_at", start);
    if (activity_type) q = q.eq("activity_type", activity_type);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text" as const, text: JSON.stringify({ activities: data || [] }) }] };
  }
);

mcpServer.tool(
  "get_quotations",
  "Get quotation data with status filtering.",
  { type: "object" as const, properties: { status: { type: "string" as const, enum: ["draft", "sent", "approved", "rejected", "all"] }, limit: { type: "number" as const } } },
  async (args: any) => {
    const { status = "all", limit = 10 } = args;
    const sb = getSupabase();
    let q = sb.from("quotations").select("*, clients(name)").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text" as const, text: JSON.stringify({ quotations: data || [] }) }] };
  }
);

mcpServer.tool(
  "create_reorder_request",
  "Create a reorder request for an inventory item that is low on stock.",
  {
    type: "object" as const,
    properties: {
      inventory_item_id: { type: "string" as const },
      quantity: { type: "number" as const },
      supplier_id: { type: "string" as const },
      note: { type: "string" as const }
    },
    required: ["inventory_item_id", "quantity"]
  },
  async (args: any) => {
    const { inventory_item_id, quantity, supplier_id, note } = args;
    const sb = getSupabase();
    const { data: item } = await sb.from("inventory_items").select("*").eq("id", inventory_item_id).maybeSingle();
    if (!item) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Item not found" }) }] };
    const { data, error } = await sb.from("reorder_requests").insert({
      inventory_item_id, quantity_requested: quantity,
      supplier_id: supplier_id || item.preferred_supplier_id,
      quantity_at_trigger: item.current_quantity,
      minimum_threshold_at_trigger: item.minimum_threshold,
      internal_note: note || `Auto-reorder via MCP`,
      status: "sent",
    }).select().single();
    if (error) return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }] };
    await sb.from("activity_log").insert({ activity_type: "mcp_reorder", entity_type: "inventory", entity_id: inventory_item_id, status: "success", metadata: { quantity, item_name: item.item_name } });
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, reorder: data, item_name: item.item_name }) }] };
  }
);

mcpServer.tool(
  "update_approval_status",
  "Approve or reject a pending approval request.",
  {
    type: "object" as const,
    properties: {
      approval_id: { type: "string" as const },
      action: { type: "string" as const, enum: ["approved", "rejected"] },
      comment: { type: "string" as const }
    },
    required: ["approval_id", "action"]
  },
  async (args: any) => {
    const { approval_id, action, comment } = args;
    const sb = getSupabase();
    const { data, error } = await sb.from("approvals").update({
      status: action, comment: comment || `${action} via MCP agent`,
      approved_by: "mcp-agent", updated_at: new Date().toISOString(),
    }).eq("id", approval_id).select().single();
    if (error) return { content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }] };
    await sb.from("activity_log").insert({ activity_type: `mcp_approval_${action}`, entity_type: "approval", entity_id: approval_id, status: "success", metadata: { action, comment } });
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, approval: data }) }] };
  }
);

const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  return await transport.handleRequest(c.req.raw, mcpServer);
});

Deno.serve(app.fetch);
