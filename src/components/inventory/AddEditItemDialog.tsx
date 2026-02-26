import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { InventoryItem } from "./ReorderConfirmDialog";

interface Supplier {
  id: string;
  name: string;
  email: string | null;
}

interface AddEditItemDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<InventoryItem>) => void;
  suppliers: Supplier[];
  editItem?: InventoryItem | null;
  loading?: boolean;
}

const UNITS = ["units", "kg", "g", "litres", "ml", "boxes", "pcs", "rolls", "sheets", "bags"];

const empty = {
  item_name: "",
  sku: "",
  current_quantity: 0,
  minimum_threshold: 10,
  default_reorder_quantity: 50,
  unit: "units",
  estimated_lead_time_days: 7,
  preferred_supplier_id: "",
  notes: "",
};

export function AddEditItemDialog({ open, onClose, onSave, suppliers, editItem, loading }: AddEditItemDialogProps) {
  const [form, setForm] = useState({ ...empty });

  useEffect(() => {
    if (editItem) {
      setForm({
        item_name: editItem.item_name,
        sku: editItem.sku,
        current_quantity: editItem.current_quantity,
        minimum_threshold: editItem.minimum_threshold,
        default_reorder_quantity: editItem.default_reorder_quantity,
        unit: editItem.unit || "units",
        estimated_lead_time_days: editItem.estimated_lead_time_days ?? 7,
        preferred_supplier_id: editItem.preferred_supplier_id ?? "",
        notes: "",
      });
    } else {
      setForm({ ...empty });
    }
  }, [editItem, open]);

  const set = (key: string, val: string | number) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleSave = () => {
    onSave({
      ...form,
      preferred_supplier_id: form.preferred_supplier_id || null,
      estimated_lead_time_days: form.estimated_lead_time_days || null,
    });
  };

  const isValid = form.item_name.trim() && form.sku.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{editItem ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-600">Item Name *</Label>
              <Input
                value={form.item_name}
                onChange={(e) => set("item_name", e.target.value)}
                className="h-8 text-sm mt-1"
                placeholder="e.g. Aluminum Sheet"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600">SKU *</Label>
              <Input
                value={form.sku}
                onChange={(e) => set("sku", e.target.value.toUpperCase())}
                className="h-8 text-sm mt-1 font-mono"
                placeholder="e.g. ALU-001"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-slate-600">Current Qty</Label>
              <Input
                type="number"
                value={form.current_quantity}
                onChange={(e) => set("current_quantity", Number(e.target.value))}
                className="h-8 text-sm mt-1"
                min={0}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Min Threshold</Label>
              <Input
                type="number"
                value={form.minimum_threshold}
                onChange={(e) => set("minimum_threshold", Number(e.target.value))}
                className="h-8 text-sm mt-1"
                min={0}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Unit</Label>
              <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger className="h-8 text-sm mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u} className="text-sm">{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-600">Default Reorder Qty</Label>
              <Input
                type="number"
                value={form.default_reorder_quantity}
                onChange={(e) => set("default_reorder_quantity", Number(e.target.value))}
                className="h-8 text-sm mt-1"
                min={1}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Lead Time (days)</Label>
              <Input
                type="number"
                value={form.estimated_lead_time_days ?? ""}
                onChange={(e) => set("estimated_lead_time_days", Number(e.target.value))}
                className="h-8 text-sm mt-1"
                min={0}
                placeholder="7"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-600">Preferred Supplier</Label>
            <Select
              value={form.preferred_supplier_id || "none"}
              onValueChange={(v) => set("preferred_supplier_id", v === "none" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-sm mt-1">
                <SelectValue placeholder="Select supplier..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-sm text-muted-foreground">No supplier</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-sm">{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1 h-8 text-sm">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isValid || loading}
              className="flex-1 h-8 text-sm"
            >
              {loading ? "Saving..." : editItem ? "Update Item" : "Add Item"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
