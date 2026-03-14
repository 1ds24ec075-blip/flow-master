import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  sales_target_quantity: number | null;
  sales_target_period: string | null;
  suppliers?: {
    id: string;
    name: string;
    email: string | null;
  } | null;
}

interface Supplier {
  id: string;
  name: string;
  email: string | null;
}

interface ReorderConfirmDialogProps {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (itemId: string, quantity: number, note: string, deliveryDate: string, supplierId: string | null) => void;
  loading?: boolean;
  suppliers?: Supplier[];
}

export function ReorderConfirmDialog({ item, open, onClose, onConfirm, loading, suppliers = [] }: ReorderConfirmDialogProps) {
  const [quantity, setQuantity] = useState<number>(0);
  const [note, setNote] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState("");

  // Initialize state when item/open changes
  useEffect(() => {
    if (open && item) {
      setQuantity(item.default_reorder_quantity);
      const d = new Date();
      d.setDate(d.getDate() + (item.estimated_lead_time_days ?? 7));
      setDeliveryDate(d.toISOString().split("T")[0]);
      setNote("");
      setSelectedSupplierId(item.preferred_supplier_id || null);
    }
  }, [open, item]);

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

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

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Supplier</Label>
              <Select
                value={selectedSupplierId || "none"}
                onValueChange={(v) => setSelectedSupplierId(v === "none" ? null : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-sm text-muted-foreground">No supplier</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-sm">
                      {s.name} {s.email ? `(${s.email})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSupplier && (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border border-slate-200 text-xs text-slate-500">
                  <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{selectedSupplier.email || "No email"}</span>
                  {item.estimated_lead_time_days && (
                    <span className="ml-auto flex items-center gap-1">
                      <Truck className="h-3 w-3" /> {item.estimated_lead_time_days}d
                    </span>
                  )}
                </div>
              )}
            </div>

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
                onClick={() => onConfirm(item.id, quantity, note, deliveryDate, selectedSupplierId)}
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
