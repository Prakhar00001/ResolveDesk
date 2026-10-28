import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useDashboard } from "../api/hooks";
import DashboardStats from "../components/DashboardStats";
import { EmptyState, ErrorState, LoadingState } from "../components/Feedback";
import TicketFilters from "../components/TicketFilters";
import TicketTable from "../components/TicketTable";
import { PRIORITIES, STATUSES, type TicketFilters as Filters } from "../types";

export default function TicketDashboardPage({
  onCreate,
}: {
  onCreate: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const pendingParams = useRef(params);
  useLayoutEffect(() => {
    pendingParams.current = params;
  }, [params]);
  function navigateParams(next: URLSearchParams, replace = false) {
    // Router search-param callbacks don't queue like React state updaters.
    // Advance our merge base before navigation, and resync on history changes.
    pendingParams.current = next;
    setParams(next, { replace });
  }
  function resetFilters() {
    navigateParams(new URLSearchParams());
  }
  const filters: Filters = {
    search: params.get("search") || "",
    status: STATUSES.includes(params.get("status") as never)
      ? params.get("status")!
      : "",
    priority: PRIORITIES.includes(params.get("priority") as never)
      ? params.get("priority")!
      : "",
    assignee_id: /^\d+$/.test(params.get("assignee_id") || "")
      ? params.get("assignee_id")!
      : "",
    sort: params.get("sort") === "priority" ? "priority" : "updated",
  };
  const [search, setSearch] = useState(filters.search);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(filters.search), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);
  const queryFilters = { ...filters, search };
  const tickets = useQuery({
    queryKey: ["tickets", queryFilters],
    queryFn: ({ signal }) => api.tickets(queryFilters, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const dashboard = useDashboard();
  function changeFilter(key: keyof Filters, value: string) {
    const next = new URLSearchParams(pendingParams.current);
    if (!value || (key === "sort" && value === "updated")) next.delete(key);
    else next.set(key, value);
    navigateParams(next, key === "search");
  }
  const active = Boolean(
    filters.search || filters.status || filters.priority || filters.assignee_id,
  );
  function summaryFilter(key: "status" | "priority", value: string) {
    navigateParams(new URLSearchParams(value ? { [key]: value } : {}));
  }
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[2px] text-brand-600">
            Your support, in focus
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.8px] text-ink sm:text-[28px]">
            A little clarity. Better support.
          </h1>
          <p className="mt-2 text-[13px] text-slate-500">
            Keep conversations moving and your customers in good hands.
          </p>
        </div>
        <div className="hidden rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-[11px] text-slate-500 sm:block">
          {new Date().toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
      <DashboardStats onFilter={summaryFilter} />
      <section
        aria-labelledby="tickets-heading"
        className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5">
          <div className="flex items-center gap-2.5">
            <h2
              id="tickets-heading"
              className="text-base font-semibold tracking-tight text-ink"
            >
              Ticket inbox
            </h2>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              {tickets.data?.length ?? "—"}
            </span>
            {tickets.isFetching && (
              <RefreshCw
                size={12}
                className="animate-spin text-brand-600"
                aria-label="Refreshing tickets"
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="icon-button"
              onClick={() => {
                void tickets.refetch();
                void dashboard.refetch();
              }}
              aria-label="Refresh tickets and statistics"
              disabled={tickets.isFetching}
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={onCreate}
              className="btn-secondary !gap-1.5 !px-3 !py-1.5 !text-xs"
            >
              <Plus size={14} />
              New ticket
            </button>
          </div>
        </div>
        <div
          role="group"
          aria-label="Ticket status views"
          className="flex gap-5 overflow-x-auto border-b border-slate-100 px-5"
        >
          {[
            { label: "All tickets", value: "", count: dashboard.data?.total },
            { label: "Open", value: "Open", count: dashboard.data?.open },
            {
              label: "In progress",
              value: "In Progress",
              count: dashboard.data?.in_progress,
            },
            { label: "Waiting", value: "Waiting on Customer" },
            {
              label: "Resolved",
              value: "Resolved",
              count: dashboard.data?.resolved,
            },
          ].map((tab) => (
            <button
              key={tab.label}
              onClick={() => changeFilter("status", tab.value)}
              aria-pressed={filters.status === tab.value}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 py-3 text-xs font-medium transition-colors ${filters.status === tab.value ? "border-brand-600 text-brand-600" : "border-transparent text-slate-400 hover:text-slate-700"}`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] ${filters.status === tab.value ? "bg-brand-50 text-brand-600" : "bg-slate-50 text-slate-400"}`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <TicketFilters
          filters={filters}
          onChange={changeFilter}
          onReset={resetFilters}
        />
        {tickets.isError && (
          <div className="p-5">
            <ErrorState
              error={tickets.error}
              retry={() => void tickets.refetch()}
            />
          </div>
        )}
        {tickets.isPending ? (
          <LoadingState label="Loading your tickets…" />
        ) : tickets.data?.length ? (
          <TicketTable
            tickets={tickets.data}
            viewKey={JSON.stringify(queryFilters)}
            refreshing={tickets.isFetching || search !== filters.search}
          />
        ) : (
          !tickets.isError && (
            <EmptyState
              title={
                active
                  ? "No tickets match this view"
                  : "A fresh start for great support"
              }
              description={
                active
                  ? "Try a different search or reset your filters to see more conversations."
                  : "Your inbox is ready. Create your first ticket to start helping your customers."
              }
              action={
                active ? (
                  <button onClick={resetFilters} className="btn-secondary">
                    Reset filters
                  </button>
                ) : (
                  <button onClick={onCreate} className="btn-primary">
                    <Plus size={16} />
                    Create your first ticket
                  </button>
                )
              }
            />
          )
        )}
      </section>
      <p className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-400">
        <span className="h-1 w-1 rounded-full bg-brand-500" />
        Every ticket is a chance to make someone’s day a little better.
      </p>
    </>
  );
}
