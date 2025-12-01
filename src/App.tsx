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
import PurchaseOrders from "./pages/PurchaseOrders";
import RawMaterialInvoices from "./pages/RawMaterialInvoices";
import ClientInvoices from "./pages/ClientInvoices";
import Approvals from "./pages/Approvals";
import TallyUpload from "./pages/TallyUpload";
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
          <Route path="/purchase-orders" element={<Layout><PurchaseOrders /></Layout>} />
          <Route path="/raw-material-invoices" element={<Layout><RawMaterialInvoices /></Layout>} />
          <Route path="/client-invoices" element={<Layout><ClientInvoices /></Layout>} />
          <Route path="/approvals" element={<Layout><Approvals /></Layout>} />
          <Route path="/tally-upload" element={<Layout><TallyUpload /></Layout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
