import { useQuery } from "@tanstack/react-query";
import { Globe2, LockKeyhole, MessageSquare } from "lucide-react";
import { api } from "../api/client";
import type { TicketDetail } from "../types";
import { chronological, customerLabel } from "../utils/formatters";
import { Avatar, Timestamp } from "./Badges";
import { ErrorState, LoadingState } from "./Feedback";
import ReplyComposer from "./ReplyComposer";

export default function TicketConversation({
  ticket,
  author,
  onAuthorChange,
}: {
  ticket: TicketDetail;
  author: string;
  onAuthorChange: (value: string) => void;
}) {
  const entries = useQuery({
    queryKey: ["entries", ticket.id],
    queryFn: ({ signal }) => api.entries(ticket.id, signal),
    initialData: ticket.entries,
    refetchInterval: 30_000,
  });
  return (
    <div
      role="tabpanel"
      id="conversation-panel"
      aria-labelledby="conversation-tab"
      className="p-4 sm:p-6"
    >
      <article className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <Avatar name={customerLabel(ticket)} />
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-xs font-semibold text-ink">
              {customerLabel(ticket)}
            </h3>
            <p className="mt-1 text-[10px] text-slate-400">Original request</p>
          </div>
          <Timestamp
            value={ticket.created_at}
            className="text-[10px] text-slate-400"
          />
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-7 text-slate-600">
          {ticket.description}
        </p>
      </article>
      {entries.isError && (
        <div className="mt-4">
          <ErrorState
            compact
            error={entries.error}
            retry={() => void entries.refetch()}
          />
        </div>
      )}
      {entries.isPending ? (
        <LoadingState label="Loading conversation…" />
      ) : entries.data?.length ? (
        <ol className="mt-5 space-y-4" aria-label="Conversation, oldest first">
          {chronological(entries.data).map((entry) => {
            const internal = entry.entry_type === "Internal Note";
            return (
              <li key={entry.id}>
                <article
                  className={`rounded-xl border p-4 sm:p-5 ${internal ? "border-amber-200/70 bg-amber-50/50" : "border-slate-200/80 bg-white"}`}
                >
                  <div className="mb-4 flex flex-wrap items-start gap-3">
                    <Avatar name={entry.author} />
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-xs font-semibold text-ink">
                        {entry.author}
                      </h3>
                      <span
                        className={`mt-1.5 inline-flex items-center gap-1 text-[10px] ${internal ? "text-amber-700" : "text-brand-600"}`}
                      >
                        {internal ? (
                          <LockKeyhole size={10} />
                        ) : (
                          <Globe2 size={10} />
                        )}
                        {entry.entry_type}
                      </span>
                    </div>
                    <Timestamp
                      value={entry.created_at}
                      className="text-[10px] text-slate-400"
                    />
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-7 text-slate-600">
                    {entry.content}
                  </p>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        !entries.isError && (
          <p className="my-7 flex items-center justify-center gap-2 text-xs text-slate-400">
            <MessageSquare size={14} />
            No replies yet. Be the first to help.
          </p>
        )
      )}
      <ReplyComposer
        ticketId={ticket.id}
        author={author}
        onAuthorChange={onAuthorChange}
      />
    </div>
  );
}
