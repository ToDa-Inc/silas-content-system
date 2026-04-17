import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Calendar,
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
  { href: "/generate", label: "Create video", icon: Sparkles },
  { href: "/media", label: "Media", icon: FolderOpen },
  { href: "/scheduling", label: "Scheduling", icon: Calendar },
  { href: "/context", label: "Context", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];
