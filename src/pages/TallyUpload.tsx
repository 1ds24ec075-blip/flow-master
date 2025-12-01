import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload } from "lucide-react";
import { toast } from "sonner";

export default function TallyUpload() {
  const { data: invoices } = useQuery({
    queryKey: ["tally_ready"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_invoices")
        .select("*, clients(name)")
        .eq("status", "approved")
        .eq("tally_uploaded", false);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Tally Upload</h1>
        <p className="text-muted-foreground">Export approved invoices to Tally</p>
      </div>
      <div className="bg-card rounded-lg border">
        {invoices && invoices.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                  <TableCell>{invoice.clients?.name}</TableCell>
                  <TableCell>₹{invoice.amount?.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => toast.success("Exported to Tally")}>
                      <Upload className="h-4 w-4 mr-1" />
                      Upload
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-8 text-center text-muted-foreground">No invoices ready for upload.</div>
        )}
      </div>
    </div>
  );
}
