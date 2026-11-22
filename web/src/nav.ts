import type { LucideIcon } from "lucide-react";
import { DatabaseBackup, GraduationCap, LayoutDashboard, Mail, Network, RefreshCw, ScrollText, Server, TerminalSquare, Users } from "lucide-react";
import type { Role } from "./api";

export type NavItem = { path: string; label: string; icon: LucideIcon; roles?: Role[]; phase?: number };
export type NavGroup = { label: string; items: NavItem[] };

export const navigation: NavGroup[] = [
  {
    label: "nav.lab",
    items: [
      { path: "/", label: "nav.dashboard", icon: LayoutDashboard },
      { path: "/topologies", label: "nav.topologies", icon: Network },
      { path: "/devices", label: "nav.devices", icon: Server },
      { path: "/console", label: "nav.console", icon: TerminalSquare },
      { path: "/lessons", label: "nav.lessons", icon: GraduationCap },
    ],
  },
  {
    label: "nav.administration",
    items: [
      { path: "/admin/users", label: "nav.users", icon: Users, roles: ["admin"] },
      { path: "/admin/mail", label: "nav.mail", icon: Mail, roles: ["admin"] },
      { path: "/admin/backup", label: "nav.backup", icon: DatabaseBackup, roles: ["admin"] },
      { path: "/admin/updates", label: "nav.updates", icon: RefreshCw, roles: ["admin"] },
      { path: "/admin/audit", label: "nav.audit", icon: ScrollText, roles: ["admin"] },
    ],
  },
];
