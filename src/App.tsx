import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import BillsExpenses from "./pages/BillsExpenses";
import Clients from "./pages/Clients";
import Quotations from "./pages/Quotations";
import ClientInvoices from "./pages/ClientInvoices";
import Approvals from "./pages/Approvals";
import TallyUpload from "./pages/TallyUpload";
import TallyAI from "./pages/TallyAI";
import Auth from "@/pages/Auth";
import Bills from "./pages/Bills";
import Expenses from "./pages/Expenses";
import GmailIntegration from "./pages/GmailIntegration";
import ExcelIntegration from "./pages/ExcelIntegration";
import PODashboard from "./pages/PODashboard";
import CustomerMaster from "./pages/CustomerMaster";
import Review from "./pages/Review";
import SmartSegregation from "./pages/SmartSegregation";
import ProductMaster from "./pages/ProductMaster";
import UnmappedCodes from "./pages/UnmappedCodes";
import CustomerProductMapping from "./pages/CustomerProductMapping";
import LiquidityDashboard from "./pages/LiquidityDashboard";
import SupplierDashboard from "./pages/SupplierDashboard";
import Inventory from "./pages/Inventory";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<Layout><Dashboard /></Layout>} />
          <Route path="/clients" element={<Layout><Clients /></Layout>} />
          <Route path="/supplier-hub" element={<Layout><SupplierDashboard /></Layout>} />
          <Route path="/tally-ai" element={<Layout><TallyAI /></Layout>} />
          
          <Route path="/bills" element={<Layout><BillsExpenses /></Layout>} />
          <Route path="/gmail-integration" element={<Layout><GmailIntegration /></Layout>} />
          <Route path="/excel-integration" element={<Layout><ExcelIntegration /></Layout>} />
          <Route path="/po-dashboard" element={<Layout><PODashboard /></Layout>} />
          <Route path="/customer-master" element={<Layout><CustomerMaster /></Layout>} />
          <Route path="/review" element={<Layout><Review /></Layout>} />
          <Route path="/smart-segregation" element={<SmartSegregation />} />
          <Route path="/product-master" element={<Layout><ProductMaster /></Layout>} />
          <Route path="/unmapped-codes" element={<Layout><UnmappedCodes /></Layout>} />
          <Route path="/customer-mapping" element={<Layout><CustomerProductMapping /></Layout>} />
          <Route path="/liquidity" element={<Layout><LiquidityDashboard /></Layout>} />
          <Route path="/inventory" element={<Layout><Inventory /></Layout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
