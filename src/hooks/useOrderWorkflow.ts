import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ConfirmDecision {
  orderId: string;
  paymentType: "ADVANCE" | "CREDIT";
  creditDays?: number;
  reviewedBy?: string;
}

export function useConfirmPaymentDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, paymentType, creditDays, reviewedBy }: ConfirmDecision) => {
      const now = new Date().toISOString();

      if (paymentType === "ADVANCE") {
        const piNumber = `PI-${Date.now()}`;
        const { error } = await supabase
          .from("po_orders")
          .update({
            status: "AWAITING_PAYMENT",
            updated_at: now,
          } as any)
          .eq("id", orderId);
        if (error) throw error;
        return { orderId, paymentType, piNumber };
      }

      // Fetch order details for liquidity entry
      const { data: orderData } = await supabase
        .from("po_orders")
        .select("po_number, customer_name, total_amount, currency")
        .eq("id", orderId)
        .single();

      const { error: updateError } = await supabase
        .from("po_orders")
        .update({
          status: "PAYMENT_PENDING",
          updated_at: now,
        } as any)
        .eq("id", orderId);
      if (updateError) throw updateError;

      // Calculate due date from credit days and create liquidity line item
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (creditDays || 30));
      const dueDateStr = dueDate.toISOString().split("T")[0];

      // Find or create the liquidity week that covers the due date
      const weekStart = new Date(dueDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
      const weekStartStr = weekStart.toISOString().split("T")[0];

      let weekId: string | null = null;
      const { data: existingWeek } = await supabase
        .from("weekly_liquidity")
        .select("id")
        .eq("week_start_date", weekStartStr)
        .maybeSingle();

      if (existingWeek) {
        weekId = existingWeek.id;
      } else {
        const { data: newWeek } = await supabase
          .from("weekly_liquidity")
          .upsert(
            { week_start_date: weekStartStr, opening_balance: 0, alert_threshold: 0 },
            { onConflict: "week_start_date", ignoreDuplicates: true }
          )
          .select("id")
          .maybeSingle();
        weekId = newWeek?.id || null;
      }

      if (weekId) {
        const customerName = orderData?.customer_name || "Unknown";
        const poNumber = orderData?.po_number || orderId.slice(0, 8);
        const amount = orderData?.total_amount || 0;

        await supabase.from("liquidity_line_items").insert({
          liquidity_week_id: weekId,
          item_type: "collection",
          description: `Customer: ${customerName} — PO#${poNumber} (Credit ${creditDays || 30}d)`,
          expected_amount: amount,
          linked_invoice_id: orderId,
          linked_invoice_type: "customer",
          status: "pending",
          due_date: dueDateStr,
        });
      }

      return { orderId, paymentType };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["order-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      if (data.paymentType === "ADVANCE") {
        toast.success("Proforma Invoice generated. Awaiting payment.");
      } else {
        toast.success("Credit approved. Awaiting payment before SO is sent.");
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to process: ${error.message}`);
    },
  });
}

export function useConfirmPaymentReceived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("po_orders")
        .update({
          status: "SO_CREATED",
          updated_at: now,
        } as any)
        .eq("id", orderId);
      if (updateError) throw updateError;

      try {
        await supabase.functions.invoke("send-sales-order", {
          body: { orderId },
        });
      } catch {
        console.error("SO email sending failed but payment was recorded");
      }

      return orderId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      toast.success("Payment confirmed. Sales Order created and sent.");
    },
    onError: (error: Error) => {
      toast.error(`Failed: ${error.message}`);
    },
  });
}

export function useMarkDispatched() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("po_orders")
        .update({
          status: "DISPATCHED",
          updated_at: now,
        } as any)
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      toast.success("Order marked as dispatched.");
    },
    onError: (error: Error) => {
      toast.error(`Failed: ${error.message}`);
    },
  });
}

export function useMarkPaymentComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("po_orders")
        .update({
          status: "PAYMENT_COMPLETED",
          updated_at: now,
        } as any)
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      toast.success("Payment marked complete.");
    },
    onError: (error: Error) => {
      toast.error(`Failed: ${error.message}`);
    },
  });
}
