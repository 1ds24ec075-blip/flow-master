import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, IndianRupee, AlertTriangle, CalendarClock, TrendingDown } from "lucide-react";

interface SummaryData {
  totalActive: number;
  totalPayables: number;
  overdueAmount: number;
  dueThisWeek: number;
  riskSuppliers: number;
}

export function SupplierSummaryCards({ data }: { data: SummaryData }) {
  const cards = [
    { title: "Active Suppliers", value: data.totalActive, icon: Users, format: "number" },
    { title: "Total Payables", value: data.totalPayables, icon: IndianRupee, format: "currency" },
    { title: "Overdue Amount", value: data.overdueAmount, icon: AlertTriangle, format: "currency", danger: data.overdueAmount > 0 },
    { title: "Due This Week", value: data.dueThisWeek, icon: CalendarClock, format: "number" },
    { title: "At-Risk Suppliers", value: data.riskSuppliers, icon: TrendingDown, format: "number", danger: data.riskSuppliers > 0 },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card) => (
        <Card key={card.title} className={card.danger ? "border-destructive/50" : ""}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
            <card.icon className={`h-4 w-4 ${card.danger ? "text-destructive" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${card.danger ? "text-destructive" : ""}`}>
              {card.format === "currency" ? `₹${card.value.toLocaleString("en-IN")}` : card.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
