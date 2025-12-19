import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Users, Truck, Receipt, FileCheck, Clock, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface Summary {
  totalRevenue: number;
  thisMonthRevenue: number;
  revenueGrowth: number;
  pendingAmount: number;
  outstandingBills: number;
  pendingApprovals: number;
  activeClients: number;
  activeSuppliers: number;
  quotationConversion: number;
  activePOs: number;
}

interface InsightsSummaryProps {
  summary: Summary | null;
  isLoading: boolean;
}

export function InsightsSummary({ summary, isLoading }: InsightsSummaryProps) {
  if (isLoading) {
    return (
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Business Intelligence Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  const formatCurrency = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

  const metrics = [
    {
      label: 'This Month Revenue',
      value: formatCurrency(summary.thisMonthRevenue),
      icon: DollarSign,
      trend: summary.revenueGrowth,
      color: 'text-success',
    },
    {
      label: 'Pending Amount',
      value: formatCurrency(summary.pendingAmount),
      icon: Clock,
      color: 'text-warning',
    },
    {
      label: 'Outstanding Bills',
      value: formatCurrency(summary.outstandingBills),
      icon: Receipt,
      color: 'text-destructive',
    },
    {
      label: 'Active Clients',
      value: summary.activeClients.toString(),
      icon: Users,
      color: 'text-primary',
    },
    {
      label: 'Conversion Rate',
      value: `${summary.quotationConversion.toFixed(0)}%`,
      icon: FileCheck,
      color: 'text-secondary',
    },
  ];

  return (
    <Card className="col-span-full bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TrendingUp className="h-5 w-5 text-primary" />
          Business Intelligence Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div 
                key={metric.label} 
                className="bg-background rounded-lg p-4 border shadow-sm"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={cn("h-4 w-4", metric.color)} />
                  <span className="text-xs text-muted-foreground truncate">
                    {metric.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">{metric.value}</span>
                  {metric.trend !== undefined && (
                    <span className={cn(
                      "flex items-center text-xs",
                      metric.trend >= 0 ? 'text-success' : 'text-destructive'
                    )}>
                      {metric.trend >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {Math.abs(metric.trend).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
