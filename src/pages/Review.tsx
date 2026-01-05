import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, AlertTriangle, Eye, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface POOrder {
  id: string;
  po_number: string | null;
  vendor_name: string | null;
  customer_name: string | null;
  order_date: string | null;
  total_amount: number | null;
  currency: string;
  status: string;
  price_mismatch_details: any;
}

interface PriceMismatch {
  description: string;
  expected_price: number;
  actual_price: number;
  difference_percent: number;
}

export default function Review() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedOrder, setSelectedOrder] = useState<POOrder | null>(null);
  const [showMismatchDialog, setShowMismatchDialog] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["price-mismatch-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("po_orders")
        .select("*")
        .eq("status", "price_mismatch")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as POOrder[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      // Update status to processed
      const { error: updateError } = await supabase
        .from("po_orders")
        .update({ status: "processed" })
        .eq("id", orderId);
      if (updateError) throw updateError;

      // Send SO email
      const { error: emailError } = await supabase.functions.invoke(
        "send-sales-order",
        { body: { orderId } }
      );
      if (emailError) throw emailError;

      // Update status to converted
      await supabase
        .from("po_orders")
        .update({ status: "converted" })
        .eq("id", orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-mismatch-orders"] });
      queryClient.invalidateQueries({ queryKey: ["price-mismatch-count"] });
      toast.success("Order approved and SO email sent!");
    },
    onError: (error: any) => {
      toast.error(`Failed to approve: ${error.message}`);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.from("po_orders").delete().eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-mismatch-orders"] });
      queryClient.invalidateQueries({ queryKey: ["price-mismatch-count"] });
      toast.success("Order rejected and deleted");
    },
    onError: () => {
      toast.error("Failed to reject order");
    },
  });

  const getMismatches = (order: POOrder): PriceMismatch[] => {
    if (!order.price_mismatch_details) return [];
    try {
      const details =
        typeof order.price_mismatch_details === "string"
          ? JSON.parse(order.price_mismatch_details)
          : order.price_mismatch_details;
      
      // Handle both formats: mismatches array and unmatchedItems array
      const mismatches = details.mismatches || [];
      const unmatchedItems = (details.unmatchedItems || []).map((item: any) => ({
        description: item.description || item.original_product_code || 'Unknown',
        expected_price: item.expected_price || 0,
        actual_price: item.unit_price || item.actual_price || 0,
        difference_percent: item.difference_percent || 100,
        reason: item.reason || 'Price mismatch'
      }));
      
      return [...mismatches, ...unmatchedItems];
    } catch {
      return [];
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/po-dashboard")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-orange-500" />
          <div>
            <h1 className="text-3xl font-bold">Price Review Dashboard</h1>
            <p className="text-muted-foreground">
              Review orders with price mismatches
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-orange-700">
            Orders Pending Review
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-orange-600">{orders?.length || 0}</p>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : orders && orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mismatches</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const mismatches = getMismatches(order);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        {order.po_number || "-"}
                      </TableCell>
                      <TableCell>{order.vendor_name || "-"}</TableCell>
                      <TableCell>{order.customer_name || "-"}</TableCell>
                      <TableCell>
                        {order.order_date
                          ? new Date(order.order_date).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {order.currency} {order.total_amount?.toLocaleString() || "0"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-orange-600">
                          {mismatches.length} items
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedOrder(order);
                            setShowMismatchDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-green-600">
                              <Check className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Approve Order</AlertDialogTitle>
                              <AlertDialogDescription>
                                This order has price mismatches:
                                <div className="mt-4 space-y-2">
                                  {mismatches.map((m, i) => (
                                    <div
                                      key={i}
                                      className="text-sm bg-orange-50 p-2 rounded"
                                    >
                                      <p className="font-medium">{m.description}</p>
                                      <p>
                                        Expected: ₹{m.expected_price} | Actual: ₹
                                        {m.actual_price} (
                                        {m.difference_percent.toFixed(1)}% diff)
                                      </p>
                                    </div>
                                  ))}
                                </div>
                                <p className="mt-4">
                                  Are you sure you want to approve and send the SO email?
                                </p>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => approveMutation.mutate(order.id)}
                                disabled={approveMutation.isPending}
                              >
                                {approveMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Approve & Send"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive">
                              <X className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reject Order</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to reject and delete this order?
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => rejectMutation.mutate(order.id)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Reject
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No orders pending review. All prices match!
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mismatch Details Dialog */}
      <Dialog open={showMismatchDialog} onOpenChange={setShowMismatchDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Price Mismatches - {selectedOrder?.po_number}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Vendor</p>
                  <p className="font-medium">{selectedOrder.vendor_name || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Customer</p>
                  <p className="font-medium">{selectedOrder.customer_name || "-"}</p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Expected Price</TableHead>
                    <TableHead>Actual Price</TableHead>
                    <TableHead>Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getMismatches(selectedOrder).map((mismatch, index) => (
                    <TableRow key={index}>
                      <TableCell>{mismatch.description}</TableCell>
                      <TableCell>₹{mismatch.expected_price.toLocaleString()}</TableCell>
                      <TableCell>₹{mismatch.actual_price.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            mismatch.difference_percent > 0
                              ? "text-red-600"
                              : "text-green-600"
                          }
                        >
                          {mismatch.difference_percent > 0 ? "+" : ""}
                          {mismatch.difference_percent.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}