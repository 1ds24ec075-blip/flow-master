import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RefreshCw, AlertTriangle, CheckCircle, Edit, Trash2 } from "lucide-react";
import type { InventoryItem } from "./ReorderConfirmDialog";

interface InventoryTableProps {
  items: InventoryItem[];
  onReorder: (item: InventoryItem) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
}

function StockBadge({ item }: { item: InventoryItem }) {
  if (item.current_quantity === 0) {
    return <Badge className="bg-red-100 text-red-700 border-red-300 text-xs">Out of Stock</Badge>;
  }
  if (item.current_quantity < item.minimum_threshold) {
    const pct = item.current_quantity / item.minimum_threshold;
    if (pct < 0.5) {
      return <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs">Critical Low</Badge>;
    }
    return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300 text-xs">Low Stock</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs">OK</Badge>;
}

export function InventoryTable({ items, onReorder, onEdit, onDelete }: InventoryTableProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="text-xs font-semibold text-muted-foreground">Item</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">SKU</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Stock Level</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Supplier</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs font-semibold text-muted-foreground text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-10">
                No inventory items found. Add your first item to get started.
              </TableCell>
            </TableRow>
          )}
          {items.map((item) => {
            const isLow = item.current_quantity < item.minimum_threshold;
            const pct = item.minimum_threshold > 0
              ? Math.min(100, (item.current_quantity / item.minimum_threshold) * 100)
              : 100;

            return (
              <TableRow
                key={item.id}
                className={isLow ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-muted/20"}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    {isLow && <AlertTriangle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />}
                    <span className="font-medium text-sm">{item.item_name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{item.sku}</TableCell>
                <TableCell>
                  <div className="space-y-1 min-w-[120px]">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-semibold ${item.current_quantity === 0 ? "text-red-600" : isLow ? "text-orange-600" : "text-slate-700"}`}>
                        {item.current_quantity} {item.unit}
                      </span>
                      <span className="text-muted-foreground">min {item.minimum_threshold}</span>
                    </div>
                    <Progress
                      value={pct}
                      className={`h-1.5 ${item.current_quantity === 0 ? "[&>div]:bg-red-500" : isLow ? "[&>div]:bg-orange-400" : "[&>div]:bg-emerald-500"}`}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {item.suppliers ? (
                    <span className="text-slate-600">{item.suppliers.name}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">No supplier</span>
                  )}
                </TableCell>
                <TableCell>
                  <StockBadge item={item} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {isLow && (
                      <Button
                        size="sm"
                        onClick={() => onReorder(item)}
                        className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Reorder
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(item)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-slate-700"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(item.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
