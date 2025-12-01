import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";

export default function Approvals() {
  const { data: approvals, isLoading } = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Approvals</h1>
        <p className="text-muted-foreground">Review and approve invoices</p>
      </div>
      <div className="bg-card rounded-lg border">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        ) : approvals && approvals.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((approval) => (
                <TableRow key={approval.id}>
                  <TableCell className="font-medium">{approval.linked_invoice_type}</TableCell>
                  <TableCell><StatusBadge status={approval.status} /></TableCell>
                  <TableCell>{approval.approved_by || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-8 text-center text-muted-foreground">No approvals pending.</div>
        )}
      </div>
    </div>
  );
}
