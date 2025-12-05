import { createClient } from 'npm:@supabase/supabase-js@2.86.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SYSTEM_PROMPT = `You are TallyAI, an intelligent assistant for an accounting and GST management system. You have access to real-time data from the system and can answer questions about:

- Invoices (client invoices and raw material invoices)
- Purchase Orders (POs)
- Clients and Suppliers
- Documents and uploads
- System activity and recent changes
- Bank statements and transactions
- Approvals and their status

You can query the database to provide accurate, data-driven answers. When users ask about counts, totals, recent items, or specific records, use the available functions to fetch real data.

Be helpful, professional, and precise. Always use real data from the functions instead of making assumptions.`;

const functionDefinitions = [
  {
    name: 'get_invoice_stats',
    description: 'Get statistics about invoices including counts by status, recent invoices, and totals',
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
          description: 'Number of recent invoices to return',
          default: 5
        }
      },
      required: ['invoice_type']
    }
  },
  {
    name: 'get_client_info',
    description: 'Get information about clients including recent clients and specific client details',
    parameters: {
      type: 'object',
      properties: {
        client_id: {
          type: 'string',
          description: 'Specific client ID to query (optional)'
        },
        limit: {
          type: 'number',
          description: 'Number of recent clients to return',
          default: 5
        }
      }
    }
  },
  {
    name: 'get_supplier_info',
    description: 'Get information about suppliers including recent suppliers and specific supplier details',
    parameters: {
      type: 'object',
      properties: {
        supplier_id: {
          type: 'string',
          description: 'Specific supplier ID to query (optional)'
        },
        limit: {
          type: 'number',
          description: 'Number of recent suppliers to return',
          default: 5
        }
      }
    }
  },
  {
    name: 'get_po_stats',
    description: 'Get statistics about purchase orders including counts by status and recent POs',
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
          description: 'Number of recent POs to return',
          default: 5
        }
      },
      required: ['status']
    }
  },
  {
    name: 'get_recent_activity',
    description: 'Get recent system activity including uploads, processing, and errors',
    parameters: {
      type: 'object',
      properties: {
        activity_type: {
          type: 'string',
          description: 'Filter by activity type (upload, process, extract, etc.)'
        },
        limit: {
          type: 'number',
          description: 'Number of activities to return',
          default: 10
        }
      }
    }
  },
  {
    name: 'get_document_stats',
    description: 'Get statistics about document uploads and processing',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'error', 'all'],
          description: 'Filter by document status'
        }
      }
    }
  },
  {
    name: 'get_approval_stats',
    description: 'Get statistics about approvals including pending, approved, and rejected counts',
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
  },
  {
    name: 'get_bank_statement_stats',
    description: 'Get statistics about bank statements and transactions',
    parameters: {
      type: 'object',
      properties: {
        include_transactions: {
          type: 'boolean',
          description: 'Whether to include transaction details',
          default: false
        }
      }
    }
  }
];

async function executeFunction(functionName: string, args: any, supabase: any) {
  switch (functionName) {
    case 'get_invoice_stats': {
      const { invoice_type, limit = 5 } = args;
      const result: any = { stats: {}, recent: [] };

      if (invoice_type === 'client' || invoice_type === 'all') {
        const { data: clientInvoices, error } = await supabase
          .from('client_invoices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error) {
          result.client_invoices = {
            total: clientInvoices?.length || 0,
            recent: clientInvoices || []
          };

          const { count: totalCount } = await supabase
            .from('client_invoices')
            .select('*', { count: 'exact', head: true });
          result.client_invoices.total_count = totalCount || 0;

          const { count: pendingCount } = await supabase
            .from('client_invoices')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
          result.client_invoices.pending_count = pendingCount || 0;
        }
      }

      if (invoice_type === 'raw_material' || invoice_type === 'all') {
        const { data: rawInvoices, error } = await supabase
          .from('raw_material_invoices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error) {
          result.raw_material_invoices = {
            total: rawInvoices?.length || 0,
            recent: rawInvoices || []
          };

          const { count: totalCount } = await supabase
            .from('raw_material_invoices')
            .select('*', { count: 'exact', head: true });
          result.raw_material_invoices.total_count = totalCount || 0;

          const { count: pendingCount } = await supabase
            .from('raw_material_invoices')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
          result.raw_material_invoices.pending_count = pendingCount || 0;
        }
      }

      return result;
    }

    case 'get_client_info': {
      const { client_id, limit = 5 } = args;

      if (client_id) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('id', client_id)
          .single();
        return { client: data, error };
      }

      const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      const { count: totalCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      return {
        clients: clients || [],
        total_count: totalCount || 0,
        recent_count: clients?.length || 0
      };
    }

    case 'get_supplier_info': {
      const { supplier_id, limit = 5 } = args;

      if (supplier_id) {
        const { data, error } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', supplier_id)
          .single();
        return { supplier: data, error };
      }

      const { data: suppliers, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      const { count: totalCount } = await supabase
        .from('suppliers')
        .select('*', { count: 'exact', head: true });

      return {
        suppliers: suppliers || [],
        total_count: totalCount || 0,
        recent_count: suppliers?.length || 0
      };
    }

    case 'get_po_stats': {
      const { status, limit = 5 } = args;

      let query = supabase
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: pos, error } = await query.limit(limit);

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

      return {
        purchase_orders: pos || [],
        total_count: totalCount || 0,
        draft_count: draftCount || 0,
        sent_count: sentCount || 0
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

      return { activities: activities || [] };
    }

    case 'get_document_stats': {
      const { status } = args;

      let query = supabase
        .from('po_intake_documents')
        .select('*');

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: docs, error } = await query.order('created_at', { ascending: false });

      const { count: totalCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true });

      const { count: errorCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'error');

      return {
        documents: docs || [],
        total_count: totalCount || 0,
        error_count: errorCount || 0
      };
    }

    case 'get_approval_stats': {
      const { status } = args;

      let query = supabase
        .from('approvals')
        .select('*')
        .order('created_at', { ascending: false });

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: approvals, error } = await query;

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

      return {
        approvals: approvals || [],
        total_count: totalCount || 0,
        pending_count: pendingCount || 0,
        approved_count: approvedCount || 0
      };
    }

    case 'get_bank_statement_stats': {
      const { include_transactions = false } = args;

      const { data: statements, error } = await supabase
        .from('bank_statements')
        .select('*')
        .order('created_at', { ascending: false });

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

    default:
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
      const { data: messages } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', currentConversationId)
        .order('created_at', { ascending: true });

      if (messages) {
        conversationHistory = messages.map(m => ({
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

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    let openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        functions: functionDefinitions,
        function_call: 'auto',
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

    while (assistantMessage.function_call) {
      const functionName = assistantMessage.function_call.name;
      const functionArgs = JSON.parse(assistantMessage.function_call.arguments);

      console.log(`Executing function: ${functionName}`, functionArgs);

      const functionResult = await executeFunction(functionName, functionArgs, supabase);
      functionCalls.push({
        name: functionName,
        arguments: functionArgs,
        result: functionResult
      });

      messages.push(assistantMessage);
      messages.push({
        role: 'function',
        name: functionName,
        content: JSON.stringify(functionResult)
      });

      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: messages,
          functions: functionDefinitions,
          function_call: 'auto',
          temperature: 0.7,
          max_tokens: 1500,
        }),
      });

      openaiData = await openaiResponse.json();
      assistantMessage = openaiData.choices[0].message;
    }

    await supabase
      .from('messages')
      .insert({
        conversation_id: currentConversationId,
        role: 'assistant',
        content: assistantMessage.content,
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
        response: assistantMessage.content,
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
