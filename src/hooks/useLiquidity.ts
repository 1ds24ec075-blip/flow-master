import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, addDays, endOfWeek } from "date-fns";

export interface LiquidityWeek {
  id: string;
  week_start_date: string;
  opening_balance: number;
  alert_threshold: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LiquidityLineItem {
  id: string;
  liquidity_week_id: string;
  item_type: "collection" | "payment";
  description: string;
  expected_amount: number;
  actual_amount: number;
  due_date: string | null;
  status: "pending" | "partial" | "completed" | "overdue";
  payment_date: string | null;
  linked_invoice_id: string | null;
  linked_invoice_type: "supplier" | "customer" | "manual" | null;
  created_at: string;
  updated_at: string;
}

export function useLiquidity() {
  const [weeks, setWeeks] = useState<LiquidityWeek[]>([]);
  const [activeWeek, setActiveWeek] = useState<LiquidityWeek | null>(null);
  const [lineItems, setLineItems] = useState<LiquidityLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchWeeks = useCallback(async () => {
    const { data, error } = await supabase
      .from("weekly_liquidity")
      .select("*")
      .order("week_start_date", { ascending: false });
    if (error) {
      toast({ title: "Error fetching weeks", description: error.message, variant: "destructive" });
    } else {
      setWeeks(data as LiquidityWeek[]);
      if (data.length > 0 && !activeWeek) {
        setActiveWeek(data[0] as LiquidityWeek);
      }
    }
  }, [toast, activeWeek]);

  const fetchLineItems = useCallback(async (weekId: string) => {
    const { data, error } = await supabase
      .from("liquidity_line_items")
      .select("*")
      .eq("liquidity_week_id", weekId)
      .order("due_date", { ascending: true });
    if (error) {
      toast({ title: "Error fetching items", description: error.message, variant: "destructive" });
    } else {
      setLineItems(data as LiquidityLineItem[]);
    }
  }, [toast]);

  useEffect(() => {
    setLoading(true);
    fetchWeeks().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeWeek) {
      fetchLineItems(activeWeek.id);
    }
  }, [activeWeek, fetchLineItems]);

