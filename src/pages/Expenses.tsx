import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  TrendingUp,
  Receipt,
  CreditCard,
  Calendar,
  Loader2,
  Edit,
  Save,
  X,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Bill {
  id: string;
  bill_number: string;
  vendor_name: string;
  bill_date: string;
  total_amount: number;
  payment_status: string;
  category_id: string | null;
  expense_categories?: {
    name: string;
    color: string;
  };
}

interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
  description: string;
}

interface CategoryStats {
  category: string;
  color: string;
  total: number;
  count: number;
}

export default function Expenses() {
  const [selectedMonth, setSelectedMonth] = useState(
    format(new Date(), "yyyy-MM")
  );
  const [editingBill, setEditingBill] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<string>("");
  const [editStatus, setEditStatus] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: categories } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data as ExpenseCategory[];
    },
  });

  const { data: bills, isLoading } = useQuery({
    queryKey: ["expenses", selectedMonth],
    queryFn: async () => {
      const startDate = startOfMonth(new Date(selectedMonth + "-01"));
      const endDate = endOfMonth(new Date(selectedMonth + "-01"));

      const { data, error } = await supabase
        .from("bills")
        .select(
          `
          *,
          expense_categories(name, color)
        `
        )
        .gte("bill_date", format(startDate, "yyyy-MM-dd"))
        .lte("bill_date", format(endDate, "yyyy-MM-dd"))
        .order("bill_date", { ascending: false });

      if (error) throw error;
      return data as Bill[];
    },
  });

  const updateBillMutation = useMutation({
    mutationFn: async ({
      billId,
      categoryId,
      paymentStatus,
    }: {
      billId: string;
      categoryId?: string;
      paymentStatus?: string;
    }) => {
      const updates: any = {};
      if (categoryId) updates.category_id = categoryId;
      if (paymentStatus) updates.payment_status = paymentStatus;

      const { error } = await supabase
        .from("bills")
        .update(updates)
        .eq("id", billId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bill updated successfully");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setEditingBill(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update bill: ${error.message}`);
    },
  });

  const stats = bills
    ? {
        total: bills.reduce((sum, bill) => sum + bill.total_amount, 0),
        paid: bills.filter((b) => b.payment_status === "paid").length,
        pending: bills.filter((b) => b.payment_status === "pending").length,
        count: bills.length,
      }
    : { total: 0, paid: 0, pending: 0, count: 0 };

  const categoryStats: CategoryStats[] = bills
    ? Object.values(
        bills.reduce((acc, bill) => {
          const categoryName =
            bill.expense_categories?.name || "Uncategorized";
          const categoryColor = bill.expense_categories?.color || "#6b7280";

          if (!acc[categoryName]) {
            acc[categoryName] = {
              category: categoryName,
              color: categoryColor,
              total: 0,
              count: 0,
            };
          }

          acc[categoryName].total += bill.total_amount;
          acc[categoryName].count += 1;

          return acc;
        }, {} as Record<string, CategoryStats>)
      ).sort((a, b) => b.total - a.total)
    : [];

  const handleEdit = (bill: Bill) => {
    setEditingBill(bill.id);
    setEditCategory(bill.category_id || "");
    setEditStatus(bill.payment_status);
  };

  const handleSave = (billId: string) => {
    updateBillMutation.mutate({
      billId,
      categoryId: editCategory,
      paymentStatus: editStatus,
    });
  };

  const handleCancel = () => {
    setEditingBill(null);
    setEditCategory("");
    setEditStatus("");
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Expense Tracking</h1>
          <p className="text-muted-foreground">
            Monitor and categorize your business expenses
          </p>
        </div>
        <div className="w-48">
          <Label>Select Month</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Expenses
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{stats.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.count} bills this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid Bills</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.paid}</div>
            <p className="text-xs text-muted-foreground">
              {((stats.paid / (stats.count || 1)) * 100).toFixed(0)}% of total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Payment
            </CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">
              Requires attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg per Bill
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{(stats.total / (stats.count || 1)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            <p className="text-xs text-muted-foreground">Average expense</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expenses by Category</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : categoryStats.length > 0 ? (
            <div className="space-y-4">
              {categoryStats.map((stat) => (
                <div key={stat.category} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: stat.color }}
                      />
                      <span className="text-sm font-medium">
                        {stat.category}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {stat.count} bills
                      </Badge>
                    </div>
                    <span className="text-sm font-bold">
                      ₹{stat.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${(stat.total / stats.total) * 100}%`,
                        backgroundColor: stat.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No expenses recorded for this month
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : bills && bills.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Bill Number</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((bill) => (
                    <TableRow key={bill.id}>
                      <TableCell>
                        {format(new Date(bill.bill_date), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="font-medium">
                        {bill.vendor_name}
                      </TableCell>
                      <TableCell>{bill.bill_number || "N/A"}</TableCell>
                      <TableCell>
                        {editingBill === bill.id ? (
                          <Select
                            value={editCategory}
                            onValueChange={setEditCategory}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories?.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            style={{
                              backgroundColor:
                                bill.expense_categories?.color || "#6b7280",
                            }}
                          >
                            {bill.expense_categories?.name || "Uncategorized"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingBill === bill.id ? (
                          <Select
                            value={editStatus}
                            onValueChange={setEditStatus}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                              <SelectItem value="overdue">Overdue</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            variant={
                              bill.payment_status === "paid"
                                ? "default"
                                : bill.payment_status === "pending"
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {bill.payment_status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{bill.total_amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingBill === bill.id ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSave(bill.id)}
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancel}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(bill)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No expenses recorded for this month
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
