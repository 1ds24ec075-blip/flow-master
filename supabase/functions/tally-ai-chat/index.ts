import { createClient } from 'npm:@supabase/supabase-js@2.86.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SYSTEM_PROMPT = `You are TalligenceAI — an agentic accounting assistant powered by MCP (Model Context Protocol).

You have access to real-time business data through MCP tools. You MUST call the appropriate tool for ANY data question. NEVER guess or say you can't access data.

## Your MCP Tools:
- **get_system_summary** — Full system overview with counts of all entities
- **get_invoice_stats** — Invoice data (client & supplier) with status/time filters
- **get_clients** — Client records, search, details
- **get_suppliers** — Supplier/vendor records, search, details
- **get_purchase_orders** — PO data from intake pipeline
- **get_inventory_status** — Inventory levels, low stock alerts, reorder history
- **get_approvals** — Approval queue and statuses
- **get_bank_statements** — Bank statements and transaction reconciliation
- **get_liquidity_overview** — Weekly cash flow and liquidity data
- **get_products** — Product master with HSN codes & GST rates
- **get_customer_master** — Customer master with credit limits & payment terms
- **get_recent_activity** — System activity log / audit trail
- **get_quotations** — Quotation data
- **get_segregation_data** — Smart transaction segregation
- **get_unmapped_codes** — Unmapped product codes needing resolution

## Action Tools (require confirmation):
- **create_reorder_request** — Create inventory reorder
- **update_approval_status** — Approve/reject items
- **log_agent_action** — Log actions for audit trail

## Agentic Behavior:
1. **Multi-step reasoning**: Chain tools together. E.g., check inventory → find low stock → check supplier → create reorder.
2. **Proactive insights**: When showing data, highlight anomalies, risks, or actionable items.
3. **Action confirmation**: For write operations, explain what you'll do and ask for confirmation first.
4. **Context memory**: Reference earlier conversation context for follow-ups.

