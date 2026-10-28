import {
  ArrowDownWideNarrow,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAgents } from "../api/hooks";
import { PRIORITIES, STATUSES, type TicketFilters as Filters } from "../types";
import { ErrorState } from "./Feedback";

export default function TicketFilters({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
  onReset: () => void;
}) {
  const agents = useAgents();
  const active = [
    filters.search,
    filters.status,
    filters.priority,
    filters.assignee_id,
  ].filter(Boolean).length;
  return (
    <div className="space-y-3 border-b border-slate-100 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1 xl:max-w-[340px]">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <label className="sr-only" htmlFor="ticket-search">
            Search tickets
          </label>
          <input
            id="ticket-search"
            type="search"
            placeholder="Search tickets or customers…"
            value={filters.search}
            onChange={(e) => onChange("search", e.target.value)}
            className="input !bg-slate-50/60 !pl-9 !pr-9"
          />
          {filters.search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-ink"
              aria-label="Clear search"
              onClick={() => onChange("search", "")}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <SlidersHorizontal
            size={14}
            className="mr-1 hidden text-slate-400 sm:block"
            aria-hidden="true"
          />
          <label className="sr-only" htmlFor="status-filter">
            Filter by status
          </label>
          <select
            id="status-filter"
            className="filter-select max-w-[175px]"
            value={filters.status}
            onChange={(e) => onChange("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="priority-filter">
            Filter by priority
          </label>
          <select
            id="priority-filter"
            className="filter-select"
            value={filters.priority}
            onChange={(e) => onChange("priority", e.target.value)}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="assignee-filter">
            Filter by assignee
          </label>
          <select
            id="assignee-filter"
            className="filter-select max-w-[170px]"
            disabled={agents.isPending || agents.isError}
            value={filters.assignee_id}
            onChange={(e) => onChange("assignee_id", e.target.value)}
          >
            <option value="">
              {agents.isPending ? "Loading agents…" : "All assignees"}
            </option>
            {filters.assignee_id &&
              !agents.data?.some(
                (agent) => String(agent.id) === filters.assignee_id,
              ) && (
                <option value={filters.assignee_id}>
                  Agent #{filters.assignee_id}
                </option>
              )}
            {agents.data?.map((agent) => (
              <option value={agent.id} key={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
          <ArrowDownWideNarrow
            size={14}
            className="hidden text-slate-400 sm:block"
            aria-hidden="true"
          />
          <label className="sr-only" htmlFor="sort-tickets">
            Sort tickets
          </label>
          <select
            id="sort-tickets"
            className="filter-select"
            value={filters.sort}
            onChange={(e) => onChange("sort", e.target.value)}
          >
            <option value="updated">Last updated</option>
            <option value="priority">Priority</option>
          </select>
        </div>
      </div>
      {(active > 0 || filters.sort !== "updated") && (
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            {active
              ? `${active} active filter${active === 1 ? "" : "s"} · Combined with AND`
              : "Sorted by priority"}
          </span>
          <button
            className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:text-brand-900"
            onClick={onReset}
          >
            <RotateCcw size={12} />
            Reset view
          </button>
        </div>
      )}
      {agents.isError && (
        <ErrorState
          compact
          error={agents.error}
          retry={() => void agents.refetch()}
        />
      )}
    </div>
  );
}
