import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Calendar,
  Clapperboard,
  Database,
  FolderOpen,
  LayoutDashboard,
  Settings,
  Sparkles,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const mainNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/intelligence", label: "Intelligence", icon: BarChart3 },
  { href: "/generate", label: "Generate", icon: Sparkles },
  { href: "/create", label: "Create", icon: Clapperboard },
  { href: "/media", label: "Media", icon: FolderOpen },
  { href: "/scheduling", label: "Scheduling", icon: Calendar },
  { href: "/context", label: "Context", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];
