import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LogOut, LayoutDashboard, ClipboardList, Clock, Users, ListChecks,
  CalendarRange, Settings2,
} from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { NotificationBell } from "./NotificationBell";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  if (!user) return null;

  const isAdmin = user.role === "ADMIN";
  const groups: NavGroup[] = isAdmin
    ? [
        {
          label: "Workspace",
          items: [
            { href: "/", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
          ],
        },
        {
          label: "Administration",
          items: [
            { href: "/users", label: "Users", icon: <Users size={16} /> },
            { href: "/tasks", label: "Tasks", icon: <ListChecks size={16} /> },
            { href: "/timesheets", label: "Timesheets", icon: <CalendarRange size={16} /> },
            { href: "/manage", label: "Manage", icon: <Settings2 size={16} /> },
          ],
        },
      ]
    : [
        {
          label: "My space",
          items: [
            { href: "/", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
            { href: "/my-tasks", label: "My Tasks", icon: <ClipboardList size={16} /> },
            { href: "/my-timesheet", label: "My Timesheet", icon: <Clock size={16} /> },
          ],
        },
      ];

  const displayName = user.name || user.email.split("@")[0];
  const initials =
    (user.name?.match(/\b\w/g) || []).slice(0, 2).join("").toUpperCase() ||
    user.email.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top bar ──────────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white/85 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          <Link href="/" className="flex items-center gap-2 sm:gap-2.5 group min-w-0">
            <img
              src="/kubegraf-logo.png"
              alt="KubeGraf"
              className="w-8 h-8 sm:w-9 sm:h-9 object-contain transition-transform group-hover:scale-105 flex-shrink-0"
            />
            <div className="leading-tight min-w-0 hidden sm:block">
              <div className="font-display text-[15px] font-semibold tracking-tight text-gray-900 truncate">KubeGraf</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Internal Time Sheet</div>
            </div>
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <NotificationBell />

            <div className="flex items-center gap-2 px-1.5 sm:px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition border border-transparent hover:border-gray-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-200 to-brand-400 flex items-center justify-center text-black font-display font-semibold text-[12px] flex-shrink-0">
                {initials}
              </div>
              <div className="hidden md:flex flex-col items-start leading-tight min-w-0 max-w-[160px]">
                <span className="text-[13px] text-gray-900 truncate font-medium">{displayName}</span>
                <span className="text-[11px] text-gray-500 truncate">{user.email}</span>
              </div>
              <span className={user.role === "ADMIN" ? "ko-pill-admin" : "ko-pill-employee"} style={{ fontSize: 9, padding: "2px 7px" }}>
                {user.role}
              </span>
            </div>

            <button
              onClick={logout}
              className="ko-btn-ghost h-9 px-2.5 sm:px-3 text-xs inline-flex items-center gap-1.5"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Body grid ────────────────────────────────── */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8 grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[240px_1fr] gap-6 md:gap-8">
        <aside className="md:sticky md:top-24 self-start -mx-1 sm:mx-0">
          <nav className="md:space-y-5">
            {/* On mobile: single horizontal-scrolling pill row; on desktop: vertical labelled groups */}
            <div className="md:hidden flex gap-1.5 overflow-x-auto pb-1 px-1 ko-table-scroll">
              {groups.flatMap((g) => g.items).map((it) => {
                const active = location === it.href || (it.href !== "/" && location.startsWith(it.href));
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={
                      "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] whitespace-nowrap transition border flex-shrink-0 " +
                      (active
                        ? "bg-brand-50 text-brand-800 border-brand-200 shadow-sm font-medium"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50")
                    }
                  >
                    <span className={active ? "text-brand-700" : "text-gray-400"}>{it.icon}</span>
                    {it.label}
                  </Link>
                );
              })}
            </div>

            {/* Desktop sidebar */}
            <div className="hidden md:block">
              {groups.map((group) => (
                <div key={group.label} className="mb-5 last:mb-0">
                  <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-gray-400 font-semibold">
                    {group.label}
                  </div>
                  <ul className="space-y-1">
                    {group.items.map((it) => {
                      const active = location === it.href || (it.href !== "/" && location.startsWith(it.href));
                      return (
                        <li key={it.href}>
                          <Link
                            href={it.href}
                            className={
                              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition border " +
                              (active
                                ? "bg-brand-50 text-brand-800 border-brand-200 shadow-sm font-medium"
                                : "text-gray-700 hover:text-gray-900 border-transparent hover:bg-gray-100/70")
                            }
                          >
                            <span className={active ? "text-brand-700" : "text-gray-400"}>{it.icon}</span>
                            {it.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </aside>

        <main className="min-w-0 ko-fade-in">{children}</main>
      </div>

      <footer className="border-t border-gray-200 py-6 text-center text-[11px] text-gray-400">
        KubeGraf · Internal use only · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
