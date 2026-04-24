import { createClient } from "npm:@supabase/supabase-js@2.86.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [newPOs, newInvoices, newRMI, lowStock, pendingApprovals, latestForecast] = await Promise.all([
      sb.from("po_orders").select("id, po_number, customer_name, total_amount").gte("created_at", since),
      sb.from("client_invoices").select("id, invoice_number, amount, status").gte("created_at", since),
      sb.from("raw_material_invoices").select("id, invoice_number, amount, due_date").gte("created_at", since),
      sb.from("inventory_items").select("item_name, current_quantity, minimum_threshold").eq("is_active", true),
      sb.from("approvals").select("id, linked_invoice_type").eq("status", "pending"),
      sb.from("cash_forecasts").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const lowStockItems = (lowStock.data || []).filter((i: any) => i.current_quantity <= i.minimum_threshold);

    const metrics = {
      new_pos: newPOs.data?.length || 0,
      new_invoices: newInvoices.data?.length || 0,
      new_bills: newRMI.data?.length || 0,
      low_stock_count: lowStockItems.length,
      pending_approvals: pendingApprovals.data?.length || 0,
      crisis_day: latestForecast.data?.crisis_day || null,
    };

    const ctx = `
Overnight summary for an Indian MSME (last 24h):
- ${metrics.new_pos} new purchase orders received
- ${metrics.new_invoices} new client invoices created  
- ${metrics.new_bills} new supplier bills (next due: ${newRMI.data?.[0]?.due_date || 'N/A'})
- ${metrics.low_stock_count} items below reorder threshold: ${lowStockItems.slice(0, 5).map((i: any) => i.item_name).join(", ")}
- ${metrics.pending_approvals} approvals pending
- Cash forecast: ${latestForecast.data ? `Min balance ₹${latestForecast.data.projected_min_balance}, ${latestForecast.data.crisis_day ? `crisis on ${latestForecast.data.crisis_day}` : "healthy"}` : "no recent forecast"}

Generate a JSON morning brief with this exact structure:
{
  "headline": "one-line punchy headline",
  "summary": "2-3 sentence executive summary in plain English",
  "highlights": ["bullet 1", "bullet 2", "bullet 3"],
  "alerts": [{"text": "alert text", "severity": "high|medium|low"}],
  "recommendations": ["action 1", "action 2", "action 3"]
}
Use INR (₹) for amounts. Be specific and actionable. Indian business context.
`;

    let brief: any = {
      headline: "Daily Brief Ready",
      summary: "Overnight activity summary.",
      highlights: [`${metrics.new_pos} new POs`, `${metrics.new_invoices} invoices`, `${metrics.low_stock_count} low-stock items`],
      alerts: [],
      recommendations: [],
    };

    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are an MSME business advisor. Always return valid JSON only, no markdown fences." },
            { role: "user", content: ctx },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const aiJson = await aiRes.json();
      const txt = aiJson?.choices?.[0]?.message?.content;
      if (txt) brief = JSON.parse(txt);
    } catch (e) { console.error("AI brief fail", e); }

    const { data: saved } = await sb.from("morning_briefs").insert({
      headline: brief.headline,
      summary: brief.summary,
      highlights: brief.highlights || [],
      alerts: brief.alerts || [],
      recommendations: brief.recommendations || [],
      metrics,
    }).select().single();

    await sb.from("agent_activity_feed").insert({
      agent_name: "Briefing Agent",
      action: "morning_brief",
      summary: `📋 Morning brief generated: ${brief.headline}`,
      severity: "info",
      entity_type: "morning_brief",
      entity_id: saved?.id,
      metadata: metrics,
    });

    return new Response(JSON.stringify({ success: true, brief: saved }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
