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

const mcpServer = new McpServer({
  name: "talligence-mcp",
  version: "1.0.0",
});

// ===== READ TOOLS =====

mcpServer.tool({
  name: "get_system_summary",
  description: "Get a complete overview of all entities: clients, suppliers, invoices, POs, documents, approvals, quotations, inventory, and today's activity.",
  inputSchema: {
    type: "object",
    properties: {
      include_today: { type: "boolean", description: "Include today's activity summary" },
    },
  },
  handler: async ({ include_today = true }) => {
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
      const todayTables = ["clients", "client_invoices", "raw_material_invoices", "po_intake_documents", "activity_log"];
      const todayCounts: Record<string, number> = {};
      await Promise.all(todayTables.map(async (t) => {
        const { count } = await sb.from(t).select("*", { count: "exact", head: true }).gte("created_at", todayStart);
        todayCounts[t] = count || 0;
      }));
      todaySummary = todayCounts;
    }

    return { content: [{ type: "text", text: JSON.stringify({ counts, today: todaySummary }, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_invoice_stats",
  description: "Get invoice statistics with filters. Covers both client invoices and raw material (supplier) invoices.",
  inputSchema: {
    type: "object",
    properties: {
      invoice_type: { type: "string", enum: ["client", "raw_material", "all"], description: "Type of invoices" },
      time_range: { type: "string", enum: ["last_hour", "today", "this_week", "this_month", "all_time"] },
      status_filter: { type: "string", enum: ["pending", "awaiting_approval", "approved", "rejected", "all"] },
      limit: { type: "number", description: "Max records to return" },
    },
    required: ["invoice_type"],
  },
  handler: async ({ invoice_type, time_range = "all_time", status_filter = "all", limit = 5 }) => {
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

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
});

mcpServer.tool({
  name: "get_clients",
  description: "Get client information. List clients, search by name, or get a specific client by ID.",
  inputSchema: {
    type: "object",
    properties: {
      client_id: { type: "string", description: "Specific client ID" },
      search: { type: "string", description: "Search by name" },
      limit: { type: "number" },
    },
  },
  handler: async ({ client_id, search, limit = 10 }) => {
    const sb = getSupabase();
    if (client_id) {
      const { data } = await sb.from("clients").select("*").eq("id", client_id).maybeSingle();
      const { count } = await sb.from("client_invoices").select("*", { count: "exact", head: true }).eq("client_id", client_id);
      return { content: [{ type: "text", text: JSON.stringify({ client: data, invoice_count: count || 0 }) }] };
    }
    let q = sb.from("clients").select("*").order("created_at", { ascending: false });
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q.limit(limit);
    const { count } = await sb.from("clients").select("*", { count: "exact", head: true });
    return { content: [{ type: "text", text: JSON.stringify({ clients: data || [], total: count || 0 }) }] };
  },
});

mcpServer.tool({
  name: "get_suppliers",
  description: "Get supplier/vendor information. List, search, or get details.",
  inputSchema: {
    type: "object",
    properties: {
      supplier_id: { type: "string" },
      search: { type: "string" },
      limit: { type: "number" },
    },
  },
  handler: async ({ supplier_id, search, limit = 10 }) => {
    const sb = getSupabase();
    if (supplier_id) {
      const { data } = await sb.from("suppliers").select("*").eq("id", supplier_id).maybeSingle();
      return { content: [{ type: "text", text: JSON.stringify({ supplier: data }) }] };
    }
    let q = sb.from("suppliers").select("*").order("created_at", { ascending: false });
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q.limit(limit);
    const { count } = await sb.from("suppliers").select("*", { count: "exact", head: true });
    return { content: [{ type: "text", text: JSON.stringify({ suppliers: data || [], total: count || 0 }) }] };
  },
});

mcpServer.tool({
  name: "get_purchase_orders",
  description: "Get purchase order stats and data from both po_orders (PO intake) and purchase_orders tables.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "processed", "converted", "draft", "sent", "all"] },
      time_range: { type: "string", enum: ["today", "this_week", "this_month", "all_time"] },
      limit: { type: "number" },
    },
  },
  handler: async ({ status = "all", time_range = "all_time", limit = 10 }) => {
    const sb = getSupabase();
    const { start } = getDateRange(time_range);

    let q = sb.from("po_orders").select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    if (time_range !== "all_time") q = q.gte("created_at", start);
    const { data } = await q.limit(limit);

    const statuses = ["pending", "processed", "converted", "price_mismatch"];
    const countResults: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      const { count } = await sb.from("po_orders").select("*", { count: "exact", head: true }).eq("status", s);
      countResults[s] = count || 0;
    }));
    const { count: total } = await sb.from("po_orders").select("*", { count: "exact", head: true });

    return { content: [{ type: "text", text: JSON.stringify({ orders: data || [], total: total || 0, by_status: countResults }) }] };
  },
});

