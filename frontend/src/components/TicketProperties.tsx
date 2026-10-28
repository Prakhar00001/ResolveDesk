import { useMutation } from "@tanstack/react-query";
import { CircleUserRound, Loader2, Mail, Settings2 } from "lucide-react";
import { api } from "../api/client";
import { useAgents, useRefreshTickets } from "../api/hooks";
import { PRIORITIES, STATUSES, type Ticket, type TicketPatch } from "../types";
import { customerLabel } from "../utils/formatters";
import { Avatar, Timestamp } from "./Badges";
import { ErrorState, useToast } from "./Feedback";

export default function TicketProperties({
  ticket,
  actor,
  onActorChange,
}: {
  ticket: Ticket;
  actor: string;
  onActorChange: (value: string) => void;
}) {
  const agents = useAgents();
  const refresh = useRefreshTickets();
  const notify = useToast();
  const update = useMutation({
    mutationFn: (patch: TicketPatch) =>
      api.updateTicket(ticket.id, {
        ...patch,
        ...(actor.trim() ? { actor: actor.trim() } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      notify("Ticket updated");
    },
  });
  return (
    <aside aria-label="Ticket information" className="space-y-5">
      <section className="panel">
        <h2 className="panel-heading">
          <Settings2 size={15} />
          Ticket properties
          {update.isPending && (
            <Loader2
              size={14}
              className="ml-auto animate-spin text-brand-600"
            />
          )}
        </h2>
        <fieldset disabled={update.isPending} className="space-y-4 p-5">
          <div>
            <label htmlFor="detail-status" className="field-label">
              Status
            </label>
            <select
              id="detail-status"
              className="input"
              value={ticket.status}
              onChange={(e) =>
                update.mutate({ status: e.target.value as Ticket["status"] })
              }
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="detail-priority" className="field-label">
              Priority
            </label>
            <select
              id="detail-priority"
              className="input"
              value={ticket.priority}
              onChange={(e) =>
                update.mutate({
                  priority: e.target.value as Ticket["priority"],
                })
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="detail-assignee" className="field-label">
              Assigned to
            </label>
            <select
              id="detail-assignee"
              className="input"
              value={ticket.assignee_id ?? ""}
              disabled={agents.isPending || agents.isError}
              onChange={(e) =>
                update.mutate({
                  assignee_id: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">
                {agents.isPending ? "Loading agents…" : "Unassigned"}
              </option>
              {ticket.assignee_id !== null &&
                !agents.data?.some((a) => a.id === ticket.assignee_id) && (
                  <option value={ticket.assignee_id}>
                    {ticket.assignee?.name || `Agent #${ticket.assignee_id}`}
                  </option>
                )}
              {agents.data?.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="detail-actor" className="field-label">
              Your name{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="detail-actor"
              className="input"
              placeholder="Name for activity history"
              value={actor}
              maxLength={120}
              onChange={(e) => onActorChange(e.target.value)}
            />
            <p className="mt-2 text-[10px] leading-4 text-slate-400">
              Changes save automatically. Your name identifies updates in the
              history.
            </p>
          </div>
        </fieldset>
        {(update.isError || agents.isError) && (
          <div className="px-4 pb-4">
            <ErrorState
              compact
              error={update.error || agents.error}
              retry={agents.isError ? () => void agents.refetch() : undefined}
            />
          </div>
        )}
      </section>
      <section className="panel">
        <h2 className="panel-heading">
          <CircleUserRound size={15} />
          Customer
        </h2>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <Avatar name={customerLabel(ticket)} />
            <div className="min-w-0">
              <p className="break-words text-xs font-semibold text-ink">
                {customerLabel(ticket)}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                Ticket requester
              </p>
            </div>
          </div>
          {ticket.customer_email && (
            <a
              href={`mailto:${ticket.customer_email}`}
              className="mt-4 flex items-start gap-2 break-all text-xs text-brand-600 hover:underline"
            >
              <Mail size={14} className="mt-0.5 shrink-0" />
              {ticket.customer_email}
            </a>
          )}
        </div>
      </section>
      <section className="panel p-5">
        <h2 className="mb-4 text-xs font-semibold text-ink">Ticket timeline</h2>
        <dl className="space-y-3 text-[11px]">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-slate-400">Created</dt>
            <dd className="text-slate-600">
              <Timestamp value={ticket.created_at} />
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-slate-400">Last updated</dt>
            <dd className="text-slate-600">
              <Timestamp value={ticket.updated_at} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Ticket ID</dt>
            <dd className="font-medium text-slate-600">
              #{ticket.id.toString().padStart(4, "0")}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
