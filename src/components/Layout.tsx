import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarDays, History, Layers, Menu, ClipboardList, FolderKanban, Home, LogOut, MessageSquareText, MonitorPlay, Network, NotebookPen, Settings, Sparkles, Users,
} from "lucide-react";
import { useStore } from "@/data/store";
import { isAdmin } from "@/domain/permissions";
import { ROLE_LABELS } from "@/domain/types";
import { Select } from "./ui/input";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "My work", icon: Home, end: true },
  { to: "/lines", label: "Lines of effort", icon: Layers },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/tasks", label: "Task list", icon: ClipboardList },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/people", label: "Workload", icon: Users, adminOnly: true },
  { to: "/org", label: "Org chart", icon: Network },
  { to: "/meeting", label: "Meeting notes", icon: NotebookPen, end: true },
  { to: "/meeting/past", label: "Past meetings", icon: History, sub: true },
  { to: "/display", label: "Meeting display", icon: MonitorPlay },
  { to: "/plan", label: "Planning", icon: Sparkles },
  { to: "/ask", label: "Ask about the data", icon: MessageSquareText },
];

/** Bottom tabs on phones; everything else is under "More". */
const TABS = [
  { to: "/", label: "My work", icon: Home, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
  { to: "/tasks", label: "Tasks", icon: ClipboardList, end: false },
  { to: "/meeting", label: "Meetings", icon: NotebookPen, end: false },
];

export function Layout() {
  const { me, myName, myEmail, data, mode, signOut, switchUser, lastSync } = useStore();
  const [more, setMore] = useState(false);
  // Workload and Admin are for admins only.
  const items = isAdmin(me) ? [...NAV, { to: "/admin", label: "Admin", icon: Settings }] : NAV.filter((n) => !("adminOnly" in n));

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="h-8 w-8 rounded-md" />
          <div>
            <div className="text-sm font-semibold leading-tight">FSI Projects</div>
            <div className="text-xs text-muted-foreground">Frontier Security Institute</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={"end" in n ? n.end : false}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "sub" in n && "py-1.5 pl-9 text-xs",
                  isActive && "bg-accent text-accent-foreground",
                )
              }
            >
              <n.icon className={"sub" in n ? "h-3.5 w-3.5" : "h-4 w-4"} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-4 text-xs text-muted-foreground">
          {mode === "demo" && switchUser ? (
            <label className="grid gap-1">
              <span className="font-medium text-foreground">Demo: viewing as</span>
              <Select value={me?.id ?? ""} onChange={(e) => switchUser(e.target.value)}>
                {data.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({ROLE_LABELS[p.role]})</option>)}
              </Select>
            </label>
          ) : (
            <>
              <div className="font-medium text-foreground">{me?.name ?? myName}</div>
              <div className="truncate">{myEmail}</div>
              {lastSync && <div className="mt-1">Updated {lastSync.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}
              <button onClick={signOut} className="mt-2 inline-flex items-center gap-1 hover:text-foreground">
                <LogOut className="h-3 w-3" /> Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Phones: a slim header on top and app-style tabs at the bottom; "More" opens every page. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-card px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="h-7 w-7 rounded" />
        <span className="text-sm font-semibold">FSI Projects</span>
      </header>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            onClick={() => setMore(false)}
            className={({ isActive }) =>
              cn("flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground", isActive && !more && "font-semibold text-primary")
            }
          >
            <t.icon className="h-5 w-5" />
            {t.label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
          className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground", more && "font-semibold text-primary")}
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </nav>
      {more && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-0 z-30 overflow-y-auto bg-card md:hidden">
          <div className="grid gap-1 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={"end" in n ? n.end : false}
                onClick={() => setMore(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-base text-muted-foreground",
                    "sub" in n && "pl-10 text-sm",
                    isActive && "bg-accent font-medium text-accent-foreground",
                  )
                }
              >
                <n.icon className="h-5 w-5" />
                {n.label}
              </NavLink>
            ))}
            <div className="mt-3 border-t pt-4 text-sm text-muted-foreground">
              {mode === "demo" && switchUser ? (
                <label className="grid gap-1">
                  <span className="font-medium text-foreground">Demo: viewing as</span>
                  <Select value={me?.id ?? ""} onChange={(e) => switchUser(e.target.value)}>
                    {data.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({ROLE_LABELS[p.role]})</option>)}
                  </Select>
                </label>
              ) : (
                <>
                  <div className="font-medium text-foreground">{me?.name ?? myName}</div>
                  <div className="truncate">{myEmail}</div>
                  <button onClick={signOut} className="mt-3 inline-flex items-center gap-2 py-1 hover:text-foreground">
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        {mode === "demo" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Demo mode with sample data. Changes are not saved. {switchUser && <span className="md:hidden">Switch users under More.</span>}
          </div>
        )}
        {mode === "sharepoint" && !me && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            You are signed in as {myEmail}, but you are not on the People list yet, so the app is read-only. Ask an admin to add you.
          </div>
        )}
        <div className="mx-auto max-w-7xl p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
