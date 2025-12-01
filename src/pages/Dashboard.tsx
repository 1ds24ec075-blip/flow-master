import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/StatCard";
import {
  FileText,
  ShoppingCart,
  Receipt,
  FileCheck,
  CheckCircle,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [quotations, purchaseOrders, rawMaterialInvoices, clientInvoices, approvals] = await Promise.all([
        supabase.from("quotations").select("*", { count: "exact" }),
        supabase.from("purchase_orders").select("*", { count: "exact" }),
        supabase.from("raw_material_invoices").select("*", { count: "exact" }),
        supabase.from("client_invoices").select("*", { count: "exact" }),
        supabase.from("approvals").select("*", { count: "exact" }),
      ]);

      const pendingQuotations = quotations.data?.filter((q) => q.status === "draft" || q.status === "sent").length || 0;
      const pendingPOs = purchaseOrders.data?.filter((po) => po.status === "draft" || po.status === "sent").length || 0;
      const pendingRawInvoices = rawMaterialInvoices.data?.filter((inv) => inv.status === "pending").length || 0;
      const pendingClientInvoices = clientInvoices.data?.filter((inv) => inv.status === "awaiting_approval").length || 0;
      const pendingApprovals = approvals.data?.filter((app) => app.status === "pending").length || 0;
      const readyForTally = clientInvoices.data?.filter((inv) => inv.status === "approved" && !inv.tally_uploaded).length || 0;

      return {
        quotations: quotations.count || 0,
        pendingQuotations,
        purchaseOrders: purchaseOrders.count || 0,
        pendingPOs,
        rawMaterialInvoices: rawMaterialInvoices.count || 0,
        pendingRawInvoices,
        clientInvoices: clientInvoices.count || 0,
        pendingClientInvoices,
        approvals: approvals.count || 0,
        pendingApprovals,
        readyForTally,
      };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your workflow system</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Quotations"
          value={stats?.quotations || 0}
          icon={FileText}
          description={`${stats?.pendingQuotations || 0} pending`}
        />
        <StatCard
          title="Purchase Orders"
          value={stats?.purchaseOrders || 0}
          icon={ShoppingCart}
          description={`${stats?.pendingPOs || 0} in progress`}
        />
        <StatCard
          title="Raw Material Invoices"
          value={stats?.rawMaterialInvoices || 0}
          icon={Receipt}
          description={`${stats?.pendingRawInvoices || 0} pending approval`}
        />
        <StatCard
          title="Client Invoices"
          value={stats?.clientInvoices || 0}
          icon={FileCheck}
          description={`${stats?.pendingClientInvoices || 0} awaiting approval`}
        />
        <StatCard
          title="Pending Approvals"
          value={stats?.pendingApprovals || 0}
          icon={CheckCircle}
          description="Requires attention"
        />
        <StatCard
          title="Ready for Tally"
          value={stats?.readyForTally || 0}
          icon={Upload}
          description="Approved invoices"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Track your workflow progress in real-time
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Common tasks for quick access
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
