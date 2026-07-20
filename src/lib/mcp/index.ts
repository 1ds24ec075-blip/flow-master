import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getSystemSummary from "./tools/get-system-summary";
import getClients from "./tools/get-clients";
import getSuppliers from "./tools/get-suppliers";
import getInvoices from "./tools/get-invoices";
import getBills from "./tools/get-bills";
import getInventory from "./tools/get-inventory";
import getPurchaseOrders from "./tools/get-purchase-orders";
import getApprovals from "./tools/get-approvals";
import updateApproval from "./tools/update-approval";
import createReorder from "./tools/create-reorder";

// Direct Supabase issuer (never the .lovable.cloud proxy). Vite inlines
// VITE_SUPABASE_PROJECT_ID as a literal at build time so this stays import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "talligence-mcp",
  title: "Talligence MCP",
  version: "1.0.0",
  instructions:
    "Read and act on Talligence business data (clients, suppliers, invoices, bills, purchase orders, inventory, approvals). All calls are scoped to the signed-in user via Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getSystemSummary,
    getClients,
    getSuppliers,
    getInvoices,
    getBills,
    getInventory,
    getPurchaseOrders,
    getApprovals,
    updateApproval,
    createReorder,
  ],
});
