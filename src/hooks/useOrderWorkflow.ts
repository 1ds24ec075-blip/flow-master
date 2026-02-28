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

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (creditDays || 30));

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
        toast.success("Sales Order created and sent.");
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
