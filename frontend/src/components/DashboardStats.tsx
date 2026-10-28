import {
  ArrowUpRight,
  CheckCheck,
  CircleDot,
  Clock3,
  Inbox,
  Zap,
} from "lucide-react";
import { useDashboard } from "../api/hooks";
import { ErrorState } from "./Feedback";

export default function DashboardStats({
  onFilter,
}: {
  onFilter: (key: "status" | "priority", value: string) => void;
}) {
  const query = useDashboard();
  const cards = [
    {
      label: "Total tickets",
      value: query.data?.total,
      icon: Inbox,
      style: "bg-slate-100 text-slate-600",
      detail: "Every conversation counts",
      onClick: () => onFilter("status", ""),
    },
    {
      label: "Open tickets",
      value: query.data?.open,
      icon: CircleDot,
      style: "bg-blue-50 text-blue-600",
      detail: "Ready for a helping hand",
      onClick: () => onFilter("status", "Open"),
    },
    {
      label: "In progress",
      value: query.data?.in_progress,
      icon: Clock3,
      style: "bg-amber-50 text-amber-600",
      detail: "Your team is on it",
      onClick: () => onFilter("status", "In Progress"),
    },
    {
      label: "Resolved",
      value: query.data?.resolved,
      icon: CheckCheck,
      style: "bg-brand-50 text-brand-600",
      detail: "A little peace of mind",
      onClick: () => onFilter("status", "Resolved"),
    },
  ];
  return (
    <section aria-label="Workspace statistics" className="mb-8 space-y-3">
      {query.isError && (
        <ErrorState
          compact
          error={query.error}
          retry={() => void query.refetch()}
        />
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-5">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={card.onClick}
            className="group rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-panel transition hover:-translate-y-0.5 hover:border-brand-500/40 sm:p-5"
            aria-label={`Show ${card.label.toLowerCase()}${card.value !== undefined ? `: ${card.value}` : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 sm:text-[13px]">
                {card.label}
              </span>
              <span className={`rounded-lg p-2 ${card.style}`}>
                <card.icon size={17} strokeWidth={1.8} />
              </span>
            </div>
            <div className="mt-2 text-[30px] font-semibold tracking-[-1px] text-ink sm:text-[34px]">
              {query.isPending ? (
                <span className="skeleton inline-block h-10 w-16" />
              ) : (
                (card.value?.toLocaleString() ?? "—")
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-1 text-[10px] text-slate-400 sm:text-[11px]">
              <span>{card.detail}</span>
              <ArrowUpRight
                size={13}
                className="text-slate-300 transition group-hover:text-brand-600"
              />
            </div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[11px] text-slate-500">
        <button
          onClick={() => onFilter("priority", "Urgent")}
          className="inline-flex items-center gap-1.5 hover:text-rose-700"
        >
          <Zap size={13} className="text-rose-500" />
          <strong className="font-semibold text-slate-700">
            {query.data?.urgent ?? "—"}
          </strong>{" "}
          urgent tickets
        </button>
        <span
          className="inline-flex items-center gap-1.5"
          title="Overdue count is calculated by the backend"
        >
          <Clock3 size={13} className="text-amber-500" />
          <strong className="font-semibold text-slate-700">
            {query.data?.overdue ?? "—"}
          </strong>{" "}
          overdue
        </span>
        <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
          <span
            className={`h-1.5 w-1.5 rounded-full ${query.isError ? "bg-amber-400" : "bg-brand-500"}`}
          />
          {query.isError ? "Unable to refresh" : "Refreshes every 30s"}
        </span>
      </div>
    </section>
  );
}
