import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Download,
  FolderOpen,
  ListTodo,
  BrainCircuit,
  Rss,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
} from "lucide-react";
import { cn } from "./ui/utils";
import { useQuery } from "@tanstack/react-query";
import { fetchAllHealth } from "../api/health";
import { Button } from "./ui/button";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/subscriptions", label: "Subscriptions", icon: Rss },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/batch", label: "Batch Tasks", icon: ListTodo },
  { to: "/ai-jobs", label: "AI Processing", icon: BrainCircuit },
  { to: "/settings", label: "Settings", icon: Settings },
];

function ServiceDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span
        className={cn(
          "h-2 w-2 rounded-full flex-shrink-0",
          ok ? "bg-green-500" : "bg-red-500",
        )}
        aria-label={`${label}: ${ok ? "online" : "offline"}`}
      />
      <span className="text-xs text-muted-foreground truncate">{label}</span>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchAllHealth,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-card border-r transition-all duration-300",
        collapsed ? "w-16" : "w-56",
      )}
      aria-label="Sidebar navigation"
    >
      {/* Logo / Brand */}
      <div className="flex items-center h-16 border-b px-3 gap-2">
        <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-primary">
          <Activity className="text-primary-foreground" size={18} />
        </div>
        {!collapsed && (
          <span className="font-semibold text-sm truncate">MediaGo Admin</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
                collapsed && "justify-center",
              )
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Service health indicators */}
      {!collapsed && (
        <div className="border-t py-3 space-y-0.5">
          <p className="px-3 text-xs font-medium text-muted-foreground mb-1">
            Services
          </p>
          <ServiceDot ok={health?.go.ok ?? false} label="Go Backend" />
          <ServiceDot ok={health?.ai.ok ?? false} label="AI Service" />
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </Button>
      </div>
    </aside>
  );
}
