import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarIcon, DollarSign, Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLiquidity, LiquidityLineItem } from "@/hooks/useLiquidity";

function formatINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

function BalanceCard({ title, value, icon: Icon, subtitle }: { title: string; value: number; icon: any; subtitle?: string }) {
  const isNeg = value < 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn("h-5 w-5", isNeg ? "text-destructive" : "text-emerald-600")} />
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", isNeg ? "text-destructive" : "text-emerald-600")}>{formatINR(value)}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default function LiquidityDashboard() {
  const liq = useLiquidity();
  const [newWeekOpen, setNewWeekOpen] = useState(false);
  const [weekDate, setWeekDate] = useState<Date | undefined>(new Date());
  const [openBal, setOpenBal] = useState("");
  const [threshold, setThreshold] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemType, setItemType] = useState<"collection" | "payment">("collection");
  const [itemDesc, setItemDesc] = useState("");
  const [itemAmt, setItemAmt] = useState("");
  const [itemDue, setItemDue] = useState<Date | undefined>();
  const [editItem, setEditItem] = useState<LiquidityLineItem | null>(null);
  const [editActual, setEditActual] = useState("");

  const handleCreateWeek = async () => {
    if (!weekDate) return;
    await liq.createWeek(weekDate, Number(openBal) || 0, Number(threshold) || 0);
    setNewWeekOpen(false);
    setOpenBal("");
    setThreshold("");
  };

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
    await liq.updateLineItem(editItem.id, { actual_amount: amt, status, payment_date: format(new Date(), "yyyy-MM-dd") });
    setEditItem(null);
    setEditActual("");
  };

  if (liq.loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Liquidity Dashboard</h1>
          <p className="text-sm text-muted-foreground">Weekly Cash Flow & Supplier Payment Tracker</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {liq.weeks.length > 0 && (
            <Select value={liq.activeWeek?.id || ""} onValueChange={v => liq.setActiveWeek(liq.weeks.find(w => w.id === v) || null)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select week" /></SelectTrigger>
              <SelectContent>
                {liq.weeks.map(w => (
                  <SelectItem key={w.id} value={w.id}>Week of {format(new Date(w.week_start_date), "dd MMM yyyy")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dialog open={newWeekOpen} onOpenChange={setNewWeekOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New Week</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New Week</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Week Start Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left", !weekDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />{weekDate ? format(weekDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={weekDate} onSelect={setWeekDate} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <label className="text-sm font-medium">Opening Bank Balance (₹)</label>
                  <Input type="number" placeholder="0" value={openBal} onChange={e => setOpenBal(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Alert Threshold (₹)</label>
                  <Input type="number" placeholder="Alert when balance below..." value={threshold} onChange={e => setThreshold(e.target.value)} />
                </div>
                <Button className="w-full" onClick={handleCreateWeek}>Create Week</Button>
              </div>
            </DialogContent>
          </Dialog>
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

      {!liq.activeWeek ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Wallet className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>No week set up yet. Click "New Week" to start tracking.</p>
        </CardContent></Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <BalanceCard title="Opening Balance" value={liq.openingBalance} icon={DollarSign} />
            <BalanceCard title="Projected End Balance" value={liq.projectedEndBalance} icon={TrendingUp} subtitle={`Collections: ${formatINR(liq.totalExpectedCollections)} | Payments: ${formatINR(liq.totalScheduledPayments)}`} />
            <BalanceCard title="Actual Balance" value={liq.actualBalance} icon={Wallet} subtitle={`In: ${formatINR(liq.totalActualCollections)} | Out: ${formatINR(liq.totalActualPayments)}`} />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Variance</CardTitle>
                {liq.actualBalance >= liq.projectedEndBalance ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-bold", (liq.actualBalance - liq.projectedEndBalance) >= 0 ? "text-emerald-600" : "text-destructive")}>
                  {formatINR(liq.actualBalance - liq.projectedEndBalance)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Actual vs Projected</p>
              </CardContent>
            </Card>
          </div>

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
                <LineItemTable
                  items={tab === "collections" ? liq.collections : tab === "payments" ? liq.payments : liq.lineItems}
                  onMarkDone={handleMarkDone}
                  onEditActual={(item) => { setEditItem(item); setEditActual(String(item.actual_amount || "")); }}
                  onDelete={liq.deleteLineItem}
                />
              </TabsContent>
            ))}
          </Tabs>

          {/* Edit actual amount dialog */}
          <Dialog open={!!editItem} onOpenChange={v => { if (!v) setEditItem(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Update Actual Amount</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">{editItem?.description} — Expected: {formatINR(Number(editItem?.expected_amount || 0))}</p>
              <Input type="number" placeholder="Actual amount received/paid" value={editActual} onChange={e => setEditActual(e.target.value)} />
              <Button className="w-full" onClick={handleUpdateActual}>Update</Button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function LineItemTable({ items, onMarkDone, onEditActual, onDelete }: {
  items: LiquidityLineItem[];
  onMarkDone: (item: LiquidityLineItem) => void;
  onEditActual: (item: LiquidityLineItem) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return <Card><CardContent className="p-8 text-center text-muted-foreground">No items yet.</CardContent></Card>;
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              <TableCell>
                {item.item_type === "collection" ? (
                  <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400"><ArrowDownCircle className="h-3 w-3 mr-1" />In</Badge>
                ) : (
                  <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-900/20 dark:text-red-400"><ArrowUpCircle className="h-3 w-3 mr-1" />Out</Badge>
                )}
              </TableCell>
              <TableCell className="font-medium">{item.description}</TableCell>
              <TableCell className="text-right">{formatINR(Number(item.expected_amount))}</TableCell>
              <TableCell className="text-right">{item.actual_amount ? formatINR(Number(item.actual_amount)) : "—"}</TableCell>
              <TableCell>{item.due_date ? format(new Date(item.due_date), "dd MMM") : "—"}</TableCell>
              <TableCell>
                <Badge variant={item.status === "completed" ? "default" : item.status === "partial" ? "secondary" : item.status === "overdue" ? "destructive" : "outline"}>
                  {item.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-1 justify-end">
                  {item.status !== "completed" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => onMarkDone(item)}>✓ Done</Button>
                      <Button size="sm" variant="ghost" onClick={() => onEditActual(item)}>Update</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(item.id)}>×</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
