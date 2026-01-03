import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  Receipt,
  FileCheck,
  CheckCircle,
  Upload,
  ScanLine,
  Bot,
  Landmark,
  Camera,
  TrendingDown,
  Mail,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
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
  { title: "Smart Segregation", url: "/smart-segregation", icon: Sparkles },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "Suppliers", url: "/suppliers", icon: Package },
  { title: "Quotations", url: "/quotations", icon: FileText },
  { title: "Raw Material Invoices", url: "/raw-material-invoices", icon: Receipt },
  { title: "Client Invoices", url: "/client-invoices", icon: FileCheck },
  { title: "Approvals", url: "/approvals", icon: CheckCircle },
  { title: "Tally Upload", url: "/tally-upload", icon: Upload },
  { title: "Bank Statement Parser", url: "/bank-statement-parser", icon: Landmark },
  { title: "Bills", url: "/bills", icon: Camera },
  { title: "Expenses", url: "/expenses", icon: TrendingDown },
  { title: "Gmail Integration", url: "/gmail-integration", icon: Mail },
];

export function AppSidebar() {
  const { open } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      <SidebarContent className="bg-sidebar">
        <div className="p-2 border-b border-sidebar-border">
          <h1 className={`font-bold text-sidebar-foreground ${open ? "text-base" : "text-xs"}`}>
            {open ? "Workflow System" : "WS"}
          </h1>
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
                    <SidebarMenuButton asChild isActive={isActive}>
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors hover:bg-sidebar-accent text-sm"
                        activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        {open && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
