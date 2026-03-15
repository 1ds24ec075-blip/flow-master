/**
 * useLiquidity.ts — Core hook for the Liquidity Dashboard
 *
 * Manages weekly cash-flow tracking: opening balances, expected collections
 * (customer invoices) and scheduled payments (supplier invoices), with
 * real-time updates via Supabase Realtime.
 *
 * Key concepts:
 *  - LiquidityWeek: a Sunday→Saturday planning window with an opening balance
 *  - LiquidityLineItem: an expected inflow (collection) or outflow (payment)
 *  - MonthlyPaymentDay: aggregated view of a single calendar day
 *
 * Performance notes:
 *  - Unpaid invoices are auto-fetched into new weeks (deduplicating by
 *    linked_invoice_id) so users don't have to add them manually.
 *  - Realtime channel is scoped to the active week to minimise chatter.
 *  - Monthly data is fetched only when lineItems change (via useEffect dep).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  format,
  startOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from "date-fns";

/* ─── Type definitions ─── */

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

export interface MonthlyPaymentDay {
  date: Date;
  dateStr: string;
  supplierCount: number;
  collectionCount: number;
  supplierNames: string[];
  totalAmount: number;
  totalCollectionAmount: number;
  items: LiquidityLineItem[];
  collectionItems: LiquidityLineItem[];
}

/* ─── Hook ─── */

