/**
 * App.tsx — Root application component
 *
 * Uses React.lazy + Suspense for route-level code splitting so only the
 * page the user navigates to is downloaded, dramatically reducing initial
 * bundle size and improving time-to-interactive.
 *
 * QueryClient is configured with aggressive staleTime defaults so repeated
 * navigations don't re-fetch data unnecessarily.
 */

import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loader2 } from "lucide-react";

/* ─── Lazy-loaded page components (code-split per route) ─── */
const Dashboard = lazy(() => import("./pages/Dashboard"));
const BillsExpenses = lazy(() => import("./pages/BillsExpenses"));
const Clients = lazy(() => import("./pages/Clients"));
const TallyAI = lazy(() => import("./pages/TallyAI"));
const Auth = lazy(() => import("@/pages/Auth"));
const GmailIntegration = lazy(() => import("./pages/GmailIntegration"));
const ExcelIntegration = lazy(() => import("./pages/ExcelIntegration"));
const PODashboard = lazy(() => import("./pages/PODashboard"));
const CustomerMaster = lazy(() => import("./pages/CustomerMaster"));
const Review = lazy(() => import("./pages/Review"));
const OrderLifecycle = lazy(() => import("./pages/OrderLifecycle"));
const SmartSegregation = lazy(() => import("./pages/SmartSegregation"));
const ProductMaster = lazy(() => import("./pages/ProductMaster"));
const UnmappedCodes = lazy(() => import("./pages/UnmappedCodes"));
const CustomerProductMapping = lazy(() => import("./pages/CustomerProductMapping"));
const LiquidityDashboard = lazy(() => import("./pages/LiquidityDashboard"));
const SupplierDashboard = lazy(() => import("./pages/SupplierDashboard"));
const Inventory = lazy(() => import("./pages/Inventory"));
const DataExport = lazy(() => import("./pages/DataExport"));
const Reconciliation = lazy(() => import("./pages/Reconciliation"));
const NotFound = lazy(() => import("./pages/NotFound"));

/* ─── QueryClient with optimised defaults ─── */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,     // Data stays fresh for 2 min — avoids refetch on tab switch
      gcTime: 10 * 60 * 1000,        // Cache kept for 10 min
      refetchOnWindowFocus: false,    // Don't refetch every time user switches tabs
      retry: 1,                       // Only retry once on failure
    },
  },
});

/** Full-page loading spinner shown while lazy chunks download */
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Auth — no layout wrapper */}
            <Route path="/auth" element={<Auth />} />

            {/* Main app routes wrapped in sidebar layout */}
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
            <Route path="/order-lifecycle" element={<Layout><OrderLifecycle /></Layout>} />
            <Route path="/smart-segregation" element={<Layout><SmartSegregation /></Layout>} />
            <Route path="/product-master" element={<Layout><ProductMaster /></Layout>} />
            <Route path="/unmapped-codes" element={<Layout><UnmappedCodes /></Layout>} />
            <Route path="/customer-mapping" element={<Layout><CustomerProductMapping /></Layout>} />
            <Route path="/liquidity" element={<Layout><LiquidityDashboard /></Layout>} />
            <Route path="/inventory" element={<Layout><Inventory /></Layout>} />
            <Route path="/data-export" element={<Layout><DataExport /></Layout>} />
            <Route path="/reconciliation" element={<Layout><Reconciliation /></Layout>} />

            {/* 404 fallback */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
