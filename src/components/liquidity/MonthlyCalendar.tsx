import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, addMonths, subMonths, getDay, startOfMonth, isSameDay, isToday } from "date-fns";
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
  const startPadding = getDay(firstDayOfMonth); // 0=Sun

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">Monthly Supplier Payments</CardTitle>
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
              return (
                <Tooltip key={day.dateStr}>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      "relative flex flex-col items-center justify-start rounded-md p-1 min-h-[56px] border transition-colors cursor-default",
                      today && "ring-2 ring-primary",
                      day.supplierCount > 0 ? "bg-destructive/5 border-destructive/20" : "border-transparent hover:bg-muted/50"
                    )}>
                      <span className={cn("text-xs", today ? "font-bold text-primary" : "text-muted-foreground")}>
                        {format(day.date, "d")}
                      </span>
                      {day.supplierCount > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 mt-1 leading-4">
                          {day.supplierCount}
                        </Badge>
                      )}
                    </div>
                  </TooltipTrigger>
                  {day.supplierCount > 0 && (
                    <TooltipContent side="top" className="max-w-[250px]">
                      <p className="font-medium text-xs mb-1">{format(day.date, "dd MMM yyyy")} — {day.supplierCount} payment{day.supplierCount > 1 ? "s" : ""}</p>
                      <p className="text-xs text-muted-foreground mb-1">Total: {formatINR(day.totalAmount)}</p>
                      <ul className="text-xs space-y-0.5">
                        {day.supplierNames.slice(0, 5).map((name, i) => (
                          <li key={i} className="truncate">• {name}</li>
                        ))}
                        {day.supplierNames.length > 5 && <li className="text-muted-foreground">+{day.supplierNames.length - 5} more</li>}
                      </ul>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