Format responses with markdown. Use tables for data, bold for key numbers, and bullet points for insights.`;

// Tool definitions matching the MCP server tools
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_system_summary',
      description: 'Get complete overview of all entities and today\'s activity.',
      parameters: { type: 'object', properties: { include_today: { type: 'boolean' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_invoice_stats',
      description: 'Get invoice statistics with filters for type, time, and status.',
      parameters: {
        type: 'object',
        properties: {
          invoice_type: { type: 'string', enum: ['client', 'raw_material', 'all'] },
          time_range: { type: 'string', enum: ['last_hour', 'today', 'this_week', 'this_month', 'all_time'] },
          status_filter: { type: 'string', enum: ['pending', 'awaiting_approval', 'approved', 'rejected', 'all'] },
          limit: { type: 'number' }
        },
        required: ['invoice_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_clients',
      description: 'Get client records. Search by name or get specific client.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          search: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_suppliers',
      description: 'Get supplier/vendor records.',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: { type: 'string' },
          search: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_purchase_orders',
      description: 'Get PO data with status and time filters.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'processed', 'converted', 'draft', 'sent', 'all'] },
          time_range: { type: 'string', enum: ['today', 'this_week', 'this_month', 'all_time'] },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_status',
      description: 'Get inventory levels, low stock alerts, and reorder history.',
      parameters: {
        type: 'object',
        properties: {
          low_stock_only: { type: 'boolean' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_approvals',
      description: 'Get approval requests with status filter.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'] },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_statements',
      description: 'Get bank statement stats and transaction data.',
      parameters: {
        type: 'object',
        properties: {
          include_transactions: { type: 'boolean' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_liquidity_overview',
      description: 'Get weekly liquidity/cash flow data.',
      parameters: {
        type: 'object',
        properties: { weeks: { type: 'number' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Get product master data with HSN codes and GST rates.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_master',
      description: 'Get customer master with credit limits, payment terms, outstanding amounts.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          overdue_only: { type: 'boolean' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_activity',
      description: 'Get system activity log for audit trail.',
      parameters: {
        type: 'object',
        properties: {
          activity_type: { type: 'string' },
          time_range: { type: 'string', enum: ['last_hour', 'today', 'this_week', 'all_time'] },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_quotations',
      description: 'Get quotation data.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['draft', 'sent', 'approved', 'rejected', 'all'] },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_segregation_data',
      description: 'Get smart segregation uploads and transactions.',
      parameters: {
        type: 'object',
        properties: {
          upload_id: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_unmapped_codes',
      description: 'Get unmapped product codes needing resolution.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'resolved', 'all'] },
          limit: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_reorder_request',
      description: 'Create a reorder request for low-stock inventory.',
      parameters: {
        type: 'object',
        properties: {
          inventory_item_id: { type: 'string' },
          quantity: { type: 'number' },
          supplier_id: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['inventory_item_id', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_approval_status',
      description: 'Approve or reject a pending approval.',
      parameters: {
        type: 'object',
        properties: {
          approval_id: { type: 'string' },
          action: { type: 'string', enum: ['approved', 'rejected'] },
          comment: { type: 'string' }
        },
        required: ['approval_id', 'action']
      }
    }
  }
];

// Helper to get date ranges
function getDateRange(timeRange: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;
  switch (timeRange) {
    case 'last_hour': start = new Date(now.getTime() - 3600000); break;
    case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case 'this_week': { const d = now.getDay(); start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d); break; }
    case 'this_month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'last_3_months': start = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
    case 'this_year': start = new Date(now.getFullYear(), 0, 1); break;
    default: start = new Date(0);
  }
  return { start: start.toISOString(), end };
}

// Execute tool calls against the database directly (same process, no HTTP round-trip)
async function executeTool(name: string, args: any, supabase: any): Promise<any> {
  const { start } = args.time_range ? getDateRange(args.time_range) : { start: new Date(0).toISOString() };

  switch (name) {
    case 'get_system_summary': {
      const tables = ['clients', 'suppliers', 'client_invoices', 'raw_material_invoices', 'purchase_orders', 'po_intake_documents', 'approvals', 'quotations', 'bank_statements', 'inventory_items'];
      const counts: Record<string, number> = {};
      await Promise.all(tables.map(async (t) => {
        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
        counts[t] = count || 0;
      }));
      let today = null;
      if (args.include_today !== false) {
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const tt = ['clients', 'client_invoices', 'raw_material_invoices', 'po_intake_documents', 'activity_log'];
        const tc: Record<string, number> = {};
        await Promise.all(tt.map(async (t) => {
          const { count } = await supabase.from(t).select('*', { count: 'exact', head: true }).gte('created_at', todayStart);
          tc[t] = count || 0;
        }));
        today = tc;
      }
      return { counts, today };
    }
    case 'get_invoice_stats': {
      const { invoice_type, time_range = 'all_time', status_filter = 'all', limit = 5 } = args;
      const result: any = {};
      if (invoice_type === 'client' || invoice_type === 'all') {
        let q = supabase.from('client_invoices').select('*, clients(name)').order('created_at', { ascending: false });
        if (time_range !== 'all_time') q = q.gte('created_at', start);
        if (status_filter !== 'all') q = q.eq('status', status_filter);
        const { data } = await q.limit(limit);
        const { count: total } = await supabase.from('client_invoices').select('*', { count: 'exact', head: true });
        const { count: pending } = await supabase.from('client_invoices').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        result.client_invoices = { total: total || 0, pending: pending || 0, recent: data || [] };
      }
      if (invoice_type === 'raw_material' || invoice_type === 'all') {
        let q = supabase.from('raw_material_invoices').select('*, suppliers(name)').order('created_at', { ascending: false });
        if (time_range !== 'all_time') q = q.gte('created_at', start);
        if (status_filter !== 'all') q = q.eq('status', status_filter);
        const { data } = await q.limit(limit);
        const { count: total } = await supabase.from('raw_material_invoices').select('*', { count: 'exact', head: true });
        const { count: pending } = await supabase.from('raw_material_invoices').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        result.raw_material_invoices = { total: total || 0, pending: pending || 0, recent: data || [] };
      }
      return result;
    }
    case 'get_clients': {
      const { client_id, search, limit = 10 } = args;
      if (client_id) {
        const { data } = await supabase.from('clients').select('*').eq('id', client_id).maybeSingle();
        const { count } = await supabase.from('client_invoices').select('*', { count: 'exact', head: true }).eq('client_id', client_id);
        return { client: data, invoice_count: count || 0 };
      }
      let q = supabase.from('clients').select('*').order('created_at', { ascending: false });
      if (search) q = q.ilike('name', `%${search}%`);
      const { data } = await q.limit(limit);
      const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true });
      return { clients: data || [], total: count || 0 };
    }
    case 'get_suppliers': {
      const { supplier_id, search, limit = 10 } = args;
      if (supplier_id) {
        const { data } = await supabase.from('suppliers').select('*').eq('id', supplier_id).maybeSingle();
        return { supplier: data };
      }
      let q = supabase.from('suppliers').select('*').order('created_at', { ascending: false });
      if (search) q = q.ilike('name', `%${search}%`);
      const { data } = await q.limit(limit);
      const { count } = await supabase.from('suppliers').select('*', { count: 'exact', head: true });
      return { suppliers: data || [], total: count || 0 };
    }
    case 'get_purchase_orders': {
      const { status = 'all', time_range = 'all_time', limit = 10 } = args;
      let q = supabase.from('po_orders').select('*').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      if (time_range !== 'all_time') q = q.gte('created_at', start);
      const { data } = await q.limit(limit);
      const { count: total } = await supabase.from('po_orders').select('*', { count: 'exact', head: true });
      return { orders: data || [], total: total || 0 };
    }
    case 'get_inventory_status': {
      const { low_stock_only = false, limit = 20 } = args;
      const { data: items } = await supabase.from('inventory_items').select('*, suppliers:preferred_supplier_id(name)').eq('is_active', true).order('current_quantity').limit(limit);
      const lowStock = (items || []).filter((i: any) => i.current_quantity <= i.minimum_threshold);
      const { data: reorders } = await supabase.from('reorder_requests').select('*, inventory_items(item_name)').order('created_at', { ascending: false }).limit(5);
      return { items: low_stock_only ? lowStock : items || [], low_stock_count: lowStock.length, low_stock_items: lowStock.map((i: any) => ({ name: i.item_name, qty: i.current_quantity, threshold: i.minimum_threshold })), recent_reorders: reorders || [] };
    }
    case 'get_approvals': {
      const { status = 'all', limit = 10 } = args;
      let q = supabase.from('approvals').select('*').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data } = await q.limit(limit);
      const { count: pending } = await supabase.from('approvals').select('*', { count: 'exact', head: true }).eq('status', 'pending');
      return { approvals: data || [], pending: pending || 0 };
    }
    case 'get_bank_statements': {
      const { include_transactions = false, limit = 10 } = args;
      const { data } = await supabase.from('bank_statements').select('*').order('created_at', { ascending: false }).limit(limit);
      const result: any = { statements: data || [] };
      if (include_transactions) {
        const { data: txns } = await supabase.from('bank_transactions').select('*').order('transaction_date', { ascending: false }).limit(20);
        result.transactions = txns || [];
      }
      return result;
    }
    case 'get_liquidity_overview': {
      const { weeks = 4 } = args;
      const { data } = await supabase.from('weekly_liquidity').select('*, liquidity_line_items(*)').order('week_start_date', { ascending: false }).limit(weeks);
      return { weeks: data || [] };
    }
    case 'get_products': {
      const { search, limit = 20 } = args;
      let q = supabase.from('product_master').select('*').eq('is_active', true).order('name');
      if (search) q = q.ilike('name', `%${search}%`);
      const { data } = await q.limit(limit);
      return { products: data || [] };
    }
    case 'get_customer_master': {
      const { search, overdue_only = false, limit = 20 } = args;
      let q = supabase.from('customer_master').select('*').order('customer_name');
      if (search) q = q.ilike('customer_name', `%${search}%`);
      if (overdue_only) q = q.eq('has_overdue_invoices', true);
      const { data } = await q.limit(limit);
      return { customers: data || [] };
    }
    case 'get_recent_activity': {
      const { activity_type, time_range = 'today', limit = 20 } = args;
      let q = supabase.from('activity_log').select('*').order('created_at', { ascending: false });
      if (time_range !== 'all_time') q = q.gte('created_at', start);
      if (activity_type) q = q.eq('activity_type', activity_type);
      const { data } = await q.limit(limit);
      return { activities: data || [] };
    }
    case 'get_quotations': {
      const { status = 'all', limit = 10 } = args;
      let q = supabase.from('quotations').select('*, clients(name)').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data } = await q.limit(limit);
      return { quotations: data || [] };
    }
    case 'get_segregation_data': {
      const { upload_id, limit = 10 } = args;
      if (upload_id) {
        const { data } = await supabase.from('segregated_transactions').select('*').eq('upload_id', upload_id);
        return { transactions: data || [] };
      }
      const { data } = await supabase.from('segregation_uploads').select('*').order('created_at', { ascending: false }).limit(limit);
      return { uploads: data || [] };
    }
    case 'get_unmapped_codes': {
      const { status = 'pending', limit = 20 } = args;
      let q = supabase.from('unmapped_product_codes').select('*').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data } = await q.limit(limit);
      return { unmapped_codes: data || [] };
    }
    case 'create_reorder_request': {
      const { inventory_item_id, quantity, supplier_id, note } = args;
      const { data: item } = await supabase.from('inventory_items').select('*').eq('id', inventory_item_id).maybeSingle();
      if (!item) return { error: 'Item not found' };
      const { data, error } = await supabase.from('reorder_requests').insert({
        inventory_item_id, quantity_requested: quantity,
        supplier_id: supplier_id || item.preferred_supplier_id,
        quantity_at_trigger: item.current_quantity,
        minimum_threshold_at_trigger: item.minimum_threshold,
        internal_note: note || `Reorder via AI agent`,
        status: 'sent',
      }).select().single();
      if (error) return { error: error.message };
      await supabase.from('activity_log').insert({ activity_type: 'agent_reorder', entity_type: 'inventory', entity_id: inventory_item_id, status: 'success', metadata: { quantity, item_name: item.item_name } });
      return { success: true, reorder: data };
    }
    case 'update_approval_status': {
      const { approval_id, action, comment } = args;
      const { data, error } = await supabase.from('approvals').update({ status: action, comment: comment || `${action} via AI agent`, approved_by: 'ai-agent', updated_at: new Date().toISOString() }).eq('id', approval_id).select().single();
      if (error) return { error: error.message };
      await supabase.from('activity_log').insert({ activity_type: `agent_approval_${action}`, entity_type: 'approval', entity_id: approval_id, status: 'success', metadata: { action, comment } });
      return { success: true, approval: data };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { message, conversationId } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Manage conversation
    let currentConversationId = conversationId;
    let conversationHistory: any[] = [];

    if (currentConversationId) {
      const { data: existing } = await supabase.from('messages').select('role, content').eq('conversation_id', currentConversationId).order('created_at', { ascending: true });
      if (existing) conversationHistory = existing.map(m => ({ role: m.role, content: m.content }));
    } else {
      currentConversationId = crypto.randomUUID();
      const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
      await supabase.from('conversations').insert({ id: currentConversationId, title });
    }

    // Save user message
    await supabase.from('messages').insert({ conversation_id: currentConversationId, role: 'user', content: message });

    // Build messages for AI
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.slice(-20),
      { role: 'user', content: message },
    ];

    // Call Lovable AI with tool calling
    let finalResponse = '';
    const allToolCalls: any[] = [];
    let maxIterations = 5;

    while (maxIterations-- > 0) {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages,
          tools: toolDefinitions,
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        if (status === 402) return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add funds in Settings > Workspace > Usage.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const errText = await aiResponse.text();
        console.error('AI gateway error:', status, errText);
        throw new Error(`AI gateway error: ${status}`);
      }

      const result = await aiResponse.json();
      const choice = result.choices?.[0];

      if (!choice) throw new Error('No response from AI');

      // If the model wants to call tools
      if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length) {
        const toolCalls = choice.message.tool_calls || [];

        // Add assistant message with tool calls
        messages.push(choice.message);

        // Execute each tool call
        for (const tc of toolCalls) {
          const fnName = tc.function.name;
          let fnArgs: any = {};
          try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch { fnArgs = {}; }

          console.log(`Executing tool: ${fnName}`, fnArgs);
          const toolResult = await executeTool(fnName, fnArgs, supabase);
          allToolCalls.push({ name: fnName, args: fnArgs, result: toolResult });

          // Add tool result to messages
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Continue the loop for another AI call with tool results
        continue;
      }

      // No more tool calls, we have final response
      finalResponse = choice.message?.content || 'I was unable to generate a response.';
      break;
    }

    // Log agent activity
    await supabase.from('activity_log').insert({
      activity_type: 'agent_query',
      entity_type: 'conversation',
      entity_id: currentConversationId,
      status: 'success',
      metadata: {
        tools_used: allToolCalls.map(t => t.name),
        tool_count: allToolCalls.length,
        query_preview: message.substring(0, 100),
      },
    });

    // Save assistant response
    await supabase.from('messages').insert({
      conversation_id: currentConversationId,
      role: 'assistant',
      content: finalResponse,
      function_calls: allToolCalls.length > 0 ? allToolCalls : null,
    });

    return new Response(JSON.stringify({
      response: finalResponse,
      conversationId: currentConversationId,
      functionCalls: allToolCalls,
      toolsUsed: allToolCalls.map(t => t.name),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('TallyAI error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
