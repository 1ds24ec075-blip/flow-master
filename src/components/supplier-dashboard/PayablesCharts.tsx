import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface AgingData {
  range: string;
  amount: number;
}

interface SupplierSpend {
  name: string;
  amount: number;
}

interface PayablesChartsProps {
  agingData: AgingData[];
  topSuppliers: SupplierSpend[];
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--secondary))",
  "hsl(var(--muted-foreground))",
  "hsl(var(--destructive))",
];

export function PayablesCharts({ agingData, topSuppliers }: PayablesChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Payables Aging</CardTitle>
        </CardHeader>
        <CardContent>
          {agingData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={agingData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "Amount"]} />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No payables data yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top 5 Supplier Spend</CardTitle>
        </CardHeader>
        <CardContent>
          {topSuppliers.length > 0 ? (
            <div className="space-y-3">
              {topSuppliers.map((s, i) => (
                <div key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-sm truncate max-w-[160px]">{s.name}</span>
                  </div>
                  <span className="text-sm font-medium">₹{s.amount.toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No supplier data yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
