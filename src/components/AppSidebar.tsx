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
  LogIn,
  Boxes,
  ShieldCheck,
  Download,
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
  { title: "Order Lifecycle", url: "/order-lifecycle", icon: ShieldCheck },
  { title: "Smart Segregation", url: "/smart-segregation", icon: Sparkles },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "Supplier Hub", url: "/supplier-hub", icon: Package },
  { title: "Inventory", url: "/inventory", icon: Boxes },
  { title: "Bills & Expenses", url: "/bills", icon: Camera },
  { title: "Liquidity Dashboard", url: "/liquidity", icon: Wallet },
  { title: "Gmail Integration", url: "/gmail-integration", icon: Mail },
  { title: "Excel Integration", url: "/excel-integration", icon: FileSpreadsheet },
  { title: "Data Export", url: "/data-export", icon: Download },
  { title: "Sign In", url: "/auth", icon: LogIn },
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