mcpServer.tool({
  name: "get_inventory_status",
  description: "Get inventory items, low stock alerts, and reorder history.",
  inputSchema: {
    type: "object",
    properties: {
      low_stock_only: { type: "boolean", description: "Only return items below minimum threshold" },
      limit: { type: "number" },
    },
  },
  handler: async ({ low_stock_only = false, limit = 20 }) => {
    const sb = getSupabase();
    let q = sb.from("inventory_items").select("*, suppliers:preferred_supplier_id(name)").eq("is_active", true).order("current_quantity", { ascending: true });
    const { data: items } = await q.limit(limit);

    const lowStock = (items || []).filter((i: any) => i.current_quantity <= i.minimum_threshold);

    const { data: recentReorders } = await sb.from("reorder_requests").select("*, inventory_items(item_name), suppliers(name)").order("created_at", { ascending: false }).limit(5);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          items: low_stock_only ? lowStock : items || [],
          total_items: items?.length || 0,
          low_stock_count: lowStock.length,
          low_stock_items: lowStock.map((i: any) => ({ name: i.item_name, qty: i.current_quantity, threshold: i.minimum_threshold })),
          recent_reorders: recentReorders || [],
        })
      }],
    };
  },
});

mcpServer.tool({
  name: "get_approvals",
  description: "Get approval requests and their statuses.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "approved", "rejected", "all"] },
      limit: { type: "number" },
    },
  },
  handler: async ({ status = "all", limit = 10 }) => {
    const sb = getSupabase();
    let q = sb.from("approvals").select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q.limit(limit);
    const { count: pending } = await sb.from("approvals").select("*", { count: "exact", head: true }).eq("status", "pending");
    const { count: total } = await sb.from("approvals").select("*", { count: "exact", head: true });
    return { content: [{ type: "text", text: JSON.stringify({ approvals: data || [], total: total || 0, pending: pending || 0 }) }] };
  },
});

mcpServer.tool({
  name: "get_bank_statements",
  description: "Get bank statement upload and transaction reconciliation stats.",
  inputSchema: {
    type: "object",
    properties: {
      include_transactions: { type: "boolean" },
      limit: { type: "number" },
    },
  },
  handler: async ({ include_transactions = false, limit = 10 }) => {
    const sb = getSupabase();
    const { data: statements } = await sb.from("bank_statements").select("*").order("created_at", { ascending: false }).limit(limit);
    const { count: total } = await sb.from("bank_statements").select("*", { count: "exact", head: true });

    const result: any = { statements: statements || [], total: total || 0 };

    if (include_transactions) {
      const { data: txns } = await sb.from("bank_transactions").select("*").order("transaction_date", { ascending: false }).limit(20);
      const { count: matched } = await sb.from("bank_transactions").select("*", { count: "exact", head: true }).neq("matched_status", "unmatched");
      const { count: totalTxns } = await sb.from("bank_transactions").select("*", { count: "exact", head: true });
      result.transactions = txns || [];
      result.total_transactions = totalTxns || 0;
      result.matched = matched || 0;
    }

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});

mcpServer.tool({
  name: "get_liquidity_overview",
  description: "Get weekly liquidity dashboard data including opening balances, inflows, outflows, and line items.",
  inputSchema: {
    type: "object",
    properties: {
      weeks: { type: "number", description: "Number of weeks to fetch (default 4)" },
    },
  },
  handler: async ({ weeks = 4 }) => {
    const sb = getSupabase();
    const { data: weeklyData } = await sb.from("weekly_liquidity").select("*, liquidity_line_items(*)").order("week_start_date", { ascending: false }).limit(weeks);
    return { content: [{ type: "text", text: JSON.stringify({ weeks: weeklyData || [] }) }] };
  },
});

mcpServer.tool({
  name: "get_products",
  description: "Get product master data, including HSN codes, GST rates, and pricing.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string" },
      limit: { type: "number" },
    },
  },
  handler: async ({ search, limit = 20 }) => {
    const sb = getSupabase();
    let q = sb.from("product_master").select("*").eq("is_active", true).order("name");
    if (search) q = q.ilike("name", `%${search}%`);
    const { data } = await q.limit(limit);
    const { count } = await sb.from("product_master").select("*", { count: "exact", head: true }).eq("is_active", true);
    return { content: [{ type: "text", text: JSON.stringify({ products: data || [], total: count || 0 }) }] };
  },
});

