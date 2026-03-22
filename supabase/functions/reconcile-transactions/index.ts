import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MatchResult {
  invoice_id: string;
  invoice_type: "client" | "supplier";
  invoice_number: string;
  invoice_amount: number;
  remaining_balance: number;
  entity_name: string;
  due_date: string | null;
  score: number;
  match_reasons: string[];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(" ").filter(w => w.length > 2));
  const wordsB = new Set(normalizeText(b).split(" ").filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.max(wordsA.size, wordsB.size);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, transaction_id, allocations } = await req.json();

    if (action === "suggest") {
      // Get the bank transaction
      const { data: txn, error: txnErr } = await supabase
        .from("bank_transactions")
        .select("*")
        .eq("id", transaction_id)
        .maybeSingle();

      if (txnErr || !txn) {
        return new Response(JSON.stringify({ error: "Transaction not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const txnAmount = Math.abs(txn.amount ?? 0);
      const txnDesc = txn.description ?? "";
      const txnDate = txn.transaction_date;
      const txnType = txn.transaction_type; // credit or debit

      // Fetch existing allocations for all invoices to compute remaining balances
      const { data: allAllocations } = await supabase
        .from("payment_allocations")
        .select("invoice_id, invoice_type, allocated_amount");

      const allocMap = new Map<string, number>();
      for (const a of allAllocations ?? []) {
        const key = `${a.invoice_id}:${a.invoice_type}`;
        allocMap.set(key, (allocMap.get(key) ?? 0) + (a.allocated_amount ?? 0));
      }

      // Fetch known aliases
      const { data: aliases } = await supabase
        .from("customer_aliases")
        .select("alias_name, customer_id, supplier_id, entity_type");

      const matches: MatchResult[] = [];

      // For credits → match against client invoices (receivables)
      if (txnType === "credit" || !txnType) {
        const { data: clientInvoices } = await supabase
          .from("client_invoices")
          .select("id, invoice_number, amount, created_at, client_id, clients(name)")
          .in("status", ["awaiting_approval", "approved", "pending"]);

        for (const inv of clientInvoices ?? []) {
          const invAmount = inv.amount ?? 0;
          const key = `${inv.id}:client`;
          const allocated = allocMap.get(key) ?? 0;
          const remaining = invAmount - allocated;
          if (remaining <= 0) continue;

          let score = 0;
          const reasons: string[] = [];
          const clientName = (inv.clients as any)?.name ?? "";

          // Amount matching (0-35 pts)
          const amtDiff = Math.abs(txnAmount - remaining) / Math.max(remaining, 1);
          if (amtDiff === 0) { score += 35; reasons.push("Exact amount match"); }
          else if (amtDiff < 0.02) { score += 28; reasons.push("Amount within 2%"); }
          else if (amtDiff < 0.1) { score += 18; reasons.push("Amount within 10%"); }
          else if (amtDiff < 0.3) { score += 8; reasons.push("Partial amount overlap"); }

          // Name matching (0-30 pts)
          if (clientName && txnDesc) {
            const nameScore = wordOverlap(clientName, txnDesc);
            if (nameScore > 0.5) { score += 30; reasons.push("Strong name match"); }
            else if (nameScore > 0.3) { score += 20; reasons.push("Partial name match"); }
            else if (nameScore > 0) { score += 8; reasons.push("Weak name match"); }
          }

          // Alias matching (0-25 pts)
          for (const alias of aliases ?? []) {
            if (alias.entity_type === "customer" && alias.customer_id === inv.client_id) {
              if (normalizeText(txnDesc).includes(normalizeText(alias.alias_name))) {
                score += 25;
                reasons.push(`Alias match: "${alias.alias_name}"`);
                break;
              }
            }
          }

          // Date proximity (0-10 pts)
          if (txnDate && inv.created_at) {
            const daysDiff = Math.abs(
              (new Date(txnDate).getTime() - new Date(inv.created_at).getTime()) / 86400000
            );
            if (daysDiff < 7) { score += 10; reasons.push("Within 7 days"); }
            else if (daysDiff < 30) { score += 5; reasons.push("Within 30 days"); }
          }

          if (score > 10) {
            matches.push({
              invoice_id: inv.id,
              invoice_type: "client",
              invoice_number: inv.invoice_number,
              invoice_amount: invAmount,
              remaining_balance: remaining,
              entity_name: clientName,
              due_date: inv.created_at,
              score: Math.min(score, 100),
              match_reasons: reasons,
            });
          }
        }
      }

      // For debits → match against supplier invoices (payables)
      if (txnType === "debit" || !txnType) {
        const { data: supplierInvoices } = await supabase
          .from("raw_material_invoices")
          .select("id, invoice_number, amount, due_date, supplier_id, suppliers(name)")
          .in("status", ["pending", "awaiting_approval", "approved"]);

        for (const inv of supplierInvoices ?? []) {
          const invAmount = inv.amount ?? 0;
          const key = `${inv.id}:supplier`;
          const allocated = allocMap.get(key) ?? 0;
          const remaining = invAmount - allocated;
          if (remaining <= 0) continue;

          let score = 0;
          const reasons: string[] = [];
          const supplierName = (inv.suppliers as any)?.name ?? "";

          const amtDiff = Math.abs(txnAmount - remaining) / Math.max(remaining, 1);
          if (amtDiff === 0) { score += 35; reasons.push("Exact amount match"); }
          else if (amtDiff < 0.02) { score += 28; reasons.push("Amount within 2%"); }
          else if (amtDiff < 0.1) { score += 18; reasons.push("Amount within 10%"); }
          else if (amtDiff < 0.3) { score += 8; reasons.push("Partial amount overlap"); }

          if (supplierName && txnDesc) {
            const nameScore = wordOverlap(supplierName, txnDesc);
            if (nameScore > 0.5) { score += 30; reasons.push("Strong name match"); }
            else if (nameScore > 0.3) { score += 20; reasons.push("Partial name match"); }
            else if (nameScore > 0) { score += 8; reasons.push("Weak name match"); }
          }

          for (const alias of aliases ?? []) {
            if (alias.entity_type === "supplier" && alias.supplier_id === inv.supplier_id) {
              if (normalizeText(txnDesc).includes(normalizeText(alias.alias_name))) {
                score += 25;
                reasons.push(`Alias match: "${alias.alias_name}"`);
                break;
              }
            }
          }

          if (txnDate && inv.due_date) {
            const daysDiff = Math.abs(
              (new Date(txnDate).getTime() - new Date(inv.due_date).getTime()) / 86400000
            );
            if (daysDiff < 7) { score += 10; reasons.push("Within 7 days of due date"); }
            else if (daysDiff < 30) { score += 5; reasons.push("Within 30 days of due date"); }
          }

          if (score > 10) {
            matches.push({
              invoice_id: inv.id,
              invoice_type: "supplier",
              invoice_number: inv.invoice_number,
              invoice_amount: invAmount,
              remaining_balance: remaining,
              entity_name: supplierName,
              due_date: inv.due_date,
              score: Math.min(score, 100),
              match_reasons: reasons,
            });
          }
        }

        // Also match against bills/expenses
        const { data: bills } = await supabase
          .from("bills")
          .select("id, bill_number, total_amount, bill_date, vendor_name, vendor_gst")
          .in("payment_status", ["pending", "partial"]);

        for (const bill of bills ?? []) {
          const billAmount = bill.total_amount ?? 0;
          const key = `${bill.id}:bill`;
          const allocated = allocMap.get(key) ?? 0;
          const remaining = billAmount - allocated;
          if (remaining <= 0) continue;

          let score = 0;
          const reasons: string[] = [];
          const vendorName = bill.vendor_name ?? "";

          const amtDiff = Math.abs(txnAmount - remaining) / Math.max(remaining, 1);
          if (amtDiff === 0) { score += 35; reasons.push("Exact amount match"); }
          else if (amtDiff < 0.02) { score += 28; reasons.push("Amount within 2%"); }
          else if (amtDiff < 0.1) { score += 18; reasons.push("Amount within 10%"); }
          else if (amtDiff < 0.3) { score += 8; reasons.push("Partial amount overlap"); }

          if (vendorName && txnDesc) {
            const nameScore = wordOverlap(vendorName, txnDesc);
            if (nameScore > 0.5) { score += 30; reasons.push("Strong vendor name match"); }
            else if (nameScore > 0.3) { score += 20; reasons.push("Partial vendor name match"); }
            else if (nameScore > 0) { score += 8; reasons.push("Weak vendor name match"); }
          }

          // GST number matching from narration
          if (bill.vendor_gst && txnDesc && normalizeText(txnDesc).includes(normalizeText(bill.vendor_gst))) {
            score += 20;
            reasons.push("GST number match in narration");
          }

          if (txnDate && bill.bill_date) {
            const daysDiff = Math.abs(
              (new Date(txnDate).getTime() - new Date(bill.bill_date).getTime()) / 86400000
            );
            if (daysDiff < 7) { score += 10; reasons.push("Within 7 days of bill date"); }
            else if (daysDiff < 30) { score += 5; reasons.push("Within 30 days of bill date"); }
          }

          if (score > 10) {
            matches.push({
              invoice_id: bill.id,
              invoice_type: "bill",
              invoice_number: bill.bill_number ?? `BILL-${bill.id.substring(0, 8)}`,
              invoice_amount: billAmount,
              remaining_balance: remaining,
              entity_name: vendorName,
              due_date: bill.bill_date,
              score: Math.min(score, 100),
              match_reasons: reasons,
            });
          }
        }
      }

      // Sort by score desc
      matches.sort((a, b) => b.score - a.score);

      return new Response(JSON.stringify({ transaction: txn, matches }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "confirm") {
      // Confirm allocations: { transaction_id, allocations: [{ invoice_id, invoice_type, allocated_amount }] }
      if (!transaction_id || !allocations?.length) {
        return new Response(JSON.stringify({ error: "Missing transaction_id or allocations" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get transaction details for alias learning
      const { data: txn } = await supabase
        .from("bank_transactions")
        .select("*")
        .eq("id", transaction_id)
        .maybeSingle();

      // Insert allocations
      const allocRows = allocations.map((a: any) => ({
        bank_transaction_id: transaction_id,
        invoice_id: a.invoice_id,
        invoice_type: a.invoice_type,
        allocated_amount: a.allocated_amount,
        match_score: a.match_score ?? null,
        match_method: a.match_method ?? "manual",
        confirmed_by: "user",
      }));

      const { error: allocErr } = await supabase
        .from("payment_allocations")
        .insert(allocRows);

      if (allocErr) {
        return new Response(JSON.stringify({ error: allocErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update transaction matched_status
      await supabase
        .from("bank_transactions")
        .update({ matched_status: "confirmed" })
        .eq("id", transaction_id);

      // Update ledger entry status
      await supabase
        .from("ledger_entries")
        .update({ status: "reconciled" })
        .eq("source_id", transaction_id)
        .eq("source_type", "bank_transaction");

      // Learn aliases from the description
      if (txn?.description) {
        for (const a of allocations) {
          // Get entity id from invoice
          let entityId: string | null = null;
          let entityType: string = a.invoice_type === "client" ? "customer" : "supplier";

          if (a.invoice_type === "client") {
            const { data: inv } = await supabase
              .from("client_invoices")
              .select("client_id")
              .eq("id", a.invoice_id)
              .maybeSingle();
            entityId = inv?.client_id;
          } else {
            const { data: inv } = await supabase
              .from("raw_material_invoices")
              .select("supplier_id")
              .eq("id", a.invoice_id)
              .maybeSingle();
            entityId = inv?.supplier_id;
          }

          if (entityId && txn.description.length > 3) {
            // Extract a usable alias from narration (first meaningful segment)
            const aliasName = txn.description.substring(0, 50).trim();
            
            await supabase
              .from("customer_aliases")
              .upsert(
                {
                  alias_name: aliasName,
                  customer_id: entityType === "customer" ? entityId : null,
                  supplier_id: entityType === "supplier" ? entityId : null,
                  entity_type: entityType,
                  confidence_score: 0.8,
                  source: "reconciliation",
                },
                { onConflict: "alias_name,entity_type" }
              );
          }
        }
      }

      // Update invoice statuses based on total allocations
      for (const a of allocations) {
        const { data: totalAllocs } = await supabase
          .from("payment_allocations")
          .select("allocated_amount")
          .eq("invoice_id", a.invoice_id)
          .eq("invoice_type", a.invoice_type);

        const totalAllocated = (totalAllocs ?? []).reduce((s: number, x: any) => s + (x.allocated_amount ?? 0), 0);

        if (a.invoice_type === "client") {
          const { data: inv } = await supabase
            .from("client_invoices")
            .select("amount")
            .eq("id", a.invoice_id)
            .maybeSingle();

          const invAmount = inv?.amount ?? 0;
          const newStatus = totalAllocated >= invAmount ? "paid" : "approved"; // partial keeps approved
          await supabase.from("client_invoices").update({ status: newStatus }).eq("id", a.invoice_id);
        } else {
          const { data: inv } = await supabase
            .from("raw_material_invoices")
            .select("amount")
            .eq("id", a.invoice_id)
            .maybeSingle();

          const invAmount = inv?.amount ?? 0;
          const newStatus = totalAllocated >= invAmount ? "paid" : "pending";
          await supabase.from("raw_material_invoices").update({ status: newStatus }).eq("id", a.invoice_id);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Reconciliation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
