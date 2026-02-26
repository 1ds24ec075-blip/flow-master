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
            payment_type: "ADVANCE",
            status: "AWAITING_PAYMENT",
            review_decision_by: reviewedBy || "admin",
            review_decision_at: now,
            proforma_invoice_number: piNumber,
            updated_at: now,
          })
          .eq("id", orderId);
        if (error) throw error;
        return { orderId, paymentType, piNumber };
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (creditDays || 30));

      const { error: updateError } = await supabase
        .from("po_orders")
        .update({
          payment_type: "CREDIT",
          status: "SO_CREATED",
          review_decision_by: reviewedBy || "admin",
          review_decision_at: now,
          due_date: dueDate.toISOString().split("T")[0],
          updated_at: now,
        })
        .eq("id", orderId);
      if (updateError) throw updateError;

      const { data: order } = await supabase
        .from("po_orders")
        .select("customer_name, customer_master_id, total_amount, po_number")
        .eq("id", orderId)
        .maybeSingle();

      if (order) {
        const soNumber = `SO-${order.po_number?.replace(/^PO-?/i, "") || Date.now()}`;
        await supabase.from("accounts_receivable").insert({
          po_order_id: orderId,
          customer_master_id: order.customer_master_id,
          customer_name: order.customer_name || "Unknown",
          invoice_number: soNumber,
          order_value: order.total_amount || 0,
          due_date: dueDate.toISOString().split("T")[0],
          status: "PAYMENT_PENDING",
        });

        await supabase
          .from("po_orders")
          .update({ ar_entry_created: true })
          .eq("id", orderId);
      }

      try {
        await supabase.functions.invoke("send-sales-order", {
          body: { orderId },
        });
      } catch {
        console.error("SO email sending failed but order was processed");
      }

      return { orderId, paymentType };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["order-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      if (data.paymentType === "ADVANCE") {
        toast.success("Proforma Invoice generated. Awaiting payment.");
      } else {
        toast.success("Sales Order created and sent. AR entry recorded.");
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
          payment_received_at: now,
          updated_at: now,
        })
        .eq("id", orderId);
      if (updateError) throw updateError;

      const { data: order } = await supabase
        .from("po_orders")
        .select("customer_name, customer_master_id, total_amount, po_number")
        .eq("id", orderId)
        .maybeSingle();

      if (order) {
        const soNumber = `SO-${order.po_number?.replace(/^PO-?/i, "") || Date.now()}`;
        await supabase.from("accounts_receivable").insert({
          po_order_id: orderId,
          customer_master_id: order.customer_master_id,
          customer_name: order.customer_name || "Unknown",
          invoice_number: soNumber,
          order_value: order.total_amount || 0,
          due_date: new Date().toISOString().split("T")[0],
          paid_amount: order.total_amount || 0,
          status: "PAYMENT_COMPLETED",
        });

        await supabase
          .from("po_orders")
          .update({ ar_entry_created: true })
          .eq("id", orderId);
      }

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
          dispatched_at: now,
          updated_at: now,
        })
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
          payment_received_at: now,
          updated_at: now,
        })
        .eq("id", orderId);
      if (error) throw error;

      await supabase
        .from("accounts_receivable")
        .update({ status: "PAYMENT_COMPLETED", paid_amount: 0, updated_at: now })
        .eq("po_order_id", orderId);
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
