import {
  LayoutDashboard,
  Users,
  Package,
  Bot,
  Camera,
  Mail,
  Wallet,
  ClipboardList,
  Sparkles,
  FileSpreadsheet,
  LogOut,
  Boxes,
  ShieldCheck,
  Download,
  GitCompareArrows,
  Plug,
  Building2,
  Check,
  ChevronsUpDown,
  AlertTriangle,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navigationItems = [
  { title: "Talligence", url: "/", icon: LayoutDashboard },
  { title: "Ask AI", url: "/tally-ai", icon: Bot },
  { title: "PO Dashboard", url: "/po-dashboard", icon: ClipboardList },
  { title: "Order Lifecycle", url: "/order-lifecycle", icon: ShieldCheck },
  { title: "Smart Segregation", url: "/smart-segregation", icon: Sparkles },
  { title: "Reconciliation", url: "/reconciliation", icon: GitCompareArrows },

  { title: "Supplier Hub", url: "/supplier-hub", icon: Package },
  { title: "Inventory", url: "/inventory", icon: Boxes },
  { title: "Bills & Expenses", url: "/bills", icon: Camera },
  { title: "Liquidity Dashboard", url: "/liquidity", icon: Wallet },
  { title: "Gmail Integration", url: "/gmail-integration", icon: Mail },
  // Excel/Microsoft integration is disabled during the Supabase migration
  // (Azure OAuth callback is not being re-registered). Restore this line to re-enable.
  // { title: "Excel Integration", url: "/excel-integration", icon: FileSpreadsheet },
  { title: "Data Export", url: "/data-export", icon: Download },
  { title: "Tally Sync", url: "/tally-sync", icon: Plug },
];

/**
 * Active company, plus the switcher.
 *
 * Deliberately always rendered, even for a single-company user: the label is
 * how someone confirms which books they are looking at before sending a
 * voucher to Tally, and hiding it in the one-company case would mean the
 * multi-company path is the only one anyone ever sees tested.
 */
function CompanySwitcher({ expanded }: { expanded: boolean }) {
  const { status, activeCompany, activeCompanyId, companies, selectCompany } = useCompany();

  const label =
    status === "loading"
      ? "Loading…"
      : activeCompany?.name ?? (status === "no-membership" ? "No company" : "Select company");

  const blocked = activeCompanyId === null && status !== "loading";

  if (!expanded) {
    return (
      <div className="flex justify-center py-1.5" title={label}>
        {blocked ? (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        ) : (
          <Building2 className="h-4 w-4 text-sidebar-foreground/70" />
        )}
      </div>
    );
  }

  // Nothing to switch between: show the state, not a menu that does nothing.
  if (companies.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] leading-tight">
        {blocked ? (
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-destructive" />
        ) : (
          <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-sidebar-foreground/70" />
        )}
        <span className={blocked ? "truncate text-destructive" : "truncate text-sidebar-foreground"}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] leading-tight transition-colors hover:bg-sidebar-accent">
        {blocked ? (
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-destructive" />
        ) : (
          <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-sidebar-foreground/70" />
        )}
        <span
          className={
            blocked
              ? "flex-1 truncate text-left text-destructive"
              : "flex-1 truncate text-left text-sidebar-foreground"
          }
        >
          {label}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-sidebar-foreground/50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Switch company</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.companyId}
            onSelect={() => selectCompany(company.companyId)}
            className="gap-2"
          >
            <Check
              className={
                company.companyId === activeCompanyId
                  ? "h-3.5 w-3.5 flex-shrink-0 opacity-100"
                  : "h-3.5 w-3.5 flex-shrink-0 opacity-0"
              }
            />
            <span className="flex-1 truncate">{company.name}</span>
            <span className="text-xs text-muted-foreground">{company.role}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const { open } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      <SidebarContent className="bg-sidebar">
        <div className="p-2 border-b border-sidebar-border">
          <h1 className={`font-bold text-sidebar-foreground ${open ? "text-base" : "text-xs"}`}>
            {open ? "Workflow System" : "WS"}
          </h1>
        </div>

        <div className="border-b border-sidebar-border py-1">
          <CompanySwitcher expanded={open} />
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60 text-xs py-1">
            {open ? "Navigation" : ""}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const isActive = currentPath === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive} className="h-auto min-h-0 py-0 px-0">
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors hover:bg-sidebar-accent text-[13px] leading-tight"
                        activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      >
                        <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                        {open && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleSignOut}
                  className="h-auto min-h-0 gap-2 px-2.5 py-1.5 text-[13px] leading-tight hover:bg-sidebar-accent"
                  tooltip="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
                  {open && <span>Sign Out</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
