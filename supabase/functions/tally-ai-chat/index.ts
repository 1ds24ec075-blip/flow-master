import { createClient } from 'npm:@supabase/supabase-js@2.86.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SYSTEM_PROMPT = `You are TallyAI, an intelligent assistant for an accounting and GST management system. You have access to real-time data from the system through function calls.

IMPORTANT: You MUST use the available tools/functions to answer questions about:
- Invoices (client invoices and raw material invoices) - use get_invoice_stats
- Purchase Orders (POs) - use get_po_stats
- Clients - use get_client_info
- Suppliers/Vendors - use get_supplier_info
- Documents and uploads - use get_document_stats
- System activity and recent changes - use get_recent_activity
- Bank statements and transactions - use get_bank_statement_stats
- Approvals and their status - use get_approval_stats

When users ask about counts, totals, recent items, specific records, or any data question, you MUST call the appropriate function first to get real data. NEVER say you don't have access to data - you DO have access through the tools.

Be helpful, professional, and precise. Always base your answers on real data from the function results.`;

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_invoice_stats',
      description: 'Get statistics about invoices including counts by status, recent invoices, and totals. Use this for any question about invoices.',
      parameters: {
        type: 'object',
        properties: {
          invoice_type: {
            type: 'string',
            enum: ['client', 'raw_material', 'all'],
            description: 'Type of invoices to query'
          },
          limit: {
            type: 'number',
            description: 'Number of recent invoices to return'
          }
        },
        required: ['invoice_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_client_info',
      description: 'Get information about clients including recent clients, all clients, and specific client details. Use this for questions about clients, customers, or who the most recent client is.',
      parameters: {
        type: 'object',
        properties: {
          client_id: {
            type: 'string',
            description: 'Specific client ID to query (optional)'
          },
          limit: {
            type: 'number',
            description: 'Number of clients to return'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_supplier_info',
      description: 'Get information about suppliers/vendors including recent suppliers, all suppliers, and specific supplier details. Use this for questions about suppliers, vendors, or material providers.',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: {
            type: 'string',
            description: 'Specific supplier ID to query (optional)'
          },
          limit: {
            type: 'number',
            description: 'Number of suppliers to return'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_po_stats',
      description: 'Get statistics about purchase orders including counts by status and recent POs. Use this for questions about POs, purchase orders, or orders.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['draft', 'sent', 'processing', 'materials_received', 'completed', 'all'],
            description: 'Filter by PO status'
          },
          limit: {
            type: 'number',
            description: 'Number of recent POs to return'
          }
        },
        required: ['status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_activity',
      description: 'Get recent system activity including uploads, processing, and errors. Use this for questions about what happened recently, recent actions, or activity in the last X minutes.',
      parameters: {
        type: 'object',
        properties: {
          activity_type: {
            type: 'string',
            description: 'Filter by activity type (upload, process, extract, ai_query, etc.)'
          },
          limit: {
            type: 'number',
            description: 'Number of activities to return'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_document_stats',
      description: 'Get statistics about document uploads and processing. Use this for questions about documents, uploads, files, or what documents have been uploaded.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['uploaded', 'extracted', 'reviewed', 'tally_generated', 'error', 'all'],
            description: 'Filter by document status'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_approval_stats',
      description: 'Get statistics about approvals including pending, approved, and rejected counts. Use this for questions about approvals or approval status.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected', 'all'],
            description: 'Filter by approval status'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_statement_stats',
      description: 'Get statistics about bank statements and transactions. Use this for questions about bank statements, transactions, or banking data.',
      parameters: {
        type: 'object',
        properties: {
          include_transactions: {
            type: 'boolean',
            description: 'Whether to include transaction details'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_system_summary',
      description: 'Get an overall summary of all entities in the system including counts of clients, suppliers, invoices, POs, documents, and approvals. Use this for overview questions or when asked about "what entities do we have" or general system status.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

async function executeFunction(functionName: string, args: any, supabase: any) {
  console.log(`Executing function: ${functionName} with args:`, JSON.stringify(args));
  
  switch (functionName) {
    case 'get_invoice_stats': {
      const { invoice_type, limit = 5 } = args;
      const result: any = {};

      if (invoice_type === 'client' || invoice_type === 'all') {
        const { data: clientInvoices, error } = await supabase
          .from('client_invoices')
          .select('*, clients(name)')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) console.error('Error fetching client invoices:', error);

        const { count: totalCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true });

        const { count: pendingCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        const { count: approvedCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved');

        // Get today's invoices
        const today = new Date().toISOString().split('T')[0];
        const { count: todayCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', today);

        result.client_invoices = {
          total_count: totalCount || 0,
          pending_count: pendingCount || 0,
          approved_count: approvedCount || 0,
          processed_today: todayCount || 0,
          recent: clientInvoices || []
        };
      }

      if (invoice_type === 'raw_material' || invoice_type === 'all') {
        const { data: rawInvoices, error } = await supabase
          .from('raw_material_invoices')
          .select('*, suppliers(name)')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) console.error('Error fetching raw material invoices:', error);

        const { count: totalCount } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true });

        const { count: pendingCount } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        // Get today's invoices
        const today = new Date().toISOString().split('T')[0];
        const { count: todayCount } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', today);

        result.raw_material_invoices = {
          total_count: totalCount || 0,
          pending_count: pendingCount || 0,
          processed_today: todayCount || 0,
          recent: rawInvoices || []
        };
      }

      return result;
    }

    case 'get_client_info': {
      const { client_id, limit = 10 } = args;

      if (client_id) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('id', client_id)
          .maybeSingle();
        if (error) console.error('Error fetching client:', error);
        return { client: data };
      }

      const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) console.error('Error fetching clients:', error);

      const { count: totalCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      return {
        clients: clients || [],
        total_count: totalCount || 0,
        most_recent: clients?.[0] || null
      };
    }

    case 'get_supplier_info': {
      const { supplier_id, limit = 10 } = args;

      if (supplier_id) {
        const { data, error } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', supplier_id)
          .maybeSingle();
        if (error) console.error('Error fetching supplier:', error);
        return { supplier: data };
      }

      const { data: suppliers, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) console.error('Error fetching suppliers:', error);

      const { count: totalCount } = await supabase
        .from('suppliers')
        .select('*', { count: 'exact', head: true });

      return {
        suppliers: suppliers || [],
        total_count: totalCount || 0,
        vendor_names: suppliers?.map((s: any) => s.name) || []
      };
    }

    case 'get_po_stats': {
      const { status, limit = 5 } = args;

      let query = supabase
        .from('purchase_orders')
        .select('*, clients(name), suppliers(name)')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: pos, error } = await query.limit(limit);
      if (error) console.error('Error fetching POs:', error);

      const { count: totalCount } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true });

      const { count: draftCount } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'draft');

      const { count: sentCount } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent');

      // Get this week's POs
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { count: weekCount } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());

      return {
        purchase_orders: pos || [],
        total_count: totalCount || 0,
        draft_count: draftCount || 0,
        sent_count: sentCount || 0,
        uploaded_this_week: weekCount || 0
      };
    }

    case 'get_recent_activity': {
      const { activity_type, limit = 10 } = args;

      let query = supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false });

      if (activity_type) {
        query = query.eq('activity_type', activity_type);
      }

      const { data: activities, error } = await query.limit(limit);
      if (error) console.error('Error fetching activities:', error);

      // Get activities from last 10 minutes
      const tenMinutesAgo = new Date();
      tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);
      const { data: recentActivities } = await supabase
        .from('activity_log')
        .select('*')
        .gte('created_at', tenMinutesAgo.toISOString())
        .order('created_at', { ascending: false });

      return { 
        activities: activities || [],
        activities_last_10_minutes: recentActivities || []
      };
    }

    case 'get_document_stats': {
      const { status } = args;

      let query = supabase
        .from('po_intake_documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: docs, error } = await query;
      if (error) console.error('Error fetching documents:', error);

      const { count: totalCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true });

      const { count: errorCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'error');

      // Count by file type
      const fileTypes: Record<string, number> = {};
      docs?.forEach((doc: any) => {
        const type = doc.file_type || 'unknown';
        fileTypes[type] = (fileTypes[type] || 0) + 1;
      });

      return {
        documents: docs || [],
        total_count: totalCount || 0,
        error_count: errorCount || 0,
        last_uploaded: docs?.[0] || null,
        file_type_counts: fileTypes
      };
    }

    case 'get_approval_stats': {
      const { status } = args;

      let query = supabase
        .from('approvals')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: approvals, error } = await query;
      if (error) console.error('Error fetching approvals:', error);

      const { count: totalCount } = await supabase
        .from('approvals')
        .select('*', { count: 'exact', head: true });

      const { count: pendingCount } = await supabase
        .from('approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: approvedCount } = await supabase
        .from('approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      const { count: rejectedCount } = await supabase
        .from('approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected');

      return {
        approvals: approvals || [],
        total_count: totalCount || 0,
        pending_count: pendingCount || 0,
        approved_count: approvedCount || 0,
        rejected_count: rejectedCount || 0
      };
    }

    case 'get_bank_statement_stats': {
      const { include_transactions = false } = args;

      const { data: statements, error } = await supabase
        .from('bank_statements')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) console.error('Error fetching bank statements:', error);

      const result: any = {
        statements: statements || [],
        total_count: statements?.length || 0
      };

      if (include_transactions) {
        const { data: transactions } = await supabase
          .from('bank_transactions')
          .select('*')
          .order('transaction_date', { ascending: false })
          .limit(10);
        result.recent_transactions = transactions || [];
      }

      return result;
    }

    case 'get_system_summary': {
      const { count: clientCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      const { count: supplierCount } = await supabase
        .from('suppliers')
        .select('*', { count: 'exact', head: true });

      const { count: clientInvoiceCount } = await supabase
        .from('client_invoices')
        .select('*', { count: 'exact', head: true });

      const { count: rawInvoiceCount } = await supabase
        .from('raw_material_invoices')
        .select('*', { count: 'exact', head: true });

      const { count: poCount } = await supabase
        .from('purchase_orders')
        .select('*', { count: 'exact', head: true });

      const { count: documentCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true });

      const { count: approvalCount } = await supabase
        .from('approvals')
        .select('*', { count: 'exact', head: true });

      const { count: quotationCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true });

      return {
        entities: {
          clients: clientCount || 0,
          suppliers: supplierCount || 0,
          client_invoices: clientInvoiceCount || 0,
          raw_material_invoices: rawInvoiceCount || 0,
          purchase_orders: poCount || 0,
          documents: documentCount || 0,
          approvals: approvalCount || 0,
          quotations: quotationCount || 0
        },
        total_entities: (clientCount || 0) + (supplierCount || 0) + (clientInvoiceCount || 0) + 
                       (rawInvoiceCount || 0) + (poCount || 0) + (documentCount || 0) + 
                       (approvalCount || 0) + (quotationCount || 0)
      };
    }

    default:
      console.error('Unknown function:', functionName);
      return { error: 'Unknown function' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { message, conversationId } = await req.json();

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let currentConversationId = conversationId;
    let conversationHistory: any[] = [];

    if (currentConversationId) {
      const { data: existingMessages } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', currentConversationId)
        .order('created_at', { ascending: true });

      if (existingMessages) {
        conversationHistory = existingMessages.map(m => ({
          role: m.role,
          content: m.content
        }));
      }
    } else {
      currentConversationId = crypto.randomUUID();
      await supabase
        .from('conversations')
        .insert({
          id: currentConversationId,
          title: message.substring(0, 50) + (message.length > 50 ? '...' : '')
        });
    }

    await supabase
      .from('messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'user',
        content: message
      });

    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    console.log('Calling OpenAI with message:', message);

    let openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        tools: toolDefinitions,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error('OpenAI API error:', error);
      throw new Error('Failed to get response from OpenAI');
    }

    let openaiData = await openaiResponse.json();
    let assistantMessage = openaiData.choices[0].message;
    const functionCalls: any[] = [];

    console.log('Initial response:', JSON.stringify(assistantMessage));

    // Handle tool calls (modern API)
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Add assistant message with tool calls to history
      messages.push(assistantMessage);

      // Process each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments || '{}');

        console.log(`Executing tool: ${functionName}`, functionArgs);

        const functionResult = await executeFunction(functionName, functionArgs, supabase);
        functionCalls.push({
          name: functionName,
          arguments: functionArgs,
          result: functionResult
        });

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult)
        });
      }

      // Get next response from OpenAI
      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: messages,
          tools: toolDefinitions,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 1500,
        }),
      });

      if (!openaiResponse.ok) {
        const error = await openaiResponse.text();
        console.error('OpenAI API error on follow-up:', error);
        throw new Error('Failed to get follow-up response from OpenAI');
      }

      openaiData = await openaiResponse.json();
      assistantMessage = openaiData.choices[0].message;
      console.log('Follow-up response:', JSON.stringify(assistantMessage));
    }

    const responseContent = assistantMessage.content || 'I was unable to generate a response.';

    await supabase
      .from('messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'assistant',
        content: responseContent,
        function_calls: functionCalls.length > 0 ? functionCalls : null
      });

    await supabase
      .from('activity_log')
      .insert({
        activity_type: 'ai_query',
        entity_type: 'conversation',
        entity_id: currentConversationId,
        status: 'success',
        metadata: {
          message_preview: message.substring(0, 100),
          function_calls_count: functionCalls.length
        }
      });

    return new Response(
      JSON.stringify({
        conversationId: currentConversationId,
        response: responseContent,
        functionCalls: functionCalls,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in tally-ai-chat:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