mcpServer.tool({
  name: "get_customer_master",
  description: "Get customer master records with payment terms, credit limits, and outstanding amounts.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string" },
      overdue_only: { type: "boolean" },
      limit: { type: "number" },
    },
  },
  handler: async ({ search, overdue_only = false, limit = 20 }) => {
    const sb = getSupabase();
    let q = sb.from("customer_master").select("*").order("customer_name");
    if (search) q = q.ilike("customer_name", `%${search}%`);
    if (overdue_only) q = q.eq("has_overdue_invoices", true);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text", text: JSON.stringify({ customers: data || [] }) }] };
  },
});

mcpServer.tool({
  name: "get_recent_activity",
  description: "Get recent system activity log entries for audit trail and monitoring.",
  inputSchema: {
    type: "object",
    properties: {
      activity_type: { type: "string" },
      time_range: { type: "string", enum: ["last_hour", "today", "this_week", "all_time"] },
      limit: { type: "number" },
    },
  },
  handler: async ({ activity_type, time_range = "today", limit = 20 }) => {
    const sb = getSupabase();
    const { start } = getDateRange(time_range);
    let q = sb.from("activity_log").select("*").order("created_at", { ascending: false });
    if (time_range !== "all_time") q = q.gte("created_at", start);
    if (activity_type) q = q.eq("activity_type", activity_type);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text", text: JSON.stringify({ activities: data || [] }) }] };
  },
});

mcpServer.tool({
  name: "get_quotations",
  description: "Get quotation data with status filtering.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "sent", "approved", "rejected", "all"] },
      limit: { type: "number" },
    },
  },
  handler: async ({ status = "all", limit = 10 }) => {
    const sb = getSupabase();
    let q = sb.from("quotations").select("*, clients(name)").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q.limit(limit);
    const { count } = await sb.from("quotations").select("*", { count: "exact", head: true });
    return { content: [{ type: "text", text: JSON.stringify({ quotations: data || [], total: count || 0 }) }] };
  },
});

mcpServer.tool({
  name: "get_segregation_data",
  description: "Get smart segregation uploads and categorized transactions.",
  inputSchema: {
    type: "object",
    properties: {
      upload_id: { type: "string" },
      limit: { type: "number" },
    },
  },
  handler: async ({ upload_id, limit = 10 }) => {
    const sb = getSupabase();
    if (upload_id) {
      const { data: txns } = await sb.from("segregated_transactions").select("*").eq("upload_id", upload_id).order("transaction_date", { ascending: false });
      return { content: [{ type: "text", text: JSON.stringify({ transactions: txns || [] }) }] };
    }
    const { data: uploads } = await sb.from("segregation_uploads").select("*").order("created_at", { ascending: false }).limit(limit);
    return { content: [{ type: "text", text: JSON.stringify({ uploads: uploads || [] }) }] };
  },
});

