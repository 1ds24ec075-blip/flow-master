import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600 border-slate-300",
  sent: "bg-blue-100 text-blue-700 border-blue-300",
  acknowledged: "bg-yellow-100 text-yellow-700 border-yellow-300",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-300",
  delivered: "bg-teal-100 text-teal-700 border-teal-300",
};

export function ReorderHistory() {
  const queryClient = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ["reorder_requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reorder_requests")
        .select(`
          *,
          inventory_items (item_name, sku, unit),
          suppliers (name, email)
        `)
        .order("triggered_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("reorder_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reorder_requests"] });
      toast.success("Status updated");
    },
    onError: () => toast.error("Failed to update status"),
  });

  if (isLoading) {
    return <div className="text-center py-10 text-muted-foreground text-sm">Loading reorder history...</div>;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="text-xs font-semibold text-muted-foreground">Item</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Supplier</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Qty Ordered</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Delivery Date</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Triggered</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(!requests || requests.length === 0) && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-10">
                No reorder requests yet.
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
                {req.quantity_requested} <span className="font-normal text-muted-foreground text-xs">{req.inventory_items?.unit}</span>
              </TableCell>
              <TableCell className="text-xs text-slate-500">
                {req.requested_delivery_date
                  ? format(new Date(req.requested_delivery_date), "dd MMM yyyy")
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {req.triggered_at ? format(new Date(req.triggered_at), "dd MMM, hh:mm a") : "—"}
              </TableCell>
              <TableCell>
                <Select
                  value={req.status}
                  onValueChange={(val) => updateStatus.mutate({ id: req.id, status: val })}
                >
                  <SelectTrigger className={`h-7 text-xs w-32 border ${STATUS_COLORS[req.status] ?? ""}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["pending", "sent", "acknowledged", "confirmed", "delivered"].map((s) => (
                      <SelectItem key={s} value={s} className="text-xs capitalize">
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
