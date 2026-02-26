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
      .select("default_payment_mode, default_credit_days, credit_limit, outstanding_amount, has_overdue_invoices")
      .eq("id", customerMasterId)
      .maybeSingle();

    if (cust) {
      creditLimit = cust.credit_limit || 0;
      outstandingAmount = cust.outstanding_amount || 0;
      hasOverdueInvoices = cust.has_overdue_invoices || false;
      creditDays = creditDays || cust.default_credit_days || 30;

      if (!reason && cust.default_payment_mode) {
        suggestedType = cust.default_payment_mode as "ADVANCE" | "CREDIT";
        reason = `Customer default: ${cust.default_payment_mode}`;
      }

      if (suggestedType === "CREDIT") {
        if (creditLimit > 0 && (outstandingAmount + orderValue) > creditLimit) {
          riskFlag = "CREDIT_LIMIT_EXCEEDED";
          reason += ` | Outstanding (${outstandingAmount}) + Order (${orderValue}) > Limit (${creditLimit})`;
        }
        if (hasOverdueInvoices) {
          riskFlag = riskFlag === "CREDIT_LIMIT_EXCEEDED"
            ? "CREDIT_LIMIT_EXCEEDED_AND_OVERDUE"
            : "OVERDUE_INVOICES";
          reason += " | Customer has overdue invoices";
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
