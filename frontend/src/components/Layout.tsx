import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { useDashboard } from "../api/hooks";
import Modal from "./Modal";

type LayoutProps = { onCreate: () => void };

export default function Layout({ onCreate }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const location = useLocation();
  const [params] = useSearchParams();
  const dashboard = useDashboard();
  const activeView = params.get("status") || "all";
  const detail = /^\/tickets\/\d+/.test(location.pathname);
  useEffect(() => setMobileOpen(false), [location]);
  const views = [
    { label: "All tickets", value: "all", count: dashboard.data?.total },
    { label: "Open", value: "Open", count: dashboard.data?.open },
    {
      label: "In progress",
      value: "In Progress",
      count: dashboard.data?.in_progress,
    },
    { label: "Resolved", value: "Resolved", count: dashboard.data?.resolved },
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only z-[90] rounded-md bg-white p-3 text-brand-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-slate-200/70 bg-white transition-transform lg:translate-x-0 ${mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full lg:visible"}`}
      >
        <Link
          to="/"
          className="flex h-[83px] items-center gap-2.5 px-6 text-xl font-bold tracking-[-0.7px] text-ink"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <Check size={22} strokeWidth={3} />
          </span>
          ResolveDesk<span className="mb-3 -ml-1 text-brand-500">.</span>
        </Link>
        <button
          className="icon-button absolute right-2 top-6 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X size={18} />
        </button>
        <div className="mx-4 mb-7 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-brand-700">
            <LifeBuoy size={19} />
          </span>
          <div>
            <p className="text-xs font-semibold text-ink">Support workspace</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Customer experience
            </p>
          </div>
        </div>
        <nav className="flex-1 px-3">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[1.7px] text-slate-400">
            Workspace
          </p>
          <Link
            to="/"
            aria-current={location.pathname === "/" ? "page" : undefined}
            className={`nav-item ${location.pathname === "/" ? "nav-active" : ""}`}
          >
            <LayoutDashboard size={18} />
            Overview
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />
          </Link>
          <div className="mb-2 mt-6 flex items-center gap-2 px-3 text-xs font-semibold text-slate-500">
            <Inbox size={16} />
            Ticket inbox
          </div>
          {views.map((view) => (
            <Link
              key={view.value}
              to={
                view.value === "all"
                  ? "/tickets"
                  : `/tickets?status=${encodeURIComponent(view.value)}`
              }
              aria-current={
                !detail &&
                activeView === view.value &&
                location.pathname === "/tickets"
                  ? "page"
                  : undefined
              }
              className={`nav-item !py-2.5 !pl-9 ${!detail && activeView === view.value && location.pathname === "/tickets" ? "nav-active" : ""}`}
            >
              <span>{view.label}</span>
              <span className="ml-auto rounded-md bg-slate-100/80 px-1.5 py-0.5 text-[10px] tabular-nums">
                {view.count ?? "—"}
              </span>
            </Link>
          ))}
        </nav>
        <div className="mx-4 mb-5 rounded-xl bg-brand-50 p-4">
          <Sparkles size={19} className="mb-3 text-brand-600" />
          <p className="text-xs font-semibold text-brand-900">
            A little care goes a long way.
          </p>
          <p className="mt-1.5 text-[11px] leading-5 text-brand-700/80">
            Turn every conversation into a better customer experience.
          </p>
        </div>
        <div className="border-t border-slate-100 p-3">
          <button
            onClick={() => setHelpOpen(true)}
            className="nav-item w-full text-left"
          >
            <CircleHelp size={18} />
            Workspace guide
            <ArrowUpRight size={14} className="ml-auto" />
          </button>
          <div className="mt-2 flex items-center gap-2.5 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            <span className="text-[11px] text-slate-400">
              ResolveDesk · Support, simplified
            </span>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[232px]">
        <header className="flex h-[83px] items-center justify-between gap-4 border-b border-slate-200/70 bg-white/90 px-4 sm:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="icon-button lg:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span className="hidden text-xs text-slate-400 sm:inline">
              Workspace
            </span>
            <ChevronRight
              size={13}
              className="hidden text-slate-300 sm:block"
            />
            <Link
              to="/tickets"
              className="truncate text-xs font-medium text-ink"
            >
              {location.pathname === "/" ? "Overview" : "Ticket inbox"}
            </Link>
            {detail && (
              <>
                <ChevronRight size={13} className="text-slate-300" />
                <span className="text-xs text-slate-500">Ticket details</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-1.5 text-[11px] font-medium text-slate-500 md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Customer support
            </span>
            <button
              onClick={onCreate}
              className="btn-primary !px-3 !py-2 text-xs"
            >
              <Plus size={15} />
              <span>New ticket</span>
            </button>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1680px] px-4 py-7 outline-none sm:px-8 sm:py-9 xl:px-10"
        >
          <Outlet />
        </main>
        <footer className="mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 py-5 text-[10px] text-slate-400 sm:mx-8 xl:mx-10">
          <span>ResolveDesk / Customer support workspace</span>
          <span>Made for more human support.</span>
        </footer>
      </div>
      {helpOpen && (
        <Modal
          title="Your workspace, at a glance"
          description="Everything you need to keep support moving."
          onClose={() => setHelpOpen(false)}
          small
        >
          <div className="space-y-4 p-6 text-sm leading-6 text-slate-600">
            <p>
              <strong className="text-ink">Find what matters.</strong> Combine
              search, status, priority, and assignee filters. Your filters stay
              in the URL so you can share a view.
            </p>
            <p>
              <strong className="text-ink">Keep the context.</strong> Open a
              ticket to edit its details, change ownership, and see the complete
              conversation and activity history.
            </p>
            <p>
              <strong className="text-ink">Reply with intention.</strong> Choose
              Public Reply for a customer-facing response or Internal Note for
              team context. Enter your name to identify your contribution.
            </p>
            <button
              onClick={() => setHelpOpen(false)}
              className="btn-primary w-full"
            >
              Got it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
