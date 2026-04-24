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
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = 30;

    // Opening balance from latest weekly_liquidity
    const { data: latestWeek } = await sb
      .from("weekly_liquidity")
      .select("opening_balance")
      .order("week_start_date", { ascending: false })
      .limit(1).maybeSingle();
    const opening = Number(latestWeek?.opening_balance ?? 0);

    // Outflows: pending supplier invoices with due_date in next 30 days
    const horizonDate = new Date(today.getTime() + horizon * 86400000);
    const { data: payables } = await sb
      .from("raw_material_invoices")
      .select("amount, due_date, invoice_number, supplier_id, suppliers(name)")
      .in("status", ["pending", "awaiting_approval", "approved"])
      .gte("due_date", today.toISOString().split("T")[0])
      .lte("due_date", horizonDate.toISOString().split("T")[0]);

    // Inflows: client invoices awaiting payment (we approximate due as created_at + 30)
    const { data: receivables } = await sb
      .from("client_invoices")
      .select("amount, created_at, invoice_number, client_id, clients(name)")
      .in("status", ["approved", "awaiting_approval"]);

    // Build daily map
    const daily: Record<string, { in: number; out: number; events: any[] }> = {};
    for (let i = 0; i < horizon; i++) {
      const d = new Date(today.getTime() + i * 86400000).toISOString().split("T")[0];
      daily[d] = { in: 0, out: 0, events: [] };
    }
    (payables || []).forEach((p: any) => {
      const d = p.due_date;
      if (daily[d]) {
        daily[d].out += Number(p.amount || 0);
        daily[d].events.push({ type: "payment", desc: `${p.suppliers?.name || "Supplier"} #${p.invoice_number}`, amount: Number(p.amount || 0) });
      }
    });
    (receivables || []).forEach((r: any) => {
      const created = new Date(r.created_at);
      const expected = new Date(created.getTime() + 30 * 86400000).toISOString().split("T")[0];
      if (daily[expected]) {
        daily[expected].in += Number(r.amount || 0);
        daily[expected].events.push({ type: "collection", desc: `${r.clients?.name || "Client"} #${r.invoice_number}`, amount: Number(r.amount || 0) });
      }
    });

    // Project running balance
    let bal = opening;
    let minBal = opening;
    let crisisDay: string | null = null;
    const breakdown: any[] = [];
    let totalIn = 0, totalOut = 0;
    Object.keys(daily).sort().forEach(d => {
      bal += daily[d].in - daily[d].out;
      totalIn += daily[d].in; totalOut += daily[d].out;
      if (bal < minBal) minBal = bal;
      if (bal < 0 && !crisisDay) crisisDay = d;
      breakdown.push({ date: d, inflow: daily[d].in, outflow: daily[d].out, balance: bal, events: daily[d].events });
    });

    const severity = crisisDay ? (minBal < -100000 ? "critical" : "high") : (minBal < opening * 0.2 ? "medium" : "none");

    // AI recommendation
    let recommendation = "";
    try {
      const ctx = `Opening: ₹${opening}. Next 30 days: inflows ₹${totalIn}, outflows ₹${totalOut}. Min projected: ₹${minBal}. ${crisisDay ? `Crisis on ${crisisDay}.` : "No crisis predicted."}`;
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are a CFO advisor for an Indian MSME. Reply in 2-3 short sentences with concrete actions in INR." },
            { role: "user", content: ctx },
          ],
        }),
      });
      const aiJson = await aiRes.json();
      recommendation = aiJson?.choices?.[0]?.message?.content || "";
    } catch (e) { console.error("AI rec failed", e); }

    const { data: forecast } = await sb.from("cash_forecasts").insert({
      opening_balance: opening,
      total_inflows: totalIn,
      total_outflows: totalOut,
      projected_min_balance: minBal,
      crisis_day: crisisDay,
      crisis_severity: severity,
      daily_breakdown: breakdown,
      ai_recommendation: recommendation,
    }).select().single();

    await sb.from("agent_activity_feed").insert({
      agent_name: "CFO Agent",
      action: "cash_forecast",
      summary: crisisDay
        ? `⚠️ Cash crisis predicted on ${crisisDay}. Min balance ₹${minBal.toLocaleString("en-IN")}.`
        : `✅ Cash flow healthy. Min balance ₹${minBal.toLocaleString("en-IN")} over next 30 days.`,
      severity: severity === "critical" || severity === "high" ? "critical" : "info",
      entity_type: "cash_forecast",
      entity_id: forecast?.id,
      metadata: { crisis_day: crisisDay, min_balance: minBal },
    });

    return new Response(JSON.stringify({ success: true, forecast }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
