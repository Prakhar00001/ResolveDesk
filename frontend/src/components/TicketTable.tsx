import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Ticket } from "../types";
import { customerLabel } from "../utils/formatters";
import { Avatar, PriorityBadge, StatusBadge, Timestamp } from "./Badges";

export default function TicketTable({
  tickets,
  viewKey,
  refreshing,
}: {
  tickets: Ticket[];
  viewKey: string;
  refreshing: boolean;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  useEffect(() => setPage(1), [viewKey, size]);
  const pages = Math.max(1, Math.ceil(tickets.length / size));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * size;
  return (
    <div aria-busy={refreshing}>
      {/* Keep absolute sr-only labels inside the table's scroll boundary. */}
      <div className="relative min-w-0 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <caption className="sr-only">
            Support tickets, sorted by the selected order
          </caption>
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-semibold uppercase tracking-[0.7px] text-slate-400">
              <th scope="col" className="w-[34%] px-5 py-3.5">
                Ticket / Customer
              </th>
              <th scope="col" className="px-3 py-3.5">
                Status
              </th>
              <th scope="col" className="px-3 py-3.5">
                Priority
              </th>
              <th scope="col" className="px-3 py-3.5">
                Assignee
              </th>
              <th scope="col" className="px-3 py-3.5">
                Last updated
              </th>
              <th scope="col" className="w-10">
                <span className="sr-only">Open ticket</span>
              </th>
            </tr>
          </thead>
          <tbody className={refreshing ? "opacity-60" : ""}>
            {tickets.slice(start, start + size).map((ticket) => (
              <tr
                key={ticket.id}
                className="group border-b border-slate-100 transition-colors last:border-b-0 hover:bg-brand-50/30"
              >
                <td className="max-w-[340px] px-5 py-[19px]">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="shrink-0 text-[10px] font-medium tabular-nums text-slate-400">
                      #{ticket.id.toString().padStart(4, "0")}
                    </span>
                    <Link
                      to={`/tickets/${ticket.id}`}
                      className="truncate text-[13px] font-semibold text-ink hover:text-brand-600 hover:underline"
                      title={ticket.subject}
                    >
                      {ticket.subject}
                    </Link>
                  </div>
                  <p className="truncate text-[11px] text-slate-400">
                    {customerLabel(ticket)}
                    {ticket.customer_name && ticket.customer_email && (
                      <span className="text-slate-300">
                        {" "}
                        · {ticket.customer_email}
                      </span>
                    )}
                  </p>
                </td>
                <td className="px-3 py-4">
                  <StatusBadge status={ticket.status} />
                </td>
                <td className="px-3 py-4">
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className="px-3 py-4">
                  {ticket.assignee ? (
                    <span className="flex items-center gap-2">
                      <Avatar name={ticket.assignee.name} small />
                      <span
                        className="max-w-[110px] truncate text-[11px] text-slate-600"
                        title={ticket.assignee.email}
                      >
                        {ticket.assignee.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">
                      Unassigned
                    </span>
                  )}
                </td>
                <td className="px-3 py-4">
                  <Timestamp
                    value={ticket.updated_at}
                    className="whitespace-nowrap text-[11px] text-slate-400"
                  />
                </td>
                <td className="pr-4">
                  <Link
                    to={`/tickets/${ticket.id}`}
                    aria-label={`Open ticket #${ticket.id}: ${ticket.subject}`}
                    className="icon-button text-slate-300 group-hover:text-brand-600"
                  >
                    <ArrowRight size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-5 py-4 text-[11px] text-slate-500">
        <p>
          Showing{" "}
          <span className="font-semibold text-slate-700">
            {start + 1}–{Math.min(start + size, tickets.length)}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-slate-700">{tickets.length}</span>{" "}
          tickets
        </p>
        <div className="flex items-center gap-3">
          <label htmlFor="page-size" className="hidden sm:inline">
            Rows per page
          </label>
          <select
            id="page-size"
            aria-label="Rows per page"
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button
            className="icon-button !rounded-md !border !border-slate-200"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="tabular-nums">
            {currentPage} / {pages}
          </span>
          <button
            className="icon-button !rounded-md !border !border-slate-200"
            aria-label="Next page"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
