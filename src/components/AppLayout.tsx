import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, LayoutDashboard, ClipboardList, Clock, Users, ListChecks, CalendarRange, Settings2 } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { NotificationBell } from "./NotificationBell";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  if (!user) return null;

  const isAdmin = user.role === "ADMIN";
  const items: NavItem[] = isAdmin
    ? [
        { href: "/", label: "Dashboard",       icon: <LayoutDashboard size={16} /> },
        { href: "/users", label: "Users",      icon: <Users size={16} /> },
        { href: "/tasks", label: "Tasks",      icon: <ListChecks size={16} /> },
        { href: "/timesheets", label: "Timesheets", icon: <CalendarRange size={16} /> },
        { href: "/manage", label: "Manage",    icon: <Settings2 size={16} /> },
      ]
    : [
        { href: "/", label: "Dashboard",       icon: <LayoutDashboard size={16} /> },
        { href: "/my-tasks", label: "My Tasks", icon: <ClipboardList size={16} /> },
        { href: "/my-timesheet", label: "My Timesheet", icon: <Clock size={16} /> },
      ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="border-b border-gray-200 bg-white/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center text-black font-display font-bold text-sm">K</div>
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold tracking-tight text-gray-900">KubeGraf</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Internal Time Sheet</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className={user.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"}>{user.role}</span>
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-sm text-gray-900">{user.name || user.email}</span>
              <span className="text-[11px] text-gray-500">{user.email}</span>
            </div>
            <button onClick={logout} className="ko-btn-ghost h-9 px-3 text-xs inline-flex items-center gap-1.5" title="Sign out">
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <aside className="md:sticky md:top-20 self-start">
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {items.map((it) => {
              const active = location === it.href || (it.href !== "/" && location.startsWith(it.href));
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition border whitespace-nowrap " +
                    (active
                      ? "bg-brand-50 text-brand-800 border-brand-200"
                      : "text-gray-700 hover:text-gray-900 border-transparent hover:bg-gray-50")
                  }
                >
                  {it.icon} {it.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>

      <footer className="border-t border-gray-200 py-6 text-center text-[11px] text-gray-400">
        KubeGraf · Internal use only · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
