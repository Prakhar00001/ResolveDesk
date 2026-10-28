import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useRefreshTickets } from "../api/hooks";
import type { Ticket } from "../types";
import { ErrorState, useToast } from "./Feedback";
import Modal from "./Modal";

export default function DeleteTicketModal({
  ticket,
  onClose,
}: {
  ticket: Ticket;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const refresh = useRefreshTickets();
  const notify = useToast();
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteTicket(ticket.id),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["ticket", ticket.id] });
      client.removeQueries({ queryKey: ["entries", ticket.id] });
      client.removeQueries({ queryKey: ["activities", ticket.id] });
      notify(`Ticket #${ticket.id} deleted`);
      onClose();
      navigate("/tickets");
      void refresh();
    },
  });
  return (
    <Modal
      title="Delete this ticket?"
      description={`Ticket #${ticket.id} will be removed from your workspace.`}
      onClose={onClose}
      busy={remove.isPending}
      small
    >
      <div className="p-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
          <Trash2 size={22} />
        </div>
        <p className="break-words text-sm font-semibold text-ink">
          {ticket.subject}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          This ticket and its conversation will no longer appear in your inbox.
          You can’t undo this from the workspace.
        </p>
        {remove.isError && (
          <div className="mt-4">
            <ErrorState compact error={remove.error} />
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={remove.isPending}
          >
            Keep ticket
          </button>
          <button
            className="btn-danger"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}
            {remove.isPending ? "Deleting…" : "Delete ticket"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
