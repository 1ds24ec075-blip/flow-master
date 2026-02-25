import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, CalendarIcon, Plus, StickyNote, Wallet } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLiquidity, LiquidityLineItem } from "@/hooks/useLiquidity";
import { LiquidityBalanceCards } from "@/components/liquidity/BalanceCards";
import { LiquidityLineItemTable } from "@/components/liquidity/LineItemTable";
import { MonthlyPaymentCalendar } from "@/components/liquidity/MonthlyCalendar";

function formatINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

export default function LiquidityDashboard() {
  const liq = useLiquidity();
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemType, setItemType] = useState<"collection" | "payment">("collection");
  const [itemDesc, setItemDesc] = useState("");
  const [itemAmt, setItemAmt] = useState("");
  const [itemDue, setItemDue] = useState<Date | undefined>();
  const [editItem, setEditItem] = useState<LiquidityLineItem | null>(null);
  const [editActual, setEditActual] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState<Date | undefined>();
  const [notesOpen, setNotesOpen] = useState(false);
  const [editNotes, setEditNotes] = useState("");

  const handleAddItem = async () => {
    if (!itemDesc.trim() || !itemAmt) return;
    await liq.addLineItem({ item_type: itemType, description: itemDesc.trim(), expected_amount: Number(itemAmt), due_date: itemDue ? format(itemDue, "yyyy-MM-dd") : undefined });
    setAddItemOpen(false);
    setItemDesc("");
    setItemAmt("");
    setItemDue(undefined);
  };

  const handleMarkDone = async (item: LiquidityLineItem) => {
    await liq.updateLineItem(item.id, { actual_amount: Number(item.expected_amount), status: "completed", payment_date: format(new Date(), "yyyy-MM-dd") });
  };

  const handleUpdateActual = async () => {
    if (!editItem) return;
    const amt = Number(editActual);
    const status = amt >= Number(editItem.expected_amount) ? "completed" : amt > 0 ? "partial" : "pending";
    const payDate = editPaymentDate ? format(editPaymentDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    await liq.updateLineItem(editItem.id, { actual_amount: amt, status, payment_date: payDate });
    setEditItem(null);
    setEditActual("");
    setEditPaymentDate(undefined);
  };

  const handleSaveNotes = async () => {
    if (!liq.activeWeek) return;
    await liq.updateWeek(liq.activeWeek.id, { notes: editNotes });
    setNotesOpen(false);
  };

  if (liq.loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Liquidity Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Weekly Cash Flow & Supplier Payment Tracker
            {liq.activeWeek && ` — Week of ${format(new Date(liq.activeWeek.week_start_date), "dd MMM yyyy")}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {liq.weeks.length > 1 && (
            <Select value={liq.activeWeek?.id || ""} onValueChange={v => liq.setActiveWeek(liq.weeks.find(w => w.id === v) || null)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select week" /></SelectTrigger>
              <SelectContent>
                {liq.weeks.map(w => (
                  <SelectItem key={w.id} value={w.id}>Week of {format(new Date(w.week_start_date), "dd MMM yyyy")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {liq.activeWeek && (
            <Button variant="outline" size="icon" onClick={() => { setEditNotes(liq.activeWeek?.notes || ""); setNotesOpen(true); }} title="Week Notes">
              <StickyNote className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {liq.alerts.length > 0 && (
        <div className="space-y-2">
          {liq.alerts.map((a, i) => (
            <div key={i} className={cn("flex items-center gap-2 p-3 rounded-lg border text-sm",
              a.type === "critical" ? "bg-destructive/10 border-destructive/50 text-destructive" : "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700")}>
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Week Notes Banner */}
      {liq.activeWeek?.notes && (
        <div className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30 text-sm">
          <StickyNote className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <p className="text-muted-foreground">{liq.activeWeek.notes}</p>
        </div>
      )}

      {!liq.activeWeek ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Wallet className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>Setting up current week...</p>
        </CardContent></Card>
      ) : (
        <>
          <LiquidityBalanceCards liq={liq} />

          {/* Monthly Payment Calendar */}
          <MonthlyPaymentCalendar
            monthlyData={liq.monthlyData}
            onMonthChange={(month) => liq.fetchMonthlyData(month)}
          />

          {/* Line Items Tabs */}
          <Tabs defaultValue="all" className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <TabsList>
                <TabsTrigger value="all">All Items</TabsTrigger>
                <TabsTrigger value="collections">Collections ({liq.collections.length})</TabsTrigger>
                <TabsTrigger value="payments">Payments ({liq.payments.length})</TabsTrigger>
              </TabsList>
              <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
                <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Item</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Line Item</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <Select value={itemType} onValueChange={v => setItemType(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="collection">Expected Collection</SelectItem>
                        <SelectItem value="payment">Scheduled Payment</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Description" value={itemDesc} onChange={e => setItemDesc(e.target.value)} />
                    <Input type="number" placeholder="Amount (₹)" value={itemAmt} onChange={e => setItemAmt(e.target.value)} />
                    <div>
                      <label className="text-sm font-medium">Due Date</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className={cn("w-full justify-start text-left", !itemDue && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />{itemDue ? format(itemDue, "PPP") : "Pick date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={itemDue} onSelect={setItemDue} className="p-3 pointer-events-auto" />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button className="w-full" onClick={handleAddItem}>Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {["all", "collections", "payments"].map(tab => (
              <TabsContent key={tab} value={tab}>
                <LiquidityLineItemTable
                  items={tab === "collections" ? liq.collections : tab === "payments" ? liq.payments : liq.lineItems}
                  onMarkDone={handleMarkDone}
                  onEditActual={(item) => { setEditItem(item); setEditActual(String(item.actual_amount || "")); setEditPaymentDate(undefined); }}
                  onDelete={liq.deleteLineItem}
                />
              </TabsContent>
            ))}
          </Tabs>

          {/* Edit actual amount dialog */}
          <Dialog open={!!editItem} onOpenChange={v => { if (!v) { setEditItem(null); setEditPaymentDate(undefined); } }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Update Actual Amount</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">{editItem?.description} — Expected: {formatINR(Number(editItem?.expected_amount || 0))}</p>
              <Input type="number" placeholder="Actual amount received/paid" value={editActual} onChange={e => setEditActual(e.target.value)} />
              <div>
                <label className="text-sm font-medium">Payment/Collection Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left", !editPaymentDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />{editPaymentDate ? format(editPaymentDate, "PPP") : "Today (default)"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={editPaymentDate} onSelect={setEditPaymentDate} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <Button className="w-full" onClick={handleUpdateActual}>Update</Button>
            </DialogContent>
          </Dialog>

          {/* Notes dialog */}
          <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Week Notes</DialogTitle></DialogHeader>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Add notes for this week..." rows={4} />
              <Button className="w-full" onClick={handleSaveNotes}>Save Notes</Button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
