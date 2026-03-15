/**
 * Layout.tsx — Shared shell for authenticated pages
 *
 * Wraps pages with the collapsible sidebar and top header bar.
 * Uses React.memo to prevent unnecessary re-renders of the sidebar
 * when only the page content changes.
 */

import { memo } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

/** Memoised sidebar — only re-renders when its own props change */
const MemoizedSidebar = memo(AppSidebar);

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <MemoizedSidebar />
        <main className="flex-1 flex flex-col">
          {/* Top header bar with sidebar toggle */}
          <header className="h-16 border-b border-border bg-card flex items-center px-6">
            <SidebarTrigger className="mr-4" />
            <h2 className="text-lg font-semibold">Company Workflow Automation</h2>
          </header>
          {/* Page content area */}
          <div className="flex-1 p-6 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
