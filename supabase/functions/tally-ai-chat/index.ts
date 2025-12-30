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
- Quotations - use get_quotation_stats
- Top vendors/clients by activity - use get_top_entities
- Trends and analytics - use get_trends
- System summary - use get_system_summary

When users ask about counts, totals, recent items, specific records, time-based queries (today, this week, last hour, this month), or any data question, you MUST call the appropriate function first to get real data. NEVER say you don't have access to data - you DO have access through the tools.

For general accounting/GST concepts like "What is GST?", "What is a debit note?", you can answer directly from your knowledge.

Be helpful, professional, and precise. Always base your answers on real data from the function results.`;

// Helper to get date ranges
function getDateRange(timeRange: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;

  switch (timeRange) {
    case 'last_hour':
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'yesterday':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      break;
    case 'this_week':
      const dayOfWeek = now.getDay();
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
      break;
    case 'last_week':
      const lastWeekStart = now.getDate() - now.getDay() - 7;
      start = new Date(now.getFullYear(), now.getMonth(), lastWeekStart);
      break;
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      break;
    case 'last_3_months':
      start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      break;
    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      start = new Date(0); // All time
  }

  return { start: start.toISOString(), end };
}

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_invoice_stats',
      description: 'Get statistics about invoices including counts by status, recent invoices, totals, and time-filtered data. Use this for any question about invoices, including "how many invoices today/this week/this month".',
      parameters: {
        type: 'object',
        properties: {
          invoice_type: {
            type: 'string',
            enum: ['client', 'raw_material', 'all'],
            description: 'Type of invoices to query'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_3_months', 'this_year', 'all_time'],
            description: 'Time range filter for queries'
          },
          status_filter: {
            type: 'string',
            enum: ['pending', 'awaiting_approval', 'approved', 'rejected', 'all'],
            description: 'Filter by invoice status'
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
      description: 'Get information about clients including recent clients, all clients, clients added in a time range, and specific client details.',
      parameters: {
        type: 'object',
        properties: {
          client_id: {
            type: 'string',
            description: 'Specific client ID to query (optional)'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'all_time'],
            description: 'Filter clients by when they were added'
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
      description: 'Get information about suppliers/vendors including recent suppliers, all suppliers, and specific supplier details.',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: {
            type: 'string',
            description: 'Specific supplier ID to query (optional)'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'all_time'],
            description: 'Filter suppliers by when they were added'
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
      description: 'Get statistics about purchase orders from the PO Dashboard including counts by status, time-filtered data, and recent POs. Use this for questions about POs added today, pending POs, converted POs, etc.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'processed', 'converted', 'duplicate', 'price_mismatch', 'all'],
            description: 'Filter by PO status. pending=new POs, processed=extracted, converted=sent as SO, price_mismatch=needs review'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_3_months', 'all_time'],
            description: 'Time range filter'
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
      name: 'get_quotation_stats',
      description: 'Get statistics about quotations including counts by status, recent quotations, and time-filtered data.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['draft', 'sent', 'approved', 'rejected', 'all'],
            description: 'Filter by quotation status'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'all_time'],
            description: 'Time range filter'
          },
          limit: {
            type: 'number',
            description: 'Number of recent quotations to return'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_activity',
      description: 'Get recent system activity including uploads, processing, errors, and all actions. Use for questions like "what happened recently", "actions in last 10 minutes", "show me recent activity".',
      parameters: {
        type: 'object',
        properties: {
          activity_type: {
            type: 'string',
            description: 'Filter by activity type (upload, process, extract, ai_query, approval, error, etc.)'
          },
          time_range: {
            type: 'string',
            enum: ['last_10_minutes', 'last_hour', 'today', 'yesterday', 'this_week', 'all_time'],
            description: 'Time range filter'
          },
          status_filter: {
            type: 'string',
            enum: ['success', 'error', 'pending', 'all'],
            description: 'Filter by activity status'
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
      description: 'Get statistics about document uploads and processing including counts, success rates, file types, and time-filtered data.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['uploaded', 'extracted', 'reviewed', 'tally_generated', 'error', 'all'],
            description: 'Filter by document status'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'all_time'],
            description: 'Time range filter'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_approval_stats',
      description: 'Get statistics about approvals including pending, approved, and rejected counts with time filtering.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected', 'all'],
            description: 'Filter by approval status'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'all_time'],
            description: 'Time range filter'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_statement_stats',
      description: 'Get statistics about bank statements including upload counts, parsing success/failure rates, transaction counts, and reconciliation status.',
      parameters: {
        type: 'object',
        properties: {
          include_transactions: {
            type: 'boolean',
            description: 'Whether to include recent transaction details'
          },
          time_range: {
            type: 'string',
            enum: ['last_hour', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'all_time'],
            description: 'Time range filter'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_top_entities',
      description: 'Get top entities by various metrics - top vendors by PO count, top clients by invoice count, most active uploaders, etc.',
      parameters: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: ['vendors_by_pos', 'vendors_by_invoices', 'clients_by_invoices', 'clients_by_pos', 'uploaders_by_documents'],
            description: 'What ranking to get'
          },
          limit: {
            type: 'number',
            description: 'Number of top entities to return (default 5)'
          },
          time_range: {
            type: 'string',
            enum: ['this_week', 'this_month', 'last_3_months', 'this_year', 'all_time'],
            description: 'Time range for the ranking'
          }
        },
        required: ['entity_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_trends',
      description: 'Get trend data and analytics over time - upload trends, invoice trends, activity patterns, busiest times.',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['uploads_over_time', 'invoices_over_time', 'pos_over_time', 'activity_by_hour', 'activity_by_day', 'success_rate_trend'],
            description: 'What trend to analyze'
          },
          time_range: {
            type: 'string',
            enum: ['this_week', 'this_month', 'last_3_months', 'this_year'],
            description: 'Time range for trend analysis'
          },
          granularity: {
            type: 'string',
            enum: ['hourly', 'daily', 'weekly', 'monthly'],
            description: 'How to group the data'
          }
        },
        required: ['metric']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_system_summary',
      description: 'Get an overall summary of all entities in the system including counts of clients, suppliers, invoices, POs, documents, approvals, quotations, and today\'s activity summary.',
      parameters: {
        type: 'object',
        properties: {
          include_today_summary: {
            type: 'boolean',
            description: 'Include summary of today\'s activity'
          }
        }
      }
    }
  }
];

async function executeFunction(functionName: string, args: any, supabase: any) {
  console.log(`Executing function: ${functionName} with args:`, JSON.stringify(args));
  
  switch (functionName) {
    case 'get_invoice_stats': {
      const { invoice_type, time_range = 'all_time', status_filter = 'all', limit = 5 } = args;
      const { start, end } = getDateRange(time_range);
      const result: any = {};

      if (invoice_type === 'client' || invoice_type === 'all') {
        let query = supabase
          .from('client_invoices')
          .select('*, clients(name)')
          .order('created_at', { ascending: false });

        if (time_range !== 'all_time') {
          query = query.gte('created_at', start).lte('created_at', end);
        }
        if (status_filter !== 'all') {
          query = query.eq('status', status_filter);
        }

        const { data: clientInvoices, error } = await query.limit(limit);
        if (error) console.error('Error fetching client invoices:', error);

        // Get counts
        const { count: totalCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true });

        const { count: pendingCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        const { count: awaitingApprovalCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'awaiting_approval');

        const { count: approvedCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved');

        // Get count in time range
        let timeRangeQuery = supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true });
        if (time_range !== 'all_time') {
          timeRangeQuery = timeRangeQuery.gte('created_at', start).lte('created_at', end);
        }
        const { count: timeRangeCount } = await timeRangeQuery;

        // Get today's count specifically
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const { count: todayCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        // Calculate total amount
        const { data: amountData } = await supabase
          .from('client_invoices')
          .select('amount');
        const totalAmount = amountData?.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0) || 0;

        result.client_invoices = {
          total_count: totalCount || 0,
          pending_count: pendingCount || 0,
          awaiting_approval_count: awaitingApprovalCount || 0,
          approved_count: approvedCount || 0,
          count_in_time_range: timeRangeCount || 0,
          processed_today: todayCount || 0,
          total_amount: totalAmount,
          time_range_queried: time_range,
          recent: clientInvoices || []
        };
      }

      if (invoice_type === 'raw_material' || invoice_type === 'all') {
        let query = supabase
          .from('raw_material_invoices')
          .select('*, suppliers(name)')
          .order('created_at', { ascending: false });

        if (time_range !== 'all_time') {
          query = query.gte('created_at', start).lte('created_at', end);
        }
        if (status_filter !== 'all') {
          query = query.eq('status', status_filter);
        }

        const { data: rawInvoices, error } = await query.limit(limit);
        if (error) console.error('Error fetching raw material invoices:', error);

        const { count: totalCount } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true });

        const { count: pendingCount } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        // Get count in time range
        let timeRangeQuery = supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true });
        if (time_range !== 'all_time') {
          timeRangeQuery = timeRangeQuery.gte('created_at', start).lte('created_at', end);
        }
        const { count: timeRangeCount } = await timeRangeQuery;

        // Get today's count
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const { count: todayCount } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        result.raw_material_invoices = {
          total_count: totalCount || 0,
          pending_count: pendingCount || 0,
          count_in_time_range: timeRangeCount || 0,
          processed_today: todayCount || 0,
          time_range_queried: time_range,
          recent: rawInvoices || []
        };
      }

      return result;
    }

    case 'get_client_info': {
      const { client_id, time_range = 'all_time', limit = 10 } = args;
      const { start, end } = getDateRange(time_range);

      if (client_id) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('id', client_id)
          .maybeSingle();
        if (error) console.error('Error fetching client:', error);
        
        // Get invoice count for this client
        const { count: invoiceCount } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client_id);

        return { client: data, invoice_count: invoiceCount || 0 };
      }

      let query = supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
      }

      const { data: clients, error } = await query.limit(limit);
      if (error) console.error('Error fetching clients:', error);

      const { count: totalCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      // Get count in time range
      let timeRangeQuery = supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });
      if (time_range !== 'all_time') {
        timeRangeQuery = timeRangeQuery.gte('created_at', start).lte('created_at', end);
      }
      const { count: timeRangeCount } = await timeRangeQuery;

      // Get this week's count
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const { count: thisWeekCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString());

      return {
        clients: clients || [],
        total_count: totalCount || 0,
        count_in_time_range: timeRangeCount || 0,
        added_this_week: thisWeekCount || 0,
        most_recent: clients?.[0] || null,
        time_range_queried: time_range
      };
    }

    case 'get_supplier_info': {
      const { supplier_id, time_range = 'all_time', limit = 10 } = args;
      const { start, end } = getDateRange(time_range);

      if (supplier_id) {
        const { data, error } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', supplier_id)
          .maybeSingle();
        if (error) console.error('Error fetching supplier:', error);

        // Get PO count for this supplier
        const { count: poCount } = await supabase
          .from('purchase_orders')
          .select('*', { count: 'exact', head: true })
          .eq('supplier_id', supplier_id);

        return { supplier: data, po_count: poCount || 0 };
      }

      let query = supabase
        .from('suppliers')
        .select('*')
        .order('created_at', { ascending: false });

      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
      }

      const { data: suppliers, error } = await query.limit(limit);
      if (error) console.error('Error fetching suppliers:', error);

      const { count: totalCount } = await supabase
        .from('suppliers')
        .select('*', { count: 'exact', head: true });

      return {
        suppliers: suppliers || [],
        total_count: totalCount || 0,
        vendor_names: suppliers?.map((s: any) => s.name) || [],
        most_recent: suppliers?.[0] || null,
        time_range_queried: time_range
      };
    }

    case 'get_po_stats': {
      const { status, time_range = 'all_time', limit = 5 } = args;
      const { start, end } = getDateRange(time_range);

      // Query po_orders table (PO Dashboard) - this is the main PO table
      let query = supabase
        .from('po_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
      }

      const { data: pos, error } = await query.limit(limit);
      if (error) console.error('Error fetching POs:', error);

      const { count: totalCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true });

      const { count: pendingCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: processedCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'processed');

      const { count: convertedCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'converted');

      const { count: priceMismatchCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'price_mismatch');

      // Get today's count
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const { count: todayCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart);

      // Get this week's count
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const { count: weekCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString());

      // Get this month's count
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const { count: monthCount } = await supabase
        .from('po_orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', monthStart.toISOString());

      return {
        purchase_orders: pos || [],
        total_count: totalCount || 0,
        pending_count: pendingCount || 0,
        processed_count: processedCount || 0,
        converted_count: convertedCount || 0,
        price_mismatch_count: priceMismatchCount || 0,
        uploaded_today: todayCount || 0,
        uploaded_this_week: weekCount || 0,
        uploaded_this_month: monthCount || 0,
        time_range_queried: time_range
      };
    }

    case 'get_quotation_stats': {
      const { status = 'all', time_range = 'all_time', limit = 5 } = args;
      const { start, end } = getDateRange(time_range);

      let query = supabase
        .from('quotations')
        .select('*, clients(name)')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
      }

      const { data: quotations, error } = await query.limit(limit);
      if (error) console.error('Error fetching quotations:', error);

      const { count: totalCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true });

      const { count: draftCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'draft');

      const { count: sentCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent');

      const { count: approvedCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      const { count: rejectedCount } = await supabase
        .from('quotations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected');

      // Calculate total amount
      const { data: amountData } = await supabase
        .from('quotations')
        .select('amount');
      const totalAmount = amountData?.reduce((sum: number, q: any) => sum + (q.amount || 0), 0) || 0;

      return {
        quotations: quotations || [],
        total_count: totalCount || 0,
        draft_count: draftCount || 0,
        sent_count: sentCount || 0,
        approved_count: approvedCount || 0,
        rejected_count: rejectedCount || 0,
        total_amount: totalAmount,
        most_recent: quotations?.[0] || null,
        time_range_queried: time_range
      };
    }

    case 'get_recent_activity': {
      const { activity_type, time_range = 'today', status_filter = 'all', limit = 20 } = args;

      let startDate: Date;
      if (time_range === 'last_10_minutes') {
        startDate = new Date(Date.now() - 10 * 60 * 1000);
      } else {
        const { start } = getDateRange(time_range);
        startDate = new Date(start);
      }

      let query = supabase
        .from('activity_log')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (activity_type) {
        query = query.eq('activity_type', activity_type);
      }
      if (status_filter !== 'all') {
        query = query.eq('status', status_filter);
      }

      const { data: activities, error } = await query.limit(limit);
      if (error) console.error('Error fetching activities:', error);

      // Get counts by type
      const activityCounts: Record<string, number> = {};
      activities?.forEach((a: any) => {
        activityCounts[a.activity_type] = (activityCounts[a.activity_type] || 0) + 1;
      });

      // Get error count
      const errorCount = activities?.filter((a: any) => a.status === 'error').length || 0;

      return { 
        activities: activities || [],
        total_in_range: activities?.length || 0,
        activity_counts_by_type: activityCounts,
        error_count: errorCount,
        time_range_queried: time_range
      };
    }

    case 'get_document_stats': {
      const { status = 'all', time_range = 'all_time' } = args;
      const { start, end } = getDateRange(time_range);

      let query = supabase
        .from('po_intake_documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
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

      const { count: extractedCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'extracted');

      const { count: reviewedCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'reviewed');

      // Get today's uploads
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const { count: todayCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart);

      // Get last hour's uploads
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: lastHourCount } = await supabase
        .from('po_intake_documents')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', hourAgo);

      // Count by file type
      const fileTypes: Record<string, number> = {};
      docs?.forEach((doc: any) => {
        const type = doc.file_type || 'unknown';
        fileTypes[type] = (fileTypes[type] || 0) + 1;
      });

      // Calculate success rate
      const successCount = (extractedCount || 0) + (reviewedCount || 0);
      const processedCount = successCount + (errorCount || 0);
      const successRate = processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : '100';

      return {
        documents: docs?.slice(0, 10) || [],
        total_count: totalCount || 0,
        error_count: errorCount || 0,
        extracted_count: extractedCount || 0,
        reviewed_count: reviewedCount || 0,
        uploaded_today: todayCount || 0,
        uploaded_last_hour: lastHourCount || 0,
        success_rate_percent: successRate,
        last_uploaded: docs?.[0] || null,
        file_type_counts: fileTypes,
        flagged_for_review: docs?.filter((d: any) => d.status === 'extracted').length || 0,
        time_range_queried: time_range
      };
    }

    case 'get_approval_stats': {
      const { status = 'all', time_range = 'all_time' } = args;
      const { start, end } = getDateRange(time_range);

      let query = supabase
        .from('approvals')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
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

      // Calculate approval rate
      const decidedCount = (approvedCount || 0) + (rejectedCount || 0);
      const approvalRate = decidedCount > 0 ? ((approvedCount || 0) / decidedCount * 100).toFixed(1) : '0';

      return {
        approvals: approvals?.slice(0, 10) || [],
        total_count: totalCount || 0,
        pending_count: pendingCount || 0,
        approved_count: approvedCount || 0,
        rejected_count: rejectedCount || 0,
        approval_rate_percent: approvalRate,
        time_range_queried: time_range
      };
    }

    case 'get_bank_statement_stats': {
      const { include_transactions = false, time_range = 'all_time' } = args;
      const { start, end } = getDateRange(time_range);

      let query = supabase
        .from('bank_statements')
        .select('*')
        .order('created_at', { ascending: false });

      if (time_range !== 'all_time') {
        query = query.gte('created_at', start).lte('created_at', end);
      }

      const { data: statements, error } = await supabase
        .from('bank_statements')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) console.error('Error fetching bank statements:', error);

      // Count by status
      const { count: totalCount } = await supabase
        .from('bank_statements')
        .select('*', { count: 'exact', head: true });

      const { count: pendingCount } = await supabase
        .from('bank_statements')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: processedCount } = await supabase
        .from('bank_statements')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'processed');

      const { count: errorCount } = await supabase
        .from('bank_statements')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'error');

      // Get this month's uploads
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const { count: thisMonthCount } = await supabase
        .from('bank_statements')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', monthStart.toISOString());

      // Calculate success rate
      const attemptedCount = (processedCount || 0) + (errorCount || 0);
      const successRate = attemptedCount > 0 ? ((processedCount || 0) / attemptedCount * 100).toFixed(1) : '100';

      const result: any = {
        statements: statements?.slice(0, 10) || [],
        total_count: totalCount || 0,
        pending_count: pendingCount || 0,
        processed_count: processedCount || 0,
        failed_count: errorCount || 0,
        uploaded_this_month: thisMonthCount || 0,
        parsing_success_rate_percent: successRate,
        last_uploaded: statements?.[0] || null,
        time_range_queried: time_range
      };

      if (include_transactions) {
        const { data: transactions } = await supabase
          .from('bank_transactions')
          .select('*')
          .order('transaction_date', { ascending: false })
          .limit(20);

        const { count: totalTransactions } = await supabase
          .from('bank_transactions')
          .select('*', { count: 'exact', head: true });

        // Get matched transactions count
        const { count: matchedCount } = await supabase
          .from('expense_matches')
          .select('*', { count: 'exact', head: true });

        result.recent_transactions = transactions || [];
        result.total_transactions = totalTransactions || 0;
        result.matched_transactions = matchedCount || 0;
        result.unmatched_transactions = (totalTransactions || 0) - (matchedCount || 0);
      }

      return result;
    }

    case 'get_top_entities': {
      const { entity_type, limit = 5, time_range = 'all_time' } = args;
      const { start } = getDateRange(time_range);

      switch (entity_type) {
        case 'vendors_by_pos': {
          const { data: pos } = await supabase
            .from('purchase_orders')
            .select('supplier_id, suppliers(name)');
          
          const vendorCounts: Record<string, { name: string; count: number }> = {};
          pos?.forEach((po: any) => {
            if (po.supplier_id && po.suppliers?.name) {
              if (!vendorCounts[po.supplier_id]) {
                vendorCounts[po.supplier_id] = { name: po.suppliers.name, count: 0 };
              }
              vendorCounts[po.supplier_id].count++;
            }
          });

          const sorted = Object.entries(vendorCounts)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));

          return { top_vendors_by_pos: sorted, metric: 'purchase_order_count' };
        }

        case 'vendors_by_invoices': {
          const { data: invoices } = await supabase
            .from('raw_material_invoices')
            .select('supplier_id, suppliers(name)');
          
          const vendorCounts: Record<string, { name: string; count: number }> = {};
          invoices?.forEach((inv: any) => {
            if (inv.supplier_id && inv.suppliers?.name) {
              if (!vendorCounts[inv.supplier_id]) {
                vendorCounts[inv.supplier_id] = { name: inv.suppliers.name, count: 0 };
              }
              vendorCounts[inv.supplier_id].count++;
            }
          });

          const sorted = Object.entries(vendorCounts)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));

          return { top_vendors_by_invoices: sorted, metric: 'invoice_count' };
        }

        case 'clients_by_invoices': {
          const { data: invoices } = await supabase
            .from('client_invoices')
            .select('client_id, clients(name)');
          
          const clientCounts: Record<string, { name: string; count: number }> = {};
          invoices?.forEach((inv: any) => {
            if (inv.client_id && inv.clients?.name) {
              if (!clientCounts[inv.client_id]) {
                clientCounts[inv.client_id] = { name: inv.clients.name, count: 0 };
              }
              clientCounts[inv.client_id].count++;
            }
          });

          const sorted = Object.entries(clientCounts)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));

          return { top_clients_by_invoices: sorted, metric: 'invoice_count' };
        }

        case 'clients_by_pos': {
          const { data: pos } = await supabase
            .from('purchase_orders')
            .select('client_id, clients(name)');
          
          const clientCounts: Record<string, { name: string; count: number }> = {};
          pos?.forEach((po: any) => {
            if (po.client_id && po.clients?.name) {
              if (!clientCounts[po.client_id]) {
                clientCounts[po.client_id] = { name: po.clients.name, count: 0 };
              }
              clientCounts[po.client_id].count++;
            }
          });

          const sorted = Object.entries(clientCounts)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));

          return { top_clients_by_pos: sorted, metric: 'po_count' };
        }

        case 'uploaders_by_documents': {
          const { data: docs } = await supabase
            .from('po_intake_documents')
            .select('uploaded_by');
          
          const uploaderCounts: Record<string, number> = {};
          docs?.forEach((doc: any) => {
            const uploader = doc.uploaded_by || 'unknown';
            uploaderCounts[uploader] = (uploaderCounts[uploader] || 0) + 1;
          });

          const sorted = Object.entries(uploaderCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([uploader, count]) => ({ uploader, count }));

          return { top_uploaders: sorted, metric: 'document_count' };
        }

        default:
          return { error: 'Unknown entity type' };
      }
    }

    case 'get_trends': {
      const { metric, time_range = 'this_month', granularity = 'daily' } = args;
      const { start, end } = getDateRange(time_range);

      switch (metric) {
        case 'uploads_over_time': {
          const { data: docs } = await supabase
            .from('po_intake_documents')
            .select('created_at')
            .gte('created_at', start)
            .lte('created_at', end)
            .order('created_at', { ascending: true });

          const grouped = groupByTime(docs || [], granularity);
          return { trend: grouped, metric: 'document_uploads', granularity, time_range };
        }

        case 'invoices_over_time': {
          const { data: clientInv } = await supabase
            .from('client_invoices')
            .select('created_at')
            .gte('created_at', start)
            .lte('created_at', end);

          const { data: rawInv } = await supabase
            .from('raw_material_invoices')
            .select('created_at')
            .gte('created_at', start)
            .lte('created_at', end);

          const allInvoices = [...(clientInv || []), ...(rawInv || [])];
          const grouped = groupByTime(allInvoices, granularity);
          return { trend: grouped, metric: 'total_invoices', granularity, time_range };
        }

        case 'pos_over_time': {
          const { data: pos } = await supabase
            .from('purchase_orders')
            .select('created_at')
            .gte('created_at', start)
            .lte('created_at', end);

          const grouped = groupByTime(pos || [], granularity);
          return { trend: grouped, metric: 'purchase_orders', granularity, time_range };
        }

        case 'activity_by_hour': {
          const { data: activities } = await supabase
            .from('activity_log')
            .select('created_at')
            .gte('created_at', start)
            .lte('created_at', end);

          const hourCounts: Record<number, number> = {};
          activities?.forEach((a: any) => {
            const hour = new Date(a.created_at).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
          });

          const hourlyData = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            label: `${i}:00`,
            count: hourCounts[i] || 0
          }));

          const busiestHour = hourlyData.reduce((max, h) => h.count > max.count ? h : max, hourlyData[0]);

          return { 
            activity_by_hour: hourlyData, 
            busiest_hour: busiestHour,
            time_range 
          };
        }

        case 'activity_by_day': {
          const { data: activities } = await supabase
            .from('activity_log')
            .select('created_at')
            .gte('created_at', start)
            .lte('created_at', end);

          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayCounts: Record<number, number> = {};
          activities?.forEach((a: any) => {
            const day = new Date(a.created_at).getDay();
            dayCounts[day] = (dayCounts[day] || 0) + 1;
          });

          const dailyData = dayNames.map((name, i) => ({
            day: i,
            label: name,
            count: dayCounts[i] || 0
          }));

          const busiestDay = dailyData.reduce((max, d) => d.count > max.count ? d : max, dailyData[0]);

          return { 
            activity_by_day: dailyData, 
            busiest_day: busiestDay,
            time_range 
          };
        }

        case 'success_rate_trend': {
          const { data: docs } = await supabase
            .from('po_intake_documents')
            .select('created_at, status')
            .gte('created_at', start)
            .lte('created_at', end);

          const grouped: Record<string, { success: number; error: number }> = {};
          docs?.forEach((doc: any) => {
            const key = getTimeKey(doc.created_at, granularity);
            if (!grouped[key]) {
              grouped[key] = { success: 0, error: 0 };
            }
            if (doc.status === 'error') {
              grouped[key].error++;
            } else {
              grouped[key].success++;
            }
          });

          const trend = Object.entries(grouped).map(([period, data]) => ({
            period,
            success_count: data.success,
            error_count: data.error,
            success_rate: data.success + data.error > 0 
              ? ((data.success / (data.success + data.error)) * 100).toFixed(1) 
              : '100'
          }));

          return { trend, metric: 'success_rate', granularity, time_range };
        }

        default:
          return { error: 'Unknown metric' };
      }
    }

    case 'get_system_summary': {
      const { include_today_summary = true } = args;

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

      const { count: bankStatementCount } = await supabase
        .from('bank_statements')
        .select('*', { count: 'exact', head: true });

      const result: any = {
        entities: {
          clients: clientCount || 0,
          suppliers: supplierCount || 0,
          client_invoices: clientInvoiceCount || 0,
          raw_material_invoices: rawInvoiceCount || 0,
          purchase_orders: poCount || 0,
          documents: documentCount || 0,
          approvals: approvalCount || 0,
          quotations: quotationCount || 0,
          bank_statements: bankStatementCount || 0
        },
        total_entities: (clientCount || 0) + (supplierCount || 0) + (clientInvoiceCount || 0) + 
                       (rawInvoiceCount || 0) + (poCount || 0) + (documentCount || 0) + 
                       (approvalCount || 0) + (quotationCount || 0) + (bankStatementCount || 0)
      };

      if (include_today_summary) {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

        const { count: todayClients } = await supabase
          .from('clients')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        const { count: todayClientInvoices } = await supabase
          .from('client_invoices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        const { count: todayRawInvoices } = await supabase
          .from('raw_material_invoices')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        const { count: todayPOs } = await supabase
          .from('purchase_orders')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        const { count: todayDocuments } = await supabase
          .from('po_intake_documents')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        const { count: todayActivities } = await supabase
          .from('activity_log')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', todayStart);

        result.today_summary = {
          clients_added: todayClients || 0,
          client_invoices_processed: todayClientInvoices || 0,
          raw_material_invoices_processed: todayRawInvoices || 0,
          pos_created: todayPOs || 0,
          documents_uploaded: todayDocuments || 0,
          total_activities: todayActivities || 0,
          total_invoices_today: (todayClientInvoices || 0) + (todayRawInvoices || 0)
        };
      }

      return result;
    }

    default:
      console.error('Unknown function:', functionName);
      return { error: 'Unknown function' };
  }
}

// Helper functions for trend analysis
function groupByTime(items: any[], granularity: string): any[] {
  const grouped: Record<string, number> = {};
  
  items.forEach(item => {
    const key = getTimeKey(item.created_at, granularity);
    grouped[key] = (grouped[key] || 0) + 1;
  });

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, count]) => ({ period, count }));
}

function getTimeKey(dateStr: string, granularity: string): string {
  const date = new Date(dateStr);
  
  switch (granularity) {
    case 'hourly':
      return `${date.toISOString().split('T')[0]} ${date.getHours()}:00`;
    case 'daily':
      return date.toISOString().split('T')[0];
    case 'weekly':
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      return `Week of ${weekStart.toISOString().split('T')[0]}`;
    case 'monthly':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    default:
      return date.toISOString().split('T')[0];
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
        max_tokens: 2000,
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
          max_tokens: 2000,
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
