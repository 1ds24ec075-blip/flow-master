import { createClient } from 'npm:@supabase/supabase-js@2.86.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface InsightRequest {
  type: 'dashboard' | 'alerts' | 'trends' | 'recommendations';
}

interface Alert {
  id: string;
  type: 'overdue' | 'pending' | 'cash_flow' | 'unusual_spending' | 'recommendation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  actionUrl?: string;
  actionLabel?: string;
  entity?: string;
  amount?: number;
  dueDate?: string;
}

interface Insight {
  id: string;
  category: 'revenue' | 'expenses' | 'efficiency' | 'risk' | 'opportunity';
  title: string;
  summary: string;
  metric?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  priority: 'low' | 'medium' | 'high';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { type = 'dashboard' }: InsightRequest = await req.json();

    console.log(`Generating insights for type: ${type}`);

    // Gather data from all tables
    const [
      { data: clientInvoices },
      { data: rawMaterialInvoices },
      { data: purchaseOrders },
      { data: quotations },
      { data: approvals },
      { data: bills },
      { data: clients },
      { data: suppliers },
      { data: recentActivity }
    ] = await Promise.all([
      supabase.from('client_invoices').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('raw_material_invoices').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('quotations').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('approvals').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('bills').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('clients').select('*'),
      supabase.from('suppliers').select('*'),
      supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(50),
    ]);

    // Calculate metrics
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Invoice analysis
    const totalClientInvoiceAmount = clientInvoices?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
    const pendingClientInvoices = clientInvoices?.filter(inv => inv.status === 'pending' || inv.status === 'awaiting_approval') || [];
    const approvedClientInvoices = clientInvoices?.filter(inv => inv.status === 'approved') || [];
    
    // Bills analysis
    const unpaidBills = bills?.filter(b => b.payment_status === 'pending') || [];
    const totalUnpaidAmount = unpaidBills.reduce((sum, b) => sum + (b.total_amount || 0), 0);
    
    // PO analysis
    const draftPOs = purchaseOrders?.filter(po => po.status === 'draft') || [];
    const processingPOs = purchaseOrders?.filter(po => po.status === 'processing' || po.status === 'sent') || [];
    
    // Quotations
    const pendingQuotations = quotations?.filter(q => q.status === 'draft' || q.status === 'sent') || [];
    const approvedQuotations = quotations?.filter(q => q.status === 'approved') || [];
    
    // Approvals
    const pendingApprovals = approvals?.filter(a => a.status === 'pending') || [];

    // This month vs last month comparison
    const thisMonthInvoices = clientInvoices?.filter(inv => new Date(inv.created_at!) >= thisMonthStart) || [];
    const lastMonthInvoices = clientInvoices?.filter(inv => {
      const date = new Date(inv.created_at!);
      return date >= lastMonthStart && date <= lastMonthEnd;
    }) || [];
    
