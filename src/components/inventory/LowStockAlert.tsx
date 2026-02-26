import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { InventoryItem } from "./ReorderConfirmDialog";

interface LowStockAlertProps {
  items: InventoryItem[];
  onReorder: (item: InventoryItem) => void;
}

export function useLowStockAlerts(items: InventoryItem[], onReorder: (item: InventoryItem) => void) {
  const alertedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!items || items.length === 0) return;

    const lowStock = items.filter(
      (item) => item.current_quantity < item.minimum_threshold
    );

    const newAlerts = lowStock.filter((item) => !alertedRef.current.has(item.id));

    if (newAlerts.length > 0) {
      newAlerts.forEach((item) => {
        alertedRef.current.add(item.id);

        const isCritical = item.current_quantity === 0;

        toast(isCritical ? "Out of Stock!" : "Low Stock Alert", {
          description: `${item.item_name} (SKU: ${item.sku}) — ${item.current_quantity} ${item.unit} remaining`,
          duration: 8000,
          icon: <AlertTriangle className={`h-4 w-4 ${isCritical ? "text-red-500" : "text-orange-500"}`} />,
          action: {
            label: "Reorder Now",
            onClick: () => onReorder(item),
          },
        });
      });
    }
  }, [items, onReorder]);
}
