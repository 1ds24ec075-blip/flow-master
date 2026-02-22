import { AlertTriangle, Clock, CreditCard, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface AlertItem {
  type: "overdue" | "credit_exceeded" | "due_soon" | "high_risk";
  message: string;
  supplierName: string;
}

const alertConfig = {
  overdue: { icon: Clock, label: "Overdue", className: "text-destructive" },
  credit_exceeded: { icon: CreditCard, label: "Credit Exceeded", className: "text-destructive" },
  due_soon: { icon: AlertTriangle, label: "Due Soon", className: "text-amber-600" },
  high_risk: { icon: TrendingDown, label: "High Risk", className: "text-destructive" },
};

export function SupplierAlerts({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return null;

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Alerts & Warnings ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {alerts.map((alert, i) => {
            const config = alertConfig[alert.type];
            const Icon = config.icon;
            return (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.className}`} />
                <div>
                  <span className="font-medium">{alert.supplierName}</span>
                  <span className="text-muted-foreground"> — {alert.message}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
