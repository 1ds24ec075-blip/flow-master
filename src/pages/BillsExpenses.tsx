import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Bills from "./Bills";
import Expenses from "./Expenses";

export default function BillsExpenses() {
  const [tab, setTab] = useState("bills");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bills & Expenses</h1>
        <p className="text-muted-foreground">Upload bills, track expenses, and manage payments</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="expenses">Expense Tracking</TabsTrigger>
        </TabsList>

        <TabsContent value="bills" className="mt-4">
          <Bills embedded />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Expenses embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