  // Realtime subscription
  useEffect(() => {
    if (!activeWeek) return;
    const channel = supabase
      .channel("liquidity-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "liquidity_line_items", filter: `liquidity_week_id=eq.${activeWeek.id}` }, () => {
        fetchLineItems(activeWeek.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeWeek, fetchLineItems]);

  // Auto-fetch unpaid supplier invoices for a given week
  const fetchUnpaidSupplierInvoices = async (weekStart: Date, weekId: string) => {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    // Get all pending supplier invoices
    const { data: supplierInvoices } = await supabase
      .from("raw_material_invoices")
      .select("id, invoice_number, amount, supplier_id, suppliers(name)")
      .in("status", ["pending", "awaiting_approval"]);

    if (supplierInvoices && supplierInvoices.length > 0) {
      const items = supplierInvoices.map((inv: any) => ({
        liquidity_week_id: weekId,
        item_type: "payment",
        description: `Supplier: ${inv.suppliers?.name || "Unknown"} — Inv#${inv.invoice_number}`,
        expected_amount: inv.amount || 0,
        linked_invoice_id: inv.id,
        linked_invoice_type: "supplier",
        status: "pending",
      }));
      await supabase.from("liquidity_line_items").insert(items);
    }
  };

  // Auto-fetch unpaid customer invoices for a given week
  const fetchUnpaidCustomerInvoices = async (weekStart: Date, weekId: string) => {
    // Get all pending/awaiting customer invoices
    const { data: customerInvoices } = await supabase
      .from("client_invoices")
      .select("id, invoice_number, amount, client_id, clients(name)")
      .in("status", ["pending", "awaiting_approval"]);

    if (customerInvoices && customerInvoices.length > 0) {
      const items = customerInvoices.map((inv: any) => ({
        liquidity_week_id: weekId,
        item_type: "collection",
        description: `Customer: ${inv.clients?.name || "Unknown"} — Inv#${inv.invoice_number}`,
        expected_amount: inv.amount || 0,
        linked_invoice_id: inv.id,
        linked_invoice_type: "customer",
        status: "pending",
      }));
      await supabase.from("liquidity_line_items").insert(items);
    }
  };

  const createWeek = async (weekStartDate: Date, openingBalance: number, alertThreshold: number, notes?: string) => {
    const { data, error } = await supabase
      .from("weekly_liquidity")
      .insert({ 
        week_start_date: format(weekStartDate, "yyyy-MM-dd"), 
        opening_balance: openingBalance, 
        alert_threshold: alertThreshold,
        notes: notes || null,
      })
      .select()
      .single();
    if (error) {
      toast({ title: "Error creating week", description: error.message, variant: "destructive" });
      return null;
    }
    
    // Auto-fetch unpaid invoices
    const week = data as LiquidityWeek;
    await Promise.all([
      fetchUnpaidSupplierInvoices(weekStartDate, week.id),
      fetchUnpaidCustomerInvoices(weekStartDate, week.id),
    ]);
    
    toast({ title: "Week created with auto-fetched invoices" });
    await fetchWeeks();
    setActiveWeek(week);
    return week;
  };

  const addLineItem = async (item: { item_type: "collection" | "payment"; description: string; expected_amount: number; due_date?: string; linked_invoice_type?: string }) => {
    if (!activeWeek) return;
    const { error } = await supabase.from("liquidity_line_items").insert({
      liquidity_week_id: activeWeek.id,
      item_type: item.item_type,
      description: item.description,
      expected_amount: item.expected_amount,
      due_date: item.due_date || null,
      linked_invoice_type: (item.linked_invoice_type as any) || "manual",
    });
    if (error) {
      toast({ title: "Error adding item", description: error.message, variant: "destructive" });
    }
  };

  const updateLineItem = async (id: string, updates: { actual_amount?: number; status?: string; payment_date?: string }) => {
    const { error } = await supabase.from("liquidity_line_items").update(updates).eq("id", id);
    if (error) {
      toast({ title: "Error updating item", description: error.message, variant: "destructive" });
    }
  };

  const deleteLineItem = async (id: string) => {
    const { error } = await supabase.from("liquidity_line_items").delete().eq("id", id);
    if (error) {
      toast({ title: "Error deleting item", description: error.message, variant: "destructive" });
    }
  };

  const updateWeek = async (id: string, updates: Partial<Pick<LiquidityWeek, "opening_balance" | "alert_threshold" | "notes">>) => {
    const { error } = await supabase.from("weekly_liquidity").update(updates).eq("id", id);
    if (error) {
      toast({ title: "Error updating week", description: error.message, variant: "destructive" });
    } else {
      await fetchWeeks();
    }
  };

  // Computed values
  const collections = lineItems.filter(i => i.item_type === "collection");
  const payments = lineItems.filter(i => i.item_type === "payment");
  const openingBalance = activeWeek?.opening_balance || 0;

  const totalExpectedCollections = collections.reduce((s, i) => s + Number(i.expected_amount), 0);
  const totalScheduledPayments = payments.reduce((s, i) => s + Number(i.expected_amount), 0);
  const projectedEndBalance = openingBalance + totalExpectedCollections - totalScheduledPayments;

  const totalActualCollections = collections.reduce((s, i) => s + Number(i.actual_amount || 0), 0);
  const totalActualPayments = payments.reduce((s, i) => s + Number(i.actual_amount || 0), 0);
  const actualBalance = openingBalance + totalActualCollections - totalActualPayments;

  // Alerts
  const alerts: { type: "critical" | "warning" | "info"; message: string }[] = [];
  if (projectedEndBalance < 0) alerts.push({ type: "critical", message: `Projected end-of-week balance is negative: ₹${projectedEndBalance.toLocaleString("en-IN")}` });
  if (activeWeek && activeWeek.alert_threshold > 0 && actualBalance < activeWeek.alert_threshold) alerts.push({ type: "critical", message: `Actual balance ₹${actualBalance.toLocaleString("en-IN")} is below threshold ₹${activeWeek.alert_threshold.toLocaleString("en-IN")}` });

  const now = new Date();
  const in48h = addDays(now, 2);
  payments.filter(p => p.status === "pending" && p.due_date).forEach(p => {
    const due = new Date(p.due_date!);
    if (due <= in48h && due >= now) alerts.push({ type: "warning", message: `Payment "${p.description}" (₹${Number(p.expected_amount).toLocaleString("en-IN")}) due in next 48 hours` });
  });
  collections.filter(c => c.status === "pending" && c.due_date).forEach(c => {
    const due = new Date(c.due_date!);
    if (due < now) alerts.push({ type: "warning", message: `Collection "${c.description}" (₹${Number(c.expected_amount).toLocaleString("en-IN")}) is overdue` });
  });

  return {
    weeks, activeWeek, setActiveWeek, lineItems, loading,
    createWeek, addLineItem, updateLineItem, deleteLineItem, updateWeek,
    collections, payments, openingBalance,
    totalExpectedCollections, totalScheduledPayments, projectedEndBalance,
    totalActualCollections, totalActualPayments, actualBalance,
    alerts, fetchWeeks,
  };
}
