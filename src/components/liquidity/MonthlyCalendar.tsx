import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/StatusBadge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, addMonths, subMonths, getDay, startOfMonth, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import { MonthlyPaymentDay } from "@/hooks/useLiquidity";

function formatINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

interface Props {
  monthlyData: MonthlyPaymentDay[];
  onMonthChange: (month: Date) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthlyPaymentCalendar({ monthlyData, onMonthChange }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<MonthlyPaymentDay | null>(null);

  const handlePrev = () => {
    const prev = subMonths(currentMonth, 1);
    setCurrentMonth(prev);
    onMonthChange(prev);
  };
  const handleNext = () => {
    const next = addMonths(currentMonth, 1);
    setCurrentMonth(next);
    onMonthChange(next);
  };

  const firstDayOfMonth = startOfMonth(currentMonth);
  const startPadding = getDay(firstDayOfMonth);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">Monthly Cash Flow Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">{format(currentMonth, "MMMM yyyy")}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
              <span className="text-muted-foreground">Supplier Payments</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Customer Collections</span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
            ))}
            {Array.from({ length: startPadding }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            <TooltipProvider delayDuration={200}>
              {monthlyData.map(day => {
                const today = isToday(day.date);
                const hasPayments = day.supplierCount > 0;
                const hasCollections = day.collectionCount > 0;
                const hasActivity = hasPayments || hasCollections;
                return (
                  <Tooltip key={day.dateStr}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "relative flex flex-col items-center justify-start rounded-md p-1 min-h-[56px] border transition-colors",
                          today && "ring-2 ring-primary",
                          hasPayments && !hasCollections && "bg-destructive/5 border-destructive/20",
                          hasCollections && !hasPayments && "bg-green-50 border-green-200",
                          hasPayments && hasCollections && "bg-amber-50 border-amber-200",
                          hasActivity ? "cursor-pointer hover:bg-muted/50" : "border-transparent hover:bg-muted/50 cursor-default"
                        )}
                        onClick={() => hasActivity && setSelectedDay(day)}
                      >
                        <span className={cn("text-xs", today ? "font-bold text-primary" : "text-muted-foreground")}>
                          {format(day.date, "d")}
                        </span>
                        <div className="flex gap-0.5 mt-1">
                          {hasPayments && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 leading-4">
                              {day.supplierCount}
                            </Badge>
                          )}
                          {hasCollections && (
                            <Badge className="bg-green-500 hover:bg-green-500 text-white text-[10px] px-1.5 py-0 leading-4">
                              {day.collectionCount}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TooltipTrigger>
                    {hasActivity && (
                      <TooltipContent side="top" className="max-w-[250px]">
                        <p className="font-medium text-xs mb-1">{format(day.date, "dd MMM yyyy")}</p>
                        {hasPayments && (
                          <p className="text-xs text-destructive">{day.supplierCount} payment{day.supplierCount > 1 ? "s" : ""} · {formatINR(day.totalAmount)}</p>
                        )}
                        {hasCollections && (
                          <p className="text-xs text-green-600">{day.collectionCount} collection{day.collectionCount > 1 ? "s" : ""} · {formatINR(day.totalCollectionAmount)}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">Click to view details</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {/* Day Detail Dialog */}
      <Dialog open={!!selectedDay} onOpenChange={v => { if (!v) setSelectedDay(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Cash Flow — {selectedDay && format(selectedDay.date, "dd MMMM yyyy")}
            </DialogTitle>
          </DialogHeader>
          {selectedDay && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex gap-4 text-sm flex-wrap">
                {selectedDay.supplierCount > 0 && (
                  <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
                    <span className="text-muted-foreground">Payments:</span>{" "}
                    <span className="font-semibold">{selectedDay.supplierCount}</span>
                    <span className="text-destructive font-semibold ml-2">{formatINR(selectedDay.totalAmount)}</span>
                  </div>
                )}
                {selectedDay.collectionCount > 0 && (
                  <div className="px-3 py-2 rounded-lg bg-green-50 border border-green-200">
                    <span className="text-muted-foreground">Collections:</span>{" "}
                    <span className="font-semibold">{selectedDay.collectionCount}</span>
                    <span className="text-green-600 font-semibold ml-2">{formatINR(selectedDay.totalCollectionAmount)}</span>
                  </div>
                )}
              </div>

              {/* Payments Table */}
              {selectedDay.supplierCount > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-destructive mb-2">Supplier Payments</h4>
                  <div className="bg-card rounded-lg border border-destructive/20">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Supplier / Description</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Actual</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedDay.items.map(item => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium max-w-[250px] truncate">{item.description}</TableCell>
                            <TableCell className="text-right">{formatINR(Number(item.expected_amount))}</TableCell>
                            <TableCell className="text-right">
                              {item.actual_amount ? formatINR(Number(item.actual_amount)) : "—"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={item.status as any} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Collections Table */}
              {selectedDay.collectionCount > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-green-600 mb-2">Customer Collections</h4>
                  <div className="bg-card rounded-lg border border-green-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer / Description</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Actual</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedDay.collectionItems.map(item => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium max-w-[250px] truncate">{item.description}</TableCell>
                            <TableCell className="text-right">{formatINR(Number(item.expected_amount))}</TableCell>
                            <TableCell className="text-right">
                              {item.actual_amount ? formatINR(Number(item.actual_amount)) : "—"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={item.status as any} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
