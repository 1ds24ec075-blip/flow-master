import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Search, AlertTriangle, Package, ClipboardList, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { ReorderConfirmDialog } from "@/components/inventory/ReorderConfirmDialog";
import { AddEditItemDialog } from "@/components/inventory/AddEditItemDialog";
import { ReorderHistory } from "@/components/inventory/ReorderHistory";
import { useLowStockAlerts } from "@/components/inventory/LowStockAlert";
import type { InventoryItem } from "@/components/inventory/ReorderConfirmDialog";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [reorderItem, setReorderItem] = useState<InventoryItem | null>(null);
  const [addEditOpen, setAddEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(`*, suppliers (id, name, email)`)
        .eq("is_active", true)
        .order("item_name");
      if (error) throw error;
      return data as InventoryItem[];
    },
    refetchInterval: 30000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name, email").order("name");
      if (error) throw error;
      return data;
    },
  });

  const handleReorderOpen = useCallback((item: InventoryItem) => {
    setReorderItem(item);
  }, []);

  useLowStockAlerts(items, handleReorderOpen);

  const addItemMutation = useMutation({
    mutationFn: async (data: Partial<InventoryItem>) => {
      const payload: any = {
        item_name: data.item_name,
        sku: data.sku,
        current_quantity: data.current_quantity,
        minimum_threshold: data.minimum_threshold,
        default_reorder_quantity: data.default_reorder_quantity,
        unit: data.unit,
        estimated_lead_time_days: data.estimated_lead_time_days,
        preferred_supplier_id: data.preferred_supplier_id || null,
      };
      if (editItem) {
        const { error } = await supabase.from("inventory_items").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      setAddEditOpen(false);
      setEditItem(null);
      toast.success(editItem ? "Item updated" : "Item added successfully");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save item"),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_items").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Item removed");
    },
    onError: () => toast.error("Failed to remove item"),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({
      itemId, quantity, note, deliveryDate,
    }: { itemId: string; quantity: number; note: string; deliveryDate: string }) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) throw new Error("Item not found");

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id ?? null;

      const { data: reorderData, error: reorderError } = await supabase
        .from("reorder_requests")
        .insert({
          inventory_item_id: itemId,
          supplier_id: item.preferred_supplier_id,
          quantity_requested: quantity,
          quantity_at_trigger: item.current_quantity,
          minimum_threshold_at_trigger: item.minimum_threshold,
          status: "sent",
          internal_note: note,
          requested_delivery_date: deliveryDate,
          triggered_by: userId,
        })
        .select()
        .single();

      if (reorderError) throw reorderError;

      const supplierEmail = item.suppliers?.email;
      const supplierName = item.suppliers?.name ?? "Supplier";
      const companyName = "Your Company";

      const emailSubject = `Restock Request – ${item.item_name} – ${companyName}`;
      const emailBody = `Dear ${supplierName},

We hope this message finds you well.

We are writing to request a restock of the following item:

  Item Name    : ${item.item_name}
  SKU          : ${item.sku}
  Quantity     : ${quantity} ${item.unit}
  Delivery By  : ${deliveryDate}
  ${note ? `\n  Note         : ${note}` : ""}

Please confirm receipt of this order at your earliest convenience.

Thank you,
${companyName} Procurement Team`;

      await supabase.from("supplier_communications").insert({
        reorder_request_id: reorderData.id,
        supplier_id: item.preferred_supplier_id,
        communication_type: "email",
        subject: emailSubject,
        body: emailBody,
        recipient_email: supplierEmail ?? "",
        status: "sent",
      });

      return reorderData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reorder_requests"] });
      setReorderItem(null);
      toast.success("Reorder request sent & logged successfully");
    },
    onError: (e: any) => toast.error(e.message || "Failed to send reorder request"),
  });

  const filtered = items.filter(
    (i) =>
      i.item_name.toLowerCase().includes(search.toLowerCase()) ||
      i.sku.toLowerCase().includes(search.toLowerCase())
  );

  const lowStock = items.filter((i) => i.current_quantity < i.minimum_threshold);
  const outOfStock = items.filter((i) => i.current_quantity === 0);
  const okStock = items.filter((i) => i.current_quantity >= i.minimum_threshold);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Inventory Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor stock levels and automate supplier reorders</p>
        </div>
        <Button
          onClick={() => { setEditItem(null); setAddEditOpen(true); }}
          className="h-9 text-sm gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100">
                <Package className="h-4 w-4 text-slate-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Items</p>
                <p className="text-xl font-bold text-slate-800">{items.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${outOfStock.length > 0 ? "border-l-red-500 bg-red-50/30" : "border-l-slate-200"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${outOfStock.length > 0 ? "bg-red-100" : "bg-slate-100"}`}>
                <AlertTriangle className={`h-4 w-4 ${outOfStock.length > 0 ? "text-red-500" : "text-slate-400"}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Out of Stock</p>
                <p className={`text-xl font-bold ${outOfStock.length > 0 ? "text-red-600" : "text-slate-800"}`}>
                  {outOfStock.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${lowStock.length > 0 ? "border-l-orange-400 bg-orange-50/30" : "border-l-slate-200"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${lowStock.length > 0 ? "bg-orange-100" : "bg-slate-100"}`}>
                <TrendingDown className={`h-4 w-4 ${lowStock.length > 0 ? "text-orange-500" : "text-slate-400"}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Low Stock</p>
                <p className={`text-xl font-bold ${lowStock.length > 0 ? "text-orange-600" : "text-slate-800"}`}>
                  {lowStock.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <ClipboardList className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Healthy Stock</p>
                <p className="text-xl font-bold text-emerald-600">{okStock.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="inventory">
        <div className="flex items-center justify-between">
          <TabsList className="h-9">
            <TabsTrigger value="inventory" className="text-xs">
              All Inventory
              {items.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 text-[10px] px-1.5">{items.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="text-xs">
              Low Stock
              {lowStock.length > 0 && (
                <Badge className="ml-1.5 h-4 text-[10px] px-1.5 bg-red-500 text-white">{lowStock.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">Reorder History</TabsTrigger>
          </TabsList>

          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search items or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm w-56"
            />
          </div>
        </div>

        <TabsContent value="inventory" className="mt-4">
          {isLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Loading inventory...</div>
          ) : (
            <InventoryTable
              items={filtered}
              onReorder={handleReorderOpen}
              onEdit={(item) => { setEditItem(item); setAddEditOpen(true); }}
              onDelete={(id) => deleteItemMutation.mutate(id)}
            />
          )}
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          {lowStock.length === 0 ? (
            <div className="text-center py-14 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">All stock levels are healthy</p>
              <p className="text-xs mt-1">No items below minimum threshold</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                {outOfStock.length > 0 && (
                  <span className="text-red-600 font-medium">{outOfStock.length} out of stock · </span>
                )}
                {lowStock.filter((i) => i.current_quantity > 0).length} low stock — sorted by urgency
              </p>
              <InventoryTable
                items={[...lowStock].sort((a, b) => a.current_quantity - b.current_quantity)}
                onReorder={handleReorderOpen}
                onEdit={(item) => { setEditItem(item); setAddEditOpen(true); }}
                onDelete={(id) => deleteItemMutation.mutate(id)}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <ReorderHistory />
        </TabsContent>
      </Tabs>

      <ReorderConfirmDialog
        item={reorderItem}
        open={!!reorderItem}
        onClose={() => setReorderItem(null)}
        onConfirm={(itemId, quantity, note, deliveryDate) =>
          reorderMutation.mutate({ itemId, quantity, note, deliveryDate })
        }
        loading={reorderMutation.isPending}
      />

      <AddEditItemDialog
        open={addEditOpen}
        onClose={() => { setAddEditOpen(false); setEditItem(null); }}
        onSave={(data) => addItemMutation.mutate(data)}
        suppliers={suppliers}
        editItem={editItem}
        loading={addItemMutation.isPending}
      />
    </div>
  );
}
