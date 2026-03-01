import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { toast } from "sonner";
import { PackageCheck, Truck } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  sent: "bg-blue-100 text-blue-700 border-blue-300",
  acknowledged: "bg-yellow-100 text-yellow-700 border-yellow-300",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

export function OrderSentTable() {
  const queryClient = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ["reorder_requests_sent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reorder_requests")
        .select(`
          *,
          inventory_items (id, item_name, sku, unit, current_quantity),
          suppliers (name, email)
        `)
        .in("status", ["sent", "acknowledged", "confirmed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const receiveOrderMutation = useMutation({
    mutationFn: async ({ requestId, itemId, quantity }: { requestId: string; itemId: string; quantity: number }) => {
      // 1. Update reorder request status to "delivered"
      const { error: reqError } = await supabase
        .from("reorder_requests")
        .update({ status: "delivered", updated_at: new Date().toISOString() })
        .eq("id", requestId);
      if (reqError) throw reqError;

      // 2. Get current quantity and add received quantity
      const { data: item, error: fetchError } = await supabase
        .from("inventory_items")
        .select("current_quantity")
        .eq("id", itemId)
        .single();
      if (fetchError) throw fetchError;

      const newQty = (item?.current_quantity ?? 0) + quantity;
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ current_quantity: newQty, updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reorder_requests_sent"] });
      queryClient.invalidateQueries({ queryKey: ["reorder_requests"] });
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Order received! Inventory restocked successfully.");
    },
    onError: (e: any) => toast.error(e.message || "Failed to receive order"),
  });

  if (isLoading) {
    return <div className="text-center py-10 text-muted-foreground text-sm">Loading sent orders...</div>;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="text-xs font-semibold text-muted-foreground">Item</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Supplier</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Qty Ordered</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Expected Delivery</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Sent On</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(!requests || requests.length === 0) && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-10">
                <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No pending orders</p>
                <p className="text-xs mt-1">Reorder requests that have been sent will appear here</p>
              </TableCell>
            </TableRow>
          )}
          {requests?.map((req: any) => (
            <TableRow key={req.id} className="hover:bg-muted/20">
              <TableCell>
                <div>
                  <p className="font-medium text-sm">{req.inventory_items?.item_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground font-mono">{req.inventory_items?.sku}</p>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-600">
                {req.suppliers?.name ?? <span className="text-muted-foreground italic text-xs">—</span>}
              </TableCell>
              <TableCell className="text-sm font-semibold">
                {req.quantity_requested}{" "}
                <span className="font-normal text-muted-foreground text-xs">{req.inventory_items?.unit}</span>
              </TableCell>
              <TableCell className="text-xs text-slate-500">
                {req.requested_delivery_date
                  ? format(new Date(req.requested_delivery_date), "dd MMM yyyy")
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {req.created_at ? format(new Date(req.created_at), "dd MMM, hh:mm a") : "—"}
              </TableCell>
              <TableCell>
                <Badge className={`text-xs ${STATUS_COLORS[req.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  onClick={() =>
                    receiveOrderMutation.mutate({
                      requestId: req.id,
                      itemId: req.inventory_item_id,
                      quantity: req.quantity_requested,
                    })
                  }
                  disabled={receiveOrderMutation.isPending}
                  className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  <PackageCheck className="h-3.5 w-3.5" />
                  Order Received
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
