import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  History,
  MessageSquare,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useRefreshTickets } from "../api/hooks";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import DeleteTicketModal from "../components/DeleteTicketModal";
import EditTicketModal from "../components/EditTicketModal";
import { EmptyState, ErrorState, LoadingState } from "../components/Feedback";
import TicketConversation from "../components/TicketConversation";
import TicketHistory from "../components/TicketHistory";
import TicketProperties from "../components/TicketProperties";
import type { TicketDetail } from "../types";

export default function TicketDetailPage() {
  const { id } = useParams();
  const refresh = useRefreshTickets();
  const ticketId = Number(id);
  const valid =
    /^\d+$/.test(id || "") && Number.isSafeInteger(ticketId) && ticketId > 0;
  const ticket = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: ({ signal }) => api.ticket(ticketId, signal),
    enabled: valid,
    refetchInterval: 30_000,
  });
  if (
    !valid ||
    (ticket.error instanceof ApiError && ticket.error.status === 404)
  )
    return (
      <EmptyState
        title="This ticket isn’t here"
        description="It may have been deleted, or the link may be incorrect."
        action={
          <Link to="/tickets" className="btn-primary">
            <ArrowLeft size={15} />
            Back to inbox
          </Link>
        }
      />
    );
  if (ticket.isPending) return <LoadingState label="Opening your ticket…" />;
  if (!ticket.data)
    return (
      <div className="space-y-5">
        <Link
          to="/tickets"
          className="inline-flex items-center gap-2 text-xs text-slate-500"
        >
          <ArrowLeft size={14} />
          Back to inbox
        </Link>
        <ErrorState error={ticket.error} retry={() => void ticket.refetch()} />
      </div>
    );
  return (
    <>
      {ticket.isError && (
        <div className="mb-5">
          <ErrorState
            error={ticket.error}
            retry={() => void ticket.refetch()}
          />
        </div>
      )}
      <TicketWorkspace
        key={ticketId}
        ticket={ticket.data}
        refreshing={ticket.isFetching}
        onRefresh={() => void refresh()}
      />
    </>
  );
}

function TicketWorkspace({
  ticket,
  refreshing,
  onRefresh,
}: {
  ticket: TicketDetail;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"conversation" | "history">("conversation");
  const [actor, setActor] = useState("");
  return (
    <>
      <Link
        to="/tickets"
        className="mb-6 inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-brand-600"
      >
        <ArrowLeft size={14} />
        Back to ticket inbox
      </Link>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium tracking-wide text-slate-400">
              TICKET #{ticket.id.toString().padStart(4, "0")}
            </span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h1 className="break-words text-2xl font-semibold leading-snug tracking-[-0.6px] text-ink">
            {ticket.subject}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="icon-button"
            onClick={onRefresh}
            aria-label="Refresh ticket"
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            className="btn-secondary !px-3 !py-2 !text-xs"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            Edit ticket
          </button>
          <button
            className="icon-button !text-rose-500 hover:!bg-rose-50"
            aria-label="Delete ticket"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_292px]">
        <section aria-label="Ticket workspace" className="panel min-w-0">
          <div
            role="tablist"
            aria-label="Ticket sections"
            className="flex gap-6 border-b border-slate-100 px-5"
          >
            <button
              id="conversation-tab"
              role="tab"
              aria-selected={tab === "conversation"}
              aria-controls="conversation-panel"
              tabIndex={tab === "conversation" ? 0 : -1}
              onKeyDown={(e) => {
                if (["ArrowRight", "ArrowLeft", "End"].includes(e.key)) {
                  e.preventDefault();
                  setTab("history");
                  document.getElementById("history-tab")?.focus();
                }
              }}
              onClick={() => setTab("conversation")}
              className={`section-tab ${tab === "conversation" ? "section-tab-active" : ""}`}
            >
              <MessageSquare size={15} />
              Conversation
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {ticket.entries?.length ?? 0}
              </span>
            </button>
            <button
              id="history-tab"
              role="tab"
              aria-selected={tab === "history"}
              aria-controls="history-panel"
              tabIndex={tab === "history" ? 0 : -1}
              onKeyDown={(e) => {
                if (["ArrowRight", "ArrowLeft", "Home"].includes(e.key)) {
                  e.preventDefault();
                  setTab("conversation");
                  document.getElementById("conversation-tab")?.focus();
                }
              }}
              onClick={() => setTab("history")}
              className={`section-tab ${tab === "history" ? "section-tab-active" : ""}`}
            >
              <History size={15} />
              Activity history
            </button>
          </div>
          <div hidden={tab !== "conversation"}>
            <TicketConversation
              ticket={ticket}
              author={actor}
              onAuthorChange={setActor}
            />
          </div>
          {tab === "history" && <TicketHistory ticket={ticket} />}
        </section>
        <TicketProperties
          ticket={ticket}
          actor={actor}
          onActorChange={setActor}
        />
      </div>
      {editing && (
        <EditTicketModal
          ticket={ticket}
          actor={actor}
          onClose={() => setEditing(false)}
        />
      )}
      {deleting && (
        <DeleteTicketModal ticket={ticket} onClose={() => setDeleting(false)} />
      )}
    </>
  );
}
