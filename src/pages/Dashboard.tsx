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
import { ValidationAlerts } from "@/components/dashboard/ValidationAlerts";
import { Link } from "react-router-dom";
import { MorningBriefCard, CashCrisisCard, LiveAgentFeed } from "@/components/dashboard/AgenticWidgets";
import { RequireCompany, useActiveCompanyId } from "@/contexts/CompanyContext";
import type { ReactNode } from "react";

/**
 * Marks a panel that is NOT filtered by the active company.
 *
 * The stat cards on this page are company-scoped; these panels are not. On a
 * multi-company account they can therefore disagree with the figures directly
 * above them, and the label exists so that disagreement reads as a known
 * limitation rather than as one of the two numbers being wrong.
 *
 * It describes what the reader is looking at, not why, so it is applied
 * uniformly even though the underlying causes differ and will be fixed at
 * different times: MorningBrief, CashCrisis, LiveAgentFeed and ValidationAlerts
 * read tables with no company_id column (a migration), while InsightsSummary
 * comes from the generate-insights edge function aggregating server-side with
 * no company filter (Phase 3). Both look identical from the user's seat.
 *
 * Delete this wrapper — not just the label — as each source is scoped.
 */
function NotCompanySpecific({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="inline-block rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Not yet company-specific
      </span>
      {children}
    </div>
  );
}

export default function Dashboard() {
  // null means no company is safely established. The stat query stays disabled
  // rather than counting across every company the caller can see.
  const activeCompanyId = useActiveCompanyId();

  const requireCompany = () => {
    if (!activeCompanyId) {
      throw new Error("No company is selected — pick one to see your figures.");
    }
    return activeCompanyId;
  };

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", activeCompanyId],
    enabled: activeCompanyId !== null,
    queryFn: async () => {
      // Narrowed to a plain string here, which is also what the generated
      // column type on .eq() expects — activeCompanyId itself is string | null.
      const companyId = requireCompany();

      const [quotations, purchaseOrders, rawMaterialInvoices, clientInvoices, approvals] = await Promise.all([
        supabase.from("quotations").select("*", { count: "exact" }).eq("company_id", companyId),
        supabase.from("purchase_orders").select("*", { count: "exact" }).eq("company_id", companyId),
        supabase.from("raw_material_invoices").select("*", { count: "exact" }).eq("company_id", companyId),
        supabase.from("client_invoices").select("*", { count: "exact" }).eq("company_id", companyId),
        supabase.from("approvals").select("*", { count: "exact" }).eq("company_id", companyId),
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
    <RequireCompany>
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

      {/* Agentic Layer: Morning Brief + Cash Crisis + Live Feed */}
      {/* Each wrapped individually rather than the grid as a whole, so the
          label sits with the panel it applies to when the row wraps on
          narrow screens. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <NotCompanySpecific>
          <MorningBriefCard />
        </NotCompanySpecific>
        <NotCompanySpecific>
          <CashCrisisCard />
        </NotCompanySpecific>
        <NotCompanySpecific>
          <LiveAgentFeed />
        </NotCompanySpecific>
      </div>

      {/* AI Summary Banner — useInsights calls the generate-insights edge
          function, which aggregates server-side with no company filter. */}
      <NotCompanySpecific>
        <InsightsSummary summary={insights?.summary || null} isLoading={insightsLoading} />
      </NotCompanySpecific>

      {/* Data Validation Alerts — reads activity_log, which has no company_id. */}
      <NotCompanySpecific>
        <ValidationAlerts />
      </NotCompanySpecific>

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
    </RequireCompany>
  );
}
