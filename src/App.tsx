import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
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
import OrderLifecycle from "./pages/OrderLifecycle";
import SmartSegregation from "./pages/SmartSegregation";
import ProductMaster from "./pages/ProductMaster";
import UnmappedCodes from "./pages/UnmappedCodes";
import CustomerProductMapping from "./pages/CustomerProductMapping";
import LiquidityDashboard from "./pages/LiquidityDashboard";
import SupplierDashboard from "./pages/SupplierDashboard";
import Inventory from "./pages/Inventory";
import DataExport from "./pages/DataExport";
import Reconciliation from "./pages/Reconciliation";
import TallySync from "./pages/TallySync";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import OAuthConsent from "./pages/OAuthConsent";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/clients" element={<ProtectedRoute><Layout><Clients /></Layout></ProtectedRoute>} />
          <Route path="/supplier-hub" element={<ProtectedRoute><Layout><SupplierDashboard /></Layout></ProtectedRoute>} />
          <Route path="/tally-ai" element={<ProtectedRoute><Layout><TallyAI /></Layout></ProtectedRoute>} />
          
          <Route path="/bills" element={<ProtectedRoute><Layout><BillsExpenses /></Layout></ProtectedRoute>} />
          <Route path="/gmail-integration" element={<ProtectedRoute><Layout><GmailIntegration /></Layout></ProtectedRoute>} />
          <Route path="/excel-integration" element={<ProtectedRoute><Layout><ExcelIntegration /></Layout></ProtectedRoute>} />
          <Route path="/po-dashboard" element={<ProtectedRoute><Layout><PODashboard /></Layout></ProtectedRoute>} />
          <Route path="/customer-master" element={<ProtectedRoute><Layout><CustomerMaster /></Layout></ProtectedRoute>} />
          <Route path="/review" element={<ProtectedRoute><Layout><Review /></Layout></ProtectedRoute>} />
          <Route path="/order-lifecycle" element={<ProtectedRoute><Layout><OrderLifecycle /></Layout></ProtectedRoute>} />
          <Route path="/smart-segregation" element={<ProtectedRoute><SmartSegregation /></ProtectedRoute>} />
          <Route path="/product-master" element={<ProtectedRoute><Layout><ProductMaster /></Layout></ProtectedRoute>} />
          <Route path="/unmapped-codes" element={<ProtectedRoute><Layout><UnmappedCodes /></Layout></ProtectedRoute>} />
          <Route path="/customer-mapping" element={<ProtectedRoute><Layout><CustomerProductMapping /></Layout></ProtectedRoute>} />
          <Route path="/liquidity" element={<ProtectedRoute><Layout><LiquidityDashboard /></Layout></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><Layout><Inventory /></Layout></ProtectedRoute>} />
          <Route path="/data-export" element={<ProtectedRoute><Layout><DataExport /></Layout></ProtectedRoute>} />
          <Route path="/reconciliation" element={<ProtectedRoute><Layout><Reconciliation /></Layout></ProtectedRoute>} />
          <Route path="/tally-sync" element={<ProtectedRoute><Layout><TallySync /></Layout></ProtectedRoute>} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
