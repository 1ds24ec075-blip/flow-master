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
  Brain,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AIInsightCard } from "@/components/dashboard/AIInsightCard";
import { AlertCard } from "@/components/dashboard/AlertCard";
import { InsightsSummary } from "@/components/dashboard/InsightsSummary";
import { useInsights } from "@/hooks/useInsights";
import { Link } from "react-router-dom";

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

  const { data: insights, isLoading: insightsLoading, refetch: refetchInsights } = useInsights();

  // Get high priority alerts first
  const sortedAlerts = insights?.alerts?.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  }) || [];

  // Get non-AI insights for display
  const businessInsights = insights?.insights?.filter(i => !i.id.startsWith('ai-rec')).slice(0, 4) || [];
  const aiRecommendations = insights?.insights?.filter(i => i.id.startsWith('ai-rec')) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="h-8 w-8 text-primary" />
            Talligence Dashboard
          </h1>
          <p className="text-muted-foreground">AI-powered business intelligence at your fingertips</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetchInsights()}
            disabled={insightsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${insightsLoading ? 'animate-spin' : ''}`} />
            Refresh Insights
          </Button>
          <Button asChild variant="default" size="sm">
            <Link to="/tally-ai">
              <Brain className="h-4 w-4 mr-2" />
              Ask TallyAI
            </Link>
          </Button>
        </div>
      </div>

      {/* AI Summary Banner */}
      <InsightsSummary summary={insights?.summary || null} isLoading={insightsLoading} />

      {/* Alerts Section */}
      {sortedAlerts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            🔔 Alerts & Notifications
            <span className="text-xs text-muted-foreground font-normal">
              ({sortedAlerts.filter(a => a.severity === 'high' || a.severity === 'critical').length} high priority)
            </span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sortedAlerts.slice(0, 6).map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Stats */}
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

      {/* AI Insights Grid */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          📊 Business Insights
        </h2>
        {insightsLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-20 mb-2" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {businessInsights.map((insight) => (
              <AIInsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        )}
      </div>

      {/* AI Recommendations */}
      {aiRecommendations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            ✨ AI Recommendations
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {aiRecommendations.map((insight) => (
              <AIInsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Track your workflow progress in real-time
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/tally-ai">View Full Activity Log →</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/quotations">New Quotation</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/purchase-orders">New PO</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/approvals">Review Approvals</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/tally-upload">Upload to Tally</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
