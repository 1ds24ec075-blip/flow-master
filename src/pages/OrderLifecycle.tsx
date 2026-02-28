import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { OrderStatusBadge, RiskBadge } from "@/components/order-lifecycle/OrderStatusBadge";
import { PaymentDecisionDialog } from "@/components/order-lifecycle/PaymentDecisionDialog";
import {
  useConfirmPaymentDecision, useConfirmPaymentReceived, useMarkDispatched, useMarkPaymentComplete,
} from "@/hooks/useOrderWorkflow";
import {
  RefreshCw, ShieldCheck, Search, CreditCard, Banknote, CheckCircle2, Truck, Clock, ArrowLeft, FileCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface LifecycleOrder {
  id: string;
  po_number: string | null;
  customer_name: string | null;
  customer_master_id: string | null;
  total_amount: number | null;
  currency: string;
  status: string;
  payment_terms: string | null;
  order_date: string | null;
  created_at: string;
  updated_at: string;
  suggested_payment_type: string | null;
  suggestion_reason: string | null;
  risk_flag: string | null;
}

interface CustomerCredit {
  payment_terms: string | null;
}

const LIFECYCLE_STATUSES = [
  "ALL", "UNDER_REVIEW", "AWAITING_PAYMENT", "SO_CREATED", "DISPATCHED", "PAYMENT_PENDING", "PAYMENT_COMPLETED",
];

export default function OrderLifecycle() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedOrder, setSelectedOrder] = useState<LifecycleOrder | null>(null);
  const [showDecisionDialog, setShowDecisionDialog] = useState(false);

  const confirmDecision = useConfirmPaymentDecision();
  const confirmPayment = useConfirmPaymentReceived();
  const markDispatched = useMarkDispatched();
  const markPaymentComplete = useMarkPaymentComplete();

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ["order-lifecycle", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("po_orders")
        .select("*")
        .in("status", [
          "UNDER_REVIEW", "AWAITING_PAYMENT", "SO_CREATED",
          "DISPATCHED", "INVOICED", "PAYMENT_PENDING", "PAYMENT_COMPLETED",
        ])
        .order("updated_at", { ascending: false });

      if (statusFilter !== "ALL") {
        query = supabase
          .from("po_orders")
          .select("*")
          .eq("status", statusFilter)
          .order("updated_at", { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as LifecycleOrder[];
    },
    refetchInterval: 15000,
  });

  const { data: customerCredit } = useQuery({
    queryKey: ["customer-credit", selectedOrder?.customer_master_id],
    queryFn: async () => {
      if (!selectedOrder?.customer_master_id) return null;
      const { data, error } = await supabase
        .from("customer_master")
        .select("payment_terms")
        .eq("id", selectedOrder.customer_master_id)
        .maybeSingle();
      if (error) throw error;
      return data as CustomerCredit | null;
    },
    enabled: !!selectedOrder?.customer_master_id,
  });

  const stats = {
    underReview: orders?.filter((o) => o.status === "UNDER_REVIEW").length || 0,
    awaitingPayment: orders?.filter((o) => o.status === "AWAITING_PAYMENT").length || 0,
    soCreated: orders?.filter((o) => o.status === "SO_CREATED").length || 0,
    dispatched: orders?.filter((o) => o.status === "DISPATCHED").length || 0,
    completed: orders?.filter((o) => o.status === "PAYMENT_COMPLETED").length || 0,
  };

  const handleConfirmDecision = (paymentType: "ADVANCE" | "CREDIT", creditDays?: number) => {
    if (!selectedOrder) return;
    confirmDecision.mutate(
      { orderId: selectedOrder.id, paymentType, creditDays },
      {
        onSuccess: () => {
          setShowDecisionDialog(false);
          setSelectedOrder(null);
        },
      }
    );
  };

  const getActionButton = (order: LifecycleOrder) => {
    switch (order.status) {
      case "UNDER_REVIEW":
        return (
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { setSelectedOrder(order); setShowDecisionDialog(true); }}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Review & Decide
          </Button>
        );
      case "AWAITING_PAYMENT":
        return (
          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => confirmPayment.mutate(order.id)} disabled={confirmPayment.isPending}>
            <Banknote className="h-3.5 w-3.5 mr-1.5" />Confirm Payment
          </Button>
        );
      case "SO_CREATED":
        return (
          <Button size="sm" variant="outline" className="text-cyan-700 border-cyan-300 hover:bg-cyan-50" onClick={() => markDispatched.mutate(order.id)} disabled={markDispatched.isPending}>
            <Truck className="h-3.5 w-3.5 mr-1.5" />Mark Dispatched
          </Button>
        );
      case "DISPATCHED":
        return (
          <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" onClick={() => markPaymentComplete.mutate(order.id)} disabled={markPaymentComplete.isPending}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Confirm Payment
          </Button>
        );
      case "PAYMENT_COMPLETED":
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Done</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-background rounded-xl p-4 shadow-sm border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/po-dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Order Lifecycle</h1>
            <p className="text-sm text-muted-foreground">Review, confirm payment decisions, and track order progress</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Filter status" /></SelectTrigger>
            <SelectContent>
              {LIFECYCLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s === "ALL" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={Search} label="Under Review" count={stats.underReview} color="amber" />
        <StatCard icon={CreditCard} label="Awaiting Payment" count={stats.awaitingPayment} color="orange" />
        <StatCard icon={FileCheck} label="SO Created" count={stats.soCreated} color="blue" />
        <StatCard icon={Truck} label="Dispatched" count={stats.dispatched} color="cyan" />
        <StatCard icon={CheckCircle2} label="Completed" count={stats.completed} color="green" />
      </div>

      <Card className="bg-background shadow-sm border">
        <CardHeader className="pb-3">
          <CardTitle>Order Pipeline</CardTitle>
          <CardDescription>All orders requiring review or in active lifecycle</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : orders && orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-medium">PO Number</TableHead>
                  <TableHead className="font-medium">Customer</TableHead>
                  <TableHead className="font-medium">Order Value</TableHead>
                  <TableHead className="font-medium">Payment Terms</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{order.po_number || "-"}</TableCell>
                    <TableCell>{order.customer_name || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {order.currency}{" "}
                      {order.total_amount?.toLocaleString("en-IN", { minimumFractionDigits: 2 }) || "0.00"}
                    </TableCell>
                    <TableCell className="text-sm">{order.payment_terms || "-"}</TableCell>
                    <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                    <TableCell className="text-right">{getActionButton(order)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              <Clock className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No orders in lifecycle pipeline</p>
              <p className="text-sm mt-1">New POs will appear here once received and processed.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <PaymentDecisionDialog
        open={showDecisionDialog}
        onOpenChange={setShowDecisionDialog}
        order={selectedOrder}
        customerCredit={customerCredit || null}
        onConfirm={handleConfirmDecision}
        isPending={confirmDecision.isPending}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, count, color }: { icon: React.ElementType; label: string; count: number; color: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    amber: { bg: "bg-amber-100", text: "text-amber-600" },
    orange: { bg: "bg-orange-100", text: "text-orange-600" },
    blue: { bg: "bg-blue-100", text: "text-blue-600" },
    cyan: { bg: "bg-cyan-100", text: "text-cyan-600" },
    green: { bg: "bg-green-100", text: "text-green-600" },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <Card className="bg-background shadow-sm border">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg ${c.bg} flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${c.text}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{count}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
