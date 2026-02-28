import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const EXPORTABLE_TABLES = [
  { key: "bills", label: "Bills", description: "Vendor bills and payment records" },
  { key: "clients", label: "Clients", description: "Client directory" },
  { key: "suppliers", label: "Suppliers", description: "Supplier directory" },
  { key: "inventory_items", label: "Inventory Items", description: "Stock and inventory" },
  { key: "reorder_requests", label: "Reorder Requests", description: "Inventory reorder history" },
  { key: "purchase_orders", label: "Purchase Orders", description: "PO records" },
  { key: "quotations", label: "Quotations", description: "Quotation records" },
  { key: "client_invoices", label: "Client Invoices", description: "Invoices sent to clients" },
  { key: "raw_material_invoices", label: "Raw Material Invoices", description: "Supplier invoices" },
  { key: "po_orders", label: "PO Orders (Intake)", description: "Ingested purchase orders" },
  { key: "product_master", label: "Product Master", description: "Product catalog" },
  { key: "customer_master", label: "Customer Master", description: "Customer records" },
  { key: "expense_categories", label: "Expense Categories", description: "Bill categories" },
  { key: "weekly_liquidity", label: "Weekly Liquidity", description: "Cash flow weeks" },
  { key: "liquidity_line_items", label: "Liquidity Line Items", description: "Cash flow details" },
  { key: "segregated_transactions", label: "Segregated Transactions", description: "Bank categorization" },
  { key: "tally_vouchers", label: "Tally Vouchers", description: "Generated vouchers" },
  { key: "activity_log", label: "Activity Log", description: "System activity" },
] as const;

type TableKey = typeof EXPORTABLE_TABLES[number]["key"];

export default function DataExport() {
  const [selected, setSelected] = useState<Set<TableKey>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const { toast } = useToast();

  const toggle = (key: TableKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === EXPORTABLE_TABLES.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(EXPORTABLE_TABLES.map((t) => t.key)));
    }
  };

  const fetchTable = async (table: string) => {
    const { data, error } = await (supabase.from(table as any).select("*") as any);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  };

  const downloadCSV = (data: Record<string, any>[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map((row) =>
        headers.map((h) => {
          const val = row[h];
          const str = val === null || val === undefined ? "" : String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!selected.size) {
      toast({ title: "No tables selected", description: "Pick at least one table to export.", variant: "destructive" });
      return;
    }

    setExporting(true);
    try {
      const tables = Array.from(selected);

      if (format === "csv") {
        for (const table of tables) {
          const data = await fetchTable(table);
          if (data.length) downloadCSV(data, table);
        }
        toast({ title: "CSV Export Complete", description: `Exported ${tables.length} table(s) as CSV.` });
      } else {
        const wb = XLSX.utils.book_new();
        let sheetsAdded = 0;
        for (const table of tables) {
          const data = await fetchTable(table);
          if (data.length) {
            const ws = XLSX.utils.json_to_sheet(data);
            const sheetName = table.substring(0, 31); // Excel limit
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            sheetsAdded++;
          }
        }
        if (sheetsAdded) {
          XLSX.writeFile(wb, "data_export.xlsx");
          toast({ title: "Excel Export Complete", description: `Exported ${sheetsAdded} table(s) into one Excel file.` });
        } else {
          toast({ title: "No data", description: "Selected tables are all empty.", variant: "destructive" });
        }
      }
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Export</h1>
        <p className="text-muted-foreground">Download your database tables as CSV or Excel files.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Select Tables</CardTitle>
              <CardDescription>{selected.size} of {EXPORTABLE_TABLES.length} selected</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                {selected.size === EXPORTABLE_TABLES.length ? "Deselect All" : "Select All"}
              </Button>
              <div className="flex border rounded-md overflow-hidden">
                <button
                  onClick={() => setFormat("xlsx")}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${
                    format === "xlsx" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <FileSpreadsheet className="h-3 w-3" /> Excel
                </button>
                <button
                  onClick={() => setFormat("csv")}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${
                    format === "csv" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <FileText className="h-3 w-3" /> CSV
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {EXPORTABLE_TABLES.map((t) => (
              <label
                key={t.key}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selected.has(t.key)
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <Checkbox
                  checked={selected.has(t.key)}
                  onCheckedChange={() => toggle(t.key)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">{t.label}</span>
                  <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={handleExport} disabled={exporting || !selected.size} className="gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? "Exporting..." : `Export ${selected.size} table(s)`}
            </Button>
            {format === "csv" && selected.size > 1 && (
              <Badge variant="secondary" className="text-xs">
                Downloads {selected.size} separate files
              </Badge>
            )}
            {format === "xlsx" && selected.size > 0 && (
              <Badge variant="secondary" className="text-xs">
                All in one .xlsx file
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
