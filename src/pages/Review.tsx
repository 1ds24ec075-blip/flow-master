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
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, AlertTriangle, Eye, Check, X, Loader2, Calendar, Send } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface POOrder {
  id: string;
  po_number: string | null;
  vendor_name: string | null;
  customer_name: string | null;
  order_date: string | null;
  delivery_date: string | null;
  total_amount: number | null;
  currency: string;
  status: string;
  price_mismatch_details: any;
}

interface DeliveryDateIssue {
  delivery_date: string;
  order_date: string;
  days_difference: number;
  reason: string;
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
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [editedDeliveryDate, setEditedDeliveryDate] = useState("");

  const { data: orders, isLoading } = useQuery({
    queryKey: ["review-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("po_orders")
        .select("*")
        .in("status", ["price_mismatch", "delivery_date_issue"])
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
      queryClient.invalidateQueries({ queryKey: ["review-orders"] });
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
      queryClient.invalidateQueries({ queryKey: ["review-orders"] });
      queryClient.invalidateQueries({ queryKey: ["price-mismatch-count"] });
      toast.success("Order rejected and deleted");
    },
    onError: () => {
      toast.error("Failed to reject order");
    },
  });

  const sendWithDateMutation = useMutation({
    mutationFn: async ({ orderId, deliveryDate }: { orderId: string; deliveryDate: string }) => {
      // Update delivery date first
      const { error: updateError } = await supabase
        .from("po_orders")
        .update({ delivery_date: deliveryDate, status: "processed" })
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
      queryClient.invalidateQueries({ queryKey: ["review-orders"] });
      queryClient.invalidateQueries({ queryKey: ["price-mismatch-count"] });
      toast.success("Delivery date updated and SO email sent!");
      setShowSendDialog(false);
      setSelectedOrder(null);
    },
    onError: (error: any) => {
      toast.error(`Failed to send: ${error.message}`);
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

  const getDeliveryDateIssue = (order: POOrder): DeliveryDateIssue | null => {
    if (!order.price_mismatch_details) return null;
    try {
      const details =
        typeof order.price_mismatch_details === "string"
          ? JSON.parse(order.price_mismatch_details)
          : order.price_mismatch_details;
      return details.deliveryDateIssue || null;
    } catch {
      return null;
    }
  };

  const getIssueTypes = (order: POOrder): string[] => {
    const issues: string[] = [];
    const mismatches = getMismatches(order);
    const deliveryIssue = getDeliveryDateIssue(order);
    if (mismatches.length > 0) issues.push("price");
    if (deliveryIssue) issues.push("delivery");
    return issues;
  };

  const openSendDialog = (order: POOrder) => {
    setSelectedOrder(order);
    setEditedDeliveryDate(order.delivery_date || "");
    setShowSendDialog(true);
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
            <h1 className="text-3xl font-bold">Order Review Dashboard</h1>
            <p className="text-muted-foreground">
              Review orders with price mismatches or delivery date issues
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
                  <TableHead>Order Date</TableHead>
                  <TableHead>Delivery Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const mismatches = getMismatches(order);
                  const deliveryIssue = getDeliveryDateIssue(order);
                  const issueTypes = getIssueTypes(order);
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
                        <div className="flex items-center gap-2">
                          {order.delivery_date
                            ? new Date(order.delivery_date).toLocaleDateString()
                            : "-"}
                          {deliveryIssue && (
                            <Badge variant="outline" className="text-red-600 text-xs">
                              {deliveryIssue.days_difference} days
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {order.currency} {order.total_amount?.toLocaleString() || "0"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {issueTypes.includes("price") && (
                            <Badge variant="outline" className="text-orange-600">
                              {mismatches.length} price
                            </Badge>
                          )}
                          {issueTypes.includes("delivery") && (
                            <Badge variant="outline" className="text-red-600">
                              <Calendar className="h-3 w-3 mr-1" />
                              &gt;30 days
                            </Badge>
                          )}
                        </div>
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

                        {/* Send SO button - opens dialog to edit date */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-blue-600"
                          onClick={() => openSendDialog(order)}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Send SO
                        </Button>

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
              No orders pending review. All checks passed!
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mismatch Details Dialog */}
      <Dialog open={showMismatchDialog} onOpenChange={setShowMismatchDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Order Issues - {selectedOrder?.po_number}
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

              {/* Delivery Date Issue */}
              {getDeliveryDateIssue(selectedOrder) && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                    <Calendar className="h-4 w-4" />
                    Delivery Date Issue
                  </div>
                  <p className="text-sm text-red-600">
                    {getDeliveryDateIssue(selectedOrder)?.reason}
                  </p>
                  <div className="mt-2 text-sm text-red-600">
                    <p>Order Date: {new Date(getDeliveryDateIssue(selectedOrder)?.order_date || "").toLocaleDateString()}</p>
                    <p>Delivery Date: {new Date(getDeliveryDateIssue(selectedOrder)?.delivery_date || "").toLocaleDateString()}</p>
                  </div>
                </div>
              )}

              {/* Price Mismatches */}
              {getMismatches(selectedOrder).length > 0 && (
                <>
                  <h3 className="font-medium text-orange-700">Price Mismatches</h3>
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
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send SO Dialog with Date Edit */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Send Sales Order - {selectedOrder?.po_number}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="text-sm space-y-2">
                <p><span className="text-muted-foreground">Customer:</span> {selectedOrder.customer_name || "-"}</p>
                <p><span className="text-muted-foreground">Amount:</span> {selectedOrder.currency} {selectedOrder.total_amount?.toLocaleString()}</p>
              </div>

              {/* Show issues summary */}
              {getDeliveryDateIssue(selectedOrder) && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                  <p className="text-red-700 font-medium">⚠️ Delivery date exceeds 30 days</p>
                  <p className="text-red-600 text-xs mt-1">
                    Original: {new Date(selectedOrder.delivery_date || "").toLocaleDateString()} 
                    ({getDeliveryDateIssue(selectedOrder)?.days_difference} days from order)
                  </p>
                </div>
              )}

              {getMismatches(selectedOrder).length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm">
                  <p className="text-orange-700 font-medium">⚠️ {getMismatches(selectedOrder).length} price mismatch(es)</p>
                </div>
              )}

              {/* Editable Delivery Date */}
              <div className="space-y-2">
                <Label htmlFor="deliveryDate">Delivery Date (editable before sending)</Label>
                <Input
                  id="deliveryDate"
                  type="date"
                  value={editedDeliveryDate}
                  onChange={(e) => setEditedDeliveryDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Adjust the delivery date if needed before sending the SO.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedOrder) {
                  sendWithDateMutation.mutate({
                    orderId: selectedOrder.id,
                    deliveryDate: editedDeliveryDate,
                  });
                }
              }}
              disabled={sendWithDateMutation.isPending}
            >
              {sendWithDateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send SO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}