import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

function formatINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

function BalanceCard({ title, value, icon: Icon, subtitle }: { title: string; value: number; icon: any; subtitle?: string }) {
  const isNeg = value < 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn("h-5 w-5", isNeg ? "text-destructive" : "text-emerald-600")} />
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", isNeg ? "text-destructive" : "text-emerald-600")}>{formatINR(value)}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

interface Props {
  liq: {
    openingBalance: number;
    projectedEndBalance: number;
    totalExpectedCollections: number;
    totalScheduledPayments: number;
    actualBalance: number;
    totalActualCollections: number;
    totalActualPayments: number;
  };
}

export function LiquidityBalanceCards({ liq }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <BalanceCard title="Opening Balance" value={liq.openingBalance} icon={DollarSign} />
      <BalanceCard title="Projected End Balance" value={liq.projectedEndBalance} icon={TrendingUp} subtitle={`Collections: ${formatINR(liq.totalExpectedCollections)} | Payments: ${formatINR(liq.totalScheduledPayments)}`} />
      <BalanceCard title="Actual Balance" value={liq.actualBalance} icon={Wallet} subtitle={`In: ${formatINR(liq.totalActualCollections)} | Out: ${formatINR(liq.totalActualPayments)}`} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Variance</CardTitle>
          {liq.actualBalance >= liq.projectedEndBalance ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", (liq.actualBalance - liq.projectedEndBalance) >= 0 ? "text-emerald-600" : "text-destructive")}>
            {formatINR(liq.actualBalance - liq.projectedEndBalance)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Actual vs Projected</p>
        </CardContent>
      </Card>
    </div>
  );
}
