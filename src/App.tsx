import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Suppliers from "./pages/Suppliers";
import Quotations from "./pages/Quotations";
import RawMaterialInvoices from "./pages/RawMaterialInvoices";
import ClientInvoices from "./pages/ClientInvoices";
import Approvals from "./pages/Approvals";
import TallyUpload from "./pages/TallyUpload";
import TallyAI from "./pages/TallyAI";
import BankStatementParser from "./pages/BankStatementParser";
import Bills from "./pages/Bills";
import Expenses from "./pages/Expenses";
import GmailIntegration from "./pages/GmailIntegration";
import PODashboard from "./pages/PODashboard";
import CustomerMaster from "./pages/CustomerMaster";
import Review from "./pages/Review";
import SmartSegregation from "./pages/SmartSegregation";
import ProductMaster from "./pages/ProductMaster";
import UnmappedCodes from "./pages/UnmappedCodes";
import CustomerProductMapping from "./pages/CustomerProductMapping";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout><Dashboard /></Layout>} />
          <Route path="/clients" element={<Layout><Clients /></Layout>} />
          <Route path="/suppliers" element={<Layout><Suppliers /></Layout>} />
          <Route path="/quotations" element={<Layout><Quotations /></Layout>} />
          <Route path="/raw-material-invoices" element={<Layout><RawMaterialInvoices /></Layout>} />
          <Route path="/client-invoices" element={<Layout><ClientInvoices /></Layout>} />
          <Route path="/approvals" element={<Layout><Approvals /></Layout>} />
          <Route path="/tally-upload" element={<Layout><TallyUpload /></Layout>} />
          <Route path="/tally-ai" element={<Layout><TallyAI /></Layout>} />
          <Route path="/bank-statement-parser" element={<Layout><BankStatementParser /></Layout>} />
          <Route path="/bills" element={<Layout><Bills /></Layout>} />
          <Route path="/expenses" element={<Layout><Expenses /></Layout>} />
          <Route path="/gmail-integration" element={<Layout><GmailIntegration /></Layout>} />
          <Route path="/po-dashboard" element={<Layout><PODashboard /></Layout>} />
          <Route path="/customer-master" element={<Layout><CustomerMaster /></Layout>} />
          <Route path="/review" element={<Layout><Review /></Layout>} />
          <Route path="/smart-segregation" element={<SmartSegregation />} />
          <Route path="/product-master" element={<Layout><ProductMaster /></Layout>} />
          <Route path="/unmapped-codes" element={<Layout><UnmappedCodes /></Layout>} />
          <Route path="/customer-mapping" element={<Layout><CustomerProductMapping /></Layout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
