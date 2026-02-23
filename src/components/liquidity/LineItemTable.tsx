import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { format } from "date-fns";
import { LiquidityLineItem } from "@/hooks/useLiquidity";

function formatINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

interface Props {
  items: LiquidityLineItem[];
  onMarkDone: (item: LiquidityLineItem) => void;
  onEditActual: (item: LiquidityLineItem) => void;
  onDelete: (id: string) => void;
}

export function LiquidityLineItemTable({ items, onMarkDone, onEditActual, onDelete }: Props) {
  if (items.length === 0) return <Card><CardContent className="p-8 text-center text-muted-foreground">No items yet.</CardContent></Card>;
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Payment Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              <TableCell>
                {item.item_type === "collection" ? (
                  <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400"><ArrowDownCircle className="h-3 w-3 mr-1" />In</Badge>
                ) : (
                  <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-900/20 dark:text-red-400"><ArrowUpCircle className="h-3 w-3 mr-1" />Out</Badge>
                )}
              </TableCell>
              <TableCell className="font-medium max-w-[200px] truncate" title={item.description}>{item.description}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-xs">
                  {item.linked_invoice_type === "supplier" ? "Supplier Inv" : item.linked_invoice_type === "customer" ? "Customer Inv" : "Manual"}
                </Badge>
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">{formatINR(Number(item.expected_amount))}</TableCell>
              <TableCell className="text-right whitespace-nowrap">{item.actual_amount ? formatINR(Number(item.actual_amount)) : "—"}</TableCell>
              <TableCell>{item.due_date ? format(new Date(item.due_date), "dd MMM") : "—"}</TableCell>
              <TableCell>{item.payment_date ? format(new Date(item.payment_date), "dd MMM") : "—"}</TableCell>
              <TableCell>
                <Badge variant={item.status === "completed" ? "default" : item.status === "partial" ? "secondary" : item.status === "overdue" ? "destructive" : "outline"}>
                  {item.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-1 justify-end">
                  {item.status !== "completed" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => onMarkDone(item)}>✓ Done</Button>
                      <Button size="sm" variant="ghost" onClick={() => onEditActual(item)}>Update</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(item.id)}>×</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
