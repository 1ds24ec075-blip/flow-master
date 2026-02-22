import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Eye, CreditCard, ShoppingCart, Mail } from "lucide-react";

export interface SupplierRow {
  id: string;
  name: string;
  material_type: string | null;
  outstanding: number;
  overdue: number;
  credit_limit: number;
  credit_days: number;
  last_order_date: string | null;
  risk: "low" | "medium" | "high";
}

interface SupplierTableProps {
  suppliers: SupplierRow[];
  onViewDetails: (id: string) => void;
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const config = {
    low: { label: "🟢 Low", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
    medium: { label: "🟡 Medium", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
    high: { label: "🔴 High", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  };
  const c = config[risk];
  return <Badge className={c.className}>{c.label}</Badge>;
}

export function SupplierTable({ suppliers, onViewDetails }: SupplierTableProps) {
  const [search, setSearch] = useState("");

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.material_type || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Credit Limit</TableHead>
              <TableHead>Credit Days</TableHead>
              <TableHead>Last Order</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No suppliers found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.material_type || "-"}</TableCell>
                  <TableCell className="text-right">₹{s.outstanding.toLocaleString("en-IN")}</TableCell>
                  <TableCell className={`text-right ${s.overdue > 0 ? "text-destructive font-medium" : ""}`}>
                    ₹{s.overdue.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right">₹{s.credit_limit.toLocaleString("en-IN")}</TableCell>
                  <TableCell>{s.credit_days}d</TableCell>
                  <TableCell>{s.last_order_date || "-"}</TableCell>
                  <TableCell><RiskBadge risk={s.risk} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onViewDetails(s.id)} title="View Details">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