export function useLiquidity() {
  const [weeks, setWeeks] = useState<LiquidityWeek[]>([]);
  const [activeWeek, setActiveWeek] = useState<LiquidityWeek | null>(null);
  const [lineItems, setLineItems] = useState<LiquidityLineItem[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyPaymentDay[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  /* ──────────────────────────────────────────────
   * Auto-import unpaid supplier invoices into a week
   * (skips any already linked in ANY week)
   * ────────────────────────────────────────────── */
  const fetchUnpaidSupplierInvoices = async (_weekStart: Date, weekId: string) => {
    const { data: supplierInvoices } = await supabase
      .from("raw_material_invoices")
      .select("id, invoice_number, amount, supplier_id, due_date, suppliers(name)")
      .in("status", ["pending", "awaiting_approval"]);

    if (!supplierInvoices?.length) return;

    // Deduplicate — check which invoices already have line items globally
    const invoiceIds = supplierInvoices.map((inv: any) => inv.id);
    const { data: existing } = await supabase
      .from("liquidity_line_items")
      .select("linked_invoice_id")
      .in("linked_invoice_id", invoiceIds)
      .eq("linked_invoice_type", "supplier");

    const existingIds = new Set((existing ?? []).map((e: any) => e.linked_invoice_id));
    const newInvoices = supplierInvoices.filter((inv: any) => !existingIds.has(inv.id));

    if (newInvoices.length > 0) {
      const items = newInvoices.map((inv: any) => ({
        liquidity_week_id: weekId,
        item_type: "payment",
        description: `Supplier: ${inv.suppliers?.name || "Unknown"} — Inv#${inv.invoice_number}`,
        expected_amount: inv.amount || 0,
        linked_invoice_id: inv.id,
        linked_invoice_type: "supplier",
        status: "pending",
        due_date: inv.due_date || null,
      }));
      await supabase.from("liquidity_line_items").insert(items);
    }
  };

  /* ──────────────────────────────────────────────
   * Auto-import unpaid customer invoices into a week
   * ────────────────────────────────────────────── */
  const fetchUnpaidCustomerInvoices = async (_weekStart: Date, weekId: string) => {
    const { data: customerInvoices } = await supabase
      .from("client_invoices")
      .select("id, invoice_number, amount, client_id, clients(name)")
      .in("status", ["pending", "awaiting_approval"]);

    if (!customerInvoices?.length) return;

    const invoiceIds = customerInvoices.map((inv: any) => inv.id);
    const { data: existing } = await supabase
      .from("liquidity_line_items")
      .select("linked_invoice_id")
      .in("linked_invoice_id", invoiceIds)
      .eq("linked_invoice_type", "customer");

    const existingIds = new Set((existing ?? []).map((e: any) => e.linked_invoice_id));
    const newInvoices = customerInvoices.filter((inv: any) => !existingIds.has(inv.id));

    if (newInvoices.length > 0) {
      const items = newInvoices.map((inv: any) => ({
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

  /* ──────────────────────────────────────────────
   * Ensure a liquidity week exists for the current calendar week
   * Uses upsert to safely handle concurrent calls / race conditions
   * ────────────────────────────────────────────── */
  const ensureCurrentWeek = async () => {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 0 });
    const weekStartStr = format(weekStart, "yyyy-MM-dd");

    // Quick check — skip if already exists
    const { data: existing } = await supabase
      .from("weekly_liquidity")
      .select("id")
      .eq("week_start_date", weekStartStr)
      .maybeSingle();

    if (existing) return;

    const { data: newWeek, error } = await supabase
      .from("weekly_liquidity")
      .upsert(
        { week_start_date: weekStartStr, opening_balance: 0, alert_threshold: 0 },
        { onConflict: "week_start_date", ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();

    if (!error && newWeek) {
      // Auto-populate with unpaid invoices
      await Promise.all([
        fetchUnpaidSupplierInvoices(weekStart, newWeek.id),
        fetchUnpaidCustomerInvoices(weekStart, newWeek.id),
      ]);
    }
  };

  /* ─── Data fetchers ─── */

  /** Load all weeks (most recent first) and auto-select the current one */
  const fetchWeeks = useCallback(async () => {
    const { data, error } = await supabase
      .from("weekly_liquidity")
      .select("*")
      .order("week_start_date", { ascending: false });

    if (error) {
      toast({ title: "Error fetching weeks", description: error.message, variant: "destructive" });
      return;
    }

    setWeeks(data as LiquidityWeek[]);

    // Auto-select current week (or fall back to most recent)
    if (data.length > 0 && !activeWeek) {
      const weekStartStr = format(startOfWeek(new Date(), { weekStartsOn: 0 }), "yyyy-MM-dd");
      const currentWeek = data.find((w: any) => w.week_start_date === weekStartStr);
      setActiveWeek((currentWeek || data[0]) as LiquidityWeek);
    }
  }, [toast, activeWeek]);

  /** Load line items for a specific week */
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

  /** Build calendar day data for a given month */
  const fetchMonthlyData = useCallback(async (month: Date) => {
    const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");

    // Fetch payments and collections in parallel
    const [{ data: paymentData }, { data: collectionData }] = await Promise.all([
      supabase
        .from("liquidity_line_items")
        .select("*")
        .eq("item_type", "payment")
        .gte("due_date", monthStart)
        .lte("due_date", monthEnd)
        .neq("status", "completed"),
      supabase
        .from("liquidity_line_items")
        .select("*")
        .eq("item_type", "collection")
        .gte("due_date", monthStart)
        .lte("due_date", monthEnd)
        .neq("status", "completed"),
    ]);

    const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
    const result: MonthlyPaymentDay[] = days.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayPayments = (paymentData ?? []).filter((item: any) => item.due_date === dateStr);
      const dayCollections = (collectionData ?? []).filter((item: any) => item.due_date === dateStr);

      return {
        date: day,
        dateStr,
        supplierCount: dayPayments.length,
        collectionCount: dayCollections.length,
        supplierNames: dayPayments.map((i: any) => i.description),
        totalAmount: dayPayments.reduce((s: number, i: any) => s + Number(i.expected_amount || 0), 0),
        totalCollectionAmount: dayCollections.reduce((s: number, i: any) => s + Number(i.expected_amount || 0), 0),
        items: dayPayments as LiquidityLineItem[],
        collectionItems: dayCollections as LiquidityLineItem[],
      };
    });

    setMonthlyData(result);
  }, []);

  /* ─── Effects ─── */

  // Initial load: ensure week exists → fetch weeks list
  useEffect(() => {
    setLoading(true);
    ensureCurrentWeek()
      .then(() => fetchWeeks())
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When active week changes, reload its line items
  useEffect(() => {
    if (activeWeek) fetchLineItems(activeWeek.id);
  }, [activeWeek, fetchLineItems]);

  // Refresh monthly calendar whenever line items update
  useEffect(() => {
    fetchMonthlyData(new Date());
  }, [fetchMonthlyData, lineItems]);

  // Realtime subscription scoped to the active week's line items
  useEffect(() => {
    if (!activeWeek) return;
    const channel = supabase
      .channel("liquidity-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "liquidity_line_items",
          filter: `liquidity_week_id=eq.${activeWeek.id}`,
        },
        () => fetchLineItems(activeWeek.id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeWeek, fetchLineItems]);

  /* ─── CRUD operations ─── */

  /** Create a new liquidity week and auto-populate invoices */
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

  /** Add a manual line item to the active week */
  const addLineItem = async (item: {
    item_type: "collection" | "payment";
    description: string;
    expected_amount: number;
    due_date?: string;
    linked_invoice_type?: string;
  }) => {
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

  /** Update a line item (amount, status, payment date) and sync invoice status */
  const updateLineItem = async (id: string, updates: { actual_amount?: number; status?: string; payment_date?: string }) => {
    const { error } = await supabase.from("liquidity_line_items").update(updates).eq("id", id);
    if (error) {
      toast({ title: "Error updating item", description: error.message, variant: "destructive" });
      return;
    }

    // When marking as completed, also update the linked invoice status
    if (updates.status === "completed") {
      const item = lineItems.find((i) => i.id === id);
      if (item?.linked_invoice_id && item.linked_invoice_type === "supplier") {
        await supabase.from("raw_material_invoices").update({ status: "approved" }).eq("id", item.linked_invoice_id);
      }
      if (item?.linked_invoice_id && item.linked_invoice_type === "customer") {
        await supabase.from("client_invoices").update({ status: "approved" }).eq("id", item.linked_invoice_id);
      }
    }
  };

  /** Delete a line item */
  const deleteLineItem = async (id: string) => {
    const { error } = await supabase.from("liquidity_line_items").delete().eq("id", id);
    if (error) {
      toast({ title: "Error deleting item", description: error.message, variant: "destructive" });
    }
  };

  /** Update week settings (opening balance, threshold, notes) */
  const updateWeek = async (id: string, updates: Partial<Pick<LiquidityWeek, "opening_balance" | "alert_threshold" | "notes">>) => {
    const { data, error } = await supabase.from("weekly_liquidity").update(updates).eq("id", id).select().single();
    if (error) {
      toast({ title: "Error updating week", description: error.message, variant: "destructive" });
    } else {
      setActiveWeek(data as LiquidityWeek);
      await fetchWeeks();
    }
  };

  /* ─── Computed / memoised values ─── */

  /** Collections (inflows) for the active week */
  const collections = useMemo(() => lineItems.filter((i) => i.item_type === "collection"), [lineItems]);

  /** Payments (outflows) for the active week */
  const payments = useMemo(() => lineItems.filter((i) => i.item_type === "payment"), [lineItems]);

  const openingBalance = activeWeek?.opening_balance || 0;

  // Expected (projected) totals
  const totalExpectedCollections = useMemo(() => collections.reduce((s, i) => s + Number(i.expected_amount), 0), [collections]);
  const totalScheduledPayments = useMemo(() => payments.reduce((s, i) => s + Number(i.expected_amount), 0), [payments]);
  const projectedEndBalance = openingBalance + totalExpectedCollections - totalScheduledPayments;

  // Actual totals (amounts entered after payment/receipt)
  const totalActualCollections = useMemo(() => collections.reduce((s, i) => s + Number(i.actual_amount || 0), 0), [collections]);
  const totalActualPayments = useMemo(() => payments.reduce((s, i) => s + Number(i.actual_amount || 0), 0), [payments]);
  const actualBalance = openingBalance + totalActualCollections - totalActualPayments;

  /* ─── Smart alerts ─── */

  const alerts = useMemo(() => {
    const result: { type: "critical" | "warning" | "info"; message: string }[] = [];

    // Negative projected balance
    if (projectedEndBalance < 0) {
      result.push({ type: "critical", message: `Projected end-of-week balance is negative: ₹${projectedEndBalance.toLocaleString("en-IN")}` });
    }

    // Actual balance below threshold
    if (activeWeek && activeWeek.alert_threshold > 0 && actualBalance < activeWeek.alert_threshold) {
      result.push({ type: "critical", message: `Actual balance ₹${actualBalance.toLocaleString("en-IN")} is below threshold ₹${activeWeek.alert_threshold.toLocaleString("en-IN")}` });
    }

    const now = new Date();
    const in48h = addDays(now, 2);

    // Payments due within 48 hours
    payments
      .filter((p) => p.status === "pending" && p.due_date)
      .forEach((p) => {
        const due = new Date(p.due_date!);
        if (due <= in48h && due >= now) {
          result.push({ type: "warning", message: `Payment "${p.description}" (₹${Number(p.expected_amount).toLocaleString("en-IN")}) due in next 48 hours` });
        }
      });

    // Overdue collections
    collections
      .filter((c) => c.status === "pending" && c.due_date)
      .forEach((c) => {
        const due = new Date(c.due_date!);
        if (due < now) {
          result.push({ type: "warning", message: `Collection "${c.description}" (₹${Number(c.expected_amount).toLocaleString("en-IN")}) is overdue` });
        }
      });

    return result;
  }, [projectedEndBalance, actualBalance, activeWeek, payments, collections]);

  /* ─── Public API ─── */

  return {
    weeks,
    activeWeek,
    setActiveWeek,
    lineItems,
    loading,
    createWeek,
    addLineItem,
    updateLineItem,
    deleteLineItem,
    updateWeek,
    collections,
    payments,
    openingBalance,
    totalExpectedCollections,
    totalScheduledPayments,
    projectedEndBalance,
    totalActualCollections,
    totalActualPayments,
    actualBalance,
    alerts,
    fetchWeeks,
    monthlyData,
    fetchMonthlyData,
  };
}