mcpServer.tool({
  name: "get_unmapped_codes",
  description: "Get unmapped product codes that need resolution.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "resolved", "all"] },
      limit: { type: "number" },
    },
  },
  handler: async ({ status = "pending", limit = 20 }) => {
    const sb = getSupabase();
    let q = sb.from("unmapped_product_codes").select("*").order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q.limit(limit);
    return { content: [{ type: "text", text: JSON.stringify({ unmapped_codes: data || [] }) }] };
  },
});

// ===== WRITE/ACTION TOOLS =====

mcpServer.tool({
  name: "create_reorder_request",
  description: "Create a reorder request for an inventory item that is low on stock.",
  inputSchema: {
    type: "object",
    properties: {
      inventory_item_id: { type: "string", description: "ID of the inventory item" },
      quantity: { type: "number", description: "Quantity to reorder" },
      supplier_id: { type: "string", description: "Supplier ID (optional, uses preferred)" },
      note: { type: "string", description: "Internal note" },
    },
    required: ["inventory_item_id", "quantity"],
  },
  handler: async ({ inventory_item_id, quantity, supplier_id, note }) => {
    const sb = getSupabase();
    const { data: item } = await sb.from("inventory_items").select("*, suppliers:preferred_supplier_id(name, id)").eq("id", inventory_item_id).maybeSingle();
    if (!item) return { content: [{ type: "text", text: JSON.stringify({ error: "Item not found" }) }] };

    const targetSupplier = supplier_id || item.preferred_supplier_id;
    const { data, error } = await sb.from("reorder_requests").insert({
      inventory_item_id,
      quantity_requested: quantity,
      supplier_id: targetSupplier,
      quantity_at_trigger: item.current_quantity,
      minimum_threshold_at_trigger: item.minimum_threshold,
      internal_note: note || `Auto-reorder: ${item.item_name} low stock (${item.current_quantity}/${item.minimum_threshold})`,
      status: "sent",
    }).select().single();

    if (error) return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };

    await sb.from("activity_log").insert({
      activity_type: "reorder_created",
      entity_type: "inventory",
      entity_id: inventory_item_id,
      status: "success",
      metadata: { reorder_id: data.id, quantity, item_name: item.item_name },
    });

    return { content: [{ type: "text", text: JSON.stringify({ success: true, reorder: data, item_name: item.item_name }) }] };
  },
});

mcpServer.tool({
  name: "update_approval_status",
  description: "Approve or reject a pending approval request.",
  inputSchema: {
    type: "object",
    properties: {
      approval_id: { type: "string" },
      action: { type: "string", enum: ["approved", "rejected"] },
      comment: { type: "string" },
    },
    required: ["approval_id", "action"],
  },
  handler: async ({ approval_id, action, comment }) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("approvals").update({
      status: action,
      comment: comment || `${action} via MCP agent`,
      approved_by: "mcp-agent",
      updated_at: new Date().toISOString(),
    }).eq("id", approval_id).select().single();

    if (error) return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };

    await sb.from("activity_log").insert({
      activity_type: `approval_${action}`,
      entity_type: "approval",
      entity_id: approval_id,
      status: "success",
      metadata: { action, comment },
    });

    return { content: [{ type: "text", text: JSON.stringify({ success: true, approval: data }) }] };
  },
});

mcpServer.tool({
  name: "log_agent_action",
  description: "Log an agent action to the activity log for audit trail and observability.",
  inputSchema: {
    type: "object",
    properties: {
      action_type: { type: "string", description: "Type of action performed" },
      entity_type: { type: "string" },
      entity_id: { type: "string" },
      details: { type: "string" },
    },
    required: ["action_type", "entity_type"],
  },
  handler: async ({ action_type, entity_type, entity_id, details }) => {
    const sb = getSupabase();
    await sb.from("activity_log").insert({
      activity_type: `agent_${action_type}`,
      entity_type,
      entity_id: entity_id || null,
      status: "success",
      metadata: { details, source: "mcp-agent" },
    });
    return { content: [{ type: "text", text: JSON.stringify({ logged: true }) }] };
  },
});

// HTTP transport
const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  return await transport.handleRequest(c.req.raw, mcpServer);
});

Deno.serve(app.fetch);
