import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, History } from "lucide-react";
import { api } from "../api/client";
import type { TicketDetail } from "../types";
import { chronological } from "../utils/formatters";
import { Timestamp } from "./Badges";
import { EmptyState, ErrorState, LoadingState } from "./Feedback";

export default function TicketHistory({ ticket }: { ticket: TicketDetail }) {
  const activities = useQuery({
    queryKey: ["activities", ticket.id],
    queryFn: ({ signal }) => api.activities(ticket.id, signal),
    initialData: ticket.activities,
    refetchInterval: 30_000,
  });
  return (
    <div
      role="tabpanel"
      id="history-panel"
      aria-labelledby="history-tab"
      className="p-4 sm:p-6"
    >
      <div className="mb-6 flex items-center gap-2 text-xs text-slate-500">
        <History size={14} />A complete record, from the beginning.
      </div>
      {activities.isError && (
        <ErrorState
          error={activities.error}
          retry={() => void activities.refetch()}
        />
      )}
      {activities.isPending ? (
        <LoadingState label="Loading activity history…" />
      ) : activities.data?.length ? (
        <ol
          aria-label="Activity history, oldest first"
          className="ml-3 border-l border-slate-200"
        >
          {chronological(activities.data).map((activity) => (
            <li key={activity.id} className="relative pb-7 pl-7 last:pb-0">
              <span className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-600">
                <ActivityIcon size={11} />
              </span>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                  {activity.event_type.replace(/[_-]/g, " ")}
                </span>
                <Timestamp
                  value={activity.created_at}
                  className="text-[10px] text-slate-400"
                />
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-600">
                {activity.description}
              </p>
              {activity.actor && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  by {activity.actor}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        !activities.isError && (
          <EmptyState
            title="No activity yet"
            description="Updates to this ticket will appear here, in chronological order."
          />
        )
      )}
    </div>
  );
}
