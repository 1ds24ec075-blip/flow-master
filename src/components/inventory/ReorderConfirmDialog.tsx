import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Package, Truck, Building2 } from "lucide-react";

export interface InventoryItem {
  id: string;
  item_name: string;
  sku: string;
  current_quantity: number;
  minimum_threshold: number;
  default_reorder_quantity: number;
  unit: string;
  estimated_lead_time_days: number | null;
  preferred_supplier_id: string | null;
  suppliers?: {
    id: string;
    name: string;
    email: string | null;
  } | null;
}

interface ReorderConfirmDialogProps {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (itemId: string, quantity: number, note: string, deliveryDate: string) => void;
  loading?: boolean;
}

export function ReorderConfirmDialog({ item, open, onClose, onConfirm, loading }: ReorderConfirmDialogProps) {
  const [quantity, setQuantity] = useState<number>(0);
  const [note, setNote] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (item?.estimated_lead_time_days ?? 7));
    return d.toISOString().split("T")[0];
  });

  const handleOpen = () => {
    if (item) {
      setQuantity(item.default_reorder_quantity);
      const d = new Date();
      d.setDate(d.getDate() + (item.estimated_lead_time_days ?? 7));
      setDeliveryDate(d.toISOString().split("T")[0]);
      setNote("");
    }
  };

  const urgencyLevel = item
    ? item.current_quantity === 0
      ? "critical"
      : item.current_quantity / item.minimum_threshold < 0.5
      ? "high"
      : "medium"
    : "medium";

  const urgencyColors = {
    critical: "bg-red-100 border-red-300 text-red-800",
    high: "bg-orange-100 border-orange-300 text-orange-800",
    medium: "bg-yellow-100 border-yellow-300 text-yellow-800",
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
        else handleOpen();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Restock Request
          </DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 ${urgencyColors[urgencyLevel]}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{item.item_name}</p>
                  <p className="text-xs opacity-75 mt-0.5">SKU: {item.sku}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    urgencyLevel === "critical"
                      ? "border-red-500 text-red-700"
                      : urgencyLevel === "high"
                      ? "border-orange-500 text-orange-700"
                      : "border-yellow-500 text-yellow-700"
                  }`}
                >
                  {urgencyLevel === "critical" ? "Out of Stock" : urgencyLevel === "high" ? "Critical Low" : "Low Stock"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div className="bg-white/60 rounded px-2 py-1.5">
                  <p className="opacity-60 uppercase tracking-wide text-[10px]">Current Qty</p>
                  <p className="font-bold text-base">
                    {item.current_quantity} <span className="font-normal text-xs">{item.unit}</span>
                  </p>
                </div>
                <div className="bg-white/60 rounded px-2 py-1.5">
                  <p className="opacity-60 uppercase tracking-wide text-[10px]">Min Threshold</p>
                  <p className="font-bold text-base">
                    {item.minimum_threshold} <span className="font-normal text-xs">{item.unit}</span>
                  </p>
                </div>
              </div>
            </div>

            {item.suppliers && (
              <div className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <Building2 className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">Supplier</p>
                  <p className="text-sm font-medium text-slate-700 truncate">{item.suppliers.name}</p>
                  {item.suppliers.email && (
                    <p className="text-xs text-slate-400 truncate">{item.suppliers.email}</p>
                  )}
                </div>
                {item.estimated_lead_time_days && (
                  <div className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                    <Truck className="h-3.5 w-3.5" />
                    <span>{item.estimated_lead_time_days}d</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label className="text-xs text-slate-600">Reorder Quantity ({item.unit})</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  >
                    -
                  </Button>
                  <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                    className="h-8 text-center font-semibold"
                    min={1}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setQuantity(quantity + 1)}
                  >
                    +
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs text-slate-600">Requested Delivery Date</Label>
                <Input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="h-8 mt-1 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs text-slate-600">Internal Note (optional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add any special instructions or notes..."
                  className="mt-1 text-sm resize-none"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="flex-1 h-9 text-sm">
                Cancel
              </Button>
              <Button
                onClick={() => onConfirm(item.id, quantity, note, deliveryDate)}
                disabled={loading || quantity < 1}
                className="flex-1 h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Package className="h-4 w-4 mr-1.5" />
                {loading ? "Sending..." : "Confirm & Send"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
