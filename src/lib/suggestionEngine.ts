import { supabase } from "@/integrations/supabase/client";

export interface PaymentSuggestion {
  suggestedType: "ADVANCE" | "CREDIT";
  reason: string;
  riskFlag: string;
  creditDays?: number;
  creditLimit?: number;
  outstandingAmount?: number;
  hasOverdueInvoices?: boolean;
}

export async function runPaymentSuggestion(
  paymentTerms: string | null,
  customerMasterId: string | null,
  orderValue: number
): Promise<PaymentSuggestion> {
  let suggestedType: "ADVANCE" | "CREDIT" = "ADVANCE";
  let reason = "";
  let riskFlag = "NONE";
  let creditDays: number | undefined;
  let creditLimit: number | undefined;
  let outstandingAmount: number | undefined;
  let hasOverdueInvoices: boolean | undefined;

  const terms = (paymentTerms || "").toLowerCase();

  if (terms.includes("advance") || terms.includes("100% advance")) {
    suggestedType = "ADVANCE";
    reason = `PO payment terms: "${paymentTerms}"`;
  } else if (
    terms.includes("net 30") || terms.includes("30 days") ||
    terms.includes("45 days") || terms.includes("net 45") ||
    terms.includes("60 days") || terms.includes("net 60") ||
    terms.includes("credit")
  ) {
    suggestedType = "CREDIT";
    const daysMatch = terms.match(/(\d+)\s*days?/);
    creditDays = daysMatch ? parseInt(daysMatch[1]) : 30;
    reason = `PO payment terms: "${paymentTerms}" (${creditDays} days)`;
  }

  if (customerMasterId) {
    const { data: cust } = await supabase
      .from("customer_master")
      .select("payment_terms")
      .eq("id", customerMasterId)
      .maybeSingle();

    if (cust) {
      // Use payment_terms from customer master as fallback
      if (!reason && cust.payment_terms) {
        const custTerms = cust.payment_terms.toLowerCase();
        if (custTerms.includes("advance")) {
          suggestedType = "ADVANCE";
          reason = `Customer default: ${cust.payment_terms}`;
        } else if (custTerms.includes("credit") || custTerms.includes("net")) {
          suggestedType = "CREDIT";
          reason = `Customer default: ${cust.payment_terms}`;
        }
      }
    }
  }

  if (!reason) {
    reason = "No payment terms detected; defaulting to ADVANCE";
  }

  return {
    suggestedType,
    reason,
    riskFlag,
    creditDays,
    creditLimit,
    outstandingAmount,
    hasOverdueInvoices,
  };
}