    const thisMonthRevenue = thisMonthInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const lastMonthRevenue = lastMonthInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const revenueGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100) : 0;

    // Generate alerts
    const alerts: Alert[] = [];

    // Overdue/pending approvals alert
    if (pendingApprovals.length > 0) {
      alerts.push({
        id: 'pending-approvals',
        type: 'pending',
        severity: pendingApprovals.length > 5 ? 'high' : 'medium',
        title: `${pendingApprovals.length} Pending Approvals`,
        description: `You have ${pendingApprovals.length} items awaiting your approval. Review them to keep workflows moving.`,
        actionUrl: '/approvals',
        actionLabel: 'Review Approvals'
      });
    }

    // Unpaid bills alert
    if (unpaidBills.length > 0) {
      alerts.push({
        id: 'unpaid-bills',
        type: 'overdue',
        severity: totalUnpaidAmount > 100000 ? 'high' : 'medium',
        title: `${unpaidBills.length} Unpaid Bills`,
        description: `Total outstanding: ₹${totalUnpaidAmount.toLocaleString('en-IN')}. Consider scheduling payments.`,
        actionUrl: '/bills',
        actionLabel: 'View Bills',
        amount: totalUnpaidAmount
      });
    }

    // Draft POs not sent
    if (draftPOs.length > 0) {
      alerts.push({
        id: 'draft-pos',
        type: 'pending',
        severity: 'low',
        title: `${draftPOs.length} Draft POs`,
        description: 'You have purchase orders in draft status that may need to be sent.',
        actionUrl: '/purchase-orders',
        actionLabel: 'View POs'
      });
    }

    // Pending quotations
    if (pendingQuotations.length > 0) {
      alerts.push({
        id: 'pending-quotations',
        type: 'pending',
        severity: 'low',
        title: `${pendingQuotations.length} Pending Quotations`,
        description: 'Follow up on quotations to convert them to orders.',
        actionUrl: '/quotations',
        actionLabel: 'View Quotations'
      });
    }

    // Invoices awaiting approval
    if (pendingClientInvoices.length > 0) {
      const totalPending = pendingClientInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
      alerts.push({
        id: 'pending-invoices',
        type: 'cash_flow',
        severity: totalPending > 500000 ? 'high' : 'medium',
        title: `₹${totalPending.toLocaleString('en-IN')} in Pending Invoices`,
        description: `${pendingClientInvoices.length} client invoices are pending approval.`,
        actionUrl: '/client-invoices',
        actionLabel: 'View Invoices',
        amount: totalPending
      });
    }

    // Generate insights
    const insights: Insight[] = [];

    // Revenue insight
    insights.push({
      id: 'revenue-trend',
      category: 'revenue',
      title: 'Monthly Revenue',
      summary: revenueGrowth >= 0 
        ? `Revenue is up ${revenueGrowth.toFixed(1)}% compared to last month.`
        : `Revenue is down ${Math.abs(revenueGrowth).toFixed(1)}% compared to last month.`,
      metric: `₹${thisMonthRevenue.toLocaleString('en-IN')}`,
      trend: revenueGrowth >= 0 ? 'up' : 'down',
      trendValue: `${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth.toFixed(1)}%`,
      priority: Math.abs(revenueGrowth) > 20 ? 'high' : 'medium'
    });

    // Efficiency insight
    const conversionRate = quotations && quotations.length > 0 
      ? (approvedQuotations.length / quotations.length * 100) 
      : 0;
    insights.push({
      id: 'conversion-rate',
      category: 'efficiency',
      title: 'Quotation Conversion',
      summary: `${conversionRate.toFixed(0)}% of your quotations are converted to orders.`,
      metric: `${conversionRate.toFixed(0)}%`,
      trend: conversionRate >= 50 ? 'up' : 'down',
      priority: conversionRate < 30 ? 'high' : 'low'
    });

    // Client base insight
    insights.push({
      id: 'client-base',
      category: 'opportunity',
      title: 'Client Portfolio',
      summary: `You have ${clients?.length || 0} clients with ${thisMonthInvoices.length} invoices this month.`,
      metric: `${clients?.length || 0} clients`,
      trend: 'stable',
      priority: 'low'
    });

    // Cash flow insight
    const approvedRevenue = approvedClientInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const netCashFlow = approvedRevenue - totalUnpaidAmount;
    insights.push({
      id: 'cash-flow',
      category: netCashFlow >= 0 ? 'revenue' : 'risk',
      title: 'Net Cash Position',
      summary: netCashFlow >= 0 
        ? `Positive cash flow of ₹${netCashFlow.toLocaleString('en-IN')} from approved invoices.`
        : `Cash flow gap of ₹${Math.abs(netCashFlow).toLocaleString('en-IN')}. Outstanding bills exceed approved invoices.`,
      metric: `₹${Math.abs(netCashFlow).toLocaleString('en-IN')}`,
      trend: netCashFlow >= 0 ? 'up' : 'down',
      priority: netCashFlow < 0 ? 'high' : 'medium'
    });

    // Processing efficiency
    const processingCount = processingPOs.length;
    insights.push({
      id: 'processing-pipeline',
      category: 'efficiency',
      title: 'Active Pipeline',
      summary: `${processingCount} purchase orders are currently in processing with ${suppliers?.length || 0} suppliers.`,
      metric: `${processingCount} POs`,
      trend: 'stable',
      priority: processingCount > 10 ? 'medium' : 'low'
    });

    // AI-generated recommendations using Lovable AI
    let aiRecommendations: string[] = [];
    
    if (LOVABLE_API_KEY) {
      try {
        const dataContext = {
          pendingApprovals: pendingApprovals.length,
          unpaidBills: unpaidBills.length,
          totalUnpaidAmount,
          pendingInvoices: pendingClientInvoices.length,
          revenueGrowth: revenueGrowth.toFixed(1),
          conversionRate: conversionRate.toFixed(0),
          draftPOs: draftPOs.length,
          pendingQuotations: pendingQuotations.length,
          totalClients: clients?.length || 0,
          totalSuppliers: suppliers?.length || 0,
        };

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are Talligence, a business intelligence assistant for accounting and finance. 
                Provide 3 brief, actionable recommendations based on the business data. 
                Each recommendation should be 1-2 sentences. Focus on improving cash flow, efficiency, and reducing risk.
                Return ONLY a JSON array of strings with exactly 3 recommendations. No markdown, no explanation.`
              },
              {
                role: 'user',
                content: `Analyze this business data and provide recommendations: ${JSON.stringify(dataContext)}`
              }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          try {
            // Try to parse JSON from the response
            const jsonMatch = content.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
              aiRecommendations = JSON.parse(jsonMatch[0]);
            }
          } catch (parseError) {
            console.log('Could not parse AI recommendations:', parseError);
          }
        }
      } catch (aiError) {
        console.error('Error getting AI recommendations:', aiError);
      }
    }

    // Add AI recommendations as insights
    aiRecommendations.forEach((rec, idx) => {
      insights.push({
        id: `ai-rec-${idx}`,
        category: 'opportunity',
        title: 'AI Recommendation',
        summary: rec,
        priority: 'medium'
      });
    });

    // Summary statistics
    const summary = {
      totalRevenue: totalClientInvoiceAmount,
      thisMonthRevenue,
      revenueGrowth,
      pendingAmount: pendingClientInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
      outstandingBills: totalUnpaidAmount,
      pendingApprovals: pendingApprovals.length,
      activeClients: clients?.length || 0,
      activeSuppliers: suppliers?.length || 0,
      quotationConversion: conversionRate,
      activePOs: processingPOs.length,
    };

    console.log('Generated insights:', { alertsCount: alerts.length, insightsCount: insights.length });

    return new Response(JSON.stringify({
      success: true,
      alerts,
      insights,
      summary,
      generatedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error generating insights:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
